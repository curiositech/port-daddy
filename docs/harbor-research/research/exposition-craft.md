# The Craft of Technical Exposition — Nine Harbor Applications (repo edition)

Provenance: extended-research artifact "The Craft of Technical Exposition: Seven Moves Plus Two Rails and Nine Harbor Applications" (2026-08-16). The 14 principles, the v1→v2 template critique, and the refined template were codified into `skills/harbor-exposition/` (references/exposition-principles.md, references/style-template-v2.md) — read those there. This file preserves the artifact's unique remaining payload verbatim: the nine expository treatments (Part 2B), which are paper-introduction fodder, plus the verification caveats.

Register: a smart engineer who has not read the source volume. A "digest" is a short machine-generated summary of many machine work products; an "operator" is the human supervising a swarm of AI coding agents; an "artifact" is any single work product. Numbers from Harbor's own simulations are claims from the source, flagged where not independently checkable.

---

## R1 — Read-poverty and the information floor

*Express lane: You can't skim your way out of a swarm; a summary that guarantees catching every dangerous item must carry at least log₂C(N,k) − log₂C(m,k) bits — see the box.*

**The scene.** A human is overseeing a thousand AI agents. They will happily merge each other's work; the classic database problem — two writers clobbering one file — is solved. The thing that breaks is *reading*: a person cannot open a thousand files to find the three that quietly wired a production credential into a test.

**The idea in one breath.** *If a summary must guarantee that you never miss a critical item, it has to be at least a certain size — and that size is forced by counting, not by cleverness.*

**Intuition (structural analogy).** Think of a lottery where k of N tickets are secretly winners, and you may inspect only m tickets. A "digest" is a hint telling you which m to open. To *guarantee* you open all k winners no matter where they hide, the hint must distinguish every arrangement of winners it would treat differently. The relation that maps over is *"a message must carry at least one distinct codeword per outcome it must separate"* — the same relation behind why a key must be as long as the space of things it unlocks. (Misread to preempt: this is *not* saying summaries are useless — it says a *zero-miss guarantee* has a nonzero price; cheaper summaries are fine if you accept a miss rate, which is R4.)

**The box.**
> To guarantee catching all *k* load-bearing artifacts among *N* while opening only *m*, any digest must carry at least **B\* = log₂ C(N,k) − log₂ C(m,k)** bits. (Each flagged *m*-set "covers" only C(m,k) of the C(N,k) possible placements of the k critical items.)

**Numbers by hand.** Take N=10, k=1, m=1. C(10,1)=10, C(1,1)=1, so B\* = log₂10 − log₂1 = 3.32 bits — enough to name one of ten items, obviously right. *Now you try:* N=10, k=1, m=2. (Answer: log₂10 − log₂2 = 2.32 bits — being allowed to open two tickets buys exactly one bit of slack.)

**What it buys.** It sets a floor for Harbor's digest budget: below B\* bits, *no* encoder — however smart — can promise the operator a clean sweep.

**The honest boundary.** The floor is a *lower* bound on a *guarantee*. Harbor's experiment reports that real digest schemes (oracle, noisy, random encoders against a shared codebook) never beat it — a claimed **0/16 violations** — and that an earlier run showed a spurious **8/14 "violations"** because the meter charged the oracle only for tie-breaking while handing it a perfect score vector, smuggling the answer past the meter; fixing the meter restored agreement. The covering-bound *form* is standard and sound; the 0/16 and 8/14 counts are internal simulation results not independently verifiable from outside the source.

---

## R2 — The split-digest theorem

*Express lane: One summary cannot serve two readers unless they rank items the same way everywhere; the successor agent and the human operator provably don't — see the box.*

**The scene.** Two people read the same status digest: the AI agent that will pick up the work next, and the human who must sign off. The agent wants "what's still live and worth continuing." The human wants "what could hurt us if ignored." Same page, opposite reasons.

**The idea in one breath.** *A single ranked summary can satisfy two readers only if they agree on the priority order of every pair of items; otherwise you need two summaries.*

