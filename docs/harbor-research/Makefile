# Harbor research build. Deps: python3 (numpy scipy matplotlib networkx),
# pdflatex (texlive; do NOT add microtype/lmodern — see HANDOFF §3.6).
SK := $(CURDIR)/../../skills/harbor-results/scripts
TEXS = doc1_treatise doc2_product doc3_research doc4_papers exec1 exec2 exec3 exec4 exec5 review portfolio paper1 paper2 paper3 paper4 paper5 paper6 paper7
.PHONY: all figures docs clean
all: docs
figures:
	mkdir -p build
	cd build && python3 $(SK)/a7_experiment.py
	cd build && python3 $(SK)/b2_tower.py
	cd build && python3 $(CURDIR)/b1_figure.py
# NOTE: `figures` re-runs the experiments (the A7 falsification sweep takes
# several minutes). The rendered PNGs are committed under figures/, so `docs`
# uses those by default and does not force a regeneration.
docs:
	mkdir -p build && cp tex/*.tex build/ && cp figures/*.png build/
	cd build && for d in $(TEXS); do pdflatex -interaction=nonstopmode $$d.tex >/dev/null; pdflatex -interaction=nonstopmode $$d.tex >/dev/null; done
	@ls build/*.pdf
clean:
	rm -rf build
