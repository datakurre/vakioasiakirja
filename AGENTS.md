# Pöytäkirjat: Agent-Driven Development Guide

## Project Overview

**Pöytäkirjat** implements and maintains `sfs-2487-2024.cls`, a LaTeX document class for Finnish office documents (kirjeet, muistiot, pöytäkirjat, tarjoukset, …) following the **SFS 2487:2024** standard *Asiakirjan asettelu ja metatiedot*.

SFS 2487 is a Finnish standard specifying the layout, information areas and metadata of formal office documents. The class enforces the standard's formatting rules automatically. Documents can also be written in Markdown and converted with the bundled nix flake (pandoc template + Lua filter in `pandoc/`). The full user documentation lives in `docs/` (an mkdocs site published to GitHub Pages, including the clause-by-clause mapping of the standard to class features); `README.md` is the short landing page.

## Current State

- **`sfs-2487-2024.cls`** — Complete implementation of SFS 2487:2024
  - Information areas on the 2,3 cm column grid, basic metadata 9,2 cm from the left margin, `1 (2)` page numbering, metadata repeated as a header from page 2 on
  - Class options: `serif` (Palatino), `sans-serif` (Helvetica, default), `monospace` (Courier), `agenda` (trailing-period heading numbers), plus pass-through `article` options such as `12pt`
  - Verified against the spec PDF; maintained, not under construction

## Spec PDF

- **`SFS-2487-2024.pdf`** — The target specification. It is **not always present** in the working directory; ask the user to provide it if you need to read it.

**Important:** The spec PDF is **gitignored** and **must not be committed**. It contains proprietary content and cannot be legally distributed. Agents can read it to understand requirements but should never commit it.

## Examples

Five committed example documents exercise the whole class API, each in two source formats: a LaTeX original in `examples/latex/esimerkki-*.tex` and a Markdown twin in `examples/markdown/esimerkki-*.md` that must produce the same layout via the pandoc front end. `esimerkki-poytakirja` and `esimerkki-tarjous` replicate the standard's own model documents (Liite A and B), so their output can be compared against the spec PDF directly. See `docs/examples.md`.

**Parity rule:** when adding a class feature, support it in both formats — add the LaTeX command to `sfs-2487-2024.cls` and its Markdown mapping to `pandoc/sfs-2487-2024.latex` (frontmatter) or `pandoc/sfs-2487-2024.lua` (body), and exercise it in both example variants.

## Build & Development

### Build LaTeX Documents

```bash
make build                              # Build examples/latex/esimerkki-poytakirja.tex (default)
make TEXFILE=esimerkki-raportti build   # Build a specific document
make examples                           # Build every examples/latex/esimerkki-*.tex
make markdown                           # Build every examples/markdown/esimerkki-*.md via the flake
make docs                               # Build the mkdocs documentation site into site/
make clean                              # Remove build artifacts
make watch                              # Watch mode: rebuild on changes
make help                               # Show all targets
```

PDFs depend on `sfs-2487-2024.cls`, so editing the class triggers rebuilds.

### Verifying output against the spec (all three pipelines)

The class is the reference implementation; the markdown→LaTeX (pandoc) and
markdown→typst (`web/`) pipelines must reproduce its layout. Tools come from
nix ad-hoc (`nix shell --inputs-from . nixpkgs#<pkg>`), so nothing needs to be
in `devenv.nix`.

**Reading the spec PDF.** `pdftotext -layout SFS-2487-2024.pdf -` puts the body
text in a deep right-hand column and repeats an SFS Online watermark on every
page; strip it before reading clause text:

```bash
nix shell nixpkgs#poppler-utils --command pdftotext -layout SFS-2487-2024.pdf - \
  | grep -viE 'Lataaja|kirjasto käyttöön|ladattu SFS Online' | sed -E 's/^ +//'
```

The authoritative numbers (clauses 6.4.2–6.4.3, 5.2, Taulukko 2): left & bottom
margin 2 cm, other margins ≥ 1 cm, basic column 2,3 cm, body text 2,3 cm from
the left margin (max line width 15,7 cm), basic metadata 9,2 cm from the left
margin, body font 11–12 pt, line spacing 1,1–1,2, paragraph gap ≥ 10 pt, main
title bold and 2–4 pt larger than body. Metadata order: doctype (bold), date,
docid, confidentiality.