**Intuition (structural analogy).** A scalar summary is a *thermometer*: it collapses everything to one number and sorts by it. A thermometer serves you only if the one thing you care about rises and falls with temperature. Two readers can share one thermometer only if their preferences are *comonotone* — they never disagree about which of two items matters more. The relation that maps over is *the impossibility of a single total order representing two orders that cross* — the same reason one exchange rate can't price two different baskets of goods. Consider the crossing pair: a routine-but-essential working file (high continuation value, low risk) versus an abandoned experiment with irreversible side effects (zero continuation, high risk). The agent ranks the first higher; the operator ranks the second higher. They cross; one thermometer cannot serve both. (Misread to preempt: the two readers aren't "noisy versions" of one reader you could average — averaging *creates* the miss.)

**The box.**
> A scalar head serves a reader iff ranking by it realizes that reader's optimal selection at every budget. **One head serves two readers iff their preference orders are comonotone** (agree on every pair). The successor agent and the operator disagree on constructible pairs, so no single head serves both.

**Numbers by hand.** Two items, scores (agent, operator): file A = (9, 1), experiment B = (0, 8). Agent's order A > B; operator's order B > A. Any single score s(·) would need s(A) > s(B) *and* s(A) < s(B). Contradiction — two heads required. *Now you try:* if B were (0,0), do they still cross? (No — both rank A first; one head suffices.)

**What it buys.** Harbor must store (at least) two compaction heads; a single shared summary *under-provisions*.

**The honest boundary.** The quantitative "kicker" — that for disjoint reader-critical sets the joint zero-miss floor is *super-additive*, **≈2.13× the single floor, i.e. 1.05–1.08× above exact doubling** — means one stored compaction under-provisions by more than double. Super-additivity of such combinatorial floors is plausible in direction; the specific 2.13× and 1.05–1.08× band are internal numbers (recomputable from the closed form).

---

## R3 — The derived regret head

*Express lane: The heuristic "regret = stakes × irreversibility × anomaly" is exactly the expected unrecoverable loss of not looking — provided "anomaly" is a calibrated probability — and the optimal rule is a likelihood-ratio test; see the box.*

**The scene.** Harbor's attention queue decides what to show the human first. It scored each item by multiplying three gut-feel numbers: how much is at stake, how irreversible it is, and how "anomalous" it looks. It worked, but nobody could say *why* those three.

**The idea in one breath.** *That three-factor product isn't a heuristic — it's the exact expected cost of ignoring an item, once "anomaly" is read as a genuine probability that the item is bad.*

**Intuition (structural analogy).** This is a smoke detector. The cost of ignoring an alarm is (damage if there's really a fire) × (chance there's really a fire). "Stakes × irreversibility" is the damage; "anomaly," if it's an honest probability rather than a vibe, is the chance. The relation that maps over is *expected loss = magnitude × calibrated probability*, and the inspect decision is the trade every detector makes: sound off only when expected damage beats the nuisance cost of a false alarm. (Misread to preempt: a *trusted* author does not get a free pass — see the boundary.)

**The box.**
> Optimal surfacing is a likelihood-ratio test: **inspect iff C_miss(x)·a(x) ≥ c_attention + C_fa·(1 − a(x))**, where a(x) = Pr(bad | evidence) is a *calibrated* posterior. The product "stakes × irreversibility × anomaly" equals the expected unrecoverable loss of not inspecting iff a(x) is that calibrated posterior.

**Numbers by hand.** Let C_miss=100, c_attention=1, C_fa=5. Inspect iff 100·a ≥ 1 + 5(1−a), i.e. 105a ≥ 6, i.e. a ≥ 0.057 — anything with more than a ~5.7% calibrated chance of being bad is worth a look. *Now you try:* raise C_miss to 1000 — does the bar go up or down? (Down, to a ≥ 0.006 — higher stakes *lower* the inspection threshold.)

**What it buys.** It replaces three tunable knobs with one estimator to calibrate (the posterior), and fixes a **sign error in the source manuscript**: raising the cost of a miss should *lower* the bar to inspect, which the corrected criterion does.

**The honest boundary.** Reputation enters *only* through the posterior a(x); a good track record can shift the probability but cannot multiply it to zero — so no reputation can zero out a catastrophic, irreversible item. The derivation is a standard Bayes/Neyman–Pearson decision rule and is internally consistent; the specific corrected sign is a claim about the source manuscript taken at face value.

---

## R4 — The digest-zoom Pareto frontier

*Express lane: Summary-making is a two-constraint rate-distortion problem; for a 5%-critical stream the zero-miss rate is 0.286 bits/symbol, and adaptive "zoom" beats flat inspection only when flags are sparse — see the box.*

