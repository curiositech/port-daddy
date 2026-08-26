# Figure convention: native vector, no raster

Every figure in the harbor-research corpus (papers 1–7, execution reports)
is a `.tex` fragment in this directory, `\input{}`'d directly into the
paper source at point of use and compiled natively by pdflatex. No figure
is a raster image (`\includegraphics` of a PNG/JPG) — this matches the
house rule the original seven product whitepapers already follow
(`website-v2/public/whitepaper/figures/*.tex`): real LaTeX text in the
document's own font, true vector output, no baked-in raster text.

## Two figure kinds

- **Relation maps / structural diagrams** (nodes, boxes, arrows — no
  numeric axes): plain `tikzpicture`, using the shared styles in
  `../tex/preamble.tex` (`relnode`, `relarrow`, `regimebox`).
- **Regime diagrams / data plots** (real computed curves, bars,
  distributions): `pgfplots`, using the shared `harbor curve` / `harbor bar`
  axis styles in `../tex/preamble.tex`. Palette: `harborblue` `RGB(30,70,110)`,
  `shipred` `RGB(140,30,30)`, `seagreen` `RGB(31,110,70)` — all three
  `\definecolor`'d once in `preamble.tex`, available everywhere.

See `fig-b1-frontier.tex` for a worked example (three pgfplots panels, real
recomputed data, `\addlegendentry`, a log-scale bar chart).

## Numeric provenance (falsification-first discipline)

Every coordinate in a plot must be **real**, recomputed directly from the
figure's source script in `figures/src/*.py` (or the compendium's cited
numbers when the script is a simulation) — never eyeballed off the old PNG,
never invented. Tag the fragment's leading comment `[verified: script
X.py, seed 20260816]` or `[internal, script X.py]` per
`skills/falsification-first/references/protocols.md` obligation 5. If the
PNG's plotted data doesn't match the script's actual output (it has
happened — see the R11 fabricated-curve catch, the R1 sampling-artifact
catch), fix it in the TikZ version rather than reproducing the bug.

## Wiring

1. Create `figures/fig-<short-name>.tex` (flat filename — the build copies
   `tex/*.tex` and `figures/*.png` and `figures/*.tex` all into one flat
   `build/` directory before running pdflatex, so `\input{}` targets must
   be bare filenames, no `../` prefix).
2. In the paper's `.tex`, replace
   `\includegraphics[width=...]{whatever.png}` (and its surrounding
   `\begin{figure}...\end{figure}` if the fragment carries its own) with
   `\input{fig-<short-name>.tex}`. Keep the existing caption text verbatim
   unless it's independently known to be wrong.
3. Leave the old `.py` generator script and committed `.png` in place —
   they're the numeric record the `.tex` fragment's data was checked
   against, and `figlint.py` / the Makefile's `figures` target still use
   them. They're just no longer `\input`/`\includegraphics`'d by any paper.
4. `.github/workflows/harbor-research-build.yml` triggers on
   `figures/**/*.tex` changes and self-heals (renders + commits fresh PDFs
   on feature branches) — CI is the only compiler available; there is no
   local LaTeX toolchain in the dev container.
