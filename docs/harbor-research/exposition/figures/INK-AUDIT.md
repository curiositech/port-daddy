# Ink audit — the live figure corpus

Re-derived on 2026-09-14 against the corpus the Book actually ships, and it
replaces an earlier set of numbers taken over a corpus that no longer
exists. This file reports; it fixes nothing. Every redraw it implies touches
a chapter's TikZ source and belongs to a later wave.

## What was measured, and on what

The corpus is the 56 fragments that are both `\input` by one of the eight
chapter sources named in `whitepaper/textbook.json` and carry a
`\begin{tikzpicture}` — the rule `scripts/harbor-research/check_figcheck_corpus.py`
enforces, so this audit and the figure-QA record set measure the same set by
construction rather than by agreement.

Each fragment was compiled standalone under its own chapter's preamble
(`skills/harbor-chartwork/scripts/compile_fragment.sh --preamble chapter`), and the
resulting PDF read twice: by `skills/harbor-chartwork/scripts/figcheck.py`, whose
`ink` block runs `skills/tufte-evidence-design/scripts/ink_audit.py` over the
figure's content region, and by `ink_audit.py` standalone over a cropped 1.6x
raster of the same page. The two agree closely (median ink fraction 0.146 against
0.144; the standalone crop includes slightly more white margin, so it reads a
little lighter on every figure). The figcheck numbers are the ones tabulated
below, because they are the ones committed under
`docs/harbor-research/exposition/figures/figcheck/`.

These are heuristics, not verdicts. `ink_audit.py` says so itself on every
run: data-ink ratio and chartjunk are judgments about meaning, and no pixel
counter makes them. Read a row as a prompt to go look at the figure.

## The distribution

| | |
|---|---|
| Figures measured | 56 |
| Ink fraction — median | **0.146** |
| Ink fraction — quartiles | 0.110 / 0.146 / 0.183 |
| Ink fraction — range | 0.040 (`fig-sybil-inline`) to 0.553 (`fig-swk-stack-map`) |
| Distinct colours — median | 1741 |
| Distinct colours — max | 2543 (`fig-stp-judge-market`) |
| Edge density — median | 0.0723 |
| Edge density — max | 0.1141 (`fig-bonded-key-custody`) |
| Figures raising an `ink_fraction` flag | 1 of 56 (`fig-swk-stack-map`) |
| Figures raising an `edge_density` flag | 22 of 56 |
| Figures raising no flag at all | 33 of 56 |

The shape is a long right tail on a light body. 41 of the 56 sit between 0.09
and 0.19; seven sit above 0.28, and one above 0.5. Every figure in that tail
is heavy for the same reason — a filled region or a filled band where an
outline would do — which makes the tail a single redraw problem rather than
seven.

## What the edge-density flag is actually catching here

The flag's own text blames "heavy gridlines, hatching/cross-hatch fills, or
moire-like repeating texture." In this corpus that diagnosis is mostly wrong,
and worth writing down before anyone redraws against it. Exactly one fragment
uses a TikZ `pattern` at all — `fig-sybil-inline` — and it has the *lowest*
edge density of all 56 (0.023). The 22 flagged figures are flagged for two
other reasons: dense small type inside the drawing (`fig-sealed-mutant-grid`
is a ruled table plus a seven-line italic note; `fig-governance-flow` is
fourteen prose labels on five strokes), and many short strokes in a small
frame (`fig-bonded-key-custody`'s four-panel strip, `fig-magic-link-inline`'s
fourteen strokes at inline width). Only `fig-stp-sybil-whitewash` is flagged
for something like the stated cause — dashed step functions over dotted
gridlines.

The actionable reading of the flag in this corpus is therefore *prose in
shapes*, not hatching: a figure carrying enough small type to raise a texture
score is usually a figure whose labels want to be a caption.

## Ranked table

Ranked by ink fraction, heaviest first. `flags` is what `ink_audit.py`
raised; `geometry` is the failed/warned checks from the same fragment's
committed figcheck record (T1-T5 and T8 are failures, T6-T7 warnings).

