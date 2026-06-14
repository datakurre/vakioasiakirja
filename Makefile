TEXFILE ?= esimerkki-poytakirja
EXAMPLES := $(patsubst %.tex,%.pdf,$(wildcard examples/latex/esimerkki-*.tex))
MARKDOWN := $(wildcard examples/markdown/esimerkki-*.md)
LOGOS := $(patsubst %.tex,%.pdf,$(wildcard examples/logo-*.tex))

# The class lives at the repository root and the shared logo graphics in
# examples/; latexmk -cd compiles each document in its own directory.
export TEXINPUTS := $(CURDIR):$(CURDIR)/examples:

.PHONY: all
all: build

help:
	@grep -Eh '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}' | uniq

%.pdf: %.tex sfs-2487-2024.cls
	@latexmk -cd -g -pdf -recorder -interaction=nonstopmode -shell-escape -use-make -quiet $<

build: examples/latex/$(TEXFILE).pdf  ## Build the final PDF

# Example documents include the generated logo graphics
$(EXAMPLES): $(LOGOS)

.PHONY: examples
examples: $(EXAMPLES)  ## Build every examples/latex/esimerkki-*.tex document

.PHONY: markdown
markdown: $(LOGOS)  ## Build every examples/markdown/esimerkki-*.md with the nix flake
	@for doc in $(MARKDOWN); do nix run . -- $$doc || exit 1; done

.PHONY: docs
docs: examples markdown  ## Build the documentation site into site/
	@rm -rf docs/pdf docs/src
	@mkdir -p docs/pdf/latex docs/pdf/markdown
	@cp examples/latex/esimerkki-*.pdf docs/pdf/latex/
	@cp examples/markdown/esimerkki-*.pdf docs/pdf/markdown/
	@# Copy the example sources next to the PDFs so the docs site can link
	@# to them. The .txt suffix makes every host (GitHub Pages included)
	@# serve them as text/plain, so browsers render them inline instead of
	@# downloading.
	@mkdir -p docs/src/latex docs/src/markdown
	@for f in examples/latex/esimerkki-*.tex; do \
		cp "$$f" "docs/src/latex/$$(basename $$f).txt"; \
	done
	@for f in examples/markdown/esimerkki-*.md; do \
		cp "$$f" "docs/src/markdown/$$(basename $$f).txt"; \
	done
	@nix shell .#docsEnv --command mkdocs build --strict

.PHONY: watch
watch:  ## Develop PDF and watch for changes
	@latexmk -cd -pvc -pdf -recorder -interaction=nonstopmode -shell-escape -use-make examples/latex/$(TEXFILE)

.PHONY: web
web:  ## Build the browser editor prototype (nix build .#web → web/dist)
	@nix build .#web --print-build-logs
	@rm -rf web/dist && cp -rL result/ web/dist && chmod -R u+w web/dist
	@echo "Built web/dist (open with any static file server)."

.PHONY: web-dev
web-dev:  ## Run the browser editor prototype in dev mode (npm)
	@cd web && npm install && npm run dev

.PHONY: clean
clean:
	@latexmk -cd -C -quiet examples/latex/esimerkki-*.tex examples/logo-*.tex
	@rm -f examples/latex/*.fls examples/markdown/esimerkki-*.pdf
	@rm -rf docs/pdf docs/src site web/dist

.PHONY: shell
shell:
	devenv shell
