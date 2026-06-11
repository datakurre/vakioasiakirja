# sfs-2487-2024 — LaTeX document class for SFS 2487:2024

A LaTeX document class for Finnish office documents (kirjeet, muistiot,
pöytäkirjat, tarjoukset, …) following the **SFS 2487:2024** standard
*Asiakirjan asettelu ja metatiedot*.

The class lays out the standard's information areas (tietoalueet)
automatically: basic metadata 9,2 cm from the left margin with a `1 (2)`
page number, body text on the 2,3 cm column grid, headings hanging at the
left margin, and the metadata block repeated as a page header from page 2
onward.

## Quick start

```latex
\documentclass{sfs-2487-2024}

\logo{\includegraphics{logo-palikkaharrastajat}} % or any text/box
\doctype{Pöytäkirja}
\date{15.5.2024}
\author{Virve Virtanen}
\confidentiality{Luottamuksellinen}

\subject{Digiprojekti}
\title{Asiakaspalautteet ja etusivun uudistaminen}

\begin{document}
\maketitle

\marginlabel{Aika ja paikka}

13.5.2024 klo 12.30--13.45\\
Verkkokokous

\section{Kokouksen avaus}

Puheenjohtaja avasi kokouksen ja toivotti kaikki tervetulleiksi.

\end{document}
```

Build with:

```bash
make TEXFILE=mydocument build
```

(or `latexmk -pdf mydocument.tex` inside `devenv shell`; latexmk runs the
extra pass needed for the total page count automatically).

## Class options

| Option | Effect |
|---|---|
| *(default)* | Palatino body font at 11 pt, headings bold, numbered `1 Otsikko` |
| `agenda` | Meeting-agenda numbering with a trailing period, `1. Otsikko` (an established alternative the standard permits, 6.4.1). Headings stay bold either way — clause 6.4 requires bold or a larger font size. |
| `sansserif` | Helvetica-like sans serif throughout, matching the look of the standard's own example renderings |
| `12pt` | Larger base font size (any other `article` option is passed through as well) |

Options combine, e.g. `\documentclass[agenda,sansserif]{sfs-2487-2024}`.

## Metadata commands (preamble)

Set these before `\begin{document}`. Only `\doctype`, `\date`, `\author`
and `\title` are usually needed; everything else is optional and omitted
from the output when unset.

| Command | Information area | Notes |
|---|---|---|
| `\doctype{Pöytäkirja}` | Asiakirjatyyppi | Shown bold at the start of the basic metadata area |
| `\date{15.5.2024}` | Päivämäärä | Write as `d.m.yyyy` without leading zeros, per SFS 4175 |
| `\author{Virve Virtanen}` | Laatija | Part of the required minimum metadata (5.2); stored in the PDF Author property. To show it on the document, add a line to `\extrametadata` |
| `\docid{Dnro 123/2024}` | Asiakirjan yksilöivä tunnus | Optional |
| `\confidentiality{Luottamuksellinen}` | Luottamuksellisuus | Optional |
| `\extrametadata{Hankenumero 123456\\Asiakasnumero 987654}` | Lisämetatiedot | Optional; lines separated by `\\`, placed below the basic metadata |
| `\logo{...}` | Logo / organisaatio | Any box: `\includegraphics{...}` or text such as `\textsf{\textbf{Yritys Oy}}`. Placed top-left; the page header grows automatically to fit a tall logo |
| `\recipient{Oy Yritys Ab\\Essi Esimerkki\\Esimerkkitie 1\\12345 Esimerkkipaikkakunta}` | Vastaanottajan tietoalue | Optional; placed at the left margin below the metadata |
| `\subject{Digiprojekti}` | Aihe | Bold line directly above the main title |
| `\title{Verkkosivujen uudistaminen}` | Pääotsikko | Bold, 3 pt larger than the body text |
| `\contactinfo{Organisaatio Oy}{Katuosoite\\12345 Postitoimipaikka\\Puhelinnumero\\www-osoite\\Y-tunnus}` | Organisaation yhteystiedot | Stored for `\makecontactinfo`; first argument is the bolded organization name |

The metadata is also written into the PDF document properties — title,
subject, author (laatija from `\author`) and document language `fi` — for
accessibility and document management.

## Body commands

### `\maketitle`

Renders information areas 1–5 on the first page: logo, basic metadata
(document type, date, ID, confidentiality, page number), extra metadata,
recipient, and subject + main title. The same metadata block repeats
automatically as a header on every following page. (The logo repeats with
it — the standard's continuation-page figure shows only the basic
metadata, but it does not forbid the logo, and the association's existing
documents repeat it.)

### Headings

```latex
\section{Kokouksen avaus}        % 1 Kokouksen avaus (or "1." with [agenda])
\subsection{Tarkennus}           % 1.1 Tarkennus
\subsubsection{Yksityiskohta}    % 1.1.1 Yksityiskohta
\section*{Esityslista}           % unnumbered, always bold
```

