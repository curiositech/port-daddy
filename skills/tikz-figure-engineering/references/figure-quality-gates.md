# Figure quality gates

Review at full page size and at 100% raster size. Pass every gate explicitly.

| Gate | Pass condition | Fail signal |
|---|---|---|
| Claim | primary relation is visible without caption | caption is required to decode structure |
| Grammar | marks match reader action/data structure | generic boxes hide time, scale, scope, or evidence |
| Hierarchy | title, primary marks, and annotation read in order | all marks compete at one visual weight |
| Spacing | text has moat; edges occupy gutters | labels sit on paths, nodes, or axes |
| Labels | concise and directly associated | prose on arrows; legends require scavenger hunt |
| Scale | quantities have units/baseline/uncertainty as warranted | decorative curves, unmeasured areas |
| Color | contrast and redundant encodings survive grayscale | blue is doing all semantic work |
| Fit | no warnings, cropped ink, or unreadably small text | overfull boxes; raster clipping; `tiny` labels |
| Caption independence | figure states structure, caption states consequence | duplicated paragraph inside the diagram |

## Diagnose before repairing

- If text overlaps a plot: expand the canvas/gutter or reduce annotations; never
  cover marks with a background box.
- If boxes do not line up: replace manual offsets with a matrix/lane scaffold.
- If the page feels empty: improve the grammar or reduce canvas height; do not
  enlarge nodes and font until the figure becomes prose.
- If it feels twisty: replace arbitrary curved arrows with a sequence, lanes,
  or split panels.
- If it is “all blue”: reduce blue to `focus` only and use ink/neutral for the
  rest; reserve caution for a different semantic state.

