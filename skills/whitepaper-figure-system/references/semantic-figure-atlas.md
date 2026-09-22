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
| `I/fig:state-of-nature` | How does consent change concurrent writes into a legible order? | aligned before/after schedules on the same time scale | overlapping writer intervals; collision window; ordered queue; one commit spine; audit fields | actor bubbles around an artifact; membership graph; free-form arrows |
| `I/fig:zoom-vs-potemkin` | Can each summary claim reach reviewable evidence? | aligned two-panel evidence-reachability comparison | identical summary surfaces; total zoom paths on left; opaque boundary and unreachable evidence on right | twisted arrows; paragraph boxes; scenic lens/facade art |
| `I/fig:specialization` | When does a sole specialist beat a pooled service, and where does a shortcut err? | phase-boundary plot | labeled axes; exact boundary; approximate boundary; two error regions; winning regimes | yes/no slogan; unscaled curve; legend covering plot |
| `I/fig:sdt` | How does the forced-zoom threshold trade misses against false alarms? | two-distribution decision plot | axes; safe/dangerous distributions; criterion; miss and false-alarm regions; separation; cost asymmetry outside data field | text over curves; callouts inside peaks; decorative icons |
| `I/fig:readpoverty` | How do single-reader, summed two-reader, and joint counting floors differ? | three direct-labeled curves on a common bits scale | exact k=2,m=8 formulas; N=60 worked values; per-head versus total; each separate reader has m opens while the joint reader has m total; lower bounds, not achieved costs | comparing joint total to one head as architecture savings; fake lookup/value panels; markers presented as independent measurements |
| `I/fig:split-ranker` | How can one substrate support two incompatible rankings? | shared substrate splitting into two aligned scoring lanes or paired ranked lists | same candidate pool; shared decay; discovery objective; regret objective; reversed example ordering | homogeneous node diagram; telescope/lantern/chart art; one weighted score |
| `I/fig:roles` | What grants authority, who exercises it, who is governed, and how is override returned? | differentiated institutional route | operator/principal; scoped grant; authority/actor; multitude; enforcement; legibility; revocation/override; mutual covenant | sand-dollar ring; stacked ovals; anonymous hierarchy; reciprocal arrows without labels |
| `I/fig:escalation-band` | At a given attention budget, does a real dismissal-debit band exist, or have the alarm-load and miss-loss walls crossed? | two aligned rows on one shared linear axis, one budget per row | both walls per row; the feasible interval shaded when real; the walls' crossed order when the band is empty; one shared, labeled axis | two disconnected plots; a table of the same four numbers; an unscaled sketch |
| `I/fig:split-penalty` | How far above the sum of two single-reader floors is the joint-union floor? | finite discrete-point comparison on a common ratio axis | N=60; m=8 and m=20; all admissible integers k with 2k<=m; ratio-one reference; direct endpoint values; joint m opens versus separate m each | claiming a finite slice proves unboundedness; achieved costs or equal-opening-budget savings; an infinite continuation beyond an admissible endpoint |
| `I/fig:rate-regime` | Which miss-mass and flag-budget pairs are infeasible, positive-rate or zero-rate? | analytic two-dimensional phase-boundary plot | p=.05; f=p-delta feasibility floor; f=1-delta/p zero-rate boundary; distinct regions; true-slope continuation above the panel; H=.2864, R=.1864 and R=.0087 worked values | horizontal clipping mistaken for a threshold; stroked fill edges creating false diagonals; deployment-measurement framing |

| `I/fig:completion-verifier` | What does the authority report when the acceptance predicate is satisfied, false, or unevaluable? | one criteria-bound verifier gate with three directly labeled branches | met → done; unmet → refused; unevaluable → explicit inability to verify; done relative to the declared criterion; chapter status Vision/design invariant, not demonstrated enforcement | binary pass/fail; unavailable evidence treated as false or success; numbered branches requiring a remote legend; a passing verifier claimed to prove all software correct |
| `I/fig:consent-lifecycle` | Does an action consume its grant, and what ends authorization? | grant-state spine plus separate per-action guarded loop and witness mark | one grant g; operator issue; each action checks scope AND stakes ceiling AND reversibility floor AND unexpired AND unrevoked; admit versus escalate without automatic execution; actions leave (g,x,reason,artifact-link); expiry/revocation removes g; no resurrection; status Vision | grant states confused with action outcomes; TTL checked only at issue; escalation as revocation or approval; unconditional return after expiry; witness omitted from a complete lifecycle |
| `I/fig:hayek-scott` | Which cautions belong to the cited authors, and which synthesis is this chapter's own? | aligned source-attribution ledger plus explicitly labeled author-synthesis/application line | Scott 1998 administrative flattening; Hayek 1945 dispersed local knowledge; Scott 2012 practical-knowledge settings; one-head/non-spawnable constraint and skill-retention policy identified as chapter interpretation; artifact access does not recover all tacit knowledge | untyped causal/provenance arrows; Book claim pointing into Scott 2012 as its source; synthesis presented as joint quotation/theorem; zoom as complete preservation of metis; demonstrated skill-retention efficacy |
| `I/fig:sa-levels` | Which questions can the digest support, and which benefits still need evaluation? | three aligned capability/evidence rows ordered by the SA taxonomy, with separate proposed-test annotation | perception=current state; comprehension=meaning; projection=anticipated effects; read-surface support distinct from measured human performance; projection missing/proposed; proposed freeze-probe pauses, asks next three merges, scores accuracy; ordinal categories only | validated without results; built cognitive achievement; equal-height bars interpreted as measured coverage; past/present/future timeline substituted for taxonomy; literature treated as implementation evidence |