**Measuring a PDF.** `pdftotext -bbox` emits per-*word* boxes (x-positions);
`mutool draw -F stext` (nixpkgs#mupdf-headless) emits per-*line* boxes plus font
name and size. Useful one-liners:

```bash
# x-grid tally — expect 56.69 pt (20 mm margin), 121.9 pt (43 mm body),
# 317.5 pt (112 mm metadata):
pdftotext -bbox -f 1 -l 1 file.pdf - | grep -oE 'xMin="[0-9.]+"' \
  | sort -t'"' -k2 -n | uniq -c | sort -rn | head
# font name + size per run (body 10.9091 pt = the 11pt class's \@xipt; title +3pt):
mutool draw -F stext -o - file.pdf | grep -oE 'font name="[^"]+" size="[0-9.]+"' \
  | sort | uniq -c | sort -rn
# line-baseline deltas — within-paragraph leading ≈ 13.15 pt, paragraph gap
# adds ≈ 11.6 pt on top (≈ 24.75 pt baseline-to-baseline):
mutool draw -F stext -o - file.pdf | grep -oE '<line bbox="[0-9.]+ [0-9.]+' \
  | sed -E 's/<line bbox=.[0-9.]+ //' \
  | awk '{if(p!=""){d=$1-p; if(d>0)printf "%.1f d=%.2f\n",$1,d}; p=$1}'
```

**Compiling the typst pipeline outside the browser.** The web editor runs
typst.ts in-browser, but the same `.typ` compiles with the nix `typst` CLI for
measurement. Convert markdown with the shared porter, then compile against the
class's root and the bundled metric-compatible fonts:

```bash
( cd web && nix shell --inputs-from .. nixpkgs#nodejs --command npm install )  # once
cd web && nix shell --inputs-from .. nixpkgs#nodejs --command \
  node --experimental-strip-types scripts/convert.ts ../examples/markdown/esimerkki-X.md \
  > src/_tmp.typ
nix shell --inputs-from .. nixpkgs#typst --command typst compile \
  --root src --font-path public/fonts src/_tmp.typ /tmp/X-typst.pdf
rm src/_tmp.typ   # keep the temp out of web/src
```

`convert.ts` imports the markdown deps, so `npm install` in `web/` is required
first. The CLI `typst` (≈ 0.14) is a newer engine than the pinned
`@myriaddreamin/typst.ts` (0.7.0-rc2 ≈ typst 0.13) the editor ships, but layout
metrics match closely enough for the position/size checks above. The bundled
`web/public/fonts/texgyre*.otf` are the metric-compatible stand-ins (Heros↔
Helvetica, Pagella↔Palatino, Cursor↔Courier) the typst module names, so feeding
them via `--font-path` reproduces the editor's spacing. Note the frontmatter
`logo:` path is *not* read in the browser pipeline (logos are uploaded), so a
CLI/LaTeX comparison of a logo document differs in the logo area only.

### CTAN Packaging

The class is packaged for CTAN with **l3build** (configured in `build.lua`): `l3build ctan` builds the release zips, `l3build tag <version>` syncs the version/date strings across the class and its documentation. See `.claude/skills/latex-packaging.md` for the full release workflow.

### Development Environment

This project uses **nix** and **devenv** for reproducible development:

```bash
make shell              # Enter devenv shell with all TeX packages
devenv shell            # Equivalent, more explicit
```

Current packages in `devenv.nix`:
- TeX Live (scheme-basic + babel-finnish, hyperref, mathpazo, microtype, caption, etc.)
- Build tools: latexmk, gnumake
- Utilities: curl, ghostscript, unzip, which, treefmt

### Getting Additional Tools

When you need a tool not in `devenv.nix`:

1. **Ad-hoc, one-off**: `nix shell nixpkgs#<package> --command <cmd> <args>`
   - Example: `nix shell nixpkgs#python3 --command python3 script.py`
   - No installation, no PATH changes

2. **Temporary shell** (multiple packages): `nix shell nixpkgs#<pkg1> nixpkgs#<pkg2> --command <cmd>`
   - Example: `nix shell nixpkgs#python3 nixpkgs#nodejs --command npm install`

3. **Devenv shell** (all packages): `devenv shell --no-eval-cache -- <cmd>`
   - Uses everything from `devenv.nix`
   - `--no-eval-cache` forces refresh after you edit `devenv.nix`

4. **Permanent addition**: Edit `devenv.nix`, add `pkgs.<name>` to the `packages` list, then use `devenv shell --no-eval-cache`

See `.claude/skills/nix-tools.md` for detailed examples and patterns.

### Cloud sandboxes: install nix from apt

Cloud sandboxes (e.g. Claude Code on the web) are plain Ubuntu
containers without nix or devenv. The network policy blocks
`nixos.org`, so the official installer is unavailable — but
`cache.nixos.org` and GitHub are reachable, so Ubuntu's own nix
package gives a fully working nix:

```bash
sudo apt-get update          # required first: the baked-in index is stale
sudo apt-get install -y nix-bin poppler-utils
printf 'experimental-features = nix-command flakes\n' | sudo tee /etc/nix/nix.conf
```

After that the flake works as on any other machine, so changes can be
verified with the real pinned toolchain:

```bash
make markdown                                  # or: nix run . -- <file.md>
nix shell .#texliveEnv --command make examples # pinned TeX Live for the LaTeX side
```

The first build fetches ~1.5 GB from cache.nixos.org and takes a few
minutes; later runs start from the store. The sandbox user is root, so
`sudo` is optional. Two caveats: bare registry references such as
`nix shell nixpkgs#<pkg>` resolve `nixpkgs` through the GitHub API and
can hit unauthenticated rate limits — use
`nix shell --inputs-from . nixpkgs#<pkg>` to reuse the flake's locked
nixpkgs instead. And `devenv` is still unavailable, but the flake
provides the whole toolchain so it isn't needed.

If nix can't be installed after all, fall back to an apt TeX Live —
see "Cloud Sandbox" in `CLAUDE.md` for the commands and caveats.

## File Structure

```
Pöytäkirjat/
├── AGENTS.md                   # This file: AI agent orientation
├── CLAUDE.md                   # Claude Code-specific guidance
├── README.md                   # Short landing page (full docs in docs/)
├── Makefile                    # Build targets
├── flake.nix                   # Markdown-to-PDF converter + docsEnv (mkdocs)
├── devenv.nix                  # Nix development environment config
├── devenv.local.nix            # Local overrides (not committed)
├── mkdocs.yml                  # Documentation site configuration
├── .github/
│   └── workflows/
│       └── docs.yml            # CI: build examples + docs, deploy to GitHub Pages
├── .claude/
│   └── skills/
│       ├── nix-tools.md        # Skill: acquiring tools with nix
│       └── latex-packaging.md  # Skill: l3build packaging and CTAN releasing
├── sfs-2487-2024.cls           # The LaTeX document class
├── sfs-2487-2024-doc.tex       # CTAN package documentation source
├── build.lua                   # l3build configuration (CTAN packaging)
├── LICENSE                     # MIT license
├── pandoc/
│   ├── sfs-2487-2024.latex     # Pandoc template: frontmatter → class commands
│   └── sfs-2487-2024.lua       # Pandoc filter: body conventions → class commands
├── examples/
│   ├── latex/
│   │   ├── esimerkki-poytakirja.tex   # Example: minutes (spec Liite A)
│   │   ├── esimerkki-tarjous.tex      # Example: quotation (spec Liite B)
│   │   ├── esimerkki-kokouskutsu.tex  # Example: meeting invitation ([agenda])
│   │   ├── esimerkki-raportti.tex     # Example: multi-page report (TOC, table, footnote)
│   │   ├── esimerkki-kayttoohje.tex   # Example: manual with captioned figures ([sans-serif])
│   │   └── esimerkki-monospace.tex    # Example: memo with Courier typewriter font ([monospace])
│   ├── markdown/
│   │   └── esimerkki-*.md      # Markdown twins of the LaTeX examples
│   ├── logo-organisaatio.tex   # Invented TikZ logo: Organisaatio Oy
│   ├── logo-firma.tex          # Invented TikZ logo: Oy Firma Ab
│   └── logo-suoja-alue.tex     # Invented TikZ figure: logo clearance area
├── docs/                       # User documentation (mkdocs site, published to Pages)
└── SFS-2487-2024.pdf           # Spec (gitignored, not distributed, not always present)
```

## Workflow

1. Read the relevant clause of the spec PDF to understand the requirement (if `SFS-2487-2024.pdf` is not present, ask the user to provide it)
2. Edit `sfs-2487-2024.cls` (and the pandoc template/filter for the Markdown mapping)
3. Build the examples: `make examples` and `make markdown`
4. Inspect the output PDFs — compare `examples/latex/esimerkki-poytakirja.pdf` and `examples/latex/esimerkki-tarjous.pdf` against the spec's Liite A/B figures; `pdftotext -bbox` gives exact positions (left margin 56.69 pt = 20 mm, body indent 121.9 pt = 43 mm, metadata 317.5 pt = 112 mm)
5. Check Markdown/LaTeX parity: the text of `examples/markdown/esimerkki-*.pdf` should match its LaTeX twin (`diff` the `pdftotext -layout` outputs)
6. Iterate until the output matches the standard
7. `make clean` before finishing

## Technologies

- **LaTeX** — Document markup and typesetting
- **pandoc** — Markdown front end (template + Lua filter in `pandoc/`)
- **Nix** — Functional package manager for reproducible environments
- **devenv** — Declarative development environments via Nix
- **latexmk** — Automated LaTeX build tool
- **mkdocs (material)** — Documentation site, published via GitHub Pages
- **Makefile** — Build automation
