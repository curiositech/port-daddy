<!--
Provenance: Wave 11.3 figure audit, judged on the page, 2026-09-06.
Default verdict is "fails" — a figure earns a keep/restyle/redraw/table verdict
only by clearing the rubric below on its own page; everything else fails
until it does. Committed verbatim from the Wave 11 triage pass.
-->

# Figure triage — every figure judged on its page

Default verdict is FAIL. A figure earns *keep* only by passing all five rubric points
(one readable fact; concrete instance; anchored geometry; print contrast; no collisions)
on its page. Page role: carries / supports / decorates / interrupts.
Disposition: keep / restyle (keep the idea and layout, redraw only the mechanics) /
redraw (new drawing of the same idea, kind named) / table / delete / add.

Columns: figure · page's one idea · what the drawing actually encodes · role · disposition · kind and spec pointer.

## Chapter 1 — The Single-Writer Kernel (20 sites, 15 figures)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 1.1 | fig-swk-stack-map | the kernel sits under legibility and economy, above a machine floor | four labelled bands with tiny grey word lists; "this chapter" bracket | supports | **redraw** | *block diagram*, four rows, each row names its two or three artifacts in `\footnotesize`, the machine floor as one dark rule with its four dependencies named; no word soup |
| 1.2 | fig-swk-seven-organs | seven contracts, one commit history, three maturity grades | a score of dots on seven lines; nothing readable | decorates | **table** | 7 × (contract held · home table · maturity) booktabs table; one sentence for the single WAL history |
| 1.3 | fig-swk-single-writer | concurrent callers, one commit order, reply after commit | four invisible bands, a rail, a floating diamond | carries | **redraw** | *Gantt*: four caller bands with drawn edges, each band's right edge dropping to commit 1–4 on the writer rail, reply arrows back into the lane, second-writer boundary as a labelled dashed box |
| 1.4 | fig-swk-durability-faultclass | durability differs by fault class (process crash vs power loss) | two lines, one hatch, tiny labels | carries | **redraw** | *two-row regime strip*: x = fault class (process crash · OS crash · power loss), y = the two sync settings; each cell says "durable" or "may lose last commits" in words; the correction named in the caption |
| 1.5 | fig-swk-claim-lifecycle | FREE → HELD → EXPIRED with idempotent re-claim and TTL | a state machine with labels colliding with edges | carries | **restyle** | *state machine* (automata library): three states, four edges, labels on their own side of each edge, no crossing edges |
| 1.6 | fig-swk-comm-organ | bus and lineage are two provenance traces over one ordered log | two wavy lines and a boxed formula | decorates | **table** | a 2-column table (bus: what it guarantees; lineage: what it guarantees) plus the envelope fields as a `\code` row |
| 1.7 | fig-swk-deontic-split | prohibition, obligation and permission need three mechanisms | three timelines with hatched regions, labels on top of marks | carries | **redraw** | *three-row timeline* with one concrete rule per row (its text in the row label), the mechanism named at the point it acts (gate / oracle / grant), no hatch |
| 1.8 | fig-swk-reference-monitor | a mediator decides before the effect; a monitor observes after | two timelines, one gate mark | supports | **restyle** | keep two rows; label the exposure interval with its length in words; heavier marks |
| 1.9 | fig-swk-controllability-relation | bouncer at the door vs daemon at the boundary | two boxes with tiny lists | decorates | **delete** | the quadrant next to it (1.10) says it; keep the analogy in prose |
| 1.10 | fig-swk-controllability-quadrant | preventable iff controllable and witnessed at the boundary | 2 × 2 grid, tiny text, weak contrast | carries | **redraw** | *quadrant*: axes labelled in full sentences, one concrete event per cell in `\footnotesize`, the theorem's cell marked |
| 1.11 | fig-swk-commitment-oracle | closure only through a typed oracle; free text bounces | arrows through labels, two amber labels stacked | carries | **redraw** | *state machine*: OPEN → gate → DONE, four oracles as a stacked list feeding the gate, one rejected edge back to OPEN, deadline as its own small annotation |
| 1.12 | fig-swk-continuity-organs | evidence narrows down the continuity chain | a grey funnel with floating labels; caption struck by a bar | carries | **redraw** | *step chart*: x = six links, y = what the next link can inherit (full / notes only / partial / none) with the two narrowings labelled inside the plot |
| 1.13 | fig-swk-workunit-machine | the work-unit machine: proposed → … → settlement, with guards | dense boxed graph, `\tiny` guards | carries | **redraw** at full text width | *state machine* with 8 states in two columns, guards as numbered margin notes below the figure (a legend table), 536-state count in caption |
| 1.14 | fig-swk-consistency-model | overlapping operations, one linearization | three bands, one rail; the linearization written as a formula | carries | **restyle** | same *Gantt* kind as 1.3; drawn edges on bands; the resulting order as a labelled sequence under the rail |
| 1.15 | fig-swk-dual-runtime | test and deployment runtimes diverge unless tied by a harness | two zig-zag lines with hatch | decorates | **delete** | one sentence carries it; the invariant is stated in prose already |
| add | — | §1.4 single-writer: the reader has never seen the daemon refuse a second writer | — | — | **add** | *terminal session*: two `pd` clients, one claim, one refusal, the commit ids |
| add | — | §1.7 stigmergic decay: the worked example computes 0.9^t | — | — | **add** | *xy plot*: w(t) for r = 0.9 and 0.95 with the prune threshold as a rule; lifetimes 29 and 59 marked |
| add | — | §1.9 work-unit machine: the model-checked instance | — | — | **add** | *terminal session*: the checker's output for the 536 states and the shortest crimes |

