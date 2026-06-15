// Browser-only SFS 2487:2024 Markdown -> PDF editor (typst.ts prototype).
//
// The Markdown is converted to Typst (src/md-to-typst.ts, a port of the pandoc
// Lua filter) against the layout template (src/sfs-2487-2024.typ), then
// compiled entirely in the browser by typst.ts: an SVG for the live preview
// and a PDF for download. No server is involved.

import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { vim, getCM } from "@replit/codemirror-vim";
import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import { preloadRemoteFonts } from "@myriaddreamin/typst.ts";

import compilerWasmUrl from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import rendererWasmUrl from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";

import { markdownToTypst, ConversionError } from "./md-to-typst.ts";
import templateSource from "./sfs-2487-2024.typ?raw";
// A vendored copy of examples/markdown/esimerkki-poytakirja.md (spec Liite A),
// kept here so the bundle is self-contained for both `npm run dev` and the
// nix build, whose sandboxes do not reach outside web/.
import seed from "./seed.md?raw";
import "./style.css";

const base = import.meta.env.BASE_URL;
const FONTS = [
  "heros-regular", "heros-bold", "heros-italic", "heros-bolditalic",
  "pagella-regular", "pagella-bold", "pagella-italic", "pagella-bolditalic",
  "cursor-regular", "cursor-bold", "cursor-italic", "cursor-bolditalic",
].map((n) => `${base}fonts/texgyre${n}.otf`);

$typst.setCompilerInitOptions({
  getModule: () => compilerWasmUrl,
  // `assets: false` keeps typst.ts from fetching its default fonts off a CDN
  // (jsdelivr): the editor ships only the bundled TeX Gyre faces and stays
  // fully offline / self-contained. Without an explicit assets option, the
  // compiler falls back to loading the built-in 'text' fonts from the network.
  beforeBuild: [preloadRemoteFonts(FONTS, { assets: false })],
});
$typst.setRendererInitOptions({ getModule: () => rendererWasmUrl });

const statusEl = document.getElementById("status")!;
const downloadEl = document.getElementById("download") as HTMLButtonElement;
const previewEl = document.getElementById("preview")!;
const pagesEl = document.getElementById("pages")!;
const logoEl = document.getElementById("logo") as HTMLInputElement;
const logoClearEl = document.getElementById("logo-clear") as HTMLButtonElement;
const vimEl = document.getElementById("vim") as HTMLInputElement;
const vimModeEl = document.getElementById("vim-mode")!;
const resetEl = document.getElementById("reset") as HTMLButtonElement;
const toastsEl = document.getElementById("toasts")!;
const mainEl = document.querySelector("main")!;
const editorEl = document.getElementById("editor")!;
const dividerEl = document.getElementById("divider")!;
const zoomInEl = document.getElementById("zoom-in") as HTMLButtonElement;
const zoomOutEl = document.getElementById("zoom-out") as HTMLButtonElement;
const zoomLevelEl = document.getElementById("zoom-level")!;
const fitWidthEl = document.getElementById("fit-width") as HTMLButtonElement;
const fitHeightEl = document.getElementById("fit-height") as HTMLButtonElement;
const twoUpEl = document.getElementById("two-up") as HTMLButtonElement;

function setStatus(text: string, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
}

// Errors land in a transient bottom-right toast instead of the status bar:
// compiler messages can be long and multi-line, and inlining them would
// reflow the bar. The status bar only ever shows the short compile state.
function fail(message: string) {
  setStatus("virhe", true);
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  el.title = "Sulje napsauttamalla";
  const remove = () => el.remove();
  el.addEventListener("click", remove);
  // Auto-dismiss after a while; the fade is handled by the `.leaving` class.
  window.setTimeout(() => {
    el.classList.add("leaving");
    window.setTimeout(remove, 300);
  }, 10000);
  toastsEl.appendChild(el);
}

