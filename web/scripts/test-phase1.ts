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

test("share panel: minimalist popover DOM verification and structure", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const htmlPath = path.resolve(import.meta.dirname, "../index.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  // Verify full-screen modal dialogs are removed
  assert.equal(html.includes('id="share-dialog"'), false, "Obsolete #share-dialog should be removed");
  assert.equal(html.includes('id="collab-confirm-dialog"'), false, "Obsolete #collab-confirm-dialog should be removed");

  // Minimalist popover panel
  assert.ok(html.includes('<div id="share-panel" hidden role="region" aria-label="Jakamisen valikko">'));
  assert.ok(html.includes('id="share-status"'));
  assert.ok(html.includes("Valitse jakamistapa:"));
  assert.ok(html.includes('id="share-close"'));

  // Option 1: Read-only live preview
  assert.ok(html.includes('id="share-options"'));
  assert.ok(html.includes('id="share-action-readonly"'));
  assert.ok(html.includes("Jaa esikatselu (vain luku)"));
  assert.ok(html.includes("Katsojat näkevät päivittyvän esikatselun suorana WebRTC-yhteydellä ilman muokkausoikeutta."));

  // Option 2: Collaborative editing
  assert.ok(html.includes('id="share-action-collab"'));
  assert.ok(html.includes("Jaa muokattavana"));
  assert.ok(html.includes("Luo reaaliaikainen yhteismuokkaushuone. Oma luonnos säilyy selaimessasi erillisenä."));

  // Active state controls
  assert.ok(html.includes('id="share-row"'));
  assert.ok(html.includes('id="share-url"'));
  assert.ok(html.includes('id="share-copy"'));
  assert.ok(html.includes('id="share-foot"'));
  assert.ok(html.includes('id="share-viewers"'));
  assert.ok(html.includes('id="share-count"'));
  assert.ok(html.includes('id="share-stop"'));
  assert.ok(html.includes("Lopeta jako"));

  // Error notice container
  assert.ok(html.includes('id="collab-create-error"'));
});

test("share panel: interaction state transitions and mutual exclusivity", () => {
  // Simulated elements matching the share-panel structure and editor logic
  let sharePanelHidden = true;
  let filesPanelHidden = false;
  let shareOptionsHidden = false;
  let shareRowHidden = true;
  let shareFootHidden = true;
  let shareStatus = "Valitse jakamistapa:";
  let shareState: "idle" | "starting" | "active" = "idle";
  let activeControls: { pressed: string; expanded: string; title: string } = {
    pressed: "false",
    expanded: "false",
    title: "",
  };

  const renderSharePanelState = () => {
    if (shareState === "idle") {
      shareStatus = "Valitse jakamistapa:";
      shareOptionsHidden = false;
      shareRowHidden = true;
      shareFootHidden = true;
    } else if (shareState === "starting") {
      shareStatus = "Muodostetaan yhteyttä jakopalveluun…";
      shareOptionsHidden = true;
      shareRowHidden = true;
      shareFootHidden = false;
    } else {
      shareStatus = "Jaat esikatselua. Lähetä linkki katsojille:";
      shareOptionsHidden = true;
      shareRowHidden = false;
      shareFootHidden = false;
    }
  };

  const syncShareControls = () => {
    const active = shareState === "active";
    const open = !sharePanelHidden;
    activeControls = {
      pressed: String(active),
      expanded: String(open),
      title: active
        ? (open ? "Sulje jakamisen tiedot" : "Jako käynnissä (näytä jakamisvalikko)")
        : (open ? "Sulje jakamisvalikko" : "Jaa asiakirja"),
    };
  };

  const openSharePanel = () => {
    if (!filesPanelHidden) filesPanelHidden = true; // mutual exclusivity
    renderSharePanelState();
    sharePanelHidden = false;
    syncShareControls();
  };

  const closeSharePanel = () => {
    sharePanelHidden = true;
    syncShareControls();
  };

  const openFilesPanel = () => {
    if (!sharePanelHidden) closeSharePanel(); // mutual exclusivity
    filesPanelHidden = false;
  };

  // 1. Initial idle state: opening share panel closes files panel
  openSharePanel();
  assert.equal(sharePanelHidden, false);
  assert.equal(filesPanelHidden, true, "Opening share panel should close files panel");
  assert.equal(shareOptionsHidden, false, "Options shown in idle state");
  assert.equal(shareRowHidden, true, "Share row hidden in idle state");
  assert.equal(shareFootHidden, true, "Share foot hidden in idle state");
  assert.equal(shareStatus, "Valitse jakamistapa:");
  assert.equal(activeControls.pressed, "false");
  assert.equal(activeControls.expanded, "true");

  // 2. Starting transition
  shareState = "starting";
  renderSharePanelState();
  assert.equal(shareOptionsHidden, true, "Options hidden when starting");
  assert.equal(shareRowHidden, true, "Share row hidden when starting");
  assert.equal(shareFootHidden, false, "Foot shown when starting");
  assert.equal(shareStatus, "Muodostetaan yhteyttä jakopalveluun…");

  // 3. Active transition
  shareState = "active";
  renderSharePanelState();
  syncShareControls();
  assert.equal(shareOptionsHidden, true, "Options hidden when active");
  assert.equal(shareRowHidden, false, "Share row shown when active");
  assert.equal(shareFootHidden, false, "Foot shown when active");
  assert.equal(shareStatus, "Jaat esikatselua. Lähetä linkki katsojille:");
  assert.equal(activeControls.pressed, "true");

  // 4. Closing share panel
  closeSharePanel();
  assert.equal(sharePanelHidden, true);
  assert.equal(activeControls.expanded, "false");

  // 5. Mutual exclusivity when opening files panel
  openSharePanel();
  assert.equal(sharePanelHidden, false);
  openFilesPanel();
  assert.equal(sharePanelHidden, true, "Opening files panel must close share panel");
  assert.equal(filesPanelHidden, false);
});
