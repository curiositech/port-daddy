# Before/After: Stat-Card Dashboard → Sparkline Table

**Situation**: A docs or ops page needs to show six services' request rate,
error rate, and p99 latency, each with a one-week trend.

## Before (chartjunk-heavy stat-card grid)

- Six large cards, one per service, each with: a colored icon, a drop shadow, a
  gradient background tinted by "health" color, a huge bold current-value
  number, and a small embedded line chart with its own axis, gridlines, and
  legend.
- To compare "which service's error rate is rising fastest," the reader must
  visually scan six separate charts at six different scales (each chart
  auto-scaled its own y-axis), holding five numbers in memory while reading the
  sixth.
- Ink audit: high `ink_fraction` (background gradients + icon fills + shadows),
  high `distinct_colors` (gradients), non-trivial `edge_density` (drop shadows,
  icon anti-aliasing) — `scripts/ink_audit.py` would flag all three.

**Why it fails the doctrines**: violates data-ink ratio and chartjunk (doctrine
2 — gradients, shadows, icons carry no data); violates small multiples
(doctrine 3 — six *different*-scale charts are not small multiples, they're six
independent charts that happen to be the same size); violates the smallest
effective difference (doctrine 8 — a "health" gradient color plus a bold number
plus an icon is three redundant signals for one health/not-health judgment).

## After (small-multiples sparkline table)

A single table:

| Service | Requests/s | Error rate | p99 (ms) | 7-day trend |
|---|---|---|---|---|
| auth | 412 | 0.12% | 84 | ▂▂▃▃▄▅▇ |
| billing | 88 | 0.03% | 61 | ▃▃▂▂▂▃▃ |
| … | | | | |

- One row per service, one sparkline column, all sparklines on the SAME
  y-domain (or explicitly noted per-metric domain if metrics differ in scale) —
  doctrine 3's requirement that small multiples share scale so shapes are
  directly comparable.
- No axis, no gridlines, no legend on the sparklines (doctrine 4) — the numeric
  columns carry the exact values; the sparkline carries the shape.
- Direct-labeled current value as plain table text next to each sparkline
  (doctrine 1: label the data directly, no color-only "health" encoding).
- A single bold number appears only where genuinely out of range (e.g., error
  rate column text turns to a bold weight, not a color+icon+shadow, when past
  threshold) — doctrine 8, smallest effective difference.
- Ink audit: near-zero decorative ink; flags (if any) should only concern
  actual data marks, not chrome.

**Net effect**: the reader compares six services' three metrics — eighteen
numbers plus six trend shapes — in the time it took to read one stat card in
the "before" version, because the comparison doctrine (9.1: "compared with
what?") is now built into one glance across a column, not six separate glances
across six cards.
