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

### Sandboxes without nix

Cloud sandboxes (e.g. Claude Code on the web) have neither nix nor
devenv, and their network policy may block installing nix. Use apt
instead — `sudo apt-get update`, then install the TeX Live packages,
latexmk, poppler-utils, pandoc and librsvg2-bin — and replicate the
`make markdown` flake pipeline manually with pandoc + latexmk. See
"Cloud Sandbox" in `CLAUDE.md` for the exact commands and the
parity-check caveat that comes with the different toolchain versions.

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
