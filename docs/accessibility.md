# Accessibility (liite D): tagged PDF

LaTeX documents can opt in to tagged PDF — the structure tree that
liite D's WCAG criteria build on — by adding one line *before*
`\documentclass`:

```latex
\DocumentMetadata{lang=fi-FI, pdfversion=2.0, tagging=on}
\documentclass{sfs-2487-2024}
```

With tagging on, the output gets a full structure tree: the main title as
a `Title` element (the level-1 heading of clause 5.2), sections as
`H1`–`H3` under `Sect`, paragraphs, bullet and numbered lists (`L`/`LI`),
tables (`TR`/`TD`), footnotes (`Note`), the table of contents
(`TOC`/`TOCI`), link annotations, and the logo as a `Figure`. The
repeated page-2+ header is marked as an artifact so assistive technology
reads the metadata once. Give the logo an alternative text (6.1, D):

```latex
\logo{\includegraphics[alt={Organisaatio Oy:n logo}]{logo-organisaatio}}
```

Known limitations: a table's header row is tagged `TD` like other cells
(mark it visually bold per 6.5.1); and the class disables pdfTeX's real
interword-space glyphs under tagging because they render corrupted with
this layout on TeX Live 2025 — word boundaries remain recoverable from
glyph positioning. Untagged builds are byte-for-byte unaffected by any
of this.
