# Harbor research build. Deps: python3 (numpy scipy matplotlib networkx),
# pdflatex (texlive; do NOT add microtype/lmodern — see HANDOFF §3.6).
SK=../../skills/harbor-results/scripts
TEXS=doc1_treatise doc2_product doc3_research doc4_papers exec1 exec2 exec3 review portfolio
.PHONY: all figures docs clean
all: figures docs
figures:
	mkdir -p build
	cd build && python3 ../$(SK)/a7_experiment.py && python3 ../b1_figure.py 2>/dev/null || (cd build && python3 ../../b1_figure.py)
	cd build && python3 ../$(SK)/b2_tower.py
	@# scripts write to /home/claude by convention in-session; collect if present
	-cp /home/claude/a7_figure.png /home/claude/b1_figure.png /home/claude/b2_figure.png build/ 2>/dev/null
docs: figures
	mkdir -p build && cp tex/*.tex build/ && cp build/*.png build/ 2>/dev/null || true
	cd build && for d in $(TEXS); do pdflatex -interaction=nonstopmode $$d.tex >/dev/null; pdflatex -interaction=nonstopmode $$d.tex >/dev/null; done
	@ls build/*.pdf
clean:
	rm -rf build
