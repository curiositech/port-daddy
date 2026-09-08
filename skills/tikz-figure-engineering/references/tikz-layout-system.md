# TikZ layout system

## Build a coordinate architecture

1. Set a target canvas before drawing: single-column (`3.2in`), text width
   (`6.5in`), or full page. Do not scale a finished dense figure down.
2. Declare a base unit: e.g. `\def\u{8mm}`. Use named anchor coordinates or
   `matrix of nodes`; do not distribute magic numbers through the source.
3. Reserve three zones: **title/context**, **main marks**, and **annotation /
   evidence**. No line may cross an annotation zone.
4. Use one alignment datum per repeated row/column. Use `positioning`, `calc`,
   `fit`, and `matrix`, not manual nudges.

## Text and spacing

- Node padding: `inner xsep=7--9pt`, `inner ysep=5--7pt`; do not put text on
  the border.
- Default minimum font: `\footnotesize` only for secondary labels. `\scriptsize`
  and `\tiny` are a review failure in body figures.
- Constrain verbal nodes with `text width`; if it becomes more than three
  short lines, move explanation to a callout/caption.
- Use `node distance` or explicit lane coordinates. Add at least one em of
  whitespace around any flow path and one node-padding unit around labels.

## Paths, labels, and crossings

- Prefer orthogonal routes for systems/process diagrams and straight routes for
  aligned comparisons. Curves are for genuine return, feedback, or trajectories.
- Keep relation labels under 28 characters. Longer labels become numbered
  callouts or a keyed annotation band.
- Never cover a path with a white label merely to hide a collision. Re-route the
  path or move the label into an empty territory.
- Avoid crossing arrows. If a crossing is semantically unavoidable, use a
  bridge/jump or split into panels and state the relation explicitly.

## Composition patterns

| Claim | Stable composition |
|---|---|
| Before/after | two aligned panels with a shared datum |
| Protocol | horizontal actor lanes, vertical time, messages between lanes |
| State machine | state regions, guard labels outside transitions, terminal markers |
| Matrix | strong row/column headers; no arrows unless direction adds information |
| Quantitative plot | plot rectangle plus external callout gutter |
| Flow/allocation | input column, transformation center, output column, a separate conservation equation band |
| Evidence trace | artifact layers in rows, claims in a narrow top strip, direct vertical trace paths |

