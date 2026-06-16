// The typst.ts preview core, shared by the editor (src/editor.ts) and the
// read-only viewer (src/viewer.ts). It owns the compiler/renderer init, the
// Markdown -> Typst -> SVG render, the page splitter, and the zoom/fit view
// controls. The logo is passed in (the editor drives it from its upload
// control; the viewer receives it over the data channel), so this module keeps
// no document state of its own beyond the last compiled Typst (for PDF export).

import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import { preloadRemoteFonts } from "@myriaddreamin/typst.ts";

import compilerWasmUrl from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import rendererWasmUrl from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";

import { markdownToTypst, ConversionError } from "./md-to-typst.ts";
import templateSource from "./sfs-2487-2024.typ?raw";

const base = import.meta.env.BASE_URL;
const FONTS = [
  "heros-regular", "heros-bold", "heros-italic", "heros-bolditalic",
  "pagella-regular", "pagella-bold", "pagella-italic", "pagella-bolditalic",
  "cursor-regular", "cursor-bold", "cursor-italic", "cursor-bolditalic",
].map((n) => `${base}fonts/texgyre${n}.otf`);

let typstInited = false;
// Initialise typst.ts once per page. `assets: false` keeps typst.ts from
// fetching its default fonts off a CDN (jsdelivr): the editor ships only the
// bundled TeX Gyre faces and stays fully offline / self-contained.
function initTypst() {
  if (typstInited) return;
  $typst.setCompilerInitOptions({
    getModule: () => compilerWasmUrl,
    beforeBuild: [preloadRemoteFonts(FONTS, { assets: false })],
  });
  $typst.setRendererInitOptions({ getModule: () => rendererWasmUrl });
  typstInited = true;
}

// An uploaded/received logo image, mapped into the typst.ts shadow filesystem.
export interface Logo {
  path: string;
  bytes: Uint8Array;
}

export interface PreviewElements {
  previewEl: HTMLElement;
  pagesEl: HTMLElement;
  zoomInEl: HTMLButtonElement;
  zoomOutEl: HTMLButtonElement;
  fitWidthEl: HTMLButtonElement;
  fitHeightEl: HTMLButtonElement;
  twoUpEl: HTMLButtonElement;
  zoomLevelEl: HTMLElement;
}

export interface PreviewCallbacks {
  setStatus(text: string, error?: boolean): void;
  fail(message: string): void;
  // Called after a successful render (the editor uses it to enable Download).
  onRendered?(): void;
  // localStorage key for the zoom/fit/two-up preferences (optional).
  viewStorageKey?: string;
}

export interface Preview {
  // Convert Markdown and compile it to the live SVG preview.
  render(md: string, logo?: Logo): Promise<void>;
  // The PDF of the last successfully rendered document (or undefined).
  pdf(): Promise<Uint8Array | undefined>;
  // Whether a document has been rendered (drives the Download button).
  hasContent(): boolean;
}

interface ViewPrefs {
  zoom: number; // explicit scale when fit === "none" (1 = natural pt → px)
  fit: "none" | "width" | "height";
  twoUp: boolean;
}

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.25;
const PAGE_GAP = 16; // px, matches #pages `gap: 1rem`
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

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

