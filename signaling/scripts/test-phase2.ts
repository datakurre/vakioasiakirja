// Comprehensive integration test suite for Phase 2:
// Tests CollabRoom Durable Object, routing, validation, CORS, token auth,
// Yjs synchronization, awareness relay, update persistence, compaction,
// and verification that existing WebRTC Room signaling remains unaffected.

import * as Y from "yjs";
import * as sync from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { spawn, type ChildProcess } from "node:child_process";

const BASE_URL = process.env.BASE_URL || "http://localhost:8788";
const WS_BASE_URL = BASE_URL.replace(/^http/, "ws");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    failed++;
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  PASS: ${msg}`);
  passed++;
}

async function testCorsAndValidation(): Promise<void> {
  console.log("\n--- 1. Testing CORS Preflight & Input Validation ---");

  // OPTIONS preflight
  const preflight = await fetch(`${BASE_URL}/collab/create`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });
  assert(preflight.status === 204, `OPTIONS returned status 204 (got ${preflight.status})`);
  const allowMethods = preflight.headers.get("Access-Control-Allow-Methods") || "";
  assert(allowMethods.includes("POST"), `Access-Control-Allow-Methods includes POST (${allowMethods})`);
  assert(
    preflight.headers.get("Access-Control-Allow-Origin") === "http://localhost:5173",
    "Access-Control-Allow-Origin matches request origin",
  );

  // Forbidden origin
  const forbidden = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: {
      Origin: "https://malicious-site.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roomId: "TEST1234", token: "0123456789abcdef0123456789abcdef" }),
  });
  assert(forbidden.status === 403, `Forbidden origin returned 403 (got ${forbidden.status})`);

  // Invalid JSON
  const invalidJson = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "invalid-json",
  });
  assert(invalidJson.status === 400, `Invalid JSON returned 400 (got ${invalidJson.status})`);

  // Short token (< 16 chars)
  const shortToken = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: "TEST1234", token: "tooshort" }),
  });
  assert(shortToken.status === 400, `Short token returned 400 (got ${shortToken.status})`);

  // Invalid roomId format
  const invalidRoom = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: "bad-room!", token: "0123456789abcdef0123456789abcdef" }),
  });
  assert(invalidRoom.status === 400, `Invalid roomId format returned 400 (got ${invalidRoom.status})`);

  // Reserved roomId "CREATE"
  const reservedRoom = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: "CREATE", token: "0123456789abcdef0123456789abcdef" }),
  });
  assert(reservedRoom.status === 400, `Reserved roomId CREATE returned 400 (got ${reservedRoom.status})`);

  // initialMarkdown > 512 KB
  const oversizedText = "x".repeat(513 * 1024);
  const oversizedReq = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: "TESTBIG1",
      token: "0123456789abcdef0123456789abcdef",
      initialMarkdown: oversizedText,
    }),
  });
  assert(oversizedReq.status === 400, `Oversized markdown returned 400 (got ${oversizedReq.status})`);
}

async function testRoomCreationAndAuth(): Promise<{ roomId: string; token: string }> {
  console.log("\n--- 2. Testing Room Creation & Capability Token Auth ---");

  const roomId = "ROOM" + Math.random().toString(36).substring(2, 8).toUpperCase();
  const token = "sec_" + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  const initialMarkdown = "# SFS 2487 Kokouspöytäkirja\n\n1. Kokouksen avaus";

  // Create room
  const createRes = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ roomId, token, initialMarkdown }),
  });
  assert(createRes.status === 200, `Room creation returned 200 (got ${createRes.status})`);
  const createData = (await createRes.json()) as { ok: boolean; roomId: string };
  assert(createData.ok === true && createData.roomId === roomId, "Response body contains ok:true and roomId");

  // Conflict on duplicate create
  const dupRes = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, token, initialMarkdown }),
  });
  assert(dupRes.status === 409, `Duplicate room creation returned 409 Conflict (got ${dupRes.status})`);

  // Non-websocket request returns 426
  const noUpgradeRes = await fetch(`${BASE_URL}/collab/${roomId}`);
  assert(noUpgradeRes.status === 426, `Request without Upgrade header returned 426 Expected WebSocket (got ${noUpgradeRes.status})`);

  // Connect to non-existent room via WebSocket (should reject handshake)
  const nonExistentRejected = await expectWebSocketFailure(`${WS_BASE_URL}/collab/NOROOM?token=${token}`);
  assert(nonExistentRejected, "Non-existent room WebSocket connection was rejected (404)");

  // Connect without token via WebSocket (should reject handshake)
  const noTokenRejected = await expectWebSocketFailure(`${WS_BASE_URL}/collab/${roomId}`);
  assert(noTokenRejected, "WebSocket connection without token was rejected (401)");

  // Connect with wrong token via WebSocket (should reject handshake)
  const wrongTokenRejected = await expectWebSocketFailure(`${WS_BASE_URL}/collab/${roomId}?token=wrong_token_123456789`);
  assert(wrongTokenRejected, "WebSocket connection with wrong token was rejected (401)");

  return { roomId, token };
}

function expectWebSocketFailure(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let resolved = false;
    ws.onopen = () => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(false);
      }
    };
    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    };
    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    };
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(true);
      }
    }, 2000);
  });
}

// Minimal Yjs WebSocket client for testing protocol exchange
class TestCollabClient {
  public ws: WebSocket;
  public doc: Y.Doc;
  public awarenessReceived: Uint8Array[] = [];
  public connected: Promise<void>;
  private resolveConnected!: () => void;
  private rejectConnected!: (err: Error) => void;

  constructor(url: string) {
    this.doc = new Y.Doc();
    this.connected = new Promise((resolve, reject) => {
      this.resolveConnected = resolve;
      this.rejectConnected = reject;
    });

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      // Send client sync step 1
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // messageSync
      sync.writeSyncStep1(encoder, this.doc);
      this.ws.send(encoding.toUint8Array(encoder));
    };

    this.ws.onerror = (err) => {
      this.rejectConnected(new Error("WebSocket error"));
    };

    this.ws.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      const decoder = decoding.createDecoder(bytes);
      const msgType = decoding.readVarUint(decoder);

      if (msgType === 0) {
        // Sync message
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, 0);
        sync.readSyncMessage(decoder, replyEncoder, this.doc, this);
        if (encoding.length(replyEncoder) > 1) {
          this.ws.send(encoding.toUint8Array(replyEncoder));
        }
        this.resolveConnected();
      } else if (msgType === 1) {
        // Awareness message
        this.awarenessReceived.push(bytes);
      }
    };
  }

  public sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // messageSync
    sync.writeUpdate(encoder, update);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  public sendAwareness(payload: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1); // messageAwareness
    encoding.writeUint8Array(encoder, payload);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  public close(): void {
    this.ws.close();
  }
}

async function testSyncAndAwareness(roomId: string, token: string): Promise<void> {
  console.log("\n--- 3. Testing Yjs Document Sync, Edits & Awareness Relay ---");

  const wsUrl = `${WS_BASE_URL}/collab/${roomId}?token=${token}`;

  // Client 1 connects and receives initial state
  const client1 = new TestCollabClient(wsUrl);
  await client1.connected;
  // Give a small grace period for the initial sync step handshake to complete
  await new Promise((r) => setTimeout(r, 200));

  const content1 = client1.doc.getText("content").toString();
  assert(
    content1 === "# SFS 2487 Kokouspöytäkirja\n\n1. Kokouksen avaus",
    `Client 1 received initial state: "${content1.replace(/\n/g, "\\n")}"`,
  );

  // Client 2 connects to the same room
  const client2 = new TestCollabClient(wsUrl);
  await client2.connected;
  await new Promise((r) => setTimeout(r, 200));

  const content2 = client2.doc.getText("content").toString();
  assert(
    content2 === content1,
    "Client 2 synchronized with identical document content",
  );

  // Client 1 sends an edit
  client1.doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== client1) {
      client1.sendUpdate(update);
    }
  });

  client2.doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== client2) {
      client2.sendUpdate(update);
    }
  });

  // Client 1 inserts text
  client1.doc.getText("content").insert(content1.length, "\nPuheenjohtaja avasi kokouksen klo 10.00.");

  // Wait for client 2 to receive the update via WebSocket relay
  await new Promise((r) => setTimeout(r, 300));

  assert(
    client2.doc.getText("content").toString() === client1.doc.getText("content").toString(),
    "Client 2 converged with Client 1 edit",
  );

  // Client 2 inserts text concurrently
  client2.doc.getText("content").insert(0, "LUONNOS: ");
  await new Promise((r) => setTimeout(r, 300));

  assert(
    client1.doc.getText("content").toString() === client2.doc.getText("content").toString(),
    "Client 1 converged with Client 2 concurrent edit",
  );

  // Test Awareness relay
  const dummyAwareness = new Uint8Array([42, 99, 123]);
  client1.sendAwareness(dummyAwareness);
  await new Promise((r) => setTimeout(r, 300));

  assert(
    client2.awarenessReceived.length > 0,
    "Client 2 received relayed awareness message from Client 1",
  );

  client1.close();
  client2.close();
  await new Promise((r) => setTimeout(r, 300));
}

async function testPersistenceAndCompaction(roomId: string, token: string): Promise<void> {
  console.log("\n--- 4. Testing Update Compaction & Reconnection ---");

  const wsUrl = `${WS_BASE_URL}/collab/${roomId}?token=${token}`;
  const client = new TestCollabClient(wsUrl);
  await client.connected;
  await new Promise((r) => setTimeout(r, 200));

  client.doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== client) {
      client.sendUpdate(update);
    }
  });

  // Perform 55 incremental updates to trigger compaction threshold (> 50 updates)
  console.log("  Generating 55 incremental updates...");
  for (let i = 0; i < 55; i++) {
    client.doc.getText("content").insert(client.doc.getText("content").length, `\nItem ${i}`);
    await new Promise((r) => setTimeout(r, 20));
  }

  const expectedFinalText = client.doc.getText("content").toString();
  client.close();
  await new Promise((r) => setTimeout(r, 500));

  // Connect a fresh Client 3 after all sockets disconnected
  const client3 = new TestCollabClient(wsUrl);
  await client3.connected;
  await new Promise((r) => setTimeout(r, 300));

  const restoredText = client3.doc.getText("content").toString();
  assert(
    restoredText === expectedFinalText,
    "Client 3 successfully restored complete state after compaction and socket closure",
  );

  client3.close();
}

async function testWebRtcSignalingRegression(): Promise<void> {
  console.log("\n--- 5. Testing Existing WebRTC Signaling Regression (/turn-credentials & /room/:roomId) ---");

  // /turn-credentials
  const turnRes = await fetch(`${BASE_URL}/turn-credentials`);
  assert(turnRes.status === 200, `/turn-credentials returned 200 (got ${turnRes.status})`);
  const turnData = (await turnRes.json()) as { iceServers: unknown[] };
  assert(Array.isArray(turnData.iceServers) && turnData.iceServers.length > 0, "Default STUN servers returned");

  // Non-websocket request to /room/:roomId
  const roomReq = await fetch(`${BASE_URL}/room/REGRESS1`);
  assert(roomReq.status === 426, `/room/:roomId non-websocket request returned 426 Expected WebSocket (got ${roomReq.status})`);

  // Connect broadcaster to /room/:roomId
  const bcWs = new WebSocket(`${WS_BASE_URL}/room/REGRESS1?role=broadcaster`);
  const bcJoined = await new Promise<boolean>((resolve) => {
    bcWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string };
        if (msg.type === "viewers") resolve(true);
      } catch {}
    };
    bcWs.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 2000);
  });
  assert(bcJoined, "Broadcaster connected and received viewers notification from Room DO");
  bcWs.close();
}

async function testCapacityAndFrameLimits(): Promise<void> {
  console.log("\n--- 6. Testing Participant Limits (429) & WebSocket Frame Limits (256 KB) ---");

  const roomId = "LIMIT" + Math.random().toString(36).substring(2, 8).toUpperCase();
  const token = "sec_" + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

  // Create room
  const createRes = await fetch(`${BASE_URL}/collab/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, token, initialMarkdown: "# Limits test" }),
  });
  assert(createRes.status === 200, "Created room for limit testing");

  const wsUrl = `${WS_BASE_URL}/collab/${roomId}?token=${token}`;
  const clients: WebSocket[] = [];

  try {
    console.log("  Connecting 20 concurrent collaborators...");
    for (let i = 0; i < 20; i++) {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(e);
        setTimeout(() => reject(new Error("Timeout")), 3000);
      });
      clients.push(ws);
    }
    assert(clients.length === 20, "20 concurrent sockets connected successfully");

    // 21st connection must be rejected with 429
    console.log("  Attempting 21st concurrent connection (must be rejected with 429)...");
    const rejected21 = await expectWebSocketFailure(wsUrl);
    assert(rejected21, "21st concurrent WebSocket was rejected by server");

    // HTTP probe must return 429
    const probeFull = await fetch(`${BASE_URL}/collab/${roomId}?token=${token}`);
    assert(probeFull.status === 429, `HTTP probe returned 429 when room is full (got ${probeFull.status})`);

    // Frame size test: send > 256 KB binary frame on socket 0
    console.log("  Testing WebSocket frame limit (> 256 KB)...");
    const oversizedFrame = new Uint8Array(257 * 1024);
    const ws0ClosedPromise = new Promise<{ code: number; reason: string }>((resolve) => {
      clients[0].onclose = (ev) => resolve({ code: ev.code, reason: ev.reason });
      setTimeout(() => resolve({ code: -1, reason: "timeout" }), 3000);
    });
    clients[0].send(oversizedFrame);
    const closeEv = await ws0ClosedPromise;
    assert(closeEv.code === 1009 || closeEv.code > 1000, `Oversized frame closed socket (got code ${closeEv.code})`);

    // Remove clients[0]
    clients.shift();

    // Now 19 sockets connected: probe should return 200
    await new Promise((r) => setTimeout(r, 200));
    const probeAfterDrop = await fetch(`${BASE_URL}/collab/${roomId}?token=${token}`);
    assert(
      probeAfterDrop.status === 200,
      `HTTP probe returned 200 after connection dropped below capacity (got ${probeAfterDrop.status})`,
    );
  } finally {
    for (const ws of clients) {
      try {
        ws.close();
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function testCollabDisabledSwitch(): Promise<void> {
  console.log("\n--- 7. Testing COLLAB_ENABLED=false Kill Switch (HTTP 503) ---");

  const disabledUrl = "http://127.0.0.1:8789";
  const disabledWsUrl = "ws://127.0.0.1:8789";

  const proc = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      "8789",
      "--ip",
      "127.0.0.1",
      "--var",
      "COLLAB_ENABLED:false",
    ],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      detached: false,
    },
  );

  try {
    const start = Date.now();
    let up = false;
    while (Date.now() - start < 15000) {
      try {
        const r = await fetch(`${disabledUrl}/turn-credentials`);
        if (r.status === 200) {
          up = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    assert(up, "Worker with COLLAB_ENABLED=false booted on port 8789");

    // POST /collab/create must return 503
    const createRes = await fetch(`${disabledUrl}/collab/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: "TESTDIS1",
        token: "0123456789abcdef0123456789abcdef",
      }),
    });
    assert(
      createRes.status === 503,
      `POST /collab/create returned 503 (got ${createRes.status})`,
    );
    const createData = (await createRes.json()) as { error: string };
    assert(
      createData.error.toLowerCase().includes("disabled"),
      `Response body explains service is disabled: "${createData.error}"`,
    );

    // GET /collab/:roomId must return 503
    const getRes = await fetch(
      `${disabledUrl}/collab/TESTDIS1?token=0123456789abcdef0123456789abcdef`,
    );
    assert(getRes.status === 503, `GET /collab/:roomId returned 503 (got ${getRes.status})`);

    // WebSocket handshake to /collab/:roomId must be rejected
    const wsRejected = await expectWebSocketFailure(
      `${disabledWsUrl}/collab/TESTDIS1?token=0123456789abcdef0123456789abcdef`,
    );
    assert(wsRejected, "WebSocket connection was rejected when COLLAB_ENABLED=false (503)");

    // Existing WebRTC endpoints remain functional
    const turnRes = await fetch(`${disabledUrl}/turn-credentials`);
    assert(turnRes.status === 200, "WebRTC /turn-credentials unaffected by COLLAB_ENABLED=false");
  } finally {
    proc.kill("SIGTERM");
  }
}

async function isServerUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/turn-credentials`);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  let wranglerProc: ChildProcess | null = null;

  if (!(await isServerUp(BASE_URL))) {
    console.log(`No server detected at ${BASE_URL}. Launching local wrangler dev...`);
    wranglerProc = spawn("npx", ["wrangler", "dev", "--port", "8788", "--ip", "127.0.0.1"], {
      cwd: process.cwd(),
      stdio: "ignore",
      detached: false,
    });

    const start = Date.now();
    while (Date.now() - start < 15000) {
      if (await isServerUp(BASE_URL)) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!(await isServerUp(BASE_URL))) {
      if (wranglerProc) wranglerProc.kill();
      throw new Error(`Failed to start wrangler dev on ${BASE_URL} within 15 seconds`);
    }
  }

  console.log("Starting Phase 2 Integration Tests against " + BASE_URL);
  try {
    await testCorsAndValidation();
    const { roomId, token } = await testRoomCreationAndAuth();
    await testSyncAndAwareness(roomId, token);
    await testPersistenceAndCompaction(roomId, token);
    await testWebRtcSignalingRegression();
    await testCapacityAndFrameLimits();
    await testCollabDisabledSwitch();

    console.log(`\n========================================`);
    console.log(`ALL TESTS PASSED! (${passed} passed, ${failed} failed)`);
    console.log(`========================================\n`);
    if (wranglerProc) {
      wranglerProc.kill("SIGTERM");
    }
    process.exit(0);
  } catch (err) {
    if (wranglerProc) {
      wranglerProc.kill("SIGTERM");
    }
    console.error(`\nTest suite failed:`, err);
    console.log(`Summary: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
}

run();
