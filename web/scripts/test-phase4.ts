import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, Transaction, Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { ySyncAnnotation, yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { Vim, vim } from "@replit/codemirror-vim";
import * as Y from "yjs";

import * as awarenessProtocol from "y-protocols/awareness";
import { JSDOM } from "jsdom";

import { createPagePulseTracker } from "../src/pulse.ts";
import {
  isRemoteTransaction,
  getRemoteChangedRanges,
  remoteHighlightField,
  clearRemoteHighlight,
  addRemoteHighlight,
  createRemoteHighlightPlugin,
  setupVimForCollab,
  computeSelectionPayload,
  CollabRenderCoordinator,
  CollabSelectionManager,
} from "../src/collab-editor.ts";
import { SelectionHighlighter } from "../src/selection-highlighter.ts";
import { HighlightTracker } from "../src/highlight.ts";
import type { RenderOptions } from "../src/preview.ts";
import type { SelectionPayload } from "../src/share.ts";

test("Page pulse tracker: initial render, modified detection, unchanged pages, and reset", () => {
  const tracker = createPagePulseTracker();

  // 1. Initial render of two pages: must NOT pulse
  const initial = tracker.checkModified([
    "<svg><g class=\"page-1\">Page 1 Content</g></svg>",
    "<svg><g class=\"page-2\">Page 2 Content</g></svg>",
  ]);
  assert.deepEqual(initial, [false, false], "Initial render must have no pulse");

  // 2. Subsequent render without changes: must NOT pulse
  const unchanged = tracker.checkModified([
    "<svg><g class=\"page-1\">Page 1 Content</g></svg>",
    "<svg><g class=\"page-2\">Page 2 Content</g></svg>",
  ]);
  assert.deepEqual(unchanged, [false, false], "Unchanged pages must have no pulse");

  // 3. Page 1 modified, Page 2 unchanged: only Page 1 must pulse
  const page1Modified = tracker.checkModified([
    "<svg><g class=\"page-1\">Page 1 Content (Modified)</g></svg>",
    "<svg><g class=\"page-2\">Page 2 Content</g></svg>",
  ]);
  assert.deepEqual(page1Modified, [true, false], "Only modified page 1 should pulse");

  // 4. Page 1 unchanged from previous render, Page 2 modified: only Page 2 must pulse
  const page2Modified = tracker.checkModified([
    "<svg><g class=\"page-1\">Page 1 Content (Modified)</g></svg>",
    "<svg><g class=\"page-2\">Page 2 Content (Modified)</g></svg>",
  ]);
  assert.deepEqual(page2Modified, [false, true], "Only modified page 2 should pulse");

  // 5. New page added: new page must pulse as modified
  const page3Added = tracker.checkModified([
    "<svg><g class=\"page-1\">Page 1 Content (Modified)</g></svg>",
    "<svg><g class=\"page-2\">Page 2 Content (Modified)</g></svg>",
    "<svg><g class=\"page-3\">Page 3 Content (New)</g></svg>",
  ]);
  assert.deepEqual(page3Added, [false, false, true], "Newly added page should pulse");

  // 6. Reset tracker: next render is treated as initial render
  tracker.reset();
  const afterReset = tracker.checkModified([
    "<svg><g class=\"page-1\">Page 1 Content (Modified)</g></svg>",
    "<svg><g class=\"page-2\">Page 2 Content (Modified)</g></svg>",
    "<svg><g class=\"page-3\">Page 3 Content (New)</g></svg>",
  ]);
  assert.deepEqual(afterReset, [false, false, false], "Render after reset must have no pulse");
});

test("CodeMirror remote change detection: transaction classification and changed ranges", () => {
  let state = EditorState.create({ doc: "Ensimmäinen rivi tekstiä." });

  // Local transaction (no annotations)
  const localTr = state.update({
    changes: { from: 12, insert: "muokattua " },
  });
  assert.equal(isRemoteTransaction(localTr), false, "Local transaction is not remote");

  // Remote transaction with ySyncAnnotation
  const remoteSyncTr = state.update({
    changes: { from: 0, to: 11, insert: "Toinen" },
    annotations: [ySyncAnnotation.of(true as any)],
  });
  assert.equal(isRemoteTransaction(remoteSyncTr), true, "ySyncAnnotation transaction is remote");
  const rangesSync = getRemoteChangedRanges(remoteSyncTr);
  assert.deepEqual(rangesSync, [{ from: 0, to: 6 }]);

  // Remote transaction with Transaction.remote
  const remoteAnnotatedTr = state.update({
    changes: { from: 0, insert: "Alku: " },
    annotations: [Transaction.remote.of(true)],
  });
  assert.equal(isRemoteTransaction(remoteAnnotatedTr), true, "Transaction.remote is remote");
  const rangesAnnotated = getRemoteChangedRanges(remoteAnnotatedTr);
  assert.deepEqual(rangesAnnotated, [{ from: 0, to: 6 }]);

  // Deletion transaction
  const deletionTr = state.update({
    changes: { from: 5, to: 10, insert: "" },
    annotations: [ySyncAnnotation.of(true as any)],
  });
  const deletionRanges = getRemoteChangedRanges(deletionTr);
  assert.equal(deletionRanges.length, 1);
  assert.ok(deletionRanges[0].from < deletionRanges[0].to);
});

test("CodeMirror remote change decorations: creation, range tracking, and clearing", () => {
  let state = EditorState.create({
    doc: "Moi maailma!",
    extensions: [remoteHighlightField],
  });

  // Verify initial state has no decorations
  assert.equal(state.field(remoteHighlightField).size, 0);

  // 1. Local transaction does NOT produce decorations
  const localTr = state.update({ changes: { from: 11, insert: "?" } });
  state = localTr.state;
  assert.equal(state.field(remoteHighlightField).size, 0, "Local changes must not create remote highlights");

  // 2. Remote transaction creates decoration with .cm-remote-edit-highlight
  const remoteTr = state.update({
    changes: { from: 0, to: 3, insert: "Tervehdys" },
    annotations: [ySyncAnnotation.of(true as any)],
  });
  state = remoteTr.state;
  const decos = state.field(remoteHighlightField);
  assert.equal(decos.size, 1, "Remote edit must create 1 decoration");

  let decoFound = false;
  let rangeFrom = -1;
  let rangeTo = -1;
  decos.between(0, state.doc.length, (from, to, value) => {
    decoFound = true;
    rangeFrom = from;
    rangeTo = to;
    assert.equal((value.spec as any).class, "cm-remote-edit-highlight");
  });
  assert.ok(decoFound, "Decoration must be found in range");
  assert.equal(rangeFrom, 0);
  assert.equal(rangeTo, 9); // "Tervehdys" is 9 chars

  // 3. Another local change shifts the existing remote decoration
  const shiftTr = state.update({ changes: { from: 0, insert: ">>> " } });
  state = shiftTr.state;
  const shiftedDecos = state.field(remoteHighlightField);
  assert.equal(shiftedDecos.size, 1);
  shiftedDecos.between(0, state.doc.length, (from, to) => {
    assert.equal(from, 4);
    assert.equal(to, 13);
  });

  // 4. clearRemoteHighlight effect removes decorations
  const clearTr = state.update({ effects: clearRemoteHighlight.of() });
  state = clearTr.state;
  assert.equal(state.field(remoteHighlightField).size, 0, "clearRemoteHighlight effect must clear all decorations");

  // 5. Explicit addRemoteHighlight effect works as expected
  const manualTr = state.update({
    effects: addRemoteHighlight.of([{ from: 4, to: 10 }]),
  });
  state = manualTr.state;
  assert.equal(state.field(remoteHighlightField).size, 1);
});

test("Vim undo/redo collaborative integration: isolation of local changes from remote peer edits", () => {
  setupVimForCollab();

  // Setup dual Yjs documents simulating two collaborators
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const text1 = doc1.getText("content");
  const text2 = doc2.getText("content");

  const originClient1 = "client-1";
  const originClient2 = "client-2";

  const undoManager1 = new Y.UndoManager(text1, {
    trackedOrigins: new Set([originClient1]),
  });

  // Cross-network sync preserving remote origins
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

  const awareness = {
    getStates: () => new Map(),
    setLocalStateField: () => {},
    on: () => {},
    off: () => {},
  };

  const state1 = EditorState.create({
    doc: text1.toString(),
    extensions: [
      yCollab(text1, awareness as any, { undoManager: undoManager1 }),
      keymap.of(yUndoManagerKeymap),
    ],
  });

  // Client 1 makes local edit
  doc1.transact(() => {
    text1.insert(0, "Paikallinen teksti. ");
  }, originClient1);

  // Client 2 makes remote edit
  doc2.transact(() => {
    text2.insert(text2.length, "Etämuokkaajan lisäys.");
  }, originClient2);

  assert.equal(
    text1.toString(),
    "Paikallinen teksti. Etämuokkaajan lisäys.",
    "Both edits present in Client 1 text",
  );
  assert.equal(undoManager1.undoStack.length, 1, "Undo stack contains 1 local item");

  // Mock Vim environment
  const cmMock = {
    state: {},
    curOp: null,
    cm6: {
      state: state1,
      dispatch: () => {},
    },
    operation: (fn: () => void) => {
      (cmMock as any).curOp = {};
      try {
        fn();
      } finally {
        (cmMock as any).curOp = null;
      }
    },
    openNotification: () => {},
    getCursor: () => ({ line: 0, ch: 0 }),
    setCursor: () => {},
    clipPos: (p: any) => p,
  };
  Vim.maybeInitVimState_(cmMock as any);

  // Simulate Vim Normal Mode 'u' key
  Vim.handleKey(cmMock as any, "u", "mapping");

  // Verify: Client 1's local text is undone, Client 2's remote text remains intact!
  assert.equal(
    text1.toString(),
    "Etämuokkaajan lisäys.",
    "Vim 'u' must only undo local user's edits, preserving remote edits",
  );
  assert.equal(undoManager1.undoStack.length, 0);
  assert.equal(undoManager1.redoStack.length, 1);

  // Simulate Vim Normal Mode '<C-r>' key (redo)
  Vim.handleKey(cmMock as any, "<C-r>", "mapping");

  // Verify: Client 1's local text is restored alongside Client 2's remote text!
  assert.equal(
    text1.toString(),
    "Paikallinen teksti. Etämuokkaajan lisäys.",
    "Vim '<C-r>' must redo local user's edits",
  );
  assert.equal(undoManager1.undoStack.length, 1);
  assert.equal(undoManager1.redoStack.length, 0);

  doc1.destroy();
  doc2.destroy();
});

test("Vim undo/redo personal mode fallback: standard CodeMirror history without Yjs", () => {
  setupVimForCollab();

  let state = EditorState.create({
    doc: "Alkuperäinen teksti",
    extensions: [history()],
  });

  // Local edit recorded by history
  const tr = state.update({ changes: { from: 19, insert: " ja jatkoa" } });
  state = tr.state;
  assert.equal(state.doc.toString(), "Alkuperäinen teksti ja jatkoa");

  const cmMock = {
    state: {},
    curOp: null,
    get cm6() {
      return {
        get state() {
          return state;
        },
        dispatch: (t: any) => {
          state = state.update(t).state;
        },
      };
    },
    operation: (fn: () => void) => {
      (cmMock as any).curOp = {};
      try {
        fn();
      } finally {
        (cmMock as any).curOp = null;
      }
    },
    openNotification: () => {},
    getCursor: () => ({ line: 0, ch: 0 }),
    setCursor: () => {},
    clipPos: (p: any) => p,
  };
  Vim.maybeInitVimState_(cmMock as any);

  // Normal mode 'u' undoes edit using cmUndo fallback
  Vim.handleKey(cmMock as any, "u", "mapping");
  assert.equal(
    state.doc.toString(),
    "Alkuperäinen teksti",
    "Vim 'u' in personal mode falls back cleanly to cmUndo",
  );

  // Normal mode '<C-r>' redoes edit using cmRedo fallback
  Vim.handleKey(cmMock as any, "<C-r>", "mapping");
  assert.equal(
    state.doc.toString(),
    "Alkuperäinen teksti ja jatkoa",
    "Vim '<C-r>' in personal mode falls back cleanly to cmRedo",
  );
});

test("CodeMirror remote change decoration expiration: timer clears highlights automatically", async () => {
  let currentState = EditorState.create({
    doc: "Alkutila",
    extensions: [remoteHighlightField],
  });

  const mockView: any = {
    get state() {
      return currentState;
    },
    dispatch(trOrSpec: any) {
      if (trOrSpec.effects) {
        currentState = currentState.update({ effects: trOrSpec.effects }).state;
      }
    },
  };

  const plugin = createRemoteHighlightPlugin(30) as any;
  const pluginInstance = plugin.create(mockView);

  // Remote transaction adds decoration
  const remoteTr = currentState.update({
    changes: { from: 0, to: 8, insert: "Etämuutos" },
    annotations: [ySyncAnnotation.of(true as any)],
  });
  currentState = remoteTr.state;
  assert.equal(currentState.field(remoteHighlightField).size, 1, "Decoration active before timer expires");

  // Plugin observes remote update and schedules timer
  pluginInstance.update({
    transactions: [remoteTr],
    state: currentState,
  } as any);

  // Still active immediately
  assert.equal(currentState.field(remoteHighlightField).size, 1);

  // Wait for 30ms timer to expire
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Decoration must be cleared
  assert.equal(currentState.field(remoteHighlightField).size, 0, "Decoration cleared after timer expiration");

  pluginInstance.destroy();
});

test("Vim mode state toggling: compartment reconfiguration preserves editor stability", () => {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  ytext.insert(0, "Perusteksti");
  const undoManager = new Y.UndoManager(ytext);

  const awareness = {
    getStates: () => new Map(),
    setLocalStateField: () => {},
    on: () => {},
    off: () => {},
  };

  const vimCompartment = new Compartment();

  let state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      vimCompartment.of([]),
      yCollab(ytext, awareness as any, { undoManager }),
      keymap.of(yUndoManagerKeymap),
    ],
  });

  // Enable Vim
  state = state.update({
    effects: vimCompartment.reconfigure(vim()),
  }).state;
  assert.ok(state);

  // Disable Vim
  state = state.update({
    effects: vimCompartment.reconfigure([]),
  }).state;
  assert.ok(state);

  ydoc.destroy();
});

