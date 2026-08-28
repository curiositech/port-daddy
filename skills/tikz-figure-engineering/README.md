# TikZ Figure Engineering skill assets

Run the self-contained renderer:

```bash
python3 scripts/render_tikz_figure.py examples/clean-two-lane-sequence.tex \
  --out-dir build/example --preview --strict --max-width-in 6.5 --max-height-in 4.6
```

The script requires a local LaTeX engine (`pdflatex`, `xelatex`, or `lualatex`)
and one rasterizer (`pdftocairo` or ImageMagick). It has no Python package
dependencies. A normal render emits a PDF, one color PNG inspection raster,
compilation logs, and `render-report.json`; it never creates grayscale output.
The `--preview` mode uses a faster 144-DPI color raster while retaining
compilation and strict-fit checks. The optional `--contact-sheet` batch feature
also requires ImageMagick because `pdftocairo` rasterizes pages but does not
compose PNGs. The renderer does not modify source files.

## Test

```bash
python3 -m unittest tests/test_render_tikz_figure.py -v
```