**The scene.** Harbor has three dials to trade: how many bits the digest spends, how many items the human agrees to open, and how many critical items it will miss. Turning any one cheaper turns another dearer.

**The idea in one breath.** *There's a precise exchange rate between digest size, inspection effort, and miss rate — and where flags are rare, zooming in group-by-group is dramatically cheaper than checking everything flat.*

**Intuition (structural analogy).** This is lossy compression, like a JPEG. You spend bits to preserve what matters and let the rest blur; the question is the *fewest* bits to hold distortion below a target. Here the "distortion" you cap is the false-negative rate. The relation that maps over is Shannon's rate-distortion curve R(D): the minimum bits per symbol to keep average error ≤ D. The second move — "zoom" — is the *twenty-questions* / group-testing relation: to find k bad items among F flagged, split the group and recurse, paying about k·log₂(F/k) questions instead of F. (Misread to preempt: zoom is not free magic — see the boundary.)

**The box.**
> Model the stream as a Bernoulli(p) source; minimize I(X;X̂) subject to false-negative rate ≤ δ and flag rate ≤ f. **Zoom advantage:** when a conservative digest flags F items of which only k are truly critical, adaptive group-splitting needs ≈ **k·log₂(F/k)** opens versus F for flat inspection.

**Numbers by hand.** The zero-miss corner is the source's own entropy. For p=0.05, R(0) = H(0.05) = −0.05·log₂0.05 − 0.95·log₂0.95 = **0.286 bits/symbol** — independently verified; it is the textbook Cover–Thomas value H(p). Relaxing the miss target drops the rate fast: the source reports R(0,0.10)=0.186, R(0.01,0.10)=0.110, R(0.04,0.06)=0.009. *Now you try:* is R(0.05, ·) for a 5%-critical stream ever positive? (No — once you tolerate a 5% miss on a 5%-critical stream you can flag nothing; rate → 0.)

**What it buys.** One tunable frontier lets an operator say "I'll accept a 1% miss for a 10× smaller review pile" and get the exact digest budget that delivers it.

**The honest boundary.** Zoom's advantage is *only* in the sparse, over-flagging regime. Harbor reports **15.3× fewer opens at F=2500, k=10**, with *no* advantage when the flagged set is dense. Two flags on the arithmetic: (i) the R(0)=0.286 corner is verified and matches standard theory, but the two-constraint (false-negative *and* flag-rate) formulation is a *custom* variant, not the classical single-constraint Cover–Thomas theorem, and the other R-values are internal; (ii) the idealized bound k·log₂(F/k) at F=2500,k=10 is ≈80 opens (a ~31× reduction), so the measured 15.3× implies roughly 2× real-world overhead — consistent with practical group-testing, but internal.

---

## R5 — Hypervisor enforceability = supervisory control

*Express lane: A runtime can only *prevent* policies that constrain controllable events; "no egress after reading a secret" is preventable, "no confident lie" is detect-only — this is Ramadge–Wonham controllability; see the box.*

**The scene.** Harbor's runtime sits under every agent like a hypervisor. Some things it can physically block (a file write, a network send, a git push); others it can only *notice after the fact* (the model emitting a token, reading something already in context, forming a plan). Which safety rules can it actually *enforce*, versus merely *audit*?

**The idea in one breath.** *A rule is enforceable exactly when every way of violating it passes through an action the runtime can block; if a violation can complete using only un-blockable events, the runtime can detect it but never prevent it.*

**Intuition (structural analogy).** This is a bouncer at a club with one door. The bouncer controls who comes *through the door* (controllable events) but not what people *say* once inside (uncontrollable events). "No one enters after midnight" is enforceable — gated at the door. "No one tells a lie inside" is not — lying uses no door the bouncer controls. The relation that maps over is precisely the *controllability* condition from Ramadge & Wonham's supervisory control theory (1987): a specification is enforceable iff it is closed under appending uncontrollable events. (Misread to preempt: "detect-only" is not "hopeless" — you can still slash a bond after the fact, which is R7.)

**The box.**
> Partition events into controllable Σ_c (fs_write, net_egress, exec_tool, git_push, spawn_child) and uncontrollable Σ_u (model_emit_token, in_context_read, internal_plan). A safety policy with legal language K is **regimentable (enforceable) iff it is controllable:** K̄·Σ_u ∩ L̄ ⊆ K̄. Otherwise it is detect-only.

