# Nix Tools Skill

This skill guides you in acquiring any tool, language, or utility using the nix package manager. Use this when you need something not currently in the shell.

## Quick Reference

| Need | Command | Notes |
|------|---------|-------|
| One-off command | `nix shell nixpkgs#<pkg> --command <cmd> <args>` | No installation, ephemeral |
| Multiple packages | `nix shell nixpkgs#<pkg1> nixpkgs#<pkg2> --command <cmd>` | Multiple packages, runs one command |
| With devenv | `devenv shell --no-eval-cache -- <cmd>` | Uses all packages from `devenv.nix` + cache refresh |
| Find a package | `nix search nixpkgs <query>` | Search nixpkgs by keyword |
| Permanent addition | Edit `devenv.nix`, add `pkgs.<name>`, then `devenv shell --no-eval-cache` | Persistent across shell sessions |

## Ad-Hoc: Single Command

Run a tool once without installing it using `nix shell`:

```bash
nix shell nixpkgs#python3 --command python3 my_script.py
nix shell nixpkgs#nodejs --command node index.js
nix shell nixpkgs#imagemagick --command convert input.png output.jpg
```

**When to use**: You need a tool for a one-off task and don't want to add it permanently.

## Ad-Hoc: Temporary Shell

Drop into a temporary shell with multiple packages, run one command, then exit:

```bash
nix shell nixpkgs#python3 nixpkgs#nodejs --command npm install
nix shell nixpkgs#imagemagick nixpkgs#ghostscript --command gm convert file.ps file.pdf
```

**When to use**: You need 2+ tools for a single task, or a quick interactive exploration.

## Devenv Shell

Run a command using all packages from `devenv.nix`:

```bash
devenv shell --no-eval-cache -- latexmk -pdf myfile.tex
devenv shell --no-eval-cache -- python3 analyze.py
```

The `--no-eval-cache` flag forces nix to re-read `devenv.nix`, picking up any recent edits.

**When to use**: You want to use the project's full environment without entering an interactive shell.

## Permanent Addition to devenv

If you'll use a tool repeatedly, add it to `devenv.nix`:

1. **Search for the package**:
   ```bash
   nix search nixpkgs poppler
   ```
   Output will show packages like `nixpkgs.poppler_utils`. Note the package name.

2. **Edit `devenv.nix`** and add to the `packages` list:
   ```nix
   { pkgs, ... }:
   {
     packages = [
       (pkgs.texlive.combine { ... })
       pkgs.curl
       pkgs.ghostscript
       pkgs.gnumake
       pkgs.treefmt
       pkgs.unzip
       pkgs.which
       pkgs.poppler_utils  # <-- Add this line
     ];
     ...
   }
   ```

3. **Use the tool directly** (no `nix run` wrapper needed):
   ```bash
   devenv shell --no-eval-ache -- pdftotext file.pdf -
   ```

**When to use**: You'll invoke the tool more than once in this session, or it's a core project dependency.

## Examples

### Extract text from a PDF

```bash
nix shell nixpkgs#poppler-utils --command pdftotext SFS-2487-2024.pdf - | head -20
```

### Get PDF metadata

```bash
nix shell nixpkgs#poppler-utils --command pdfinfo SFS-2487-2024.pdf
```

### Run a Python script

```bash
nix shell nixpkgs#python3 --command python3 my_analysis.py
```

### Use multiple tools in one command

```bash
nix shell nixpkgs#imagemagick nixpkgs#ghostscript --command \
  convert input.pdf -density 300 output.png
```

### Add Python to devenv permanently

```bash
# 1. Search
nix search nixpkgs python

# 2. Add to devenv.nix
pkgs.python3

# 3. Reload
devenv shell --no-eval-cache

# 4. Use
python3 my_script.py
```

## Troubleshooting

**"Package not found"**: Use `nix search nixpkgs <query>` to find the exact package name. Package names often differ from command names (e.g., `poppler_utils` provides `pdftotext`).

**"Changes to devenv.nix didn't take effect"**: Always use `devenv shell --no-eval-cache` after editing `devenv.nix`. The `--no-eval-cache` flag is crucial.

**"Too slow to start"**: Ad-hoc `nix run` downloads the package on first use. For frequently-used tools, add to `devenv.nix` and reload once.

**"Which package provides X tool?"**: Try `nix search nixpkgs <toolname>` or search online for "nixpkgs <toolname>".
