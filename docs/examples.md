# Examples

Every example document in the repository exists in both source formats:
a LaTeX original in `examples/latex/` and a Markdown twin in
`examples/markdown/` that produces the same layout. The rendered PDFs
below are built from this very revision of the class.

Each row links to the rendered PDF and to the source it was built from.
The source links open in the browser as plain text, so you can read them
without downloading first.

| Example | Demonstrates | LaTeX | Markdown |
|---|---|---|---|
| `esimerkki-poytakirja` | The standard's own Liite A example: two-page minutes with margin labels, electronic signatures, attachment lists, distribution and contact info | [PDF](pdf/latex/esimerkki-poytakirja.pdf) · [source](src/latex/esimerkki-poytakirja.tex.txt) | [PDF](pdf/markdown/esimerkki-poytakirja.pdf) · [source](src/markdown/esimerkki-poytakirja.md.txt) |
| `esimerkki-tarjous` | The standard's own Liite B example: quotation with document id, extra metadata, recipient area, closing greeting (6.5.4) and handwritten signature (6.6.1) | [PDF](pdf/latex/esimerkki-tarjous.pdf) · [source](src/latex/esimerkki-tarjous.tex.txt) | [PDF](pdf/markdown/esimerkki-tarjous.pdf) · [source](src/markdown/esimerkki-tarjous.md.txt) |
| `esimerkki-kokouskutsu` | Meeting invitation with an agenda, using the `agenda` option's `1.` numbering and an unnumbered *Esityslista* heading | [PDF](pdf/latex/esimerkki-kokouskutsu.pdf) · [source](src/latex/esimerkki-kokouskutsu.tex.txt) | [PDF](pdf/markdown/esimerkki-kokouskutsu.pdf) · [source](src/markdown/esimerkki-kokouskutsu.md.txt) |
| `esimerkki-raportti` | Multi-page report: table of contents (6.10), table with its caption above and a bold header row (6.5.1), footnote (6.9), three heading levels | [PDF](pdf/latex/esimerkki-raportti.pdf) · [source](src/latex/esimerkki-raportti.tex.txt) | [PDF](pdf/markdown/esimerkki-raportti.pdf) · [source](src/markdown/esimerkki-raportti.md.txt) |
| `esimerkki-kayttoohje` | `sans-serif` manual with captioned figures in the text flow (6.5.2) and numbered step lists | [PDF](pdf/latex/esimerkki-kayttoohje.pdf) · [source](src/latex/esimerkki-kayttoohje.tex.txt) | [PDF](pdf/markdown/esimerkki-kayttoohje.pdf) · [source](src/markdown/esimerkki-kayttoohje.md.txt) |
| `esimerkki-monospace` | `monospace` memo demonstrating the Courier typewriter font | [PDF](pdf/latex/esimerkki-monospace.pdf) · [source](src/latex/esimerkki-monospace.tex.txt) | [PDF](pdf/markdown/esimerkki-monospace.pdf) · [source](src/markdown/esimerkki-monospace.md.txt) |

`esimerkki-poytakirja` and `esimerkki-tarjous` replicate the standard's
own model documents (Liite A and B in SFS 2487:2024), so their output
can be compared against the specification figures directly.

From a checkout of the repository, build the examples yourself with
`make examples` (LaTeX) and
`make markdown` (Markdown via the nix flake). The invented sample
graphics the examples use — the *Organisaatio Oy* and *Oy Firma Ab*
logos and the logo clearance-area figure — are drawn with TikZ in
`examples/logo-*.tex` and built into `examples/logo-*.pdf` automatically
as part of the build.
