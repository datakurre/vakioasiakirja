# Claude Code Development Guide

This document provides Claude Code-specific guidance for working on this project.

@AGENTS.md — Read this first for the full project context, build commands, and nix tooling basics.

## Quick Start

1. **Before starting**: Read `SFS-2487-2024.pdf` to understand what the 2024 standard requires. (It's not committed; it's available locally.)

2. **Edit the class file**: `sfs-2487-2024.cls` (or `sfs-2487-2000.cls` if fixing the 2000 version)

3. **Build and test**: `make TEXFILE=example-2024 build` to generate the PDF

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

### I need to compare the old and new standard

Both PDFs are available locally:
- `SFS-2487-2000.pdf` — Year 2000 version (reference for existing implementation)
- `SFS-2487-2024.pdf` — Year 2024 version (target spec for new implementation)

Extract and compare key sections with pdftotext, or open both side-by-side.

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

1. Confirm the `.cls` builds without errors: `make TEXFILE=example-2024 build`
2. Check that the PDF output visually matches the spec in `SFS-2487-2024.pdf`
3. If implementing a new version, also test that the old example still builds: `make TEXFILE=example-2000 build`
4. Clean up artifacts: `make clean`

## Troubleshooting

**LaTeX build fails**: Check the log output. Most issues are missing packages (add to `devenv.nix`) or syntax errors in the `.cls` file.

**Can't find a tool**: Use `nix search nixpkgs <query>` to find it, then add or use ad-hoc with `nix shell nixpkgs#<pkg> --command <tool>`.

**After editing `devenv.nix`, changes don't take effect**: Use `devenv shell --no-eval-cache` to force a re-evaluation.