## Chapter 2 — The Anchor Protocol (13 sites, 8 figures)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 2.1 | fig-anchor-four-phases | each phase closes an attack surface and none reopens | a staircase of four rails; labels `\tiny` | supports | **table** | 4 × (phase · mechanism · surface closed · stays closed because) table; the staircase says nothing the table does not |
| 2.2 | fig-anchor-capability-attenuation | a child capability must sit inside the parent's rights × lifetime box | nested rectangles with real numbers (5, 15, 60 min) | carries | **restyle** | keep; heavier edges, labels `\footnotesize`, the rejected re-grant drawn as a point outside with its coordinates |
| 2.3 | fig-anchor-alg-confusion | the verifier must choose the algorithm, not the token | a fork with two outcomes | carries | **redraw** | *sequence-style ladder*: token → verifier, two branches (header-selected vs policy-pinned), ACCEPT/REJECT as outcomes with the one differing check boxed |
| 2.4 | fig-anchor-delegation-inline | a signed chain of identities with fresh nonces and one task hash | four ids on a rail, a splice arc | carries | **restyle** | keep; labels bigger; the splice drawn as a broken link with the failing check named |
| 2.5 | fig-anchor-cuckoo-inline | revocation filters do not merge; the append-only log does | two rows of buckets and a set union | supports | **redraw** | *before/after pair*: left the two filters and the false "OR"; right the log union; each cell labelled with the id it holds |
| 2.6 | fig-anchor-revocation-gossip | revocation reaches all verifiers in two rounds; partitions void the deadline | five daemon rows converging | carries | **restyle** | keep; row labels `\footnotesize`; the amber interval labelled with Δ; partition marker with words |
| 2.7 | fig-anchor-card-lifecycle | a card is admissible on one interval; correction issues a new id | three rows with marks | supports | **restyle** | keep; label the interval endpoints t_r and t_0+τ on the axis; heavier rows |
| 2.8 | fig-anchor-verification-stack | obligations descend, evidence ascends, gaps need a human | two rails with tiny word lists | decorates | **table** | 3 × (layer · tool · what it shows · what it cannot show) table; the "gap" rows explicit |
| add | — | §2 handshake: the pairing ceremony | — | — | **add** | *sequence diagram* (pgf-umlsd): operator, daemon, verifier; the four messages with what each binds |
| add | — | §2 ProVerif: the v6 multi-hop attack | — | — | **add** | *terminal session*: the attack trace excerpt with the two hops named |

## Chapter 3 — The Sealed Harbor (10 sites, 5 figures)

Drawn in Wave 4 under figcheck; the best chapter. All five carry real numbers.

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 3.1 | fig-sealed-pillar-pipeline | two fences, two gates, four properties, four scripts | boxed flow with script names | carries | **keep** (restyle labels to `\footnotesize`) | — |
| 3.2 | fig-sealed-two-worlds | two runs identical except the secret; only the slot differs | two-run lockstep with ≡ marks | carries | **keep** | — |
| 3.3 | fig-sealed-mutant-grid | which mutant breaks which invariant, in how many steps | a 2 × 2 grid with caught/step counts | carries | **keep** | — |
| 3.4 | fig-sealed-composition-crossover | basic vs advanced bound cross at k = 32 | xy plot with the crossover labelled | carries | **keep** | — |
| 3.5 | fig-sealed-operating-curve | detection power vs canaries; expected run length under null and leak | xy plot + bar pair | carries | **keep** | — |

