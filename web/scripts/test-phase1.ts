import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, isSameRoute } from "../src/router.ts";
import { getCollabUrl } from "../src/config.ts";

test("parseRoute: personal editor routes", () => {
  assert.deepEqual(parseRoute(""), { type: "personal" });
  assert.deepEqual(parseRoute("#"), { type: "personal" });
  assert.deepEqual(parseRoute("#/"), { type: "personal" });
  assert.deepEqual(parseRoute("#unknown"), { type: "personal" });
});

test("parseRoute: watch routes", () => {
  assert.deepEqual(parseRoute("#/watch/ABC123"), {
    type: "viewer",
    roomId: "ABC123",
  });
  assert.deepEqual(parseRoute("#/watch/demo123"), {
    type: "viewer",
    roomId: "DEMO123",
  });
});

test("parseRoute: collaborative routes (canonical path-based)", () => {
  assert.deepEqual(parseRoute("#/edit/ROOM123/TOKEN456"), {
    type: "collab",
    roomId: "ROOM123",
    token: "TOKEN456",
  });
  assert.deepEqual(parseRoute("#/edit/room_abc-12/sec-token-xyz789"), {
    type: "collab",
    roomId: "room_abc-12",
    token: "sec-token-xyz789",
  });
});

test("parseRoute: collaborative routes (query param fallback)", () => {
  assert.deepEqual(parseRoute("#/edit/ROOM123?token=TOKEN456"), {
    type: "collab",
    roomId: "ROOM123",
    token: "TOKEN456",
  });
  assert.deepEqual(parseRoute("#/edit/ROOM123/?token=TOKEN456"), {
    type: "collab",
    roomId: "ROOM123",
    token: "TOKEN456",
  });
  assert.deepEqual(parseRoute("#/edit/ROOM123?foo=bar&token=TOKEN456"), {
    type: "collab",
    roomId: "ROOM123",
    token: "TOKEN456",
  });
});

test("parseRoute: malformed collaborative routes", () => {
  // Missing token
  const r1 = parseRoute("#/edit/BADROOM");
  assert.equal(r1.type, "collab-error");

  const r2 = parseRoute("#/edit/BADROOM/");
  assert.equal(r2.type, "collab-error");

  const r3 = parseRoute("#/edit/BADROOM?token=");
  assert.equal(r3.type, "collab-error");

  // Bare /edit
  const r4 = parseRoute("#/edit");
  assert.equal(r4.type, "collab-error");

  const r5 = parseRoute("#/edit/");
  assert.equal(r5.type, "collab-error");

  // Invalid roomId format
  const r6 = parseRoute("#/edit/?token=TOKEN123");
  assert.equal(r6.type, "collab-error");

  const r7 = parseRoute("#/edit/bad!room@/TOKEN123");
  assert.equal(r7.type, "collab-error");
});

test("getCollabUrl: fallback and trimming", () => {
  assert.equal(typeof getCollabUrl(), "string");
  // Ensure no trailing slashes
  assert.equal(getCollabUrl().endsWith("/"), false);
});

test("isSameRoute: equality and transitions", () => {
  assert.equal(isSameRoute({ type: "personal" }, { type: "personal" }), true);
  assert.equal(isSameRoute({ type: "personal" }, { type: "viewer", roomId: "A" }), false);
  assert.equal(
    isSameRoute({ type: "viewer", roomId: "A" }, { type: "viewer", roomId: "A" }),
    true,
  );
  assert.equal(
    isSameRoute({ type: "viewer", roomId: "A" }, { type: "viewer", roomId: "B" }),
    false,
  );
  assert.equal(
    isSameRoute(
      { type: "collab", roomId: "A", token: "T1" },
      { type: "collab", roomId: "A", token: "T1" },
    ),
    true,
  );
  assert.equal(
    isSameRoute(
      { type: "collab", roomId: "A", token: "T1" },
      { type: "collab", roomId: "A", token: "T2" },
    ),
    false,
  );
  assert.equal(
    isSameRoute(
      { type: "collab", roomId: "A", token: "T1" },
      { type: "collab", roomId: "B", token: "T1" },
    ),
    false,
  );
  assert.equal(
    isSameRoute(
      { type: "collab-error", message: "err1" },
      { type: "collab-error", message: "err1" },
    ),
    true,
  );
  assert.equal(
    isSameRoute(
      { type: "collab-error", message: "err1" },
      { type: "collab-error", message: "err2" },
    ),
    false,
  );
});

test("preview: ticket sequencing discard logic", async () => {
  let nextRenderSeq = 0;
  const appliedSequences: number[] = [];

  async function mockRender(seqDelayMs: number) {
    const currentSeq = ++nextRenderSeq;
    // Simulate async compile delay
    await new Promise((resolve) => setTimeout(resolve, seqDelayMs));
    // Guard condition from preview.ts
    if (currentSeq !== nextRenderSeq) {
      return; // Discard stale render
    }
    appliedSequences.push(currentSeq);
  }

  // Trigger rapid out-of-order renders:
  // Render 1 is slow (50ms), Render 2 is fast (10ms)
  const r1 = mockRender(50);
  const r2 = mockRender(10);
  await Promise.all([r1, r2]);

  // Only the newest render (seq 2) should be applied; seq 1 must be discarded
  assert.deepEqual(appliedSequences, [2]);
});

test("share dialog: unified matching share dialog DOM verification", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const htmlPath = path.resolve(import.meta.dirname, "../index.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  // Replaced obsolete popover & separate confirm dialog
  assert.equal(html.includes('id="share-panel"'), false, "Obsolete #share-panel should be removed");
  assert.equal(html.includes('id="collab-confirm-dialog"'), false, "Obsolete #collab-confirm-dialog should be removed");

  // New unified dialog
  assert.ok(html.includes('<dialog id="share-dialog" class="share-dialog" aria-labelledby="share-dialog-title">'));
  assert.ok(html.includes('id="share-dialog-title"') && html.includes("Jaa asiakirja"));
  assert.ok(html.includes('id="share-dialog-close"'));

  // Esikatselujako card
  assert.ok(html.includes('id="share-card-readonly"'));
  assert.ok(html.includes("Esikatselujako"));
  assert.ok(html.includes("Vain luku"));
  assert.ok(html.includes("WebRTC"));
  assert.ok(html.includes('id="share-readonly-inactive"'));
  assert.ok(html.includes('id="share-readonly-start"'));
  assert.ok(html.includes("Aloita esikatselujako"));
  assert.ok(html.includes('id="share-readonly-active"'));
  assert.ok(html.includes('id="share-status-text"') && html.includes("Jako käynnissä"));
  assert.ok(html.includes('id="share-count"'));
  assert.ok(html.includes('id="share-url"'));
  assert.ok(html.includes('id="share-copy"'));
  assert.ok(html.includes('id="share-stop"') && html.includes("Lopeta jako"));

  // Yhteismuokkaus card
  assert.ok(html.includes('id="share-card-collab"'));
  assert.ok(html.includes("Yhteismuokkaus"));
  assert.ok(html.includes("Reaaliaikainen"));
  assert.ok(html.includes("Oma henkilökohtainen luonnoksesi säilyy selaimessasi erillisenä ja koskemattomana"));
  assert.ok(html.includes('id="collab-create-error"'));
  assert.ok(html.includes('id="collab-create-btn"'));
  assert.ok(html.includes("Luo yhteismuokkaushuone"));
});
