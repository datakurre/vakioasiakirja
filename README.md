# sfs-2487-2024 — LaTeX document class for SFS 2487:2024

A LaTeX document class for Finnish office documents (kirjeet, muistiot,
pöytäkirjat, tarjoukset, …) following the **SFS 2487:2024** standard
*Asiakirjan asettelu ja metatiedot*.

The class lays out the standard's information areas (tietoalueet)
automatically: basic metadata 9,2 cm from the left margin with a `1 (2)`
page number, body text on the 2,3 cm column grid, headings hanging at the
left margin, and the metadata block repeated as a page header from page 2
onward.

**Full documentation lives in [`docs/`](docs/index.md)** and is published
as a website by the GitHub Pages workflow:

- [Writing in Markdown](docs/markdown.md) — frontmatter and body reference
- [Writing in LaTeX](docs/latex.md) — class options and commands
- [The standard, clause by clause](docs/standard.md) — layout numbers and
  the SFS 2487:2024 clause mapping
- [Accessibility](docs/accessibility.md) — tagged PDF (liite D)
- [Examples](docs/examples.md) — the example documents in both formats
- [Development](docs/development.md) — building the examples and the docs

## Quick start: Markdown

The recommended way to use the class is to **write the document in
Markdown** and let the bundled nix flake render the PDF — no LaTeX
knowledge or TeX installation needed:

```markdown
---
doctype: Pöytäkirja
title: Asiakaspalautteet ja etusivun uudistaminen
subject: Digiprojekti
date: 15.5.2024
author: Virve Virtanen
confidentiality: Luottamuksellinen
---

Aika ja paikka
:   13.5.2024 klo 12.30--13.45\
    Verkkokokous

# Kokouksen avaus

Puheenjohtaja avasi kokouksen ja toivotti kaikki tervetulleiksi.
```

Build it with the flake — pandoc, TeX Live and the class are all
provided, the only requirement is [nix](https://nixos.org):

```bash
nix run . -- oma-poytakirja.md     # writes oma-poytakirja.pdf next to it
```

See [Writing in Markdown](docs/markdown.md) for the full frontmatter and
body reference, installation as a regular command, and running straight
from a hosted copy with `nix run github:<owner>/<repo>`.

## Quick start: LaTeX

The class can also be used directly, with the full power of LaTeX:

```latex
\documentclass{sfs-2487-2024}

\doctype{Pöytäkirja}
\date{15.5.2024}
\author{Virve Virtanen}
\title{Asiakaspalautteet ja etusivun uudistaminen}

\begin{document}
\maketitle

\section{Kokouksen avaus}

Puheenjohtaja avasi kokouksen ja toivotti kaikki tervetulleiksi.

\end{document}
```

See [Writing in LaTeX](docs/latex.md) for the complete command reference.

## Examples

Every example exists in both formats — a LaTeX original in
[`examples/latex/`](examples/latex/) and a Markdown twin in
[`examples/markdown/`](examples/markdown/) producing the same layout.
`esimerkki-poytakirja` and `esimerkki-tarjous` replicate the standard's
own model documents (Liite A and B); see [Examples](docs/examples.md)
for the full list with rendered PDFs.

```bash
make examples     # build every examples/latex/esimerkki-*.tex
make markdown     # build every examples/markdown/esimerkki-*.md via the flake
```

## Installing the class

For use outside this repository, the class can be installed into your
own TEXMF tree with [l3build](https://ctan.org/pkg/l3build):

```bash
l3build install     # copies sfs-2487-2024.cls into ~/texmf
```

## Development

The development environment is managed with nix/devenv; see
[Development](docs/development.md) and `AGENTS.md`.

```bash
make shell                              # enter the devenv shell (TeX Live, latexmk, …)
make TEXFILE=esimerkki-poytakirja build # build a document (also the default target)
make docs                               # build the documentation site into site/
make clean                              # remove build artifacts
```

## License

[MIT](LICENSE) © 2026 Asko Soukka.
