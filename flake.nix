{
  description = "SFS 2487:2024 vakioasiakirja: Markdown to PDF";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      eachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      packages = eachSystem (pkgs: rec {
        # TeX Live closure: the class's requirements plus the packages that
        # pandoc-generated body code can reference (tables, strikeout,
        # verbatim footnotes, syntax highlighting).
        texliveEnv = pkgs.texlive.combine {
          inherit (pkgs.texlive)
            scheme-basic
            babel-finnish caption enumitem everyshi helvetic hyperref
            hyphen-finnish latex latexmk mathpazo metafont microtype
            pgf preview ragged2e totpages xcolor
            booktabs soul upquote fancyvrb framed;
        };

        # Documentation site tooling: mkdocs with the material theme, used
        # by `make docs` and the GitHub Pages workflow.
        docsEnv = pkgs.python3.withPackages (ps: [
          ps.mkdocs
          ps.mkdocs-material
        ]);

        # Only the class, template and filter end up in the runtime closure,
        # not the whole repository.
        support = pkgs.runCommandLocal "sfs-2487-2024-support" { } ''
          install -Dm644 ${./sfs-2487-2024.cls} \
            $out/tex/latex/sfs-2487-2024/sfs-2487-2024.cls
          install -Dm644 ${./pandoc/sfs-2487-2024.latex} \
            $out/pandoc/sfs-2487-2024.latex
          install -Dm644 ${./pandoc/sfs-2487-2024.lua} \
            $out/pandoc/sfs-2487-2024.lua
        '';

        default = pkgs.writeShellApplication {
          name = "vakioasiakirja";
          # librsvg's rsvg-convert turns SVG logos and images into PDFs
          # that pdflatex can include (see pandoc/sfs-2487-2024.lua).
          # entr drives --watch mode.
          runtimeInputs = [ pkgs.pandoc texliveEnv pkgs.coreutils pkgs.librsvg pkgs.entr ];
          text = ''
            usage() {
              echo "usage: vakioasiakirja [--watch] <asiakirja.md>" >&2
              echo "Builds <asiakirja.pdf> next to the markdown input." >&2
              echo "  --watch  rebuild the PDF whenever the markdown file changes" >&2
              exit 2
            }
            watch=0
            args=()
            for arg in "$@"; do
              case "$arg" in
                --watch) watch=1 ;;
                -*) usage ;;
                *) args+=("$arg") ;;
              esac
            done
            if [ "''${#args[@]}" -ne 1 ] || [ "''${args[0]##*.}" != "md" ]; then
              usage
            fi
            if [ ! -f "''${args[0]}" ]; then
              echo "vakioasiakirja: ''${args[0]}: no such file" >&2
              exit 1
            fi
            input="$(realpath "''${args[0]}")"
            if [ "$watch" = 1 ]; then
              # entr builds once at startup, then re-runs this script
              # (without --watch) on every change; it also survives editors
              # that save by replacing the file.
              echo "Watching $input; press Ctrl-C to stop." >&2
              status=0
              printf '%s\n' "$input" | entr -n "$0" "$input" || status=$?
              exit "$status"
            fi
            dir="$(dirname "$input")"
            base="$(basename "$input" .md)"
            tmp="$(mktemp -d)"
            trap 'rm -rf "$tmp"' EXIT
            # Relative image and logo paths resolve against the markdown file.
            cd "$dir"
            # The Lua filter writes SVG-to-PDF conversions here.
            export SFS_2487_TMPDIR="$tmp"
            pandoc --standalone \
              --template "${support}/pandoc/sfs-2487-2024.latex" \
              --lua-filter "${support}/pandoc/sfs-2487-2024.lua" \
              --output "$tmp/document.tex" "$input"
            # -quiet keeps successful builds readable but also hides TeX
            # errors, so surface them from the log when latexmk fails.
            if ! TEXINPUTS="$dir:${support}/tex/latex/sfs-2487-2024:" \
              latexmk -pdf -interaction=nonstopmode -quiet \
                -output-directory="$tmp" "$tmp/document.tex"; then
              echo >&2
              grep -a -A 2 '^!' "$tmp/document.log" >&2 || true
              exit 1
            fi
            cp "$tmp/document.pdf" "$dir/$base.pdf"
            echo "Wrote $dir/$base.pdf"
          '';
          meta = {
            description = "Convert SFS 2487:2024 markdown documents to PDF";
            mainProgram = "vakioasiakirja";
          };
        };
      });

      apps = eachSystem (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.default}/bin/vakioasiakirja";
        };
      });
    };
}