## Volume II: The Single-Writer Kernel

Canonical root: `whitepaper/single-writer-kernel.tex` (9 graphical figures, 2 recorded terminal
sessions set as listings, and 2 algorithm exhibits). The seven-organs, communication-organ and
deontic-split exhibits are tables in the chapter (round 4, 2026-09-06); the bouncer sketch and the
dual-runtime mirror were cut with a written rationale in the figure triage.

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `II/fig:swk-stack-map` | Which L0--L3 layers does the kernel own, and what machine floor does it assume? | four-rung coordination stack plus machine-floor band using the shared stack contract | L0--L3; machine floor; II highlighted on all L0 and the implemented carrier half of L1; layer API direction; chapter numbers are not layer numbers | seven-paper layers; ornamental tower; perspective architecture |
| `II/fig:swk-single-writer` | How do many callers become one serial commit history? | converging request queue into one commit spine | concurrent callers; queue order; exactly one active writer; durable outcomes | many arrows into a database icon; unlabeled central box |
| `II/tab:swk-durability-faultclass` | Which persistence guarantee answers which fault class? | booktabs table, sync level x fault class (a 2x3 classification, not a quantity; overridden from a colour-fill matrix per craft-rules §3 -- the fill was pale-on-pale and unreadable at print contrast) | process crash, OS crash, power-loss fault classes; the two \texttt{synchronous} levels; "durable" vs "may lose last commits" stated in words | colour standing in for the word; ladder without axes; decorative shields |
| `II/fig:swk-claim-lifecycle` | Which states can an exclusive claim enter, and how does it leave? | compact state machine | admissible states; acquisition guard; expiry/release/revoke transitions; terminal outcomes | generic flowchart; lifecycle circle with no guards |
| `II/fig:swk-controllability-quadrant` | Which combinations of control and witnessed trigger information permit prevention? | two-by-two regime plane with one concrete event per cell and the preventable cell marked | two independent axes as clauses; the single prevention cell; observed-after-effect distinguished from an unwitnessed guard or unreported internal step; detection not automatic outside the prevention cell | all three other cells called detect-only; a bouncer illustration; empty cells; prose-only verdict |
| `II/alg:acquire` | Which atomic decision selects the single winner? | annotated pseudocode with a short transaction sequence | unique-key insert; competing callers; commit/constraint outcome; no race gap | node graph; source code shrunk below print size |
| `II/fig:swk-reference-monitor` | Does every effect pass through a small complete mediator? | effect path through one narrow mediation gate | all request origins; reference monitor; allowed/denied branches; audited effect | broad hub; firewall clip art; hidden bypass paths |
| `II/fig:swk-commitment-oracle` | What evidence permits a commitment to close? | state machine with oracle-gated terminal transition | open state; candidate evidence; typed oracle; close/refuse outcomes; freshness | sequence of prose boxes; magic checkmark |
| `II/alg:close` | How does a finite oracle vocabulary decide closure? | annotated pseudocode plus decision table | allowed oracle types; validation order; terminal result; failure behavior | node graph; untyped decision diamond chain |
| `II/fig:swk-continuity-organs` | How do memory, checkpoint, identity, continuity, and reputation depend on one another? | layered dependency spine | dependency direction; durable artifacts; identity anchor; computed reputation | organic anatomy; equal boxes with crossing arrows |
| `II/fig:swk-consistency-model` | How do interleaved operations map to a serial history? | swimlane sequence with serialization points | actors; operation intervals; linearization/commit points; resulting total order | set diagram; before/after node clouds |
| `II/fig:swk-idempotency-gap` | What can a recovering sender infer from a pending journal entry? | aligned two-history event trace plus measured finite outcome matrix | identical pending/no-receipt journal entries for the same key; zero versus one remote effect before recovery; 12 local crash/policy cases; counts and sender states; atomic retained receiver key/payload/effect/receipt contract | two successful redelivery lanes hiding the crash window; a key icon implying safety; treating hold as useful recovery or the mock receiver as the runtime |
| `II/fig:swk-workunit-machine` | Which states can an evidence-bearing work unit pass through, and which guard protects each transition? | state machine at full measure with numbered guards keyed to a legend under the picture | the phases; the journals each writes; every guard as a named edge; the state count from the checker | a flowchart of boxes; guards as tiny italics on edges; a machine without the checker's count |
| `II/fig:swk-marker-decay` | How long does a stigmergic marker live under exponential decay before the prune threshold removes it? | measured-quantity plot: weight against ticks for two decay rates with the threshold as a rule and the two lifetimes marked | the two rates; the prune threshold; the tick at which each curve crosses it (29 and 59) | unlabeled decay sketch; a curve without the threshold; a table of two numbers pretending to be a figure |
| `II/fig:swk-delegation-chains` | How must coordination lineage relate to the signed authorization path? | one authorization path with an expanded payload record containing lineage | root signer, attenuating hop and verifier; Built authorization versus Designed lineage; required signed payload at each hop; loop detection/upward block as intended uses; task equivalence open | two peer chains; exact deployed schema; signatures treated as semantic-equivalence proof; private keys carried by arrows; formal UML claim for a record metaphor |

