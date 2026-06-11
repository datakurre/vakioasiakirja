# Development

The development environment is managed with nix/devenv; see `AGENTS.md`
in the repository for agent-oriented details.

## Build targets

```bash
make shell                              # enter the devenv shell (TeX Live, latexmk, …)
make TEXFILE=esimerkki-poytakirja build # build a document (also the default target)
make examples                           # build every examples/latex/esimerkki-*.tex
make markdown                           # build every examples/markdown/esimerkki-*.md via the flake
make docs                               # build this documentation site into site/
make watch                              # rebuild on changes
make clean                              # remove build artifacts
```

## Repository layout

```
Pöytäkirjat/
├── sfs-2487-2024.cls           # The LaTeX document class
├── sfs-2487-2024-doc.tex       # User manual (typeset with l3build doc)
├── build.lua                   # l3build packaging configuration
├── LICENSE                     # MIT
├── flake.nix                   # Markdown-to-PDF converter (nix run .)
├── pandoc/
│   ├── sfs-2487-2024.latex     # Pandoc template: frontmatter → class commands
│   └── sfs-2487-2024.lua       # Pandoc filter: body conventions → class commands
├── examples/
│   ├── latex/esimerkki-*.tex   # Example documents, LaTeX originals
│   ├── markdown/esimerkki-*.md # The same documents written in Markdown
│   └── logo-*.tex              # Invented TikZ sample graphics (shared)
├── docs/                       # This documentation site (mkdocs)
├── mkdocs.yml
├── Makefile
└── devenv.nix                  # Nix development environment config
```

## Documentation site

The site is built with [mkdocs-material](https://squidfunk.github.io/mkdocs-material/),
provided by the flake's `docsEnv` package:

```bash
make docs                                   # examples + PDFs + mkdocs build → site/
nix shell .#docsEnv --command mkdocs serve  # live-preview the docs
```

`make docs` copies the freshly built example PDFs into `docs/pdf/`
(gitignored) so the [Examples](examples.md) page can link to them. A
GitHub Actions workflow builds and publishes the site to GitHub Pages on
every push to `main`.

## Packaging and releasing

The class is packaged for distribution with
[l3build](https://ctan.org/pkg/l3build) (available in the devenv
shell), configured by `build.lua` at the repository root:

```bash
l3build doc          # typeset the user manual sfs-2487-2024-doc.pdf
l3build install      # install the class into your TEXMF tree (~/texmf)
l3build tag <x.y>    # bump the version and date in the .cls and manual
l3build ctan         # build sfs-2487-2024-ctan.zip + sfs-2487-2024.tds.zip
```

The CTAN package ships the class, the English user manual, README and
LICENSE, and the invented example documents (`esimerkki-kokouskutsu`,
`esimerkki-raportti`, `esimerkki-kayttoohje` with their logo files).
`esimerkki-poytakirja` and `esimerkki-tarjous` replicate the standard's
own model documents and stay out of the package, as does the
proprietary spec PDF — always check `unzip -l sfs-2487-2024-ctan.zip`
before distributing. Uploading to CTAN is a separate, manual step at
[ctan.org/upload](https://ctan.org/upload).

All l3build work happens under `build/` (gitignored, safe to delete).

## Verifying against the standard

`esimerkki-poytakirja` and `esimerkki-tarjous` replicate the standard's
model documents (Liite A and B), so build them and compare against the
spec figures. For exact measurements use `pdftotext -bbox`: left margin
elements at 56.69 pt (20 mm), body text at 121.9 pt (43 mm), basic
metadata at 317.5 pt (112 mm).
