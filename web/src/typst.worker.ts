import { $typst } from "@myriaddreamin/typst.ts/dist/esm/contrib/snippet.mjs";
import { preloadRemoteFonts } from "@myriaddreamin/typst.ts";

import compilerWasmUrl from "@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url";
import rendererWasmUrl from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";

import { markdownToTypst, ConversionError } from "./md-to-typst.ts";
import templateSource from "./sfs-2487-2024.typ?raw";
import type { WorkerRequest, WorkerResponse } from "./typst-worker-types.ts";

let typstInited = false;
let currentTemplateSource: string | null = null;
let currentTypst = "";
let currentLogoPath: string | undefined;

function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url, import.meta.url).href;
  } catch {
    try {
      return new URL(url, self.location.href).href;
    } catch {
      return url;
    }
  }
}

function getFontUrls(): string[] {
  const base = import.meta.env.BASE_URL || "/";
  const names = [
    "heros-regular", "heros-bold", "heros-italic", "heros-bolditalic",
    "pagella-regular", "pagella-bold", "pagella-italic", "pagella-bolditalic",
    "cursor-regular", "cursor-bold", "cursor-italic", "cursor-bolditalic",
  ];

  let rootUrl: string;
  try {
    if (base.startsWith("http://") || base.startsWith("https://") || base.startsWith("/")) {
      rootUrl = new URL(base, self.location.origin).href;
    } else {
      // Relative base like "./". If worker chunk is in /assets/, resolve relative to parent of /assets/
      const workerUrl = new URL(self.location.href);
      let dir = workerUrl.pathname.replace(/\/[^/]*$/, "/");
      if (dir.endsWith("/assets/")) {
        dir = dir.slice(0, -"/assets/".length + 1);
      }
      workerUrl.pathname = dir;
      rootUrl = new URL(base, workerUrl.href).href;
    }
  } catch {
    rootUrl = self.location.href;
  }
  if (!rootUrl.endsWith("/")) rootUrl += "/";

  return names.map((n) => {
    try {
      return new URL(`fonts/texgyre${n}.otf`, rootUrl).href;
    } catch {
      return `${base}fonts/texgyre${n}.otf`;
    }
  });
}

function initTypst(customFonts?: string[]) {
  if (typstInited) return;
  const fonts = customFonts && customFonts.length > 0 ? customFonts : getFontUrls();
  $typst.setCompilerInitOptions({
    getModule: () => toAbsoluteUrl(compilerWasmUrl),
    beforeBuild: [preloadRemoteFonts(fonts, { assets: false })],
  });
  $typst.setRendererInitOptions({
    getModule: () => toAbsoluteUrl(rendererWasmUrl),
  });
  typstInited = true;
}

self.addEventListener("message", async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (!req || typeof req.id !== "number") return;

  if (req.type === "init") {
    initTypst(req.fontUrls);
    return;
  }

  if (req.type === "render") {
    try {
      initTypst(req.fontUrls);
      let typst: string;
      try {
        typst = markdownToTypst(req.md, { logoPath: req.logo?.path });
      } catch (err: any) {
        const resp: WorkerResponse = {
          id: req.id,
          type: "render_error",
          error: err instanceof ConversionError ? err.message : (err?.message || String(err)),
          isConversionError: err instanceof ConversionError,
        };
        self.postMessage(resp);
        return;
      }

      if (currentTemplateSource !== templateSource) {
        await $typst.addSource("/sfs-2487-2024.typ", templateSource);
        currentTemplateSource = templateSource;
      }
      if (currentLogoPath && (!req.logo || currentLogoPath !== req.logo.path)) {
        try {
          await $typst.unmapShadow(currentLogoPath);
        } catch {
          /* ignore */
        }
        currentLogoPath = undefined;
      }
      if (req.logo) {
        await $typst.mapShadow(req.logo.path, req.logo.bytes);
        currentLogoPath = req.logo.path;
      }
      const svg = await $typst.svg({ mainContent: typst });
      currentTypst = typst;

      const resp: WorkerResponse = {
        id: req.id,
        type: "render_success",
        svg,
      };
      self.postMessage(resp);
    } catch (err: any) {
      const resp: WorkerResponse = {
        id: req.id,
        type: "render_error",
        error: err?.message || String(err),
      };
      self.postMessage(resp);
    }
  } else if (req.type === "pdf") {
    try {
      initTypst();
      if (!currentTypst) {
        const resp: WorkerResponse = {
          id: req.id,
          type: "pdf_success",
          pdf: undefined,
        };
        self.postMessage(resp);
        return;
      }
      const pdfBytes = (await $typst.pdf({ mainContent: currentTypst })) as Uint8Array | undefined;
      const resp: WorkerResponse = {
        id: req.id,
        type: "pdf_success",
        pdf: pdfBytes,
      };
      if (
        pdfBytes &&
        pdfBytes.buffer instanceof ArrayBuffer &&
        pdfBytes.byteOffset === 0 &&
        pdfBytes.byteLength === pdfBytes.buffer.byteLength
      ) {
        self.postMessage(resp, { transfer: [pdfBytes.buffer] });
      } else {
        self.postMessage(resp);
      }
    } catch (err: any) {
      const resp: WorkerResponse = {
        id: req.id,
        type: "pdf_error",
        error: err?.message || String(err),
      };
      self.postMessage(resp);
    }
  }
});
