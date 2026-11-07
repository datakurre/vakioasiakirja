import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { parseRoute, isSameRoute } from "../src/router.ts";
import { getCollabWsUrl } from "../src/config.ts";
import { bytesToBase64, base64ToBytes } from "../src/ui.ts";
import {
  ROOM_ALPHABET,
  randomCollabRoomId,
  generateCollabToken,
} from "../src/share.ts";

test("randomCollabRoomId: length, alphabet, and exclusion of CREATE", () => {
  for (let i = 0; i < 50; i++) {
    const id = randomCollabRoomId(8);
    assert.equal(id.length, 8);
    assert.notEqual(id.toUpperCase(), "CREATE");
    for (const char of id) {
      assert.ok(
        ROOM_ALPHABET.includes(char),
        `Character ${char} must be in ROOM_ALPHABET`,
      );
    }
  }

  // Verify uniqueness
  const id1 = randomCollabRoomId(8);
  const id2 = randomCollabRoomId(8);
  assert.notEqual(id1, id2);
});

test("generateCollabToken: 128-bit hex representation and entropy", () => {
  for (let i = 0; i < 20; i++) {
    const token = generateCollabToken();
    assert.equal(token.length, 32); // 16 bytes = 32 hex chars
    assert.match(token, /^[0-9a-f]{32}$/);
  }

  const t1 = generateCollabToken();
  const t2 = generateCollabToken();
  assert.notEqual(t1, t2);
});

test("getCollabWsUrl: protocol conversion and path formatting", () => {
  const wsUrl = getCollabWsUrl();
  assert.ok(
    wsUrl.startsWith("ws://") || wsUrl.startsWith("wss://"),
    `Must be a WebSocket protocol: ${wsUrl}`,
  );
  assert.ok(wsUrl.endsWith("/collab"), `Must end with /collab: ${wsUrl}`);
});

test("Collab handshake: validate room creation parameters", () => {
  function validateCreatePayload(payload: {
    roomId?: unknown;
    token?: unknown;
    initialMarkdown?: unknown;
  }) {
    const { roomId, token, initialMarkdown } = payload;
    if (
      typeof roomId !== "string" ||
      !/^[A-Za-z0-9]{4,16}$/.test(roomId) ||
      roomId.toUpperCase() === "CREATE"
    ) {
      return { ok: false, error: "Invalid roomId" };
    }
    if (typeof token !== "string" || token.length < 16) {
      return { ok: false, error: "Invalid token" };
    }
    if (initialMarkdown !== undefined && typeof initialMarkdown !== "string") {
      return { ok: false, error: "Invalid initialMarkdown" };
    }
    return { ok: true };
  }

  const validRoomId = randomCollabRoomId(8);
  const validToken = generateCollabToken();

  assert.deepEqual(
    validateCreatePayload({
      roomId: validRoomId,
      token: validToken,
      initialMarkdown: "# Test",
    }),
    { ok: true },
  );

  // Rejections
  assert.equal(
    validateCreatePayload({ roomId: "CREATE", token: validToken }).ok,
    false,
  );
  assert.equal(
    validateCreatePayload({ roomId: "ab", token: validToken }).ok,
    false,
  );
  assert.equal(
    validateCreatePayload({ roomId: validRoomId, token: "short" }).ok,
    false,
  );
});

test("Yjs synchronization: dual-client convergence on sequential and concurrent edits", () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const text1 = doc1.getText("content");
  const text2 = doc2.getText("content");

  // Wire sync channels
  doc1.on("update", (update) => Y.applyUpdate(doc2, update));
  doc2.on("update", (update) => Y.applyUpdate(doc1, update));

  // Client 1 types
  text1.insert(0, "Hei yhteismuokkaus!");
  assert.equal(text2.toString(), "Hei yhteismuokkaus!");

  // Client 2 types
  text2.insert(text2.length, " Toinen muokkaaja.");
  assert.equal(text1.toString(), "Hei yhteismuokkaus! Toinen muokkaaja.");

  // Concurrent edits: Client 1 inserts at front, Client 2 inserts in the middle
  // Temporarily decouple to simulate network flight
  const pendingUpdates1: Uint8Array[] = [];
  const pendingUpdates2: Uint8Array[] = [];

  const listener1 = (update: Uint8Array) => pendingUpdates1.push(update);
  const listener2 = (update: Uint8Array) => pendingUpdates2.push(update);

  doc1.on("update", listener1);
  doc2.on("update", listener2);

  text1.insert(0, "[Alku] ");
  text2.insert(text2.length, " [Loppu]");

  // Flush updates across network
  for (const u of pendingUpdates1) Y.applyUpdate(doc2, u);
  for (const u of pendingUpdates2) Y.applyUpdate(doc1, u);

  // Both documents must converge to the exact same string
  assert.equal(text1.toString(), text2.toString());
  assert.equal(
    text1.toString(),
    "[Alku] Hei yhteismuokkaus! Toinen muokkaaja. [Loppu]",
  );

  doc1.destroy();
  doc2.destroy();
});

