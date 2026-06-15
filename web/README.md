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
  │                       marginlabel divs, ≤3 heading levels (unnumbered with
  │                       {-}), footnotes, pipe tables + captions, captioned
  │                       image figures, Finnish quotes
  ▼
Typst (#import "/sfs-2487-2024.typ")
  └─ src/sfs-2487-2024.typ   the layout, reimplemented from sfs-2487-2024.cls:
  │                          A4, 20 mm / 43 mm / 112 mm columns, metadata block
  │                          repeated as the page-2 header, "1 (2)" numbering,
  │                          body run into a heading/label that fits the 2,3 cm
  │                          column (the no-runin feature opts out)
  ▼
typst.ts (WASM, in the browser)
  ├─ $typst.svg(...)   live preview (split into one cropped sheet per page so
  │                    each scales to fit, instead of one fused tall SVG)
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

## Editor controls

The editing controls sit in a **bottom status bar** (so the top bar stays a
single short line that a long error can never reflow). They are **icon
buttons** — each carries an `aria-label` and a `title` tooltip, renders an SVG
from an inline `<symbol>` sprite, has a visible `:focus-visible` ring, and is at
least a 44 px touch target on mobile:

- **Vim** (bottom left) — a checkbox toggling Vim keybindings
  ([@replit/codemirror-vim](https://github.com/replit/codemirror-vim)) in the
  CodeMirror editor, switched live via a `Compartment`. When Vim is on, a badge
  next to it shows the current mode (`NORMAL` / `INSERT` / `VISUAL` …), driven by
  the extension's `vim-mode-change` event. The editor enables CodeMirror's
  `drawSelection()` — which the Vim extension needs to paint the visual-mode
  selection — and themes the painted selection a clearly visible blue so
  selected text stands out, focused or not. **Vim only makes sense with a
  physical keyboard**, so the control is hidden unless one is likely (see
  _Keyboard detection_ below) — and it is not applied without one, so an
  on-screen keyboard is never trapped in Vim's normal mode.
- **Logo / Poista logo / Uusi esimerkki / Lataa PDF** (bottom right) — logo
  upload (a styled file input), document/logo reset back to the seeded example
  (the Vim toggle is kept — it is an editor preference), and PDF download.
- **Preview toolbar** (above the preview) — zoom out / in, fit to width, fit to
  height, and a one-/two-page toggle (`aria-pressed`), all as icons.
- The document, the uploaded logo and the Vim toggle are autosaved to the
  browser's `localStorage` and restored on reload. (A restored logo cannot
  repopulate the file input, so the **Poista logo** button — with the file name
  as its tooltip — is the "a logo is loaded" indicator.)
- Conversion and compile **errors appear as dismissible toasts at the bottom
  right** (`role="alert"`, dismissable by mouse, the keyboard-reachable close
  button, or Escape). A spinner on the preview (and `aria-busy`) shows while a
  compile is in flight; the status bar otherwise only shows the short compile
  state (`käännetty`, `virhe`, …), so it never grows or reflows.

### Responsive / mobile layout

On wide screens the editor and preview sit side by side. On narrow (mobile)
screens — at a 700 px breakpoint — two half-width panes are unusable, so the
layout collapses to a single column showing one pane at a time:

- The **top header is dropped entirely**; the bottom bar becomes the only
  chrome, for a focused, app-like feel.
- A **Muokkaa / Esikatselu** segmented switch (a labelled group of `aria-pressed`
  toggle buttons) is the primary navigation. Following the native bottom-bar
  idiom, only the *selected* tab shows its text label; the other is icon-only,
  which keeps both tabs and the action icons on one row without overflow.
- Vim is hidden unless a keyboard is detected (see below), the height tracks
  the dynamic viewport (`100dvh`), the bar respects the safe-area insets (so it
  clears a notched phone's home indicator), and the editor uses 16 px text to
  stop iOS Safari from zooming on focus.

### Keyboard detection

There is **no web API for hardware-keyboard presence** (`navigator.keyboard`
only exposes layout maps; the VirtualKeyboard API is about the on-screen
keyboard), so the Vim gate uses two complementary signals:

- **CSS** `@media (hover: hover) and (pointer: fine)` — a precise pointer with
  hover means a mouse/trackpad, which implies a keyboard setup (desktops,
  laptops, an iPad with a trackpad keyboard). This reveals the control with no
  flash and no JavaScript.
- A **runtime heuristic** (`src/main.ts`): a `keydown` for a key an on-screen
  keyboard rarely emits — Tab, Escape, an arrow, a function key, or a
  Ctrl/Alt/Meta combo — adds `body.keyboard` and enables Vim. This catches the
  case the media query misses: a tablet with a Bluetooth keyboard, which
  iPadOS Safari still reports as a coarse/no-hover touch device
  ([WebKit #209292](https://bugs.webkit.org/show_bug.cgi?id=209292)).

### Install as an app (PWA)

The editor ships a **web app manifest** (`public/manifest.webmanifest`) and
icons, so it can be installed to a phone's home screen and launched
**standalone — without browser chrome** — for a native feel. A small
**service worker** (`public/sw.js`, cache-first with background refresh,
registered only in production builds) makes relaunches instant and the
installed app work offline, which suits a bundle whose large Typst compiler
WASM and fonts never change. The manifest's `start_url`/`scope` are relative, so
it works at any base path (the GitHub Pages project subpath as well as the dev
root).

## Preview controls

The preview pane has a toolbar with the usual document-viewer controls, plus a
draggable divider between the editor and the preview:

- **−/+** zoom out/in (with a percentage readout), **Sovita leveyteen** /
  **Sovita korkeuteen** fit the page width / a whole page to the pane (and
  re-fit live as the pane resizes), and **Kaksi sivua** toggles a two-page
  spread.
- Drag the bar between the editor and preview to rebalance them (arrow keys
  nudge it when focused).
- The zoom/fit mode, the one/two-page choice and the divider position are
  autosaved to `localStorage` alongside the document.

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

A companion `scripts/verify-ui.mjs` (same Chromium + `puppeteer-core` setup)
checks the editor chrome rather than the layout (it runs as an emulated touch
device): that the controls live in the bottom status bar, the keyboard-gated Vim
control is hidden with no keyboard and appears once a hardware keystroke is
detected, the Vim mode badge then tracks `NORMAL` → `VISUAL`, the visual-mode
selection is painted in a visible colour, and a conversion error
surfaces as a bottom-right `role="alert"` toast (with a working close button,
dismissed afterwards) without reflowing the header. It also checks the
accessibility and PWA work added here: every icon button has an accessible name
and an SVG icon, the view switch is a labelled `aria-pressed` group, the "Poista
logo" button stays hidden until a logo is uploaded, and the manifest /
theme-colour / apple-touch-icon / service-worker registration are all present.
For the responsive layout it confirms that at a phone viewport the header is
hidden, the panes collapse to one column with the Muokkaa / Esikatselu switch
toggling which is visible, and there is no horizontal overflow, while a wide
viewport shows both panes with the switch hidden.

That smoke test caught one real issue the CLI could not: by default typst.ts
fetches its built-in fonts from a CDN (jsdelivr), which breaks offline /
self-contained use. `web/src/main.ts` passes `preloadRemoteFonts(FONTS,
{ assets: false })` so only the bundled TeX Gyre faces are used and nothing is
fetched from the network.

## Logo upload

The committed Markdown examples carry a `logo:` frontmatter key pointing at a
file (`logo: ../logo-organisaatio.pdf`), but the browser has no filesystem
access, so that path is ignored here. Instead the editor's **Logo** control
uploads an image (PNG, JPEG or SVG): `src/main.ts` reads the file into a
`Uint8Array` and registers it in typst.ts's shadow virtual filesystem with
`$typst.mapShadow("/logo.<ext>", bytes)`, and the converter emits
`logo: image("/logo.<ext>")` into the `sfs-document(...)` call. The template
hangs it in the 20 mm margin and caps it at 20 mm height (scaling down only when
taller, like the LaTeX class), and the body drops to clear a tall logo by the
same gap the class keeps. **Poista logo** removes it again. SVG logos work
natively — Typst decodes SVG itself, so the pandoc pipeline's `rsvg-convert`
step is not needed. With no logo uploaded, the organisation name (`contact.name`)
stands in its place top-left, as in the LaTeX class.

## Known gaps (out of scope for the spike)

- Tagged-PDF accessibility (the class's `\DocumentMetadata{tagging=on}`) is not
  reproduced; Typst supports PDF/A and tagging, to revisit.
- PDF logos (as the committed examples use) cannot be uploaded — only the
  browser-native raster/SVG formats are accepted.
- PDF metadata is set from the front matter (title, author, keywords, the
  `lang fi`, and the document date as the creation/modification date), but
  Typst's `set document` has no *subject* field, so `subject` and a separate
  `modified` date are not written to the PDF properties (they are in the LaTeX
  output) — best-effort.
- Fonts are bundled in-repo for a self-contained prototype; a production build
  would pin them through nix instead.

This is a third rendering path alongside the LaTeX class and the pandoc front
end. Under the project's parity rule it is, for now, **best-effort** — the
LaTeX class remains the reference implementation.
