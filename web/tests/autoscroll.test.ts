import test from "node:test";
import assert from "node:assert/strict";
import { createAutoscrollTracker, AUTOSCROLL_STORAGE_KEY } from "../src/autoscroll.ts";
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

test("AutoscrollTracker: cursor following matches rendered SVG element and scrolls to upper third", () => {
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
  assert.equal(scrolledTop, 402);
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
  assert.equal(scrolledTop, 502);
});
