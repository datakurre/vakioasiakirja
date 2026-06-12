%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% sfs-2487-2024.cls by Asko Soukka <asko.soukka@iki.fi>.
%
% Implements the SFS 2487:2024 standard "Asiakirjan asettelu ja metatiedot":
% information areas (tietoalueet) on a 2,3 cm column grid, basic metadata
% area 9,2 cm from the left margin, body text 2,3 cm from the left margin.
%
% Copyright (c) 2026 Asko Soukka <asko.soukka@iki.fi>
%
% SPDX-License-Identifier: MIT
%
% This work is distributed under the MIT License; the full license text is
% in the accompanying LICENSE file and at https://opensource.org/license/mit

\def\sfs@filedate{2026/06/11}
\def\sfs@fileversion{2.0}
\def\sfs@fileinfo{Vakioasiakirja SFS 2487:2024}
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{sfs-2487-2024}[\sfs@filedate\space\sfs@fileversion\space\sfs@fileinfo]
\typeout{sfs-2487-2024 <\sfs@filedate:\sfs@fileversion> - SFS 2487:2024}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Options
%
% [agenda] switches numbered headings from the standard's default figure
% style ("1 Otsikko") to the trailing-period numbering ("1. Otsikko") that
% the standard also permits as an established convention (6.4.1). Headings
% stay bold either way, as 6.4 requires bold or a larger font size.
%
% [sansserif] typesets the document in a Helvetica-like sans serif, matching
% the look of the standard's own example renderings, instead of Palatino.

\newif\ifsfs@agenda
\DeclareOption{agenda}{\sfs@agendatrue}
\newif\ifsfs@sans
\DeclareOption{sansserif}{\sfs@sanstrue}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{article}}
\ProcessOptions\relax

\LoadClass[a4paper,11pt,oneside,final,notitlepage,onecolumn]{article}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Typeface and layout
%

\ifsfs@sans
  \RequirePackage{helvet}
  \renewcommand{\familydefault}{\sfdefault}
\else
  \RequirePackage{mathpazo}
\fi
\RequirePackage{microtype}
\RequirePackage{graphicx}
\RequirePackage{ragged2e}
\RequirePackage{enumitem}

% Grid constants from the standard: basic column (perussarake) 2,3 cm,
% basic metadata area 9,2 cm from the left margin.
\newlength{\sfs@column}\setlength{\sfs@column}{23mm}
\newlength{\sfs@metaindent}\setlength{\sfs@metaindent}{92mm}

% Left margin 2 cm + one basic column = 4,3 cm, so body text sits natively
% at the standard's 2,3 cm indent and \textwidth is exactly the recommended
% 15,7 cm maximum line width. Margin-level elements hang left by \sfs@column.
% Header height is recomputed at \begin{document} once the logo is known.
\RequirePackage[a4paper,left=43mm,right=10mm,top=10mm,bottom=20mm,
                includehead,headheight=60pt,headsep=24pt,nofoot]{geometry}

% LaTeX's default \baselineskip at 11pt is 13.6pt = 1.24 line spacing, just
% above the standard's 1,1-1,2 band; 0.9706 tightens it to 13.2pt = 1.2
% (and 14.07pt = 1.17 with the 12pt option). The paragraph gap (kappaleväli)
% of 0.88 lines = 11.6pt exceeds the required 10pt minimum.
\linespread{0.9706}
\AtBeginDocument{%
  \RaggedRight
  \setlength{\parindent}{0pt}%
  \setlength{\parskip}{.88\baselineskip}%
  \setlength{\footskip}{\baselineskip}% unused (nofoot); silences fancyhdr warning
}

% Bulleted lists are marked with the en dash (ajatusviiva) of Finnish
% typographic convention rather than LaTeX's default \textbullet.
\setlist[itemize]{label=\textendash,topsep=0pt,partopsep=0pt,itemsep=0pt,parsep=0pt}
\setlist[enumerate]{topsep=0pt,partopsep=0pt,itemsep=0pt,parsep=0pt}

