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
        helvetic
        hyperref
        hyphen-finnish
        preview
        latex
        latexmk
        mathpazo
        metafont
        metapost
        microtype
        ragged2e
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
