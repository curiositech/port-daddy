# Semantic Figure Atlas

This atlas translates the whitepaper figure inventory into the smallest truthful visual form.
It applies Mackinlay's expressiveness-before-effectiveness principle: choose a form that can say
the intended relation, then optimize its perceptual reading. Cleveland and McGill's findings
support position on a common scale over area, angle, or shading for quantity. For graphs, keep
node-link diagrams small and path-oriented; dense graphs require a matrix or a reduced relation.

## Figure prescriptions

| Figure | Claim | Best representation | Pictographic cue |
|---|---|---|---|
| I.4 four questions | Ordered admission procedure | vertical gated decision path | four small gates/checks |
| I.5 authority organs | One authority acts through six distinct organs | centered kernel plus aligned 2×3 organ matrix | ledger, lens, gate, fork, shield, beacon |
| I.6 forced zoom | Threshold changes error trade-offs | distribution plot with external legend bands | threshold line; no pictogram needed |
| I.8 split ranker | One candidate substrate serves two incompatible objectives | shared substrate splitting into two parallel scoring lanes | lattice splits into two heads |
| I.9 read surfaces | One durable record yields five reader-specific projections | source ledger branching to five aligned outputs | ledger plus five restrained role glyphs |
| I.10 compaction cascade | Failure compounds; each intervention can halt it | causal ladder with parallel countermeasure rail | falling stage markers / stop bars |
| I.11 roles | Scoped authority creates a readable action route | four-node directed institutional route | author seal, grant token, daemon core, group ring |
| II.1 stack map | Layered kernel architecture | layered stack / stratified cross-section | vertical seam/ledger spine |
| II.2 seven organs | Seven contracts compose the kernel | aligned organ matrix around a shared substrate | table, gate, clock, bus, witness, lock, ledger |
| II.3 single writer | Many callers serialize through one writer | converging queue into one commit spine | single illuminated write seam |
| II.4 durability by fault class | Different failures require different persistence | fault-class matrix with bounded guarantees | strata separated by fault boundary |
| II.5 claim lifecycle | Exclusive ownership state change | state machine | token enters/leaves a guarded state |
| II.6 acquire algorithm | One atomic insert decides a winner | compact sequence or annotated pseudocode, not a node graph | unique-key gate |
| II.7 communication organ | Carrier and speech-act semantics are layered | two-layer envelope with provenance rail | sealed message plus durable cursor |
| II.8 deontic split | Prohibition, obligation, and permission differ | three-column formal taxonomy | bar, promise, grant |
| II.9 reference monitor | Every effect passes a small complete mediator | request path through one mediation gate | narrow aperture |
| II.10 commitment oracle | Closure requires a current verifiable witness | state machine with oracle-bound terminal gate | witness seal at closure |
| II.11 closure algorithm | A finite oracle vocabulary governs done | decision path or annotated pseudocode | typed oracle token |
| II.12 continuity organs | Memory, checkpoint, continuity, identity, reputation form a dependency chain | layered dependency spine | linked witness seals |
| II.13 consistency model | Interleaving operations become one serial history | swimlane sequence | shared time rail |
| II.14 dual runtime | Two runtime bindings must satisfy one interface | mirrored conformance diagram | paired execution chambers |
| III continuity | Successive identity claims form a person | provenance chain / ledger timeline | linked witness seals |
| III tombstone revocation | A later revocation invalidates descendants | tree with a struck branch | revocation mark at ancestor |
| IV economy | Three asset types meet a bounded escrow | ternary flow map | three typed vectors into a core |
| V anchor protocol | Capabilities attenuate by delegation | nested-ring or narrowing funnel | concentric rights rings |
| VI commons | Independent evidence roots into a shared proof | Merkle tree / root graph | root, branch, witness leaf |
| VII federation | Sovereign systems exchange evidence without hierarchy | symmetric paired-endpoint diagram | two equal gates and a witness ledger |

## Research basis

- Mackinlay, *Automating the Design of Graphical Presentations of Relational
  Information* (1986): a visual form must first be expressive of the relation, then effective.
  [PDF](https://cs.calvin.edu/courses/info/601/refs/mackinlay1987.pdf)
- Cleveland and McGill, *Graphical Perception* (1984): position on a common scale is a stronger
  quantitative encoding than length, angle, area, or colour saturation. [Record](https://etd.ohiolink.edu/acprod/odb_etd/ws/send_file/send?accession=osu1753720136633193&disposition=inline)
- Ghoniem, Fekete, and Castagliola, *A Comparison of the Readability of Graphs Using Node-Link
  and Matrix-Based Representations* (2004): node-link is especially useful for path finding,
  while dense graphs beyond roughly twenty vertices favour matrices for many tasks.
  [DOI](https://doi.org/10.1109/INFVIS.2004.1)
- Dunne et al., *Readability Metric Feedback for Aiding Node-Link Visualization Designers* (2015):
  node-node overlap, edge crossings, angular resolution, group overlap, and coverage are
  measurable readability risks. [DOI](https://doi.org/10.1147/JRD.2015.2411412)
- Liu et al., *The Sprawlter Graph Readability Metric* (2020): clutter must account for the area
  and salience of overlaps, not just crossing counts. [Paper](https://www.cs.ubc.ca/labs/imager/tr/2020/sprawlter/)

## Compact layout test

At final print size, a reader should be able to answer in five seconds:

1. What is the focal entity or measure?
2. Which relation is directional, reciprocal, causal, or quantitative?
3. What changes, branches, or is selected?

If the answer requires reading more than three labels, reduce the figure before adding art.
