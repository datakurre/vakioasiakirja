# LaTeX Packaging Skill

This skill explains how to turn `sfs-2487-2024.cls` into a proper, distributable
LaTeX package: CTAN-compliant layout, l3build automation, TDS install trees, and
the actual CTAN submission. Use it when asked to "package", "release", "publish",
or "upload" the class, or to prepare a TDS zip / CTAN zip.

## Quick Reference

| Need | Action |
|------|--------|
| Drive the whole release | `l3build` with a `build.lua` (template below) |
| Typeset the user manual | `l3build doc` |
| Install into your own TEXMF tree | `l3build install` |
| Build the CTAN + TDS zips | `l3build ctan` (with `packtdszip = true`) |
| Bump version + date everywhere | `l3build tag <version>` (needs `update_tag`) |
| Upload to CTAN | `l3build upload` (validate first with `--dry-run`) |
| Get l3build | Add `l3build` to the `texlive.combine` set in `devenv.nix` |

## What "a proper LaTeX package" means here

CTAN (and through it TeX Live and MiKTeX) is the distribution channel for LaTeX
classes. A CTAN-ready package for this project is a zip named
`sfs-2487-2024.zip` containing a single top-level directory `sfs-2487-2024/`
with:

- `README.md` — short English introduction, author name, contact, license.
  Plain UTF-8, LF line endings, no BOM.
- `sfs-2487-2024.cls` — the class itself, **with a copyright + license notice**.
- `sfs-2487-2024-doc.pdf` (and its `.tex` source) — package documentation in
  PDF form. CTAN rejects packages without PDF documentation.
- Optionally the `examples/latex/esimerkki-*.tex` / `examples/logo-*.tex`
  files as demo files.

Optionally, a `sfs-2487-2024.tds.zip` next to (never instead of) the main zip,
laid out as a ready-to-unpack TDS tree:

```
tex/latex/sfs-2487-2024/sfs-2487-2024.cls
doc/latex/sfs-2487-2024/README.md
doc/latex/sfs-2487-2024/sfs-2487-2024-doc.pdf
doc/latex/sfs-2487-2024/esimerkki-*.tex        (demos live under doc/)
source/latex/sfs-2487-2024/...                  (only if .dtx sources exist)
```

`l3build ctan` produces both zips correctly; do not hand-roll them.

### Naming and versioning rules

- `sfs-2487-2024` is a valid CTAN package id: lowercase, starts with a letter,
  ≥ 4 chars, hyphens preferred over underscores. No renaming needed.
- Every upload — even a docs-only fix — must carry a version different from
  what is on CTAN. The class already tracks `\fileversion`/`\filedate`; keep
  those as the single source of truth and let `l3build tag` rewrite them.
- Reserved-prefix rules (`l3*`, `ltx-*`) don't apply here.

### Plain `.cls` vs `.dtx` (DocStrip)

Two legitimate source strategies:

1. **Plain `.cls` + standalone documentation `.tex`** *(recommended here)*.
   CTAN fully accepts this; the rule "don't ship generated `.cls`/`.sty`"
   only applies when the file *is* generated from a `.dtx`. The class is
   already richly commented in place, the git history is the change log, and
   examples double as tests. Just add a `sfs-2487-2024-doc.tex` user manual
   (English; can embed the Finnish examples).

2. **Literate `.dtx` + `.ins`** (traditional DocStrip): code and manual are
   interleaved in `sfs-2487-2024.dtx`; `latex sfs-2487-2024.ins` extracts the
   `.cls`, `pdflatex sfs-2487-2024.dtx` typesets the manual. Choose this only
   if asked for it — it is a large refactor of a working, comment-heavy class,
   and l3build makes it unnecessary for testing or releasing. If converting,
   `\DocInput` with the `ltxdoc` class and guards (`%<*class>` … `%</class>`)
   are the core mechanics, and the repo `.cls` becomes a build artifact
   (remove it from git, add to `.gitignore`).

## Blocking gaps to fix before any release

1. **No license.** Neither the repo nor the `.cls` declares one. CTAN requires
   a free license; **LPPL 1.3c** is the conventional choice for LaTeX classes.
   Add to the `.cls` header (and mirror in README):

   ```latex
   % Copyright (C) 2026 Asko Soukka <asko.soukka@iki.fi>
   %
   % This work may be distributed and/or modified under the conditions of
   % the LaTeX Project Public License, either version 1.3c of this license
   % or (at your option) any later version. The latest version is in
   %   https://www.latex-project.org/lppl.txt
   %
   % This work has the LPPL maintenance status `maintained'.
   % The Current Maintainer of this work is Asko Soukka.
   ```

   This is the author's legal decision — confirm before committing it.

2. **No standalone documentation.** README.md is good but CTAN needs a PDF
   manual. Write `sfs-2487-2024-doc.tex` (article or ltxdoc class) covering
   class options, metadata keys, and the description-list markup, much of
   which can be adapted from README.md.

3. **`SFS-2487-2024.pdf` must never enter any zip.** It is proprietary and
   gitignored. l3build only picks up files matched by the file-list variables
   below, which is the main safeguard — never add `*.pdf` to `docfiles` or
   `textfiles`. Always list the zip contents before uploading:
   `unzip -l sfs-2487-2024-ctan.zip`.

4. **Redistribution of Liite A/B content.** `esimerkki-poytakirja.tex` and
   `esimerkki-tarjous.tex` replicate the standard's own model documents. Before
   shipping them as demos on CTAN, the author must confirm that replicating
   that text is acceptable; if in doubt, ship only the invented examples
   (`esimerkki-kokouskutsu`, `esimerkki-raportti`, `esimerkki-kayttoohje`).

## l3build setup

l3build is CTAN/TeX Live's own release tool: it typesets docs, runs regression
tests, builds the CTAN and TDS zips, and talks to the CTAN upload API.

### Getting it

Add `l3build` to the `texlive.combine` set in `devenv.nix` (it needs `texlua`,
which ships with it), then refresh:

```nix
inherit (pkgs.texlive)
  scheme-basic
  ...
  l3build;   # <-- add
