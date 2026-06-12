# Claude Code Development Guide

This document provides Claude Code-specific guidance for working on this project.

@AGENTS.md — Read this first for the full project context, build commands, and nix tooling basics.

## Quick Start

1. **Before starting**: Read the relevant clause of `SFS-2487-2024.pdf` to understand what the standard requires. (It's not committed and may not be present — ask the user to provide it if needed.)

2. **Edit the class file**: `sfs-2487-2024.cls`

3. **Build and test**: `make examples` builds every `examples/latex/esimerkki-*.tex` (or `make TEXFILE=esimerkki-poytakirja build` for one); `make markdown` builds the `examples/markdown/esimerkki-*.md` twins via the nix flake

4. **Inspect**: Open the generated PDF in the IDE or a viewer to verify output matches the standard

5. **Iterate**: Edit, rebuild, inspect until correct

## Available Skills

- **`/nix-tools`** — How to get any tool with nix ad-hoc or permanently. Invoke when you need a language, library, or utility not in devenv.
- **`/latex-packaging`** — l3build packaging and CTAN releasing. Invoke when working on `build.lua`, tagging a release, or preparing a CTAN upload.

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

`examples/latex/esimerkki-poytakirja.tex` and
`examples/latex/esimerkki-tarjous.tex` replicate the
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

## Cloud Sandbox (Claude Code on the web)

Remote sandbox sessions run in a plain Ubuntu container: `nix`,
`devenv` and TeX are **not** preinstalled, and the network policy
blocks `nixos.org` (HTTP 403 `host_not_allowed`), so the official nix
installer is unavailable. But `cache.nixos.org` is reachable, so
Ubuntu's own `nix-bin` package works fully — install nix from apt and
verify with the regular flake workflow (see "Cloud sandboxes" in
`AGENTS.md`):

```bash
sudo apt-get update   # required first: the baked-in index is stale (404s)
sudo apt-get install -y nix-bin poppler-utils
printf 'experimental-features = nix-command flakes\n' | sudo tee /etc/nix/nix.conf
```

(`apt-get update` reports a 403 for an unrelated `ondrej/php` PPA —
harmless, ignore it.)

After that `make markdown` and `nix run . -- <file.md>` work as
documented above, and `nix shell .#texliveEnv --command make examples`
builds the LaTeX examples with the flake's pinned TeX Live, so both
sides of the parity check use the same toolchain. The first build
fetches ~1.5 GB from cache.nixos.org and takes a few minutes. For
ad-hoc tools, prefer `nix shell --inputs-from . nixpkgs#<pkg>` — the
bare `nixpkgs#<pkg>` form resolves the registry through the GitHub API
and can hit unauthenticated rate limits.

### Fallback: apt TeX Live (if nix can't be used)

```bash
sudo apt-get install -y texlive-latex-recommended texlive-latex-extra \
  texlive-lang-european latexmk poppler-utils pandoc librsvg2-bin
```

After that `make examples` works directly. `make markdown` does not
(it needs `nix run`), so replicate the flake's pipeline (see
`flake.nix`) manually per file:

```bash
input="$(realpath examples/markdown/esimerkki-poytakirja.md)"
dir="$(dirname "$input")"; base="$(basename "$input" .md)"
tmp="$(mktemp -d)"; export SFS_2487_TMPDIR="$tmp"
(cd "$dir" && pandoc --standalone \
  --template "$PWD/../../pandoc/sfs-2487-2024.latex" \
  --lua-filter "$PWD/../../pandoc/sfs-2487-2024.lua" \
  --output "$tmp/document.tex" "$input" && \
 TEXINPUTS="$dir:$PWD/../..:" latexmk -pdf -interaction=nonstopmode \
   -quiet -output-directory="$tmp" "$tmp/document.tex" && \
 cp "$tmp/document.pdf" "$dir/$base.pdf")
rm -rf "$tmp"
```

**Parity-check caveat:** the strict `pdftotext -layout` diff shows
small whitespace-only differences (blank lines, table column spacing)
in `esimerkki-poytakirja` and `esimerkki-raportti` even when both
sides are built with the flake's pinned toolchain — they come from how
pandoc-generated table code spaces columns, not from your change or
the environment. Squash whitespace to check content parity
(`pdftotext -layout file.pdf - | tr -s ' \n'`), or diff against a
pristine-checkout (`git stash`) baseline: only differences absent from
the baseline are regressions. `pdftotext -bbox` position checks
(en dash / item numbers at 121.89 pt, etc.) remain reliable.

## Verification Workflow

Before completing a task:

1. Confirm every example builds without errors: `make examples` and `make markdown`
2. Check that the PDF output visually matches the spec in `SFS-2487-2024.pdf` (Liite A ↔ `examples/latex/esimerkki-poytakirja.pdf`, Liite B ↔ `examples/latex/esimerkki-tarjous.pdf`) — if the spec PDF is not present, ask the user to provide it
3. Check Markdown/LaTeX parity: `diff` the `pdftotext -layout` text of each `examples/markdown/esimerkki-*.pdf` against its LaTeX twin
4. Clean up artifacts: `make clean`

## Troubleshooting

**LaTeX build fails**: Check the log output. Most issues are missing packages (add to `devenv.nix`) or syntax errors in the `.cls` file.

**Build fails with `tikz.sty`/`ragged2e.sty` not found**: You ran `make` outside the devenv shell — the `latexmk` on PATH is a different TeX Live without the class's packages. Run `devenv shell --no-eval-cache -- make examples` instead.

**Can't find a tool**: Use `nix search nixpkgs <query>` to find it, then add or use ad-hoc with `nix shell nixpkgs#<pkg> --command <tool>`.

**After editing `devenv.nix`, changes don't take effect**: Use `devenv shell --no-eval-cache` to force a re-evaluation.
