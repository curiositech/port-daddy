# Semantic Figure Atlas: Volumes I--VII

This atlas is the semantic source of truth for every canonical figure environment in the seven
Port Daddy whitepapers. It chooses the smallest professional visual form that can express each
claim. It does not prescribe decoration, and it does not permit the paper's Harbor terminology
to turn into maritime, pirate, parchment, antique-book, fantasy, or scenic explanatory art.

The stable identifier is `<volume>/<TeX label>`, not the printed figure number. Printed numbers
move as the papers evolve; labels are the durable contract. Two Volume II algorithm exhibits are
included because their listings live inside `figure` environments.

## How to read a prescription

| Field | Meaning |
|---|---|
| Reader question | The question a reader should answer from geometry in about five seconds. |
| First-choice grammar | The default representation. Deviate only when a written figure brief explains why. |
| Must encode | The marks or relations without which the figure would become decorative or misleading. |
| Reject | Known-bad forms for this claim, including forms already observed to fail in the papers. |

## Representation families

### Quantitative comparison

Use position on a common scale, followed by aligned length, before angle, area, saturation, or
volume. Show uncertainty as intervals or bands. Use small multiples when two measures need
different scales but must be compared by regime or treatment.

### Threshold and phase boundary

Use explicit axes, a source-owned boundary, and labeled regions. Labels live in clear areas or
outside the plot. If an approximation differs from the exact boundary, show both and shade the
resulting error regions.

### Time, concurrency, and protocol

Use a shared horizontal time axis. Schedules show occupied intervals; swimlanes show actors and
messages; epoch columns show state at sampled times. Membership diagrams do not encode order.

### State and lifecycle

Use a small state machine with typed transitions, guards, and visibly distinct terminal states.
Avoid process boxes when the claim concerns legal admissibility or state reachability.

### Provenance and evidence

Use a chain, ledger, tree, or evidence matrix. A branch means descent, not merely association. A
missing binding should appear as a missing or explicitly broken relation, never as atmospheric
distance between boxes.

### Scope and containment

Use nested sets, interval bands, or a rights matrix. Do not imply magnitude through circle area
unless magnitude is measured. Pair nesting with a textual rights/TTL table when the sets are too
abstract to explain themselves.

### Allocation, conservation, and incentives

Use accounting flows, payoff or regime plots, cost intervals, or conservation equations aligned
to the corresponding paths. Width may encode conserved quantity only when it is actually
proportional. Decorative seesaws, circles, or black bars are not economic diagrams.

Choose the economic grammar from the reader's question, not from the presence of money words:

| Reader question | First-choice grammar | Required geometry | Reject |
|---|---|---|---|
| What enters, is held, and leaves? | typed journal or stock--flow ledger | distinct inflow classes; one custody or settlement boundary; exhaustive terminal outflows; aligned conservation equation | coins, wallets, or currency symbols standing in for accounts |
| Who can authorize, hold, redirect, or refuse value? | escrow/custody boundary with actor swimlanes | principals; custodian; authorization path; evidence path; permitted terminal outcomes; explicitly impossible redirection path | generic central bank node; arrows whose custody semantics are unlabeled |
| When is capital tied up, paid, released, or exposed? | common-scale interval comparison or cash-flow timeline | shared horizon; reservation interval; premium/payment event; release event; retained tail; idle-capital interval | black bars over labels; timelines with incomparable scales |
| How does risk change as assurance is purchased? | paired residual-risk and cumulative-cost curves | common intervention count; risk decay; marginal or cumulative cost; operating region; dependence assumption | shrinking rectangles; a slogan box containing the conclusion |
| Where does a market or policy change regime? | threshold/phase-boundary plot | source-owned axes; measured or assumed boundary; labeled regimes; uncertainty or approximation error | a yes/no badge; equation floating above an unrelated sketch |
| Which strategy dominates under which conditions? | payoff frontier, response surface, or aligned payoff table | strategies; state/parameter axes; payoff difference or dominance relation; tie/boundary; detection or enforcement term | seesaw; trophy; larger circle implying a better payoff |
| How do losses, reserves, and tail exposure partition? | stacked exposure ledger or aligned small multiples | expected loss; reserve; premium; uncovered tail; same denominator and horizon | pie charts without measured shares; shield or danger icons |
| How does allocation respond to price or scarcity? | supply/demand, auction allocation, or rank-order plot | bids/offers or quantities; clearing rule; rejected region; price or scarcity axis; allocation outcome | gavel scene; bidder avatars; decorative token stream |

