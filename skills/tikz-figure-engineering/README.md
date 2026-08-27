# TikZ Figure Engineering skill assets

Run the self-contained renderer:

```bash
python3 scripts/render_tikz_figure.py examples/clean-two-lane-sequence.tex \
  --out-dir build/example --strict --max-width-in 6.5 --max-height-in 4.6
```

The script requires a local LaTeX engine (`pdflatex`, `xelatex`, or `lualatex`)
and one rasterizer (`pdftocairo` or ImageMagick). It has no Python package
dependencies. Output is a PDF, a PNG inspection raster, compilation logs, and
`render-report.json`. It does not modify the source file.

## Test

```bash
python3 -m unittest tests/test_render_tikz_figure.py -v
```

