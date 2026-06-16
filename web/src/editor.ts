// The full editor experience: CodeMirror Markdown input, live typst.ts preview
// (via src/preview.ts), logo upload, Vim toggle, the movable split divider, and
// the "Jaa" live-preview sharing control (via src/share.ts). Booted by
// src/main.ts for the default (non-viewer) route.

import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { vim, getCM } from "@replit/codemirror-vim";

import { createPreview, type Logo } from "./preview.ts";
import { createToaster, bytesToBase64, base64ToBytes } from "./ui.ts";
import { Broadcaster, isSharingEnabled, type Snapshot } from "./share.ts";
// A vendored copy of examples/markdown/esimerkki-poytakirja.md (spec Liite A),
// kept so the bundle is self-contained for both `npm run dev` and the nix build.
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
  const shareEl = document.getElementById("share") as HTMLButtonElement;
  const sharePanelEl = document.getElementById("share-panel")!;
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

  const preview = createPreview(
    {
      previewEl: document.getElementById("preview")!,
      pagesEl: document.getElementById("pages")!,
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
    vim: "sfs2487.vim",
    split: "sfs2487.split",
  };
  interface StoredLogo { path: string; name: string; b64: string }

  function lsGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function lsSet(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* quota or disabled */ }
  }
  function lsRemove(key: string) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  // An uploaded logo image, mapped into the typst.ts shadow filesystem by the
  // preview. The frontmatter `logo:` key is a filesystem path the browser cannot
  // read, so the logo is driven by the upload control instead (see withoutLogo).
  let logo: { path: string; name: string; bytes: Uint8Array } | undefined;
  const logoForPreview = (): Logo | undefined =>
    logo ? { path: logo.path, bytes: logo.bytes } : undefined;

  function showLogo() {
    logoClearEl.hidden = logo === undefined;
    logoClearEl.title = logo ? logo.name : "";
  }

  // The seeded example references an external logo file the browser cannot read;
  // drop the frontmatter line so it never reaches the converter.
  function withoutLogo(md: string): string {
    return md.replace(/^logo:.*$/m, "");
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
  restoreLogo();
  showLogo();

  // --- live-preview sharing ("Jaa") ---
  let broadcaster: Broadcaster | undefined;

  // The snapshot pushed to viewers: the document plus the uploaded logo bytes,
  // so a viewer reproduces the preview with the same render() pipeline.
  function snapshot(): Snapshot {
    return {
      markdown: editor.state.doc.toString(),
      logo: logo
        ? { name: logo.name, path: logo.path, b64: bytesToBase64(logo.bytes) }
        : null,
    };
  }

  async function startSharing() {
    if (broadcaster) return;
    const bc = new Broadcaster(
      (count) => { shareCountEl.textContent = String(count); },
      (message) => fail(message),
    );
    broadcaster = bc;
    shareEl.setAttribute("aria-pressed", "true");
    shareCountEl.textContent = "0";
    try {
      await bc.start();
      bc.push(snapshot());
      shareUrlEl.value = bc.watchUrl();
      sharePanelEl.hidden = false;
    } catch (e) {
      fail(String(e));
      stopSharing();
    }
  }

  function stopSharing() {
    broadcaster?.stop();
    broadcaster = undefined;
    shareEl.setAttribute("aria-pressed", "false");
    sharePanelEl.hidden = true;
  }

  if (shareEl) {
    if (isSharingEnabled()) {
      shareEl.hidden = false;
      shareEl.addEventListener("click", () => {
        if (broadcaster) stopSharing();
        else startSharing();
      });
      shareStopEl.addEventListener("click", stopSharing);
      shareCopyEl.addEventListener("click", async () => {
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

  // Render, and (when sharing) push the fresh snapshot to viewers.
  function update(md: string) {
    void preview.render(md, logoForPreview());
    broadcaster?.push(snapshot());
  }

  downloadEl.addEventListener("click", async () => {
    try {
      const pdf = await preview.pdf();
      if (!pdf) return;
      const blob = new Blob([pdf as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "asiakirja.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      fail(String(e));
    }
  });

  logoEl.addEventListener("change", async () => {
    const file = logoEl.files?.[0];
    if (!file) return;
    const path = logoPathFor(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    logo = { path, name: file.name, bytes };
    lsSet(STORE.logo, JSON.stringify({ path, name: file.name, b64: bytesToBase64(bytes) }));
    showLogo();
    update(editor.state.doc.toString());
  });

  function clearLogo() {
    logo = undefined;
    logoEl.value = "";
    lsRemove(STORE.logo);
    showLogo();
  }

  logoClearEl.addEventListener("click", () => {
    clearLogo();
    update(editor.state.doc.toString());
  });

  // Vim keybindings live in a compartment so the toggle can reconfigure them
  // without rebuilding the editor.
  const vimCompartment = new Compartment();
  const vimEnabled = lsGet(STORE.vim) === "1";
  vimEl.checked = vimEnabled;

  const selectionTheme = EditorView.theme({
    ".cm-selectionLayer .cm-selectionBackground": { backgroundColor: "#b3d4fc" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "#5b9dd9",
    },
  });

  let timer: number | undefined;
  const editor = new EditorView({
    parent: editorEl,
    doc: lsGet(STORE.doc) ?? withoutLogo(seed),
    extensions: [
      vimCompartment.of(vimEnabled ? vim() : []),
      lineNumbers(),
      history(),
      drawSelection(),
      selectionTheme,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        const text = u.state.doc.toString();
        lsSet(STORE.doc, text);
        clearTimeout(timer);
        timer = window.setTimeout(() => update(text), 300);
      }),
    ],
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
    if (!vimEl.checked) {
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
  vimEl.addEventListener("change", () => {
    editor.dispatch({ effects: vimCompartment.reconfigure(vimEl.checked ? vim() : []) });
    lsSet(STORE.vim, vimEl.checked ? "1" : "0");
    syncVimMode();
    editor.focus();
  });
  syncVimMode();

  function showPane(pane: "editor" | "preview") {
    document.body.classList.toggle("show-editor", pane === "editor");
    document.body.classList.toggle("show-preview", pane === "preview");
    showEditorEl.setAttribute("aria-pressed", String(pane === "editor"));
    showPreviewEl.setAttribute("aria-pressed", String(pane === "preview"));
    if (pane === "editor") editor.focus();
  }
  showEditorEl.addEventListener("click", () => showPane("editor"));
  showPreviewEl.addEventListener("click", () => showPane("preview"));

  resetEl.addEventListener("click", () => {
    if (!confirm("Aloitetaanko alusta esimerkkiasiakirjasta? Nykyiset muutokset ja logo poistetaan.")) return;
    const fresh = withoutLogo(seed);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: fresh } });
    clearLogo();
    lsRemove(STORE.doc);
    update(fresh);
  });

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

  setStatus("alustetaan typst.ts…");
  void preview.render(editor.state.doc.toString(), logoForPreview());
}