## Chapter 4 — The Legible Swarm (19 sites, 14 figures)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 4.1 | legible-swarm-stack-map | four strata; this chapter owns the operator surface | dot matrix, `\tiny` column heads at 45° | decorates | **table** | 4 × capabilities table with ● marks in `booktabs`; readable heads |
| 4.2 | legible-swarm-state-of-nature | four arrivals: unsequenced overlap vs consented serialization | two small panels, four bars, tiny labels | carries | **redraw** | *before/after Gantt pair* at full width: left panel with the overlap window shaded and labelled "4 valid writes overlap", right panel with the commit spine and the four grant records named |
| 4.3 | legible-swarm-zoom-vs-potemkin | a digest is a lens (every claim resolves to evidence) or a facade | two boxed summaries with arrows | carries | **redraw** | *two-column tree*: "PR 123: 3 claims" each with its evidence leaf named (diff, test id, commit) vs "ALL GREEN" with three dead-end leaves; the readable fact is which leaves exist |
| 4.4 | legible-swarm-four-questions | release needs four independent proofs | four icons on a rail | decorates | **table** | 4 × (question · proof required · artifact) table; the icons carry nothing |
| 4.5 | legible-swarm-authority-organs | six authority mechanisms cross one consent boundary via the recorded grant | six columns of `\tiny` words over a band | decorates | **table** | 6 × (mechanism · input · output · what the grant records) table |
| 4.6 | legible-swarm-specialization | Erlang-C specialization boundary g₄(ρ,3) and the worked point (ρ = .556, r = 2.5) | xy plot with a hatched region and a dashed proposal | carries | **restyle** | keep the plot; drop the hatch for a tinted region with an edge; label both axes with units; worked point with its coordinates in words |
| 4.7 | legible-swarm-sdt | the forced-zoom decision as signal detection: two densities and a criterion | two curves, labels colliding | carries | **redraw** | *xy plot* (pgfplots): two named densities, the criterion β as a vertical rule, miss and false-alarm areas tinted with edges and labelled in the margin of the plot; d′ stated |
| 4.8 | legible-swarm-abdication | operator attention falls along doer → approver → rubber-stamp → absent | a schematic curve labelled "hypothesis" | decorates | **delete** | a hypothesis without data is a sentence; the canary proposal stays in prose |
| 4.9 | legible-swarm-readpoverty | read cost O(n) vs O(log n); value of legibility rises with swarm size | two schematic panels | supports | **redraw** | one *xy plot* of measured read cost from the R1 script (real points: 12.77 vs 5.98 bits at N=60) instead of two sketched curves |
| 4.10 | legible-swarm-pushpull | push (self-declared) vs pull (independently addressable) evidence | two rows of hollow/filled marks | supports | **table** | 2 × 6 table of the evidence kinds with ○/● and the ranker's verdict |
| 4.11 | legible-swarm-split-ranker | discovery ranks fit; attention ranks regret; the two orders differ | a crossing-lines plot with A–D | carries | **restyle** | keep as a *slope chart*; label both axes as ranks 1–4; name what A and B are in the figure |
| 4.12 | legible-swarm-read-surfaces | five reader projections over one ledger | five dot rows over a spine | decorates | **table** | 5 × (reader · what it selects · what it never removes) table |
| 4.13 | legible-swarm-cascade | the context-degradation cascade: recoverable truth falls in four steps | a hand-drawn falling curve | decorates | **delete** | the four named stages are a list; the "curve" is not measured |
| 4.14 | legible-swarm-roles | operator authors, daemon acts, agents are the multitude | three rails with arcs | supports | **redraw** | *sequence diagram* (pgf-umlsd): operator → daemon (grant g), daemon → agents (gate / escalate), the override edge; one concrete grant named |
| add | — | §4 R1 information floor: 5.98 bits at N=60, k=2, m=8 | — | — | **add** | *xy plot* from `a7_experiment.py`: bits vs N for two digest designs, measured points |
| add | — | §4 the operator's day: what `pd` shows | — | — | **add** | *terminal session*: `pd status` for a six-agent fleet, one blocked claim, the drill-down to its evidence |

