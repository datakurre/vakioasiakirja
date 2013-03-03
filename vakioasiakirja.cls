%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Simple vakioasiakirja.cls by Asko Soukka <asko.soukka@iki.fi>.

\def\filedate{2009/04/12}
\def\fileversion{1.0}
\def\fileinfo{Vakioasiakirja}
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{vakioasiakirja}[\filedate\space\fileversion\space\fileinfo]
\typeout{vakioasiakirja <\filedate:\fileversion> - SFS 2487}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Typeface and layout
%

\LoadClass[a4paper,12pt,oneside,final,notitlepage,onecolumn]{article}
% \RequirePackage[left=65.72mm,right=10mm,top=6mm,bottom=10mm,includehead,nofoot]{geometry} % See the end of "Header and footer"
\RequirePackage{mathpazo}
\RequirePackage{microtype}

\setlength{\baselineskip}{13pt} % 4.233mm
\setlength{\parindent}{\baselineskip}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Language
%

\RequirePackage[T1]{fontenc}
\RequirePackage{textcomp}
\RequirePackage[utf8]{inputenc}
\RequirePackage[english, finnish]{babel}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Markup

\newcommand{\address}[1]{\gdef\@address{#1}}

\newcommand{\addressrest}[1]{\gdef\@addressrest{#1}}

\newcommand{\telephone}[1]{\gdef\@telephone{#1}}

\newcommand{\email}[1]{\gdef\@email{#1}}

\newcommand{\type}[1]{\gdef\@type{#1}}

\newcommand{\recipient}[1]{\gdef\@recipient{#1}}

\newcommand{\lead}[1]{\gdef\@lead{#1}}

\newcommand{\signature}[2]{
  \vspace{2\baselineskip}

  \noindent #1 #2

  \vspace{2\baselineskip}

  \noindent \@author
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Header and footer
%

\RequirePackage{fancyhdr}
\RequirePackage{totpages}
\RequirePackage{ifthen}

\pagestyle{fancy}

\newcommand{\pagenum}{\thepage (\ref{TotPages})}
\newcommand{\nopagenum}{\ifnum\value{TotPages}=1\relax\else\renewcommand\pagenum{}\fi}

\newcommand{\ts}{\hspace{22.86mm}}

\fancyheadoffset{45.72mm}
\fancyfootoffset{45.72mm}

\lhead{
\begin{tabbing}
  \ts          \= \ts \= \ts \= \ts \= \ts        \= \ts \= \ts \= \kill
  \bf \@author \>     \>     \>     \> \bf \@type \>     \>     \> \bf \pagenum \\
  \@address    \>     \>     \>     \> \@date                           \\
  \@addressrest\\
  \@telephone\\
  \@email
\end{tabbing}
}
\rhead{}
\cfoot{}

\addtolength{\headheight}{3pt}
\addtolength{\headheight}{4\baselineskip}

\renewcommand{\headrulewidth}{0\p@}
\renewcommand{\footrulewidth}{0\p@}

\RequirePackage[left=65.72mm,right=10mm,top=6mm,bottom=10mm,includehead,nofoot]{geometry}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Title
%

\renewcommand{\maketitle}{
  \ifthenelse{\not\isundefined{\@recipient}}{

    \noindent\hspace{-45.72mm}\parbox[t][][t]{\linewidth}{\@recipient}

    \vspace{2\baselineskip}

  }{}
  \ifthenelse{\not\isundefined{\@lead}}{
    \noindent\hspace{-45.72mm}\textit{\@lead}

    \vspace{\baselineskip}

  }{}
  \noindent\hspace{-45.72mm}\textbf{\@title}
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Section
%

\renewcommand\thesection{}
\renewcommand\thesubsection{}
\renewcommand\section{%
  \setbox0=\hbox{\quad}%
  \@startsection {section}{1}{\z@}{\baselineskip}{\baselineskip}{\noindent\hspace{-45.72mm}\hspace{-\wd0}}}
\renewcommand\subsection{%
  \setbox0=\hbox{\quad}%
  \@startsection {subsection}{2}{\z@}{\baselineskip}{\baselineskip}{\noindent\hspace{-45.72mm}\hspace{-\wd0}}}

\newcommand{\align}{\vspace{-2\baselineskip}\noindent}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Figures and Tables
%

\usepackage{caption}
\DeclareCaptionLabelSeparator{period-space}{.\hspace{1em}}
\DeclareCaptionStyle{italic}{format=hang,labelsep=period-space,labelfont={bf},textfont={it}}
\captionsetup[figure]{style=italic}
\captionsetup[table]{style=italic}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Lists
%

\renewcommand{\labelitemi}{--}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Hyperlinks
%

\RequirePackage[pdftex,bookmarksopen,bookmarksnumbered]{hyperref}
