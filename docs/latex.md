# Writing in LaTeX

The class can also be used directly, with the full power of LaTeX:

```latex
\documentclass{sfs-2487-2024}

\logo{\includegraphics{logo-organisaatio}} % or any text/box
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

The sections below are the LaTeX reference; the
[Markdown frontmatter keys and body constructs](markdown.md) map onto
these same commands.

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

### Tables and figures

Captions are styled by the class per clauses 6.5.1–6.5.2: left-aligned
at the text indent, never centered, with the label (*Taulukko 1*,
*Kuva 1*) separated by a quad like the standard's own captions. The
standard prefers material placed in the text flow — use `\captionof`
instead of floating environments, with the table caption **above** the
table and the figure caption next to the figure:

```latex
\captionof{table}{Vastaukset palautekanavittain}
\begin{tabular}{@{}lrr@{}}   % @{} starts the table exactly at the indent
  \textbf{Kanava} & \textbf{Vastauksia} & \textbf{Osuus} \\
  ...
\end{tabular}

\includegraphics{logo-organisaatio}
\captionof{figure}{Logon perusversio}
```

The floating `table`/`figure` environments work too and get the same
caption styling. Mark the table's top row as a header row with bold
text (6.5.1), and remember an alternative text or a body-text
description for images (6.5.2).

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
