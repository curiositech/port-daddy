# Visual grammar atlas

Start with the *reader operation*, not the nouns in the prose. This atlas
combines task/data abstraction (Munzner), expressiveness/effectiveness
(Mackinlay), perceptual discriminability (Cleveland--McGill; Heer--Bostock),
and professional chart-selection practice (Financial Times).

| Reader must | Data/claim structure | First-choice grammar | Avoid when | TikZ implementation |
|---|---|---|---|---|
| Compare category magnitudes | one quantitative measure, labels matter | sorted dot or horizontal bar | values are not commensurate | `pgfplots` horizontal bars or aligned dots |
| Compare two moments | a few paired observations | slopegraph / dumbbell | more than two time points | two aligned axes and direct labels |
| Trace change | ordered time or stages | line, step, interval, event timeline | the x-order is arbitrary | `pgfplots`, annotations outside plot |
| Show uncertainty | estimates with intervals | point + interval / fan / density | only an anecdotal range exists | `error bars`, bands, explicit legend |
| Find threshold / policy boundary | two measured variables or regime | phase plot / threshold plot | no usable scale | axes, shaded regimes, direct threshold label |
| Compare distributions | many observations per group | histogram, ECDF, box/violin | n is too small to summarize | `pgfplots` histogram / manually annotated ECDF |
| Compare alternatives | same dimensions across cases | small multiples / aligned table | one alternative needs detailed tracing | repeated aligned panels |
| Follow events or concurrency | ordered events across actors | sequence diagram / swimlanes / Gantt lanes | topology, not order, is central | lanes, vertical time, orthogonal messages |
| Explain a protocol | states, guards, terminal paths | state machine | it is merely a linear pipeline | distinct state shapes; guards on transitions |
| Explain a pipeline | stages transform an artifact | stage strip / alluvial / before-after | stages can loop or branch materially | aligned columns; one artifact path |
| Show authority or delegation | scope, parent/child, attenuation | nested scope / capability table | ownership moves through time | concentric sets or matrix |
| Trace evidence | claim-to-artifact provenance | layered provenance map / traceability matrix | only one linear chain | rows for evidence layers, direct IDs |
| Show many-to-many relations | graph topology is genuinely the claim | constrained network / adjacency matrix | membership is enough | matrix first; graph only with encoded edge types |
| Show conservation / allocation | inputs, bounded transformations, outputs | accounting table, balance diagram, Sankey | values are not flow quantities | aligned ledgers; widths only for scale |
| Show hierarchy | parent-child nesting is decisive | tree / icicle | cross-links dominate | `forest` when installed; otherwise matrix/indented tree |
| Locate values in space | location changes conclusion | map | map is decorative | geographic scale, legend, projection declaration |

## The professional selection test

Before committing to a grammar, ask four questions:

1. **Expressive:** can every necessary distinction be encoded without inventing
   a false one? A graph where all nodes look equal fails if roles differ.
2. **Effective:** will the critical comparison use position/length before
   area, angle, saturation, or a legend lookup?
3. **Economical:** can a reader answer the question without traversing long,
   crossing paths or re-reading prose?
4. **Auditable:** are units, boundaries, actor choices, and evidence paths
   visible enough to challenge the conclusion?

## Diagram-specific rejection rules

- A *set/subset* claim is usually a containment diagram or matrix, not a graph.
- A *serialisation/concurrency* claim is a schedule with aligned time, not five
  circles converging on a box.
- An *authority* claim needs different shapes/lanes for author, actor,
  witness, and subject. Homogeneous circles erase the argument.
- A *security control* claim needs a before/after trace with the contested
  input, trusted policy source, and accept/reject outcome visible.
- A *failure cascade* needs causal rungs and countermeasures in paired columns,
  not prose boxes connected by decorative arrows.

