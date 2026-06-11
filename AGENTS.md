# Pöytäkirjat: Agent-Driven Development Guide

## Project Overview

**Pöytäkirjat** implements and maintains `sfs-2487-2024.cls`, a LaTeX document class for Finnish office documents (kirjeet, muistiot, pöytäkirjat, tarjoukset, …) following the **SFS 2487:2024** standard *Asiakirjan asettelu ja metatiedot*.

SFS 2487 is a Finnish standard specifying the layout, information areas and metadata of formal office documents. The class enforces the standard's formatting rules automatically; see `README.md` for the full user documentation, including a clause-by-clause mapping of the standard to class features.

## Current State

- **`sfs-2487-2024.cls`** — Complete implementation of SFS 2487:2024
  - Information areas on the 2,3 cm column grid, basic metadata 9,2 cm from the left margin, `1 (2)` page numbering, metadata repeated as a header from page 2 on
  - Class options: `agenda` (trailing-period heading numbers), `sansserif` (Helvetica look), plus pass-through `article` options such as `12pt`
  - Verified against the spec PDF; maintained, not under construction

## Spec PDF

- **`SFS-2487-2024.pdf`** — The target specification, available locally in this directory.

**Important:** The spec PDF is **gitignored** and **must not be committed**. It contains proprietary content and cannot be legally distributed. Agents can read it to understand requirements but should never commit it.

## Examples

Five committed `esimerkki-*.tex` documents exercise the whole class API; `esimerkki-poytakirja.tex` and `esimerkki-tarjous.tex` replicate the standard's own model documents (Liite A and B), so their output can be compared against the spec PDF directly. See the examples table in `README.md`.

## Build & Development

### Build LaTeX Documents

```bash
make build                              # Build esimerkki-poytakirja.tex (default)
make TEXFILE=esimerkki-raportti build   # Build a specific document
make examples                           # Build every esimerkki-*.tex
make clean                              # Remove build artifacts
make watch                              # Watch mode: rebuild on changes
make help                               # Show all targets
```

PDFs depend on `sfs-2487-2024.cls`, so editing the class triggers rebuilds.

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

## File Structure

```
Pöytäkirjat/
├── AGENTS.md                   # This file: AI agent orientation
├── CLAUDE.md                   # Claude Code-specific guidance
├── README.md                   # User documentation for the class
├── Makefile                    # Build targets
├── devenv.nix                  # Nix development environment config
├── devenv.local.nix            # Local overrides (not committed)
├── .claude/
│   └── skills/
│       └── nix-tools.md        # Skill: acquiring tools with nix
├── sfs-2487-2024.cls           # The LaTeX document class
├── esimerkki-poytakirja.tex    # Example: minutes (spec Liite A)
├── esimerkki-tarjous.tex       # Example: quotation (spec Liite B)
├── esimerkki-kokouskutsu.tex   # Example: meeting invitation ([agenda])
├── esimerkki-raportti.tex      # Example: multi-page report (TOC, table, footnote)
├── esimerkki-kayttoohje.tex    # Example: manual with captioned figures ([sansserif])
├── logo-organisaatio.tex       # Invented TikZ logo: Organisaatio Oy
├── logo-firma.tex              # Invented TikZ logo: Oy Firma Ab
├── logo-suoja-alue.tex         # Invented TikZ figure: logo clearance area
└── SFS-2487-2024.pdf           # Spec (gitignored, not distributed)
```

## Workflow

1. Read the relevant clause of the spec PDF to understand the requirement
2. Edit `sfs-2487-2024.cls`
3. Build the examples: `make examples`
4. Inspect the output PDFs — compare `esimerkki-poytakirja.pdf` and `esimerkki-tarjous.pdf` against the spec's Liite A/B figures; `pdftotext -bbox` gives exact positions (left margin 56.69 pt = 20 mm, body indent 121.9 pt = 43 mm, metadata 317.5 pt = 112 mm)
5. Iterate until the output matches the standard
6. `make clean` before finishing

## Technologies

- **LaTeX** — Document markup and typesetting
- **Nix** — Functional package manager for reproducible environments
- **devenv** — Declarative development environments via Nix
- **latexmk** — Automated LaTeX build tool
- **Makefile** — Build automation