// typst.ts returns a single SVG with all pages stacked seamlessly in one
// coordinate space (transparent page backgrounds). Rendered as one element it
// reads as a single tall sheet with the page margins fused into a big blank
// band — the "extra padding". Split it into one cropped <svg> per page so each
// shows as a separate, correctly proportioned sheet that scales to fit.
function showPages(svgText: string) {
  // The browser's lenient HTML parser handles typst.ts's inline <style> block
  // (strict XML DOMParser chokes on it); a detached div gives us the live SVG.
  const holder = document.createElement("div");
  holder.innerHTML = svgText;
  const base = holder.querySelector("svg");
  if (!base) {
    pageSizes = [];
    pagesEl.innerHTML = svgText;
    return;
  }
  // typst.ts embeds a <script> for interactivity; cloned once per page it would
  // re-declare its globals (a console error). The static preview does not need
  // it, so drop it before cloning.
  base.querySelectorAll("script").forEach((s) => s.remove());
  const pages = Array.from(base.querySelectorAll("g.typst-page"));
  if (pages.length === 0) {
    pageSizes = [];
    pagesEl.replaceChildren(base);
    return;
  }
  const cards: SVGSVGElement[] = [];
  const sizes: { w: number; h: number }[] = [];
  for (const page of pages) {
    const t = (page.getAttribute("transform") ?? "").match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)/);
    const y = t ? parseFloat(t[2]) : 0;
    const w = parseFloat(page.getAttribute("data-page-width") ?? "0");
    const h = parseFloat(page.getAttribute("data-page-height") ?? "0");
    const card = base.cloneNode(true) as SVGSVGElement;
    // Crop to this page's slice; clip to it (typst sets overflow:visible, which
    // would otherwise leak the other pages into the view).
    card.setAttribute("viewBox", `0 ${y} ${w} ${h}`);
    card.setAttribute("preserveAspectRatio", "xMidYMid meet");
    card.style.overflow = "hidden";
    card.removeAttribute("data-width");
    card.removeAttribute("data-height");
    card.classList.add("page");
    cards.push(card);
    sizes.push({ w, h }); // natural page size in pt; the zoom/fit logic sizes the element
  }
  pageSizes = sizes;
  pagesEl.replaceChildren(...cards);
  applyView();
}

// --- localStorage persistence (document, logo, vim toggle) ---
// The editor is otherwise stateless, so a reload would lose work; these survive
// it. Every access is guarded so a disabled or full localStorage never breaks
// the editor — persistence is best-effort.
const STORE = {
  doc: "sfs2487.doc",
  logo: "sfs2487.logo",
  vim: "sfs2487.vim",
  view: "sfs2487.view",
  split: "sfs2487.split",
};

interface StoredLogo { path: string; name: string; b64: string }

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota or disabled: ignore */
  }
}
function lsRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000; // avoid exceeding the argument limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

let templateAdded = false;
let currentTypst = "";

// An uploaded logo image, mapped into the typst.ts shadow filesystem. The
// frontmatter `logo:` key is a filesystem path the browser cannot read, so the
// logo is driven by the upload control instead (see withoutLogo).
let logo: { path: string; name: string; bytes: Uint8Array } | undefined;

// Reflect the current logo in the "Poista logo" button (browsers cannot prefill
// a file input, so a restored logo has no visible file name otherwise).
function showLogo() {
  logoClearEl.hidden = logo === undefined;
  logoClearEl.title = logo ? logo.name : "";
}

// The strip-the-logo guard: the seeded example references an external logo
// file that the browser has no access to; drop the frontmatter line so it never
// reaches the converter. Uploaded logos take the VFS path below instead.
function withoutLogo(md: string): string {
  return md.replace(/^logo:.*$/m, "");
}

