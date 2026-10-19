# UX Friction Analyzer

Friction analysis for anything a person has to get through: a live web flow, a
wireframe, a PDF report, or a 400-page technical book. Cognitive psychology,
Gestalt grouping, ADHD-friendly design, and a random-surfer reader model that
turns "this is hard to read" into a number you can rank.

The question this skill answers is **"can they get through it"**. Whether they
*want* to is `product-appeal-analyzer` — and the two are readouts of the same
chain, because friction is the set of terms that raise the probability of
quitting and appeal is the set that lowers it.

## Quick Start

### A live flow or a wireframe

1. Read `SKILL.md` for the decision matrix, the primary decision tree, and the
   8 failure modes.
2. Describe the flow as JSON matching `schemas/flow-audit.schema.json` (see
   `examples/sample-input.json`) and run
   `node scripts/friction_audit.mjs --input flow.json` for the mechanical
   per-step gates: touch targets, 320px reflow, 100ms feedback.
3. Build a surface graph (`schemas/surface-graph.schema.json`, see
   `examples/surfer-wireframe.json`) and run
   `node scripts/surfer_model.mjs --input graph.json --mode task` for attention
   mass, reach probability, and where the median arrival quits.
4. For wireframes, read `references/surface-adapters.md` first — it says what a
   wireframe cannot tell you, which belongs in the report.

### A document or a book

1. For LaTeX, build most of the graph mechanically:
   `node scripts/latex_skeleton.mjs --input book.tex --level section --wpm 120 > graph.json`.
   That extracts sections, word counts, floats, equations, and the author's own
   cross-reference graph. Then fill in the `_todo` items it emits.
2. Add concepts (`references/comprehension-debt.md`), Gestalt scores from the
   *typeset* PDF (`references/gestalt-operators.md`), and `costSeconds`
   estimates (`references/reading-models.md`).
3. If the book prints a Reader's Map, encode each route as a `readerPaths`
   entry — see `references/reader-maps.md`. This is what catches a route that
   skips the chapter defining a concept the route later needs.
4. Run `node scripts/surfer_model.mjs --input graph.json --mode skim`, then
   again in `scan` and `study`. The *difference* between modes is the most
   useful diagnostic the model produces.

## Before you quote a number

The model's constants are **priors, not measurements**. Rank nodes with it and
compare revisions with it; do not report a completion figure as though it were
observed. `references/random-surfer-reader.md` has the calibration section and
the list of ways the model is knowingly wrong — put the relevant parts in the
report.

A `pass: true` clears the mechanical checks only. Real-user validation, WCAG AA
compliance, and completion-time measurement still require the checklist in
`references/quality-gates.md`.
