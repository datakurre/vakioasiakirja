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
import { HighlightTracker } from "./highlight.ts";
import { createPagePulseTracker, type PagePulseTracker } from "./pulse.ts";
import type { WorkerRequest, WorkerResponse } from "./typst-worker-types.ts";
import {
  hoistSvgStyles,
  pageSignature,
  reconcilePageCards,
  type PageCardEntry,
} from "./page-cards.ts";

export { createPagePulseTracker, type PagePulseTracker };

export function getPreloadFontUrls(): string[] {
  const base = import.meta.env.BASE_URL || "/";
  const names = [
    "heros-regular", "heros-bold", "heros-italic", "heros-bolditalic",
    "pagella-regular", "pagella-bold", "pagella-italic", "pagella-bolditalic",
    "cursor-regular", "cursor-bold", "cursor-italic", "cursor-bolditalic",
  ];
  return names.map((n) => {
    const rel = `${base}fonts/texgyre${n}.otf`;
    if (typeof window !== "undefined" && window.location) {
      try {
        return new URL(rel, window.location.href).href;
      } catch {
        return rel;
      }
    }
    return rel;
  });
}

const FONTS = getPreloadFontUrls();

let inThreadTypstInited = false;
let inThreadCurrentTemplateSource: string | null = null;
let inThreadCurrentTypst = "";
let inThreadCurrentLogoPath: string | undefined;

function initInThreadTypst() {
  if (inThreadTypstInited) return;
  $typst.setCompilerInitOptions({
    getModule: () => compilerWasmUrl,
    beforeBuild: [preloadRemoteFonts(FONTS, { assets: false })],
  });
  $typst.setRendererInitOptions({ getModule: () => rendererWasmUrl });
  inThreadTypstInited = true;
}

// An uploaded/received logo image, mapped into the typst.ts shadow filesystem.
export interface Logo {
  path: string;
  bytes: Uint8Array;
}

export interface PreviewElements {
  previewEl: HTMLElement;
  pagesEl: HTMLElement;
  controlsEl: HTMLElement;
  zoomInEl: HTMLButtonElement;
  zoomOutEl: HTMLButtonElement;
  fitWidthEl: HTMLButtonElement;
  fitHeightEl: HTMLButtonElement;
  twoUpEl: HTMLButtonElement;
  zoomLevelEl: HTMLElement;
  autoscrollEl?: HTMLButtonElement;
}

export interface PreviewCallbacks {
  setStatus(text: string, error?: boolean): void;
  fail(message: string): void;
  clearErrors?(): void;
  // Called after a successful render (the editor uses it to enable Download).
  onRendered?(): void;
  // localStorage key for the zoom/fit/two-up preferences (optional).
  viewStorageKey?: string;
  // Optional highlight tracker instance override.
  highlightTracker?: HighlightTracker;
  // Optional worker bridge override (e.g. for testing).
  bridge?: TypstWorkerBridge;
  // Optional selection highlighter instance to invalidate cache on re-render.
  selectionHighlighter?: { invalidateCache(): void };
}

export interface RenderOptions {
  liveEdit?: boolean;
}

export interface Preview {
  // Convert Markdown and compile it to the live SVG preview.
  render(md: string, logo?: Logo, options?: RenderOptions): Promise<void>;
  markStale?(): void;
  // The PDF of the last successfully rendered document (or undefined).
  pdf(): Promise<Uint8Array | undefined>;
  // Whether a document has been rendered (drives the Download button).
  hasContent(): boolean;
  // Briefly reveal the floating view controls (for touch, where there is no hover).
  flashControls(): void;
  // Reset cached page SVGs for pulse detection.
  resetPulse?(): void;
  // Optional cleanup of resources
  destroy?(): void;
}

export class TypstWorkerBridge {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    number,
    {
      resolve: (res: any) => void;
      reject: (err: any) => void;
    }
  >();
  private nextRequestId = 0;
  private fallbackInThread = false;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    // If Worker global is unavailable or running in a Node.js test environment, fallback in-thread
    if (
      typeof Worker === "undefined" ||
      (typeof process !== "undefined" && process.versions?.node && typeof window === "undefined")
    ) {
      this.fallbackInThread = true;
      return;
    }

