# Diagram Taxonomy: Idea Shape → Visual Grammar → TikZ Idiom

The foundational law of systems diagramming: **the structural shape of the idea dictates the visual form**. Never select a diagram format based on visual novelty. This taxonomy maps conceptual relationships to their proper diagrammatic representations and implementation idioms in TikZ.

---

## Canonical Idea-to-Grammar Mapping

| Idea Shape | Diagram Kind | Implementation Idiom in TikZ | What to Avoid | Canonical Example in Volume |
|---|---|---|---|---|
| **Property Matrix** ($N$ entities $\times$ $M$ properties) | **Table** | `booktabs`, `tabularx`, with `\BuiltWeak`, `\Designed`, `\Vision` markers | Dot matrices, icon rails | Volume Implementation Ratio, Organ Maturity |
| **Concurrent Work in Time** (ordering, lock contention) | **Gantt / Swimlanes** | Rows per actor, `pd neutral fill` bands with solid edges, vertical ticks to commit rail | Invisible floating bands, loose diamonds | Single-Writer Lease Rail, Multi-Agent Concurrency |
| **Multi-Party Protocol Exchange** (leases, handshakes, bids) | **Sequence Diagram** | Vertical lifelines, numbered horizontal arrows (`1a.`, `1b.`), explicit payload tags | Circular arrows around central metaphors | Contract Net Protocol (Part 1 & 2), Macaroon Attenuation |
| **Guarded States & Transitions** (lifecycles, revocations) | **State Machine** | TikZ `automata` library, `pd state` / `pd terminal`, exterior edge labels | Crossing diagonal edges, inline edge text | Claim Lifecycle, Commitment Oracle |
| **Continuous Function / Metric** (crossover, latency, frontier) | **XY Plot** | `pgfplots` environment, explicit axis titles with physical units, marked equilibrium points | Hand-sketched qualitative Bézier curves | Operating Frontier, Composition Crossover |
| **Decision Space / Regimes** (where a rule holds in a 2D plane) | **Quadrant / Regime Map** | `pgfplots` with bounded `pd focus fill` regions, complete sentence axis titles | Unlabeled 2 $\times$ 2 consultant matrices | Controllability Quadrant, Revocation Regime |
| **Comparative Rankings** (two evaluations of same entities) | **Slope Chart** | Two vertical rank axes, connecting lines per entity, labeled endpoints | Spaghetti lines without direct line labels | Split-Ranker Supervisory Alignment |
| **Accumulating / Narrowing Value** (capability attenuation) | **Step Chart / Sankey** | `pgfplots const plot`, ordinal categorical steps | Vague narrowing funnels | Authority Attenuation Chain, Token Dilution |
| **Conserved Flow / Balance** (escrow, liquidity, collateral) | **Waterfall / Balance Flow** | `pgfplots ybar` with running balance totals, explicit ingress/egress arrows | Pie charts, donut charts | Bilateral Clearing, Double-Liability Escrow |
| **System Transformation** (before vs. after an intervention) | **Before/After Pair** | Two side-by-side panels with identical scale/geometry, differing elements highlighted | Single overloaded panel with both states | Uncoordinated Chaos vs. Single-Writer Kernel |
| **Causal Lineage / Git History** (forks, DAGs, ancestry) | **Directed Acyclic Graph** | TikZ `graphs` library, left-to-right chronological flow, offending branches dashed | Trees drawn as linear timelines | Copy-Fork Attack, Delegation Lineage |
| **Lattice / Partial Order** (security labels, capabilities) | **Hasse Diagram** | Upward inclusion ordering ($\subseteq$), transitive reduction | Arbitrary block diagrams | Dynamic Labeling Matrix (DLM) Lattices |
| **Wire & Storage Formats** (packets, receipts, cards) | **Record / Memory Layout** | Segmented byte fields with proportional bit/byte width markers | Bulleted lists of struct fields | Harbor Card Byte Layout, Receipt Envelope |
| **Terminal Interaction** (operator CLI, verified test runs) | **Session Listing** | `pdsession` environment (fixed-width, syntax-highlighted real transcripts) | Generic computer mockup frames | Coordination Guard CLI, TLC Verification |

---

## The Cleveland & McGill Perceptual Channel Ranking

When encoding quantitative data or ordinal relationships, encode the most critical variable using the highest available perceptual channel (Cleveland & McGill, 1984; Munzner, 2014):

1. **Position on a Common Aligned Scale** *(Highest accuracy)* — Bar charts, scatter plots, Gantt tracks along a single time axis.
2. **Position on Non-Aligned Identical Scales** — Small multiples, slope chart columns.
3. **Length** — Bar charts with differing baselines.
4. **Direction / Slope / Angle** — Slope charts, trend angles (use sparingly).
5. **Area** — Circle or bubble plots (difficult for humans to judge accurately; avoid).
6. **Color Value (Lightness) & Saturation** — Heatmaps (ordinal magnitude only; never quantitative precision).
7. **Color Hue** *(Lowest accuracy for quantity)* — **Categorical identity only**. Never use color hue to represent magnitude or numbers. In this volume, hues distinguish actors and regimes, not quantities.

---

## Banned Visual Forms

The following diagram formats are **strictly prohibited** in this volume. If drafted, they will be rejected in editorial triage:

- ❌ **Pie Charts & Donut Charts:** Replace with a horizontal stacked bar chart or a small `booktabs` table.
- ❌ **3D Visualizations & Perspective Projections:** 3D isometric cubes or planes distort area and distance. Use 2D orthogonal projections.
- ❌ **Mind Maps & Concept Clouds:** Unstructured clusters lack causality and falsifiability. Replace with an ordered hierarchy, state machine, or DAG.
- ❌ **Icon Rails & Generic Emoji/Clip-Art Flowcharts:** Generic icons convey no structural information. Replace with concrete entity boxes and precise protocol labels.
- ❌ **"Spaghetti" Network Graphs:** Unconstrained spring-embedded graphs with hundreds of overlapping edges convey only "it is complex." Extract the relevant sub-path or order nodes chronologically.

---

## When a Diagram Should Be a Table

If every visual mark in a diagram could be replaced by a cell containing a single word without loss of information, **it is a table, not a diagram**.

*The Reading Test:* Read the proposed diagram aloud. If you find yourself saying:
- *"Row 1 has a checkmark in column 2..."* $\implies$ It is a **table**.
- *"Contractor 1's lease begins at $t_1$, terminating at the commit line where Contractor 2's waiting lock unblocks..."* $\implies$ It is a **diagram**.
