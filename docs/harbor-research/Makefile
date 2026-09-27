# Harbor research build. Deps: python3 (numpy scipy matplotlib networkx),
# pdflatex (texlive; do NOT add microtype/lmodern — see HANDOFF §3.6).
SK := $(CURDIR)/../../skills/harbor-results/scripts
REPO_ROOT := $(abspath $(CURDIR)/../..)
TEXS = doc1_treatise doc2_product doc3_research doc4_papers exec1 exec2 exec3 exec4 exec5 review portfolio paper1 paper2 paper3 paper4 paper5 paper6 paper7 paper8
BUILD_DIR ?= build
PDF_DIR ?= pdf
# These are every repository input that can alter a Harbor PDF. Keep this list
# source-only: generated PDFs, catalog metadata, and review evidence must not
# retimestamp an otherwise identical render.
RENDER_INPUTS = docs/harbor-research/tex docs/harbor-research/figures docs/harbor-research/Makefile .github/workflows/harbor-research-build.yml
.PHONY: all figures docs clean source-inputs source-epoch output-names
all: docs
figures:
	mkdir -p build
	cd build && python3 $(SK)/a7_experiment.py
	cd build && python3 $(SK)/b2_tower.py
	cd build && python3 $(CURDIR)/b1_figure.py
# NOTE: `figures` re-runs the experiments (the A7 falsification sweep takes
# several minutes). The rendered PNGs are committed under figures/, so `docs`
# uses those by default and does not force a regeneration.
source-inputs:
	@printf '%s\n' $(RENDER_INPUTS)

# The current renderer owns this exact output set. The committed pdf/ directory
# also preserves historical research artifacts, which are not silently claimed
# as fresh output by this build.
output-names:
	@for d in $(TEXS); do printf '%s.pdf\n' "$$d"; done

# PDF creation dates and trailer IDs are deterministic only when pdfTeX sees a
# stable epoch. Use the maximum author timestamp across the complete renderer
# input set: author dates survive rebases, while a generated-artifact commit or
# an unrelated proof/metadata commit does not perturb the byte stream.
SOURCE_REF ?= HEAD
source-epoch:
	@epochs="$$(git -C "$(REPO_ROOT)" log --format=%at "$(SOURCE_REF)" -- $(RENDER_INPUTS))" || exit $$?; printf '%s\n' "$$epochs" | awk 'BEGIN { max = 0 } $$1 > max { max = $$1 } END { if (max > 0) print max }'

docs:
	mkdir -p "$(BUILD_DIR)" && cp tex/*.tex "$(BUILD_DIR)/" && cp figures/*.png "$(BUILD_DIR)/" && cp figures/*.tex "$(BUILD_DIR)/"
	set -e; cd "$(BUILD_DIR)" && run_pdf() { doc="$$1"; pass="$$2"; if ! pdflatex -interaction=nonstopmode -halt-on-error -file-line-error "$$doc.tex" >/dev/null; then echo "pdflatex failed: document=$$doc pass=$$pass" >&2; test ! -f "$$doc.log" || tail -n 60 "$$doc.log" >&2; exit 1; fi; }; for d in $(TEXS); do run_pdf "$$d" 1; run_pdf "$$d" 2; done
	mkdir -p "$(PDF_DIR)" && cp "$(BUILD_DIR)"/*.pdf "$(PDF_DIR)/"
	@ls "$(PDF_DIR)"/*.pdf 2>/dev/null || (echo "no PDFs produced -- check the pdflatex log in $(BUILD_DIR)/" && exit 1)
clean:
	rm -rf "$(BUILD_DIR)"
