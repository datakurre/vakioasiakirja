// SFS 2487:2024 layout — Typst reimplementation for the browser editor.
//
// Geometry mirrors sfs-2487-2024.cls (the LaTeX class is the reference
// implementation). The standard's measured checkpoints, verifiable with
// `pdftotext -bbox`, are:
//   left-margin elements (headings, marginlabels, logo) at 56.69 pt (20 mm)
//   body text and list markers               at 121.9 pt (43 mm)
//   basic metadata block                     at 317.5 pt (112 mm = 9,2 cm
//                                               from the 20 mm left margin)
//
// The page left margin is the full 43 mm, so body text sits at 43 mm; the
// elements that hang into the margin (headings, marginlabels, logo) outdent
// by the 2,3 cm column to the 20 mm line, and the basic metadata is offset
// to the 112 mm column.

#let column = 23mm // the 2,3 cm basic column (SFS 2487 grid unit)
#let body-indent = 43mm // 20 mm left margin + one column
#let metaindent = 92mm // basic metadata, 9,2 cm from the left margin
#let meta-offset = metaindent - column // 69 mm: from the 43 mm body column
#let metawidth = 88mm // 200 mm right text edge − 112 mm
#let logo-max-height = 20mm
#let header-top = 14.4mm // top margin above the metadata block (cls geometry top)
#let leading = 5.2pt // within-paragraph line gap (→ 13.2 pt baseline at 11 pt)
#let parskip = 11.6pt // LaTeX paragraph gap (kappaleväli, .88 baselineskip)
// Typst measures block spacing between bounding boxes, whereas LaTeX adds the
// paragraph gap on top of a full baselineskip; a block gap is therefore short
// by one `leading` and the standard one-paragraph-gap between blocks is
// parskip + leading. `n * parskip + leading` keeps n-paragraph-gap spacings.
#let blockgap = parskip + leading
#let runin-sep = 0.5em // minimum gap kept when a heading/label runs in

// Metric-compatible stand-ins for the class's Type 1 fonts (Typst cannot use
// those directly): Helvetica → Heros, Palatino → Pagella, Courier → Cursor.
#let font-families = (
  sans-serif: "TeX Gyre Heros",
  serif: "TeX Gyre Pagella",
  monospace: "TeX Gyre Cursor",
)

// Whether body text runs into a fitting heading/label line; set by
// sfs-document so the module-level `marginlabel` can read it (cls [no-runin]).
#let runin-state = state("sfs-runin", true)

// True when `head` is narrow enough to share its line with the body (cls
// \sfs@measurefit: fits the heading column less the minimum gap).
#let fits-column(head) = measure(head).width < (column - runin-sep).to-absolute()

// A label at the 20 mm margin (cls \marginlabel): definition-list terms, the
// .marginlabel div and the end-matter labels. When the label fits the heading
// column the body runs in on the same line, returning to the 43 mm body
// indent; otherwise the label takes its own line with the body below.
#let marginlabel(label, body) = context {
  if runin-state.get() and body != [] and fits-column(label) {
    block(spacing: blockgap, {
      place(top + left, dx: -column, box(width: column, label))
      body
    })
  } else {
    block(below: blockgap, pad(left: -column, label))
    body
  }
}

// Electronic-signature block (cls esignatures environment + \esignee).
#let esignatures(sentence, ..signees) = {
  block(sentence)
  for s in signees.pos() {
    block(below: 0pt, above: blockgap)[#s.at(0) \ #s.at(1)]
  }
}

// A line printed under reserved space for a handwritten signature
// (cls \handsignature: three paragraph gaps above the printed line).
#let handsignature(line) = block(above: 3 * parskip + leading, below: 0pt, line)

// The document date (6.2) is given in the standard's d.m.yyyy form. Parse it
// into a `datetime` so it becomes the PDF CreationDate/ModDate, matching the
// class (which feeds \date into pdfcreationdate). A free-form or empty date
// leaves the PDF date at `auto` (the compile date), as the class does.
#let parse-date(date) = {
  let m = date.trim().match(regex("^(\d{1,2})\.(\d{1,2})\.(\d{4})$"))
  if m == none {
    auto
  } else {
    datetime(
      day: int(m.captures.at(0)),
      month: int(m.captures.at(1)),
      year: int(m.captures.at(2)),
    )
  }
}

