// Collaborative editor implementation for Phase 3.
// Powered by Yjs CRDTs, WebSocket synchronization, IndexedDB persistence,
// CodeMirror 6 binding with Y.UndoManager isolation, and live Typst.ts preview.

import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { vim, getCM } from "@replit/codemirror-vim";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";

import { createPreview, type Logo } from "./preview.ts";
import { createToaster } from "./ui.ts";
import { getCollabWsUrl } from "./config.ts";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
 * Initializes the full collaborative editor experience.
 */
export function initCollabEditor(roomId: string, token: string) {
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

  // In collaborative mode, hide the single-user reset & share buttons
  if (resetEl) resetEl.hidden = true;
  if (shareEl) shareEl.hidden = true;

  // Clarify in the UI that uploaded logos are purely local
  if (logoLabelEl) {
    logoLabelEl.title = "Lisää logo (vain omaan esikatseluun – ei jaeta)";
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

  // --- Initialize Typst Preview ---
  let localLogo: { path: string; name: string; bytes: Uint8Array } | undefined;
  const logoForPreview = (): Logo | undefined =>
    localLogo ? { path: localLogo.path, bytes: localLogo.bytes } : undefined;

  function showLogoControls() {
    logoClearEl.hidden = localLogo === undefined;
    logoClearEl.title = localLogo ? localLogo.name : "";
  }
  showLogoControls();

  const preview = createPreview(
    {
      previewEl: document.getElementById("preview")!,
      pagesEl: document.getElementById("pages")!,
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
      },
    },
  );

  // --- Initialize Yjs CRDT & Providers ---
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");

  let idbProvider: IndexeddbPersistence | null = null;
  try {
    idbProvider = new IndexeddbPersistence("sfs2487.collab." + roomId, ydoc);
  } catch (err) {
    console.warn("IndexedDB persistence could not be initialized:", err);
  }

  const wsUrl = getCollabWsUrl();
  const provider = new WebsocketProvider(wsUrl, roomId, ydoc, {
    params: { token },
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

  provider.awareness.on("change", renderCollaborators);
  renderCollaborators();

  let isSynced = false;
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
      // Initial render once document content is synced
      void preview.render(ytext.toString(), logoForPreview());
    }
  });

  // Observe text changes for debounced preview rendering
  let renderDebounceTimer: number | undefined;
  let savingTimer: number | undefined;

  function schedulePreviewRender() {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = window.setTimeout(() => {
      void preview.render(ytext.toString(), logoForPreview());
    }, 300);
  }

  ytext.observe((event) => {
    // If not local origin, trigger preview update
    if (event.transaction.origin !== ytext) {
      schedulePreviewRender();
    }
  });

  // --- Initialize CodeMirror 6 ---
  editorEl.innerHTML = ""; // Clear stub

  // Vim preference support
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
      // Collaborative extension: binds ytext and remote cursors/selections
      yCollab(ytext, provider.awareness, { undoManager }),
      // Collaborative undo/redo keymap: isolates local changes without reverting remote edits
      keymap.of([...defaultKeymap, ...yUndoManagerKeymap]),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        // Indicate saving state temporarily
        updateConnectionBadge("saving");
        clearTimeout(savingTimer);
        savingTimer = window.setTimeout(() => {
          updateConnectionBadge(isSynced ? "connected" : "connecting");
        }, 600);
        schedulePreviewRender();
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
      return;
    }
    const cm = getCM(editor);
    if (!cm) {
      vimModeEl.hidden = true;
      return;
    }
    showVimMode("normal");
    cm.on("vim-mode-change", (e: { mode: string; subMode?: string }) =>
      showVimMode(e.mode, e.subMode),
    );
  }
  function applyVim() {
    const on = vimEl.checked && keyboardPresent;
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

  // --- Local Logo Upload (Not shared with collaborators) ---
  logoEl.addEventListener("change", async () => {
    const file = logoEl.files?.[0];
    if (!file) return;
    const path = logoPathFor(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    localLogo = { path, name: file.name, bytes };
    showLogoControls();
    void preview.render(ytext.toString(), logoForPreview());
    toast("Logo lisätty omaan esikatseluusi (ei jaeta muille muokkaajille)");
  });

  logoClearEl.addEventListener("click", () => {
    localLogo = undefined;
    logoEl.value = "";
    showLogoControls();
    void preview.render(ytext.toString(), logoForPreview());
  });

  // --- PDF Download Button ---
  downloadEl.addEventListener("click", async () => {
    try {
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

  saveLocalBtn.addEventListener("click", () => {
    const currentText = ytext.toString();
    try {
      localStorage.setItem("sfs2487.doc", currentText);
      toast("Asiakirja kopioitu henkilökohtaiseen luonnokseesi!");
    } catch (err) {
      toast("Kopiointi epäonnistui: " + String(err));
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
 * Renders an informative error view when a collaborative link is malformed or missing tokens.
 * Guarantees personal localStorage is unaltered.
 */
export function renderCollabError(message: string) {
  document.body.classList.remove("show-editor", "show-preview");
  document.body.classList.add("collab-error-view");

  const bannerEl = document.getElementById("viewer-banner");
  if (bannerEl) {
    bannerEl.hidden = false;
    bannerEl.style.background = "#c62828";
    bannerEl.textContent = message;
  }

  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = "virheellinen linkki";
    statusEl.classList.add("error");
  }

  const appMain = document.querySelector("main");
  if (appMain) {
    for (const child of Array.from(appMain.children)) {
      (child as HTMLElement).style.display = "none";
    }

    const errorContainer = document.createElement("div");
    errorContainer.id = "collab-error-container";
    errorContainer.className = "error-card-container";
    errorContainer.setAttribute("role", "alert");
    errorContainer.innerHTML = `
      <div class="collab-error-card">
        <h2 style="margin-top: 0; color: #b71c1c;">Virheellinen muokkauslinkki</h2>
        <p style="margin: 1rem 0; font-size: 1rem; color: #37474f;">${escapeHtml(message)}</p>
        <p style="color: #607d8b; font-size: 0.9rem; line-height: 1.4;">
          Yhteismuokkaus vaatii toimivan huonetunnisteen sekä salaisen valtuutusavaimen.
          Tarkista linkki tai palaa henkilökohtaiseen editoriin.
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
