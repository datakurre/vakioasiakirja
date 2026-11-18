// The full editor experience: CodeMirror Markdown input, live typst.ts preview
// (via src/preview.ts), logo upload, Vim toggle, the movable split divider, and
// the "Jaa" live-preview sharing control (via src/share.ts). Booted by
// src/main.ts for the default (non-viewer) route.

import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { Compartment, Prec, type EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { vim, getCM, Vim } from "@replit/codemirror-vim";

import { createPreview, type Logo } from "./preview.ts";
import { createToaster, bytesToBase64, base64ToBytes } from "./ui.ts";
import {
  Broadcaster,
  isSharingEnabled,
  randomCollabRoomId,
  generateCollabToken,
  type Snapshot,
  type SelectionPayload,
} from "./share.ts";
import { SelectionHighlighter } from "./selection-highlighter.ts";
import { FileManager, formatFileDate } from "./files.ts";
import { getCollabUrl } from "./config.ts";
import { getActiveBranding } from "./branding.ts";
import { TemplateManager } from "./template-manager.ts";
import { getDocumentTemplates } from "./templates.ts";
import { importFromDocx } from "./docx.ts";
import { createAutoscrollTracker } from "./autoscroll.ts";
import { DownloadDialog } from "./download-dialog.ts";
// The default seed document (generic Muistio template), kept so the bundle is self-contained.
import seed from "./seed.md?raw";

export function initEditor() {
  const statusEl = document.getElementById("status")!;
  const downloadEl = document.getElementById("download") as HTMLButtonElement;
  const logoEl = document.getElementById("logo") as HTMLInputElement;
  const logoClearEl = document.getElementById("logo-clear") as HTMLButtonElement;
  const vimEl = document.getElementById("vim") as HTMLInputElement;
  const vimModeEl = document.getElementById("vim-mode")!;
  const resetEl = document.getElementById("reset") as HTMLButtonElement;
  const toastsEl = document.getElementById("toasts")!;
  const mainEl = document.querySelector("main")!;
  const editorEl = document.getElementById("editor")!;
  const dividerEl = document.getElementById("divider")!;
  const showEditorEl = document.getElementById("show-editor") as HTMLButtonElement;
  const showPreviewEl = document.getElementById("show-preview") as HTMLButtonElement;
  const filesToggleEl = document.getElementById("files-toggle") as HTMLButtonElement;
  const filesPanelEl = document.getElementById("files-panel")!;
  const filesCloseEl = document.getElementById("files-close") as HTMLButtonElement;
  const filesNewEl = document.getElementById("files-new") as HTMLButtonElement;
  const filesListEl = document.getElementById("files-list")!;
  const shareEl = document.getElementById("share") as HTMLButtonElement;
  const sharePanelEl = document.getElementById("share-panel")!;
  const shareCloseEl = document.getElementById("share-close") as HTMLButtonElement;
  const shareStatusEl = document.getElementById("share-status")!;
  const shareOptionsEl = document.getElementById("share-options") as HTMLElement;
  const shareActionReadonlyEl = document.getElementById("share-action-readonly") as HTMLButtonElement;
  const shareActionCollabEl = document.getElementById("share-action-collab") as HTMLButtonElement;
  const collabCreateErrorEl = document.getElementById("collab-create-error");
  const shareRowEl = document.getElementById("share-row")!;
  const shareFootEl = document.getElementById("share-foot") as HTMLElement;
  const shareViewersEl = document.getElementById("share-viewers");
  const shareUrlEl = document.getElementById("share-url") as HTMLInputElement;
  const shareCopyEl = document.getElementById("share-copy") as HTMLButtonElement;
  const shareStopEl = document.getElementById("share-stop") as HTMLButtonElement;
  const shareCountEl = document.getElementById("share-count")!;

  const toast = createToaster(toastsEl);
  const setStatus = (text: string, error = false) => {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", error);
  };
  const fail = (message: string) => {
    setStatus("virhe", true);
    toast(message);
  };

  const pagesEl = document.getElementById("pages")!;
  const selectionHighlighter = new SelectionHighlighter();
  let currentSelection: SelectionPayload | null = null;
  let visualModeActive = false;
  let visualSubMode: "visual" | "linewise" | "blockwise" = "visual";

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
      autoscrollEl: document.getElementById("autoscroll") as HTMLButtonElement,
    },
    {
      setStatus,
      fail,
      viewStorageKey: "sfs2487.view",
      onRendered: () => {
        downloadEl.disabled = false;
      },
    },
  );

  // --- localStorage persistence (document, logo, vim, split) ---
  const STORE = {
    doc: "sfs2487.doc",
    logo: "sfs2487.logo",
    logoCleared: "sfs2487.logoCleared",
    vim: "sfs2487.vim",
    split: "sfs2487.split",
  };
  interface StoredLogo { path: string; name: string; b64: string }

  const branding = getActiveBranding();
  let defaultLogoBytes: Uint8Array | undefined;
  if (branding.defaultLogo?.svgText) {
    defaultLogoBytes = new TextEncoder().encode(branding.defaultLogo.svgText);
  }

  function lsGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function lsSet(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* quota or disabled */ }
  }
  function lsRemove(key: string) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  // An uploaded or bundled logo image, mapped into the typst.ts shadow filesystem by the
  // preview. The frontmatter `logo:` key is a filesystem path the browser cannot
  // read, so the logo is driven by the upload control or association default (see withoutLogo).
  let logo: { path: string; name: string; bytes: Uint8Array } | undefined;
  let templateLogo: { path: string; name: string; bytes: Uint8Array } | undefined;

  function getEffectiveLogo(): { path: string; name: string; bytes: Uint8Array } | undefined {
    // 1. Explicitly cleared by user
    if (lsGet(STORE.logoCleared) === "1") {
      return undefined;
    }
    // 2. User-uploaded logo
    if (logo) {
      return logo;
    }
    // 3. The active document template's bundled SVG logo
    if (templateLogo) {
      return templateLogo;
    }
    // 4. Fallback to association default logo
    if (branding.defaultLogo && defaultLogoBytes) {
      return {
        path: branding.defaultLogo.path,
        name: branding.defaultLogo.name,
        bytes: defaultLogoBytes,
      };
    }
    return undefined;
  }

  const logoForPreview = (): Logo | undefined => {
    const eff = getEffectiveLogo();
    return eff ? { path: eff.path, bytes: eff.bytes } : undefined;
  };

  function showLogo() {
    const eff = getEffectiveLogo();
    logoClearEl.hidden = eff === undefined;
    logoClearEl.title = eff ? eff.name : "";
  }

  // The seeded example references an external logo file the browser cannot read;
  // drop the frontmatter line so it never reaches the converter.
  function withoutLogo(md: string): string {
    return md.replace(/^logo:.*$/m, "");
  }

  function getInitialDefaultSeed(): string {
    const templates = getDocumentTemplates();
    const muistioTpl = templates.find((t) => t.id === "muistio");
    if (muistioTpl?.content) {
      return withoutLogo(muistioTpl.content);
    }
    return withoutLogo(seed);
  }

  const fileManager = new FileManager({
    defaultSeed: getInitialDefaultSeed(),
  });

  function templateLogoStorageKey(fileId = fileManager.getActiveFile().id): string {
    return `sfs2487.templateLogo.${fileId}`;
  }

  function logoPathFor(file: File): string {
    if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return "/logo.svg";
    if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "/logo.jpg";
    return "/logo.png";
  }

  function restoreLogo() {
    const raw = lsGet(STORE.logo);
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as StoredLogo;
      logo = { path: s.path, name: s.name, bytes: base64ToBytes(s.b64) };
    } catch {
      lsRemove(STORE.logo);
    }
  }

  function restoreTemplateLogo(fileId = fileManager.getActiveFile().id) {
    const storageKey = templateLogoStorageKey(fileId);
    const raw = lsGet(storageKey);
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as StoredLogo;
      templateLogo = { path: s.path, name: s.name, bytes: base64ToBytes(s.b64) };
    } catch {
      lsRemove(storageKey);
    }
  }
  restoreLogo();
  restoreTemplateLogo();
  showLogo();

  // --- live-preview sharing ("Jaa") ---
  let broadcaster: Broadcaster | undefined;
  let shareState: "idle" | "starting" | "active" = "idle";

  function isSharePanelOpen(): boolean {
    return Boolean(sharePanelEl && !sharePanelEl.hidden);
  }

  function syncShareControls() {
    const active = shareState === "active";
    const open = isSharePanelOpen();
    shareEl.setAttribute("aria-pressed", String(active));
    shareEl.setAttribute("aria-expanded", String(open));
    shareEl.setAttribute("aria-controls", "share-panel");
    shareEl.title = active
      ? (open ? "Sulje jakamisen tiedot" : "Jako käynnissä (näytä jakamisvalikko)")
      : (open ? "Sulje jakamisvalikko" : "Jaa asiakirja");
  }

  function updateViewerCount(count: number) {
    if (shareCountEl) shareCountEl.textContent = String(count);
  }

  function renderSharePanelState() {
    if (collabCreateErrorEl) {
      collabCreateErrorEl.hidden = true;
      collabCreateErrorEl.textContent = "";
    }
    if (shareActionCollabEl) {
      shareActionCollabEl.disabled = false;
      const strongEl = shareActionCollabEl.querySelector("strong");
      if (strongEl) strongEl.textContent = "Jaa muokattavana";
    }

    if (shareState === "idle") {
      shareStatusEl.textContent = "Valitse jakamistapa:";
      shareOptionsEl.hidden = false;
      shareRowEl.hidden = true;
      if (shareFootEl) shareFootEl.hidden = true;
      if (shareViewersEl) shareViewersEl.hidden = true;
      shareUrlEl.value = "";
      updateViewerCount(0);
    } else if (shareState === "starting") {
      shareStatusEl.textContent = "Muodostetaan yhteyttä jakopalveluun…";
      shareOptionsEl.hidden = true;
      shareRowEl.hidden = true;
      if (shareFootEl) shareFootEl.hidden = false;
      if (shareViewersEl) shareViewersEl.hidden = true;
    } else {
      shareStatusEl.textContent = "Jaat esikatselua. Lähetä linkki katsojille:";
      shareOptionsEl.hidden = true;
      shareRowEl.hidden = false;
      if (shareFootEl) shareFootEl.hidden = false;
      if (shareViewersEl) shareViewersEl.hidden = false;
      if (broadcaster) {
        shareUrlEl.value = broadcaster.watchUrl();
      }
    }
  }

  function openSharePanel() {
    if (!filesPanelEl.hidden) closeFilesPanel();
    renderSharePanelState();
    sharePanelEl.hidden = false;
    syncShareControls();
  }

  function closeSharePanel(restoreFocus = true) {
    if (sharePanelEl.hidden) return;
    sharePanelEl.hidden = true;
    syncShareControls();
    if (restoreFocus) {
      shareEl.focus();
    }
  }

  // The snapshot pushed to viewers: the document plus the uploaded logo bytes,
  // so a viewer reproduces the preview with the same render() pipeline.
  function snapshot(): Snapshot {
    const effectiveLogo = getEffectiveLogo();
    return {
      markdown: editor.state.doc.toString(),
      logo: effectiveLogo
        ? { name: effectiveLogo.name, path: effectiveLogo.path, b64: bytesToBase64(effectiveLogo.bytes) }
        : null,
    };
  }

  async function startSharing() {
    if (broadcaster) return;
    let bc: Broadcaster | undefined;
    try {
      bc = new Broadcaster(
        (count) => {
          updateViewerCount(count);
        },
        (message) => {
          if (broadcaster === bc) {
            stopSharing();
            fail(message);
          }
        },
        (warning) => {
          toast(warning);
        },
      );
      broadcaster = bc;
      shareState = "starting";
      renderSharePanelState();
      syncShareControls();

      await bc.start(snapshot());
      // The user may have explicitly stopped the share while startup awaited
      // signaling setup. Do not revive a stopped session or overwrite a new one.
      if (broadcaster !== bc) {
        bc.stop();
        return;
      }
      shareState = "active";
      renderSharePanelState();
      bc.push(snapshot());
      if (currentSelection?.active) {
        bc.pushSelection(currentSelection);
      }
      syncShareControls();
    } catch (e) {
      bc?.stop();
      if (!bc || broadcaster === bc) {
        stopSharing();
        fail(e instanceof Error ? e.message : String(e));
      }
    }
  }

  function stopSharing() {
    const bc = broadcaster;
    broadcaster = undefined;
    shareState = "idle";
    bc?.stop();
    renderSharePanelState();
    syncShareControls();
  }

  // --- Collaborative Room Creation ---
  shareActionCollabEl?.addEventListener("click", async () => {
    shareActionCollabEl.disabled = true;
    const strongEl = shareActionCollabEl.querySelector("strong");
    const originalText = strongEl?.textContent || "Jaa muokattavana";
    if (strongEl) strongEl.textContent = "Luodaan huonetta…";
    if (collabCreateErrorEl) {
      collabCreateErrorEl.hidden = true;
      collabCreateErrorEl.textContent = "";
    }

    try {
      const roomId = randomCollabRoomId(8);
      const token = generateCollabToken();
      const collabUrl = getCollabUrl();
      const currentMarkdown = editor.state.doc.toString();

      const res = await fetch(`${collabUrl}/collab/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          token,
          initialMarkdown: currentMarkdown,
        }),
      });

      if (!res.ok) {
        let errMsg = `Palvelinvirhe (${res.status})`;
        if (res.status === 503) {
          errMsg = "Yhteistyöpalvelu on tilapäisesti pois käytöstä (COLLAB_ENABLED=false)";
        } else {
          try {
            const data = (await res.json()) as { error?: string };
            if (data.error) errMsg = data.error;
          } catch {
            /* ignore */
          }
        }
        throw new Error(errMsg);
      }

      if (broadcaster) {
        stopSharing();
      }

      closeSharePanel();
      window.location.hash = `#/edit/${roomId}/${token}`;
    } catch (err) {
      shareActionCollabEl.disabled = false;
      if (strongEl) strongEl.textContent = originalText;
      const msg = `Yhteismuokkauksen luominen epäonnistui: ${err instanceof Error ? err.message : String(err)}`;
      if (collabCreateErrorEl) {
        collabCreateErrorEl.hidden = false;
        collabCreateErrorEl.textContent = msg;
      }
      toast(msg);
    }
  });

  if (shareEl) {
    if (isSharingEnabled()) {
      shareEl.hidden = false;
      shareEl.addEventListener("click", () => {
        if (isSharePanelOpen()) closeSharePanel();
        else openSharePanel();
      });

      shareActionReadonlyEl?.addEventListener("click", () => {
        void startSharing();
      });

      shareStopEl?.addEventListener("click", () => {
        stopSharing();
      });

      shareCloseEl?.addEventListener("click", () => {
        closeSharePanel(true);
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !sharePanelEl.hidden) {
          event.preventDefault();
          closeSharePanel(true);
        }
      });

      document.addEventListener("pointerdown", (event) => {
        if (sharePanelEl.hidden) return;
        const target = event.target as Node | null;
        if (target && !sharePanelEl.contains(target) && !shareEl.contains(target)) {
          closeSharePanel(false);
        }
      });

      shareCopyEl?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(shareUrlEl.value);
          shareCopyEl.setAttribute("aria-label", "Kopioitu");
          shareCopyEl.title = "Kopioitu";
          window.setTimeout(() => {
            shareCopyEl.setAttribute("aria-label", "Kopioi linkki");
            shareCopyEl.title = "Kopioi linkki";
          }, 1500);
        } catch {
          shareUrlEl.select(); // clipboard blocked: let the user copy manually
        }
      });
    }
  }

  let hasInitialRendered = false;

  // Render, and (when sharing) push the fresh snapshot to viewers.
  function update(md: string, liveEdit = true) {
    const isLive = hasInitialRendered ? liveEdit : false;
    hasInitialRendered = true;
    void preview.render(md, logoForPreview(), { liveEdit: isLive }).then(() => {
      if (currentSelection?.active) {
        selectionHighlighter.update(pagesEl, currentSelection);
      }
      autoscrollTracker?.sync();
    });
    broadcaster?.push(snapshot());
  }

  downloadEl.title = "Lataa asiakirja (PDF, Word, Markdown) [Ctrl+Shift+S]";
  downloadEl.setAttribute("aria-label", "Lataa asiakirja (PDF, Word, Markdown) [Ctrl+Shift+S]");

  const downloadPdf = async () => {
    try {
      const pdf = await preview.pdf();
      if (!pdf) return;
      const blob = new Blob([pdf as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = fileManager.getActiveFile().name.replace(/\.[^.]+$/, "") || "asiakirja";
      a.download = `${baseName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Asiakirja ladattu PDF-muodossa (${baseName}.pdf).`, "success");
    } catch (e) {
      fail(String(e));
    }
  };

  downloadEl.addEventListener("click", () => {
    downloadDialog?.open();
  });

  logoEl.addEventListener("change", async () => {
    const file = logoEl.files?.[0];
    if (!file) return;
    const path = logoPathFor(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    logo = { path, name: file.name, bytes };
    lsRemove(STORE.logoCleared);
    lsSet(STORE.logo, JSON.stringify({ path, name: file.name, b64: bytesToBase64(bytes) }));
    showLogo();
    update(editor.state.doc.toString());
  });

  function clearLogo() {
    logo = undefined;
    templateLogo = undefined;
    logoEl.value = "";
    lsRemove(STORE.logo);
    lsRemove(templateLogoStorageKey());
    lsSet(STORE.logoCleared, "1");
    showLogo();
  }

  logoClearEl.addEventListener("click", () => {
    clearLogo();
    update(editor.state.doc.toString());
  });

  // Vim keybindings live in a compartment so the toggle can reconfigure them
  // without rebuilding the editor.
  const vimCompartment = new Compartment();
  const vimWanted = lsGet(STORE.vim) === "1";
  vimEl.checked = vimWanted;

  // Vim only makes sense with a physical keyboard, so it is gated on the same
  // signals the CSS uses to reveal the control: a precise pointer + hover
  // (mouse/trackpad, which implies a keyboard), or real keyboard input detected
  // at runtime. There is no web API for hardware-keyboard presence, so this is a
  // pragmatic best effort — see onKeyboard() below for the runtime heuristic.
  const kbMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
  let keyboardPresent = kbMedia.matches;
  if (keyboardPresent) document.body.classList.add("keyboard");

  const selectionTheme = EditorView.theme({
    ".cm-selectionLayer .cm-selectionBackground": { backgroundColor: "#b3d4fc" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "#5b9dd9",
    },
  });

  function getSelectionPayload(state: EditorState): SelectionPayload | null {
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
      mode: visualModeActive ? visualSubMode : "standard",
      text,
      prefix,
      suffix,
      fromLine: lineFrom.number,
      toLine: lineTo.number,
      relPos,
    };
  }

  function syncSelection(state: EditorState) {
    const payload = getSelectionPayload(state);
    if (!payload) {
      if (currentSelection !== null) {
        currentSelection = null;
        broadcaster?.pushSelection(null);
        selectionHighlighter.update(pagesEl, null);
      }
      return;
    }
    currentSelection = payload;
    broadcaster?.pushSelection(payload);
    selectionHighlighter.update(pagesEl, payload);
  }

  let timer: number | undefined;
  let autoscrollTracker: ReturnType<typeof createAutoscrollTracker> | undefined;

  let lastSaveToastTime = 0;
  const triggerSave = () => {
    const now = Date.now();
    if (now - lastSaveToastTime < 200) return;
    lastSaveToastTime = now;
    fileManager.flush();
    fileManager.saveActiveContent(editor.state.doc.toString());
    toast("Tallennettu selaimeen", "success");
  };

  let downloadDialog: DownloadDialog | undefined;
  let lastDownloadDialogOpenTime = 0;
  const triggerDownloadDialog = () => {
    const now = Date.now();
    if (now - lastDownloadDialogOpenTime < 200) return;
    lastDownloadDialogOpenTime = now;
    downloadDialog?.open();
  };

  const editor = new EditorView({
    parent: editorEl,
    doc: fileManager.getActiveFile().content,
    extensions: [
      vimCompartment.of(vimWanted && keyboardPresent ? vim() : []),
      lineNumbers(),
      history(),
      drawSelection(),
      selectionTheme,
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              triggerSave();
              return true;
            },
          },
          {
            key: "Mod-Shift-s",
            run: () => {
              triggerDownloadDialog();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
      ),
      markdown(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const text = u.state.doc.toString();
          fileManager.saveActiveContentDebounced(text);
          clearTimeout(timer);
          timer = window.setTimeout(() => update(text, true), 300);
        }
        if (u.selectionSet || u.docChanged) {
          syncSelection(u.state);
        }
      }),
    ],
  });

  downloadDialog = new DownloadDialog({
    getMarkdown: () => editor.state.doc.toString(),
    getFilenameBase: () => fileManager.getActiveFile().name.replace(/\.[^.]+$/, "") || "asiakirja",
    onDownloadPdf: downloadPdf,
    toast,
    fail,
  });

  const autoscrollEl = document.getElementById("autoscroll") as HTMLButtonElement | null;
  autoscrollTracker = createAutoscrollTracker({
    buttonEl: autoscrollEl,
    previewEl: document.getElementById("preview")!,
    getEditorView: () => editor,
  });

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
  // Apply Vim only when the user wants it AND a keyboard is present; the
  // preference is persisted regardless, so it takes effect once a keyboard
  // appears (a touch device kept in Vim's normal mode would otherwise trap the
  // on-screen keyboard).
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
    lsSet(STORE.vim, vimEl.checked ? "1" : "0");
    applyVim();
    editor.focus();
  });

  // Reveal and enable Vim once a keyboard is detected — covers a tablet with a
  // keyboard but a coarse pointer, which the media query above misses (e.g. an
  // iPad with a Bluetooth keyboard). Keys an on-screen keyboard rarely emits are
  // a strong hardware-keyboard signal.
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
        e.key === "Tab" || e.key === "Escape" || e.altKey || e.ctrlKey || e.metaKey ||
        e.key.startsWith("Arrow") || /^F\d{1,2}$/.test(e.key)
      ) {
        onKeyboard();
      }
    },
    true,
  );
  syncVimMode();

  function showPane(pane: "editor" | "preview") {
    document.body.classList.toggle("show-editor", pane === "editor");
    document.body.classList.toggle("show-preview", pane === "preview");
    showEditorEl.setAttribute("aria-pressed", String(pane === "editor"));
    showPreviewEl.setAttribute("aria-pressed", String(pane === "preview"));
    if (pane === "editor") editor.focus();
    else preview.flashControls(); // hint that the floating controls exist
  }
  showEditorEl.addEventListener("click", () => showPane("editor"));
  showPreviewEl.addEventListener("click", () => showPane("preview"));

  function applyFileContentToEditor(content: string) {
    clearTimeout(timer);
    hasInitialRendered = false;
    preview.resetPulse?.();
    const cm = getCM(editor);
    if (cm) {
      try {
        Vim.exitVisualMode(cm as any, false);
      } catch {
        /* ignore */
      }
    }
    if (visualModeActive) {
      visualModeActive = false;
    }
    currentSelection = null;
    broadcaster?.pushSelection(null);
    selectionHighlighter.update(pagesEl, null);

    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
      selection: { anchor: 0 },
    });
    clearTimeout(timer);
    update(content, false);
  }

  function switchToFile(fileId: string) {
    fileManager.flush();
    fileManager.saveActiveContent(editor.state.doc.toString());
    const newFile = fileManager.setActiveFile(fileId);
    templateLogo = undefined;
    restoreTemplateLogo(fileId);
    showLogo();
    hasInitialRendered = false;
    preview.resetPulse?.();
    applyFileContentToEditor(newFile.content);
    renderFilesList();
  }

  // --- file manager drawer (tiedostonhallinta) ---
  function syncFilesControls() {
    const open = !filesPanelEl.hidden;
    filesToggleEl.setAttribute("aria-expanded", String(open));
    filesToggleEl.setAttribute("aria-pressed", String(open));
    filesToggleEl.title = open ? "Piilota tiedostot" : "Tiedostot";
    filesToggleEl.setAttribute("aria-label", filesToggleEl.title);
  }

  function openFilesPanel() {
    if (isSharePanelOpen()) closeSharePanel(false);
    renderFilesList();
    filesPanelEl.hidden = false;
    syncFilesControls();
  }

  function closeFilesPanel() {
    const focusWasInPanel = filesPanelEl.contains(document.activeElement);
    filesPanelEl.hidden = true;
    syncFilesControls();
    if (focusWasInPanel) filesToggleEl.focus();
  }

  function toggleFilesPanel() {
    if (filesPanelEl.hidden) openFilesPanel();
    else closeFilesPanel();
  }

  const templateDialogEl = document.getElementById("template-dialog") as HTMLDialogElement | null;
  const templateDialogCloseEl = document.getElementById("template-dialog-close") as HTMLButtonElement | null;
  const templateDialogCancelEl = document.getElementById("template-dialog-cancel") as HTMLButtonElement | null;
  const templateDialogReplaceEl = document.getElementById("template-dialog-replace") as HTMLButtonElement | null;
  const templateDialogGridEl = document.getElementById("template-dialog-grid") as HTMLElement | null;

  let templateManager: TemplateManager | undefined;
  if (templateDialogEl && templateDialogCloseEl && templateDialogCancelEl && templateDialogGridEl) {
    templateManager = new TemplateManager({
      dialogEl: templateDialogEl,
      closeEl: templateDialogCloseEl,
      cancelEl: templateDialogCancelEl,
      replaceEl: templateDialogReplaceEl,
      gridEl: templateDialogGridEl,
      onReplace: () => {
        promptImportDocxOrMd();
      },
      onSelectTemplate: (template) => {
        fileManager.flush();
        fileManager.saveActiveContent(editor.state.doc.toString());
        const newFile = fileManager.createFile(template.defaultFileName, template.content);
        templateLogo = template.logoSvg
          ? { path: "/template-logo.svg", name: `${template.title} (logo.svg)`, bytes: new TextEncoder().encode(template.logoSvg) }
          : undefined;
        if (templateLogo) {
          lsSet(templateLogoStorageKey(newFile.id), JSON.stringify({
            path: templateLogo.path,
            name: templateLogo.name,
            b64: bytesToBase64(templateLogo.bytes),
          }));
        } else {
          lsRemove(templateLogoStorageKey(newFile.id));
        }
        lsRemove(STORE.logoCleared);
        showLogo();
        applyFileContentToEditor(newFile.content);
        renderFilesList();
        closeFilesPanel();
        toast(`Asiakirja pohjasta "${template.title}" luotu.`, "success");
      },
    });
  }

  function promptImportDocxOrMd() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx,.md,.txt";
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        fileManager.flush();
        let content = "";
        if (file.name.endsWith(".docx")) {
          const buf = await file.arrayBuffer();
          content = importFromDocx(buf);
        } else {
          content = await file.text();
        }
        applyFileContentToEditor(content);
        fileManager.saveActiveContent(content);
        renderFilesList();
        closeFilesPanel();
        toast(`Avoimen asiakirjan sisältö korvattu tiedostolla "${file.name}"!`, "success");
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    });
    document.body.appendChild(input);
    input.click();
    input.remove();
  }

  const handleNewDocument = () => {
    if (templateManager) {
      templateManager.open();
    } else {
      fileManager.saveActiveContent(editor.state.doc.toString());
      const freshSeed = getInitialDefaultSeed();
      const newFile = fileManager.createFile(undefined, freshSeed);
      applyFileContentToEditor(newFile.content);
      renderFilesList();
    }
  };

  if (resetEl) {
    resetEl.title = "Uusi asiakirja";
    resetEl.setAttribute("aria-label", "Uusi asiakirja");
  }
  if (filesNewEl) {
    filesNewEl.title = "Uusi tiedosto";
    filesNewEl.setAttribute("aria-label", "Uusi tiedosto");
  }

  resetEl?.addEventListener("click", handleNewDocument);

  window.addEventListener("keydown", (e) => {
    const isMod = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
    if (isMod && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      triggerSave();
      return;
    }
    const isModShift = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
    if (isModShift && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      triggerDownloadDialog();
      return;
    }
  });

  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
    }
  });

  window.addEventListener("drop", async (e) => {
    if (!e.dataTransfer?.files?.length) return;
    const file = e.dataTransfer.files[0];
    if (!file.name.endsWith(".docx") && !file.name.endsWith(".md") && !file.name.endsWith(".txt")) {
      return;
    }
    e.preventDefault();
    try {
      fileManager.flush();
      fileManager.saveActiveContent(editor.state.doc.toString());
      let content = "";
      if (file.name.endsWith(".docx")) {
        const buf = await file.arrayBuffer();
        content = importFromDocx(buf);
      } else {
        content = await file.text();
      }
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const newFileName = fileManager.suggestFileName(`${baseName}.md`);
      const newFile = fileManager.createFile(newFileName, content);
      applyFileContentToEditor(newFile.content);
      renderFilesList();
      closeFilesPanel();
      toast(`Tiedosto "${newFile.name}" tuotu onnistuneesti!`, "success");
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

  if (filesToggleEl) {
    filesToggleEl.addEventListener("click", () => toggleFilesPanel());
    filesCloseEl?.addEventListener("click", () => closeFilesPanel());
    filesNewEl?.addEventListener("click", handleNewDocument);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !filesPanelEl.hidden) {
        event.preventDefault();
        closeFilesPanel();
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (filesPanelEl.hidden) return;
      const target = event.target as Node | null;
      if (target && !filesPanelEl.contains(target) && !filesToggleEl.contains(target)) {
        closeFilesPanel();
      }
    });
  }

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
      selectBtn.setAttribute("title", `Avaa ${file.name}`);
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
        if (file.id !== fileManager.getActiveFileId()) {
          switchToFile(file.id);
        }
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
          const wasActive = file.id === fileManager.getActiveFileId();
          const res = fileManager.deleteFile(file.id);
          if (wasActive) {
            applyFileContentToEditor(res.activeFile.content);
          }
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

  // --- movable split divider (editor | preview) ---
  function setSplit(px: number) {
    const min = 150;
    const max = mainEl.clientWidth - 150 - 6;
    const clamped = Math.min(max, Math.max(min, px));
    mainEl.style.setProperty("--split", `${clamped}px`);
    if (mainEl.clientWidth > 0) {
      dividerEl.setAttribute("aria-valuenow", String(Math.round((clamped / mainEl.clientWidth) * 100)));
    }
  }
  function persistSplit() {
    lsSet(STORE.split, mainEl.style.getPropertyValue("--split").replace("px", "").trim());
  }
  dividerEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dividerEl.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => setSplit(ev.clientX - mainEl.getBoundingClientRect().left);
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
  const savedSplit = lsGet(STORE.split);
  if (savedSplit) setSplit(parseFloat(savedSplit));

  window.addEventListener("beforeunload", () => {
    fileManager.flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      fileManager.flush();
    }
  });

  setStatus("alustetaan typst.ts…");
  update(editor.state.doc.toString(), false);
}