| `II/fig:swk-durability-dramatization` | Why does an acknowledged WAL/NORMAL commit fare differently under process crash and power loss? | common pre-fault storage state above two aligned fault/state/outcome rows | claim and note; OS cache distinct from stable storage; sync not established; identical illustrative t0+5ms fault instant; I1a Built survival conditioned on intact OS/database/WAL; I1b NotGuar possible loss | five milliseconds treated as a measured loss window; sync drawn after power loss; cache and disk conflated; busy checkpoint treated as evidence of unsynced WAL; tiny labels or guaranteed data loss |
| `II/fig:swk-atomicity-fix` | What remains when the third local write fails, and what would one transaction change? | aligned separate-commit versus single-transaction traces | claim port and open session already committed; failure during record commitment; surviving partial state; proposed BEGIN IMMEDIATE boundary with one commit or rollback; OP-11 Open; local rows in one database | failure after a successful third commit; a distributed Saga required; wrapping shown as shipped; atomicity confused with power-loss durability |
| `II/fig:swk-capability-permission` | Can an action be possible yet forbidden? | categorical ability by normative-permission matrix | independent ability and permission axes; all four cells; emergency override available but forbidden; no population counts or numeric scales | capability and permission treated as synonyms; quadrant treated as measured frequencies or a reachability proof; a cell offered as evidence of deployed confinement |
| `II/fig:swk-enforcement-layers` | Which checks can a same-user process bypass, and what would make mediation compulsory? | effect path with explicit bypass, mechanism/status ledger and separate post-effect monitor response | guard/shim Built as source mechanisms but optional in-band; hook harness and push broker Designed; credential broker Vision; protected OS/VM boundary plus forced mediation Vision; unchecked same-user effect path; monitor response after a witnessed effect; no promised observation of every bypass | hooks labeled Built; every in-band check drawn as post-effect only; optional authorization mistaken for compulsory mediation; isolation alone portrayed as complete mediation; all mechanisms shown deployed or all bypasses guaranteed detected |

## Volume III: From Spawn to Person