| # | fragment | chapter | ink | colours | edge | flags | geometry | what is heavy about it |
|---:|---|---|---:|---:|---:|---|---|---|
| 1 | `fig-swk-stack-map` | 1 Single-Writer Kernel | 0.553 | 2045 | 0.0681 | ink_fraction | clean | Five full-column bands, each a solid tint, stacked floor to ceiling: the fill is the whole figure, and it encodes nothing the band label does not already say. |
| 2 | `legible-swarm-specialization` | 4 Legible Swarm | 0.402 | 2391 | 0.0611 | — | clean | Both half-planes of the specialization boundary are flooded with tint, so the Erlang-C curve — the only line carrying a number — competes with two painted areas for the reader's eye. |
| 3 | `fig-cartel-game-inline` | 6 Harbor Economy + 7 Bonded Commons | 0.397 | 1839 | 0.0852 | edge_density | T1 | A two-region phase diagram with both regions filled; the boundary is one curve and two labelled points, and everything else on the page is background paint. |
| 4 | `fig-fh-revocation-regime` | 8 Federated Harbor | 0.376 | 1461 | 0.0688 | — | clean | The same two-filled-half-planes pattern: a straight TTL line separating two tinted wedges, with three prose blocks set inside the paint. |
| 5 | `fig-stp-deterrence-regime` | 5 From Spawn to Person | 0.311 | 1609 | 0.0632 | — | T4 | One filled region under a hyperbola, plus a three-line annotation set inside it — and the region's own right border is drawn straight through that annotation's first line (T4). |
| 6 | `fig-anchor-capability-attenuation` | 2 Anchor Protocol | 0.294 | 1781 | 0.0587 | — | clean | Three nested filled rectangles, the outermost spanning the full plot; the nesting is the claim, and outlines alone would carry it at a fraction of the ink. |
| 7 | `fig-worked-example` | 7 Bonded Commons | 0.281 | 2411 | 0.0827 | edge_density | T1, T2, T4 | Three full-width tinted lanes behind a timeline, 24 nodes and 11 strokes: the lane shading is decoration behind the only thing being read, which is the ordering of events on the rails. |
| 8 | `fig-fh-revocation-gossip` | 6 Harbor Economy + 8 Federated Harbor | 0.270 | 1895 | 0.0895 | edge_density | clean | Five filled bands plus thirteen labels; the banding separates rows that are already separated by vertical position. |
| 9 | `fig-fh-xfer-ceremony` | 6 Harbor Economy + 8 Federated Harbor | 0.252 | 2030 | 0.0947 | edge_density | T3, T4 | A single large tinted envelope narrowing across the page, with fourteen labels set on top of it — the envelope's area, not its two edges, is what costs the ink. |
| 10 | `fig-anchor-revocation-gossip` | 2 Anchor Protocol | 0.238 | 1579 | 0.0670 | — | clean | Tinted phase bands behind a hop-by-hop gossip sequence; the bands repeat the horizontal axis. |
| 11 | `fig-sealed-pillar-pipeline` | 3 Sealed Harbor | 0.209 | 1361 | 0.0652 | — | clean | Seventeen boxed nodes and ten connectors in one flow, every box outlined and tinted and several carrying two lines of type plus a filename beneath. |
| 12 | `fig-swk-durability-faultclass` | 1 Single-Writer Kernel | 0.199 | 1305 | 0.0678 | — | clean | A two-by-three matrix in which every one of the six cells is a solid tinted rectangle; the tint duplicates the word already printed in the cell. |
| 13 | `fig-he-three-sided` | 6 Harbor Economy | 0.183 | 1876 | 0.0908 | edge_density | clean | Sixteen labels and nine strokes across three rails, with every label in its own tinted chip — the chips are the ink, and small type at this scale is what raises the texture reading. |
| 14 | `fig-swk-claim-lifecycle` | 1 Single-Writer Kernel | 0.183 | 1201 | 0.0731 | — | clean | A filled state track behind the lifecycle arrows; the arrows already order the states. |
| 15 | `fig-stp-rate-the-raters` | 5 From Spawn to Person | 0.182 | 2000 | 0.0935 | edge_density | T1, T4 | Two tinted panels behind a scatter and a dashed reference line, with the panel labels set inside the paint. |
| 16 | `fig-stp-judge-market` | 5 From Spawn to Person | 0.181 | 2543 | 0.0847 | edge_density | T4 | The corpus's widest palette (2,543 distinct colours in one drawing): struck-through candidate circles, a two-colour timeline, a bond rail and five annotation colours in a single frame. |
| 17 | `legible-swarm-split-ranker` | 4 Legible Swarm | 0.176 | 2185 | 0.0708 | — | clean | Twenty-one labels and eight strokes in one frame; the reading is fine but the label count is what puts it in the upper third for both ink and colour. |
| 18 | `fig-anchor-alg-confusion` | 2 Anchor Protocol | 0.163 | 2039 | 0.0566 | — | clean | Fourteen labels over nine strokes with one filled callout; dense small type against line work. |
| 19 | `fig-governance-flow` | 7 Bonded Commons | 0.162 | 1986 | 0.0936 | edge_density | T3, T4 | Fourteen labels on five strokes, several of them long phrases set at the drawing's smallest size — prose in a diagram, which is what the texture reading is picking up. |
| 20 | `fig-magic-link-inline` | 7 Bonded Commons | 0.161 | 2064 | 0.0877 | edge_density | T2, T4 | Twenty labels and fourteen strokes in an inline-width frame: the busiest stroke-to-area ratio in the corpus outside the small-multiple strips. |
| 21 | `fig-swk-controllability-quadrant` | 1 Single-Writer Kernel | 0.159 | 968 | 0.0666 | — | clean | A shaded quadrant behind four labels; the shading marks a region the axis labels already name. |
| 22 | `fig-stp-parfit-chain` | 5 From Spawn to Person | 0.159 | 1687 | 0.0707 | — | T1, T3, T4 | Eleven nodes on ten connectors, with a tinted continuity ribbon behind the chain. |
| 23 | `fig-fh-settlement` | 6 Harbor Economy + 8 Federated Harbor | 0.157 | 2335 | 0.0924 | edge_density | T3 | Twenty-six labels across two panels, and panel A's caption text runs into panel B's first label (T3) — two diagrams competing for one column. |
| 24 | `fig-swk-workunit-machine` | 1 Single-Writer Kernel | 0.154 | 1182 | 0.0714 | — | clean | Twelve boxed states over ten transitions with one filled emphasis box. |
| 25 | `fig-sealed-two-worlds` | 3 Sealed Harbor | 0.153 | 1616 | 0.0906 | edge_density | clean | Two side-by-side worlds, sixteen labels, twelve strokes and a dashed correspondence line running between them. |
| 26 | `fig-stp-role-vs-person` | 5 From Spawn to Person | 0.153 | 1792 | 0.0884 | edge_density | T1, T2, T4 | Eleven labels over seven strokes with a circled distinction; small type at inline width. |
| 27 | `fig-anchor-delegation-inline` | 2 Anchor Protocol | 0.147 | 1984 | 0.0921 | edge_density | clean | Three dashed strokes, three arrowheads, two circles and thirteen labels crammed into an inline-width frame. |
| 28 | `fig-stp-tombstone` | 5 From Spawn to Person | 0.147 | 1750 | 0.0836 | edge_density | T2, T3, T4 | Twelve labels on eleven strokes; the stroke count relative to the drawn area is what raises the texture reading. |
| 29 | `fig-bonded-key-custody` | 7 Bonded Commons | 0.146 | 1950 | 0.1141 | edge_density | T2, T4 | The corpus's highest texture reading (0.114): four small-multiple panels separated by dotted rules, each with a diamond, one or two circles, arrows and a teal baseline — and two of the four panel headings have their diamond drawn through them (T2, T4). |
| 30 | `fig-stp-sybil-whitewash` | 5 From Spawn to Person | 0.143 | 1732 | 0.1024 | edge_density | T3, T4 | Two panels of dashed step functions over dotted gridlines; the dash-plus-grid combination is the one place in this corpus where the flag's stated cause (repeating texture) is literally what is drawn — and the axis label collides with a tick label (T3). |
| 31 | `fig-anchor-card-lifecycle` | 2 Anchor Protocol | 0.140 | 1698 | 0.0670 | — | clean | Fourteen labels on fourteen strokes with two filled emphasis boxes. |
| 32 | `fig-anchor-cuckoo-inline` | 2 Anchor Protocol | 0.135 | 2036 | 0.0562 | — | clean | Twenty-four labels in an inline-width frame; almost all of the ink is type. |
| 33 | `fig-stp-multidim-reputation` | 5 From Spawn to Person | 0.135 | 2177 | 0.0739 | — | T1, T2, T4 | Seventeen labels across six strokes, with a wide accent palette for the dimensions. |
| 34 | `fig-fh-threat-bands` | 6 Harbor Economy + 8 Federated Harbor | 0.133 | 1506 | 0.0947 | edge_density | T4 | Eighteen labels over eleven strokes; the band edges and the label rows interleave closely enough to read as texture. |
| 35 | `fig-stp-nomint-lineage` | 5 From Spawn to Person | 0.130 | 2166 | 0.0856 | edge_density | clean | Seventeen labels, two filled emphasis marks and two circled identities in a lineage tree. |
| 36 | `fig-fh-cycle-vs-cut` | 8 Federated Harbor | 0.129 | 1881 | 0.0706 | — | clean | Six labels on five strokes — one of the four figures that had never been checked at all before this pass; it is clean on T1-T8 and light on ink. |
| 37 | `fig-he-assurance` | 6 Harbor Economy | 0.125 | 1776 | 0.0878 | edge_density | T1 | Ten labels on four strokes, two of them dashed; light on ink, and the texture reading comes from the dashes and the small type rather than any fill. |
| 38 | `fig-swk-reference-monitor` | 1 Single-Writer Kernel | 0.122 | 1623 | 0.0770 | — | clean | Fifteen labels on seven strokes, no fills. |
| 39 | `legible-swarm-state-of-nature` | 4 Legible Swarm | 0.116 | 1600 | 0.0475 | — | clean | Twelve labels on eleven strokes; below the median on every measure. |
| 40 | `fig-sealed-operating-curve` | 3 Sealed Harbor | 0.114 | 1480 | 0.0684 | — | clean | Three labels, one curve, four small fills — a genuinely spare plot. |
| 41 | `fig-he-float-plan` | 6 Harbor Economy | 0.113 | 2169 | 0.0772 | — | T2, T4 | Thirteen labels on seven strokes; a wide palette for a light drawing. |
| 42 | `fig-he-cold-start` | 6 Harbor Economy | 0.111 | 1401 | 0.0829 | edge_density | T4 | Eleven labels on nine strokes, two dashed; a line through one label (T4) is its only geometry defect. |
| 43 | `fig-swk-consistency-model` | 1 Single-Writer Kernel | 0.109 | 1265 | 0.0627 | — | clean | Nine labels on three strokes; clean and light. |
| 44 | `legible-swarm-sdt` | 4 Legible Swarm | 0.108 | 1825 | 0.0812 | edge_density | clean | Two strokes, six labels, four dashed segments: the least drawing of any flagged figure, and the flag is firing on the dashes alone. |
| 45 | `fig-sealed-mutant-grid` | 3 Sealed Harbor | 0.107 | 1001 | 0.0983 | edge_density | clean | A ruled two-by-two table plus a seven-line italic note block set at the drawing's smallest size; the texture reading is the note block, not the table. |
| 46 | `legible-swarm-zoom-vs-potemkin` | 4 Legible Swarm | 0.106 | 1708 | 0.0457 | — | clean | Twenty-three labels on twelve strokes, and still under the corpus median for ink. |
| 47 | `fig-he-conservation-functor` | 6 Harbor Economy | 0.104 | 1627 | 0.0731 | — | T4 | Twenty-two strokes — the most of any fragment — but thin ones: a commuting diagram, and it stays light. |
| 48 | `fig-swk-single-writer` | 1 Single-Writer Kernel | 0.104 | 1460 | 0.0640 | — | clean | Seven labels on nine strokes; clean and light. |
| 49 | `fig-stp-probation-cliff` | 5 From Spawn to Person | 0.099 | 829 | 0.0676 | — | clean | Two labels, two fills, no strokes — one of the four never-checked fragments, and among the lightest in the corpus. |
| 50 | `fig-swk-commitment-oracle` | 1 Single-Writer Kernel | 0.099 | 1821 | 0.0458 | — | clean | Eleven labels on eleven strokes; clean, light, and among the three lowest texture readings in the corpus. |
| 51 | `legible-swarm-roles` | 4 Legible Swarm | 0.097 | 1430 | 0.0512 | — | clean | Eight labels on seven strokes. |
| 52 | `fig-sealed-composition-crossover` | 3 Sealed Harbor | 0.095 | 1478 | 0.0702 | — | clean | One label, one stroke, three fills — the spare end of the corpus. |
| 53 | `legible-swarm-readpoverty` | 4 Legible Swarm | 0.091 | 1467 | 0.0749 | — | clean | Seven labels on one stroke. |
| 54 | `fig-swk-continuity-organs` | 1 Single-Writer Kernel | 0.073 | 1045 | 0.0641 | — | T7 | Two labels, two strokes, one fill. |
| 55 | `fig-swk-marker-decay` | 1 Single-Writer Kernel | 0.061 | 1122 | 0.0535 | — | clean | No labels and no strokes in the fragment itself — a pure plot, the third of the four never-checked fragments, and the second-lightest in the corpus. |
| 56 | `fig-sybil-inline` | 7 Bonded Commons | 0.040 | 2305 | 0.0233 | — | T4, T5, T7 | The lightest figure in the corpus (0.040) and the only one that uses a TikZ `pattern`; the hatching costs almost nothing here because the hatched area is tiny. |

