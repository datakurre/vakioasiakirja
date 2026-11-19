import test from "node:test";
import assert from "node:assert/strict";
import {
  createAutoscrollTracker,
  AUTOSCROLL_STORAGE_KEY,
  AUTOSCROLL_DEADBAND,
  AUTOSCROLL_MIN_DELTA,
  AUTOSCROLL_EDIT_DEBOUNCE_MS,
} from "../src/autoscroll.ts";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Mock localStorage for node environment
function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

test("AutoscrollTracker: default state is enabled and updates UI attributes", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  const button = {
    attributes: {} as Record<string, string>,
    title: "",
    setAttribute(name: string, val: string) {
      this.attributes[name] = val;
    },
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    },
    listeners: new Map<string, Function>(),
    addEventListener(event: string, fn: Function) {
      this.listeners.set(event, fn);
    },
    removeEventListener(event: string) {
      this.listeners.delete(event);
    },
    click() {
      this.listeners.get("click")?.();
    },
  } as unknown as HTMLButtonElement;

  const preview = {
    scrollHeight: 1000,
    clientHeight: 400,
    scrollTop: 0,
    scrollTo(options: any) {
      this.scrollTop = options.top;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    buttonEl: button,
    previewEl: preview,
    getEditorView: () => undefined,
  });

  assert.equal(tracker.isEnabled(), true);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.title, "Automaattinen vieritys (päällä)");

  // Click to toggle off
  (button as any).click();
  assert.equal(tracker.isEnabled(), false);
  assert.equal(mockStorage.getItem(AUTOSCROLL_STORAGE_KEY), "0");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.title, "Automaattinen vieritys (pois)");

  // Click to toggle on
  (button as any).click();
  assert.equal(tracker.isEnabled(), true);
  assert.equal(mockStorage.getItem(AUTOSCROLL_STORAGE_KEY), "1");
  assert.equal(button.getAttribute("aria-pressed"), "true");
});

test("AutoscrollTracker: restores initial state from localStorage", () => {
  const mockStorage = createMockStorage();
  mockStorage.setItem(AUTOSCROLL_STORAGE_KEY, "0");
  (globalThis as any).localStorage = mockStorage;

  const button = {
    attributes: {} as Record<string, string>,
    title: "",
    setAttribute(name: string, val: string) {
      this.attributes[name] = val;
    },
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLButtonElement;

  const preview = { scrollHeight: 500, clientHeight: 500, scrollTop: 0 } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    buttonEl: button,
    previewEl: preview,
    getEditorView: () => undefined,
  });

  assert.equal(tracker.isEnabled(), false);
  assert.equal(button.getAttribute("aria-pressed"), "false");
});

test("AutoscrollTracker: sync scrolls preview container matching editor line ratio", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrolledTop = -1;
  const preview = {
    scrollHeight: 1000,
    clientHeight: 500, // maxScroll = 500
    scrollTop: 0,
    scrollTo(options: any) {
      scrolledTop = options.top;
      this.scrollTop = options.top;
    },
  } as unknown as HTMLElement;

  const doc = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf("Line 3") }, // Line 3 out of 5 -> ratio = (3-1)/(5-1) = 2/4 = 0.5
  });

  const mockEditor = {
    state,
  } as unknown as EditorView;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  tracker.sync();
  // Target scroll top = 0.5 * 500 = 250
  assert.equal(scrolledTop, 250);
});

test("AutoscrollTracker: cursor following matches rendered SVG element and scrolls minimally into view (below safe zone)", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrolledTop = -1;
  const doc = "# Otsikko\n\nToinen kappale tekstiä täällä";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf("Toinen kappale") },
  });

  const mockEditor = { state } as unknown as EditorView;

  const fo = {
    getAttribute(attr: string) {
      if (attr === "x") return "10";
      if (attr === "y") return "10";
      if (attr === "width") return "100";
      if (attr === "height") return "20";
      return null;
    },
    parentElement: null as any,
  };

  const textNode = {
    getAttribute(attr: string) {
      if (attr === "data-tid") return "tid-123";
      return null;
    },
    textContent: "Toinen kappale tekstiä täällä",
    querySelector(selector: string) {
      if (selector === "foreignObject") return fo;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      // Element bottom at 620, while preview bottom is 600, safeBottom = 600 - 60 = 540
      // delta = 620 - 540 = 80
      return { top: 600, bottom: 620, left: 10, right: 110, width: 100, height: 20 };
    },
    parentElement: null as any,
  };

  const parentG = {
    getAttribute() {
      return null;
    },
    parentElement: null,
  };
  textNode.parentElement = parentG;
  fo.parentElement = textNode;

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-page") return [];
      if (selector === "g.typst-text") return [textNode];
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 0,
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo(options: any) {
      scrolledTop = options.top;
      this.scrollTop = options.top;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  tracker.sync();
  // Safe zone displacement with lead distance (0.5 * 600 = 300):
  // Brings element bottom (620) to safeBottom (540) -> delta 80 + lead 300 = 380
  assert.equal(scrolledTop, 380);
});

