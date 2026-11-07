import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, Transaction, Compartment } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { ySyncAnnotation, yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { Vim, vim } from "@replit/codemirror-vim";
import * as Y from "yjs";

import { createPagePulseTracker } from "../src/pulse.ts";
import {
  isRemoteTransaction,
  getRemoteChangedRanges,
  remoteHighlightField,
  clearRemoteHighlight,
  addRemoteHighlight,
  createRemoteHighlightPlugin,
  setupVimForCollab,
} from "../src/collab-editor.ts";

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