## Chapter 5 — From Spawn to Person (19 sites, 14 figures)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 5.1 | fig-stp-stack-map | evidence accumulates: daemon → protocol → legibility → continuity → reputation → market | a staircase of `\tiny` words | decorates | **delete** | the front matter's spine figure and the chapter's route paragraph say this |
| 5.2 | fig-stp-role-vs-person | a role is a slot; a person is a longitudinal record of witnessed outcomes | two rails: replaceable fillers vs one identity | carries | **restyle** | keep two rails; name three fillers and four outcomes with dates; labels `\footnotesize` |
| 5.3 | fig-stp-parfit-chain | continuity is an overlap chain of shared witnesses, transitive but local | three incarnations, two shared witnesses, one dashed counterexample | carries | **restyle** | keep; heavier overlap boxes with edges; the counterexample's failing check named |
| 5.4 | fig-stp-three-organs | what survives process death: episodic memory yes, checkpoint partial, outcome ledger partial | three rails with a crossed gap | carries | **redraw** | *table-like figure*: 3 rows × (survives death? · what is lost · maturity), or a plain table; the crossed gap becomes a cell |
| 5.5 | fig-stp-honest-state | the chapter's mechanisms on a built/partial/designed/vision axis | dot plot, `\tiny` labels, weak contrast | decorates | **table** | the maturity ledger already exists as a table in Limitations; delete the figure, cross-reference the table |
| 5.6 | fig-stp-sybil-whitewash | non-forgeable identity kills sanction evasion and quorum inflation | two schematic panels | supports | **redraw** | *two small xy panels* with real numbers from the R12 script (penalty retained vs respawns; quorum weight vs aliases), each with axes and units |
| 5.7 | fig-stp-keystone-split | log integrity crosses the trust boundary; accountable-principal binding does not | two-column rails with a crossed link | carries | **table** | 4 × (claim · inside the daemon · across the boundary) with ✓/✗ |
| 5.8 | fig-stp-estimator-family | pairwise, directed-trust and buyer-feedback estimators over one substrate | three tiny graphs and a bar chart | decorates | **delete** | the memo's cut: estimator catalogues out of the main text; one sentence remains |
| 5.9 | fig-stp-not-bandit | four ways public reputation is not a bandit | four micro-panels with `\tiny` text | decorates | **table** | 4 × (bandit assumption · why it breaks · what survives) |
| 5.10 | fig-stp-multidim-reputation | witnessed outcomes are vectors; buyers weight them differently | slope chart + weights | carries | **redraw** | *slope chart* with three axes and two outcomes, plus the two buyers' weights as a small table under it: A selected by one, B by the other, using the chapter's 0.78 number |
| 5.11 | fig-stp-judge-market | eligibility is established before the grade; the ledger records every step | a filter funnel over a timeline | supports | **redraw** | *state machine*: submit → filter → select → blind grade → ledger → re-audit, exclusions as labelled rejections |
| 5.12 | fig-stp-rate-the-raters | recursive auditing is finite only with corrupt opportunity contracting: G_k vs audit level | xy plot with two curves and an amber floor | carries | **restyle** | keep; log axis labelled; the two contraction cases named at the curves' ends; heavier lines |
| 5.13 | fig-stp-deterrence-regime | deterrence holds where ρ d B > G; worked point ρ = .25 at B = 50 | xy region plot (Wave 10, figcheck clean) | carries | **keep** | — |
| 5.14 | fig-stp-tombstone | a tombstone changes score consumption without rewriting history | append-only rail + a step function | carries | **restyle** | keep both panels; the step function's y axis labelled ("contribution to spendable reputation"), the window τ in words |
| add | — | §5 B6 probation cliff | — | — | **add** | *xy plot* from `b6_probation.py`: expected loss vs probation length with the cliff marked |
| add | — | §5 R12 copy-fork attack | — | — | **add** | *gitgraph-style DAG*: lineage with the mint attempt and the no-mint rule's refusal |

