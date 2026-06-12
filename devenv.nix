{ pkgs, ... }:
{
  packages = [
    # Interactive development TeX Live: the class's requirements plus
    # l3build and friends for CTAN packaging. Diverges deliberately from
    # flake.nix's texliveEnv, which instead adds the packages that
    # pandoc-generated body code can reference — Markdown builds always
    # go through the flake (`nix run .`), even from this shell.
    (pkgs.texlive.combine {
      inherit (pkgs.texlive)
        scheme-basic
        babel-finnish
        caption
        enumitem
        everyshi
        helvetic
        hyperref
        hyphen-finnish
        l3build
        preview
        latex
        latexmk
        mathpazo
        metafont
        metapost
        microtype
        pdfmanagement-testphase
        pgf
        ragged2e
        tagpdf
        totpages
        xcolor;
    })
    pkgs.curl
    pkgs.ghostscript
    pkgs.gnumake
    pkgs.treefmt
    pkgs.unzip
    pkgs.which
  ];

  cachix.pull = [ "datakurre" ];
}
