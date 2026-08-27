# Plot design and perception

Use measured plots when the conclusion depends on a quantitative relationship.
Position on a common scale and aligned length support more accurate comparison
than area, angle, saturation, and pictorial scale. This is the practical
consequence of graphical-perception research, not a mandate to make every plot
look monochrome.

## Plot rules

- State units in axis labels. State transformations (`log`, normalized,
  per-capita) in the label or subtitle, not only in the caption.
- Bars represent magnitudes and normally start at zero. If a nonzero baseline
  is materially necessary, visually flag the axis break and explain it.
- Prefer direct labels to a legend for one to four series. Put a legend in a
  reserved gutter for more series.
- Plot uncertainty where evidence supports it: interval, confidence band,
  sample size, or sensitivity range. Do not draw a confidence-looking band for
  an arbitrary scenario range.
- Use a single accent to identify the decision-relevant series/region; make the
  comparison series muted but readable.
- Place annotations outside the plot rectangle and use short leaders. Never
  cover data with a prose callout.
- Shade regions only when the region has a named semantic meaning (e.g.
  “unsafe policy region”), not to make the page less empty.

## Choosing among common plot forms

| Evidence | Figure | Do not substitute |
|---|---|---|
| A threshold changes a decision | curve/phase plot with explicit boundary | unlabeled S curve |
| Two distributions overlap | density/histogram with shared bins or ECDF | two decorative bells with no scale |
| One relationship is hypothesized | scatter with model/interval if valid | a causal arrow between prose boxes |
| A queue/load regime changes | curve with operational regions | a node graph |
| A balance/incentive condition | inequality plus scale-aware balance or payoff plot | a decorative seesaw when values matter |

## Color

Use semantic roles rather than named hues: `ink`, `neutral`, `focus`,
`caution`, `failure`. Test grayscale and avoid red/green as the only distinction.
The figure template uses deep ink, muted cool-gray, teal focus, and ochre
caution; these are defaults, not branding requirements.