Canonical root: `website-v2/public/whitepaper/spawn-to-person.tex` (13 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `III/fig:stp-dependency-spine` | What must persist before reputation can be traded? | vertical dependency spine with an aligned implementation-status column | memory/checkpoint, continuity, persistent participant, reputation, tradable asset; necessary not sufficient relations; partial versus proposed status | scaled horizontal rail; tiny alternating labels; readiness implied by direction |
| `III/fig:stp-handoff-coverage` | Why can a matching capsule hash coexist with a missing task obligation? | aligned original/selected record strips and independent consistency/coverage readouts | old source-function fixture; five original operator turns with required turn-0 absent from retained last four; separate eight-message assistant tail; hash consistency; full-capsule transcript reference missing from brief; lookup not performed | digest treated as authentication or completeness; arbitrary failure rate; assistant turns counted as operator requests; hypothetical source recovery shown as performed; permanent-loss claim |
| `III/fig:role-person` | What differs between a temporary role and a continuous person? | aligned attribute comparison | same comparison fields; role lifetime; evidence continuity; accountability; revocation | two portraits; Venn diagram; prose cards |
| `III/fig:parfit` | How can overlapping episodes create continuity without a permanent substrate? | interval/provenance chain | episode intervals; overlap evidence; transitive continuity relation; gaps | snake/ribbon art; unlabeled chain of circles |
| `III/fig:sybil` | Why does minted identity resist Sybil and whitewash attacks? | paired threat trace | self-asserted path; minted-root path; reset/whitewash attempt; blocked boundary; surviving evidence | crowd of identical avatars; shield clip art |
| `III/fig:multidim` | How does quality differ across dimensions rather than collapse to one score? | aligned dot profile or small-multiple bars | dimensions on common rows; multiple persons/agents; uncertainty if measured; no total score | radar chart; area-filled polygon; single average badge |
| `III/fig:judge-market` | How is a neutral judge selected, informed, and paid? | actor swimlane sequence | parties; judge selection; evidence reveal; decision; payment/slash; audit trail | marketplace network graph; central judge circle |
| `III/fig:rate-raters` | Why does recursive evaluator audit terminate, and what assumption remains open? | recursive contraction tower with a theorem/conditions panel | work, judge, re-auditor, and next level; per-level deterrence rho d B >= G_k; contraction lambda = 1-rho d; logarithmic finite depth; sealed sampling premise; missing exogenously honest root and telemetry caveat | two-tier loop; infinite spiral; self-looping bubbles; termination asserted without inequality |
| `III/fig:tombstone` | How does revoking an ancestor invalidate descendants? | provenance tree with struck ancestor branch | delegation ancestry; revocation point; affected descendants; unaffected siblings; time/order | cemetery/tombstone art; flat list of revoked IDs |
| `III/fig:stp-deterrence-regime` | For which bond sizes and re-audit probabilities does deterrence hold? | threshold plot: the frontier ρ d B = G with the deterrence region tinted and edged and the worked point marked | the frontier; the region where capture pays; the worked point (ρ = 0.25 at B = 50) | a sketched curve without axes; a table of two numbers; a region distinguished by tint alone |
| `III/fig:stp-probation-cliff` | Why is the front-loaded probation schedule the cheapest deterrent for an honest newcomer? | bar plot: the honest burden of one unit of deterrence by the period it is placed in, each bar labelled with its multiple | the cliff at t = 0 as the unit; the geometric growth (δ_h/δ_f)^t; the two discount rates in the caption; the script and seed | a schematic ramp with no axis; a curve without the discount rates; a plot of the random search's 4,000 instances instead of the exchange step |
| `III/fig:stp-nomint-lineage` | Which balances are counted, and why does debiting prevent inherited value from multiplying? | three stacked lineage/accounting rows with explicit sums | one witnessed unit; gamma=.9, full grants; first row excludes initial evidence from inherited-prior sum 2.439; transfer final balances 0,0,0,.729; copy retains root 1 plus eight .9 children totaling 8.2; historical grants distinct from current balances | common live-total denominator for all rows; unit-valued copied children; only eight positive nodes; area as magnitude; unsupported shortestness; fresh randomized or deployment claims |
| `III/fig:stp-engine-swap-regime` | Which price change can remove the incentive to substitute a cheaper engine? | paired analytic gain plots with identical vertical scales and explicitly different price axes | unattested gain .3 at every common price; attested gain .3 minus price gap; zero baseline and indifferent gap .3; full-pass-through gap .6 yields -.3; payoff units and no audited bond | committed share mistaken for price; attestation alone claimed to guarantee pass-through; conditional payoffs confused with market participation; simulated or observed framing for exact curves |

## Volume IV: The Harbor Economy

Canonical root: `website-v2/public/whitepaper/harbor-economy.tex` (15 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `IV/tab:he-three-purchases` | How does buying the same refactor three ways change the seller's exposure? | three-row comparison table, following Bob's worked example | fleet bounty and sub-bonds; specialist rent and reputation; licensed skill and conditional fee; designed versus shipped status | risk rails, badges keyed to a second table, pretending the three alternatives are simultaneous cash flows |
| `IV/fig:he-float-plan` | What ceremony creates an executable, funded plan? | three-step actor swimlane | request/terms; atomic ledger turn; signed execution; point before which no execution state exists | boxes with an unexplained blue rectangle; generic horizontal flow |
| `IV/fig:he-conservation-functor` | What is conserved within a unit, and where does cross-currency exposure enter? | paired accounting panels with aligned equations | same transaction in both domains; conservation terms; exchange/exposure mapping; nonconserved risk | abstract commutative diagram without accounting labels; ornamental currencies |
| `IV/fig:he-cold-start` | When should subsidies end without triggering an empty-market trap? | threshold/regime plot | measured liquidity axis; adoption/supply response; threshold; subsidized and priced regimes; transition assumption | calendar timeline; unlabeled rising curve; prose at plot edge |
| `IV/fig:he-succession-price` | How does downtime amplify waiting, and can increased skill ever beat this pool? | log-wait curves against service rate with a separate endpoint-label gutter | chosen arrival/death/recovery rates; stable boundary mu_s>3 and shown interval 3.05..12; exact and naive means at mu_s=5; unattained floor above pool cost; hours and tasks/hour; analytic not measured | hidden near-threshold domain; a false shared off-scale interval; labels across curves; a dimensionless mortality-threshold plot that omits the worked wait comparison |
| `IV/fig:he-ms-wedge` | Which beneficial trades does this double-auction equilibrium refuse? | valuation-square regime plot with diagonal surplus boundary and refusal band | independent uniform v,c on [0,90] credits; no-positive-surplus, efficient-but-refused and trade regions; threshold v-c=22.5; worked point (70,60); 7/32 denominator is all valuation-square draws | universal market-inefficiency percentage; confusing all draws with efficient opportunities or lost gains; invented measurements; a corner fill replacing the diagonal band |
| `IV/fig:he-assurance` | How does independent review reduce conditional miss probability while reserved budget grows? | aligned log-risk and linear-budget panels | integer reviewer count 1–6; per-reviewer detection given a flaw; independent decay versus one perfectly shared draw; 1% target; one reserved bounty plus bond carry per reviewer; analytic model, not measurements or realized payout | unlabeled shrinking rectangles; arbitrary correlation curve; cost-as-payout label; assurance slogan box |
| `IV/fig:fh-xfer` | Which four messages transfer capability without transferring root authority? | four-message swimlane sequence | equal harbors; offer/request/attestation/receipt order; signatures; retained roots | symmetric node graph; curved arrow tangle |
| `IV/fig:fh-settlement` | How do bond, claim, verification, and clear/refuse outcomes compose? | settlement swimlane plus outcome partition | principals; escrow; evidence/oracle; custody assumption; clear/refuse terminal outcomes | top-down boxes with unclear ownership; note box larger than protocol |
| `IV/fig:fh-revocation` | How does revocation spread over epochs and become auditable? | aligned epoch columns with state cells and a witness rail | t=0, delta, 2-delta; A/B/C state; gossip steps; root publication; convergence assumption | labels on arrows; overlapping state boxes; generic network animation still |
| `IV/fig:fh-threat-bands` | Which threat bands require which assurance mechanisms? | assurance matrix or banded ledger | threat class; local/federated boundary; mechanism; residual risk; established/proposed status | decorative shield bands; undifferentiated checklist |
| `IV/fig:cartel-game-inline` | Under which parameters is collusion sustainable? | payoff inequality plus phase/regime plot | collusive stream; detection probability; loss; discounting; deviation payoff; sustainable boundary | decorative seesaw; five blue ticks with no scale; equation floating alone |

**The last five rows are compiled by nothing, and the atlas keeps them anyway.**
They sit inside the `\else` branch of an `\ifpdbook` in `harbor-economy.tex`:
the assembled Book takes a `\pdchapref` to chapter 7 or 8, and the chapter's
standalone form — a submission-style reading whose reader had no other chapters
to be pointed at — drew them instead. That form is retired: it was an A4 render
of the same words with no margin column, and it no longer ships as a PDF. So
the `\else` branch is now source with no output, and the CI check that policed
it (`check_standalone_figures.py`) has been retired with it.

The rows stay because the atlas covers what the SOURCES carry. Whether those
branches should still be in the sources at all is an open question, and the
five rows are the best inventory of what would be lost by deleting them.

## Volume V: The Anchor Protocol

Canonical root: `website-v2/public/whitepaper/anchor-protocol-whitepaper.tex` (9 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `V/fig:anchor-four-phases` | What forced each successive protocol phase, and what does each phase close for good? | left-to-right flow diagram with a per-transition rationale and a per-phase closure box | four ordered phases; the forcing reason on each transition; the attack surface each phase forecloses; per-phase mechanization status | unexplained decorative boxes; a "needs" pill with no source in the chapter's own text; a uniform pass/fail strip that hides the one phase not machine-verified |
| `V/fig:anchor-capability-attenuation` | How do rights and TTL strictly shrink across delegation? | nested sets paired with a rights/TTL table | root and child capabilities; strict subset relations; TTL decrease; attempted re-grant rejection | unexplained concentric circles; blue outline as sole meaning |
| `V/fig:anchor-alg-confusion` | Why does issuer-pinned verification reject a token that attacker-selected verification accepts? | aligned paired security trace or comparison table | identical token bytes; control authority; algorithm source; verification trace; accept/reject outcome | two prose flows; giant arrows; colour-only safe/unsafe distinction |
| `V/fig:anchor-delegation-inline` | What evidence travels with a multi-hop delegated capability? | linear provenance/sequence chain | issuer and delegates; signed tuple; attenuation at each hop; freshness/TTL; verifier checks | looping chain; decorative keys; unreadable token blob |
| `V/fig:anchor-cuckoo-inline` | Why is raw OR not a safe cuckoo-filter merge? | paired bit-level counterexample and semantic-ID rebuild | one-slot buckets; 001 OR 010 = 011; empty alternate; failed exact-fingerprint lookups; union of authoritative IDs and rebuilt filter | duplicate fingerprints declared impossible; load-threshold plot unrelated to this merge claim |
| `V/fig:anchor-revocation-gossip` | How quickly does a revocation reach all participants under stated assumptions? | epoch timeline or small-multiple spread map | initial revoked node; rounds; informed count/state; network assumptions; convergence bound | dense node hairball; overlapping labels; decorative epidemic arrows |
| `V/fig:anchor-handshake-ladder` | Who signs each message of the issue--delegate--verify ceremony, and which participant stops being spoken to? | four-party UML sequence diagram: lifelines, activation boxes, a reflex self-message for the verifier's loop, and a shaded region over the offline stretch | the four participants; one structured label per message carrying the card, its signing key and its capability set; the narrowing capability set; the offline stretch as a drawn region the issuer takes no activation box inside | a static chain with no clock; arrows around a metaphor; prose boxes standing in for messages; a floating note in place of the region; a second arrow colour that encodes nothing |
| `V/fig:anchor-card-lifecycle` | What are the only valid exits from an active card? | small state machine | issued/active states; expiry; revoke; invalid/rejected terminal state; guards | circular lifecycle infographic; ambiguous return arrows |

## Volume VI: The Bonded Commons

Canonical root: `website-v2/public/whitepaper/agent-transactions-whitepaper.tex` (12 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `VI/fig:pareto-mc-inline` | How does the empirical Pareto criterion change with noise and insurer count? | two aligned quantitative plots with uncertainty | shared treatments; axes and units; Monte Carlo uncertainty; feasible/Pareto region | prose table alone; differently scaled panels without warning |
| `VI/fig:sybil-mc-inline` | How do deposit size and coverage affect attacker profit and commons deficit? | aligned profit/deficit curves | deposit or coverage axis; attacker profit; commons deficit; threshold; uncertainty/simulation assumptions | avatar swarm; unscaled risk icons |
| `VI/fig:cartel-folk` | Where is cartel cooperation sustainable, and how long until detection? | phase heatmap plus aligned rounds-to-detection plot | detection probability; discount factor; sustainable boundary; detection time; parameter assumptions | four prose quadrants; decorative cartel network |
| `VI/fig:governance-flow` | When does a dispute escalate from local handling to stronger intervention? | ordered escalation ladder or state path | four stages; entry condition; escalation trigger; terminal resolution; evidence retained | undirected org chart; decorative staircase |
| `VI/fig:sybil-inline` | How does a Sybil attack flow through the mechanism, and where is loss capped? | actor sequence with an accounting rail | attacker identities; actions; detection; deposit/coverage; bounded slash; commons exposure | network cloud of fake agents; unlabeled loss arrow |
| `VI/fig:cartel-game-inline` | Under which parameters is collusion sustainable? | same contract as `IV/fig:cartel-game-inline` | identical payoff symbols and boundary semantics; detection and loss effects | local decorative seesaw; inconsistent colours |
| `VI/tab:bonded-custody-access` | What access does each attack require in the stated adversary model? | four-row, two-column table | daemon private key; session key; email AND passphrase; KMS complicity; same-user exclusion | symbol legend, minimum-cut/sufficiency claims not proved in the invariant, public witness signature treated as a secret |
| `VI/fig:bonded-merkle-forest` | How does an inclusion check connect a note to the signed harbor root? | one continuous top-to-bottom inclusion path | note hash; session root of 100 notes; signed harbor root of 10,000 sessions; 7 and 14 sibling hashes directly on their respective paths | separately numbered chain/proof/arithmetic lanes; disconnected right-hand notes; inclusion confused with truth of the note |
| `VI/fig:bonded-inclusion-check` | Why must root recomputation and checkpoint authentication both succeed? | two independent evidence paths converging at one explicit conjunction, then accept/reject branches | receipt P; ordered two-sibling path with distinct leaf/node hashes; computed root R-prime; signed checkpoint root R-star and n=4; external trusted key; signature result A; A AND root equality; inclusion not truth | root match alone treated as trust; a decorative key replacing verification; collapsed authentication path; silently substituting the forest's 7/14 sibling counts; forbidding the approved paper/key role pictograms |
| `VI/fig:magic-link-inline` | How do concurrent consumers race for one atomic token? | two-lane race timeline | same token; concurrent arrival; atomic drain point; one success; one reject; durable result | two arrows into a magic-link icon; hidden serialization point |
| `VI/fig:bc-delta-threshold` | At what patience does defecting stop paying, and what does bounding the punishment at three rounds cost? | two analytic curves on identical payoff and discount scales, with a zero-gain baseline | finite domain [0,1] and grim domain [0,1); separate roots .342508... and 1/3; unique square for archived TLC witness (.30,+.166); open circle for worked (.9,-3.878); finite endpoint (1,-5); grim continuation to negative infinity; shared correct-observation assumption | conflated roots; two y axes; unlabeled units; a value for grim at 1; archived four-round counterexample presented as fresh checking or a measured payoff series; plot inserted inside a terminal transcript |
| `VI/fig:worked-example` | How do capability, evidence, and collateral evolve over wall-clock time in one transaction? | three-lane wall-clock timeline | shared time axis; issuance/execution/evidence/settlement events; cross-layer links; terminal outcome | vertical prose flow; unrelated mini-diagrams |

## Volume VII: The Federated Harbor

Canonical root: `website-v2/public/whitepaper/federated-harbor-whitepaper.tex` (5 figures).

| Atlas ID | Reader question / claim | First-choice grammar | Must encode | Reject |
|---|---|---|---|---|
| `VII/fig:fh-threat-bands` | Which threat bands require which assurance mechanisms? | same semantic contract as `IV/fig:fh-threat-bands` | identical threat vocabulary and status semantics | inconsistent local palette; decorative bands |
| `VII/fig:fh-xfer` | Which four messages transfer capability without transferring root authority? | same semantic contract as `IV/fig:fh-xfer` | identical actor order, message names, and signature semantics | curved-arrow topology; protocol prose boxes |
| `VII/fig:fh-revocation` | How does revocation spread over epochs and become auditable? | same semantic contract as `IV/fig:fh-revocation` | aligned epochs; A/B/C states; gossip steps; witness publication; convergence assumption | the overlapping epoch diagram; labels on arrows; clipped lower states |
| `VII/fig:fh-revocation-regime` | Which bound binds a stale card after revocation: partition bound, delivery level, or time to live? | regime plane in rounds: partition bound against delivery service level, the TTL line as the boundary, both regions labelled in words | the two operational bounds; the TTL line; which region each bound governs | a timeline; a Venn diagram; unlabeled regions |
| `VII/fig:fh-visible-topology` | How does the auditor construct K_c from G_c? | aligned source/visible topology panels | same coordinate-c vertices and layout; solid compared, dashed relayed, dotted severed links; EF omitted; ABC survives while DEF opens | another C6/P6 residual comparison; a cycle presented as proof of a lie |
| `VII/fig:fh-cycle-vs-cut` | Why is the same disagreement detectable on a cycle and invisible on a path? | two six-node graphs side by side, the disagreeing edge marked on each, the consistency radius under each | C6 with r = 1.2247 and P6 with r = 0; the disagreeing overlap; the missing closing edge on the path | a generic graph without the radius; a sheaf-Laplacian formula in place of the two instances |
| `VII/fig:fh-settlement` | How do bond, claim, verification, and clear/refuse outcomes compose? | same semantic contract as `IV/fig:fh-settlement` | identical custody assumption, actors, evidence, and outcomes | oversized note box; ambiguous three-column flow |
| `VII/fig:fh-sovereignty-fence` | Must Bob accept Alice's well-formed card? | concrete two-participant request/refusal sequence | Alice's agent presents db:write; Bob's daemon rejects an untrusted issuer; explicitly before the transfer ceremony | five vocabulary boxes inside a fence; refusal drawn as completed capability transfer |

## Volume VIII: The Sealed Harbor

Canonical root: `website-v2/public/whitepaper/sealed-harbor.tex` (5 graphical figures; drawn in
wave 4 under figcheck, the reference set for the legibility rubric).

| Stable ID | Reader question | Prescribed grammar | Must distinguish | Rejected grammar |
|---|---|---|---|---|
| `VIII/fig:sealed-pillar-pipeline` | Which controls mediate an output, and whose authority removes a restriction? | component/control-flow drawing with two separately authorized release paths | signed work order; worker handles; in-guest monitor; outer gateway; Derek authorizes removal of D for Erin, Erin removal of E for Derek; public receipt explicitly omitted | serializing the two owner gates; confusing owner and recipient; duplicating the adjacent checker table inside the diagram |
| `VIII/fig:sealed-two-worlds` | Can Erin distinguish secrets with the same parity? | aligned two-run observation logs plus a separate negative control | secret inputs 0 and 2; load/read/submit/release order; equal empty logs and parity release; raw-secret release 0 versus 2; finite depth-7 scope | comparing full internal states as if equal; a branch inside one execution; suggesting unbounded proof |
| `VIII/fig:sealed-laundering-fork` | Can a changed argument defeat the intended release policy through an unchanged gate? | two aligned input/gate/output rows with ordered world pairs | committed secrets (0,2) release (0,0); floor(s/2) transforms input to (0,1) and releases (0,1); identical parity gate; world A/B order; explicit arithmetic-illustration status and absence of payload register in C1 | two different gates suggesting corruption; a fictitious compute branch inside current C1; submit boundary implying the checker sees no other events; claiming an executed model extension |
| `VIII/fig:sealed-two-adversaries` | Why does the same ledger support different conclusions for a valid private mechanism and a malicious worker? | aligned paired accounting comparison with identical ledger records and separate roles | valid versus self-declared privacy cost; observer versus worker choosing output; same conservation and budget invariants; conditional DP versus no DP certificate; q·b bits for the specified channel before timing; complete-mediation assumption | runtime branch on honesty; different ledger code or arithmetic by case; worker modifying trusted ledger/policy; epsilon equated to bits; bookkeeping erased by “certifies nothing”; capacity promoted to all side channels |
| `VIII/fig:sealed-mutant-grid` | Which mutant breaks which invariant, and how fast? | mutant × invariant grid with caught/step counts in the cells | the two mutants; the two invariants; the step count | a bar chart; a checklist |
| `VIII/fig:sealed-composition-crossover` | When is the advanced bound's epsilon component first smaller? | analytical comparison of basic and advanced epsilon bounds against releases k; first integer crossing k = 35 for epsilon = 0.1 and delta-prime = 10^-6 | two directly labeled curves; fixed caps and horizon; k = 32 is a checkpoint, not the crossing; positive-delta tradeoff versus pure-DP basic composition | a schematic curve pair; observations implied by an analytical curve; k = 32 marked as the crossing; smaller epsilon presented as a uniformly stronger privacy guarantee |
| `VIII/fig:sealed-operating-curve` | What is conditional detection power, and how do approximate stopping counts compare with reported simulation means? | two-panel analytical/evidence comparison: full-range integer-k power with k = 3 marked; paired, vertically dodged dots at true x positions for nominal no-overshoot approximations and chapter-reported capped means | k = 0 versus k = 3, 0.992; approximation versus reported mean; null versus leak; uncertainty unavailable and no certified error control | a single unlabeled curve; bars presented as exact expectations; overlapping near-equal markers; invented confidence intervals |
| `VIII/fig:sealed-residuals-converge` | Why do three worker-output mechanisms share one capacity account? | three concrete alternative output artifacts converging on one envelope | transformed-secret sheet; release with attached self-declared epsilon cost tag, not a DP guarantee; free-form text; one q-job by b-bit specified output allowance, before timing | three additive allowances; epsilon equated with bits; a runtime malice detector; a universal bound on host side channels; repeated process boxes replacing the concrete artifacts |

## Cross-volume reuse contracts

Some figures recur because later volumes consume earlier mechanisms. Reuse must be semantic, not
merely stylistic:

| Contract | Members | Requirement |
|---|---|---|
| Threat bands | `IV/fig:fh-threat-bands`, `VII/fig:fh-threat-bands` | same rows, columns, status vocabulary, and residual-risk encoding |
| Capability transfer | `IV/fig:fh-xfer`, `VII/fig:fh-xfer` | same four-message order and signature semantics |
| Revocation propagation | `IV/fig:fh-revocation`, `VII/fig:fh-revocation` | same epoch/state grammar and convergence assumptions |
| Federated settlement | `IV/fig:fh-settlement`, `VII/fig:fh-settlement` | same principals, custody boundary, evidence path, and terminal partition |
| Cartel condition | `IV/fig:cartel-game-inline`, `VI/fig:cartel-game-inline` | same symbols, inequality orientation, and phase boundary |

**These five emptied and came back within a day, and the round trip is worth
recording.** They were deleted on 2026-09-08 because each of them was, at that
moment, a drawing the assembled Book printed TWICE under two figure numbers with
two captions — invisible in either chapter's source and in either standalone
PDF, visible only in the Book. An outside reader noticed two; checking
mechanically found seven. The author's decision was that the chapter which
DEVELOPS an idea owns the drawing and the other points at it, so the five volume
IV rows went with them.

Deleting them was half a fix. `harbor-economy.tex` was not only chapter 6; it
was also the source of `harbor-economy-whitepaper.pdf`, and rewriting its prose
to point at chapters removed five figures from that submission paper and left
it telling a conference reader that a ceremony is "drawn in The Federated
Harbor" — a document that reader did not have. The fix was `\ifpdbook`: the
Book takes the cross-reference, the paper keeps its own copy.

The per-chapter PDFs have since been retired, so there is no second document to
protect and the `\else` branch compiles nowhere. The conditional is recorded
here as the reason the five rows exist, not as live machinery.

Which is exactly the case the previous revision of this note said would refill
the table — "a standalone paper carrying its own copy is exactly that case" —
written before anyone had noticed it was already the case. So the contracts are
back, and they now mean what this table was always for: two renders that must
stay semantically identical across two shipped PDFs. What the table must never
again record is a duplication INSIDE one Book as though it were deliberate
reuse; `scripts/harbor-research/check_duplicate_figures.py` reads only the
`\ifpdbook` branch and fails the build on that, so the state cannot return
unnoticed.

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

- Use the shared Book type roles and compatible math fonts; the author-selected Book family is Suisse Int'l sans. Do not introduce a serif or alternate sans locally.
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