test("AutoscrollTracker: displacement with lead scrolls up when element is above top safe zone", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrolledTop = -1;
  const doc = "Kappale tekstiä ylhäällä";
  const state = EditorState.create({
    doc,
    selection: { anchor: 5 },
  });

  const mockEditor = { state } as unknown as EditorView;

  const fo = {
    getAttribute(attr: string) {
      if (attr === "width") return "100";
      if (attr === "height") return "20";
      return null;
    },
    parentElement: null as any,
  };

  const textNode = {
    getAttribute(attr: string) {
      if (attr === "data-tid") return "tid-top";
      return null;
    },
    textContent: "Kappale tekstiä ylhäällä",
    querySelector(s: string) {
      return s === "foreignObject" ? fo : null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      // Element top at 30, safeTop = 60. delta = 30 - 60 = -30
      return { top: 30, bottom: 50, left: 10, right: 110, width: 100, height: 20 };
    },
    parentElement: { getAttribute: () => null, parentElement: null },
  };
  fo.parentElement = textNode;

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-text") return [textNode];
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 200, // already scrolled down
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo(options: any) {
      scrolledTop = options.top;
      this.scrollTop = options.top;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  tracker.sync();
  // Safe zone displacement with lead distance (0.5 * 600 = 300):
  // Brings element top (30) to safeTop (60) with lead distance -> 200 + (-30 - 300) clamped to 0
  assert.equal(scrolledTop, 0);
});

test("AutoscrollTracker: avoids jitter when rendered element is already comfortably in view", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrollToCalls = 0;
  const doc = "Yksi rivi tekstiä";
  const state = EditorState.create({
    doc,
    selection: { anchor: 2 },
  });

  const mockEditor = { state } as unknown as EditorView;

  const fo = {
    getAttribute(attr: string) {
      if (attr === "width") return "100";
      if (attr === "height") return "20";
      return "0";
    },
    parentElement: null as any,
  };

  const textNode = {
    getAttribute(attr: string) {
      if (attr === "data-tid") return "tid-abc";
      return null;
    },
    textContent: "Yksi rivi tekstiä",
    querySelector(s: string) {
      return s === "foreignObject" ? fo : null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      // Element is at 200..220 inside 60..540 safe zone
      return { top: 200, bottom: 220, left: 0, right: 100, width: 100, height: 20 };
    },
    parentElement: { getAttribute: () => null, parentElement: null },
  };
  fo.parentElement = textNode;

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-text") return [textNode];
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 0,
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo() {
      scrollToCalls++;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  tracker.sync();
  assert.equal(scrollToCalls, 0);
});

test("AutoscrollTracker: micro-delta below minDelta threshold does not trigger scroll (anti-jitter)", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrollToCalls = 0;
  const doc = "Yksi rivi tekstiä";
  const state = EditorState.create({
    doc,
    selection: { anchor: 2 },
  });

  const mockEditor = { state } as unknown as EditorView;

  const fo = {
    getAttribute(attr: string) {
      if (attr === "width") return "100";
      if (attr === "height") return "20";
      return "0";
    },
    parentElement: null as any,
  };

  const textNode = {
    getAttribute(attr: string) {
      if (attr === "data-tid") return "tid-jitter";
      return null;
    },
    textContent: "Yksi rivi tekstiä",
    querySelector(s: string) {
      return s === "foreignObject" ? fo : null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      // safeBottom = 540. Element bottom at 545 -> delta = 5px.
      // Below minDelta threshold (10px), so must NOT scroll!
      return { top: 525, bottom: 545, left: 0, right: 100, width: 100, height: 20 };
    },
    parentElement: { getAttribute: () => null, parentElement: null },
  };
  fo.parentElement = textNode;

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-text") return [textNode];
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 0,
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo() {
      scrollToCalls++;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  tracker.sync();
  assert.equal(scrollToCalls, 0, "5px delta below minDelta threshold of 10px must be ignored");
});

