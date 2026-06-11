%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% SFS 2487:2024 vakioasiakirja.cls by Asko Soukka <asko.soukka@iki.fi>.
%
% Implements the SFS 2487:2024 standard "Asiakirjan asettelu ja metatiedot":
% information areas (tietoalueet) on a 2,3 cm column grid, basic metadata
% area 9,2 cm from the left margin, body text 2,3 cm from the left margin.

\def\filedate{2026/06/11}
\def\fileversion{1.2}
\def\fileinfo{Vakioasiakirja SFS 2487:2024}
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{sfs-2487-2024}[\filedate\space\fileversion\space\fileinfo]
\typeout{sfs-2487-2024 <\filedate:\fileversion> - SFS 2487:2024}

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

\setlist[itemize]{label=\textbullet,topsep=0pt,partopsep=0pt,itemsep=0pt,parsep=0pt}
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

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Language
%

\RequirePackage[T1]{fontenc}
\RequirePackage{textcomp}
\RequirePackage[utf8]{inputenc}
\RequirePackage[english,finnish]{babel}

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
\let\sfs@contactname\@empty
\let\sfs@contactlines\@empty

\newcommand{\doctype}[1]{\gdef\sfs@doctype{#1}}
\newcommand{\docid}[1]{\gdef\sfs@docid{#1}}
\newcommand{\confidentiality}[1]{\gdef\sfs@confidentiality{#1}}
\newcommand{\extrametadata}[1]{\gdef\sfs@extrametadata{#1}}
\newcommand{\logo}[1]{\gdef\sfs@logo{#1}}
\newcommand{\recipient}[1]{\gdef\sfs@recipient{#1}}
\newcommand{\subject}[1]{\gdef\sfs@subject{#1}}
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

\newcommand{\sfs@pagenum}{\thepage\ (\ref{TotPages})}

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

% Grow the header to fit the metadata block (e.g. a tall logo), taking the
% extra space from the text height so the body never overlaps the header.
\AtBeginDocument{%
  \sbox\@tempboxa{\sfs@metadatablock}%
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
  \noindent\hspace*{-\sfs@column}\sfs@metadatablock\par
  \ifx\sfs@extrametadata\@empty
    \vspace{\parskip}%
  \else
    \noindent\hspace*{\dimexpr\sfs@metaindent-\sfs@column\relax}%
    \parbox[t]{\dimexpr\textwidth+\sfs@column-\sfs@metaindent\relax}{\sfs@extrametadata}\par
  \fi
  \ifx\sfs@recipient\@empty\else
    \noindent\hspace*{-\sfs@column}\parbox[t]{\textwidth}{\sfs@recipient}\par
  \fi
  \noindent\hspace*{-\sfs@column}%
  \parbox[t]{\dimexpr\textwidth+\sfs@column\relax}{%
    \ifx\sfs@subject\@empty\else\textbf{\sfs@subject}\\\fi
    {\sfs@titlefont\@title}}\par
}

% The main title is bold and 3pt larger than the body text, inside the
% 2-4pt band that 5.2.1 recommends at any base font size; the heading
% rules of 6.4 (no justification, no hyphenation) apply to it as well.
\newcommand{\sfs@titlefont}{%
  \fontsize{\dimexpr\f@size pt+3pt}{\dimexpr(\f@size pt+3pt)*12/10}%
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

% Unnumbered regular-weight label at the left margin ("Aika ja paikka"),
% with the following content at the body indent.
\newcommand{\marginlabel}[1]{\par\noindent\hspace*{-\sfs@column}#1\par\nopagebreak}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Signatures (allekirjoituksen tietoalue)
%

% Electronic signature: fixed lead-in sentence, then one \esignee per signer.
\newenvironment{esignatures}{%
  \par Tämä asiakirja on sähköisesti allekirjoitettu.%
}{\par}
\newcommand{\esignee}[2]{\par #1\\#2}

% Handwritten signature: reserve space (the standard allows 3-5 paragraph
% gaps) above the printed name and role.
\newcommand{\handsignature}[2]{\par\vspace{3\parskip}\noindent #1, #2\par}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Attachments, distribution and for-information lists
% (liitteet, jakelu ja tiedoksi -tietoalue)
%

\newcommand{\sfs@marginlist}[2]{%
  \par\noindent\hspace*{-\sfs@column}#1\par\nopagebreak
  #2\par}
\newcommand{\attachments}[1]{\sfs@marginlist{Liitteet}{#1}}
\newcommand{\distribution}[1]{\sfs@marginlist{Jakelu}{#1}}
\newcommand{\forinformation}[1]{\sfs@marginlist{Tiedoksi}{#1}}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Organization contact information (organisaation yhteystietojen tietoalue)
%

\newcommand{\makecontactinfo}{%
  \par\noindent\hspace*{-\sfs@column}%
  \parbox[t]{\dimexpr\textwidth+\sfs@column\relax}{%
    \textbf{\sfs@contactname}%
    \ifx\sfs@contactlines\@empty\else\\\sfs@contactlines\fi}\par}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Hyperlinks and document properties
%

\RequirePackage[bookmarksopen,bookmarksnumbered,hidelinks]{hyperref}
\AtBeginDocument{%
  \hypersetup{
    pdflang={fi},
    pdftitle={\@title},
    pdfsubject={\sfs@subject},
    pdfauthor={\@author}}}
