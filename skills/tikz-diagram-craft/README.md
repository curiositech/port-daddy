# tikz-diagram-craft

The Book's figure standard (v2) and the loop that proves a figure prints.
Start at `SKILL.md`. The language itself is
`website-v2/public/whitepaper/figures/pd-figure-language.tex` (twin under
`whitepaper/figures/`), with edition layers `pd-figure-language-swiss.tex` and
`pd-figure-language-technical.tex`.

```
SKILL.md                         the standard in one screen and the process
references/figure-standard.md    rules S1-S10 with reasons
references/migration-v1-to-v2.md name and colour map for old fragments
templates/tpl-*.tex              ten grammars, each a compiling fragment
examples/redraw-*.tex            three Book figures redrawn to the standard
scripts/book_figure_qa.py        3 editions x figcheck x width -> contact sheet
scripts/palette_check.py         hue separation and contrast
```

Harvested from `wave-11/tikz-craft-skill` (2026-09-06) where the templates,
examples and v2 language were drafted; SKILL.md, the references, the edition
integration and the QA driver were written when v2 was installed (2026-09-11).