## Chapter 6 — The Harbor Economy (20 sites, 15 figures; four are shared with chapters 7 and 8)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 6.1 | fig-he-stack-map | the market is a load path over four implemented layers | a boxed ladder with `\tiny` italics | decorates | **delete** | route paragraph says it; the concordance table covers the layers |
| 6.2 | fig-he-three-sided | labor, capital and licensed IP each carry a distinct risk signature | three rails with bond kinds | carries | **restyle** | keep; row labels and bond names `\footnotesize`; the conservation identity set under the rails in words |
| 6.3 | fig-he-float-plan | no-spawn-without-bond: execution admissible only at one committed transition | three rows with an atomic boundary | carries | **redraw** | *sequence-style timeline*: wallet, escrow row, worker state; the commit as one vertical rule; abort path as a dashed return; every transition labelled with its SQL-level effect |
| 6.4 | fig-he-keystone-split | visibility crosses the boundary; accountable-principal binding does not | duplicate of 5.7 (same idea) | supports | **table** (shared with 5.7) | one table used in both chapters, or drop here and cross-reference ch. 5 |
| 6.5 | fig-he-conservation-functor | native units conserve exactly; conversion introduces priced terms | two bar panels | carries | **redraw** | *waterfall bars* (pgfplots ybar) with the chapter's numbers: ΔW, ΔE, ΔC summing to 0; then fee, slippage, risk as priced terms; axis in the unit |
| 6.6 | fig-fh-xfer-ceremony (shared with 8.3) | the transfer ceremony attenuates authority: C_B′ ⊆ C_A | a narrowing envelope over four steps; labels collide | carries | **redraw** | *sequence diagram*: Harbor A, Harbor B, verifier; four messages; the envelope replaced by the capability set printed at each hop |
| 6.7 | fig-fh-federation-topology (shared with 8.1) | four federation rails between two sovereign roots | four labelled rails between two columns; `\tiny` | supports | **table** | 4 × (rail · what crosses · what never crosses · assurance mode) |
| 6.8 | fig-fh-settlement (shared with 8.6) | custody bound holds only with exactly one terminal transition | two small state diagrams A/B | carries | **keep** (labels `\footnotesize`) | — |
| 6.9 | fig-fh-revocation-gossip (shared with 8.4) | the spendable revocation window is Δ to 2Δ | staircase with amber region | carries | **keep** (already clean; region now edged by the style change) | — |
| 6.10 | fig-fh-threat-bands (shared with 8.2) | assurance position per threat: open → conditional → mechanized | dot-and-interval rows | carries | **restyle** | keep as a *dot plot*; axis ticks for the three positions; labels `\footnotesize`; the thick settlement interval explained on the axis |
| 6.11 | fig-he-grading-oracle | evaluation mechanisms lie on a frontier of observability vs capture risk | three points on a sketched frontier | decorates | **delete** | schematic with no data; the three mechanisms become a 3-row table in prose |
| 6.12 | fig-he-cold-start | subsidy regime switches at the depth trigger λ*, not at a date | two stacked panels | carries | **restyle** | keep; both panels' axes labelled with units; λ* marked on both; `\footnotesize` |
| 6.13 | fig-auction-inline (shared with 7.4) | static escrow and competitive underwriting on a reserve-adequacy frontier | a sketched frontier with two points | decorates | **delete** | "coordinates are schematic" in its own caption: a sentence, not a figure |
| 6.14 | fig-cartel-game-inline (shared with 7.6) | cartel sustainability boundary V_C = π_D in (detection, loss) | region plot with formula | carries | **restyle** | keep as an *xy region*; axes with ranges; the two regimes named; formula moved to the caption |
| 6.15 | fig-he-assurance | each independent reviewer multiplies residual risk down | xy line with points k=1..5 | carries | **keep** (labels bigger) | — |
| add | — | §6 R15 succession price D* = ηK/(1−ηK) | — | — | **add** | *xy plot* of D* against ηK with the worked point |
| add | — | §6 Myerson–Satterthwaite example | — | — | **add** | *worked example* with a 2 × 2 payoff table (no figure) |

