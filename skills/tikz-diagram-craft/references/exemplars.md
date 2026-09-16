# Exemplars, by grammar

Primary sources for the house grammars, one section per grammar in the SKILL.md table
plus the four new plot grammars this pass adds. Each exemplar: URL, one sentence on what
it does well, and the concrete technique translated into house role names (`pd axis`,
`pd series`, `pd focus state`, `pd badge`, `pd tag`, `pd guide`, ...). No figure is
reproduced; every entry describes and cites. Anything not directly fetched or
cross-confirmed this pass is marked `[unverified]`.

## Computed xy plots

- **PGFplots manual, "Plots of Functions"** -- <https://tikz.dev/tikz-plots> and the
  full manual (<https://pgfplots.sourceforge.net/pgfplots.pdf>). Does well: establishes
  that a plotted curve is computed from a domain/samples expression or a data file, never
  drawn by eye. Technique: `\addplot[pd series,domain=...,samples=...] {expr};` -- the
  house's own `pd axis` already wraps the manual's `axis lines*=left` two-spine idiom with
  ticks out and no box (S11).
- **`whitepaper/figures/fig-swk-marker-decay.tex`** (in-repo, already house-standard) --
  does well: two series direct-labeled at their ends (`pd label`/`pd focus label`), a
  threshold as a `pd warn series` dashed rule, and the worked point dropped to both ticks
  with `pd guide` + `pd datum`/`pd focus datum`. This is the reference worked example for
  every new plot template below; it is cited instead of re-invented.
- **Wilke, *Fundamentals of Data Visualization*, ch. "Redundant coding"**
  (<https://clauswilke.com/dataviz/redundant-coding.html>) -- does well: argues a chart
  should not need a legend when direct labels or end-of-line names can carry the same
  information as color, and that a legend's item order should match the plotted order, not
  alphabetical order. Technique: name each `pd series`/`pd focus series` at its right end
  with a `pd label`/`pd focus label` node instead of a `legend entries` list -- already S11's
  rule, now with a citation for why.
- **The Economist's chart style** (surveyed via
  <https://medium.com/@aecharts/how-to-create-the-economist-style-charts-f2052ba6d6d3> and
  <https://fountn.design/resource/the-economist-visual-style-guide/>) `[unverified, secondary
  sources only -- no primary Economist style-guide PDF located]` -- does well: one chart, one
  message; axis titles and redundant tick marks are stripped to the minimum the reader needs
  to place a value. Technique: keep `pd axis`'s default of no y-axis box/grid, and prefer a
  single worked annotation over a caption that restates the axis.
- **Datawrapper Academy, "Why many Datawrapper charts don't include axis labels"**
  (<https://www.datawrapper.de/academy/why-datawrapper-does-not-include-axis-labels-for-many-charts>)
  -- does well: an axis label is only worth its ink when the unit is not already obvious from
  the title/caption or the tick words themselves. Technique: when a `pd axis`'s `ylabel` would
  just repeat the caption's first sentence, drop it and let the tick words (`pd label`) carry
  the unit instead.

**Techniques to adopt:** direct-labeled series over legends (S11, confirmed by Wilke);
worked point dropped to both ticks with `pd guide` (already in the language, now with the
in-repo exemplar cited); drop a redundant axis label when the tick words already carry the
unit (Datawrapper); one message per plot, not a wall of series (Economist).

## Regime plots (regions between curves)

- **PGFplots manual, "Fill Between" library** -- <https://tikz.dev/pgfplots/libs-fillbetween>
  and worked recipes at <https://pgfplots.net/fill-between-plots/> and
  <https://latexdraw.com/filling-an-area-between-two-curves/>. Does well: the library
  computes the actual intersection of two curves and lets each side of the crossing carry
  a different fill, so the region's boundary is exact rather than eyeballed. Technique:
  give each `\addplot` a `name path=A`/`name path=B`, then
  `\addplot[pd focus fill] fill between[of=A and B];` -- house roles `pd focus fill`/`X fill`
  are already edged, matching S5 ("every fill has an edge").
- **PGFplots manual, "Two Dimensional Plot Types"** (`ybar`, `const plot`, threshold rules)
  -- <https://tikz.dev/pgfplots/reference-2dplots>. Does well: documents `pd warn series`'s
  underlying idiom, a flat dashed threshold plotted as a constant-domain `\addplot`, which
  the house language already wraps (S11, `fig-swk-marker-decay.tex`).
- **`fig-swk-marker-decay.tex`** (in-repo) -- does well: the closest existing house figure to
  a regime plot even though it does not yet fill a region; its worked-point-dropped-to-ticks
  idiom transfers directly to a regime plot's crossing point.

**Techniques to adopt:** `name path` + `fill between[of=... and ...]`, region always edged
(S5) and never the only channel distinguishing the regimes (S11: "series are named at their
ends" applies equally to the region's two bounding curves); the crossing itself is a
`pd focus datum` dropped to both axes with `pd guide`, exactly as in the marker-decay figure.

## Small multiples

- **PGFplots manual, "Grouping Plots"** -- <https://tikz.dev/pgfplots/libs-groupplots>. Does
  well: one `groupplot` environment propagates axis options (limits, ticks) to every panel,
  so panels are guaranteed the same scale rather than matched by hand -- this is the whole
  Tufte/Wilke requirement for small multiples made mechanical. Technique:
  `\begin{groupplot}[group style={group size=3 by 1,horizontal sep=0.55cm,
  xticklabels at=edge bottom,ylabels at=edge left}] \nextgroupplot[...] ... \end{groupplot}`;
  the shared y-axis appears once, on the leftmost panel only, which also buys back column
  width for the 4.5 in grid.
- **Wilke, *Fundamentals of Data Visualization*, small-multiples discussion** (summarized via
  <https://clauswilke.com/dataviz/redundant-coding.html> and corroborating secondary
  coverage) -- does well: states the three-part contract -- same scale, same physical panel
  size, exactly one thing varies panel to panel -- that this skill's own `tufte-evidence-design`
  checklist already encodes almost verbatim. `[unverified -- exact chapter/section title not
  independently confirmed this pass]`.
- **`tufte-evidence-design` skill, small-multiples checklist** (in-repo,
  `skills/tufte-evidence-design/SKILL.md`) -- does well: gives a mechanically checkable
  version of the Wilke contract ("all panels share the same scale... exactly one dimension
  varies... the panel-to-panel difference is the finding, not a caption"). Cited so the new
  template does not re-derive the rule.

**Techniques to adopt:** one `groupplot`, shared `xmin/xmax/ymin/ymax` set once at the
`groupplot` level so panels cannot drift apart; y-axis ticks/label only on the leftmost
panel (`ylabels at=edge left`); the panel's varying parameter is a `pd title` above each
panel, never buried in a caption; the subject panel (if one is the point) gets
`pd focus series`, the rest `pd series` or `pd muted series`.

## Slope charts

- **Tufte, slopegraph, surveyed via** <https://en.wikipedia.org/wiki/Slope_chart> and
  <https://www.line-graph-maker.com/resources/line-charts/slope-chart> `[secondary sources;
  Tufte's own *The Visual Display of Quantitative Information* coined the "slopegraph" name
  -- not independently refetched this pass, see the tufte-evidence-design skill's own
  references/sources.md for its verification state of Tufte citations]`. Does well: two
  parallel vertical axes for two points in comparison (time, condition, ranking), one line
  per item, each item labeled at both ends rather than through a shared legend -- a slope
  chart is a small multiple collapsed to one panel where the "multiple" is the item, not
  the axis.
- **Domo, "Bump Charts Explained"** -- <https://www.domo.com/learn/charts/bump-charts>. Does
  well: distinguishes a slope chart (two time points, straight segments) from a bump chart
  (three or more, tracked continuously); documents that a crossing between two lines *is*
  a rank swap and should read as the finding, not as clutter to be avoided. Technique: draw
  crossings without dodging them; label only the endpoints, and pick the focus hue for the
  one item whose rank change is the chapter's claim.

**Techniques to adopt:** two ranked columns (bare vertical `pd rule` spines with hand-placed
tick words, since pgfplots' native axis pair is awkward for exactly two ranked columns) with
item names as `pd label`/`pd tag` at both ends; the item whose rank changes matters gets
`pd focus series` (1.6 pt, chapter hue); every other item `pd muted series` so the crossing
pattern doesn't compete for attention; a rank-swap crossing is left alone, not routed
around, per Domo's point that the crossing is itself the fact.

## Step charts

- **PGFplots manual, "Two Dimensional Plot Types"**, `const plot` --
  <https://tikz.dev/pgfplots/reference-2dplots>. Does well: `const plot` (or
  `const plot mark mid`) draws a value that holds between two x-coordinates and jumps at
  the boundary, which is the honest shape for a quantity that narrows stage to stage (a
  funnel, a filtration) rather than smoothly interpolating between stages that are
  categorical, not continuous. Technique: `\addplot[pd focus series,const plot] table {...};`
  with the stage names as `xticklabels` in the label voice, since S11 requires tick words in
  `pd label`.
- **`harbor-chartwork/references/taxonomy.md`** (in-repo) row "a value that narrows or
  accumulates along stages" -- does well: already assigns this grammar to `pgfplots const
  plot` and names the house's own worked instances (continuity chain ch. 1, evidence
  support) as the pattern to match; cited here so the new template is consistent with the
  taxonomy rather than inventing a second idiom for the same reader question.

**Techniques to adopt:** `const plot`, never a smooth interpolation, between categorical
stage labels; the stage that narrows the most (the chapter's claim) gets a `pd focus datum`
at the jump; each jump's drop amount is a direct label (`pd label`) beside the step, not a
separate data table underneath.

## Waterfall

- **PGFplots.net, "Waterfall chart"** -- <https://pgfplots.net/waterfall-chart/> and its
  source <https://pgfplots.net/tex/waterfall-chart.tex>. Does well: computes the running
  total with `pgfplotstableset`'s `create col/expr` (`\prevrow{0}+\prevrow{1}+\pgfmathaccuma`)
  so the bars' vertical offsets are derived, not hand-placed, and uses `ybar stacked` with an
  invisible base series to float each bar at its running total. Technique for the house:
  `pd focus fill`/`pd ready fill`/`pd breach fill` distinguish a rising bar, a positive
  correction and a negative one respectively (each still edged per S5); the invisible base
  series is drawn with no stroke and no house style at all, since it carries no meaning.
- **`harbor-chartwork/references/taxonomy.md`** row "flows of a conserved quantity" -- does
  well: names `ybar` with a running total, or the `sankey` package, as the two house-blessed
  idioms for this grammar, and lists rejected alternatives (pie charts) explicitly, which is
  the pattern this skill's own briefs should follow (state the rejected grammar and why).

**Techniques to adopt:** running total via `create col/expr`, never typed in by hand (a
waterfall's whole point is that the total is derivable, so a hand-typed offset silently
breaks that guarantee if the chapter's numbers change); every bar direct-labeled with its
own delta (`pd label` above the bar), the final total in `pd focus label`; a positive
correction is `pd ready fill`, a negative one `pd breach fill` -- doubling colour with
direction, per S3.

## Message-sequence ladders

- **pgf-umlsd, worked example** -- <https://texample.net/pgf-umlsd/>. Does well: vertical
  lifelines per participant with horizontal call/return arrows, and nested `call` blocks
  that let a message's reply visually nest inside the request rather than floating free.
  Technique: the `\prelevel` command adjusts vertical spacing precisely enough to keep
  concurrent/overlapping messages from colliding -- the house's existing
  `templates/tpl-sequence.tex` should keep messages on a fixed `\dy` grid instead (S7,
  "declare the grid once"), which is stricter but achieves the same non-collision goal
  without a manual spacing knob.
- **Lamport, "TLA in Pictures"** -- <https://lamport.azurewebsites.net/pubs/lamport-pictures.pdf>
  (primary source, Lamport's own paper on drawing distributed-system behavior). Does well:
  a Lamport diagram puts one process per vertical line, actions as dots on that line, and a
  message as a diagonal arrow crossing between two lines -- causal order becomes "is there a
  forward path between these two dots", a claim a reader can check by eye instead of trusting
  a caption. Technique: every message arrow in a house sequence figure should slope
  slightly forward (time increases downward *and* the arrow's tail is always above its
  head), never drawn as a perfectly horizontal line that could misread as instantaneous.
- **RFC plain-text ASCII diagram convention** -- surveyed via
  <https://www.rfc-editor.org/rfc/rfc6949.txt> `[unverified -- did not confirm a specific
  RFC's numbered-message convention this pass; RFCs commonly number wire messages 1., 2.,
  3. in running prose beside an ASCII ladder, but no single normative source for the
  numbering style itself was located]`. Does well when present: numbers the messages in the
  diagram and refers to that same number in prose immediately after, which is exactly the
  house's own badge-keyed-to-a-legend pattern (S7): `pd badge` on the arrow, a ruled
  `tabular` underneath keyed by the same numeral, never a paragraph inside the picture.

**Techniques to adopt:** grid-pitched lifelines rather than a manual spacing command
(house-native, stricter than pgf-umlsd's `\prelevel`); arrows that visibly slope forward in
time (Lamport); numbered badges on messages keyed to a ruled legend table, never inline
prose (S7, cross-confirmed by the RFC convention where it is followed).

## State machines

- **Harel, *Statecharts: A Visual Formalism for Complex Systems*, 1987** -- summarized via
  <https://www.sciencedirect.com/science/article/pii/0167642387900359> and
  <https://www.weizmann.ac.il/math/harel/sites/math.harel/files/users/user50/Statecharts.History.pdf>
  (Harel's own retrospective) `[secondary summary of the 1987 figures; the original Science
  of Computer Programming figures were not independently refetched this pass]`. Does well:
  a superstate's substates are mutually exclusive (XOR) and a transition drawn on the
  superstate's boundary applies to every substate at once, so the diagram states an
  invariant ("this guard holds regardless of which substate you're in") the reader would
  otherwise have to infer from N repeated arrows. Technique: a house state machine with a
  shared guard across several states should draw one `pd focus arrow` from a `pd panel`
  (dashed group box) around the substates, not one arrow per substate.
- **TeXample.net, "TCP state machine"** -- <https://texample.net/tcp-state-machine/>. Does
  well: eleven real protocol states (CLOSED, LISTEN, SYN_SENT, ...) on one spine with
  labeled transitions, proving a state machine with a dozen-plus states can still fit one
  page when transitions are laid out on a directed grid rather than a force-directed mess.
  Technique confirms the house's own S7 grid discipline: same pitch, same box size, one
  reading direction.
- **`skills/tikz-diagram-craft/templates/tpl-state-machine.tex`** (in-repo, already
  house-standard) -- the worked reference for the spine-plus-off-ramps-plus-badges pattern;
  cited so a new state-machine figure copies this, not the TCP example's raw layout.

**Techniques to adopt:** a `pd panel` around states that share one guard, with a single
`pd focus arrow` on the panel boundary instead of N duplicate arrows (Harel); real,
named states from the chapter's own code/spec, never generic placeholders (S8, confirmed
against the TCP example's real state names).

## Swimlane Gantt, timelines of epochs, block stacks, quadrants, nested sets, grid
## matrices, DAG lineages, before/after pairs

These seven grammars already have a house template and, for several of them, a worked
redraw (`examples/redraw-*.tex`) -- this pass's research effort went to the plot family
above, which had no prior house exemplar. The general-design sources below apply across
all seven and are recorded once rather than per grammar:

- **Wilke, *Fundamentals of Data Visualization*** (as above) -- direct labeling and
  redundant coding apply as much to a quadrant's four labeled cells or a DAG's node names
  as to a plotted line; the house's `pd tag`/`pd focus label` roles already implement this.
- **Tufte doctrines** (via the grafted `tufte-evidence-design` skill,
  `references/doctrines.md`) -- data-ink ratio underlies S7's ban on decorative panel fills
  (`pd panel` is dashed and unfilled) and S6's ban on cream stickers.
- **TUGboat 45.1 (2024), Stenborg, "Semi-automated TikZ directed acyclic ..."** --
  <https://tug.org/TUGboat/tb45-1/tb139stenborg-dags.pdf>. Does well specifically for DAG
  lineages: a longest-path layering algorithm assigns each node a column by its longest
  path from a source, so derivation order reads left to right without manual coordinate
  placement -- the same guarantee `templates/tpl-tree-dag.tex`'s fixed-grid approach gives
  by hand, cited here as the algorithmic version of the same house rule (time left to
  right, S7).
- **PGF/TikZ manual, "Graph Drawing Algorithms: Layered Layouts"** --
  <https://tikz.dev/gd-layered> -- the library underlying the Stenborg technique above;
  `graph[layered layout, grow=right]` is the mechanized form of S7's "declare the grid
  once" for a DAG specifically, useful when a lineage has too many nodes to place by hand,
  but the house's fixed-`\def`-grid remains the default for anything that fits on the
  4.5 in column without automatic layout.

No new template was built for these seven this pass; the existing
`templates/tpl-*.tex` files and their entries in `templates/INDEX.md` stand.