**Numbers by hand.** "Forbid git force-push": every violation ends in `git_push` ∈ Σ_c — block that event and no violating string completes; enforceable. *Now you try:* "forbid a confident lie in a report." Its violating act is `model_emit_token` ∈ Σ_u. Can the runtime block it? (No — detect-only, forever.)

**What it buys.** A runnable checker that, given a policy, returns "regimentable" or "detect-only," so Harbor stops promising prevention it can't deliver.

**The honest boundary.** The crown-jewel case — "no net egress *after* reading a secret" — *is* regimentable, because it permits the uncontrollable read (merely recording taint) and gates only the controllable egress. This proves the design rule: clean rooms must gate the *channel*, never the token. The Ramadge–Wonham controllability condition and its K̄Σ_u ∩ L̄ ⊆ K̄ form are standard and correctly stated; the specific event partition is Harbor's modeling choice.

---

## R6 — The sheaf verdict (cohomology of equivocation)

*Express lane: When peers gossip signed logs, a signer telling different peers different things is invisible to pairwise checks exactly when the un-compared pair lies on a cycle — and then cohomology catches it; see the box.*

**The scene.** In a federation, nodes gossip signed logs. A malicious signer can *equivocate* — tell peer A one thing and peer B another. If A and B ever compare notes directly, they catch it. But in a partitioned network some pairs never compare directly. Can the group still catch the lie?

**The idea in one breath.** *You can detect equivocation across an un-compared link precisely when that link closes a loop — because a consistent global story requires disagreements to cancel around every loop, and a lie makes them fail to cancel.*

**Intuition (structural analogy).** Imagine friends comparing wristwatch offsets: A is +2 min vs B, B is +3 vs C, C is −5 vs A. Around the loop the offsets should sum to zero (2+3−5=0); if they sum to something else, someone's lying — and you know this *without* re-checking any single pair. That "must sum to zero around a loop" is the *cocycle condition*, and the leftover nonzero sum is a *cohomology class* — an obstruction to a single global truth. The relation that maps over is identical to Abramsky & Brandenburger's sheaf-theoretic account of quantum contextuality (2011): locally consistent, globally impossible. (Misread to preempt: cohomology adds nothing over pairwise checks on a *tree* — it only pays on loops.)

**The box.**
> In federated gossip of signed logs, sheaf cohomology detects equivocation beyond pairwise comparison **iff the missing (un-compared) edge lies on a cycle.** The cocycle condition (disagreements sum to zero around a loop) substitutes for the missing direct comparison. On a *cut* edge (a lone bridge), cohomology sees nothing.

**Numbers by hand.** On the 6-cycle C₆ with scalar stalks, an equivocation on one un-compared cycle edge is pairwise-invisible but yields a reported cohomology signal of **1.225 ≠ 0**. *Now you try:* move that same lie onto a bridge edge on no cycle — what's the signal? (Zero — there's no loop to force cancellation.)

**What it buys.** Harbor's federation layer can flag equivocation across links no two peers ever directly reconciled, as long as the topology has loops (which real gossip meshes do).

**The honest boundary.** On a single-bridge (cut) topology, cohomology provably cannot help — that's the sharp boundary. Two instructive wrong turns located it: first computing dim H¹ of the *abstract* sheaf (a data-independent property of the restriction maps) rather than the obstruction of the *observed* assignment; then testing on a cut-edge bridge where the method must fail. The structural identity to Abramsky–Brandenburger is real and correctly invoked; the value 1.225 and the C₆ construction are internal (script: skills/harbor-results/scripts/sheaf_mechanism_proof.py).

---

## R7 — The inspection tower

*Express lane: Deterrence holds iff audit-prob × detection × bond ≥ corrupt gain (Becker); stacking auditors sampled from C independent cliques makes bribery collapse geometrically, and reputation lets audits taper to O(log T) or O(1); see the box.*

**The scene.** Harbor pays judges (human or AI) to review work and slashes a posted bond if they cheat. But who audits the judges? And the auditors of the auditors? It looks like turtles all the way down — and each turtle costs money.

**The idea in one breath.** *A judge is honest whenever the expected loss from being caught exceeds the gain from cheating — and by sampling each layer's auditors from several independent pools, you can make corruption uneconomical at every layer with a finite total bond.*

