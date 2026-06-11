# The standard, clause by clause

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
| 6.4 Otsikointi ja jäsentely | Headings hang at the left margin and must stand out from body text; at most three levels recommended; running numbering from 1, no trailing period — though an established trailing-period style is also permitted; typically more space above top-level headings than below | `\section`, `\subsection`, `\subsubsection` (numbering depth 3) hang into the margin, bold, never hyphenated, numbered `1`, `1.1`, `1.1.1`; the `agenda` option switches to the permitted alternative `1.` numbering; `\section*` for unnumbered bold headings; `\marginlabel` for unnumbered regular-weight labels; top-level headings get half a paragraph gap of extra space above |
| 6.4.2 Leipäteksti | Left-aligned (ragged right) single column; body indented 2,3 cm from the left margin; line width at most 15,7 cm; font size 11–12 pt; line spacing typically 1,1–1,2 | Text width is exactly 15,7 cm at the 2,3 cm indent; ragged right via *ragged2e* (body hyphenation kept, as the standard allows); 11 pt default / `12pt` option; leading tightened to 13,2 pt = 1,2 line spacing (1,17 at 12 pt), inside the typical band |
| 6.4.3 Kappaleväli | Paragraphs separated by paragraph spacing of at least 10 pt, not by blank lines; no first-line indent; page breaks by feature, not empty lines | Paragraph gap is 0,88 lines ≈ 11,6 pt of glue (`\parskip`), first-line indent 0; use `\clearpage` for manual breaks |
| 6.5.1–6.5.2 Taulukot, kuvat ja kaaviot | Real (not image) tables with the top row as a header row, caption above the table; figures in the text flow at the text indent with the caption in their immediate proximity | Captions via the *caption* package: ragged, never centered, label separated by a quad, table captions configured above; `\captionof{table}`/`\captionof{figure}` for in-flow material |
| 6.5.3 Luettelot | Lists made with the list tool, indented, separated from text by at least one paragraph gap, at least one space after the marker | Preconfigured *enumitem* lists: one paragraph gap above/below, indented bullet items; spacing overridable per list |
| 6.5.4 Lopputervehdys | Closing greeting at the body indent, capitalized, no comma, organization name below after a gap | Plain body paragraphs — no markup needed; see `examples/latex/esimerkki-tarjous.tex` |
| 6.6.1 Omakätinen allekirjoitus | Reserve 3–5 paragraph gaps for a handwritten signature; name + comma + role below; multiple signers stacked | `\handsignature{Name}{role}` reserves three paragraph gaps and prints `Name, role`; repeat to stack |
| 6.6.2 Sähköinen allekirjoitus | The sentence "Tämä asiakirja on sähköisesti allekirjoitettu." followed by each signer's name, role and email | `esignatures` environment emits the sentence; one `\esignee{Name, role}{email}` per signer |
| 6.7 Liitteet, jakelu ja tiedoksi | After the signatures, in this order, each label with its items one per line, groups separated by paragraph gaps | `\attachments`, `\distribution`, `\forinformation` render the *Liitteet* / *Jakelu* / *Tiedoksi* labels at the margin with the listed items at the body indent |
| 6.8 Organisaation yhteystiedot | Contact details at the end of the document in the body area (not only in a footer), organization name first | `\contactinfo{Name}{lines}` + `\makecontactinfo` at the document end; name in bold, lines without paragraph gaps |
| 6.9 Ala- ja loppuviitteet | Superscript numeric reference marks with running numbering | Standard LaTeX `\footnote` already complies |
| 6.10 Sisällysluettelo | Optional table of contents built from the heading styles, placed right after the main title | `\tableofcontents` after `\maketitle`; the class headings feed it automatically |

Left to the author: writing the date in the correct format and keeping
visible metadata consistent with reality (clause 5.1). For the
accessibility requirements of liite D, see [Accessibility](accessibility.md).