test("Collaborative render coordinator: initial render uses liveEdit: false and subsequent edits use liveEdit: true", async () => {
  const renderCalls: { md: string; options?: RenderOptions }[] = [];
  const mockPreview = {
    async render(md: string, _logo?: any, options?: RenderOptions) {
      renderCalls.push({ md, options });
    },
  };

  let currentDoc = "Otsikko: Pöytäkirja";
  let completedCount = 0;

  const coordinator = new CollabRenderCoordinator({
    preview: mockPreview,
    getMarkdown: () => currentDoc,
    onRenderComplete: () => {
      completedCount++;
    },
    debounceMs: 25,
  });

  assert.equal(coordinator.isInitialRendered(), false);

  // 1. Initial document synchronization: must use liveEdit: false to establish baseline without flashing
  await coordinator.initialRender();
  assert.equal(coordinator.isInitialRendered(), true);
  assert.equal(renderCalls.length, 1);
  assert.equal(renderCalls[0].md, "Otsikko: Pöytäkirja");
  assert.equal(renderCalls[0].options?.liveEdit, false, "Initial render must have liveEdit: false");
  assert.equal(completedCount, 1);

  // 2. Subsequent local or remote edits: scheduleRender() must use liveEdit: true
  currentDoc = "Otsikko: Pöytäkirja\n1 § Kokouksen avaus";
  coordinator.scheduleRender(true);
  assert.equal(renderCalls.length, 1, "Render should be debounced");

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(renderCalls.length, 2);
  assert.equal(renderCalls[1].md, "Otsikko: Pöytäkirja\n1 § Kokouksen avaus");
  assert.equal(renderCalls[1].options?.liveEdit, true, "Subsequent render must have liveEdit: true");
  assert.equal(completedCount, 2);

  // 3. HighlightTracker integration: verify neon yellow highlight injection when liveEdit: true
  const dom = new JSDOM(`
    <svg xmlns="http://www.w3.org/2000/svg">
      <g class="typst-page">
        <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
          <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Rivi 1</foreignObject></g>
        </g>
      </g>
    </svg>
  `);
  const tracker = new HighlightTracker();
  const baseSvg = dom.window.document.querySelector("svg")!;

  // Initial baseline with liveEdit: false -> no neon highlights
  tracker.process(baseSvg, false);
  assert.equal(baseSvg.querySelectorAll(".neon-highlight").length, 0, "No neon highlight on initial baseline");

  // Modify SVG (new line added) and process with liveEdit: true -> neon highlight injected
  const newTextGroup = dom.window.document.createElementNS("http://www.w3.org/2000/svg", "g");
  newTextGroup.setAttribute("class", "typst-text");
  newTextGroup.setAttribute("data-tid", "t2");
  newTextGroup.setAttribute("transform", "scale(0.011, -0.011)");
  const inner = dom.window.document.createElementNS("http://www.w3.org/2000/svg", "g");
  inner.setAttribute("transform", "scale(16, -16)");
  const fo = dom.window.document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  fo.setAttribute("x", "0");
  fo.setAttribute("y", "-100");
  fo.setAttribute("width", "100");
  fo.setAttribute("height", "60");
  fo.textContent = "Rivi 2 (Uusi)";
  inner.appendChild(fo);
  newTextGroup.appendChild(inner);
  baseSvg.querySelector(".typst-page")!.appendChild(newTextGroup);

  tracker.process(baseSvg, true);
  const neonRects = baseSvg.querySelectorAll(".neon-highlight");
  assert.equal(neonRects.length, 1, "Neon highlight rect must be injected for new line on live edit");
  assert.equal(neonRects[0].getAttribute("class"), "neon-highlight");

  coordinator.destroy();
});