Headings hang at the left margin; body text after them returns to the
2,3 cm indent. Up to three numbered levels are available, as the standard
recommends.

### `\marginlabel{...}`

An unnumbered, regular-weight label at the left margin with the following
content at the body indent — for rows like *Aika ja paikka* or
*Osallistujat*:

```latex
\marginlabel{Osallistujat}

Marja Mäkinen, puheenjohtaja\\
Virve Virtanen, sihteeri
```

### Signatures

Electronic signature (sähköinen allekirjoitus):

```latex
\begin{esignatures}
  \esignee{Marja Mäkinen, puheenjohtaja}{marja.makinen@yritys.fi}
  \esignee{Virve Virtanen, sihteeri}{virve.virtanen@yritys.fi}
\end{esignatures}
```

produces the standard's lead-in sentence *"Tämä asiakirja on sähköisesti
allekirjoitettu."* followed by name/email pairs.

Handwritten signature (omakätinen allekirjoitus) — reserves empty space
for signing above the printed name and role, stackable for several
signers:

```latex
\handsignature{Marja Mäkinen}{puheenjohtaja}
\handsignature{Virve Virtanen}{sihteeri}
```

### Attachments, distribution, for information

```latex
\attachments{Yhteenveto asiakaspalautteesta\\Ehdotus etusivun muutoksista}
\distribution{Digiprojektin ohjausryhmä}
\forinformation{Johtoryhmä}
```

Each renders its label (*Liitteet*, *Jakelu*, *Tiedoksi*) at the left
margin with the items, one per line, at the body indent. Use them in this
order after the signatures, per the standard.

### `\makecontactinfo`

Prints the organization contact block set with `\contactinfo` at the left
margin — place it at the end of the document. The standard requires
contact details in the body area (not only in a footer).

### Lists and page breaks