% Captions for tables, figures and charts (6.5.1-6.5.2): left-aligned at the
% text indent like the spec's own "Taulukko 1 Otsikko" / "Kuva 1 Teksti"
% captions, never centered nor justified. Table captions belong above the
% table (6.5.1), figure captions in the figure's immediate proximity (6.5.2);
% \captionof{table}/\captionof{figure} supports the spec's preference for
% material placed in the text flow rather than floated.
\RequirePackage{caption}
\captionsetup{
  justification=RaggedRight,
  singlelinecheck=false,
  labelsep=quad,
  skip=\smallskipamount}
\captionsetup[table]{position=above}

% Used in the text flow (outside any float or minipage), caption's \captionof
% resets \parskip for the rest of the document, silently dropping below the
% 10pt minimum paragraph gap of 6.4.3; scope it in a group. caption defines
% \captionof in its own begin-document code, so this must run after it.
\AddToHook{begindocument/end}{%
  \let\sfs@captionof\captionof
  \RenewDocumentCommand{\captionof}{s m o m}{%
    \begingroup
    \IfBooleanTF{#1}
      {\sfs@captionof*{#2}{#4}}
      {\IfNoValueTF{#3}{\sfs@captionof{#2}{#4}}{\sfs@captionof{#2}[#3]{#4}}}%
    \endgroup}}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Language
%

\RequirePackage[T1]{fontenc}
\RequirePackage[english,finnish]{babel}

% The class's fixed strings, renewable per the \refname/\contentsname
% convention — a document in another language keeps the SFS 2487 layout
% with e.g. \renewcommand{\attachmentsname}{Bilagor} in its preamble.
\newcommand{\attachmentsname}{Liitteet}
\newcommand{\distributionname}{Jakelu}
\newcommand{\forinformationname}{Tiedoksi}
\newcommand{\esignaturestext}{Tämä asiakirja on sähköisesti allekirjoitettu.}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Metadata commands (asiakirjan metatiedot)
%

% Laatija (spec 5.2 minimum metadata) comes from the standard \author
% command; article's default \@author would emit a warning when expanded
% into the PDF properties, so it is blanked here.
\let\@author\@empty
\let\sfs@doctype\@empty
\let\sfs@docid\@empty
\let\sfs@confidentiality\@empty
\let\sfs@extrametadata\@empty
\let\sfs@logo\@empty
\let\sfs@recipient\@empty
\let\sfs@subject\@empty
\let\sfs@keywords\@empty
\let\sfs@modified\@empty
\let\sfs@contactname\@empty
\let\sfs@contactlines\@empty

\newcommand{\doctype}[1]{\gdef\sfs@doctype{#1}}
\newcommand{\docid}[1]{\gdef\sfs@docid{#1}}
\newcommand{\confidentiality}[1]{\gdef\sfs@confidentiality{#1}}
\newcommand{\extrametadata}[1]{\gdef\sfs@extrametadata{#1}}
\newcommand{\logo}[1]{\gdef\sfs@logo{#1}}
\newcommand{\recipient}[1]{\gdef\sfs@recipient{#1}}
\newcommand{\subject}[1]{\gdef\sfs@subject{#1}}
% Keywords (asiasanat) and the modification date go only into the PDF
% document properties, not into any visible information area; \modified
% takes the d.m.yyyy format like \date.
\newcommand{\keywords}[1]{\gdef\sfs@keywords{#1}}
\newcommand{\modified}[1]{\gdef\sfs@modified{#1}}
\newcommand{\contactinfo}[2]{\gdef\sfs@contactname{#1}\gdef\sfs@contactlines{#2}}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Basic metadata block (perusmetatietoalue)
%
% One macro produces the block both as page-1 body content and as the
% repeated header on continuation pages, as the standard requires. It spans
% from the left margin to the right text edge; the logo is laid over the
% left end with its top aligned to the first metadata line.

\RequirePackage{fancyhdr}
\RequirePackage{totpages}

% \ref* (hyperref) keeps the total-page reference from becoming a link
% annotation in every page header.
\newcommand{\sfs@pagenum}{\thepage\ (\ref*{TotPages})}

\newcommand{\sfs@metadatablock}{%
  \ifx\sfs@logo\@empty\else
    \rlap{\raisebox{\dimexpr\ht\strutbox-\height\relax}{\sfs@logo}}%
  \fi
  \hspace*{\sfs@metaindent}%
  \parbox[t]{\dimexpr\textwidth+\sfs@column-\sfs@metaindent\relax}{%
    \textbf{\sfs@doctype}\hfill\sfs@pagenum\\
    \@date
    \ifx\sfs@docid\@empty\else\\\sfs@docid\fi
    \ifx\sfs@confidentiality\@empty\else
      \ifx\sfs@docid\@empty\\\mbox{}\fi
      \\\sfs@confidentiality
    \fi}}

\pagestyle{fancy}
\fancyhf{}
\fancyheadoffset[L]{\sfs@column}
\fancyhead[L]{\sfs@metadatablock}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

% Tagged-PDF support (saavutettavuus, liite D): documents opt in with
% \DocumentMetadata{lang=fi-FI, tagging=on} before \documentclass. The
% helpers below no-op in untagged documents; in tagged ones they suspend
% the automatic paragraph tagging around the \maketitle information areas
% (whose parboxes would otherwise nest structure inside a stray P) and tag
% each area explicitly instead.
\newcommand{\sfs@tagoff}{\ifdefined\tagpdfparaOff\tagpdfparaOff\fi}
\newcommand{\sfs@tagon}{\ifdefined\tagpdfparaOn\tagpdfparaOn\fi}

% pdfTeX's real interword-space glyphs (enabled by tagging) render reordered
% and overlapping with this class's layout on TeX Live 2025, so they are
% disabled; word boundaries remain recoverable from glyph positioning.
\AddToHook{begindocument/before}{%
  \ifdefined\tagpdfsetup\tagpdfsetup{interwordspace=false}\fi}
\newcommand{\sfs@struct}[2]{%
  \ifdefined\tagstructbegin
    \tagstructbegin{tag=#1}\tagmcbegin{tag=#1}#2\tagmcend\tagstructend
  \else#2\fi}

% The layout adapts to the logo's size (6.1), but only up to a point: a
% logo taller than \logomaxheight is scaled down proportionally, so an
% oversized source image (a high-resolution bitmap, a full-page vector)
% cannot consume the page. Adjust with \setlength{\logomaxheight}{...}.
\newlength{\logomaxheight}
\setlength{\logomaxheight}{20mm}

% Grow the header to fit the metadata block (e.g. a tall logo), taking the
% extra space from the text height so the body never overlaps the header.
% The measuring box must not emit document structure in tagged documents.
\AtBeginDocument{%
  \ifdefined\tagstop\tagstop\fi
  \ifx\sfs@logo\@empty\else
    \sbox\@tempboxa{\sfs@logo}%
    \ifdim\ht\@tempboxa>\logomaxheight
      \let\sfs@logo@given\sfs@logo
      \gdef\sfs@logo{\resizebox{!}{\logomaxheight}{\sfs@logo@given}}%
    \fi
  \fi
  \sbox\@tempboxa{\sfs@metadatablock}%
  \ifdefined\tagstart\tagstart\fi
  \@tempdima=\dimexpr\ht\@tempboxa+\dp\@tempboxa+\baselineskip\relax
  \ifdim\@tempdima>\headheight
    \addtolength{\textheight}{\dimexpr\headheight-\@tempdima\relax}%
    \setlength{\headheight}{\@tempdima}%
  \fi}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Title (information areas 1-5 on the first page)
%
% On the first page the metadata block is body content, not a header, so it
% is pulled up into the (empty) header zone to the same position where the
% repeated header sits on continuation pages.

\renewcommand{\maketitle}{%
  \thispagestyle{empty}%
  \vspace*{\dimexpr-\headheight-\headsep-\parskip-\topskip+\ht\strutbox\relax}%
  \sfs@tagoff
  \noindent\hspace*{-\sfs@column}\sfs@metadatablock\par
  % Between stacked information-area boxes the interline mechanics absorb a
  % few points of the \parskip glue, so the rendered gap falls short of the
  % paragraph gap that 5.2 requires (one before the extra metadata, at least
  % two before the subject and title when there is no extra metadata); the
  % extra half/full \parskip below restores the rendered gap to the required
  % size at any base font size.
  \ifx\sfs@extrametadata\@empty
    \vspace{1.5\parskip}%
  \else
    \vspace{.5\parskip}%
    \noindent\hspace*{\dimexpr\sfs@metaindent-\sfs@column\relax}%
    \parbox[t]{\dimexpr\textwidth+\sfs@column-\sfs@metaindent\relax}{\sfs@extrametadata}\par
    \vspace{.5\parskip}%
  \fi
  \ifx\sfs@recipient\@empty\else
    \noindent\hspace*{-\sfs@column}\parbox[t]{\textwidth}{\sfs@recipient}\par
    \vspace{.5\parskip}%
  \fi
  % The main title is the document's level-1 heading (5.2, Taulukko 2);
  % in tagged documents the title parbox becomes a Title structure element.
  \noindent\hspace*{-\sfs@column}%
  % \sfs@titlefont is deliberately not grouped: its \baselineskip must be
  % in effect at the parbox's closing \par so that the gap between the
  % subject and title baselines is the title leading, as in the standard's
  % model documents (Liite A and B), not the smaller body leading.
  \sfs@struct{Title}{\parbox[t]{\dimexpr\textwidth+\sfs@column\relax}{%
    \ifx\sfs@subject\@empty\else\textbf{\sfs@subject}\\\fi
    \sfs@titlefont\@title}}\par
  \sfs@tagon
  % One-shot, like article's \maketitle: a second call is a no-op instead
  % of rendering the information areas again.
  \global\let\maketitle\relax
}

% The main title is bold and 3pt larger than the body text, inside the
% 2-4pt band that 5.2.1 recommends at any base font size; the heading
% rules of 6.4 (no justification, no hyphenation) apply to it as well.
\newcommand{\sfs@titlefont}{%
  % \f@size must be evaluated before \fontsize runs, or the second argument
  % would see the already-enlarged size and inflate the title leading.
  \@tempdima=\dimexpr\f@size pt+3pt\relax
  \fontsize{\@tempdima}{1.2\@tempdima}%
  \selectfont\bfseries\sfs@nohyphens}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Sections (asiasisällön otsikointi)
%
% Numbered headings hang at the left margin; body text returns to the
% 2,3 cm indent. Starred headings are always bold and unnumbered.

\setcounter{secnumdepth}{3}

\ifsfs@agenda
  \renewcommand{\@seccntformat}[1]{\csname the#1\endcsname.\space}
\else
  \renewcommand{\@seccntformat}[1]{\csname the#1\endcsname\space}
\fi

% Headings are not justified (global \RaggedRight) nor hyphenated (6.4).
\newcommand{\sfs@nohyphens}{\hyphenpenalty\@M\exhyphenpenalty\@M}
\newcommand{\sfs@sectfont}{\normalfont\normalsize\bfseries\sfs@nohyphens}

% The 1sp before/after skips keep the heading a display heading while the
% standard's "at least one paragraph gap" around it comes from \parskip.
% Top-level headings get half a paragraph gap extra above, following the
% 6.4 note that there is typically more space above them than below.
\newcommand{\sfs@makesection}[3]{%
  \@ifstar
    {\@startsection{#1}{#2}{-\sfs@column}{#3}{1sp}{\sfs@sectfont}*}%
    {\@startsection{#1}{#2}{-\sfs@column}{#3}{1sp}{\sfs@sectfont}}}
\renewcommand{\section}{\sfs@makesection{section}{1}{.5\parskip}}
\renewcommand{\subsection}{\sfs@makesection{subsection}{2}{1sp}}
\renewcommand{\subsubsection}{\sfs@makesection{subsubsection}{3}{1sp}}

% The standard recommends at most three heading levels (6.4); article's
% run-in \paragraph and \subparagraph would break the hanging-heading
% layout, so deeper levels degrade to unnumbered display headings instead.
\renewcommand{\paragraph}{\sfs@makesection{paragraph}{4}{1sp}}
\renewcommand{\subparagraph}{\sfs@makesection{subparagraph}{5}{1sp}}

% Unnumbered regular-weight label at the left margin ("Aika ja paikka"),
% with the following content at the body indent.
\newcommand{\marginlabel}[1]{\par\noindent\hspace*{-\sfs@column}#1\par\nopagebreak}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Signatures (allekirjoituksen tietoalue)
%

% Electronic signature: the \esignaturestext lead-in sentence, then one
% \esignee per signer.
\newenvironment{esignatures}{%
  \par\esignaturestext
}{\par}
\newcommand{\esignee}[2]{\par #1\\#2}

% Handwritten signature: reserve space (the standard allows 3-5 paragraph
% gaps) above the printed "Name, role" line, given verbatim as in \esignee.
\newcommand{\handsignature}[1]{\par\vspace{3\parskip}\noindent #1\par}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Attachments, distribution and for-information lists
% (liitteet, jakelu ja tiedoksi -tietoalue)
%

% The first of these lists is separated from the preceding content by an
% extra paragraph gap (6.7); the gap glue vanishes when the end matter
% starts a fresh page after \clearpage, so no special case is needed.
\newif\ifsfs@endmatter
\newcommand{\sfs@marginlist}[2]{%
  \ifsfs@endmatter\else\vspace{\parskip}\global\sfs@endmattertrue\fi
  \marginlabel{#1}#2\par}
\newcommand{\attachments}[1]{\sfs@marginlist{\attachmentsname}{#1}}
\newcommand{\distribution}[1]{\sfs@marginlist{\distributionname}{#1}}
\newcommand{\forinformation}[1]{\sfs@marginlist{\forinformationname}{#1}}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Organization contact information (organisaation yhteystietojen tietoalue)
%

% Separated from the preceding content by an extra paragraph gap, like the
% end-matter lists; add \vspace for more, as in the standard's Liite A.
\newcommand{\makecontactinfo}{%
  \par\vspace{\parskip}%
  \noindent\hspace*{-\sfs@column}%
  \parbox[t]{\dimexpr\textwidth+\sfs@column\relax}{%
    \textbf{\sfs@contactname}%
    \ifx\sfs@contactlines\@empty\else\\\sfs@contactlines\fi}\par}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Hyperlinks and document properties
%

% Empty properties are skipped rather than set to empty strings. This hook
% runs before any \AtBeginDocument code from the document preamble, so a
% document overrides these with \AtBeginDocument{\hypersetup{...}}.
\RequirePackage[bookmarksopen,bookmarksnumbered,hidelinks]{hyperref}

% A \date in the standard's d.m.yyyy format (6.2) doubles as the PDF
% CreationDate and ModDate, so the stored properties agree with the
% visible metadata (5.1) instead of recording the compilation time;
% \modified overrides the ModDate alone. A default (\today) or
% free-form date leaves the compile-time dates untouched.
\def\sfs@datedefault{\today}
\newcommand{\sfs@setpdfdate}[2]{\expandafter\sfs@setpdfdate@#2...\@nil{#1}}
\def\sfs@setpdfdate@#1.#2.#3.#4\@nil#5{%
  \def\sfs@tempa{#2}\def\sfs@tempb{#3}\def\sfs@tempc{#4}\def\sfs@tempd{..}%
  \ifx\sfs@tempa\@empty\else\ifx\sfs@tempb\@empty\else
    \ifx\sfs@tempc\sfs@tempd
      \hypersetup{#5={D:#3\two@digits{#2}\two@digits{#1}}}%
    \fi
  \fi\fi}

\AtBeginDocument{%
  \hypersetup{pdflang={fi},pdftitle={\@title}}%
  \ifx\sfs@subject\@empty\else\hypersetup{pdfsubject={\sfs@subject}}\fi
  \ifx\@author\@empty\else\hypersetup{pdfauthor={\@author}}\fi
  \ifx\sfs@keywords\@empty\else\hypersetup{pdfkeywords={\sfs@keywords}}\fi
  \ifx\@date\sfs@datedefault\else
    \sfs@setpdfdate{pdfcreationdate}{\@date}%
    \ifx\sfs@modified\@empty\sfs@setpdfdate{pdfmoddate}{\@date}\fi
  \fi
  \ifx\sfs@modified\@empty\else\sfs@setpdfdate{pdfmoddate}{\sfs@modified}\fi}
