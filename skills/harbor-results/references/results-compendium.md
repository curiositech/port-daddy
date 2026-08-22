# Results Compendium — R1–R9 (precise statements, numbers, boundaries)

Provenance tags: **[verified]** = externally recomputable (closed form / textbook). **[internal]** = regenerates from the named script at seed 20260816 — all bundled in this skill's scripts/ directory (usage in SKILL.md). External audit note: an outside reader cannot distinguish the two unaided — always tag.

## R1 — Read-poverty and the information floor
**Box.** To guarantee catching all k load-bearing artifacts among N while opening only m, any digest must carry ≥ B* = log₂C(N,k) − log₂C(m,k) bits (each flagged m-set covers only C(m,k) of C(N,k) placements).
**Numbers.** N=60,k=2,m=8 ⇒ B*=5.98 bits [verified]. Falsification: encoder/decoder model (digest = literal B-bit message; decoder = shared codebook of m-subsets); oracle/noisy/random encoders: 0/16 floor violations [internal, a7_experiment.py]. Wrong-turn on record: 8/16 spurious violations when the meter charged bits only for tie-breaking (see l3-tacit-lessons #1).
**Buys.** Digest-budget floor for the operator surface; the program's first falsifiable-and-survived datum. Paper 1.
**Boundary.** Lower bound on a *zero-miss guarantee*; cheaper digests are fine at nonzero miss (R4). Worst-case combinatorial, not average-case.

## R2 — Split-digest theorem
**Box.** A scalar head serves a reader iff ranking by it realizes that reader's optimal selection at every budget; one head serves two readers iff their preference orders are comonotone. Successor (continuation value) and operator (regret-if-ignored) disagree on constructible pairs ⇒ no shared head.
**Numbers.** Joint zero-miss floor for disjoint reader-sets: Floor(N,2k,m) ≈ 2.13× Floor(N,k,m); super-additivity ratio Floor(2k)/(2·Floor(k)) ≈ 1.05–1.08 across regimes (e.g., N=60,k=2,m=8: 12.77 vs 5.98 bits) [verified arithmetic on the closed form].
**Buys.** Two compaction heads are a necessity, not taste; the SLM-sidecar architecture's theorem. Paper 1.
**Boundary.** Comonotone readers CAN share a head; the crossing pair must actually occur in the domain (it does: routine-essential file vs abandoned irreversible experiment).

## R3 — Derived regret head
**Box.** Inspect iff C_miss(x)·a(x) ≥ c_att + C_fa·(1−a(x)), with a(x)=Pr(bad|evidence) calibrated. stakes×irreversibility×anomaly equals expected unrecoverable loss of not inspecting iff anomaly = that posterior.
**Numbers.** C_miss=100, c_att=1, C_fa=5 ⇒ threshold a ≥ 6/105 ≈ 0.057 [verified]. Raising C_miss lowers the bar (fixes the source manuscript's reversed SDT direction).
**Buys.** Replaces three tuned knobs with one calibrated estimator; reputation can shift a(x) but never multiplies the score to zero on catastrophic-irreversible items. Paper 1; attention-queue product claim.
**Boundary.** "Calibrated" is a measured obligation (fit g from the audit log); with an uncalibrated score the product form is wrong by exactly the miscalibration.

## R4 — Digest-zoom Pareto frontier
**Box.** Two-constraint rate-distortion for Bernoulli(p): minimize I(X;X̂) s.t. false-negative rate ≤ δ and flag rate ≤ f. Zero-miss corner R(0, f→p) = H(p). Zoom-advantage: identifying k criticals inside F flagged takes ≈ k·log₂(F/k) group-split opens vs F flat.
**Numbers.** p=0.05: R(0)=H(0.05)=0.286 bits/sym [verified, Cover–Thomas]; R(0,0.10)=0.186, R(0.01,0.10)=0.110, R(0.04,0.06)=0.009 [internal, b1_frontier.py]. Zoom at F=2500,k=10: 15.3× fewer opens measured vs idealized ~31× ⇒ ≈2× practical overhead [internal].
**Buys.** The operator's three-way dial (bits/opens/misses) with exact exchange rates. Paper 1's theoretical heart.
**Boundary.** The two-constraint objective is a *custom formulation*, not the classical single-constraint theorem — position against RDC theory, don't cite as textbook. Zoom pays ONLY sparse-flagged (see anti-pattern).

## R5 — Hypervisor enforceability = supervisory control
**Box.** Events split into controllable Σ_c (fs_write, net_egress, exec_tool, git_push, spawn_child) and uncontrollable Σ_u (model_emit_token, in_context_read, internal_plan). Safety policy K regimentable iff controllable: K̄Σ_u ∩ L̄ ⊆ K̄ (Ramadge–Wonham 1987) [verified framework]. Runnable product-automaton checker classifies policies [internal, b3_controllability.py].
**Table.** forbid egress/push/write/exec/spawn → regimentable; forbid emit-token/context-read/internal-plan ("confident lie") → detect-only forever. Compound "no egress AFTER reading a secret" → **regimentable** (permits the uncontrollable read, records taint, gates the controllable egress).
**Buys.** Exact boundary between prevented and detected; the product's assurance-level claims; the clean-room design rule (channel, never token). Papers 2 and 4; unblocks R9's general form.
**Boundary.** Partial observation shrinks the regimentable set (Lin–Wonham observability) — policies referencing unmediated *state* need the extension. Detect-only ≠ hopeless: post-hoc slashing is R7's job.

## R6 — Sheaf verdict (cohomology of equivocation)
**Box.** In gossip of signed logs, cohomology detects equivocation beyond pairwise comparison iff the missing (uncompared) edge lies on a cycle: the cocycle condition (edge disagreements sum to zero around every loop for a global truth to exist) substitutes for the missing comparison; on a cut edge, nothing.
**Numbers.** C₆, scalar stalks: equivocation on an uncompared cycle edge ⇒ pairwise blind, harmonic signal 1.225 ≠ 0; same lie on a bridge (path P₆) ⇒ signal 0.000 [internal, sheaf_mechanism_proof.py]. Structural identity: Abramsky–Brandenburger contextuality (2011) [verified framework].
**Buys.** Federation-layer detection across never-reconciled links on loopy meshes; Paper 7, scoped exactly this narrowly.
**Boundary.** Complements, never replaces, forensic attribution (cohomology localizes; signatures attribute). Vanishing signal over ℝ is not an all-clear (abelianization gap, Carù). Topological β₁ must be netted out of any counting claim.

## R7 — Inspection tower
**Box.** Stage: deterrence iff ρdB ≥ G; ρ* = G/(dB) (Becker); confiscation ρ*_c = G/(d(G+B)); mixed NE q* = a/(dL). Tower: sealed sampling from C disjoint cliques, bribe floor β = ρdB; bribery profitable iff G_k > C·B, else G_{k+1} = (1−ρd)G_k — finite bond certifies unbounded depth. Amortization: ρ_t = G/(d(B+vt)) ⇒ Θ(log T) spend; with independent revelation rate r, ρ_t = max(0,(G−rvt)/(dB)) ⇒ O(1) = aG²/(2dBrv); flat = Θ(T).
**Numbers.** G=10,d=0.8,B=50 ⇒ ρ*=0.25 [verified]; cheat payoff exactly 0 at ρ* [internal, b2_tower.py]. C=1: 400→390→380 (linear life support); C=8: 0.8^k collapse from level 1 [internal]. IC pointwise ≤ 0 (machine epsilon).
**Buys.** Converts Conjecture III.11.1; fuses the two external reviews (heterogeneity = cliques; VRF honeypots = sealed audit). "Reputation is amortized verification." Paper 3.
**Boundary.** Convention-dependent ρ*; sealed sampling essential (a briber who learns the draw beats the math); honest root required; Θ(log T) vs O(1) is an empirical fork (do cheats surface without audits?).

## R8 — Work-unit machine
**Box.** State = (phase, policy, receipt, epoch+holder+stale-token, grants-with-parentage, effect journal, idempotency journal, settlement). Six invariants: stale-epoch exclusion at the effect boundary; at-most-once settlement per idempotency key; V ⇒ policy ∧ receipt; child scope ⊆ parent; fencing on reassignment; owner-funded receipted settlement.
**Numbers.** All 536 reachable states satisfy all six [internal, c0_workunit.py]. Mutation suite: every guard load-bearing; shortest crimes — stale write 4 steps (authorize→start→reassign→ghost writes with yesterday's epoch), double-settle 2, hollow verified 4, escalated delegation 1, wrong-principal payout 7 (walks the whole legitimate path first).
**Buys.** The formal spine (C0) of the re-spined volume; Phase-1 product promises as checked properties. Paper 8 substrate; Apalache lifts to unbounded.
**Boundary.** Bounded checking of the *spec*, not the daemon — deployment must refine the machine. Safety only; liveness needs fairness. The invariant list is certified to have teeth, not to be complete.

## R9 — Sealed-room noninterference
**Box.** With declared release g(s)=s mod 2: for any secrets and EVERY interleaving, Erin's observations are identical whenever g(s)=g(s′) and may differ only at gate-release steps otherwise (noninterference modulo declassification, Goguen–Meseguer lineage) [verified framework]. Unwinding "local respect" (Derek-side actions never touch Erin-observable state) holds mechanically.
**Numbers.** Exhaustive to depth 7 × all secret pairs; schedule secret-independence checked separately (an enabledness difference is itself a channel); leaky-gate mutation caught distinguishing (0,2) — an equal-parity pair the honest gate provably keeps identical; bypass caught in 3 steps [internal, c1_noninterference.py].
**Buys.** The airlock's headline, proven from two directions with R5 (controllability says gate the channel; two-run equivalence says the gate suffices). Paper 4's finite-model core; corrected product sentence: "every release is explicit, gated, and bounded."
**Boundary.** Possibilistic; timing/termination/side channels out of model; the gate's *specification* is the residual oracle (a too-leaky g is a contract failure no theorem prevents); bounds channels, not minds. General form = Isabelle/AFP Rushby unwinding.

## Paper map (status at codification)
1. **Price of a Summary** (R1–R4): substantively complete. 2. **Regimented or Enforced** (R5): core executed. 3. **Reputation is Amortized Verification** (R7): executed. 4. **Sealed Harbor** (R9 + R5 + ε-ledger/canaries pending): finite core done. 5. **Continuity Without Metaphysics** (B5/B6 pending). 6. **What Needs an Authority** (B4 pending). 7. **Cohomology of Equivocation** (R6): committed at exact scope. 8. **agentsd systems paper** (R8 substrate; trails product Phase 2–3).
**Remaining roadmap:** A3 ε-conservation, A4 canaries, A6 no-mint inheritance; B4 tractable conflict fragment; B5 engine substitution, B6 probation cliff; C2 minimum-viable take-rate; lift R8→Apalache and R9→Isabelle.

## Treatise-corrections consensus (three independent reviews agreed; fix before anything ships)
Stage game isn't a PD (δ*≈0.253 claim void); exact-key uniqueness ≠ mutual exclusion (need conflict predicate + fencing epoch); identity theorem false as stated (10/2/0 counterexample; principal-aggregation is the repair); SDT direction reversed (fixed constructively by R3); float plan conflates requester funds with provider collateral (four buckets); Anchor must compare every edge, not node-to-root; WAL auto-checkpoint bounds pages not time (per-write durability types); cryptography attests commitments, not reality (typed evidence channels; five assurance levels).
