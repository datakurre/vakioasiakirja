import test from "node:test";
import assert from "node:assert/strict";
import { DownloadDialog, downloadMarkdownFile } from "../src/download-dialog.ts";

function createMockDialogElement() {
  const listeners = new Map<string, Function[]>();
  const children = new Map<string, any>();

  const createChildBtn = (id: string) => {
    const btnListeners = new Map<string, Function[]>();
    const btn = {
      id,
      tagName: "BUTTON",
      focused: false,
      focus() {
        this.focused = true;
      },
      addEventListener(event: string, fn: Function) {
        if (!btnListeners.has(event)) btnListeners.set(event, []);
        btnListeners.get(event)!.push(fn);
      },
      dispatchEvent(event: any) {
        const list = btnListeners.get(event.type) || [];
        for (const fn of list) fn(event);
      },
      click() {
        this.dispatchEvent({ type: "click" });
      },
    };
    children.set(id, btn);
    return btn;
  };

  createChildBtn("download-dialog-close");
  createChildBtn("download-dialog-cancel");
  createChildBtn("download-format-pdf");
  createChildBtn("download-format-docx");
  createChildBtn("download-format-md");

  const dialog = {
    id: "download-dialog",
    tagName: "DIALOG",
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    querySelector(selector: string) {
      const id = selector.replace("#", "");
      return children.get(id) ?? null;
    },
    addEventListener(event: string, fn: Function) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
    },
    dispatchEvent(event: any) {
      const list = listeners.get(event.type) || [];
      for (const fn of list) fn(event);
    },
    getChild(id: string) {
      return children.get(id);
    },
  };

  return dialog;
}

test("DownloadDialog: open and close state management", () => {
  const mockDialog = createMockDialogElement();
  let pdfDownloaded = false;

  const dialog = new DownloadDialog({
    dialogEl: mockDialog as any,
    getMarkdown: () => "# Testi",
    getFilenameBase: () => "testi",
    onDownloadPdf: () => {
      pdfDownloaded = true;
    },
  });

  assert.equal(dialog.isOpen(), false);
  dialog.open();
  assert.equal(dialog.isOpen(), true);
  assert.equal(mockDialog.getChild("download-format-pdf").focused, true);

  dialog.close();
  assert.equal(dialog.isOpen(), false);
});

test("DownloadDialog: clicking PDF format triggers onDownloadPdf", async () => {
  const mockDialog = createMockDialogElement();
  let pdfDownloaded = false;

  const dialog = new DownloadDialog({
    dialogEl: mockDialog as any,
    getMarkdown: () => "# Testi",
    getFilenameBase: () => "testi",
    onDownloadPdf: async () => {
      pdfDownloaded = true;
    },
  });

  dialog.open();
  assert.equal(dialog.isOpen(), true);

  mockDialog.getChild("download-format-pdf").click();
  // Dialog closes upon selection
  assert.equal(dialog.isOpen(), false);
  assert.equal(pdfDownloaded, true);
});

test("DownloadDialog: clicking Word format exports docx and triggers toast", () => {
  const mockDialog = createMockDialogElement();
  const toasts: string[] = [];

  // Mock global URL and document for node environment
  (globalThis as any).URL = {
    createObjectURL: () => "blob:mock-url",
    revokeObjectURL: () => {},
  };
  const prevDoc = (globalThis as any).document;
  (globalThis as any).document = {
    createElement: () => ({ click: () => {}, setAttribute: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} },
  };

  try {
    const dialog = new DownloadDialog({
      dialogEl: mockDialog as any,
      getMarkdown: () => "# Testi Asiakirja",
      getFilenameBase: () => "testi-asiakirja",
      onDownloadPdf: () => {},
      toast: (msg) => toasts.push(msg),
    });

    dialog.open();
    mockDialog.getChild("download-format-docx").click();

    assert.equal(dialog.isOpen(), false);
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /testi-asiakirja\.docx/);
  } finally {
    (globalThis as any).document = prevDoc;
  }
});

test("DownloadDialog: clicking Markdown format creates markdown blob and triggers toast", () => {
  const mockDialog = createMockDialogElement();
  const toasts: string[] = [];

  (globalThis as any).URL = {
    createObjectURL: () => "blob:mock-url",
    revokeObjectURL: () => {},
  };
  const prevDoc = (globalThis as any).document;
  (globalThis as any).document = {
    createElement: () => ({ click: () => {}, setAttribute: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} },
  };

  try {
    const dialog = new DownloadDialog({
      dialogEl: mockDialog as any,
      getMarkdown: () => "# Muistio",
      getFilenameBase: () => "muistio",
      onDownloadPdf: () => {},
      toast: (msg) => toasts.push(msg),
    });

    dialog.open();
    mockDialog.getChild("download-format-md").click();

    assert.equal(dialog.isOpen(), false);
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /muistio\.md/);
  } finally {
    (globalThis as any).document = prevDoc;
  }
});

test("DownloadDialog: close and cancel buttons close dialog", () => {
  const mockDialog = createMockDialogElement();

  const dialog = new DownloadDialog({
    dialogEl: mockDialog as any,
    getMarkdown: () => "",
    getFilenameBase: () => "test",
    onDownloadPdf: () => {},
  });

  dialog.open();
  assert.equal(dialog.isOpen(), true);
  mockDialog.getChild("download-dialog-close").click();
  assert.equal(dialog.isOpen(), false);

  dialog.open();
  assert.equal(dialog.isOpen(), true);
  mockDialog.getChild("download-dialog-cancel").click();
  assert.equal(dialog.isOpen(), false);
});

test("DownloadDialog: escape key press closes dialog", () => {
  const mockDialog = createMockDialogElement();

  const dialog = new DownloadDialog({
    dialogEl: mockDialog as any,
    getMarkdown: () => "",
    getFilenameBase: () => "test",
    onDownloadPdf: () => {},
  });

  dialog.open();
  assert.equal(dialog.isOpen(), true);
  let prevented = false;
  mockDialog.dispatchEvent({
    type: "keydown",
    key: "Escape",
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(dialog.isOpen(), false);
  assert.equal(prevented, true);
});

test("TemplateManager: clicking replace button invokes onReplace and closes dialog", async () => {
  const { TemplateManager } = await import("../src/template-manager.ts");
  let replaced = false;

  const prevDoc = (globalThis as any).document;
  (globalThis as any).document = {
    createElement: () => ({
      setAttribute() {},
      appendChild() {},
      addEventListener() {},
    }),
  };

  try {
    const mockDialog = createMockDialogElement();
    const replaceBtn = {
      listeners: new Map<string, Function[]>(),
      addEventListener(event: string, fn: Function) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event)!.push(fn);
      },
      click() {
        for (const fn of this.listeners.get("click") || []) fn({ type: "click" });
      },
    };
    const closeBtn = { addEventListener() {} };
    const cancelBtn = { addEventListener() {} };
    const gridEl = { innerHTML: "", appendChild() {} };

    const tm = new TemplateManager({
      dialogEl: mockDialog as any,
      closeEl: closeBtn as any,
      cancelEl: cancelBtn as any,
      replaceEl: replaceBtn as any,
      gridEl: gridEl as any,
      onSelectTemplate: () => {},
      onReplace: () => {
        replaced = true;
      },
    });

    tm.open();
    assert.equal(tm.isOpen(), true);

    replaceBtn.click();
    assert.equal(tm.isOpen(), false);
    assert.equal(replaced, true);
  } finally {
    (globalThis as any).document = prevDoc;
  }
});
