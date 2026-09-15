# Visual proof: ch.1 §1.3/§1.4 mixed-metaphor fix

- `before-after-p8.png` — page 8 of `whitepaper/single-writer-kernel.tex`
  compiled standalone with `pdflatex` (the file carries its own
  `\documentclass`, no chapter/book preamble needed), rendered at 150 dpi /
  1.0x via PyMuPDF, before vs. after this PR's two sentence edits. Two
  `pdflatex` passes were run so cross-references resolve to real numbers
  (`§A`, `page 42`) instead of `??` placeholders from a single pass; page 7
  in a single-pass compile becomes page 8 once real numbers replace the
  wider `??` markers and reflow the page.
  Reproduction: `pdflatex single-writer-kernel.tex && pdflatex
  single-writer-kernel.tex` (second pass required) from a copy of
  `whitepaper/{single-writer-kernel.tex,figures/}`, then render page 8.
  `sourceLabel: real` — both PDFs are genuine compiles of the actual
  before/after source, not mockups.
