import { defineConfig } from "vite";

// Served under a subpath on GitHub Pages (next to the mkdocs site); BASE_URL
// drives the font URLs in src/main.ts. Override with `vite build --base=/…/`.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  build: {
    target: "es2022",
    // The Typst compiler WASM is large; this is expected for the prototype.
    chunkSizeWarningLimit: 30000,
  },
  worker: {
    format: "es",
  },
});
