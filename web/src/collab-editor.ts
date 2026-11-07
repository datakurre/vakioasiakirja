// Collaborative editor implementation for Phase 3.
// Powered by Yjs CRDTs, WebSocket synchronization, IndexedDB persistence,
// CodeMirror 6 binding with Y.UndoManager isolation, and live Typst.ts preview.

import { EditorView, keymap, lineNumbers, drawSelection, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Compartment, StateField, StateEffect, Transaction, type Range, type Extension, type EditorState } from "@codemirror/state";
import { defaultKeymap, undo as cmUndo, redo as cmRedo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { vim, getCM, Vim } from "@replit/codemirror-vim";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { yCollab, yUndoManagerKeymap, ySyncAnnotation } from "y-codemirror.next";

import type { Logo, RenderOptions } from "./preview.ts";
import { createToaster, bytesToBase64, base64ToBytes } from "./ui.ts";
import { getCollabUrl, getCollabWsUrl } from "./config.ts";
import { SelectionHighlighter } from "./selection-highlighter.ts";
import type { SelectionPayload } from "./share.ts";
import { FileManager, type FileMeta, formatFileDate } from "./files.ts";

export const clearRemoteHighlight = StateEffect.define<void>();
export const addRemoteHighlight = StateEffect.define<{ from: number; to: number }[]>();

export function isRemoteTransaction(tr: Transaction): boolean {
  if (tr.annotation(ySyncAnnotation) != null) return true;
  if (Boolean(tr.annotation(Transaction.remote))) return true;
  return false;
}

export function getRemoteChangedRanges(tr: Transaction): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (fromB < toB && toB <= tr.newDoc.length) {
      ranges.push({ from: fromB, to: toB });
    } else if (fromB === toB && tr.newDoc.length > 0) {
      const from = Math.min(fromB, tr.newDoc.length - 1);
      const to = Math.min(from + 1, tr.newDoc.length);
      if (from < to) {
        ranges.push({ from, to });
      }
    }
  });
  return ranges;
}

export const remoteHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(clearRemoteHighlight)) {
        return Decoration.none;
      }
      if (effect.is(addRemoteHighlight)) {
        const mark = Decoration.mark({ class: "cm-remote-edit-highlight" });
        const newDecos = effect.value
          .filter((r) => r.from < r.to && r.to <= tr.newDoc.length)
          .map((r) => mark.range(r.from, r.to));
        if (newDecos.length > 0) {
          decorations = decorations.update({ add: newDecos, sort: true });
        }
      }
    }
    if (isRemoteTransaction(tr)) {
      const ranges = getRemoteChangedRanges(tr);
      if (ranges.length > 0) {
        const mark = Decoration.mark({ class: "cm-remote-edit-highlight" });
        const newDecos: Range<Decoration>[] = [];
        for (const r of ranges) {
          if (r.from < r.to && r.to <= tr.newDoc.length) {
            newDecos.push(mark.range(r.from, r.to));
          }
        }
        if (newDecos.length > 0) {
          decorations = decorations.update({ add: newDecos, sort: true });
        }
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function createRemoteHighlightPlugin(timeoutMs = 1500) {
  return ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private timer: ReturnType<typeof setTimeout> | null = null;
      constructor(view: EditorView) {
        this.view = view;
      }

      update(update: ViewUpdate) {
        const hasRemote = update.transactions.some(isRemoteTransaction);
        if (hasRemote) {
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.view.dispatch({ effects: clearRemoteHighlight.of() });
            this.timer = null;
          }, timeoutMs);
        }
      }

      destroy() {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }
    },
  );
}

export function remoteHighlightExtension(timeoutMs = 1500): Extension {
  return [remoteHighlightField, createRemoteHighlightPlugin(timeoutMs)];
}

export function computeSelectionPayload(
  state: EditorState,
  visualModeActive: boolean,
  visualSubMode: "visual" | "linewise" | "blockwise" = "visual",
): SelectionPayload | null {
  if (!visualModeActive) return null;
  const main = state.selection.main;
  if (main.empty) return null;

  const from = main.from;
  const to = main.to;
  const text = state.sliceDoc(from, to);
  if (!text || !text.trim()) return null;

  const lineFrom = state.doc.lineAt(from);
  const lineTo = state.doc.lineAt(to);
  const prefix = state.sliceDoc(Math.max(0, from - 100), from);
  const suffix = state.sliceDoc(to, Math.min(state.doc.length, to + 100));
  const relPos = state.doc.length > 0 ? from / state.doc.length : 0;

  return {
    active: true,
    mode: visualSubMode,
    text,
    prefix,
    suffix,
    fromLine: lineFrom.number,
    toLine: lineTo.number,
    relPos,
  };
}

export class CollabRenderCoordinator {
  private hasInitialRendered = false;
  private preview: { render(md: string, logo?: Logo, options?: RenderOptions): Promise<void> };
  private getMarkdown: () => string;
  private getLogo: () => Logo | undefined;
  private onRenderComplete?: () => void;
  private renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;

  constructor(options: {
    preview: { render(md: string, logo?: Logo, options?: RenderOptions): Promise<void> };
    getMarkdown: () => string;
    getLogo?: () => Logo | undefined;
    onRenderComplete?: () => void;
    debounceMs?: number;
  }) {
    this.preview = options.preview;
    this.getMarkdown = options.getMarkdown;
    this.getLogo = options.getLogo ?? (() => undefined);
    this.onRenderComplete = options.onRenderComplete;
    this.debounceMs = options.debounceMs ?? 300;
  }

  isInitialRendered(): boolean {
    return this.hasInitialRendered;
  }

  async initialRender(): Promise<void> {
    this.hasInitialRendered = true;
    if (this.renderDebounceTimer !== null) {
      clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }
    await this.preview.render(this.getMarkdown(), this.getLogo(), { liveEdit: false });
    this.onRenderComplete?.();
  }

  scheduleRender(liveEdit = true): void {
    if (this.renderDebounceTimer !== null) {
      clearTimeout(this.renderDebounceTimer);
    }
    this.renderDebounceTimer = setTimeout(async () => {
      this.renderDebounceTimer = null;
      const isLive = this.hasInitialRendered ? liveEdit : false;
      this.hasInitialRendered = true;
      await this.preview.render(this.getMarkdown(), this.getLogo(), { liveEdit: isLive });
      this.onRenderComplete?.();
    }, this.debounceMs);
  }