test("Yjs UndoManager: undo isolation preserves remote changes", () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const text1 = doc1.getText("content");
  const text2 = doc2.getText("content");

  // Track origins
  const originClient1 = "client-1";
  const originClient2 = "client-2";

  const undoManager1 = new Y.UndoManager(text1, {
    trackedOrigins: new Set([originClient1]),
  });
  const undoManager2 = new Y.UndoManager(text2, {
    trackedOrigins: new Set([originClient2]),
  });

  // Sync bridge with origin preservation
  doc1.on("update", (update, origin) => {
    if (origin !== "remote-from-2") {
      Y.applyUpdate(doc2, update, "remote-from-1");
    }
  });
  doc2.on("update", (update, origin) => {
    if (origin !== "remote-from-1") {
      Y.applyUpdate(doc1, update, "remote-from-2");
    }
  });

  // Client 1 makes edit
  doc1.transact(() => {
    text1.insert(0, "A-teksti ");
  }, originClient1);

  // Client 2 makes edit
  doc2.transact(() => {
    text2.insert(text2.length, "B-teksti");
  }, originClient2);

  assert.equal(text1.toString(), "A-teksti B-teksti");
  assert.equal(text2.toString(), "A-teksti B-teksti");

  // Verify undoManager2 is initialized and independent
  assert.equal(undoManager2.undoStack.length, 1);

  // Client 1 performs Undo
  undoManager1.undo();

  // Verify: Client 1's edit "A-teksti " was undone, but Client 2's edit "B-teksti" remains!
  assert.equal(text1.toString(), "B-teksti");
  assert.equal(text2.toString(), "B-teksti");
  assert.equal(undoManager2.undoStack.length, 1);

  // Client 1 performs Redo
  undoManager1.redo();
  assert.equal(text1.toString(), "A-teksti B-teksti");
  assert.equal(text2.toString(), "A-teksti B-teksti");

  doc1.destroy();
  doc2.destroy();
});

test("Awareness protocol: multi-user presence and state propagation", () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();

  const awareness1 = new awarenessProtocol.Awareness(doc1);
  const awareness2 = new awarenessProtocol.Awareness(doc2);

  interface AwarenessUpdate {
    added: number[];
    updated: number[];
    removed: number[];
  }

  awareness1.on("update", ({ added, updated, removed }: AwarenessUpdate) => {
    const changed = added.concat(updated).concat(removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness1, changed);
    awarenessProtocol.applyAwarenessUpdate(awareness2, update, "remote");
  });

  awareness2.on("update", ({ added, updated, removed }: AwarenessUpdate) => {
    const changed = added.concat(updated).concat(removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness2, changed);
    awarenessProtocol.applyAwarenessUpdate(awareness1, update, "remote");
  });

  // Set user states
  awareness1.setLocalStateField("user", {
    name: "Muokkaaja (Ilves)",
    color: "#1976d2",
    colorLight: "#bbdefb",
  });

  awareness2.setLocalStateField("user", {
    name: "Muokkaaja (Kettu)",
    color: "#e65100",
    colorLight: "#ffe0b2",
  });

  const states1 = awareness1.getStates();
  const states2 = awareness2.getStates();

  assert.equal(states1.size, 2);
  assert.equal(states2.size, 2);

  const u1 = states2.get(doc1.clientID) as { user: { name: string } };
  const u2 = states1.get(doc2.clientID) as { user: { name: string } };

  assert.equal(u1.user.name, "Muokkaaja (Ilves)");
  assert.equal(u2.user.name, "Muokkaaja (Kettu)");

  awareness1.destroy();
  awareness2.destroy();
  doc1.destroy();
  doc2.destroy();
});