test("Collaborative Vim visual mode selection: payload computation and awareness propagation across peers", () => {
  const doc1 = new Y.Doc();
  const doc2 = new Y.Doc();
  const text1 = doc1.getText("content");
  const text2 = doc2.getText("content");

  const sampleDoc = "Hallituksen kokous 1/2026\n\n1 § Kokouksen avaus\nPuheenjohtaja avasi kokouksen.";
  text1.insert(0, sampleDoc);
  text2.insert(0, sampleDoc);

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

  // Client 1 EditorState with selection on "1 § Kokouksen avaus"
  const start = sampleDoc.indexOf("1 § Kokouksen avaus");
  const end = start + "1 § Kokouksen avaus".length;

  const state1 = EditorState.create({
    doc: sampleDoc,
    selection: { anchor: start, head: end },
  });

  // 1. Not in visual mode -> computeSelectionPayload returns null
  assert.equal(computeSelectionPayload(state1, false, "visual"), null);

  // 2. Entering visual mode -> computeSelectionPayload calculates valid SelectionPayload
  const payload = computeSelectionPayload(state1, true, "visual");
  assert.ok(payload);
  assert.equal(payload.active, true);
  assert.equal(payload.text, "1 § Kokouksen avaus");
  assert.equal(payload.mode, "visual");
  assert.equal(payload.fromLine, 3);
  assert.equal(payload.toLine, 3);
  assert.ok(payload.prefix !== undefined);
  assert.ok(payload.suffix !== undefined);
  assert.ok(payload.relPos !== undefined && payload.relPos > 0);

  // 3. Client 1 broadcasts selection via awareness
  awareness1.setLocalStateField("selection", payload);

  // Client 2 observes Client 1's selection
  const client2States = awareness2.getStates();
  const remoteSel1 = (client2States.get(doc1.clientID) as { selection?: SelectionPayload })?.selection;
  assert.ok(remoteSel1);
  assert.equal(remoteSel1.active, true);
  assert.equal(remoteSel1.text, "1 § Kokouksen avaus");

  // 4. Client 1 leaves visual mode -> broadcasts null
  awareness1.setLocalStateField("selection", null);
  const clearedState = (awareness2.getStates().get(doc1.clientID) as { selection?: SelectionPayload | null })?.selection;
  assert.equal(clearedState, null, "Selection must be null after leaving visual mode");

  doc1.destroy();
  doc2.destroy();
});

