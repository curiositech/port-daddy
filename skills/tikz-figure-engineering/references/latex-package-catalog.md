# LaTeX/TikZ package catalog

Load only what the chosen grammar requires. Check availability with
`kpsewhich <package>.sty`; the renderer reports missing packages clearly.

| Package/library | Use | Guardrail |
|---|---|---|
| `tikz` | structured vector figures | base package |
| `arrows.meta` | consistent, scalable arrowheads | use semantic arrow styles |
| `positioning`, `calc`, `fit`, `matrix`, `backgrounds` | alignment and deliberate group bounds | prefer named anchors over offsets |
| `shapes.geometric`, `shapes.multipart` | meaningful state/entity distinctions | shapes must encode a real type |
| `decorations.pathreplacing` | braces/region grouping | never use as a substitute for layout |
| `patterns.meta` | redundant category encoding / grayscale | do not texture everything |
| `intersections` | exact geometry | use sparingly; can increase compile fragility |
| `pgfplots` | axes, data plots, error bars, bands, histograms | set `compat`; available only if installed |
| `tikz-cd` | commutative diagrams | only for mathematical morphisms |
| `forest` | trees | only when hierarchy is the claim |
| `booktabs`, `tabularray` | evidence/decision matrices | avoid vertical rules and dense prose |
| `siunitx` | quantities and units | never hand-format units/inconsistent decimals |
| `microtype` | better text color and line breaks in papers | document-wide, not an overlap fix |
| `caption`, `subcaption` | caption hierarchy | one caption per figure, no caption essays |
| `adjustbox` | final width bounding | do not use to shrink unreadable source |
| `xcolor` | named semantic palette | define roles, not arbitrary colors |

For a robust starting point, use `templates/publication-figure.tex`. Its
dependencies are intentionally modest. Add `pgfplots` only to a figure that
needs an actual scale; add specialized packages in the file's preamble, not as
surprise global dependencies.

