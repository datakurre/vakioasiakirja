// One Durable Object per room. It is a pure signaling relay: it forwards SDP
// offers/answers and ICE candidates between the single broadcaster and each
// viewer, tracks the viewer count, and closes idle rooms. It never sees
// document content — that flows over the peers' WebRTC data channels.
//
// State lives entirely in the connected sockets (reconstructed from the
// hibernation API on each event), so the object survives hibernation without
// any stored data: the broadcaster is the socket tagged "broadcaster", viewers
// are tagged "viewer", and each viewer's id rides in its socket attachment.

import { DurableObject } from "cloudflare:workers";
import { isAllowedOrigin, type Env } from "./index.ts";

interface Attachment {
  role: "broadcaster" | "viewer";
  viewerId?: string;
}

// Close an orphaned room after this much inactivity without a broadcaster.
const ORPHAN_IDLE_MS = 15 * 60 * 1000;

// Maximum allowed WebSocket message length (64 KB).
const MAX_MESSAGE_SIZE = 64 * 1024;

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isValidViewerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 64;
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  override async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (!isAllowedOrigin(origin, this.env)) {
      return new Response("Forbidden origin", { status: 403 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const role =
      new URL(request.url).searchParams.get("role") === "broadcaster"
        ? "broadcaster"
        : "viewer";

    if (role === "broadcaster") {
      const active = this.broadcaster();
      if (active && active.readyState === WebSocket.OPEN) {
        return new Response("Broadcaster already connected", { status: 409 });
      }
      for (const old of this.ctx.getWebSockets("broadcaster")) {
        this.tryClose(old, 1000, "replaced");
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);

    const att: Attachment =
      role === "broadcaster"
        ? { role: "broadcaster" }
        : { role: "viewer", viewerId: crypto.randomUUID().slice(0, 8) };
    server.serializeAttachment(att);

    if (role === "broadcaster") {
      // Re-offer to viewers still connected, so a reconnecting broadcaster
      // rebuilds its peers.
      for (const vs of this.ctx.getWebSockets("viewer")) {
        const va = vs.deserializeAttachment() as Attachment | null;
        if (va?.viewerId) this.send(server, { type: "viewer_join", viewerId: va.viewerId });
      }
      this.send(server, { type: "viewers", count: this.viewerIds().size });
      // Clear any orphan idle alarm while an active broadcaster is connected.
      await this.ctx.storage.deleteAlarm();
    } else {
      const bc = this.broadcaster();
      if (bc) {
        this.send(bc, { type: "viewer_join", viewerId: att.viewerId! });
        // The just-accepted socket may not be enumerable yet, so count it in
        // explicitly (adding to a Set is idempotent where it already appears).
        const ids = this.viewerIds();
        ids.add(att.viewerId!);
        this.send(bc, { type: "viewers", count: ids.size });
      } else {
        // Viewer connected before a broadcaster: schedule orphan idle alarm.
        await this.scheduleOrphanAlarm();
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_MESSAGE_SIZE) {
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (!isRecord(msg) || typeof msg.type !== "string") {
      return;
    }

    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;

    if (att.role === "broadcaster") {
      const viewerId = msg.viewerId;
      if (
        msg.type === "offer" &&
        isValidViewerId(viewerId) &&
        isRecord(msg.offer)
      ) {
        const vs = this.viewerById(viewerId);
        if (vs) this.send(vs, { type: "offer", offer: msg.offer });
      } else if (
        msg.type === "candidate" &&
        isValidViewerId(viewerId) &&
        isRecord(msg.candidate)
      ) {
        const vs = this.viewerById(viewerId);
        if (vs) this.send(vs, { type: "candidate", candidate: msg.candidate });
      } else if (msg.type === "close") {
        // Explicit end of broadcast: tell viewers and drop them.
        for (const vs of this.ctx.getWebSockets("viewer")) {
          this.send(vs, { type: "closed" });
          this.tryClose(vs, 1000, "broadcaster closed");
        }
        await this.ctx.storage.deleteAlarm();
      }
    } else {
      // Viewer → broadcaster: tag with our viewerId so the broadcaster can
      // address the right peer connection.
      const bc = this.broadcaster();
      if (!bc) return;
      if (msg.type === "answer" && isRecord(msg.answer)) {
        this.send(bc, { type: "answer", viewerId: att.viewerId, answer: msg.answer });
      } else if (msg.type === "candidate" && isRecord(msg.candidate)) {
        this.send(bc, { type: "candidate", viewerId: att.viewerId, candidate: msg.candidate });
      }
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att?.role === "viewer") {
      const bc = this.broadcaster();
      if (bc) {
        this.send(bc, { type: "viewer_leave", viewerId: att.viewerId });
        // Exclude the closing socket by id (it may still be enumerable, and is
        // not reliably identity-equal to the handler's `ws`).
        const ids = this.viewerIds();
        if (att.viewerId) ids.delete(att.viewerId);
        this.send(bc, { type: "viewers", count: ids.size });
      } else {
        const ids = this.viewerIds();
        if (att.viewerId) ids.delete(att.viewerId);
        if (ids.size === 0) {
          await this.ctx.storage.deleteAlarm();
        }
      }
    } else if (att?.role === "broadcaster") {
      // Broadcaster signaling drop is intentionally NOT broadcast as "closed":
      // established data channels survive it (DTLS is peer-to-peer) and the
      // broadcaster may reconnect to the same room.
      // If viewers remain without a broadcaster, schedule an orphan idle alarm.
      if (this.viewerIds().size > 0) {
        await this.scheduleOrphanAlarm();
      } else {
        await this.ctx.storage.deleteAlarm();
      }
    }
  }

  override async webSocketError(
    _ws: WebSocket,
    _error: unknown,
  ): Promise<void> {
    /* webSocketClose handles cleanup */
  }

  override async alarm(): Promise<void> {
    // If a broadcaster is connected, do not close the room.
    if (this.broadcaster()) {
      return;
    }
    for (const ws of this.ctx.getWebSockets()) {
      this.tryClose(ws, 1001, "idle timeout");
    }
  }

  // --- helpers ---
  private broadcaster(): WebSocket | undefined {
    return this.ctx
      .getWebSockets("broadcaster")
      .find((w) => w.readyState === WebSocket.OPEN);
  }

  private viewerById(id: string): WebSocket | undefined {
    return this.ctx
      .getWebSockets("viewer")
      .find((w) => (w.deserializeAttachment() as Attachment | null)?.viewerId === id);
  }

  // The set of connected viewer ids (read from socket attachments). Reference-
  // and timing-independent, so it is reliable from connect/close handlers and
  // survives hibernation.
  private viewerIds(): Set<string> {
    const ids = new Set<string>();
    for (const w of this.ctx.getWebSockets("viewer")) {
      const id = (w.deserializeAttachment() as Attachment | null)?.viewerId;
      if (id) ids.add(id);
    }
    return ids;
  }

  private send(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket gone */
    }
  }

  private tryClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closing */
    }
  }

  private async scheduleOrphanAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) {
      await this.ctx.storage.setAlarm(Date.now() + ORPHAN_IDLE_MS);
    }
  }
}
