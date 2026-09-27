---
name: latex-publication-design
description: >-
  Design the typography and page grammar of a standalone LaTeX paper or
  whitepaper: type hierarchy, restrained color, callouts, figure consistency,
  and rendered-page review. Use when a PDF looks visually weak or a new paper
  needs a coherent visual system. NOT for the argument or proof, Book-specific
  edition styles, TikZ figure engineering, compilation, or a committed-PDF
  registry workflow.
license: Apache-2.0
metadata:
  category: Writing
  tags: [latex, publication, typography, page-design]
  pairs-with: [latex-authoring, tikz-figure-engineering, latex-build-diagnostics]
---

# LaTeX Publication Design

Give a paper a coherent page language before polishing individual figures.
This skill owns visual hierarchy across pages: body type, headings, margins,
figure and callout treatment, running heads, and the rhythm between prose and
worked material. It does not decide whether a scientific claim or figure is
true.

## Establish the design system

1. Inspect the venue template or repository's existing page grammar first.
   Those sources take precedence over the sample `references/preamble.tex`.
2. Choose body and display type roles, a restrained palette, margin system,
   caption style, and rules for callouts and status labels.
3. Give every figure the same type roles, line weights, and caption grammar.
   Distinct semantic categories may need distinct colors; encode them with
   shape, line, position, or labels as well.
4. Keep status and maturity claims in their own table or prose, close to the
   evidence. Avoid decorative status bars in running page furniture.
5. Inspect a representative spread and every changed figure in the rendered
   PDF, then compare them together at the same scale.

The sample preamble is a starting example for a standalone paper, not a
mandatory replacement for an established Book or publisher preamble. In
particular, the Harbor Book's edition palette and page grammar are governed
by its own source and `textbook-craft` / `tikz-diagram-craft` guidance.

## Visual review

Look for these defects on actual PDF pages:

- a figure font that visibly clashes with the page type system;
- accents used so often that the focal mark disappears;
- default saturated fills or extra palette colors with no semantic role;
- labels touching boxes, crossing arrows, or shrinking below print size;
- figures with inconsistent scale, line weight, and padding;
- callouts that consume more attention than the claim they contain;
- a footer or status key that overwhelms the argument.

Read at print size and at a thumbnail scale. The first checks legibility;
the second checks hierarchy and page rhythm. A clean compile is only the
entry condition. If a defect appears, change the shared rule where possible
and render again.

## Handoffs

- `latex-authoring`: source structure, math, tables, and citations.
- `tikz-figure-engineering`: figure layout and source; `whitepaper-figure-system`
  first when a canonical Port Daddy figure needs a semantic form.
- `latex-build-diagnostics`: build and log errors.
- `latex-whitepaper-engineering`: committed PDF and registry publication.
- `textbook-craft`: chapter pedagogy and the Harbor Book's page apparatus.

## Reference

- `references/preamble.tex`: illustrative standalone-paper palette and macros.
  Compare against the current publication system before reusing any part.
