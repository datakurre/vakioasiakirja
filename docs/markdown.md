# Writing in Markdown

Documents are written as Markdown with YAML frontmatter and converted to
PDF by the nix flake bundled in the repository. The flake provides
pandoc, TeX Live and the class; the only requirement is
[nix](https://nixos.org).

## Running the converter

```bash
nix run . -- oma-poytakirja.md     # writes oma-poytakirja.pdf next to it
```

The `--` separates the document from nix's own options. The PDF is
written next to the markdown file, and relative paths in the document
(`logo:`, images) resolve against the markdown file's location — the
command can be run from any directory:

```bash
nix run /polku/Pöytäkirjat -- ~/asiakirjat/muistio.md   # this checkout
nix run github:<owner>/<repo> -- muistio.md             # a hosted copy, no clone needed
```

If `nix run` complains about experimental features, enable flakes for
the invocation:

```bash
nix --extra-experimental-features 'nix-command flakes' run . -- oma-poytakirja.md
```

For frequent use, install the converter as a regular command:

```bash
nix profile add .                  # then: vakioasiakirja oma-poytakirja.md
```

(on older nix releases the subcommand is `nix profile install`). The
first run downloads and builds the TeX Live closure; later runs start
instantly from the nix store.

## Frontmatter

The YAML frontmatter carries the metadata; `doctype` and `title` are
required, everything else is optional. Multi-line fields are YAML lists,
one line per item.

```yaml
---
doctype: Pöytäkirja                  # \doctype — required
title: Asiakaspalautteet             # \title — required
date: 15.5.2024                      # \date, as d.m.yyyy
author: Virve Virtanen               # \author (laatija)
subject: Digiprojekti                # \subject
docid: Dnro 123/2024                 # \docid
confidentiality: Luottamuksellinen   # \confidentiality
logo: logo-organisaatio.pdf          # image path, or text such as "**Yritys Oy**"
recipient: [Oy Yritys Ab, Esimerkkitie 1, 12345 Esimerkkipaikkakunta]
extrametadata: [Hankenumero 123456, Asiakasnumero 987654]
contact:                             # \contactinfo + \makecontactinfo at the end
  name: Organisaatio Oy
  lines: [Katuosoite, 12345 Postitoimipaikka, www-osoite]
attachments: [Yhteenveto asiakaspalautteesta]   # Liitteet
distribution: [Digiprojektin ohjausryhmä]       # Jakelu
forinformation: [Johtoryhmä]                    # Tiedoksi
agenda: true                         # class options …
sansserif: true
fontsize: 12pt
toc: true                            # \tableofcontents after the title
---
```

The attachment, distribution and for-information lists and the contact
block are placed after the body in the standard's order. They start on a
fresh page whenever any of the three lists is present (like the
standard's pöytäkirja example); set `endmatter-newpage: false`/`true` to
override. When they stay on the same page, the converter separates them
from the body with an extra paragraph gap.

## Body conventions

Standard Markdown works as expected: `#`–`###` headings (at most three
levels, as the standard recommends — deeper headings are an error),
paragraphs, bullet and numbered lists, footnotes, pipe tables (caption
above via `: Caption text`), images with captions placed in the text
flow, and `"quotes"` rendered as Finnish `”quotes”`. Raw LaTeX passes
through for anything exotic.

An unnumbered heading — such as *Esityslista* in a meeting invitation —
is marked with `{-}`:

```markdown
# Esityslista {-}
```

Mark a table's header row bold (clause 6.5.1) with `**bold**` cells, and
give the caption above the table:

```markdown
: Vastaukset palautekanavittain

| **Kanava**   | **Vastauksia** |
|:-------------|---------------:|
| Verkkolomake |            318 |
```

### Margin labels

Margin labels (*Aika ja paikka*, *Osallistujat*, …) are definition
lists:

```markdown
Aika ja paikka
:   13.5.2024 klo 12.30--13.45\
    Verkkokokous
```

(the trailing backslash forces a line break). When the label's content is
something a definition list cannot hold, such as a nested list, use a
fenced div instead:

```markdown
::: {.marginlabel label="Huomiot"}
- ensimmäinen huomio
:::
```

### Signatures

Electronic signatures are a fenced div with one signee per list item,
email as an autolink:

```markdown
::: esignatures
- Marja Mäkinen, puheenjohtaja <marja.makinen@yritys.fi>
- Virve Virtanen, sihteeri <virve.virtanen@yritys.fi>
:::
```

A handwritten signature reserves the signing space above the printed
`Name, role` lines:

```markdown
::: handsignature
Matti Meikäläinen, titteli
:::
```

See the [Examples](examples.md) for complete documents — every LaTeX
example in the repository has a Markdown twin producing the same layout.