// Pick a shadow-filesystem path whose extension matches the upload, so Typst's
// image() decodes it by format. Only the browser-native raster/SVG formats are
// offered (PDF logos, used by the committed examples, are out of scope here).
function logoPathFor(file: File): string {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return "/logo.svg";
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "/logo.jpg";
  return "/logo.png";
}

// Restore a previously uploaded logo from localStorage (render() maps it into
// the VFS on the first compile).
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

async function render(md: string) {
  let typst: string;
  try {
    typst = markdownToTypst(md, { logoPath: logo?.path });
  } catch (e) {
    fail(e instanceof ConversionError ? e.message : String(e));
    return;
  }
  currentTypst = typst;
  try {
    if (!templateAdded) {
      await $typst.addSource("/sfs-2487-2024.typ", templateSource);
      templateAdded = true;
    }
    // Re-map the logo each render: cheap, and keeps the VFS in sync after a
    // change or removal.
    if (logo) await $typst.mapShadow(logo.path, logo.bytes);
    const svg = await $typst.svg({ mainContent: typst });
    showPages(svg);
    downloadEl.disabled = false;
    setStatus("käännetty");
  } catch (e) {
    fail(String(e));
  }
}

downloadEl.addEventListener("click", async () => {
  try {
    const pdf = await $typst.pdf({ mainContent: currentTypst });
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
  // Drop a previous logo at a different path so it does not linger in the VFS.
  if (logo && logo.path !== path) await $typst.unmapShadow(logo.path);
  logo = { path, name: file.name, bytes };
  lsSet(STORE.logo, JSON.stringify({ path, name: file.name, b64: bytesToBase64(bytes) }));
  showLogo();
  render(editor.state.doc.toString());
});

async function clearLogo() {
  if (logo) await $typst.unmapShadow(logo.path);
  logo = undefined;
  logoEl.value = "";
  lsRemove(STORE.logo);
  showLogo();
}

logoClearEl.addEventListener("click", async () => {
  await clearLogo();
  render(editor.state.doc.toString());
});

// Vim keybindings live in a compartment so the toggle can reconfigure them
// without rebuilding the editor. The vim() extension must come first, before the
// other keymaps, for its bindings to take precedence.
const vimCompartment = new Compartment();
const vimEnabled = lsGet(STORE.vim) === "1";
vimEl.checked = vimEnabled;

// In Vim mode the @replit/codemirror-vim theme forces the browser's native
// ::selection transparent and relies on drawSelection() to paint the visual
// selection itself; without it, selected (visual-mode) text is invisible. The
// theme gives the painted selection a clearly visible colour, focused or not.
// The selectors mirror CodeMirror's own base theme (including the
// `.cm-scroller > .cm-selectionLayer` child chain) so they match its
// specificity and win — otherwise the faint default lavender shows through.
const selectionTheme = EditorView.theme({
  ".cm-selectionLayer .cm-selectionBackground": { backgroundColor: "#b3d4fc" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "#5b9dd9",
  },
});

let timer: number | undefined;
const editor = new EditorView({
  parent: document.getElementById("editor")!,
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
      timer = window.setTimeout(() => render(text), 300);
    }),
  ],
});

// Show the current Vim mode (NORMAL / INSERT / VISUAL …) on the left of the
// status bar. The vim extension emits "vim-mode-change" on its CodeMirror-5
// compatibility object; reconfiguring the compartment builds a fresh one, so
// the listener is re-attached every time Vim is switched on.
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
  // A freshly enabled Vim starts in normal mode without firing an event.
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

// Start over from the seeded example: reset the document and logo (and their
// saved copies), but keep the Vim toggle — it is an editor preference, not part
// of the document.
resetEl.addEventListener("click", async () => {
  if (!confirm("Aloitetaanko alusta esimerkkiasiakirjasta? Nykyiset muutokset ja logo poistetaan.")) return;
  const fresh = withoutLogo(seed);
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: fresh } });
  await clearLogo();
  lsRemove(STORE.doc);
  render(fresh);
});