#### Economic typography and color contract

- Put monetary units and time horizons in axis titles, column heads, or a single aligned note; do
  not repeat them inside every mark.
- Align equations to the path or ledger row they explain. An equation detached from its marks is
  prose with a border, not a figure.
- Use teal for verified, conserved, cleared, or admitted value; amber for conditional, exposed,
  delayed, or residual value; neutral ink for ordinary state. Cobalt is not the default money
  color and must never be used as an untyped emphasis wash.
- A Sankey width is allowed only when the source supplies proportional quantities. Otherwise use
  equal-width typed paths and label the accounting identity explicitly.
- Show uncertainty, censoring, or simulation error as intervals, bands, or distributions. Never
  smuggle uncertainty into blur, transparency, decorative noise, or an unexplained gradient.

### Architecture, institutions, and roles

Use layered stacks for strata, symmetric endpoints for peers, and differentiated shapes for
principal, authority, artifact, witness, boundary, and decision. Generic homogeneous nodes hide
the claim. Radial "organs" and sand-dollar rings are forbidden unless radial order itself is data.

## Volume I: The Legible Swarm

Canonical root: `whitepaper/legible-swarm.tex` (14 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `I/fig:stack-map` | Which L0--L3 layers does legibility own or cross-cut, and what does it assume and provide? | four-rung coordination stack using the shared stack contract | L0--L3; one whom per rung; I highlighted across L2 plus the L1 directory substrate; assumes/provides direction; chapter numbers are not layer numbers | decorative tower; radial stack; seven-volume ladder; prose boxes |
| `I/fig:state-of-nature` | How does consent change concurrent writes into a legible order? | aligned before/after schedules on the same time scale | overlapping writer intervals; collision window; ordered queue; one commit spine; audit fields | actor bubbles around an artifact; membership graph; free-form arrows |
| `I/fig:zoom-vs-potemkin` | Can each summary claim reach reviewable evidence? | aligned two-panel evidence-reachability comparison | identical summary surfaces; total zoom paths on left; opaque boundary and unreachable evidence on right | twisted arrows; paragraph boxes; scenic lens/facade art |
| `I/fig:four-questions` | Which four checks must pass before a read-surface ships? | compact ordered gate path with one terminal disposition | four questions in order; obligation bound by each; fail/hold versus ship outcome | parchment checklist; voyage path; giant flowchart |
| `I/fig:authority-organs` | Which six distinct mechanisms let authority act? | aligned 2-by-3 organ matrix connected to one shared authority substrate | six nonhomogeneous roles; inputs/outputs; common authority boundary | hub-and-spoke prose nodes; decorative organs; identical boxes with arrows |
| `I/fig:specialization` | When does a sole specialist beat a pooled service, and where does a shortcut err? | phase-boundary plot | labeled axes; exact boundary; approximate boundary; two error regions; winning regimes | yes/no slogan; unscaled curve; legend covering plot |
| `I/fig:sdt` | How does the forced-zoom threshold trade misses against false alarms? | two-distribution decision plot | axes; safe/dangerous distributions; criterion; miss and false-alarm regions; separation; cost asymmetry outside data field | text over curves; callouts inside peaks; decorative icons |
| `I/fig:abdication` | How does operator awareness decline with autonomy, and how can a canary arrest rather than reverse that decline? | schematic role-aligned trajectory with an arrested-baseline comparison | autonomy x-axis; situation-awareness y-axis; doer/approver/rubber-stamp/absent stations; unaided slide; canary onset; stabilized/arrested trajectory; explicit unmeasured-schematic limitation | intervention resets; recovery to the old role; measured-looking precision; role boxes beneath an unrelated curve |
| `I/fig:readpoverty` | How does indexed lookup scale against eyeball search, and when does the L2 wedge begin paying? | two aligned population-scale panels: search cost and L2 value | shared swarm-size logic; O(n) eyeball and O(log n) index curves; nonzero value at n=1; approximately n=50 discovery bottleneck; distinct y-axes and panel titles | cumulative time curves; shaded backlog gap; funnel metaphor; unscaled piles; prose-only warning |
| `I/fig:pushpull` | Why should evidence weight pull attention instead of agent claims pushing it? | paired provenance lanes or aligned evidence-weight comparison | same candidates; claim source; independent evidence source; selection rule; resulting ranking difference | arrows converging on one unlabeled node; magnets/ropes as metaphor |
| `I/fig:split-ranker` | How can one substrate support two incompatible rankings? | shared substrate splitting into two aligned scoring lanes or paired ranked lists | same candidate pool; shared decay; discovery objective; regret objective; reversed example ordering | homogeneous node diagram; telescope/lantern/chart art; one weighted score |
| `I/fig:read-surfaces` | How does one durable trajectory produce five reader-specific projections? | source ledger feeding five aligned projection records | one raw source; five transformations; named reader and output for each; retained zoom path | antique book; ship's log; five scenic objects; crossing spaghetti |
| `I/fig:cascade` | How do context failures compound, and where can each remedy break the chain? | causal ladder with a parallel countermeasure rail | ordered failure stages; causal links; one remedy per stage; load-bearing intervention | two columns of prose boxes; ambiguous bottom arrow; decorative waterfall |
| `I/fig:roles` | What grants authority, who exercises it, who is governed, and how is override returned? | differentiated institutional route | operator/principal; scoped grant; authority/actor; multitude; enforcement; legibility; revocation/override; mutual covenant | sand-dollar ring; stacked ovals; anonymous hierarchy; reciprocal arrows without labels |

## Volume II: The Single-Writer Kernel

Canonical root: `whitepaper/single-writer-kernel.tex` (9 graphical figures, 2 recorded terminal
sessions set as listings, and 2 algorithm exhibits). The seven-organs, communication-organ and
deontic-split exhibits are tables in the chapter (round 4, 2026-09-06); the bouncer sketch and the
dual-runtime mirror were cut with a written rationale in the figure triage.

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `II/fig:swk-stack-map` | Which L0--L3 layers does the kernel own, and what machine floor does it assume? | four-rung coordination stack plus machine-floor band using the shared stack contract | L0--L3; machine floor; II highlighted on all L0 and the implemented carrier half of L1; layer API direction; chapter numbers are not layer numbers | seven-paper layers; ornamental tower; perspective architecture |
| `II/fig:swk-single-writer` | How do many callers become one serial commit history? | converging request queue into one commit spine | concurrent callers; queue order; exactly one active writer; durable outcomes | many arrows into a database icon; unlabeled central box |
| `II/fig:swk-durability-faultclass` | Which persistence guarantee answers which fault class? | fault-class-by-guarantee matrix | process, machine, storage, and recovery fault classes; guarantee boundary; unsupported cells | ladder without axes; decorative shields |
| `II/fig:swk-claim-lifecycle` | Which states can an exclusive claim enter, and how does it leave? | compact state machine | admissible states; acquisition guard; expiry/release/revoke transitions; terminal outcomes | generic flowchart; lifecycle circle with no guards |
| `II/alg:acquire` | Which atomic decision selects the single winner? | annotated pseudocode with a short transaction sequence | unique-key insert; competing callers; commit/constraint outcome; no race gap | node graph; source code shrunk below print size |
| `II/fig:swk-reference-monitor` | Does every effect pass through a small complete mediator? | effect path through one narrow mediation gate | all request origins; reference monitor; allowed/denied branches; audited effect | broad hub; firewall clip art; hidden bypass paths |
| `II/fig:swk-commitment-oracle` | What evidence permits a commitment to close? | state machine with oracle-gated terminal transition | open state; candidate evidence; typed oracle; close/refuse outcomes; freshness | sequence of prose boxes; magic checkmark |
| `II/alg:close` | How does a finite oracle vocabulary decide closure? | annotated pseudocode plus decision table | allowed oracle types; validation order; terminal result; failure behavior | node graph; untyped decision diamond chain |
| `II/fig:swk-continuity-organs` | How do memory, checkpoint, identity, continuity, and reputation depend on one another? | layered dependency spine | dependency direction; durable artifacts; identity anchor; computed reputation | organic anatomy; equal boxes with crossing arrows |
| `II/fig:swk-consistency-model` | How do interleaved operations map to a serial history? | swimlane sequence with serialization points | actors; operation intervals; linearization/commit points; resulting total order | set diagram; before/after node clouds |
| `II/fig:swk-marker-decay` | How long does a stigmergic marker live under exponential decay before the prune threshold removes it? | measured-quantity plot: weight against ticks for two decay rates with the threshold as a rule and the two lifetimes marked | the two rates; the prune threshold; the tick at which each curve crosses it (29 and 59) | unlabeled decay sketch; a curve without the threshold; a table of two numbers pretending to be a figure |

## Volume III: From Spawn to Person

Canonical root: `website-v2/public/whitepaper/spawn-to-person.tex` (13 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `III/fig:stack` | How does continuity bridge a legible L2 person into an L3 reputation? | four-rung coordination stack with a highlighted bridge band using the shared stack contract | L0--L3; L2-to-L3 bridge; continuity-to-reputation transition; dependency direction; honest-state tags | seven-volume stack; decorative body/tower; chapter art |
| `III/fig:role-person` | What differs between a temporary role and a continuous person? | aligned attribute comparison | same comparison fields; role lifetime; evidence continuity; accountability; revocation | two portraits; Venn diagram; prose cards |
| `III/fig:parfit` | How can overlapping episodes create continuity without a permanent substrate? | interval/provenance chain | episode intervals; overlap evidence; transitive continuity relation; gaps | snake/ribbon art; unlabeled chain of circles |
| `III/fig:organs` | Which three mechanisms make continuity operational? | aligned three-column dependency row | mechanism; input artifact; persistence rule; output identity evidence | anatomical organs; three equal bubbles |
| `III/fig:honest-state` | What evidence supports each maturity claim? | evidence/status matrix | maturity stages; required witnesses; established/proposed/missing status; no inferred completion | roadmap timeline without evidence; all-green dashboard |
| `III/fig:sybil` | Why does minted identity resist Sybil and whitewash attacks? | paired threat trace | self-asserted path; minted-root path; reset/whitewash attempt; blocked boundary; surviving evidence | crowd of identical avatars; shield clip art |
| `III/fig:keystone` | What is proven locally, and what binding is still missing across operators? | two-column evidence matrix with an explicit missing bridge | local keys; registry; log integrity; accountable principal binding; cross-operator gap | blue-tinted spreadsheet everywhere; two trust-domain boxes with tiny circles |
| `III/fig:estimators` | Which signal type calls for which estimator family? | decision matrix | signal properties; estimator families; assumptions; invalid combinations | flowchart of model names; decorative equations |
| `III/fig:not-bandit` | Which bandit assumptions fail in this identity/reputation setting? | aligned assumption audit | assumption; bandit requirement; observed condition; consequence | crossed-out slot-machine art; paragraph list in boxes |
| `III/fig:multidim` | How does quality differ across dimensions rather than collapse to one score? | aligned dot profile or small-multiple bars | dimensions on common rows; multiple persons/agents; uncertainty if measured; no total score | radar chart; area-filled polygon; single average badge |
| `III/fig:judge-market` | How is a neutral judge selected, informed, and paid? | actor swimlane sequence | parties; judge selection; evidence reveal; decision; payment/slash; audit trail | marketplace network graph; central judge circle |
| `III/fig:rate-raters` | Why does recursive evaluator audit terminate, and what assumption remains open? | recursive contraction tower with a theorem/conditions panel | work, judge, re-auditor, and next level; per-level deterrence rho d B >= G_k; contraction lambda = 1-rho d; logarithmic finite depth; sealed sampling premise; missing exogenously honest root and telemetry caveat | two-tier loop; infinite spiral; self-looping bubbles; termination asserted without inequality |
| `III/fig:tombstone` | How does revoking an ancestor invalidate descendants? | provenance tree with struck ancestor branch | delegation ancestry; revocation point; affected descendants; unaffected siblings; time/order | cemetery/tombstone art; flat list of revoked IDs |

## Volume IV: The Harbor Economy

Canonical root: `website-v2/public/whitepaper/harbor-economy.tex` (15 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `IV/fig:he-stack-map` | What does the L3 economy consume from L0--L2, and what makes its participants different? | four-rung coordination stack with L3 highlighted using the shared stack contract | L0--L3; IV owns L3; consumed bond ledger, authorization chain, and legible person; plural mutually distrusting participants; chapter numbers are not layer numbers | seven-volume stack; decorative market arena; chapter art |
| `IV/fig:he-three-sided` | How do labor, capital, and licensed IP enter and leave one conserving escrow? | typed accounting-flow junction | three distinct exposure records; serialized escrow turn; release/refund/bounded slash; conservation equation | three circles around escrow; overly blue Sankey; overlapping band labels |
| `IV/fig:he-float-plan` | What ceremony creates an executable, funded plan? | three-step actor swimlane | request/terms; atomic ledger turn; signed execution; point before which no execution state exists | boxes with an unexplained blue rectangle; generic horizontal flow |
| `IV/fig:he-keystone-split` | Which identity guarantees hold locally but fail across operators? | trust-boundary evidence matrix or explicit bridge-gap diagram | two local roots; accountable principals; observable keys/logs; missing foreign binding | tiny identity circles; decorative keystone; ambiguous dotted bridge |
| `IV/fig:he-conservation-functor` | What is conserved within a unit, and where does cross-currency exposure enter? | paired accounting panels with aligned equations | same transaction in both domains; conservation terms; exchange/exposure mapping; nonconserved risk | abstract commutative diagram without accounting labels; ornamental currencies |
| `IV/fig:fh-xfer` | Which four messages transfer capability without transferring root authority? | four-message swimlane sequence | equal harbors; offer/request/attestation/receipt order; signatures; retained roots | symmetric node graph; curved arrow tangle |
| `IV/fig:fh-topology` | How do two sovereign harbors share witness and bounded settlement without hierarchy? | symmetric paired-endpoint architecture | equal endpoints; witness log; escrow; publish, transfer, gossip, and settlement relations; direction and custody limits | one central sovereign; four prose boxes; decorative harbor/space art |
| `IV/fig:fh-settlement` | How do bond, claim, verification, and clear/refuse outcomes compose? | settlement swimlane plus outcome partition | principals; escrow; evidence/oracle; custody assumption; clear/refuse terminal outcomes | top-down boxes with unclear ownership; note box larger than protocol |
| `IV/fig:fh-revocation` | How does revocation spread over epochs and become auditable? | aligned epoch columns with state cells and a witness rail | t=0, delta, 2-delta; A/B/C state; gossip steps; root publication; convergence assumption | labels on arrows; overlapping state boxes; generic network animation still |
| `IV/fig:fh-threat-bands` | Which threat bands require which assurance mechanisms? | assurance matrix or banded ledger | threat class; local/federated boundary; mechanism; residual risk; established/proposed status | decorative shield bands; undifferentiated checklist |
| `IV/fig:he-grading-oracle` | When can a grader strategically capture the public signal, and what constrains it? | causal influence diagram with deterministic and bonded branches | action; evaluator information; discretion; signal; payoff/capture path; audit/bond countermeasure | three-node triangle; evaluator boxes with no influence direction |
| `IV/fig:he-cold-start` | When should subsidies end without triggering an empty-market trap? | threshold/regime plot | measured liquidity axis; adoption/supply response; threshold; subsidized and priced regimes; transition assumption | calendar timeline; unlabeled rising curve; prose at plot edge |
| `IV/fig:auction-inline` | How do static escrow and competitive underwriting differ in idle capital and tail risk? | aligned financing-cost intervals or small multiples | coverage horizon; capital reserved; premium; tail retained; comparable scale | black bar covering its label; blue legend swatch; decorative auction scene |
| `IV/fig:cartel-game-inline` | Under which parameters is collusion sustainable? | payoff inequality plus phase/regime plot | collusive stream; detection probability; loss; discounting; deviation payoff; sustainable boundary | decorative seesaw; five blue ticks with no scale; equation floating alone |
| `IV/fig:he-assurance` | How does independent review reduce residual risk while cost grows? | paired residual-risk and cumulative-cost curves | reviewer count; geometric risk decay; linear cost; independence assumption; chosen operating region | unlabeled shrinking rectangles; blue arrows; assurance slogan box |

## Volume V: The Anchor Protocol

Canonical root: `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex` (8 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `V/fig:anchor-four-phases` | Which attack surface does each cumulative protocol phase close? | staircase or cumulative barrier matrix | four phases; preserved prior checks; newly closed threat; remaining exposure | diagonal floating boxes; tall blue barriers with stray labels |
| `V/fig:anchor-capability-attenuation` | How do rights and TTL strictly shrink across delegation? | nested sets paired with a rights/TTL table | root and child capabilities; strict subset relations; TTL decrease; attempted re-grant rejection | unexplained concentric circles; blue outline as sole meaning |
| `V/fig:anchor-alg-confusion` | Why does issuer-pinned verification reject a token that attacker-selected verification accepts? | aligned paired security trace or comparison table | identical token bytes; control authority; algorithm source; verification trace; accept/reject outcome | two prose flows; giant arrows; colour-only safe/unsafe distinction |
| `V/fig:anchor-delegation-inline` | What evidence travels with a multi-hop delegated capability? | linear provenance/sequence chain | issuer and delegates; signed tuple; attenuation at each hop; freshness/TTL; verifier checks | looping chain; decorative keys; unreadable token blob |
| `V/fig:anchor-cuckoo-inline` | How do two candidate buckets bound load and failure? | bucket schematic plus load-threshold plot | two candidate locations; occupancy; relocation or failure; measured load ceiling; probability/assumption | bird metaphor; boxes without capacity scale |
| `V/fig:anchor-revocation-gossip` | How quickly does a revocation reach all participants under stated assumptions? | epoch timeline or small-multiple spread map | initial revoked node; rounds; informed count/state; network assumptions; convergence bound | dense node hairball; overlapping labels; decorative epidemic arrows |
| `V/fig:anchor-card-lifecycle` | What are the only valid exits from an active card? | small state machine | issued/active states; expiry; revoke; invalid/rejected terminal state; guards | circular lifecycle infographic; ambiguous return arrows |
| `V/fig:anchor-verification-stack` | Which proof layers are mechanized, and where do human bridges remain? | layered assurance stack with explicit bridge gaps | three proof layers; machine checks; human judgment points; trust assumptions; evidence flow | all-green stack; tiny prose callouts; decorative lock tower |

## Volume VI: The Bonded Commons

Canonical root: `website-v2/public/whitepaper/agent-transactions-whitepaper.tex` (12 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `VI/fig:pareto-mc-inline` | How does the empirical Pareto criterion change with noise and insurer count? | two aligned quantitative plots with uncertainty | shared treatments; axes and units; Monte Carlo uncertainty; feasible/Pareto region | prose table alone; differently scaled panels without warning |
| `VI/fig:sybil-mc-inline` | How do deposit size and coverage affect attacker profit and commons deficit? | aligned profit/deficit curves | deposit or coverage axis; attacker profit; commons deficit; threshold; uncertainty/simulation assumptions | avatar swarm; unscaled risk icons |
| `VI/fig:cartel-folk` | Where is cartel cooperation sustainable, and how long until detection? | phase heatmap plus aligned rounds-to-detection plot | detection probability; discount factor; sustainable boundary; detection time; parameter assumptions | four prose quadrants; decorative cartel network |
| `VI/fig:bonded-three-layer` | Which hazards are prevented, evidenced, or priced by each layer? | three-layer architecture with typed paths | capability layer; evidence layer; collateral layer; prevented versus priced failures; cross-layer dependency | generic stack with no failure mapping; fortress art |
| `VI/fig:bonded-sen-regime` | How do private allocation information and decisive rights determine the governance regime? | clean 2-by-2 quadrant/phase matrix | two labeled axes and direction; four regimes; design boundary; warning zone; no universal allocator claim | labels straddling quadrant boundaries; blue wash over half the plot; prose in center |
| `VI/fig:governance-flow` | When does a dispute escalate from local handling to stronger intervention? | ordered escalation ladder or state path | four stages; entry condition; escalation trigger; terminal resolution; evidence retained | undirected org chart; decorative staircase |
| `VI/fig:auction-inline` | How do static escrow and competitive underwriting differ in idle capital and tail risk? | same contract as `IV/fig:auction-inline` | identical scales and semantics to Volume IV; coverage; capital; premium; tail risk | local redesign that changes meaning; black bar over text |
| `VI/fig:sybil-inline` | How does a Sybil attack flow through the mechanism, and where is loss capped? | actor sequence with an accounting rail | attacker identities; actions; detection; deposit/coverage; bounded slash; commons exposure | network cloud of fake agents; unlabeled loss arrow |
| `VI/fig:cartel-game-inline` | Under which parameters is collusion sustainable? | same contract as `IV/fig:cartel-game-inline` | identical payoff symbols and boundary semantics; detection and loss effects | local decorative seesaw; inconsistent colours |
| `VI/fig:bonded-key-custody` | Which key holder can break which guarantee? | custody-by-guarantee threat matrix | key holders; signing/redirecting/revoking powers; violated guarantee; mitigation | key icons around a lock; node graph of custodians |
| `VI/fig:magic-link-inline` | How do concurrent consumers race for one atomic token? | two-lane race timeline | same token; concurrent arrival; atomic drain point; one success; one reject; durable result | two arrows into a magic-link icon; hidden serialization point |
| `VI/fig:worked-example` | How do capability, evidence, and collateral evolve over wall-clock time in one transaction? | three-lane wall-clock timeline | shared time axis; issuance/execution/evidence/settlement events; cross-layer links; terminal outcome | vertical prose flow; unrelated mini-diagrams |

## Volume VII: The Federated Harbor

Canonical root: `website-v2/public/whitepaper/federated-harbor-whitepaper.tex` (5 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `VII/fig:fh-topology` | How do two sovereign harbors share witness and settlement without hierarchy? | same semantic contract as `IV/fig:fh-topology` | equal endpoints; witness; bounded escrow; directional relations; custody limits | central master node; decorative space/harbor art; four prose boxes |
| `VII/fig:fh-threat-bands` | Which threat bands require which assurance mechanisms? | same semantic contract as `IV/fig:fh-threat-bands` | identical threat vocabulary and status semantics | inconsistent local palette; decorative bands |
| `VII/fig:fh-xfer` | Which four messages transfer capability without transferring root authority? | same semantic contract as `IV/fig:fh-xfer` | identical actor order, message names, and signature semantics | curved-arrow topology; protocol prose boxes |
| `VII/fig:fh-revocation` | How does revocation spread over epochs and become auditable? | same semantic contract as `IV/fig:fh-revocation` | aligned epochs; A/B/C states; gossip steps; witness publication; convergence assumption | the overlapping epoch diagram; labels on arrows; clipped lower states |
| `VII/fig:fh-settlement` | How do bond, claim, verification, and clear/refuse outcomes compose? | same semantic contract as `IV/fig:fh-settlement` | identical custody assumption, actors, evidence, and outcomes | oversized note box; ambiguous three-column flow |

## Cross-volume reuse contracts

Some figures recur because later volumes consume earlier mechanisms. Reuse must be semantic, not
merely stylistic:

| Contract | Members | Requirement |
|---|---|---|
| Federated topology | `IV/fig:fh-topology`, `VII/fig:fh-topology` | same four roles and relation directions; captions may change emphasis |
| Threat bands | `IV/fig:fh-threat-bands`, `VII/fig:fh-threat-bands` | same rows, columns, status vocabulary, and residual-risk encoding |
| Capability transfer | `IV/fig:fh-xfer`, `VII/fig:fh-xfer` | same four-message order and signature semantics |
| Revocation propagation | `IV/fig:fh-revocation`, `VII/fig:fh-revocation` | same epoch/state grammar and convergence assumptions |
| Federated settlement | `IV/fig:fh-settlement`, `VII/fig:fh-settlement` | same principals, custody boundary, evidence path, and terminal partition |
| Underwriting comparison | `IV/fig:auction-inline`, `VI/fig:auction-inline` | same scale, costs, horizon, and tail-risk semantics |
| Cartel condition | `IV/fig:cartel-game-inline`, `VI/fig:cartel-game-inline` | same symbols, inequality orientation, and phase boundary |
| Coordination stack | `I/fig:stack-map`, `II/fig:swk-stack-map`, `III/fig:stack`, `IV/fig:he-stack-map` | preserve the same L0 machine/kernel, L1 agent coordination, L2 operator legibility/authority, and L3 market/economy model; Volume I owns L2 and cross-cuts the L1 directory substrate; Volume II owns L0 and the implemented carrier half of L1; Volume III is the L2-to-L3 continuity/reputation bridge; Volume IV owns L3; chapter numbers never imply layer numbers |

If a shared figure changes, inspect every member of its contract in the same contact sheet. A
local redraw that subtly reverses direction, changes the scale, or drops an assumption is a
semantic regression.

The coverage checker parses this table and fails when a declared member is absent from either the
atlas or canonical TeX sources, when a contract has fewer than two members, or when names or
members are duplicated. It does **not** claim to prove that two renders are semantically equal:
that remains the same-contact-sheet human review above.

## Suite-level house style

Coherence does not mean making 81 copies of the same node diagram. The suite should alternate
among plots, schedules, matrices, sequences, state machines, provenance structures, stacks, and
accounting views according to the claims.

- Use the body serif and compatible math fonts.
- Use dark ink and warm neutral structure. Reserve one cool accent for the selected/valid path
  and one warm accent for hazards, missing bindings, or error regions.
- Keep fill values light enough for black labels. Never wash an entire quadrant blue by default.
- Use solid/dashed, shape, or texture redundantly with colour.
- Keep labels horizontal wherever possible and in reserved whitespace.
- Let axes, time rails, and alignment do the explanatory work before adding arrows.
- Prefer two aligned panels over one tangled composite.
- Prefer a matrix over a dense network when the task is lookup, comparison, or coverage.
- Prefer a sequence over a network when the task is order.
- Prefer a state machine over a flowchart when the task is reachability.
- Prefer a captioned equation beside a plot over an equation floating above decorative marks.

## Five-second audit

At final print size, ask a reader who has not seen the source:

1. What is being compared, ordered, conserved, granted, or changed?
2. Where should the eye start and end?
3. Which geometry carries the conclusion?
4. What assumption or boundary limits the claim?

If the reader must read more than three long labels, follow crossing arrows, infer an unstated
axis, or use the caption to discover the geometry's meaning, revise the figure.

## Failure-to-fix map

| Failure | Diagnosis | Fix |
|---|---|---|
| Sea of prose boxes | relation was never chosen | return to the reader question; choose a schedule, matrix, state machine, plot, or sequence |
| Homogeneous nodes | roles are semantically different but visually collapsed | assign role-specific shapes and edge types; reduce node count |
| Twisty arrows | too many relations share one plane | add lanes, panels, a time rail, or a matrix |
| Text overlaps curves or paths | labels were placed after geometry | reserve label bands before routing; move explanations to caption |
| Everything is blue | accent became decoration | return structure to neutral ink; keep blue for one selected/valid relation only |
| Huge empty page | figure has weak information density or bad float sizing | tighten the grammar, set final width, and inspect the page fit |
| Scenic art with labels | metaphor replaced semantic coordinates | remove the art; rebuild from source-owned marks |
| Attractive but inscrutable | marks do not match the reader task | replace the entire grammar rather than polishing it |

## Research basis

- Mackinlay, *Automating the Design of Graphical Presentations of Relational Information*
  (1986): a visual form must first express the relation, then optimize perceptual effectiveness.
  [PDF](https://cs.calvin.edu/courses/info/601/refs/mackinlay1987.pdf)
- Cleveland and McGill, *Graphical Perception* (1984): common-scale position is a stronger
  quantitative encoding than angle, area, or saturation.
  [Record](https://etd.ohiolink.edu/acprod/odb_etd/ws/send_file/send?accession=osu1753720136633193&disposition=inline)
- Munzner, *A Nested Model for Visualization Design and Validation* (2009): validate domain
  problem, abstraction, idiom, and algorithm at distinct levels.
  [PDF](https://www.cs.ubc.ca/labs/imager/tr/2009/NestedModel/NestedModel.pdf)
- Brehmer and Munzner, *A Multi-Level Typology of Abstract Visualization Tasks* (2013): connect
  why, how, and what before choosing an idiom.
  [PDF](https://www.cs.ubc.ca/labs/imager/tr/2013/MultiLevelTaskTypology/brehmer_infovis13.pdf)
- Harel, *Statecharts: A Visual Formalism for Complex Systems* (1987): explicit state hierarchy,
  concurrency, and transition semantics outperform generic flow diagrams for reactive systems.
  [Article](https://www.sciencedirect.com/science/article/pii/0167642387900359)
- Ghoniem, Fekete, and Castagliola, *A Comparison of the Readability of Graphs Using Node-Link
  and Matrix-Based Representations* (2004): node-link aids path tasks; matrices often serve dense
  lookup/comparison tasks better. [DOI](https://doi.org/10.1109/INFVIS.2004.1)
- Dunne et al., *Readability Metric Feedback for Aiding Node-Link Visualization Designers*
  (2015): overlap, crossings, angular resolution, and coverage are measurable readability risks.
  [DOI](https://doi.org/10.1147/JRD.2015.2411412)
- Liu et al., *The Sprawlter Graph Readability Metric* (2020): clutter depends on the area and
  salience of overlaps, not only crossing counts.
  [Paper](https://www.cs.ubc.ca/labs/imager/tr/2020/sprawlter/)
- Okabe and Ito, *Color Universal Design*: use palettes and redundant encodings that remain
  distinguishable under common colour-vision differences.
  [Guide](https://jfly.uni-koeln.de/color/index.html)