Bullet lists are preconfigured (`\textbullet` markers, tight item
spacing, one paragraph gap around the list). For looser spacing pass
[enumitem](https://ctan.org/pkg/enumitem) options:

```latex
\begin{itemize}[itemsep=\parskip]
  \item 20.5.2024 toimituksen kokoustilassa
  \item 27.5.2024 verkossa
\end{itemize}
```

Use `\clearpage` to force a page break, e.g. before the attachments area.

## Layout, at a glance

| Measure | Value |
|---|---|
| Paper | A4, one column |
| Margins | left and bottom 2 cm, top and right 1 cm |
| Body text indent | 2,3 cm from the left margin (one basic column) |
| Line width | 15,7 cm maximum |
| Basic metadata indent | 9,2 cm from the left margin |
| Font size | 11 pt (or 12 pt with the `12pt` option) |
| Line spacing | 1,2 (13,2 pt leading at 11 pt) |
| Paragraph gap | ≈ 11,6 pt (standard requires ≥ 10 pt) |
| Page number | `1 (2)` — page and total, top right |
| Alignment | ragged right, no first-line indent |

## How the features implement SFS 2487:2024

The class encodes the standard clause by clause. The numbers below refer
to the clauses of SFS 2487:2024.

| Clause | Requirement in the standard | Implementation |
|---|---|---|
| 4.1 Perusasetukset | A4; left and bottom margins 2 cm, others at least 1 cm; layout on a 2,3 cm basic column (perussarake) grid; pages numbered as page number + space + total in parentheses | Fixed page geometry; all indents are multiples of the 2,3 cm column; `1 (2)` page number generated automatically (total page count via an extra latexmk pass) |
| 4.2 Tietoalueet | Document content is grouped into nine named information areas (kuvat 1–2) | Each area has a dedicated command: logo `\logo`, basic metadata `\doctype`/`\date`/`\docid`/`\confidentiality`, extra metadata `\extrametadata`, recipient `\recipient`, subject and title `\subject`/`\title`, body text, signatures `esignatures`/`\handsignature`, attachment lists `\attachments`/`\distribution`/`\forinformation`, contact info `\contactinfo` |
| 4.3 Ylä- ja alatunnisteet | Important information must not exist *only* in word-processor headers/footers | On page 1 the metadata block is real body content placed by `\maketitle`; from page 2 onward the same block repeats as a page header; contact info goes into the body via `\makecontactinfo` |
| 5.1–5.2 Metatiedot | Visible metadata and stored document properties must agree; minimum metadata includes the laatija (author); basic metadata area indented 9,2 cm from the left margin; doctype bold first, then date, document ID and confidentiality; two paragraph gaps before subject/title when there is no extra metadata | The metadata block is built from the same commands that fill the PDF document properties (title, subject, author and `fi` language via hyperref); `\author` records the laatija; 9,2 cm indent and the line order/spacing rules are hard-coded in `\maketitle` and the header |
| 5.2.1 Aihe ja pääotsikko | Subject bold; main title bold and 2–4 pt larger than body text; placed adjacent before the body | `\subject` renders bold at body size; `\title` renders bold at the body size + 3 pt (at any base size), directly below the subject at the left margin |
| 5.3 Lisämetatiedot | Optional extra metadata forms its own area below the basic metadata, same indent | `\extrametadata{...\\...}` rendered at the 9,2 cm indent, one paragraph gap below the basic metadata |
| 6.1 Logo | Logo (or organization/person name as text) in the top-left corner; layout must adapt to the logo's size | `\logo{}` accepts any box — an `\includegraphics` image or styled text; the page header height grows automatically to fit a tall logo, shrinking the text area accordingly |
| 6.2 Päivämäärä | Finnish date format day.month.year without leading zeros (SFS 4175) | `\date{15.5.2024}` takes the date verbatim — write it in the required format |
| 6.3 Vastaanottajan tietoalue | Recipient name, organization and address after the metadata areas | `\recipient{...\\...}` rendered at the left margin by `\maketitle` |
| 6.4 Otsikointi ja jäsentely | Headings hang at the left margin and must stand out from body text; at most three levels recommended; running numbering from 1, no trailing period — though an established trailing-period style is also permitted | `\section`, `\subsection`, `\subsubsection` (numbering depth 3) hang into the margin, bold, never hyphenated, numbered `1`, `1.1`, `1.1.1`; the `agenda` option switches to the permitted alternative `1.` numbering; `\section*` for unnumbered bold headings; `\marginlabel` for unnumbered regular-weight labels |
| 6.4.2 Leipäteksti | Left-aligned (ragged right) single column; body indented 2,3 cm from the left margin; line width at most 15,7 cm; font size 11–12 pt; line spacing typically 1,1–1,2 | Text width is exactly 15,7 cm at the 2,3 cm indent; ragged right via *ragged2e* (body hyphenation kept, as the standard allows); 11 pt default / `12pt` option; leading tightened to 13,2 pt = 1,2 line spacing (1,17 at 12 pt), inside the typical band |
| 6.4.3 Kappaleväli | Paragraphs separated by paragraph spacing of at least 10 pt, not by blank lines; no first-line indent; page breaks by feature, not empty lines | Paragraph gap is 0,88 lines ≈ 11,6 pt of glue (`\parskip`), first-line indent 0; use `\clearpage` for manual breaks |
| 6.5.3 Luettelot | Lists made with the list tool, indented, separated from text by at least one paragraph gap, at least one space after the marker | Preconfigured *enumitem* lists: one paragraph gap above/below, indented bullet items; spacing overridable per list |
| 6.5.4 Lopputervehdys | Closing greeting at the body indent, capitalized, no comma, organization name below after a gap | Plain body paragraphs — no markup needed; see `example-2024.tex` |
| 6.6.1 Omakätinen allekirjoitus | Reserve 3–5 paragraph gaps for a handwritten signature; name + comma + role below; multiple signers stacked | `\handsignature{Name}{role}` reserves three paragraph gaps and prints `Name, role`; repeat to stack |
| 6.6.2 Sähköinen allekirjoitus | The sentence "Tämä asiakirja on sähköisesti allekirjoitettu." followed by each signer's name, role and email | `esignatures` environment emits the sentence; one `\esignee{Name, role}{email}` per signer |
| 6.7 Liitteet, jakelu ja tiedoksi | After the signatures, in this order, each label with its items one per line, groups separated by paragraph gaps | `\attachments`, `\distribution`, `\forinformation` render the *Liitteet* / *Jakelu* / *Tiedoksi* labels at the margin with the listed items at the body indent |
| 6.8 Organisaation yhteystiedot | Contact details at the end of the document in the body area (not only in a footer), organization name first | `\contactinfo{Name}{lines}` + `\makecontactinfo` at the document end; name in bold, lines without paragraph gaps |
| 6.9 Ala- ja loppuviitteet | Superscript numeric reference marks with running numbering | Standard LaTeX `\footnote` already complies |
| 6.10 Sisällysluettelo | Optional table of contents built from the heading styles, placed right after the main title | `\tableofcontents` after `\maketitle`; the class headings feed it automatically |

Left to the author: writing the date in the correct format, keeping
visible metadata consistent with reality (clause 5.1), and the
accessibility requirements of liite D — pdfLaTeX output is not tagged
PDF, so e.g. the logo's alternative text (6.1) cannot be embedded; for
strictly WCAG-conformant electronic documents, post-process or use a
tagging-capable engine.

## Examples in this repository

| File | Demonstrates |
|---|---|
| `example-2024.tex` | The standard's own Liite A example (minutes with electronic signatures, attachments, distribution and contact info) |

`logo-palikkaharrastajat.pdf` is a sample vector logo used by the quick
start snippet above.

## Development

The development environment is managed with nix/devenv; see `AGENTS.md`
for details.

```bash
make shell                        # enter the devenv shell (TeX Live, latexmk, …)
make TEXFILE=example-2024 build   # build a document
make watch                        # rebuild on changes
make clean                        # remove build artifacts
```

Note: the Makefile tracks only the `.tex` file, so after editing the
`.cls` force a rebuild with `latexmk -g -pdf <file>.tex` or `make clean`
first.