  cancelScheduledRender(): void {
    if (this.renderDebounceTimer !== null) {
      clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }
  }

  destroy(): void {
    this.cancelScheduledRender();
  }
}

export class CollabSelectionManager {
  private selectionHighlighter: SelectionHighlighter;
  private pagesEl: Element;
  private awareness: {
    clientID: number;
    getStates: () => Map<number, Record<string, any>>;
    setLocalStateField: (field: string, val: any) => void;
  };
  private localSelection: SelectionPayload | null = null;

  constructor(options: {
    selectionHighlighter: SelectionHighlighter;
    pagesEl: Element;
    awareness: {
      clientID: number;
      getStates: () => Map<number, Record<string, any>>;
      setLocalStateField: (field: string, val: any) => void;
    };
  }) {
    this.selectionHighlighter = options.selectionHighlighter;
    this.pagesEl = options.pagesEl;
    this.awareness = options.awareness;
  }

  getLocalSelection(): SelectionPayload | null {
    return this.localSelection;
  }

  setLocalSelection(payload: SelectionPayload | null): void {
    this.localSelection = payload;
    this.awareness.setLocalStateField("selection", payload);
    this.render();
  }

  clearLocalSelection(): void {
    this.setLocalSelection(null);
  }

  getActiveSelections(): SelectionPayload[] {
    const active: SelectionPayload[] = [];
    if (this.localSelection && this.localSelection.active && this.localSelection.text?.trim()) {
      active.push(this.localSelection);
    }
    const states = this.awareness.getStates();
    states.forEach((state, clientId) => {
      if (clientId === this.awareness.clientID) return;
      const sel = (state as { selection?: SelectionPayload | null })?.selection;
      if (sel && sel.active && sel.text && sel.text.trim()) {
        active.push(sel);
      }
    });
    return active;
  }

  render(): void {
    const active = this.getActiveSelections();
    if (active.length === 0) {
      this.selectionHighlighter.clear(this.pagesEl);
    } else {
      this.selectionHighlighter.update(this.pagesEl, active);
    }
  }
}

const yUndoCommand = yUndoManagerKeymap.find((k) => k.key === "Mod-z")?.run;
const yRedoCommand = yUndoManagerKeymap.find((k) => k.key === "Mod-y")?.run;