**Intuition (structural analogy).** This is exactly Gary Becker's economics of crime (1968): a rational offender is deterred when probability of punishment × severity ≥ gain. Here probability = audit rate × detection, severity = the slashable bond. The tower adds the relation behind *jury selection from disjoint pools*: if each auditing layer is drawn from C separate principals or model families, one bribe can't quietly buy the chain, and the cost of corrupting a layer multiplies. (Misread to preempt: you don't need infinite honest auditors — you need *diversity*, C > 1, plus finite bond.)

**The box.**
> Stage game: deterrence iff **ρ·d·B ≥ G**, critical audit rate **ρ\* = G/(dB)** (Becker); confiscation variant ρ\*_c = G/(d(G+B)); mixed-strategy NE q\* = a/(dL). **Tower:** level k+1 audits level-k auditors, sampled sealed from C disjoint cliques; bribery is profitable iff G_k > C·B, else corruption decays geometrically G_{k+1} = (1−ρd)·G_k. **Amortization:** with reputation-at-stake v·t, IC-safe declining schedules give audit spend Θ(log T) (loss-only-if-audited) or O(1) (delayed revelation), versus Θ(T) flat.

**Numbers by hand.** G=10, d=0.8, B=50 ⇒ ρ\* = 10/(0.8·50) = 10/40 = **0.25** — audit one in four and the cheat payoff is exactly zero (verified). With ρd = 0.2, corruption decays as 0.8ᵏ. *Now you try:* double the bond to B=100 — what's ρ\*? (0.125 — a bigger bond lets you audit half as often.)

**What it buys.** A finite pool of bond capital certifies an *unbounded* tower of oversight; the simulation reports C=1 keeps corruption on "linear life support" (400→390→380…) while **C=8 makes bribery uneconomical from level 1**, collapsing as 0.8ᵏ. The slogan: "reputation is amortized verification."

**The honest boundary.** The taper schedules are incentive-compatible only under their stated assumptions (loss-only-if-audited; or cheats surface at a rate independent of audits). A "fusion" note records that one external review proposed model heterogeneity (= the C cliques) and another proposed VRF honeypots (= the sealed random audit); neither alone was the theorem. Becker's ρ\*=G/(dB) and the ρ\*=0.25 arithmetic are correct; the C=8 trajectory and O(log T)/O(1) spend figures are internal (script: b2_tower.py).

---

## R8 — The work-unit machine

*Express lane: A durable "case file that outlives every clerk" with six invariants passes explicit-state model checking on all 536 reachable states, and disabling any one guard yields a short counterexample; see the box.*

**The scene.** Agents come and go mid-task — one starts a job, another finishes it, a third pays out. The *work item* has to survive all of them without letting a departed agent write with a stale badge, or paying an invoice twice, or marking something "verified" that nobody checked.

**The idea in one breath.** *Model the work item as a durable record with six safety rules, and prove by exhaustive search that no reachable sequence of agent actions can break any of them.*

**Intuition (structural analogy).** This is a hospital chart that outlives every shift of nurses. The chart, not the nurse, is the source of truth; a nurse whose shift ended (stale epoch) can't write orders; each medication is given at most once (idempotency); "administered" requires a signature (evidence-backed). The relation that maps over is a *state machine with invariants checked on every transition* — the same discipline as a filesystem journal that must never double-commit. (Misread to preempt: "passes all tests" here means *exhaustive* checking of a bounded model, not spot-testing — see the boundary.)

**The box.**
> State = (work-unit phase, acceptance policy, verifier receipt, role epoch + holder + stale token, grants with parentage, effect journal, idempotency journal, settlement). **Six invariants:** stale-epoch exclusion at the effect boundary; at-most-once external settlement per idempotency key; evidence-backed verification (V ⇒ policy ∧ receipt); capability attenuation (child scope ⊆ parent); fencing on reassignment; owner-funded receipted settlement.

**Numbers by hand.** The "stale write" attack in miniature: authorize (epoch 1) → start → reassign (epoch 2) → the old holder tries to write with epoch 1. Fencing compares write-epoch (1) to current epoch (2): 1 ≠ 2, write rejected — a 4-step counterexample. *Now you try:* how few steps to force a double-settle? (Two — settle, then settle again with the same idempotency key; the second is a no-op only if the invariant holds.)

**What it buys.** Harbor gets a settlement/handoff core with machine-checked guarantees against the exact failure modes that plague multi-agent economies (ghost writes, double-pay, hollow approvals).

**The honest boundary.** The proof is *bounded* model checking of the executable spec: **all 536 reachable states satisfy all six invariants**, and a mutation suite where disabling any single guard yields a shortest counterexample (stale write in 4 steps, double-settle in 2, hollow "verified" in 4, escalated delegation in 1, wrong-principal payout in 7 — walking the entire legitimate path before the one illegal step). Unbounded generalization is the TLA+/Apalache lift. The methodology (explicit-state checking + mutation testing, then a symbolic lift) is standard and sound; the 536 count and trace lengths are internal (script: c0_workunit.py).

---

## R9 — Sealed-room noninterference

*Express lane: Two distrustful parties share a sealed room whose only opening releases parity g(s)=s mod 2; an observer's view is provably identical for any two secrets of the same parity, verified exhaustively to depth 7 — this is noninterference modulo declassification; see the box.*

**The scene.** Derek brings private data; Erin brings a private model; neither trusts the other. They compute together in a sealed room with exactly one shutter, contracted to release a single agreed fact about Derek's secret — its parity (even or odd) — and nothing else.

**The idea in one breath.** *Everything Erin can observe depends on Derek's secret only through the one released fact — so two secrets with the same parity are perfectly indistinguishable to her.*

**Intuition (structural analogy).** This is a voting booth with a turnstile that clicks only your *party*, not your ballot. Anyone outside learns the party (the declassified function) and provably nothing finer. The relation that maps over is *noninterference modulo declassification* — Goguen–Meseguer noninterference (1982), weakened through a declassification "escape hatch" à la delimited release: the observer's view is a function of the secret *only* through g. (Misread to preempt: this bounds *channels*, not *minds* — it says the room leaks only parity, not that parity is safe to leak.)

**The box.**
> With secret s and released g(s) = s mod 2: **for any two secrets and every action interleaving, Erin's observations are identical whenever g(s) = g(s′)**, and may differ only at explicit gate-release steps otherwise (noninterference modulo declassification). The unwinding condition "local respect" (Derek-side actions never touch Erin-observable state; Goguen–Meseguer 1984) holds mechanically.

**Numbers by hand.** Secrets 0 and 2: both have parity 0 (0 mod 2 = 0, 2 mod 2 = 0), so an honest gate must keep Erin's view identical for them. A *leaky* gate that distinguished (0, 2) is caught precisely because they're an equal-parity pair the honest gate provably keeps identical. *Now you try:* should the gate keep secrets 1 and 2 identical? (No — different parity; the gate is *allowed* to reveal they differ.)

**What it buys.** Combined with R5: controllability says *gate the channel*; two-run equivalence says *the gate suffices* — together they justify Harbor's sealed-room design for mutually distrustful data/model owners.

**The honest boundary.** Verified *exhaustively* on the finite model (all interleavings to depth 7 × all secret pairs), with the schedule checked separately to be secret-independent (an enabledness difference would itself be a channel), and a gate-bypass mutation caught in 3 steps. The stated limits are honest and important: the guarantee is *possibilistic*; timing and termination channels are out of model; the gate specification is a residual oracle you must trust; and it bounds channels, not minds. Framework standard (Goguen–Meseguer; delimited release); the depth-7 exhaustiveness and caught mutations are internal (script: c1_noninterference.py).

---

## Verification caveats (condensed from the artifact)
Independently confirmed: R5's controllability condition and form; R6's contextuality identity; R7's Becker condition and ρ\*=0.25; R4's zero-miss corner R(0)=H(0.05)=0.286; R9's noninterference/declassification/unwinding framework and the equal-parity example. Not independently verifiable (regenerate from the bundled scripts, seed 20260816): R1's 0/16 and 8/14; R2's 2.13×/1.05–1.08×; R4's non-corner R-values and 15.3×; R6's 1.225; R7's trajectories and spend figures; R8's 536 states and trace lengths; R9's depth-7 counts. R4's two-constraint objective is a custom formulation, not the classical theorem. The "Feynman technique" is folklore with a real namesake; cite Sweller/Kalyuga instead.
