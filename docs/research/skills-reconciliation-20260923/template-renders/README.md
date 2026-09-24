# Generic LaTeX template render evidence

Rendered the three imported templates as supplied on branch `codex/skills-substrate-research-20260923`. All PDFs compiled with `pdflatex -interaction=nonstopmode -halt-on-error -file-line-error`; outputs and intermediates stayed in `/Users/erichowens/coding/tmp/skills-substrate-research-20260923-handoff/template-render-scratch`. Each PDF was rasterized at 150 dpi with `pdftoppm -png -r 150`, and every page PNG was opened at original resolution for inspection.

| Template | Pages | PDF | Page images |
|---|---:|---|---|
| Article | 1 | `article.pdf` | `article-page-1.png` |
| Beamer | 10 | `beamer.pdf` | `beamer-page-01.png` through `beamer-page-10.png` |
| TikZ standalone | 1 | `tikz-standalone.pdf` | `tikz-page-1.png` |

## Render notes

- **Article:** PDF produced (1 page); equation cross-reference resolves after the second LaTeX pass. The source declares `biblatex` with the Biber backend and expects an author-supplied `refs.bib`. Biber is not installed on this host, so the citation remains unresolved and the bibliography is not built. The PDF is not proof of a complete bibliography build.
- **Beamer:** PDF produced (10 pages). Ran the same source twice in the same output directory; the outline contains “First Section” after the second pass. The title frame logs `Overfull \\vbox (44.55656pt too high)`, but visual inspection shows no clipping or overlap. Metropolis warns that XeLaTeX or LuaLaTeX is required to use its Fira fonts; this proof used pdfTeX fallback fonts. Hyperref also warns that it removes `\\translate` from a PDF string on the backup slide.
- **TikZ standalone:** PDF produced (1 page), with the three labeled boxes and arrows visible and within the page bounds.

No template sources were changed. The local article `refs.bib` fixture exists only in scratch to satisfy the declared bibliography resource path; without Biber it does not certify citation or bibliography output.