let vimActionsConfigured = false;
export function setupVimForCollab() {
  if (vimActionsConfigured) return;
  vimActionsConfigured = true;

  Vim.defineAction("undo", (cm: any, actionArgs: any) => {
    const repeat = (actionArgs && actionArgs.repeat) || 1;
    for (let i = 0; i < repeat; i++) {
      let handled = false;
      if (yUndoCommand && cm?.cm6) {
        try {
          handled = Boolean(yUndoCommand(cm.cm6 as EditorView));
        } catch {
          handled = false;
        }
      }
      if (!handled && cm?.cm6) {
        cmUndo(cm.cm6 as EditorView);
      }
    }
  });

  Vim.defineAction("redo", (cm: any, actionArgs: any) => {
    const repeat = (actionArgs && actionArgs.repeat) || 1;
    for (let i = 0; i < repeat; i++) {
      let handled = false;
      if (yRedoCommand && cm?.cm6) {
        try {
          handled = Boolean(yRedoCommand(cm.cm6 as EditorView));
        } catch {
          handled = false;
        }
      }
      if (!handled && cm?.cm6) {
        cmRedo(cm.cm6 as EditorView);
      }
    }
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface CollabUser {
  name: string;
  color: string;
  colorLight: string;
}

const COLLAB_PALETTE = [
  { name: "Sini", color: "#1976d2", colorLight: "#bbdefb" },
  { name: "Metsä", color: "#2e7d32", colorLight: "#c8e6c9" },
  { name: "Pihka", color: "#e65100", colorLight: "#ffe0b2" },
  { name: "Karpalo", color: "#c2185b", colorLight: "#fce4ec" },
  { name: "Kanerva", color: "#6a1b9a", colorLight: "#f3e5f5" },
  { name: "Järvi", color: "#00838f", colorLight: "#e0f7fa" },
  { name: "Kaarna", color: "#4e342e", colorLight: "#d7ccc8" },
  { name: "Sammal", color: "#558b2f", colorLight: "#dcedc8" },
];

const ANIMAL_NAMES = [
  "Ilves", "Kettu", "Karhu", "Susi", "Hirvi",
  "Pöllö", "Kuukkeli", "Majava", "Ahma", "Saukko",
  "Siili", "Norppa", "Kärppä", "Poro", "Jänis"
];

function getStoredOrNewUser(): CollabUser {
  const STORE_KEY = "sfs2487.collab.user";
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CollabUser;
      if (parsed.name && parsed.color && parsed.colorLight) return parsed;
    }
  } catch {
    /* ignore */
  }

  const pal = COLLAB_PALETTE[Math.floor(Math.random() * COLLAB_PALETTE.length)];
  const animal = ANIMAL_NAMES[Math.floor(Math.random() * ANIMAL_NAMES.length)];
  const user: CollabUser = {
    name: `Muokkaaja (${animal})`,
    color: pal.color,
    colorLight: pal.colorLight,
  };

  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
  return user;
}

function logoPathFor(file: File): string {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return "/logo.svg";
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "/logo.jpg";
  return "/logo.png";
}

/**
 * Saves the current collaborative document content to local storage via FileManager.
 * If asNewFile is true, creates a new file with the specified or suggested name.
 * Otherwise, updates the currently active file in FileManager.
 */
export function saveCollabToLocal(
  fileManager: FileManager,
  ytext: Y.Text,
  roomId: string,
  options?: { asNewFile?: boolean; customName?: string; toast?: (msg: string) => void },
): FileMeta {
  const currentText = ytext.toString();
  const toast = options?.toast ?? (() => {});
  if (options?.asNewFile) {
    const defaultName = fileManager.suggestFileName(`yhteistyo-${roomId}.md`);
    const name = options?.customName?.trim() || defaultName;
    const created = fileManager.createFile(name, currentText);
    toast(`Huone tallennettu uuteen tiedostoon "${created.name}"!`);
    return created;
  } else {
    fileManager.saveActiveContent(currentText);
    const activeFile = fileManager.getActiveFile();
    toast(`Asiakirja kopioitu henkilökohtaiseen luonnokseesi ("${activeFile.name}")!`);
    return activeFile;
  }
}

/**
 * Replaces the collaborative room's document (ytext) with the content of the selected local file,
 * broadcasting the change to all connected collaborators.
 */
export function importLocalFileToCollab(
  file: FileMeta,
  fileManager: FileManager,
  ydoc: Y.Doc,
  ytext: Y.Text,
  toast?: (msg: string) => void,
  closePanel?: () => void,
): void {
  const content = fileManager.getFileContent(file.id);
  ydoc.transact(() => {
    ytext.delete(0, ytext.length);
    ytext.insert(0, content);
  });
  if (toast) {
    toast(`Tiedoston "${file.name}" sisältö tuotu huoneeseen.`);
  }
  if (closePanel) {
    closePanel();
  }
}

/**
 * Sets the specified file as active in FileManager and redirects to the personal editor (#/).
 */
export function openLocalFileInPersonal(
  file: FileMeta,
  fileManager: FileManager,
): void {
  fileManager.setActiveFile(file.id);
  window.location.hash = "#/";
}

/**
 * Initializes the full collaborative editor experience.
 */
export async function initCollabEditor(roomId: string, token: string) {
  // Probe room status first to catch 503 (disabled), 429 (room full), 404 (not found), 401 (unauthorized)
  const collabUrl = getCollabUrl();
  try {
    const probeRes = await fetch(`${collabUrl}/collab/${roomId}?token=${token}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (handleCollabStatusError(probeRes.status)) {
      return;
    }
  } catch (err) {
    console.warn("Collab room pre-check error:", err);
  }

  document.body.classList.remove("viewer", "collab-error-view");
  document.body.classList.add("collab-mode", "show-editor");

  const statusEl = document.getElementById("status")!;
  const downloadEl = document.getElementById("download") as HTMLButtonElement;
  const logoEl = document.getElementById("logo") as HTMLInputElement;
  const logoClearEl = document.getElementById("logo-clear") as HTMLButtonElement;
  const logoLabelEl = document.getElementById("logo-label") as HTMLElement;
  const vimEl = document.getElementById("vim") as HTMLInputElement;
  const vimModeEl = document.getElementById("vim-mode")!;
  const resetEl = document.getElementById("reset") as HTMLButtonElement;
  const shareEl = document.getElementById("share") as HTMLButtonElement;
  const toastsEl = document.getElementById("toasts")!;
  const mainEl = document.querySelector("main")!;
  const editorEl = document.getElementById("editor")!;
  const dividerEl = document.getElementById("divider")!;
  const showEditorEl = document.getElementById("show-editor") as HTMLButtonElement;
  const showPreviewEl = document.getElementById("show-preview") as HTMLButtonElement;
  const bannerEl = document.getElementById("viewer-banner")!;
  const filesToggleEl = document.getElementById("files-toggle") as HTMLButtonElement;
  const filesPanelEl = document.getElementById("files-panel")!;
  const filesCloseEl = document.getElementById("files-close") as HTMLButtonElement;
  const filesNewEl = document.getElementById("files-new") as HTMLButtonElement;
  const filesSaveCollabEl = document.getElementById("files-save-collab") as HTMLButtonElement;
  const filesListEl = document.getElementById("files-list")!;
  const collabFileModalEl = document.getElementById("collab-file-modal") as HTMLDialogElement;
  const collabFileModalCloseEl = document.getElementById("collab-file-modal-close") as HTMLButtonElement;
  const collabFileModalFilenameEl = document.getElementById("collab-file-modal-filename");
  const collabFileActionImportEl = document.getElementById("collab-file-action-import") as HTMLButtonElement;
  const collabFileActionOpenEl = document.getElementById("collab-file-action-open") as HTMLButtonElement;

  const fileManager = new FileManager();

  // In collaborative mode, hide the single-user reset & share buttons
  if (resetEl) resetEl.hidden = true;
  if (shareEl) shareEl.hidden = true;

  if (logoLabelEl) {
    logoLabelEl.title = "Lisää logo (jaetaan kaikille muokkaajille)";
  }

  const toast = createToaster(toastsEl);
  const setStatus = (text: string, error = false) => {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", error);
  };
  const fail = (message: string) => {
    setStatus("virhe", true);
    toast(message);
  };

  // --- Top Collaboration Banner Layout ---
  bannerEl.hidden = false;
  bannerEl.style.background = ""; // Reset inline override from stub
  bannerEl.className = "collab-banner";
  bannerEl.innerHTML = `
    <div class="collab-bar">
      <div class="collab-bar-left">
        <span id="collab-status-badge" class="collab-status-badge status-connecting">
          <span class="collab-status-dot"></span>
          <span id="collab-status-text">Yhdistetään…</span>
        </span>
        <span class="collab-room-tag">Huone: <strong>${escapeHtml(roomId)}</strong></span>
        <span class="collab-privacy-tag" title="Asiakirja välitetään yhteistyöpalvelimen kautta ja säilytetään siellä väliaikaisesti.">
          (välitetty palvelimen kautta)
        </span>
      </div>
      <div class="collab-bar-center">
        <div id="collab-users-container" class="collab-users-container"></div>
        <span id="collab-users-count" class="collab-users-count">1 paikalla</span>
      </div>
      <div class="collab-bar-right">
        <button id="collab-copy-btn" type="button" class="collab-btn" title="Kopioi muokkauslinkki leikepöydälle">
          <svg class="icon" aria-hidden="true"><use href="#i-copy" /></svg>
          <span class="collab-btn-label">Kopioi linkki</span>
        </button>
        <button id="collab-save-local-btn" type="button" class="collab-btn" title="Kopioi asiakirjan nykyinen tila henkilökohtaiseen luonnokseesi selaimen muistiin">
          <svg class="icon" aria-hidden="true"><use href="#i-download" /></svg>
          <span class="collab-btn-label">Kopioi omaan luonnokseen</span>
        </button>
        <button id="collab-exit-btn" type="button" class="collab-btn collab-btn-exit" title="Poistu yhteismuokkauksesta henkilökohtaiseen editoriin">
          <svg class="icon" aria-hidden="true"><use href="#i-close" /></svg>
          <span class="collab-btn-label">Poistu</span>
        </button>
      </div>
    </div>
  `;

  const statusBadgeEl = document.getElementById("collab-status-badge")!;
  const statusTextEl = document.getElementById("collab-status-text")!;
  const usersContainerEl = document.getElementById("collab-users-container")!;
  const usersCountEl = document.getElementById("collab-users-count")!;
  const copyBtn = document.getElementById("collab-copy-btn") as HTMLButtonElement;
  const saveLocalBtn = document.getElementById("collab-save-local-btn") as HTMLButtonElement;
  const exitBtn = document.getElementById("collab-exit-btn") as HTMLButtonElement;

  type ConnectionState = "connecting" | "connected" | "saving" | "disconnected";
  function updateConnectionBadge(state: ConnectionState) {
    statusBadgeEl.className = `collab-status-badge status-${state}`;
    switch (state) {
      case "connecting":
        statusTextEl.textContent = "Yhdistetään…";
        setStatus("yhdistetään…");
        break;
      case "connected":
        statusTextEl.textContent = "Yhdistetty";
        setStatus("yhteismuokkaustila");
        break;
      case "saving":
        statusTextEl.textContent = "Tallennetaan…";
        setStatus("tallennetaan…");
        break;
      case "disconnected":
        statusTextEl.textContent = "Yhteys katkesi";
        setStatus("yhteys katkesi", true);
        break;
    }
  }

  // --- Initialize Yjs CRDT & Shared Document State ---
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  const metaMap = ydoc.getMap<SharedLogoData | null>("meta");

  interface SharedLogoData {
    name: string;
    path: string;
    b64: string;
  }

  let sharedLogo: { path: string; name: string; bytes: Uint8Array } | undefined;
  const logoForPreview = (): Logo | undefined =>
    sharedLogo ? { path: sharedLogo.path, bytes: sharedLogo.bytes } : undefined;

  function updateLogoControls() {
    logoClearEl.hidden = sharedLogo === undefined;
    logoClearEl.title = sharedLogo ? sharedLogo.name : "";
  }
  updateLogoControls();

  const pagesEl = document.getElementById("pages")!;
  const selectionHighlighter = new SelectionHighlighter();
  let collabSelectionManager: CollabSelectionManager | undefined;

  const { createPreview } = await import("./preview.ts");
  const preview = createPreview(
    {
      previewEl: document.getElementById("preview")!,
      pagesEl,
      controlsEl: document.getElementById("preview-controls")!,
      zoomInEl: document.getElementById("zoom-in") as HTMLButtonElement,
      zoomOutEl: document.getElementById("zoom-out") as HTMLButtonElement,
      fitWidthEl: document.getElementById("fit-width") as HTMLButtonElement,
      fitHeightEl: document.getElementById("fit-height") as HTMLButtonElement,
      twoUpEl: document.getElementById("two-up") as HTMLButtonElement,
      zoomLevelEl: document.getElementById("zoom-level")!,
    },
    {
      setStatus,
      fail,
      viewStorageKey: "sfs2487.collab.view",
      onRendered: () => {
        downloadEl.disabled = false;
        collabSelectionManager?.render();
      },
    },
  );

  let savingTimer: number | undefined;

  const renderCoordinator = new CollabRenderCoordinator({
    preview,
    getMarkdown: () => ytext.toString(),
    getLogo: logoForPreview,
    onRenderComplete: () => {
      collabSelectionManager?.render();
    },
    debounceMs: 300,
  });

  function syncLogoFromMeta() {
    const rawLogo = metaMap.get("logo") as SharedLogoData | null | undefined;
    if (rawLogo && rawLogo.b64 && rawLogo.path && rawLogo.name) {
      try {
        const bytes = base64ToBytes(rawLogo.b64);
        sharedLogo = { path: rawLogo.path, name: rawLogo.name, bytes };
      } catch (err) {
        console.warn("Failed to decode shared logo base64:", err);
        sharedLogo = undefined;
      }
    } else {
      sharedLogo = undefined;
      logoEl.value = "";
    }
    updateLogoControls();
  }

  metaMap.observe((event) => {
    if (event.keysChanged.has("logo")) {
      syncLogoFromMeta();
      renderCoordinator.scheduleRender(true);
    }
  });

  syncLogoFromMeta();

  let idbProvider: IndexeddbPersistence | null = null;
  try {
    idbProvider = new IndexeddbPersistence("sfs2487.collab." + roomId, ydoc);
    idbProvider.on("synced", () => {
      syncLogoFromMeta();
      if (!renderCoordinator.isInitialRendered() && ytext.length > 0) {
        void renderCoordinator.initialRender();
      }
    });
  } catch (err) {
    console.warn("IndexedDB persistence could not be initialized:", err);
  }

  const wsUrl = getCollabWsUrl();
  const provider = new WebsocketProvider(wsUrl, roomId, ydoc, {
    params: { token },
  });

  collabSelectionManager = new CollabSelectionManager({
    selectionHighlighter,
    pagesEl,
    awareness: provider.awareness,
  });

  // Local user identity in Awareness
  const localUser = getStoredOrNewUser();
  provider.awareness.setLocalStateField("user", localUser);

  // Update collaborator list in header
  function renderCollaborators() {
    const states = provider.awareness.getStates();
    const count = states.size;
    usersCountEl.textContent = `${count} paikalla`;

    usersContainerEl.innerHTML = "";
    states.forEach((state, clientId) => {
      const user = (state as { user?: CollabUser }).user;
      if (!user) return;
      const isLocal = clientId === provider.awareness.clientID;
      const pill = document.createElement("span");
      pill.className = `collab-user-pill${isLocal ? " is-local" : ""}`;
      pill.style.borderColor = user.color;
      pill.title = isLocal ? `${user.name} (Sinä)` : user.name;

      const dot = document.createElement("span");
      dot.className = "collab-user-dot";
      dot.style.backgroundColor = user.color;
      pill.appendChild(dot);

      const nameSpan = document.createElement("span");
      nameSpan.className = "collab-user-name";
      nameSpan.textContent = isLocal ? `${user.name} (Sinä)` : user.name;
      pill.appendChild(nameSpan);

      usersContainerEl.appendChild(pill);
    });
  }

  provider.awareness.on("change", () => {
    renderCollaborators();
    collabSelectionManager?.render();
  });
  renderCollaborators();

  let isSynced = false;
  let checkErrorInFlight = false;
  const checkServerStatus = async () => {
    if (checkErrorInFlight) return;
    checkErrorInFlight = true;
    try {
      const probeRes = await fetch(`${collabUrl}/collab/${roomId}?token=${token}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (handleCollabStatusError(probeRes.status)) {
        provider.disconnect();
        idbProvider?.destroy();
      }
    } catch {
      /* network or CORS error */
    } finally {
      checkErrorInFlight = false;
    }
  };

  provider.on("connection-error", () => {
    void checkServerStatus();
  });

  provider.on("closed", (event: { code: number; reason: string }) => {
    if (event.code === 4429 || event.code === 1013) {
      handleCollabStatusError(429);
      provider.disconnect();
    } else if (event.code === 4503) {
      handleCollabStatusError(503);
      provider.disconnect();
    }
  });

  provider.on("status", (event: { status: "connecting" | "connected" | "disconnected" }) => {
    if (event.status === "connected") {
      updateConnectionBadge(isSynced ? "connected" : "connecting");
    } else if (event.status === "disconnected") {
      updateConnectionBadge("disconnected");
    } else {
      updateConnectionBadge("connecting");
    }
  });

  provider.on("sync", (synced: boolean) => {
    isSynced = synced;
    if (synced) {
      updateConnectionBadge("connected");
      syncLogoFromMeta();
      // Initial render once document content is synced
      if (!renderCoordinator.isInitialRendered()) {
        void renderCoordinator.initialRender();
      } else {
        renderCoordinator.scheduleRender(true);
      }
    }
  });

  ytext.observe((event) => {
    // If not local origin, trigger preview update with liveEdit: true
    if (event.transaction.origin !== ytext) {
      renderCoordinator.scheduleRender(true);
    }
  });

  // --- Initialize CodeMirror 6 ---
  editorEl.innerHTML = ""; // Clear stub

  let visualModeActive = false;
  let visualSubMode: "visual" | "linewise" | "blockwise" = "visual";

  function getSelectionPayload(state: EditorState): SelectionPayload | null {
    return computeSelectionPayload(state, visualModeActive, visualSubMode);
  }

  function syncSelection(state: EditorState) {
    if (!visualModeActive) {
      if (collabSelectionManager?.getLocalSelection() !== null) {
        collabSelectionManager?.clearLocalSelection();
      }
      return;
    }
    const payload = getSelectionPayload(state);
    collabSelectionManager?.setLocalSelection(payload);
  }

  // Vim preference support and collaborative undo/redo mapping
  setupVimForCollab();
  const STORE_VIM = "sfs2487.vim";
  const vimCompartment = new Compartment();
  const vimWanted = localStorage.getItem(STORE_VIM) === "1";
  vimEl.checked = vimWanted;

  const kbMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
  let keyboardPresent = kbMedia.matches;
  if (keyboardPresent) document.body.classList.add("keyboard");

  const selectionTheme = EditorView.theme({
    ".cm-selectionLayer .cm-selectionBackground": { backgroundColor: "#b3d4fc" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "#5b9dd9",
    },
  });

  const undoManager = new Y.UndoManager(ytext);

  const editor = new EditorView({
    parent: editorEl,
    extensions: [
      vimCompartment.of(vimWanted && keyboardPresent ? vim() : []),
      lineNumbers(),
      drawSelection(),
      selectionTheme,
      markdown(),
      EditorView.lineWrapping,
      remoteHighlightExtension(),
      // Collaborative extension: binds ytext and remote cursors/selections
      yCollab(ytext, provider.awareness, { undoManager }),
      // Collaborative undo/redo keymap: isolates local changes without reverting remote edits
      keymap.of([...defaultKeymap, ...yUndoManagerKeymap]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          // Indicate saving state temporarily
          updateConnectionBadge("saving");
          clearTimeout(savingTimer);
          savingTimer = window.setTimeout(() => {
            updateConnectionBadge(isSynced ? "connected" : "connecting");
          }, 600);
          renderCoordinator.scheduleRender(true);
        }
        if (visualModeActive && (u.selectionSet || u.docChanged)) {
          syncSelection(u.state);
        }
      }),
    ],
  });

  // Vim mode indicator
  function vimModeLabel(mode: string, sub?: string): string {
    if (mode === "visual") {
      if (sub === "linewise") return "VISUAL LINE";
      if (sub === "blockwise") return "VISUAL BLOCK";
      return "VISUAL";
    }
    return mode.toUpperCase();
  }
  function showVimMode(mode: string, sub?: string) {
    vimModeEl.hidden = false;
    vimModeEl.textContent = vimModeLabel(mode, sub);
    vimModeEl.dataset.mode = mode;
  }
  function syncVimMode() {
    if (!vimEl.checked || !keyboardPresent) {
      vimModeEl.hidden = true;
      if (visualModeActive) {
        visualModeActive = false;
        syncSelection(editor.state);
      }
      return;
    }
    const cm = getCM(editor);
    if (!cm) {
      vimModeEl.hidden = true;
      if (visualModeActive) {
        visualModeActive = false;
        syncSelection(editor.state);
      }
      return;
    }
    showVimMode("normal");
    cm.on("vim-mode-change", (e: { mode: string; subMode?: string }) => {
      showVimMode(e.mode, e.subMode);
      if (e.mode === "visual") {
        visualModeActive = true;
        visualSubMode =
          e.subMode === "linewise"
            ? "linewise"
            : e.subMode === "blockwise"
            ? "blockwise"
            : "visual";
        syncSelection(editor.state);
      } else {
        if (visualModeActive) {
          visualModeActive = false;
          syncSelection(editor.state);
        }
      }
    });
  }
  function applyVim() {
    const on = vimEl.checked && keyboardPresent;
    if (!on && visualModeActive) {
      visualModeActive = false;
      syncSelection(editor.state);
    }
    editor.dispatch({ effects: vimCompartment.reconfigure(on ? vim() : []) });
    syncVimMode();
  }
  vimEl.addEventListener("change", () => {
    localStorage.setItem(STORE_VIM, vimEl.checked ? "1" : "0");
    applyVim();
    editor.focus();
  });
  function onKeyboard() {
    if (keyboardPresent) return;
    keyboardPresent = true;
    document.body.classList.add("keyboard");
    applyVim();
  }
  kbMedia.addEventListener?.("change", (e) => e.matches && onKeyboard());
  window.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key === "Tab" ||
        e.key === "Escape" ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.key.startsWith("Arrow") ||
        /^F\d{1,2}$/.test(e.key)
      ) {
        onKeyboard();
      }
    },
    true,
  );
  syncVimMode();

  // Mobile pane switching
  function showPane(pane: "editor" | "preview") {
    document.body.classList.toggle("show-editor", pane === "editor");
    document.body.classList.toggle("show-preview", pane === "preview");
    showEditorEl.setAttribute("aria-pressed", String(pane === "editor"));
    showPreviewEl.setAttribute("aria-pressed", String(pane === "preview"));
    if (pane === "editor") editor.focus();
    else preview.flashControls();
  }
  showEditorEl.addEventListener("click", () => showPane("editor"));
  showPreviewEl.addEventListener("click", () => showPane("preview"));

  // Draggable split divider
  const STORE_SPLIT = "sfs2487.collab.split";
  function setSplit(px: number) {
    const min = 150;
    const max = mainEl.clientWidth - 150 - 6;
    const clamped = Math.min(max, Math.max(min, px));
    mainEl.style.setProperty("--split", `${clamped}px`);
    if (mainEl.clientWidth > 0) {
      dividerEl.setAttribute(
        "aria-valuenow",
        String(Math.round((clamped / mainEl.clientWidth) * 100)),
      );
    }
  }
  function persistSplit() {
    localStorage.setItem(
      STORE_SPLIT,
      mainEl.style.getPropertyValue("--split").replace("px", "").trim(),
    );
  }
  dividerEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dividerEl.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) =>
      setSplit(ev.clientX - mainEl.getBoundingClientRect().left);
    const onUp = () => {
      dividerEl.releasePointerCapture(e.pointerId);
      dividerEl.removeEventListener("pointermove", onMove);
      dividerEl.removeEventListener("pointerup", onUp);
      persistSplit();
    };
    dividerEl.addEventListener("pointermove", onMove);
    dividerEl.addEventListener("pointerup", onUp);
  });
  dividerEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setSplit(editorEl.clientWidth + (e.key === "ArrowLeft" ? -24 : 24));
    persistSplit();
  });
  window.addEventListener("resize", () => {
    const cur = mainEl.style.getPropertyValue("--split");
    if (cur) setSplit(parseFloat(cur));
  });
  const savedSplit = localStorage.getItem(STORE_SPLIT) || localStorage.getItem("sfs2487.split");
  if (savedSplit) setSplit(parseFloat(savedSplit));

  // --- Collaborative Logo Upload & Synchronization ---
  const MAX_LOGO_BYTES = 256 * 1024; // 256 KB limit

  logoEl.addEventListener("change", async () => {
    const file = logoEl.files?.[0];
    if (!file) return;

    if (file.size > MAX_LOGO_BYTES) {
      toast("Logotiedosto on liian suuri (enintään 256 kt).");
      logoEl.value = "";
      return;
    }

    try {
      const path = logoPathFor(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const b64 = bytesToBase64(bytes);
      metaMap.set("logo", { name: file.name, path, b64 });
      toast("Logo lisätty ja jaettu kaikille muokkaajille");
    } catch (err) {
      fail("Logon lataaminen epäonnistui: " + String(err));
    }
  });

  logoClearEl.addEventListener("click", () => {
    metaMap.delete("logo");
    toast("Logo poistettu kaikilta muokkaajilta");
  });

  // --- PDF Download Button ---
  downloadEl.addEventListener("click", async () => {
    try {
      renderCoordinator.cancelScheduledRender();
      if (!preview.hasContent()) {
        await renderCoordinator.initialRender();
      } else {
        await preview.render(ytext.toString(), logoForPreview(), { liveEdit: true });
      }
      const pdf = await preview.pdf();
      if (!pdf) return;
      const blob = new Blob([pdf as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `asiakirja-${roomId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      fail(String(e));
    }
  });

  // --- Action Buttons ---
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Muokkauslinkki kopioitu leikepöydälle!");
      const origText = copyBtn.querySelector(".collab-btn-label");
      if (origText) {
        origText.textContent = "Kopioitu!";
        window.setTimeout(() => {
          origText.textContent = "Kopioi linkki";
        }, 1500);
      }
    } catch {
      // Fallback: prompt copy dialog
      prompt("Kopioi muokkauslinkki tästä:", window.location.href);
    }
  });

  // --- File Manager Drawer & Local Storage Integration (Collab Mode) ---
  function syncFilesControls() {
    if (!filesToggleEl || !filesPanelEl) return;
    const open = !filesPanelEl.hidden;
    filesToggleEl.setAttribute("aria-expanded", String(open));
    filesToggleEl.setAttribute("aria-pressed", String(open));
    filesToggleEl.title = open ? "Piilota tiedostot" : "Tiedostot";
    filesToggleEl.setAttribute("aria-label", filesToggleEl.title);
  }

  function openFilesPanel() {
    if (!filesPanelEl) return;
    renderFilesList();
    filesPanelEl.hidden = false;
    syncFilesControls();
  }

  function closeFilesPanel() {
    if (!filesPanelEl) return;
    const focusWasInPanel = filesPanelEl.contains(document.activeElement);
    filesPanelEl.hidden = true;
    syncFilesControls();
    if (focusWasInPanel && filesToggleEl) filesToggleEl.focus();
  }

  function toggleFilesPanel() {
    if (!filesPanelEl) return;
    if (filesPanelEl.hidden) openFilesPanel();
    else closeFilesPanel();
  }

  let selectedCollabFile: FileMeta | null = null;

  function closeCollabFileModal() {
    selectedCollabFile = null;
    if (!collabFileModalEl) return;
    if (typeof collabFileModalEl.close === "function") {
      collabFileModalEl.close();
    } else {
      collabFileModalEl.removeAttribute("open");
    }
  }

  function promptCollabFileAction(file: FileMeta) {
    selectedCollabFile = file;
    if (collabFileModalFilenameEl) {
      collabFileModalFilenameEl.textContent = file.name;
    }
    if (collabFileModalEl) {
      if (typeof collabFileModalEl.showModal === "function") {
        collabFileModalEl.showModal();
      } else {
        collabFileModalEl.setAttribute("open", "");
      }
    } else {
      // Fallback
      const choice = typeof window.confirm === "function"
        ? window.confirm(
            `Valitse toiminto tiedostolle "${file.name}":\n\n` +
            `OK = Tuo huoneeseen (korvaa nykyisen sisällön)\n` +
            `Peruuta = Avaa henkilökohtaisessa editorissa`,
          )
        : false;
      if (choice) {
        importLocalFileToCollab(file, fileManager, ydoc, ytext, toast, closeFilesPanel);
      } else {
        openLocalFileInPersonal(file, fileManager);
      }
    }
  }

  collabFileActionImportEl?.addEventListener("click", () => {
    if (selectedCollabFile) {
      importLocalFileToCollab(selectedCollabFile, fileManager, ydoc, ytext, toast, closeFilesPanel);
    }
    closeCollabFileModal();
  });

  collabFileActionOpenEl?.addEventListener("click", () => {
    if (selectedCollabFile) {
      openLocalFileInPersonal(selectedCollabFile, fileManager);
    }
    closeCollabFileModal();
  });

  collabFileModalCloseEl?.addEventListener("click", () => {
    closeCollabFileModal();
  });

  collabFileModalEl?.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeCollabFileModal();
  });

  collabFileModalEl?.addEventListener("click", (e) => {
    if (e.target === collabFileModalEl) {
      closeCollabFileModal();
    }
  });

  function renderFilesList() {
    if (!filesListEl) return;
    const files = fileManager.listFiles();
    const activeId = fileManager.getActiveFileId();
    filesListEl.innerHTML = "";

    for (const file of files) {
      const li = document.createElement("li");
      const isActive = file.id === activeId;
      li.className = "file-item" + (isActive ? " active" : "");
      li.dataset.id = file.id;

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "file-select-btn";
      selectBtn.setAttribute("title", `Valitse ${file.name}`);
      if (isActive) {
        selectBtn.setAttribute("aria-current", "true");
      }

      const infoSpan = document.createElement("span");
      infoSpan.className = "file-info";

      const nameSpan = document.createElement("span");
      nameSpan.className = "file-name";
      nameSpan.textContent = file.name;
      infoSpan.appendChild(nameSpan);

      if (file.updatedAt) {
        const timeSpan = document.createElement("span");
        timeSpan.className = "file-time";
        timeSpan.textContent = formatFileDate(file.updatedAt);
        infoSpan.appendChild(timeSpan);
      }
      selectBtn.appendChild(infoSpan);

      if (isActive) {
        const badge = document.createElement("span");
        badge.className = "file-badge";
        badge.textContent = "Aktiivinen";
        selectBtn.appendChild(badge);
      }

      selectBtn.addEventListener("click", () => {
        promptCollabFileAction(file);
      });
      li.appendChild(selectBtn);

      const actions = document.createElement("div");
      actions.className = "file-actions";

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "iconbtn file-rename-btn";
      renameBtn.setAttribute("title", `Nimeä uudelleen: ${file.name}`);
      renameBtn.setAttribute("aria-label", `Nimeä uudelleen: ${file.name}`);
      renameBtn.innerHTML =
        '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-edit" /></svg>';
      renameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const newName = window.prompt("Anna uusi tiedostonimi:", file.name);
        if (newName && newName.trim() && newName.trim() !== file.name) {
          try {
            fileManager.renameFile(file.id, newName.trim());
            renderFilesList();
          } catch (err) {
            fail(err instanceof Error ? err.message : String(err));
          }
        }
      });
      actions.appendChild(renameBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "iconbtn file-delete-btn";
      deleteBtn.setAttribute("title", `Poista tiedosto: ${file.name}`);
      deleteBtn.setAttribute("aria-label", `Poista tiedosto: ${file.name}`);
      deleteBtn.innerHTML =
        '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-trash" /></svg>';
      if (files.length <= 1) {
        deleteBtn.disabled = true;
        deleteBtn.setAttribute("title", "Viimeistä tiedostoa ei voi poistaa");
      }
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (files.length <= 1) {
          toast("Viimeistä tiedostoa ei voi poistaa.");
          return;
        }
        if (!window.confirm(`Haluatko varmasti poistaa tiedoston "${file.name}"?`)) {
          return;
        }
        try {
          fileManager.deleteFile(file.id);
          renderFilesList();
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
        }
      });
      actions.appendChild(deleteBtn);

      li.appendChild(actions);
      filesListEl.appendChild(li);
    }
  }

  if (filesToggleEl) {
    filesToggleEl.addEventListener("click", () => toggleFilesPanel());
    filesCloseEl?.addEventListener("click", () => closeFilesPanel());

    if (filesSaveCollabEl) {
      filesSaveCollabEl.hidden = false;
      filesSaveCollabEl.addEventListener("click", () => {
        const defaultName = fileManager.suggestFileName(`yhteistyo-${roomId}.md`);
        const chosenName = typeof window.prompt === "function"
          ? window.prompt("Tallenna huone paikalliseksi tiedostoksi nimellä:", defaultName)
          : defaultName;
        if (chosenName && chosenName.trim()) {
          try {
            saveCollabToLocal(fileManager, ytext, roomId, {
              asNewFile: true,
              customName: chosenName.trim(),
              toast: (msg) => toast(msg),
            });
            renderFilesList();
          } catch (err) {
            fail(err instanceof Error ? err.message : String(err));
          }
        }
      });
    }

    filesNewEl?.addEventListener("click", () => {
      try {
        const created = fileManager.createFile();
        toast(`Uusi tiedosto "${created.name}" luotu.`);
        renderFilesList();
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && filesPanelEl && !filesPanelEl.hidden) {
        event.preventDefault();
        closeFilesPanel();
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (!filesPanelEl || filesPanelEl.hidden) return;
      const target = event.target as Node | null;
      if (
        target &&
        !filesPanelEl.contains(target) &&
        !filesToggleEl.contains(target) &&
        (!collabFileModalEl || !collabFileModalEl.contains(target))
      ) {
        closeFilesPanel();
      }
    });
  }

  // Top banner button: Kopioi omaan luonnokseen
  saveLocalBtn.addEventListener("click", () => {
    const activeFile = fileManager.getActiveFile();
    const shouldUpdateActive = typeof window.confirm === "function"
      ? window.confirm(
          `Päivitetäänkö aktiivinen luonnos "${activeFile.name}" huoneen sisällöllä?\n\n` +
          `Valitse OK päivittääksesi "${activeFile.name}" tai Peruuta tallentaaksesi uutena tiedostona.`,
        )
      : true;

    if (shouldUpdateActive) {
      try {
        saveCollabToLocal(fileManager, ytext, roomId, {
          asNewFile: false,
          toast,
        });
        renderFilesList();
      } catch (err) {
        toast("Kopiointi epäonnistui: " + String(err));
      }
    } else {
      const defaultName = fileManager.suggestFileName(`yhteistyo-${roomId}.md`);
      const chosenName = typeof window.prompt === "function"
        ? window.prompt("Tallenna uutena tiedostona nimellä:", defaultName)
        : defaultName;
      if (chosenName && chosenName.trim()) {
        try {
          saveCollabToLocal(fileManager, ytext, roomId, {
            asNewFile: true,
            customName: chosenName.trim(),
            toast,
          });
          renderFilesList();
        } catch (err) {
          toast("Tallennus epäonnistui: " + String(err));
        }
      }
    }
  });

  exitBtn.addEventListener("click", () => {
    window.location.hash = "#/";
  });

  // Cleanup on unload or navigation
  window.addEventListener(
    "beforeunload",
    () => {
      try {
        collabSelectionManager?.clearLocalSelection();
        renderCoordinator.destroy();
        idbProvider?.destroy();
        provider.destroy();
        ydoc.destroy();
      } catch {
        /* ignore */
      }
    },
    { once: true },
  );
}

/**
 * Renders an informative error view when a collaborative link is malformed or server returns an error.
 * Guarantees personal localStorage is unaltered.
 */
export function renderCollabError(
  message: string,
  title: string = "Virheellinen muokkauslinkki",
  details: string = "Yhteismuokkaus vaatii toimivan huonetunnisteen sekä salaisen valtuutusavaimen. Tarkista linkki tai palaa henkilökohtaiseen editoriin.",
) {
  document.body.classList.remove("show-editor", "show-preview");
  document.body.classList.add("collab-error-view");

  const bannerEl = document.getElementById("viewer-banner");
  if (bannerEl) {
    bannerEl.hidden = false;
    bannerEl.style.background = "#c62828";
    bannerEl.textContent = `${title}: ${message}`;
  }

  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = title.toLowerCase();
    statusEl.classList.add("error");
  }

  const appMain = document.querySelector("main");
  if (appMain) {
    for (const child of Array.from(appMain.children)) {
      (child as HTMLElement).style.display = "none";
    }

    const existingContainer = document.getElementById("collab-error-container");
    if (existingContainer) {
      existingContainer.remove();
    }

    const errorContainer = document.createElement("div");
    errorContainer.id = "collab-error-container";
    errorContainer.className = "error-card-container";
    errorContainer.setAttribute("role", "alert");
    errorContainer.innerHTML = `
      <div class="collab-error-card">
        <h2 style="margin-top: 0; color: #b71c1c;">${escapeHtml(title)}</h2>
        <p style="margin: 1rem 0; font-size: 1rem; color: #37474f;">${escapeHtml(message)}</p>
        <p style="color: #607d8b; font-size: 0.9rem; line-height: 1.4;">
          ${escapeHtml(details)}
        </p>
        <div style="margin-top: 1.5rem;">
          <button id="return-personal-btn" class="textbtn" style="background: #1565c0; font-size: 0.95rem; padding: 0.6rem 1.2rem;">
            Palaa henkilökohtaiseen editoriin
          </button>
        </div>
      </div>
    `;
    appMain.appendChild(errorContainer);

    document.getElementById("return-personal-btn")?.addEventListener("click", () => {
      window.location.hash = "#/";
      window.location.reload();
    });
  }
}

/**
 * Handles HTTP response codes from collaboration endpoints, rendering Finnish error cards for
 * service disablement (503), participant caps (429), missing rooms (404), or authorization failures (401).
 * Returns true if the status represented an error condition.
 */
export function handleCollabStatusError(status: number): boolean {
  if (status === 503) {
    renderCollabError(
      "Yhteistyöominaisuus ei ole käytettävissä",
      "Yhteistyöpalvelu on tilapäisesti pois käytöstä",
      "Yhteistyöpalvelin ei tällä hetkellä ota vastaan yhteyksiä. Voit jatkaa asiakirjasi muokkausta henkilökohtaisessa editorissa.",
    );
    return true;
  }
  if (status === 429) {
    renderCollabError(
      "Huone on täynnä (enintään 20 osallistujaa)",
      "Huone on täynnä",
      "Tässä huoneessa on jo suurin sallittu määrä samanaikaisia osallistujia (20). Odota, että joku poistuu tai palaa henkilökohtaiseen editoriin.",
    );
    return true;
  }
  if (status === 404) {
    renderCollabError(
      "Huonetta ei löydy",
      "Huonetta ei löydy",
      "Pyydettyä yhteistyöhuonetta ei ole olemassa tai se on vanhentunut 7 päivän käyttämättömyyden jälkeen.",
    );
    return true;
  }
  if (status === 401) {
    renderCollabError(
      "Virheellinen valtuutusavain",
      "Pääsy estetty",
      "Yhteistyöhuoneeseen liittyminen vaatii toimivan valtuutusavaimen. Tarkista saamasi linkki tai palaa henkilökohtaiseen editoriin.",
    );
    return true;
  }
  return false;
}