test("CollabSelectionManager: preview selection highlight and clear lifecycle across collaborators", () => {
  const dom = new JSDOM(`
    <div id="pages">
      <svg class="page" viewBox="0 0 595 842">
        <g class="typst-page">
          <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
            <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Asiakirjan otsikko</foreignObject></g>
          </g>
          <g class="typst-text" data-tid="t2" transform="scale(0.011, -0.011)">
            <g transform="scale(16, -16)"><foreignObject x="0" y="-150" width="100" height="60">Ensimmäinen pykälä</foreignObject></g>
          </g>
        </g>
      </svg>
    </div>
  `);

  const pagesEl = dom.window.document.getElementById("pages")!;
  const highlighter = new SelectionHighlighter();

  const localState: Record<string, any> = {};
  const mockAwarenessStates = new Map<number, Record<string, any>>();
  mockAwarenessStates.set(1, localState);

  const mockAwareness = {
    clientID: 1,
    getStates: () => mockAwarenessStates,
    setLocalStateField: (field: string, val: any) => {
      localState[field] = val;
    },
  };

  const manager = new CollabSelectionManager({
    selectionHighlighter: highlighter,
    pagesEl,
    awareness: mockAwareness,
  });

  // 1. Initial state: no highlights
  assert.equal(pagesEl.querySelectorAll(".selection-highlight").length, 0);

  // 2. Local user selects "Asiakirjan otsikko"
  const localPayload: SelectionPayload = {
    active: true,
    mode: "visual",
    text: "Asiakirjan otsikko",
  };
  manager.setLocalSelection(localPayload);

  assert.equal(localState.selection, localPayload);
  assert.equal(manager.getLocalSelection(), localPayload);
  let highlights = pagesEl.querySelectorAll(".selection-highlight");
  assert.equal(highlights.length, 1, "Local selection highlight injected into SVG preview");

  // 3. Remote peer (client 2) selects "Ensimmäinen pykälä"
  const remotePayload: SelectionPayload = {
    active: true,
    mode: "visual",
    text: "Ensimmäinen pykälä",
  };
  mockAwarenessStates.set(2, { selection: remotePayload });
  manager.render();

  highlights = pagesEl.querySelectorAll(".selection-highlight");
  assert.equal(highlights.length, 2, "Both local and remote selection highlights visible simultaneously");

  // 4. Local user leaves visual mode
  manager.clearLocalSelection();
  assert.equal(localState.selection, null);
  assert.equal(manager.getLocalSelection(), null);

  // Remote highlight must persist!
  highlights = pagesEl.querySelectorAll(".selection-highlight");
  assert.equal(highlights.length, 1, "Remote selection remains after local leaves visual mode");

  // 5. Remote user leaves visual mode
  mockAwarenessStates.set(2, { selection: null });
  manager.render();
  highlights = pagesEl.querySelectorAll(".selection-highlight");
  assert.equal(highlights.length, 0, "All highlights cleared once all collaborators exit visual mode");

  // 6. Preview DOM rebuild lifecycle (onRendered retention)
  manager.setLocalSelection(localPayload);
  assert.equal(pagesEl.querySelectorAll(".selection-highlight").length, 1);

  // Simulate preview re-rendering (DOM replaced with fresh Typst SVG)
  const freshSvg = dom.window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  freshSvg.setAttribute("class", "page");
  freshSvg.innerHTML = `
    <g class="typst-page">
      <g class="typst-text" data-tid="t1" transform="scale(0.011, -0.011)">
        <g transform="scale(16, -16)"><foreignObject x="0" y="-50" width="100" height="60">Asiakirjan otsikko</foreignObject></g>
      </g>
    </g>
  `;
  pagesEl.replaceChildren(freshSvg);
  assert.equal(pagesEl.querySelectorAll(".selection-highlight").length, 0, "Fresh render initially lacks highlights");

  // onRendered calls manager.render() -> re-applies active selection
  manager.render();
  highlights = pagesEl.querySelectorAll(".selection-highlight");
  assert.equal(highlights.length, 1, "Active selection successfully re-applied after preview DOM rebuild");
});