// --- preview view controls: zoom, fit-to-pane, one/two pages, split divider ---

interface ViewPrefs {
  zoom: number; // explicit scale when fit === "none" (1 = natural pt → px)
  fit: "none" | "width" | "height";
  twoUp: boolean;
}
let view: ViewPrefs = { zoom: 1, fit: "width", twoUp: false };
// Natural page sizes (pt) recorded by showPages; the fit math scales from these.
let pageSizes: { w: number; h: number }[] = [];

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.25;
const PAGE_GAP = 16; // px, matches #pages `gap: 1rem`

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

function saveView() {
  lsSet(STORE.view, JSON.stringify(view));
}

// The zoom that fits the page(s) to the pane in the active fit mode.
function fitZoom(): number {
  const page = pageSizes[0];
  if (!page) return view.zoom;
  const cs = getComputedStyle(previewEl);
  if (view.fit === "width") {
    const avail = previewEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const per = view.twoUp ? (avail - PAGE_GAP) / 2 : avail;
    return clampZoom(per / page.w);
  }
  if (view.fit === "height") {
    const avail = previewEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return clampZoom(avail / page.h);
  }
  return view.zoom;
}

const currentZoom = () => (view.fit === "none" ? view.zoom : fitZoom());

function applyView() {
  pagesEl.classList.toggle("two-up", view.twoUp);
  twoUpEl.setAttribute("aria-pressed", String(view.twoUp));
  const z = currentZoom();
  const cards = pagesEl.querySelectorAll<SVGSVGElement>("svg.page");
  cards.forEach((card, i) => {
    const s = pageSizes[i] ?? pageSizes[0];
    if (!s) return;
    card.style.width = `${s.w * z}px`;
    card.style.height = `${s.h * z}px`;
  });
  zoomLevelEl.textContent = `${Math.round(z * 100)} %`;
}

function setZoom(z: number) {
  view.fit = "none";
  view.zoom = clampZoom(z);
  saveView();
  applyView();
}

zoomInEl.addEventListener("click", () => setZoom(currentZoom() * ZOOM_STEP));
zoomOutEl.addEventListener("click", () => setZoom(currentZoom() / ZOOM_STEP));
fitWidthEl.addEventListener("click", () => { view.fit = "width"; saveView(); applyView(); });
fitHeightEl.addEventListener("click", () => { view.fit = "height"; saveView(); applyView(); });
twoUpEl.addEventListener("click", () => { view.twoUp = !view.twoUp; saveView(); applyView(); });

// Re-fit when the pane changes size (window resize, divider drag) in a fit mode.
new ResizeObserver(() => { if (view.fit !== "none") applyView(); }).observe(previewEl);

// Movable divider: --split holds the editor width (px); the grid gives the rest
// to the preview. Clamp so neither pane collapses.
function setSplit(px: number) {
  const min = 150;
  const max = mainEl.clientWidth - 150 - 6; // leave room for the preview + divider
  mainEl.style.setProperty("--split", `${Math.min(max, Math.max(min, px))}px`);
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

// Keyboard a11y: arrow keys nudge the focused divider.
dividerEl.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  setSplit(editorEl.clientWidth + (e.key === "ArrowLeft" ? -24 : 24));
  persistSplit();
});

// Keep the split within bounds when the window shrinks.
window.addEventListener("resize", () => {
  const cur = mainEl.style.getPropertyValue("--split");
  if (cur) setSplit(parseFloat(cur));
});

// Restore saved view preferences and divider position.
const savedView = lsGet(STORE.view);
if (savedView) {
  try {
    view = { ...view, ...JSON.parse(savedView) };
  } catch {
    lsRemove(STORE.view);
  }
}
const savedSplit = lsGet(STORE.split);
if (savedSplit) setSplit(parseFloat(savedSplit));
applyView();

setStatus("alustetaan typst.ts…");
render(editor.state.doc.toString());
