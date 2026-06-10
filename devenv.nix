{ pkgs, ... }:
{
  packages = [
    (pkgs.texlive.combine {
      inherit (pkgs.texlive)
        scheme-basic
        babel-finnish
        caption
        enumitem
        everyshi
        hyperref
        preview
        latex
        latexmk
        mathpazo
        metafont
        metapost
        microtype
        totpages;
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
