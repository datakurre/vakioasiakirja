# Web editor (research)

This page records research into building a Markdown-to-PDF editor for
SFS 2487:2024 that runs **completely in the browser** — no server, no
local TeX installation. It is a design study, not a shipped feature:
the goal is to compare the realistic options and decide between them
with two small prototypes before committing to an implementation.

The existing converter (`nix run .`) already turns Markdown into a
conforming PDF, but it needs nix or a TeX Live installation on the
machine. A browser editor would let someone write a document and get
the PDF with nothing installed, with a live preview beside the text.

## What a browser implementation has to reproduce

The current pipeline is two stages: pandoc applies the template
(`pandoc/sfs-2487-2024.latex`, frontmatter → class commands) and the
Lua filter (`pandoc/sfs-2487-2024.lua`, body conventions → class
commands), then `latexmk` runs `pdflatex` twice (the second pass
resolves the `1 (2)` total-page count) over `sfs-2487-2024.cls`.

Any browser version has to reproduce the parts of that which are
visible in the output:

- **Layout (the class, ~430 lines).** A4 on the 2,3 cm column grid,
  left-margin elements at 20 mm, body text at 43 mm, basic metadata at
  112 mm (9,2 cm from the left margin), the metadata block repeated as
  a page header from page 2, an adaptive logo header (logo ≤ 20 mm),
  `1 (2)` page numbering, footnotes, pipe tables with captions, a table
  of contents, three font families (Helvetica / Palatino / Courier),
  and optional tagged-PDF accessibility.
- **Body conventions (the Lua filter, ~285 lines).** Definition lists →
  margin labels; the `.esignatures`, `.handsignature` and
  `.marginlabel` fenced divs; Finnish quotation marks; at most three
  heading levels; frontmatter validation. One step does **not** survive
  in a browser: the filter shells out to `rsvg-convert` to turn SVG
  logos into PDF, which no WebAssembly sandbox can do — a browser build
  needs a JavaScript SVG path instead (for example `resvg` compiled to
  WebAssembly, or `svg2pdf.js`).
- **Frontmatter (the template).** About eighteen YAML keys mapping to
  class commands (`doctype`, `title`, `date`, `author`, `subject`,
  `docid`, `recipient`, `logo`, `extrametadata`, `attachments`,
  `distribution`, `keywords`, the font/feature options, and so on).

The verification numbers stay the same as for the desktop pipeline:
`pdftotext -bbox` should show left-margin elements at 56.69 pt, body
text at 121.9 pt and basic metadata at 317.5 pt.

## The two routes worth prototyping

### Route 1 — run the real pipeline in WebAssembly

Reuse `sfs-2487-2024.cls`, the Lua filter and the template unchanged, by
compiling pandoc and a TeX engine to WebAssembly.

