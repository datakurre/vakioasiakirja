# Pöytäkirjat: Agent-Driven Development Guide

## Project Overview

**Pöytäkirjat** implements and maintains LaTeX document classes for Finnish office documents (minutes, memos) following the **SFS 2487 standard**.

SFS 2487 is a Finnish standard specifying the layout and typography of formal office documents. This project provides `.cls` files (LaTeX document classes) that enforce the standard's formatting rules automatically.

## Current State

- **`sfs-2487-2000.cls`** — Complete implementation for SFS 2487-2000 (year 2000 revision)
  - Handles page layout, headers/footers, fonts, section formatting, signature blocks
  - Uses Mathpazo font family and microtype for typography
  - See `example-2000.tex` for usage example
  - Tested and working

## Next Goal

- **`sfs-2487-2024.cls`** — Implement the 2024 revision of the SFS 2487 standard
  - Start by reading `SFS-2487-2024.pdf` (available locally, not distributed) to understand what changed
  - Reference `SFS-2487-2000.pdf` to understand the existing implementation approach
  - Update the document class to match the new requirements

## Spec PDFs

Two specification documents are available in this directory:

- **`SFS-2487-2000.pdf`** — Reference specification (year 2000 revision)
- **`SFS-2487-2024.pdf`** — Target specification (year 2024 revision)

**Important:** These PDFs are **gitignored** and **must not be committed** to the repository. They contain proprietary content and cannot be legally distributed. Agents can read them to understand requirements but should never commit them.

## Build & Development

### Build LaTeX Documents

```bash
make build                      # Build example-2000.tex → example-2000.pdf
make TEXFILE=example-2024 build # Build example-2024.tex → example-2024.pdf
make clean                      # Remove build artifacts
make watch                      # Watch mode: rebuild on changes
make help                       # Show all targets
```

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
├── AGENTS.md              # This file: AI agent orientation
├── CLAUDE.md              # Claude Code-specific guidance
├── Makefile               # Build targets
├── devenv.nix             # Nix development environment config
├── devenv.local.nix       # Local overrides (not committed)
├── .claude/
│   └── skills/
│       └── nix-tools.md   # Skill: acquiring tools with nix
├── example-2000.tex       # Example SFS 2487-2000 document
├── example-2024.tex       # Example SFS 2487-2024 document (to be created)
├── sfs-2487-2000.cls      # LaTeX class for SFS 2487-2000
├── sfs-2487-2024.cls      # LaTeX class for SFS 2487-2024 (to be created)
├── SFS-2487-2000.pdf      # Spec (gitignored, not distributed)
└── SFS-2487-2024.pdf      # Spec (gitignored, not distributed)
```

## Workflow

1. Read the relevant PDF spec to understand requirements
2. Edit the `.cls` file to implement the standard
3. Test with an example `.tex` file: `make TEXFILE=example-2024 build`
4. Inspect the output PDF in the IDE or preview
5. Iterate until the output matches the standard

## Technologies

- **LaTeX** — Document markup and typesetting
- **Nix** — Functional package manager for reproducible environments
- **devenv** — Declarative development environments via Nix
- **latexmk** — Automated LaTeX build tool
- **Makefile** — Build automation