export function createPreview(els: PreviewElements, cb: PreviewCallbacks): Preview {
  initTypst();

  const setBusy = (busy: boolean) => els.previewEl.setAttribute("aria-busy", String(busy));

  let templateAdded = false;
  let currentTypst = "";
  let rendered = false;

  let view: ViewPrefs = { zoom: 1, fit: "width", twoUp: false };
  // Natural page sizes (pt) recorded by showPages; the fit math scales from these.
  let pageSizes: { w: number; h: number }[] = [];

  const saveView = () => {
    if (cb.viewStorageKey) lsSet(cb.viewStorageKey, JSON.stringify(view));
  };

  // The zoom that fits the page(s) to the pane in the active fit mode.
  function fitZoom(): number {
    const page = pageSizes[0];
    if (!page) return view.zoom;
    const cs = getComputedStyle(els.previewEl);
    if (view.fit === "width") {
      const avail = els.previewEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const per = view.twoUp ? (avail - PAGE_GAP) / 2 : avail;
      return clampZoom(per / page.w);
    }
    if (view.fit === "height") {
      const avail = els.previewEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return clampZoom(avail / page.h);
    }
    return view.zoom;
  }

  const currentZoom = () => (view.fit === "none" ? view.zoom : fitZoom());

  function applyView() {
    els.pagesEl.classList.toggle("two-up", view.twoUp);
    els.twoUpEl.setAttribute("aria-pressed", String(view.twoUp));
    const z = currentZoom();
    const cards = els.pagesEl.querySelectorAll<SVGSVGElement>("svg.page");
    cards.forEach((card, i) => {
      const s = pageSizes[i] ?? pageSizes[0];
      if (!s) return;
      card.style.width = `${s.w * z}px`;
      card.style.height = `${s.h * z}px`;
    });
    els.zoomLevelEl.textContent = `${Math.round(z * 100)} %`;
  }

  function setZoom(z: number) {
    view.fit = "none";
    view.zoom = clampZoom(z);
    saveView();
    applyView();
  }

  // typst.ts returns a single SVG with all pages stacked seamlessly in one
  // coordinate space (transparent page backgrounds). Split it into one cropped
  // <svg> per page so each shows as a separate, correctly proportioned sheet.
  function showPages(svgText: string) {
    const holder = document.createElement("div");
    holder.innerHTML = svgText;
    const baseSvg = holder.querySelector("svg");
    if (!baseSvg) {
      pageSizes = [];
      els.pagesEl.innerHTML = svgText;
      return;
    }
    // typst.ts embeds a <script> for interactivity; cloned once per page it
    // would re-declare its globals (a console error). Drop it before cloning.
    baseSvg.querySelectorAll("script").forEach((s) => s.remove());
    const pages = Array.from(baseSvg.querySelectorAll("g.typst-page"));
    if (pages.length === 0) {
      pageSizes = [];
      els.pagesEl.replaceChildren(baseSvg);
      return;
    }
    const cards: SVGSVGElement[] = [];
    const sizes: { w: number; h: number }[] = [];
    for (const page of pages) {
      const t = (page.getAttribute("transform") ?? "").match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)/);
      const y = t ? parseFloat(t[2]) : 0;
      const w = parseFloat(page.getAttribute("data-page-width") ?? "0");
      const h = parseFloat(page.getAttribute("data-page-height") ?? "0");
      const card = baseSvg.cloneNode(true) as SVGSVGElement;
      card.setAttribute("viewBox", `0 ${y} ${w} ${h}`);
      card.setAttribute("preserveAspectRatio", "xMidYMid meet");
      card.style.overflow = "hidden";
      card.removeAttribute("data-width");
      card.removeAttribute("data-height");
      card.classList.add("page");
      cards.push(card);
      sizes.push({ w, h });
    }
    pageSizes = sizes;
    els.pagesEl.replaceChildren(...cards);
    applyView();
  }

  async function render(md: string, logo?: Logo) {
    let typst: string;
    try {
      typst = markdownToTypst(md, { logoPath: logo?.path });
    } catch (e) {
      cb.fail(e instanceof ConversionError ? e.message : String(e));
      return;
    }
    currentTypst = typst;
    cb.setStatus("kääntää…");
    setBusy(true);
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
      rendered = true;
      cb.setStatus("käännetty");
      setBusy(false);
      cb.onRendered?.();
    } catch (e) {
      setBusy(false);
      cb.fail(String(e));
    }
  }

  // --- wire the view controls ---
  els.zoomInEl.addEventListener("click", () => setZoom(currentZoom() * ZOOM_STEP));
  els.zoomOutEl.addEventListener("click", () => setZoom(currentZoom() / ZOOM_STEP));
  els.fitWidthEl.addEventListener("click", () => { view.fit = "width"; saveView(); applyView(); });
  els.fitHeightEl.addEventListener("click", () => { view.fit = "height"; saveView(); applyView(); });
  els.twoUpEl.addEventListener("click", () => { view.twoUp = !view.twoUp; saveView(); applyView(); });

  // Re-fit when the pane changes size (window resize, divider drag) in a fit mode.
  new ResizeObserver(() => { if (view.fit !== "none") applyView(); }).observe(els.previewEl);

  // Restore saved view preferences.
  if (cb.viewStorageKey) {
    const saved = lsGet(cb.viewStorageKey);
    if (saved) {
      try {
        view = { ...view, ...JSON.parse(saved) };
      } catch {
        /* ignore corrupt prefs */
      }
    }
  }
  applyView();

  return {
    render,
    hasContent: () => rendered,
    pdf: async () => {
      if (!rendered) return undefined;
      return (await $typst.pdf({ mainContent: currentTypst })) as Uint8Array | undefined;
    },
  };
}
