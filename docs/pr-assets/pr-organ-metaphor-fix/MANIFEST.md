# Visual proof: ch.1 §1.3/§1.4 mixed-metaphor fix

- `before-after-p7.png` — page 7 of `whitepaper/single-writer-kernel.tex`
  compiled standalone with `pdflatex` (the file carries its own
  `\documentclass`, no chapter/book preamble needed), rendered at 150 dpi /
  1.0x via PyMuPDF, before vs. after this PR's two sentence edits.
  Reproduction: `pdflatex single-writer-kernel.tex` from a copy of
  `whitepaper/{single-writer-kernel.tex,figures/}`, then render page 7.
  `sourceLabel: real` — both PDFs are genuine compiles of the actual
  before/after source, not mockups.
