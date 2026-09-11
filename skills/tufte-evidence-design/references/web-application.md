# Applying the Doctrines to a Documentation Website

The four books are about print. This repository also ships `website-v2` — a
documentation site, not a PDF — so every doctrine needs a web-native
translation. None of this requires a new visualization library; it's mostly
restraint and layout discipline in HTML/CSS/React.

## Sparklines in tables (doctrine 4)

A metrics or status table (build times, latency history, canary pass rate) gets
a sparkline column instead of, or beside, a single latest-value column whenever
the trend is part of the claim. Rules:
- Inline, word-sized: roughly the row's line-height tall, no taller. If it needs
  its own row height, it's a chart, not a sparkline — promote it to a small
  multiple instead (see below).
- No axis, no gridlines, no legend on the sparkline itself. A single dot or
  color change may mark the current/last value — that's data, not decoration.
- Direct-label the one number that matters (the latest value) as text next to
  the sparkline; don't force the reader to read it off the pixels.
- Pair with `dataviz` skill's mark and color guidance for the actual rendering
  (SVG/canvas); this skill governs *when* a sparkline is the right form, not the
  pixel-level implementation.

## Small multiples on the web (doctrine 3)

When a doc page needs to compare the same metric across N services, regions, or
time windows, prefer a CSS grid of small, identically scaled, identically axed
panels over one dense overlaid chart with N series in different colors. On the
web this is cheap: a grid of small `<svg>` or `<canvas>` panels, same
width/height/domain, one difference per panel. Never let panel N have a
different y-axis scale than panel 1 — that silently breaks the doctrine's whole
point (the eye compares panel shapes assuming equal scale).

## Direct labelling over legends (doctrines 1, 2, 8)

A legend forces a saccade away from the data and back; a label at the line's
endpoint or the bar's top does not. On a docs page: label lines/bars/points
directly whenever there's room (last-value labels, endpoint callouts); reserve a
legend for a case with too many series to label directly (more than ~6), and
even then consider a small-multiples redesign first.

## No chartjunk in the web-app case (doctrine 2, and see critiques-and-limits.md)

Specific to a documentation site: no decorative background image or gradient
behind a chart panel, no gratuitous drop-shadow or 3D-tilt on a bar/pie, no
default charting-library theme with heavy gridlines and a colored plot-area
fill left un-tuned. That said, per Few/Wilke (see
`references/critiques-and-limits.md`), a *light* gridline that helps a reader
line up a bar with its axis label is retained ink that does real work — don't
strip every gridline reflexively; strip the ones a reader never uses to read a
value.

## Integrating text and figure (doctrines 9.4, 14)

On a docs page, a figure captioned three screens below the paragraph that
explains it fails doctrine 14 as badly as a print figure stranded on the facing
page. Prefer:
- Figures inline in the reading column at first mention, not collected into a
  gallery or floated to a sidebar the reader must scroll to separately.
- A caption that states the figure's *claim* in one sentence (doctrine 13:
  sentences beat bullets), not just a label ("Figure 3: Latency vs. load" is
  weaker than "Figure 3: latency stays flat until load crosses 800 req/s, then
  rises linearly").
- When a claim needs a number, a chart, AND a short explanation, set them
  adjacent in the same reading column rather than splitting across a text block
  and a separate "chart" component with its own card/border chrome.

## Margin notes in the reading column (see references/margin-apparatus.md)

A wide-viewport docs page can carry a real margin column (CSS: a narrower
content column with an adjacent `aside`/margin note column, shown only above a
breakpoint, collapsing to inline footnotes below it) — this is the direct web
analogue of the Book's `marginparwidth` column and `\pd@marginhead`/`\pdmarginfigure`
apparatus. Use it for:
- Short asides that would otherwise interrupt the sentence they annotate (a
  definition, a caveat, a "see also").
- A small figure or diagram that supports one paragraph without needing full
  column width.

Do not build a second, unrelated "notes" mechanism (e.g., hover tooltips as the
only way to see a caveat) when a visible margin note would let a reader see the
aside without an interaction — Tufte's whole point about footnotes is that
hiding an aside behind a click or a scroll is the print-era footnote's mistake
carried into a new medium.

## Boundaries and honest limits on the web

`\pdboundary`'s print pattern (a plain ink bar, "Where this stops," no fill —
see `references/margin-apparatus.md`) has a direct web equivalent: a plainly
styled callout block (a left border, no background tint, a small-caps or bold
label) stating what a claim does NOT cover, placed at the point in the docs
where a reader would otherwise over-generalize. Avoid a bright warning-colored
box for this — that visual register competes with actual errors/alerts; an
honest-limits note is not an error.

## Anti-pattern: the dashboard that maximizes decoration, not data-ink

A common docs/product anti-pattern this skill exists partly to catch: a KPI
dashboard with large stat cards, drop shadows, a colored icon per card, a
gradient background, and a big bold number — where the SAME information as a
one-row table with sparkline columns would let a reader compare six metrics in
the time it takes to read one stat card. See the decision tree in SKILL.md
("many metrics, comparison is the point" → small multiples/sparkline table, not
a stat-card grid).