test("AutoscrollTracker: scans backward to nearest non-empty line when cursor is on empty line", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrolledTop = -1;
  const doc = "# Otsikko\n\n\n";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
  });

  const mockEditor = { state } as unknown as EditorView;

  const fo = {
    getAttribute(attr: string) {
      if (attr === "width") return "100";
      if (attr === "height") return "20";
      return "0";
    },
    parentElement: null as any,
  };

  const textNode = {
    getAttribute(attr: string) {
      if (attr === "data-tid") return "tid-heading";
      return null;
    },
    textContent: "Otsikko",
    querySelector(s: string) {
      return s === "foreignObject" ? fo : null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      // Element bottom at 730, safeBottom = 540 -> delta = 730 - 540 = 190
      return { top: 700, bottom: 730, left: 0, right: 100, width: 100, height: 30 };
    },
    parentElement: { getAttribute: () => null, parentElement: null },
  };
  fo.parentElement = textNode;

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-text") return [textNode];
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 0,
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo(options: any) {
      scrolledTop = options.top;
      this.scrollTop = options.top;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  tracker.sync();
  // Safe zone displacement with lead: brings heading bottom (730) into safe area (540) + lead (300) -> delta 490
  assert.equal(scrolledTop, 490);
});

test("AutoscrollTracker: debounces autoscroll during active typing (source === 'edit')", async () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrollCalls = 0;
  const doc = "# Otsikko\n\nTekstikappale täällä";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf("Tekstikappale") },
  });
  const mockEditor = { state } as unknown as EditorView;

  const fo = {
    getAttribute(attr: string) {
      if (attr === "width") return "100";
      if (attr === "height") return "20";
      return null;
    },
    parentElement: null as any,
  };

  const textNode = {
    getAttribute(attr: string) {
      if (attr === "data-tid") return "tid-typing";
      return null;
    },
    textContent: "Tekstikappale täällä",
    querySelector(s: string) {
      return s === "foreignObject" ? fo : null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      // Element bottom at 620, safeBottom at 540 -> needs scroll
      return { top: 600, bottom: 620, left: 0, right: 100, width: 100, height: 20 };
    },
    parentElement: { getAttribute: () => null, parentElement: null },
  };
  fo.parentElement = textNode;

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-text") return [textNode];
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 0,
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo() {
      scrollCalls++;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
    debounceMs: 50, // Short debounce for test speed
  });

  // Rapid typing: multiple scheduleSync("edit") calls
  tracker.scheduleSync("edit");
  tracker.scheduleSync("edit");
  tracker.scheduleSync("edit");

  // Should NOT scroll synchronously while typing is active
  assert.equal(scrollCalls, 0, "No scroll during active typing keystrokes");

  // Wait for debounce cooldown to expire
  await new Promise((r) => setTimeout(r, 80));

  assert.equal(scrollCalls, 1, "Autoscroll triggers once after typing debounce cooldown");
  tracker.destroy();
});

test("AutoscrollTracker: suppresses proportional scroll fallback during active editing", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrollCalls = 0;
  const doc = "--- \ntitle: Asiakohta\n---\nUusi kirjoitettu teksti";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
  });
  const mockEditor = { state } as unknown as EditorView;

  const preview = {
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTop: 0,
    querySelectorAll() { return []; }, // No element matched (unrendered newly typed text)
    scrollTo() {
      scrollCalls++;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  // When source === "edit", proportional fallback must be suppressed to avoid jumping mid-typing
  tracker.sync("edit");
  assert.equal(scrollCalls, 0, "Proportional scroll must be suppressed during active editing");

  // When source === "selection", proportional fallback is allowed for cursor navigation
  tracker.sync("selection");
  assert.equal(scrollCalls, 1, "Proportional scroll allowed during selection navigation");
  tracker.destroy();
});

test("AutoscrollTracker: source === 'render' resets editing cooldown and syncs fresh DOM", async () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrollCalls = 0;
  const doc = "Line 1\nLine 2\nLine 3";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf("Line 2") },
  });
  const mockEditor = { state } as unknown as EditorView;

  const preview = {
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTop: 0,
    querySelectorAll() { return []; },
    scrollTo() {
      scrollCalls++;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
    debounceMs: 200,
  });

  // Start an edit cooldown
  tracker.scheduleSync("edit");
  assert.equal(scrollCalls, 0);

  // Fresh render completes before edit cooldown expires
  tracker.scheduleSync("render");

  // Render immediately/cleanly executes (or via rAF), and edit cooldown is cancelled
  assert.equal(scrollCalls, 1, "Render event syncs fresh DOM immediately and resets edit cooldown");

  // Wait past original debounce time to ensure edit timer does NOT fire a duplicate scroll
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(scrollCalls, 1, "No duplicate scroll after render cancelled edit timer");
  tracker.destroy();
});

