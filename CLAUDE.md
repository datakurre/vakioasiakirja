# Claude Code Development Guide

This document provides Claude Code-specific guidance for working on this project.

@AGENTS.md — Read this first for the full project context, build commands, and nix tooling basics.

## Quick Start

1. **Before starting**: Read the relevant clause of `SFS-2487-2024.pdf` to understand what the standard requires. (It's not committed; it's available locally.)

2. **Edit the class file**: `sfs-2487-2024.cls`

3. **Build and test**: `make examples` builds every `esimerkki-*.tex` (or `make TEXFILE=esimerkki-poytakirja build` for one)

4. **Inspect**: Open the generated PDF in the IDE or a viewer to verify output matches the standard

5. **Iterate**: Edit, rebuild, inspect until correct

## Available Skills

- **`/nix-tools`** — How to get any tool with nix ad-hoc or permanently. Invoke when you need a language, library, or utility not in devenv.

## Common Tasks

### I need to inspect a PDF programmatically

Use `nix shell nixpkgs#poppler-utils --command pdftotext <file.pdf> -` to extract text, or `pdfinfo`, `pdfimages`, etc.

Example:
```bash
nix shell nixpkgs#poppler-utils --command pdftotext SFS-2487-2024.pdf - | head -20
```

### I need Python, Node.js, or another language

Use nix to run it ad-hoc:
```bash
nix shell nixpkgs#python3 --command python3 my_script.py
nix shell nixpkgs#nodejs --command node index.js
```

Or add to `devenv.nix` if you'll use it repeatedly, then `devenv shell --no-eval-cache`.

### I need to verify output against the spec

`esimerkki-poytakirja.tex` and `esimerkki-tarjous.tex` replicate the
standard's own model documents (Liite A and B in `SFS-2487-2024.pdf`),
so build them and compare against the spec figures. For exact
measurements use `pdftotext -bbox`: left margin elements at 56.69 pt
(20 mm), body text at 121.9 pt (43 mm), basic metadata at 317.5 pt
(112 mm). `mutool draw -F stext` (nixpkgs#mupdf-headless) reveals
per-line font name and size, e.g. to check heading boldness.

Note: latexmk `.log` files are ISO-8859 encoded and plain `grep`
prints nothing on them — pipe through `strings file.log | grep …`.

### I need to find what package provides a tool

```bash
nix search nixpkgs image
```

This searches for packages matching "image". Use to find things like ImageMagick, GraphicsMagick, Ghostscript, etc.

## Development Environment

Enter the full devenv shell:
```bash
make shell
# or
devenv shell
```

This loads all TeX, build tools, and utilities from `devenv.nix`.

To run a one-off command in the devenv shell without entering it:
```bash
devenv shell --no-eval-cache -- latexmk -pdf myfile.tex
```

## Verification Workflow

Before completing a task:

1. Confirm every example builds without errors: `make examples`
2. Check that the PDF output visually matches the spec in `SFS-2487-2024.pdf` (Liite A ↔ `esimerkki-poytakirja.pdf`, Liite B ↔ `esimerkki-tarjous.pdf`)
3. Clean up artifacts: `make clean`

## Troubleshooting

**LaTeX build fails**: Check the log output. Most issues are missing packages (add to `devenv.nix`) or syntax errors in the `.cls` file.

**Can't find a tool**: Use `nix search nixpkgs <query>` to find it, then add or use ad-hoc with `nix shell nixpkgs#<pkg> --command <tool>`.

**After editing `devenv.nix`, changes don't take effect**: Use `devenv shell --no-eval-cache` to force a re-evaluation.