#let sfs-document(
  doctype: "",
  title: "",
  date: "",
  author: none,
  subject: none,
  docid: none,
  confidentiality: none,
  logo: none,
  recipient: none,
  extrametadata: none,
  contact: none,
  attachments: none,
  distribution: none,
  forinformation: none,
  keywords: none,
  font: "sans-serif",
  // The LaTeX 11pt article class sets \normalsize to 10.9091pt (\@xipt), so the
  // metric-compatible body text matches when measured with mutool.
  fontsize: 10.9091pt,
  agenda: false,
  toc: false,
  runin: true,
  endmatter-newpage: false,
  body,
) = {
  let body-font = font-families.at(font, default: font-families.sans-serif)
  runin-state.update(runin)

  // The basic metadata block, repeated as the page header on every page; the
  // page number is "current (total)" — e.g. 1 (2).
  let metadata-block = {
    if logo != none {
      // Hang the logo in the 20 mm margin, capped at logo-max-height: scale
      // down only when taller than the cap, never up (cls \logomaxheight).
      place(top + left, dx: -column, dy: header-top, context {
        if measure(logo).height > logo-max-height {
          box(height: logo-max-height, logo)
        } else {
          logo
        }
      })
    }
    place(
      top + left,
      dx: meta-offset,
      dy: header-top,
      box(width: metawidth)[
        #strong(doctype) #h(1fr) #context counter(page).display("1 (1)", both: true) \
        #date
        #if docid != none [ \ #docid ]
        #if confidentiality != none [ \ #confidentiality ]
      ],
    )
  }

  set document(
    title: title,
    author: if author != none { author } else { () },
    keywords: if keywords != none { keywords } else { () },
    date: parse-date(date),
  )
  set page(
    width: 210mm,
    height: 297mm,
    // top: leaves room for the 14.4 mm top margin, the metadata block and a
    // headsep gap so the body starts where the class puts it (~42 mm).
    margin: (left: body-indent, right: 10mm, top: 42mm, bottom: 20mm),
    // The metadata block is placed absolutely from the page top (header-top),
    // so the header region spans the whole top margin to contain it.
    header-ascent: 42mm,
    header: metadata-block,
  )
  set text(font: body-font, size: fontsize, lang: "fi", hyphenate: true)
  // linespread 0.9706 in the class → 13.2 pt leading at 11 pt; parskip 11.6 pt.
  set par(leading: leading, spacing: blockgap, justify: false, first-line-indent: 0pt)
  set list(marker: [–], indent: 0pt) // Finnish convention: en dash, flush at body indent
  set enum(indent: 0pt)
  set heading(numbering: if agenda { "1.1.1." } else { "1.1.1" })

  // Headings: bold, body size, hanging at the 20 mm margin, no hyphenation.
  // Like marginlabels, a heading that fits the heading column runs into the
  // following body line (cls run-in/display machinery); the run-in heading is
  // laid out with zero height so the next paragraph rises beside it.
  show heading: it => context {
    // Keep headings at body size (cls: bold normalsize); without an explicit
    // size Typst's default per-level scaling (1.4em at level 1, …) would make
    // them far larger than the standard's bold-at-body-size headings (6.4).
    set text(size: fontsize, weight: "bold", hyphenate: false)
    let head = if it.numbering != none [#counter(heading).display() #it.body] else [#it.body]
    let above = if it.level == 1 { 1.5 * parskip + leading } else { blockgap }
    if runin and fits-column(head) {
      block(above: above, below: 0pt, height: 0pt, place(top + left, dx: -column, box(width: column, head)))
    } else {
      block(above: above, below: blockgap, pad(left: -column, head))
    }
  }

  // Smart quotes: Finnish convention is ” on both sides, ’ for inner quotes.
  set smartquote(quotes: (single: ("’", "’"), double: ("”", "”")))

  // Figures and tables stay in the text flow, left-aligned at the body column
  // like the rest of the content (cls \captionof, 6.5). The Finnish supplement
  // (Taulukko/Kuva) comes from lang fi; the label separator is a quad with no
  // colon, as in the class's caption style. Table captions sit above the table
  // (6.5.1), image captions below it (6.5.2).
  show figure: set align(left)
  show figure: set block(spacing: blockgap)
  set figure.caption(separator: [#h(1em)])
  show figure.where(kind: table): set figure.caption(position: top)
  show figure.caption: set text(hyphenate: false)

  // Body text sits at the 43 mm column (the page's left margin). Margin-hanging
  // elements (headings, marginlabels) outdent by `column`; the extra metadata
  // area is offset to the 112 mm column.
  if extrametadata != none {
    block(pad(left: meta-offset, extrametadata))
  }
  if recipient != none { block(recipient) }
  // Subject and title share one block with the title leading between them, as
  // the class typesets them in a single parbox (5.2); the title is the
  // document's level-1 heading, bold and 3 pt larger (5.2.1).
  block(below: 1.5 * parskip, {
    if subject != none { strong(subject); linebreak() }
    text(size: fontsize + 3pt, weight: "bold", hyphenate: false, title)
  })

  if toc {
    // The TOC heading stays on a line of its own (cls \tableofcontents,
    // 6.10), hanging at the 20 mm margin like a display heading.
    block(above: 1.5 * parskip, below: blockgap, pad(left: -column, strong[Sisällys]))
    outline(title: none)
  }

  body

  if attachments != none or distribution != none or forinformation != none {
    if endmatter-newpage {
      pagebreak()
    } else {
      // One extra paragraph gap separates the end matter from the preceding
      // content when it is not on a fresh page (cls \sfs@marginlist, 6.7); a
      // non-weak space so it adds on top of the label block's own gap.
      v(parskip)
    }
    if attachments != none { marginlabel([Liitteet], attachments) }
    if distribution != none { marginlabel([Jakelu], distribution) }
    if forinformation != none { marginlabel([Tiedoksi], forinformation) }
  }

  if contact != none {
    // The organisation contact area hangs at the 20 mm margin, separated by an
    // extra paragraph gap (cls \makecontactinfo).
    block(above: 2 * parskip + leading, pad(left: -column)[#strong(contact.at("name", default: "")) \ #contact.at("lines", default: "")])
  }
}
