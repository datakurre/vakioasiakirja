# sfs-2487-2024 — LaTeX document class for SFS 2487:2024

A LaTeX document class for Finnish office documents (kirjeet, muistiot,
pöytäkirjat, tarjoukset, …) following the **SFS 2487:2024** standard
*Asiakirjan asettelu ja metatiedot*.

The class lays out the standard's information areas (tietoalueet)
automatically: basic metadata 9,2 cm from the left margin with a `1 (2)`
page number, body text on the 2,3 cm column grid, headings hanging at the
left margin, and the metadata block repeated as a page header from page 2
onward.

The recommended way to use it is to **write the document in Markdown**
and let the bundled nix flake render the PDF — no LaTeX knowledge or TeX
installation needed. The class can of course also be used directly from
LaTeX; see [Writing in LaTeX](latex.md).

## Quick start

Write the document as Markdown with YAML frontmatter:

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

and build it with the flake — pandoc, TeX Live and the class are all
provided, the only requirement is [nix](https://nixos.org):

```bash
nix run github:datakurre/vakioasiakirja -- oma-poytakirja.md   # writes oma-poytakirja.pdf next to it
```

or install the converter as a regular command:

```bash
nix profile add github:datakurre/vakioasiakirja
vakioasiakirja oma-poytakirja.md
```

See [Writing in Markdown](markdown.md) for the full frontmatter and body
reference, and the [Examples](examples.md) for complete documents with
their rendered PDFs.

## Where to go next

- [Writing in Markdown](markdown.md) — frontmatter keys and body
  conventions for the pandoc front end
- [Writing in LaTeX](latex.md) — class options, metadata commands and
  body commands
- [The standard, clause by clause](standard.md) — the layout numbers and
  how each SFS 2487:2024 clause is implemented
- [Accessibility](accessibility.md) — producing tagged PDF (liite D)
- [Examples](examples.md) — the example documents in both source formats
- [Development](development.md) — building the examples and this site