```

```bash
devenv shell --no-eval-cache -- l3build --version
```

### `build.lua` template for this project

Place at the repo root:

```lua
module = "sfs-2487-2024"

-- Plain-.cls workflow: nothing to unpack, install the class as-is.
sourcefiles  = {"sfs-2487-2024.cls"}
installfiles = {"*.cls"}
unpackfiles  = {}

-- Documentation and demos. The demo sources live under examples/;
-- l3build matches its file patterns inside docfiledir, so either point
-- docfiledir at the right subdirectory or copy the demos to the root in
-- a hook — then verify with `unzip -l` that they actually got picked up.
typesetfiles = {"sfs-2487-2024-doc.tex"}
demofiles    = {"esimerkki-*.tex", "logo-*.tex"}
textfiles    = {"README.md"}

-- Build a TDS zip alongside the CTAN zip.
packtdszip = true

-- Keep \filedate/\fileversion in sync via `l3build tag <version>`.
tagfiles = {"sfs-2487-2024.cls"}
function update_tag(file, content, tagname, tagdate)
  if string.match(file, "%.cls$") then
    content = string.gsub(content,
      "\\def\\filedate{%d%d%d%d/%d%d/%d%d}",
      "\\def\\filedate{" .. string.gsub(tagdate, "%-", "/") .. "}")
    content = string.gsub(content,
      "\\def\\fileversion{[^}]*}",
      "\\def\\fileversion{" .. tagname .. "}")
  end
  return content
end

uploadconfig = {
  pkg     = module,
  author  = "Asko Soukka",
  uploader = "Asko Soukka",
  email   = "asko.soukka@iki.fi",
  license = "lppl1.3c",
  summary = "Finnish standard office documents per SFS 2487:2024",
  ctanPath = "/macros/latex/contrib/sfs-2487-2024",
  topic   = {"class", "std-conform"},
  -- repository = "https://github.com/...",  -- once public
  -- update = true,                          -- after the first upload
  announcement_file = "ctan.ann",
}
```

`version` for the upload can be passed on the command line
(`l3build upload <version>`), so it never goes stale in `build.lua`.

### Release workflow

```bash
devenv shell --no-eval-cache -- l3build doc        # typeset the manual
devenv shell --no-eval-cache -- l3build install    # smoke-test into ~/texmf
devenv shell --no-eval-cache -- l3build tag 1.4    # bump \fileversion/\filedate
make examples                                      # examples still build
devenv shell --no-eval-cache -- l3build ctan       # build the zips
unzip -l sfs-2487-2024-ctan.zip                    # VERIFY: no spec PDF, no junk
devenv shell --no-eval-cache -- l3build upload --dry-run 1.4   # validate
devenv shell --no-eval-cache -- l3build upload 1.4             # submit
```

All work happens under `build/` (safe to delete; add to `.gitignore` along
with `*.curlopt` and the generated zips).

Uploading is also possible manually at <https://ctan.org/upload> with the zip
produced by `l3build ctan` — useful for the very first submission, where CTAN
staff review the package by hand anyway.

### Regression tests (optional but cheap)

l3build's test system compares typeset logs against saved `.tlg` files in
`testfiles/`. The existing `pdftotext -bbox` position checks (left margin
56.69 pt, body 121.9 pt, metadata 317.5 pt) can stay in the Makefile, but a
couple of `.lvt` tests asserting `\ProvidesClass` info and option handling make
TeX Live's automated rebuilds catch breakage. `l3build save <name>` records the
reference output.

## What not to put in the upload

- `SFS-2487-2024.pdf` (proprietary spec — also never in git)
- `.git*`, `.github/`, `devenv.*`, `flake.*`, `Makefile`, `AGENTS.md`,
  `CLAUDE.md`, `.claude/`, `pandoc/`, `docs/`, `mkdocs.yml`,
  `examples/markdown/` (repo tooling and website, not package content)
- Build artifacts: `.aux`, `.log`, `.fls`, `.fdb_latexmk`, `.out`, example PDFs
- Empty files or directories; anything with CRLF line endings

The `build.lua` file lists are inclusive, so these stay out automatically as
long as no wildcard like `*.pdf` or `*` is added to the file-list variables.

## After CTAN acceptance

- The package flows into TeX Live (usually within days) and MiKTeX
  automatically; users then get it with `tlmgr install sfs-2487-2024` and
  `texdoc sfs-2487-2024` opens the manual.
- nixpkgs regenerates its `texlive` set from TeX Live, so
  `pkgs.texlive.sfs-2487-2024` appears after the next TeX Live sync — the
  `devenv.nix` here could eventually consume the released class instead of the
  working copy.
- Subsequent releases: `l3build tag` → `l3build ctan` → `l3build upload`, with
  `update = true` in `uploadconfig`.

## Sources

- [CTAN: Submitting to CTAN](https://ctan.org/help/submit)
- [CTAN upload addendum (detailed rules)](https://ctan.math.illinois.edu/help/ctan/CTAN-upload-addendum.html)
- [CTAN: Guidelines for TDS-packaged uploads](https://www.ctan.org/TDS-guidelines)
- [l3build manual (PDF)](https://mirrors.mit.edu/CTAN/macros/latex/contrib/l3build/l3build.pdf)
- [CTAN: LPPL 1.3c](https://ctan.org/license/lppl1.3c)