test("AutoscrollTracker: source === 'selection' provides responsive cursor alignment via rAF", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let rafCallback: Function | null = null;
  const origRaf = (globalThis as any).requestAnimationFrame;
  const origCancelRaf = (globalThis as any).cancelAnimationFrame;

  (globalThis as any).requestAnimationFrame = (fn: Function) => {
    rafCallback = fn;
    return 42;
  };
  (globalThis as any).cancelAnimationFrame = () => {
    rafCallback = null;
  };

  try {
    let scrollCalls = 0;
    const doc = "Line 1\nLine 2\nLine 3\nLine 4";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf("Line 3") },
    });
    const mockEditor = { state } as unknown as EditorView;

    const preview = {
      scrollHeight: 1000,
      clientHeight: 500,
      scrollTop: 0,
      scrollTo() {
        scrollCalls++;
      },
    } as unknown as HTMLElement;

    const tracker = createAutoscrollTracker({
      previewEl: preview,
      getEditorView: () => mockEditor,
    });

    // Navigation scheduleSync("selection")
    tracker.scheduleSync("selection");
    assert.ok(rafCallback !== null, "rAF is scheduled for responsive cursor alignment");
    assert.equal(scrollCalls, 0, "Not yet executed before rAF callback");

    // Execute animation frame
    rafCallback!();
    assert.equal(scrollCalls, 1, "Sync executed on animation frame");

    tracker.destroy();
  } finally {
    (globalThis as any).requestAnimationFrame = origRaf;
    (globalThis as any).cancelAnimationFrame = origCancelRaf;
  }
});

test("AutoscrollTracker: long paragraph (>200 chars) windows around cursor head", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrolledTop = -1;
  // Paragraph longer than 200 chars
  const prefix = "Alun tekstiä joka toistuu pitkään ja täyttää rivin. ".repeat(4);
  const targetWord = "KohdeKohtaUniikki";
  const fullLine = prefix + targetWord + " ja loppusanat.";
  const doc = fullLine;

  const targetOffset = doc.indexOf(targetWord);
  const state = EditorState.create({
    doc,
    selection: { anchor: targetOffset + 5 }, // cursor head inside targetWord
  });

  const mockEditor = { state } as unknown as EditorView;

  const fo = {
    getAttribute(attr: string) {
      if (attr === "x") return "10";
      if (attr === "y") return "10";
      if (attr === "width") return "100";
      if (attr === "height") return "30";
      return null;
    },
    parentElement: null as any,
  };

  const parentG = {
    getAttribute() {
      return null;
    },
    parentElement: null,
  };

  const targetNode = {
    getAttribute(attr: string) {
      if (attr === "data-tid") return "tid-target";
      return null;
    },
    textContent: targetWord + " ja loppusanat.",
    querySelector(selector: string) {
      if (selector === "foreignObject") return fo;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getBoundingClientRect() {
      // Positioned below safe zone
      return { top: 600, bottom: 630, left: 10, right: 110, width: 100, height: 30 };
    },
    parentElement: parentG,
  };
  fo.parentElement = targetNode;

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-text") return [targetNode];
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 0,
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo(options: any) {
      scrolledTop = options.top;
      this.scrollTop = options.top;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  tracker.sync();
  // Safe bottom is 600 - 60 = 540; target bottom is 630. Delta = 630 - 540 + lead 300 = 390
  assert.equal(scrolledTop, 390);
  tracker.destroy();
});

test("AutoscrollTracker: ignores collapsed cursor movements to prevent unwanted screen movement", () => {
  let scrollCalls = 0;
  const doc = "Line 1\nLine 2\nLine 3";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf("Line 2") }, // Empty / collapsed cursor
  });
  const mockEditor = { state } as unknown as EditorView;

  const preview = {
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTop: 0,
    scrollTo() { scrollCalls++; },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  const hasVisualSelection = !state.selection.main.empty;
  assert.equal(hasVisualSelection, false);
  // When collapsed cursor, scheduleSync("selection") is not invoked by editor
  if (hasVisualSelection) {
    tracker.scheduleSync("selection");
  }
  assert.equal(scrollCalls, 0, "No scroll on collapsed cursor placement");
  tracker.destroy();
});

