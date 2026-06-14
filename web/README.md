# SFS 2487:2024 browser editor — typst.ts prototype (spike)

A browser-only Markdown → PDF editor for SFS 2487:2024 documents. It is a
**prototype** built to answer one question from
[`docs/web-editor.md`](../docs/web-editor.md): can a Typst template reproduce
the standard's layout and compile to PDF entirely client-side from Markdown,
with no server and no LaTeX toolchain?

The answer is **yes** — see _Verification_ below.

## How it works

```
Markdown (YAML front matter + body)
  └─ src/md-to-typst.ts   port of pandoc/sfs-2487-2024.lua + the template:
  │                       front matter → sfs-document arguments, definition
  │                       lists → #marginlabel, ::: esignatures/handsignature/
  │                       marginlabel divs, ≤3 heading levels, Finnish quotes
  ▼
Typst (#import "/sfs-2487-2024.typ")
  └─ src/sfs-2487-2024.typ   the layout, reimplemented from sfs-2487-2024.cls:
  │                          A4, 20 mm / 43 mm / 112 mm columns, metadata block
  │                          repeated as the page-2 header, "1 (2)" numbering,
  │                          body run into a heading/label that fits the 2,3 cm
  │                          column (the no-runin feature opts out)
  ▼
typst.ts (WASM, in the browser)
  ├─ $typst.svg(...)   live preview
  └─ $typst.pdf(...)   downloadable PDF
```

The editor shell is [CodeMirror 6](https://codemirror.net); the Typst compiler
and renderer are [typst.ts](https://github.com/Myriad-Dreamin/typst.ts). The
class's Type 1 fonts cannot be used by Typst, so the metric-compatible TeX Gyre
OpenType faces stand in (Heros ↔ Helvetica, Pagella ↔ Palatino, Cursor ↔
Courier); they are bundled under `public/fonts/` (GUST Font License).

## Run it

```bash
cd web
npm install
npm run dev      # http://localhost:5173 — live editor + preview
npm run build    # static bundle into dist/
```

`npm run convert -- ../examples/markdown/esimerkki-poytakirja.md` prints the
generated Typst for one document (used by the verification below).

## Verification

The layout is checked exactly the way the LaTeX class is, with
`pdftotext -bbox`. Converting `examples/markdown/esimerkki-poytakirja.md` and
compiling the result hits the standard's measured positions:

| element                         | target    | measured  |
| ------------------------------- | --------- | --------- |
| left-margin (marginlabels,      | 56.69 pt  | 56.69 pt  |
| heading numbers, endmatter)     | (20 mm)   |           |
| body text, list dashes,         | 121.9 pt  | 121.89 pt |
| definition content, signatures  | (43 mm)   |           |
| basic metadata block            | 317.5 pt  | 317.48 pt |
| (also repeated on page 2)       | (112 mm)  |           |

plus the `1 (2)` page numbering and the page-1 information-area order. The
run-in behaviour matches the class too: the short end-matter labels (Liitteet,
Jakelu, Tiedoksi) share their line with the following content, while the wider
margin labels and section headings stay on their own line. This was measured
with the `typst` CLI 0.14 — the **same compiler engine** that typst.ts wraps as
WASM.

The same was then confirmed **in a real browser**, end to end, with the
headless smoke test (`scripts/smoke.mjs`): it serves `dist/`, loads the editor,
waits for typst.ts to initialise and compile, and triggers the PDF download —
the resulting browser-produced PDF hits the same 56.69 / 121.89 / 317.48 pt
positions over two pages. The test needs a Chromium binary and `puppeteer-core`
(kept out of the build dependencies):

```bash
npm run build
npm install --no-save puppeteer-core
CHROMIUM=/path/to/chromium DOWNLOAD_DIR=/tmp/dl node scripts/smoke.mjs
pdftotext -bbox /tmp/dl/* -
```

That smoke test caught one real issue the CLI could not: by default typst.ts
fetches its built-in fonts from a CDN (jsdelivr), which breaks offline /
self-contained use. `web/src/main.ts` passes `preloadRemoteFonts(FONTS,
{ assets: false })` so only the bundled TeX Gyre faces are used and nothing is
fetched from the network.

## Known gaps (out of scope for the spike)

- Tagged-PDF accessibility (the class's `\DocumentMetadata{tagging=on}`) is not
  reproduced; Typst supports PDF/A and tagging, to revisit.
- Logo/image assets: the converter drops a `logo:` that points at an external
  file (the browser has no filesystem access to it); a real upload/VFS path is
  future work.
- Footnotes, tables and the TOC feature are wired through but exercised less
  than in the LaTeX examples.
- Fonts are bundled in-repo for a self-contained prototype; a production build
  would pin them through nix instead.

This is a third rendering path alongside the LaTeX class and the pandoc front
end. Under the project's parity rule it is, for now, **best-effort** — the
LaTeX class remains the reference implementation.
