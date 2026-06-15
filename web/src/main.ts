// Browser-only SFS 2487:2024 Markdown -> PDF editor (typst.ts prototype).
//
// The Markdown is converted to Typst (src/md-to-typst.ts, a port of the pandoc
// Lua filter) against the layout template (src/sfs-2487-2024.typ), then
// compiled entirely in the browser by typst.ts: an SVG for the live preview
// and a PDF for download. No server is involved.

import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
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
const logoEl = document.getElementById("logo") as HTMLInputElement;
const logoClearEl = document.getElementById("logo-clear") as HTMLButtonElement;

function setStatus(text: string, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
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
    previewEl.innerHTML = svgText;
    return;
  }
  // typst.ts embeds a <script> for interactivity; cloned once per page it would
  // re-declare its globals (a console error). The static preview does not need
  // it, so drop it before cloning.
  base.querySelectorAll("script").forEach((s) => s.remove());
  const pages = Array.from(base.querySelectorAll("g.typst-page"));
  if (pages.length === 0) {
    previewEl.replaceChildren(base);
    return;
  }
  const cards: SVGSVGElement[] = [];
  for (const page of pages) {
    const t = (page.getAttribute("transform") ?? "").match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)/);
    const y = t ? parseFloat(t[2]) : 0;
    const w = parseFloat(page.getAttribute("data-page-width") ?? "0");
    const h = parseFloat(page.getAttribute("data-page-height") ?? "0");
    const card = base.cloneNode(true) as SVGSVGElement;
    // Crop to this page's slice; clip to it (typst sets overflow:visible, which
    // would otherwise leak the other pages into the view).
    card.setAttribute("viewBox", `0 ${y} ${w} ${h}`);
    card.setAttribute("width", String(w));
    card.setAttribute("height", String(h));
    card.setAttribute("preserveAspectRatio", "xMidYMid meet");
    card.style.overflow = "hidden";
    card.removeAttribute("data-width");
    card.removeAttribute("data-height");
    card.classList.add("page");
    cards.push(card);
  }
  previewEl.replaceChildren(...cards);
}

let templateAdded = false;
let currentTypst = "";

// An uploaded logo image, mapped into the typst.ts shadow filesystem. The
// frontmatter `logo:` key is a filesystem path the browser cannot read, so the
// logo is driven by the upload control instead (see withoutLogo).
let logo: { path: string; bytes: Uint8Array } | undefined;

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

async function render(md: string) {
  let typst: string;
  try {
    typst = markdownToTypst(md, { logoPath: logo?.path });
  } catch (e) {
    setStatus(e instanceof ConversionError ? e.message : String(e), true);
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
    setStatus(String(e), true);
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
    setStatus(String(e), true);
  }
});

logoEl.addEventListener("change", async () => {
  const file = logoEl.files?.[0];
  if (!file) return;
  const path = logoPathFor(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Drop a previous logo at a different path so it does not linger in the VFS.
  if (logo && logo.path !== path) await $typst.unmapShadow(logo.path);
  logo = { path, bytes };
  logoClearEl.hidden = false;
  render(editor.state.doc.toString());
});

logoClearEl.addEventListener("click", async () => {
  if (logo) await $typst.unmapShadow(logo.path);
  logo = undefined;
  logoEl.value = "";
  logoClearEl.hidden = true;
  render(editor.state.doc.toString());
});

let timer: number | undefined;
const editor = new EditorView({
  parent: document.getElementById("editor")!,
  doc: withoutLogo(seed),
  extensions: [
    lineNumbers(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdown(),
    EditorView.lineWrapping,
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => render(u.state.doc.toString()), 300);
    }),
  ],
});

setStatus("alustetaan typst.ts…");
render(editor.state.doc.toString());