## Chapter 7 — The Bonded Commons (14 sites, 9 figures)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 7.1 | fig-bonded-three-layer | three layers answer three questions about one attempted act | three rails with tiny caps labels | carries | **table** | 3 × (layer · question · terminal outcome) with the three outcomes in words |
| 7.2 | fig-bonded-sen-regime | governance choice is a loss frontier over private information | two sketched curves crossing | decorates | **delete** | conceptual curves; the design boundary x* is a sentence |
| 7.3 | fig-governance-flow | dispute resolution escalates only when the cheaper exit fails | a staircase of four steps | supports | **redraw** | *state machine* with four states (released · expired · preempted · ruled) and the guard on each edge; the evidence rail as the shared terminal |
| 7.4 | fig-auction-inline | shared with 6.13 | — | — | **delete** | — |
| 7.5 | fig-sybil-inline | deposit-only Sybil deterrence saturates at s = min(B_dep, B_T) | a principal with K identities + a kinked line | carries | **restyle** | keep only the *xy panel*: s against B_dep with the knee at B_T labelled; drop the identity cartoon |
| 7.6 | fig-cartel-game-inline | shared with 6.14 | — | — | **restyle** (one source) | — |
| 7.7 | fig-bonded-key-custody | four minimal compromise sets, one conjunction | four small cut-set diagrams | carries | **keep** (labels `\footnotesize`; drop diamonds for text "AND") | — |
| 7.8 | fig-magic-link-inline | single-use redemption is one durable state edge | two consumers, one atomic drain | carries | **redraw** | *sequence diagram* with the SQL statement as the shared step; success and reject as the two returns |
| 7.9 | fig-worked-example | a crash at minute 12 breaks the process, not the evidence or escrow | three rows on a minute axis | carries | **restyle** | keep; minute axis with ticks; row labels `\footnotesize`; the salvage-parent edge labelled |
| add | — | §7 δ* by hand and by machine | — | — | **add** | *xy plot*: the cubic 2δ³+2δ²+2δ−1 with its root at 0.3425, plus a *terminal session* of TLC at DeltaNum 35 and 33 |
| add | — | §7 bond ledger conservation | — | — | **add** | *terminal session*: TLC state count from the conservation run |

## Chapter 8 — The Federated Harbor (11 sites, 6 figures)

| # | fragment | page's idea | what is drawn | role | disposition | new kind / spec |
|---|---|---|---|---|---|---|
| 8.1 | fig-fh-federation-topology | see 6.7 | — | — | **table** | one source |
| 8.2 | fig-fh-threat-bands | see 6.10 | — | — | **restyle** | — |
| 8.3 | fig-fh-xfer-ceremony | see 6.6 | — | — | **redraw** | — |
| 8.4 | fig-fh-revocation-gossip | see 6.9 | — | — | **keep** | — |
| 8.5 | fig-fh-revocation-regime | which bound binds a stale card: partition bound vs delivery level vs TTL | xy region with the TTL line | carries | **keep** | — |
| 8.6 | fig-fh-settlement | see 6.8 | — | — | **keep** | — |
| add | — | §8 R6 consistency radius: C₆ r = 1.2247 vs P₆ 0 | — | — | **add** | *cycle-vs-cut pair*: the two six-node graphs with the radius under each |
| add | — | §8 CardRevocation.tla rollback config fails by design | — | — | **add** | *terminal session*: the rollback trace |

## Totals

| disposition | count |
|---|---|
| keep | 14 (ch3 ×5, 5.13, 6.8, 6.9, 6.15, 7.7, 8.4, 8.5, 8.6, 2 shared) |
| restyle | 17 |
| redraw | 22 |
| table | 15 |
| delete | 11 |
| add | 18 (8 plots, 8 terminal sessions, 2 diagrams) |

Shared figures (6.6/8.3, 6.7/8.1, 6.8/8.6, 6.9/8.4, 6.10/8.2, 6.13/7.4, 6.14/7.6, 5.7/6.4) are drawn once; the second chapter cross-references or reuses the one source.


## Atlas reconciliation (chapter 1)

The semantic atlas (`skills/whitepaper-figure-system/references/semantic-figure-atlas.md`)
prescribes a grammar per canonical figure. Where the triage departs from it, the
rationale, and the row change that follows:

| figure | atlas grammar | triage | rationale |
|---|---|---|---|
| 1.2 seven organs | aligned contract matrix around a shared state spine | table | the matrix's readable content is seven rows × three facts; a `booktabs` table is the aligned matrix without the spine ornament; row removed from the atlas, table recorded as its replacement |
| 1.6 comm organ | layered envelope with provenance rail | table | the envelope's fields are words; the two provenance traces are two rows of a table; row removed |
| 1.7 deontic split | three-column formal taxonomy (trigger · enforcement · success/failure · example) | **changed to a table**, per the atlas | the atlas is right: the three mechanisms are a taxonomy, not a timeline; the spec's timeline is withdrawn and the author writes the table |
| 1.9 controllability relation | (relation map) | delete | the quadrant carries the theorem's content; row removed |
| 1.12 continuity organs | layered dependency spine | step chart | the dependency direction is preserved as the x order; the step chart adds what the spine cannot show, how much the next link inherits; row updated |
| 1.15 dual runtime | mirrored conformance diagram | delete | with no harness built the diagram would draw a promise; the sentence stays; row removed until the harness exists |
| new: marker decay | — | add | `II/fig:swk-marker-decay`: measured-quantity plot; row added |
| new: sessions | — | add | terminal sessions are listings, not figure environments; no atlas row |
