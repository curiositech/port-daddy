# Taxonomy: idea shape → diagram kind → TikZ idiom

Choose the kind from the shape of the idea, then draw it with the house idiom.
The catalogue borrows Mermaid's breadth of kinds as a checklist (the book renders
TikZ; Mermaid is the thinking tool). The right-hand column names one figure in the
library that is, or should have been, that kind.

| idea shape | kind | draw with | avoid | in the library |
|---|---|---|---|---|
| n things × m properties (maturity, coverage, what crosses a boundary) | **table** | `booktabs`, `tabularx`; ● ○ marks if binary | dot matrices, icon rails | seven organs (ch. 1), four phases (ch. 2), stack maps (all) |
| concurrent work in time, one order out | **Gantt / swimlane** | rows per actor, `pd neutral fill` bands with edges, verticals to the commit rail | invisible bands, floating diamonds | single writer (ch. 1), consistency model (ch. 1), state of nature (ch. 4) |
| a protocol between named parties | **sequence diagram** | `pgf-umlsd` or hand-drawn lifelines with numbered messages and what each binds | arrows around a metaphor | anchor handshake, transfer ceremony (ch. 6/8), float plan (ch. 6), magic link (ch. 7) |
| states and guarded transitions | **state machine** | `automata` library, `pd state` / `pd terminal`, labels on the outside of each edge | crossing edges, labels on edges | claim lifecycle, commitment oracle, work unit (ch. 1); judge market (ch. 5); governance flow (ch. 7) |
| a quantity against a parameter, with a computed point | **xy plot** | `pgfplots`, both axes labelled with units, the worked point marked with its coordinates | hand-sketched curves | composition crossover, operating curve (ch. 3), deterrence (ch. 5), specialization (ch. 4) |
| where a rule holds in a plane | **regime / quadrant** | `pgfplots` with `pd focus fill` regions edged, axis titles as full clauses, one instance per cell | unlabeled 2 × 2 grids | controllability quadrant (ch. 1), revocation regime (ch. 8), cartel boundary (ch. 6/7) |
| two orderings of the same items | **slope chart** | two vertical axes, one line per item, ranks labelled | crossing spaghetti without labels | split ranker (ch. 4), multidimensional reputation (ch. 5) |
| a value that narrows or accumulates along stages | **step chart** (or Sankey when flows split) | `pgfplots const plot`, y axis in words if ordinal | grey funnels | continuity chain (ch. 1), evidence support |
| flows of a conserved quantity | **waterfall / Sankey** | `pgfplots ybar` with running total, or the `sankey` package | pie charts | conservation functor (ch. 6), bond buckets (ch. 7) |
| the same system before and after a change | **before/after pair** | two panels, identical geometry, one difference highlighted | one panel with both states | cuckoo vs log (ch. 2), state of nature (ch. 4) |
| two executions that must agree | **two-run lockstep** | two rows, ≡ marks per step, the one permitted difference boxed | prose only | two worlds (ch. 3) |
| a lineage or fork | **DAG / gitgraph** | `graphs` library, time left to right, the offending edge dashed | trees drawn as timelines | copy-fork attack (ch. 5), delegation chain (ch. 2) |
| a lattice of labels or capabilities | **Hasse diagram** | `tikz-cd` or hand-placed nodes, ⊆ upward | arbitrary boxes | DLM labels (ch. 3), capability attenuation (ch. 2) |
| a cycle versus a cut | **graph pair** | two small graphs, same node set, the quantity under each | one graph with annotations | consistency radius C₆ vs P₆ (ch. 8) |
| a stage game or payoff | **matrix / game tree** | `tabular` with the equilibrium cell marked, or `forest` | prose payoffs | claim signaling (ch. 7), Myerson–Satterthwaite (ch. 6) |
| a sequential test over time | **timeline with stopping rule** | one axis, the boundary as a rule, the stop marked | none | SPRT (ch. 3) |
| an automaton with controllable and uncontrollable events | **automaton** | `automata` library, two edge styles keyed in the caption | prose lists | R5 detector-not-regimenter (ch. 1) |
| wire or record layout | **packet / record diagram** | `bytefield`-style boxes with field widths | prose field lists | card bytes (ch. 2), receipt layout |
| deployment across trust domains | **architecture diagram** | boxed domains, arrows labelled with what crosses | cloud icons | local / remote / sealed harbor (ch. 3) |
| what the reader would see at the terminal | **session listing** | `pdsession` (monospace, captured transcript, checked in) | screenshots | `pd claim` refusal, TLC trace, ProVerif attack, `cargo kani` |
| a multi-axis profile per item | **radar** | rarely; a table is usually clearer | radar for ≤ 3 axes | organ maturity (ch. 1) → table |
| composition of a budget | **treemap** | rarely; a stacked bar or table | treemaps for < 5 parts | bond composition (ch. 7) |

Kinds deliberately not used in the book: pie, mindmap, user-journey ribbon, 3-D
anything, icon rails. Their information content is a sentence or a table.

## Perceptual ordering, applied

From most to least accurately read (Cleveland and McGill; Munzner's channel ranking):
position on a common scale · position on unaligned scales · length · angle and slope ·
area · colour value and saturation · volume. Encode the fact the reader must take
away in the highest channel available. Colour hue is for identity (which actor, which
regime), never for magnitude; the house palette's three hues (ink, teal, amber) are
a category scale of three and nothing more.

## When a figure becomes a table

If every mark in a drawing could be replaced by a cell containing a word without loss,
it is a table. The test: read the drawing aloud. "Row three has a dot at column two"
is a table. "The band ends where the rail says 3" is a figure.