    try {
      this.worker = new Worker(
        new URL("./typst.worker.ts", import.meta.url),
        { type: "module" }
      );

      const fontUrls = getPreloadFontUrls();
      this.worker.postMessage({ id: 0, type: "init", fontUrls });

      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (!msg || typeof msg.id !== "number") return;
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg);
        }
      };

      this.worker.onerror = (err) => {
        console.warn("TypstWorker error, falling back to in-thread:", err);
        this.fallbackInThread = true;
        for (const [, pending] of this.pendingRequests) {
          pending.reject(err);
        }
        this.pendingRequests.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    } catch (err) {
      console.warn("TypstWorker initialization failed, using in-thread fallback:", err);
      this.fallbackInThread = true;
      this.worker = null;
    }
  }

  get isFallback(): boolean {
    return this.fallbackInThread;
  }

  async render(md: string, logo?: Logo): Promise<{ svg: string }>;
  async render(id: number, md: string, logo?: Logo): Promise<{ svg: string }>;
  async render(arg1: number | string, arg2?: string | Logo, arg3?: Logo): Promise<{ svg: string }> {
    let md: string;
    let logo: Logo | undefined;
    if (typeof arg1 === "number") {
      md = arg2 as string;
      logo = arg3;
    } else {
      md = arg1;
      logo = arg2 as Logo | undefined;
    }

    if (this.fallbackInThread || !this.worker) {
      return this.renderInThread(md, logo);
    }

    const reqId = ++this.nextRequestId;
    return new Promise<{ svg: string }>((resolve, reject) => {
      this.pendingRequests.set(reqId, {
        resolve: (res: WorkerResponse) => {
          if (res.type === "render_success") {
            resolve({ svg: res.svg });
          } else if (res.type === "render_error") {
            const err = res.isConversionError
              ? new ConversionError(res.error)
              : new Error(res.error);
            reject(err);
          } else {
            reject(new Error(`Unexpected worker response type: ${res.type}`));
          }
        },
        reject,
      });

      try {
        const req: WorkerRequest = {
          id: reqId,
          type: "render",
          md,
          logo: logo ? { path: logo.path, bytes: logo.bytes } : undefined,
          fontUrls: getPreloadFontUrls(),
        };
        this.worker!.postMessage(req);
      } catch (postErr) {
        this.pendingRequests.delete(reqId);
        console.warn("Worker postMessage failed, falling back to in-thread:", postErr);
        this.fallbackInThread = true;
        this.renderInThread(md, logo).then(resolve, reject);
      }
    });
  }

  async pdf(): Promise<Uint8Array | undefined> {
    if (this.fallbackInThread || !this.worker) {
      return this.pdfInThread();
    }

    const id = ++this.nextRequestId;
    return new Promise<Uint8Array | undefined>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (res: WorkerResponse) => {
          if (res.type === "pdf_success") {
            resolve(res.pdf);
          } else if (res.type === "pdf_error") {
            reject(new Error(res.error));
          } else {
            reject(new Error(`Unexpected worker response type: ${res.type}`));
          }
        },
        reject,
      });

      try {
        const req: WorkerRequest = { id, type: "pdf" };
        this.worker!.postMessage(req);
      } catch (postErr) {
        this.pendingRequests.delete(id);
        console.warn("Worker postMessage failed for PDF, falling back to in-thread:", postErr);
        this.fallbackInThread = true;
        this.pdfInThread().then(resolve, reject);
      }
    });
  }

  private async renderInThread(md: string, logo?: Logo): Promise<{ svg: string }> {
    initInThreadTypst();
    const typst = markdownToTypst(md, { logoPath: logo?.path });
    if (inThreadCurrentTemplateSource !== templateSource) {
      await $typst.addSource("/sfs-2487-2024.typ", templateSource);
      inThreadCurrentTemplateSource = templateSource;
    }
    if (inThreadCurrentLogoPath && (!logo || inThreadCurrentLogoPath !== logo.path)) {
      try {
        await $typst.unmapShadow(inThreadCurrentLogoPath);
      } catch {
        /* ignore */
      }
      inThreadCurrentLogoPath = undefined;
    }
    if (logo) {
      await $typst.mapShadow(logo.path, logo.bytes);
      inThreadCurrentLogoPath = logo.path;
    }
    const svg = await $typst.svg({ mainContent: typst });
    inThreadCurrentTypst = typst;
    return { svg };
  }

  private async pdfInThread(): Promise<Uint8Array | undefined> {
    initInThreadTypst();
    if (!inThreadCurrentTypst) return undefined;
    return (await $typst.pdf({ mainContent: inThreadCurrentTypst })) as Uint8Array | undefined;
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
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
  const bridge = cb.bridge ?? new TypstWorkerBridge();

  const highlightTracker = cb.highlightTracker ?? new HighlightTracker();
  const setBusy = (busy: boolean) => els.previewEl.setAttribute("aria-busy", String(busy));

  let rendered = false;
  let nextRenderSeq = 0;
  let latestAppliedSeq = 0;
  const pulseTracker = createPagePulseTracker();

  let view: ViewPrefs = { zoom: 1, fit: "width", twoUp: false };
  // Natural page sizes (pt) recorded by showPages; the fit math scales from these.
  let pageSizes: { w: number; h: number }[] = [];
  // Mounted page cards with their content signatures, for incremental updates.
  let pageEntries: PageCardEntry[] = [];

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
    // Read clean layout metrics BEFORE any DOM mutations
    const z = currentZoom();
    els.pagesEl.classList.toggle("two-up", view.twoUp);
    els.twoUpEl.setAttribute("aria-pressed", String(view.twoUp));
    const cards = els.pagesEl.querySelectorAll<SVGSVGElement>("svg.page");
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const s = pageSizes[i] ?? pageSizes[0];
      if (!s) continue;
      const wStr = `${s.w * z}px`;
      const hStr = `${s.h * z}px`;
      if (card.style.width !== wStr) card.style.width = wStr;
      if (card.style.height !== hStr) card.style.height = hStr;
    }
    const zoomText = `${Math.round(z * 100)} %`;
    if (els.zoomLevelEl.textContent !== zoomText) {
      els.zoomLevelEl.textContent = zoomText;
    }
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
  function showPages(svgText: string, isLiveEdit = false) {
    const holder = document.createElement("div");
    holder.innerHTML = svgText;
    const baseSvg = holder.querySelector("svg");
    if (!baseSvg) {
      pageSizes = [];
      pageEntries = [];
      els.pagesEl.innerHTML = svgText;
      cb.selectionHighlighter?.invalidateCache();
      return;
    }
    // typst.ts embeds a <script> for interactivity; cloned once per page it
    // would re-declare its globals (a console error). Drop it before cloning.
    baseSvg.querySelectorAll("script").forEach((s) => s.remove());
    hoistSvgStyles(baseSvg, document);
    highlightTracker.process(baseSvg, isLiveEdit);
    const pages = Array.from(baseSvg.querySelectorAll("g.typst-page"));
    if (pages.length === 0) {
      pageSizes = [];
      pageEntries = [];
      els.pagesEl.replaceChildren(baseSvg);
      cb.selectionHighlighter?.invalidateCache();
      return;
    }
    const modifiedPages = pulseTracker.checkModified(pages.map(pageSignature));

    // Pre-size rebuilt cards before they enter the live DOM (no extra reflow).
    const z = currentZoom();
    const { entries, rebuilt } = reconcilePageCards(
      els.pagesEl,
      baseSvg as SVGSVGElement,
      pages,
      pageEntries,
      modifiedPages,
    );
    for (const i of rebuilt) {
      const e = entries[i];
      e.card.style.width = `${e.w * z}px`;
      e.card.style.height = `${e.h * z}px`;
    }
    pageEntries = entries;
    pageSizes = entries.map((e) => ({ w: e.w, h: e.h }));

    cb.selectionHighlighter?.invalidateCache();
    applyView();
  }

  // Drop the pulse classes once the (compositor-only) pulse has played, so a
  // finished pulse never replays and the pseudo-element layer is released.
  els.pagesEl.addEventListener("animationend", (ev) => {
    const target = ev.target as Element | null;
    if (!target?.classList?.contains("page-wrap")) return;
    target.classList.remove("page-pulse", "page-modified");
    target.querySelector("svg.page")?.classList.remove("page-pulse", "page-modified");
  });

  async function render(md: string, logo?: Logo, options?: RenderOptions) {
    const currentSeq = ++nextRenderSeq;
    cb.setStatus("kääntää…");
    setBusy(true);

    try {
      const { svg } = await bridge.render(currentSeq, md, logo);
      if (currentSeq !== nextRenderSeq || currentSeq <= latestAppliedSeq) return;
      latestAppliedSeq = currentSeq;
      showPages(svg, options?.liveEdit ?? false);
      rendered = true;
      cb.setStatus("käännetty");
      cb.clearErrors?.();
      setBusy(false);
      cb.onRendered?.();
    } catch (e: any) {
      if (currentSeq !== nextRenderSeq || currentSeq <= latestAppliedSeq) return;
      setBusy(false);
      cb.fail(e instanceof ConversionError ? e.message : (e?.message || String(e)));
    }
  }

  // --- wire the view controls ---
  els.zoomInEl.addEventListener("click", () => setZoom(currentZoom() * ZOOM_STEP));
  els.zoomOutEl.addEventListener("click", () => setZoom(currentZoom() / ZOOM_STEP));
  els.fitWidthEl.addEventListener("click", () => { view.fit = "width"; saveView(); applyView(); });
  els.fitHeightEl.addEventListener("click", () => { view.fit = "height"; saveView(); applyView(); });
  els.twoUpEl.addEventListener("click", () => { view.twoUp = !view.twoUp; saveView(); applyView(); });

  // The floating controls fade out when idle. Hover and focus keep them up via
  // CSS; this surfaces them on activity (essential on touch, where there is no
  // hover) and hides them again after a short pause.
  let controlsTimer: number | undefined;
  const flashControls = () => {
    els.controlsEl.classList.add("show");
    window.clearTimeout(controlsTimer);
    controlsTimer = window.setTimeout(() => els.controlsEl.classList.remove("show"), 2200);
  };
  for (const ev of ["pointerdown", "pointermove", "scroll", "touchstart"]) {
    els.previewEl.addEventListener(ev, flashControls, { passive: true });
  }

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

  function markStale() {
    nextRenderSeq++;
  }

  return {
    render,
    markStale,
    hasContent: () => rendered,
    flashControls,
    resetPulse: () => pulseTracker.reset(),
    pdf: async () => {
      if (!rendered) return undefined;
      return bridge.pdf();
    },
    destroy: () => bridge.destroy(),
  };
}