- **pandoc** has had an official WebAssembly build since 3.9 (the GHC
  WebAssembly backend; the live demo is at
  [pandoc.org/app](https://pandoc.org/app)). It is roughly 16 MB
  compressed and — importantly — **runs Lua filters and custom
  templates**. It cannot run system commands or fetch over HTTP.
- For the TeX side the only actively maintained option is
  [BusyTeX](https://github.com/busytex/busytex) (MIT; pdfTeX, XeTeX and
  LuaTeX) and its packaging
  [texlyre-busytex](https://github.com/TeXlyre/texlyre-busytex)
  (TeX Live 2026 assets on npm, AGPL-3.0 wrapper). The engine is around
  32 MB of WebAssembly, plus TeX Live data that ranges from tens to a
  few hundred MB depending on how much is bundled versus fetched on
  demand. [SwiftLaTeX](https://github.com/SwiftLaTeX/SwiftLaTeX) still
  works but has not seen a release since 2022; `texlive.js` is
  abandoned; [Tectonic](https://github.com/tectonic-typesetting/tectonic)
  has no browser build.

Nobody has published a combined pandoc-WebAssembly → LaTeX-WebAssembly
pipeline, so the glue between the two modules (handing the generated
`.tex` across virtual filesystems, running `pdflatex` twice, surfacing
errors) would be new code.

- **For it:** byte-for-byte the same output as today, and the class,
  filter and template stay the single source of truth.
- **Against it:** a 50–150 MB first load, compile times measured in
  seconds rather than milliseconds, the SVG step to replace, an AGPL
  component in the easiest packaging, and unproven integration.

nix fits this route well at build time: the flake already pins a
trimmed TeX Live package set, and that same set could be assembled into
a small custom `texmf` bundle (likely tens of MB, not the full
several hundred) shipped with the app.

### Route 2 — reimplement the layout in Typst, compile with typst.ts

[Typst](https://typst.app) is a modern typesetting system whose compiler
is Rust compiled to WebAssembly via
[typst.ts](https://github.com/Myriad-Dreamin/typst.ts) (Apache-2.0,
actively maintained, `@myriaddreamin/typst.ts` on npm). The compiler is
around 2–3 MB compressed, compiles in well under a second, offers an
incremental SVG renderer for a flicker-free live preview, and produces a
downloadable PDF directly — no print dialog. Everything the standard
needs is native: millimetre-precise page geometry, headers repeated from
page 2, custom `1 (2)` numbering via counters, real footnotes, tables
with repeating header rows, SVG logos and an outline for the table of
contents.

The cost is that the layout logic in `sfs-2487-2024.cls` would be
**reimplemented as a Typst template**, and the fonts change: Typst
cannot use the class's Type 1 fonts, so the metric-compatible OpenType
equivalents (TeX Gyre Heros for Helvetica, Pagella for Palatino, Cursor
for Courier) would stand in. The output conforms to the standard but is
not byte-identical to the LaTeX output.

For the Markdown front end there are two sub-options to weigh in the
prototype:

- **pandoc-WebAssembly with `--to typst`.** Keeps the exact pandoc
  Markdown dialect the project already documents and lets the existing
  Lua-filter logic be ported to emit Typst. Adds pandoc's ~16 MB.
- **A lighter JavaScript or in-Typst converter** such as
  [cmarker.typ](https://github.com/SabrinaJewson/cmarker.typ). Smallest
  bundle, but a CommonMark dialect that only approximates the current
  conventions.

- **For it:** a small, fast bundle and a genuinely live preview; the
  toolchain (typst.ts) is proven for exactly this in-browser job.
- **Against it:** it becomes a **third implementation** of the layout
  alongside the class and the pandoc front end, which the project's
  parity rule (see `AGENTS.md`) means must be kept in sync per feature.

### Options that were rejected

- **HTML/CSS paged media** — [Paged.js](https://pagedjs.org) (AGPL, no
  native footnotes, unreliable repeated table headers, PDF only via the
  browser print dialog) and [Vivliostyle](https://vivliostyle.org)
  (open footnote bugs, no client-side PDF export). WeasyPrint under
  Pyodide is a dead end — it depends on the Pango/Cairo C libraries.
- **Pure-JavaScript PDF builders** — `pdfmake`, `@react-pdf/renderer`,
  `jsPDF` and `pdf-lib` all lack footnotes and would need the whole
  information-area layout hand-positioned; unsuitable for a formal
  standardised document.

## The editor shell (common to both routes)

Either route uses the same front end: [CodeMirror 6](https://codemirror.net)
(MIT, ~50–300 KB) for the Markdown editor in a split pane, with the
preview rendered either by [pdf.js](https://mozilla.github.io/pdf.js/)
or, for Route 2, by typst.ts's own SVG renderer. Prior art to study
includes [pandoc.org/app](https://pandoc.org/app) (pandoc-WebAssembly in
the browser) and the various typst.ts editor demos.

## Prototype plan to decide between the routes

Two small spikes, judged against the same checkpoints:

1. **typst.ts spike.** A minimal SFS 2487 Typst template (metadata
   block, header repetition from page 2, `1 (2)` numbering) compiling an
   `esimerkki-poytakirja`-equivalent in the browser. Confirm the
   `pdftotext -bbox` positions (56.69 / 121.9 / 317.5 pt) against the
   reference PDF.
2. **WebAssembly-LaTeX spike.** A nix-built trimmed `texmf` bundle from
   the flake's package list, running the real `.tex` intermediate
   through BusyTeX's `pdfTeX` in the browser. Measure the total download
   size and the compile latency.

Decision criteria: first-load size, preview latency, output fidelity
against the Liite A/B reference PDFs, and maintenance burden — the
third-implementation cost of Route 2 versus the bespoke-glue cost of
Route 1.

## Build and hosting

When an editor is built it would live in a `web/` directory in this
repository, built reproducibly through the flake (pinning the
WebAssembly artifacts and fonts), and published to GitHub Pages
alongside this documentation site by extending
`.github/workflows/docs.yml`.