## The heavy tail, named

Seven figures carry more than a quarter of their content region in ink, and
one carries more than half:

- **`fig-swk-stack-map`** — 0.553 ink, 2045 colours (1 Single-Writer Kernel). Five full-column bands, each a solid tint, stacked floor to ceiling: the fill is the whole figure, and it encodes nothing the band label does not already say.
- **`legible-swarm-specialization`** — 0.402 ink, 2391 colours (4 Legible Swarm). Both half-planes of the specialization boundary are flooded with tint, so the Erlang-C curve — the only line carrying a number — competes with two painted areas for the reader's eye.
- **`fig-cartel-game-inline`** — 0.397 ink, 1839 colours (6 Harbor Economy + 7 Bonded Commons). A two-region phase diagram with both regions filled; the boundary is one curve and two labelled points, and everything else on the page is background paint.
- **`fig-fh-revocation-regime`** — 0.376 ink, 1461 colours (8 Federated Harbor). The same two-filled-half-planes pattern: a straight TTL line separating two tinted wedges, with three prose blocks set inside the paint.
- **`fig-stp-deterrence-regime`** — 0.311 ink, 1609 colours (5 From Spawn to Person). One filled region under a hyperbola, plus a three-line annotation set inside it — and the region's own right border is drawn straight through that annotation's first line (T4).
- **`fig-anchor-capability-attenuation`** — 0.294 ink, 1781 colours (2 Anchor Protocol). Three nested filled rectangles, the outermost spanning the full plot; the nesting is the claim, and outlines alone would carry it at a fraction of the ink.
- **`fig-worked-example`** — 0.281 ink, 2411 colours (7 Bonded Commons). Three full-width tinted lanes behind a timeline, 24 nodes and 11 strokes: the lane shading is decoration behind the only thing being read, which is the ordering of events on the rails.

Four of the seven are one drawing idea: a two-region plot with *both* regions
filled (`legible-swarm-specialization`, `fig-cartel-game-inline`,
`fig-fh-revocation-regime`, `fig-stp-deterrence-regime`). The other three are
a second idea: an area used where an outline would do — nested solid
rectangles in `fig-anchor-capability-attenuation`, tinted lanes behind a
timeline in `fig-worked-example`, and a fully tinted band stack in
`fig-swk-stack-map`, which `fig-swk-durability-faultclass` repeats one rank
further down as a fully tinted matrix. In both families the redraw is the
same move: tint one region or none, leave the rest white, and let the
boundary carry the claim.

## What did not come out of this

Numbers circulated before this pass — 79 figures, median ink fraction 0.144,
`fig-swk-stack-map` at 0.662 with 2,478 distinct colours, 43 of 79 flagged on
edge density — were computed over the record set as it stood, which described
27 fragments that no chapter ships and missed four that it does. The count,
the maximum, the colour count and the flag count above all differ; the median
happens to land within 0.003 of the old one, which is a coincidence of two
different populations and not a confirmation.
