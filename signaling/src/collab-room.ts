// Durable Object for real-time Yjs document collaboration.
// Persists document updates into embedded SQLite, coordinates WebSockets via the
// DO Hibernation API, relays awareness states, and auto-compacts history.

import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import * as sync from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { isAllowedOrigin, type Env } from "./index.ts";

// Maximum WebSocket binary frame size (256 KB).
const MAX_WS_MESSAGE_SIZE = 256 * 1024;

// Maximum concurrent collaborators per room.
const MAX_CONCURRENT_SOCKETS = 20;

// Compaction threshold: collapse individual updates into a single snapshot update.
const COMPACTION_THRESHOLD = 50;

// Idle room retention: automatically purge room storage after 7 days of inactivity.
const IDLE_CLEANUP_ALARM_MS = 7 * 24 * 3600 * 1000;

interface CreateRoomRequest {
  roomId: string;
  token: string;
  initialMarkdown?: string;
}

export class CollabRoom extends DurableObject<Env> {
  private doc: Y.Doc;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.doc = new Y.Doc();
    this.initStorageAndLoad();
  }

  private initStorageAndLoad(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        update_data BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    const rows = this.ctx.storage.sql
      .exec<{ id: number; update_data: ArrayBuffer }>(
        "SELECT id, update_data FROM updates ORDER BY id ASC;",
      )
      .toArray();

    for (const row of rows) {
      Y.applyUpdate(this.doc, new Uint8Array(row.update_data));
    }
  }

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  override async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (!isAllowedOrigin(origin, this.env)) {
      return new Response("Forbidden origin", { status: 403 });
    }

    const url = new URL(request.url);

    if (request.method === "POST") {
      return this.handleCreate(request, origin);
    }

    if (request.method === "GET") {
      return this.handleConnect(request, url, origin);
    }

    const headers: Record<string, string> = {
      Allow: "GET, POST, OPTIONS",
      Vary: "Origin",
    };
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    return new Response("Method not allowed", { status: 405, headers });
  }

  private async handleCreate(
    request: Request,
    origin: string | null,
  ): Promise<Response> {
    const tokenRow = this.ctx.storage.sql
      .exec<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'token_hash';",
      )
      .toArray()[0];

    if (tokenRow) {
      return this.jsonResponse({ error: "Room already exists" }, 409, origin);
    }

    let body: CreateRoomRequest;
    try {
      body = (await request.json()) as CreateRoomRequest;
    } catch {
      return this.jsonResponse({ error: "Invalid JSON" }, 400, origin);
    }

    const tokenHash = await this.hashToken(body.token);
    const now = Date.now();

    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('token_hash', ?);",
      tokenHash,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('created_at', ?);",
      now.toString(),
    );

    const initialMarkdown = body.initialMarkdown ?? "";
    if (initialMarkdown.length > 0) {
      this.doc.getText("content").insert(0, initialMarkdown);
      const snapshot = Y.encodeStateAsUpdate(this.doc);
      const updateBuffer = snapshot.buffer.slice(
        snapshot.byteOffset,
        snapshot.byteOffset + snapshot.byteLength,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO updates (update_data, created_at) VALUES (?, ?);",
        updateBuffer,
        now,
      );
    }

    return this.jsonResponse({ ok: true, roomId: body.roomId }, 200, origin);
  }

  private async handleConnect(
    request: Request,
    url: URL,
    origin: string | null,
  ): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return this.textResponse("Expected WebSocket", 426, origin);
    }

    const token = url.searchParams.get("token");
    if (!token) {
      return this.textResponse("Missing token", 401, origin);
    }

    const tokenRow = this.ctx.storage.sql
      .exec<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'token_hash';",
      )
      .toArray()[0];

    if (!tokenRow) {
      return this.textResponse("Room not found", 404, origin);
    }

    const computedHash = await this.hashToken(token);
    if (computedHash !== tokenRow.value) {
      return this.textResponse("Unauthorized", 401, origin);
    }

    const activeSockets = this.ctx.getWebSockets("collab");
    if (activeSockets.length >= MAX_CONCURRENT_SOCKETS) {
      return this.textResponse("Too many concurrent connections", 429, origin);
    }

    // Cancel pending idle cleanup alarm while someone is connected
    await this.ctx.storage.deleteAlarm();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server, ["collab"]);

    // Send Yjs sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // messageSync = 0
    sync.writeSyncStep1(encoder, this.doc);
    this.sendRaw(server, encoding.toUint8Array(encoder));

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: ArrayBuffer | string,
  ): Promise<void> {
    if (typeof message === "string" || message.byteLength > MAX_WS_MESSAGE_SIZE) {
      return;
    }

    const bytes = new Uint8Array(message);
    const decoder = decoding.createDecoder(bytes);
    let messageType: number;
    try {
      messageType = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (messageType === 0) {
      // Sync message
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // messageSync = 0

      const appliedUpdates: Uint8Array[] = [];
      const updateListener = (update: Uint8Array) => {
        appliedUpdates.push(update);
      };
      this.doc.on("update", updateListener);

      try {
        sync.readSyncMessage(decoder, encoder, this.doc, ws);
      } catch (err) {
        console.error("CollabRoom: error processing sync message:", err);
      } finally {
        this.doc.off("update", updateListener);
      }

      // If encoder contains reply data (e.g. SyncStep2 answering client's SyncStep1)
      if (encoding.length(encoder) > 1) {
        this.sendRaw(ws, encoding.toUint8Array(encoder));
      }

      // Persist and broadcast any document updates applied
      if (appliedUpdates.length > 0) {
        const now = Date.now();
        for (const update of appliedUpdates) {
          const updateBuffer = update.buffer.slice(
            update.byteOffset,
            update.byteOffset + update.byteLength,
          );
          this.ctx.storage.sql.exec(
            "INSERT INTO updates (update_data, created_at) VALUES (?, ?);",
            updateBuffer,
            now,
          );
          this.broadcastUpdate(update, ws);
        }
        this.checkCompaction();
      }
    } else if (messageType === 1) {
      // Awareness message: relay directly to all other connected collab sockets
      for (const peer of this.ctx.getWebSockets("collab")) {
        if (peer !== ws) {
          this.sendRaw(peer, message);
        }
      }
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const remaining = this.ctx
      .getWebSockets("collab")
      .filter((s) => s !== ws && s.readyState === WebSocket.OPEN);

    if (remaining.length === 0) {
      // Compact updates before hibernating if there are multiple updates
      const countRow = this.ctx.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM updates;")
        .toArray()[0];
      const count = countRow ? Number(countRow.count) : 0;
      if (count > 1) {
        this.compactUpdates();
      }

      // Schedule 7-day idle cleanup alarm
      await this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_ALARM_MS);
    }
  }

  override async webSocketError(
    _ws: WebSocket,
    _error: unknown,
  ): Promise<void> {
    /* webSocketClose handles cleanup */
  }

  override async alarm(): Promise<void> {
    const active = this.ctx
      .getWebSockets("collab")
      .filter((s) => s.readyState === WebSocket.OPEN);
    if (active.length > 0) {
      return;
    }

    try {
      this.ctx.storage.sql.exec("DROP TABLE IF EXISTS meta;");
      this.ctx.storage.sql.exec("DROP TABLE IF EXISTS updates;");
    } catch {}

    await this.ctx.storage.deleteAll();
  }

  private broadcastUpdate(update: Uint8Array, originWs: WebSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // messageSync = 0
    sync.writeUpdate(encoder, update);
    const messageBytes = encoding.toUint8Array(encoder);

    for (const peer of this.ctx.getWebSockets("collab")) {
      if (peer !== originWs) {
        this.sendRaw(peer, messageBytes);
      }
    }
  }

  private checkCompaction(): void {
    const countRow = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM updates;")
      .toArray()[0];
    const count = countRow ? Number(countRow.count) : 0;
    if (count > COMPACTION_THRESHOLD) {
      this.compactUpdates();
    }
  }

  private compactUpdates(): void {
    const snapshot = Y.encodeStateAsUpdate(this.doc);
    const snapshotBuffer = snapshot.buffer.slice(
      snapshot.byteOffset,
      snapshot.byteOffset + snapshot.byteLength,
    );
    const now = Date.now();

    if (typeof this.ctx.storage.transactionSync === "function") {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM updates;");
        this.ctx.storage.sql.exec(
          "INSERT INTO updates (update_data, created_at) VALUES (?, ?);",
          snapshotBuffer,
          now,
        );
      });
    } else {
      this.ctx.storage.sql.exec("BEGIN;");
      try {
        this.ctx.storage.sql.exec("DELETE FROM updates;");
        this.ctx.storage.sql.exec(
          "INSERT INTO updates (update_data, created_at) VALUES (?, ?);",
          snapshotBuffer,
          now,
        );
        this.ctx.storage.sql.exec("COMMIT;");
      } catch (err) {
        this.ctx.storage.sql.exec("ROLLBACK;");
        throw err;
      }
    }
  }

  private sendRaw(ws: WebSocket, data: ArrayBuffer | Uint8Array): void {
    try {
      ws.send(data);
    } catch {
      /* socket gone */
    }
  }

  private jsonResponse(
    data: unknown,
    status: number,
    origin: string | null,
  ): Response {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Vary: "Origin",
    };
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    return new Response(JSON.stringify(data), { status, headers });
  }

  private textResponse(
    text: string,
    status: number,
    origin: string | null,
  ): Response {
    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      Vary: "Origin",
    };
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    return new Response(text, { status, headers });
  }
}
