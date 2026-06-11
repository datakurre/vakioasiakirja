TEXFILE ?= esimerkki-poytakirja
EXAMPLES := $(patsubst %.tex,%.pdf,$(wildcard esimerkki-*.tex))
LOGOS := $(patsubst %.tex,%.pdf,$(wildcard logo-*.tex))

.PHONY: all
all: build

help:
	@grep -Eh '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}' | uniq

%.nav: %.tex
	@latexmk -shell-escape -quiet $<

%.pdf: %.tex sfs-2487-2024.cls
	@latexmk -g -pdf -recorder -interaction=nonstopmode -shell-escape -use-make -quiet $<

build: $(TEXFILE).pdf  ## Build the final PDF

# Example documents include the generated logo graphics
$(EXAMPLES): $(LOGOS)

.PHONY: examples
examples: $(EXAMPLES)  ## Build every esimerkki-*.tex document

.PHONY: markdown
markdown: $(LOGOS)  ## Build the markdown example with the nix flake
	nix run . -- esimerkki-markdown.md

.PHONY: watch
watch:  ## Develop PDF and watch for changes
	@latexmk -pvc -pdf -recorder -interaction=nonstopmode -shell-escape -use-make $(TEXFILE)

.PHONY: clean
clean:
	@latexmk -C -quiet
	@rm -f *.nav *.snm *.fls *.vrb missfont.log _minted-$(TEXFILE)/*
	@if [ -d _minted-$(TEXFILE) ]; then rmdir _minted-$(TEXFILE); fi

.PHONY: shell
shell:
	devenv shell