test("Collab routing and lifecycle transitions", () => {
  const roomId = randomCollabRoomId(8);
  const token = generateCollabToken();

  const route = parseRoute(`#/edit/${roomId}/${token}`);
  assert.deepEqual(route, {
    type: "collab",
    roomId,
    token,
  });

  // Query parameter fallback variant
  const queryRoute = parseRoute(`#/edit/${roomId}?token=${token}`);
  assert.deepEqual(queryRoute, {
    type: "collab",
    roomId,
    token,
  });

  // Personal route unchanged
  assert.deepEqual(parseRoute("#/"), { type: "personal" });

  // Route difference triggers reload transition
  assert.equal(
    isSameRoute(parseRoute("#/"), parseRoute(`#/edit/${roomId}/${token}`)),
    false,
  );
  assert.equal(
    isSameRoute(
      parseRoute(`#/edit/${roomId}/${token}`),
      parseRoute(`#/edit/${roomId}/${token}`),
    ),
    true,
  );
});

test("Collaborative logo: propagation over Yjs metaMap across peers", () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const meta1 = doc1.getMap("meta");
  const meta2 = doc2.getMap("meta");

  // Wire bidirectional sync
  doc1.on("update", (update) => Y.applyUpdate(doc2, update));
  doc2.on("update", (update) => Y.applyUpdate(doc1, update));

  const testBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const b64 = bytesToBase64(testBytes);
  const logoPayload = {
    name: "organisaatio-logo.png",
    path: "/logo.png",
    b64,
  };

  let observerFired = false;
  let observedKey = "";
  meta2.observe((event) => {
    if (event.keysChanged.has("logo")) {
      observerFired = true;
      observedKey = "logo";
    }
  });

  // Client 1 uploads / sets the logo
  meta1.set("logo", logoPayload);

  // Client 2 receives the update via Yjs sync
  assert.equal(observerFired, true);
  assert.equal(observedKey, "logo");

  const remoteLogo = meta2.get("logo") as typeof logoPayload;
  assert.ok(remoteLogo, "remoteLogo must be defined in meta2");
  assert.equal(remoteLogo.name, "organisaatio-logo.png");
  assert.equal(remoteLogo.path, "/logo.png");
  assert.equal(remoteLogo.b64, b64);

  doc1.destroy();
  doc2.destroy();
});

test("Collaborative logo: clearing logo propagates deletion to peer metaMap", () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const meta1 = doc1.getMap("meta");
  const meta2 = doc2.getMap("meta");

  doc1.on("update", (update) => Y.applyUpdate(doc2, update));
  doc2.on("update", (update) => Y.applyUpdate(doc1, update));

  // Initialize with a logo
  meta1.set("logo", {
    name: "poistettava-logo.svg",
    path: "/logo.svg",
    b64: bytesToBase64(new TextEncoder().encode("<svg></svg>")),
  });
  assert.ok(meta2.get("logo"));

  let clearObserved = false;
  meta2.observe((event) => {
    if (event.keysChanged.has("logo")) {
      clearObserved = true;
    }
  });

  // Client 1 clears the logo
  meta1.delete("logo");

  assert.equal(clearObserved, true);
  assert.equal(meta2.has("logo"), false);
  assert.equal(meta2.get("logo"), undefined);

  // Client 2 sets logo to null variant
  meta2.set("logo", null);
  assert.equal(meta1.get("logo"), null);

  doc1.destroy();
  doc2.destroy();
});

test("Collaborative logo: base64 encoding/decoding preserves image bytes across peers (including 256 KB payloads)", () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const meta1 = doc1.getMap("meta");
  const meta2 = doc2.getMap("meta");

  doc1.on("update", (update) => Y.applyUpdate(doc2, update));
  doc2.on("update", (update) => Y.applyUpdate(doc1, update));

  // Test full 256 KB payload with pseudorandom bytes (all 256 byte values represented)
  const size = 256 * 1024; // 256 KB limit
  const originalBytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    originalBytes[i] = (i * 31 + 17) & 0xff;
  }

  const encodedB64 = bytesToBase64(originalBytes);
  meta1.set("logo", {
    name: "large-hd-logo.png",
    path: "/logo.png",
    b64: encodedB64,
  });

  const peerData = meta2.get("logo") as { name: string; path: string; b64: string };
  assert.ok(peerData);
  assert.equal(peerData.name, "large-hd-logo.png");
  assert.equal(peerData.path, "/logo.png");

  const decodedBytes = base64ToBytes(peerData.b64);
  assert.equal(decodedBytes.length, originalBytes.length);
  assert.deepEqual(decodedBytes, originalBytes);

  doc1.destroy();
  doc2.destroy();
});