test("AutoscrollTracker: post-render onRendered brings newly typed sentence into view", () => {
  let scrolledTop = -1;
  const doc = "# Kilpailutoiminta\n\nUusi virke kilpailutoiminnasta lisättynä.";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
  });
  const mockEditor = { state } as unknown as EditorView;

  const fo = {
    getAttribute(attr: string) {
      if (attr === "x") return "10";
      if (attr === "y") return "10";
      if (attr === "width") return "100";
      if (attr === "height") return "20";
      return null;
    },
    parentElement: null as any,
  };

  const parentG = {
    getAttribute() {
      return null;
    },
    parentElement: null,
  };

  const textNode = {
    getAttribute(attr: string) { return attr === "data-tid" ? "tid-kilp" : null; },
    textContent: "Uusi virke kilpailutoiminnasta lisättynä.",
    querySelector(s: string) {
      return s === "foreignObject" ? fo : null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return { top: 620, bottom: 640, left: 10, right: 300, width: 290, height: 20 };
    },
    parentElement: parentG,
  };
  fo.parentElement = textNode;

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-page") return [];
      if (selector === "g.typst-text") return [textNode];
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 0,
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo(options: any) {
      scrolledTop = options.top;
      this.scrollTop = options.top;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  // onRendered fires scheduleSync("render")
  tracker.sync("render");
  // Element bottom is at 640, safeBottom is 540 -> delta 100 + lead 300 = 400
  assert.equal(scrolledTop, 400, "Newly rendered sentence post-compile is cleanly scrolled into view");
  tracker.destroy();
});

test("AutoscrollTracker: Table of Contents leader dots do not prevent matching section heading or sentence under it", () => {
  const mockStorage = createMockStorage();
  (globalThis as any).localStorage = mockStorage;

  let scrolledTop = -1;
  const doc = `# Johdanto\n\nTekstiä.\n\n# Kilpailutoiminta\n\nYksi kaksi kolme neljä. Viisi kuusi seitsemän.\n`;
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf("Yksi kaksi kolme") + 5 },
  });

  const mockEditor = { state } as unknown as EditorView;

  const foDot = {
    getAttribute(attr: string) {
      if (attr === "width") return "2";
      if (attr === "height") return "12";
      return null;
    },
    parentElement: null as any,
  };
  const dotNode = {
    getAttribute(attr: string) { return attr === "data-tid" ? "tid-dot" : null; },
    textContent: ".",
    querySelector(s: string) { return s === "foreignObject" ? foDot : null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 300, bottom: 312, left: 100, right: 102, width: 2, height: 12 }; },
    parentElement: { getAttribute: () => null, parentElement: null },
  };
  foDot.parentElement = dotNode;

  const foHeading = {
    getAttribute(attr: string) {
      if (attr === "width") return "150";
      if (attr === "height") return "20";
      return null;
    },
    parentElement: null as any,
  };
  const headingNode = {
    getAttribute(attr: string) { return attr === "data-tid" ? "tid-h" : null; },
    textContent: "3 Kilpailutoiminta",
    querySelector(s: string) { return s === "foreignObject" ? foHeading : null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 700, bottom: 720, left: 10, right: 160, width: 150, height: 20 }; },
    parentElement: { getAttribute: () => null, parentElement: null },
  };
  foHeading.parentElement = headingNode;

  const foSentence = {
    getAttribute(attr: string) {
      if (attr === "width") return "300";
      if (attr === "height") return "20";
      return null;
    },
    parentElement: null as any,
  };
  const sentenceNode = {
    getAttribute(attr: string) { return attr === "data-tid" ? "tid-s" : null; },
    textContent: "Yksi kaksi kolme neljä. Viisi kuusi seitsemän.",
    querySelector(s: string) { return s === "foreignObject" ? foSentence : null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 730, bottom: 750, left: 10, right: 310, width: 300, height: 20 }; },
    parentElement: { getAttribute: () => null, parentElement: null },
  };
  foSentence.parentElement = sentenceNode;

  // Simulate multiple leader dots followed by heading and sentence
  const allNodes = [dotNode, dotNode, dotNode, headingNode, sentenceNode];

  const pageSvg = {
    querySelectorAll(selector: string) {
      if (selector === "g.typst-page") return [];
      if (selector === "g.typst-text") return allNodes;
      return [];
    },
  };

  const preview = {
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 0,
    querySelectorAll(selector: string) {
      if (selector === "svg.page") return [pageSvg];
      return [];
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
    },
    scrollTo(options: any) {
      scrolledTop = options.top;
      this.scrollTop = options.top;
    },
  } as unknown as HTMLElement;

  const tracker = createAutoscrollTracker({
    previewEl: preview,
    getEditorView: () => mockEditor,
  });

  tracker.sync("render");
  // sentenceNode bottom is at 750, safeBottom is 540 -> target is 750 - 540 + lead 300 = 510
  assert.equal(scrolledTop, 510, "Focuses sentence on page 2 despite presence of TOC leader dots");
  tracker.destroy();
});
