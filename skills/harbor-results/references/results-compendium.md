# Results Compendium — R1–R12 (precise statements, numbers, boundaries)

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

### R6 update (W8) — statistical harness rebuilt: verdict COMMIT
**Box.** In gossip of signed logs, the least-squares completion residual r = min over (global section, severed blocks) ‖g_known − (δx)|_known‖ detects equivocation beyond pairwise comparison iff the un-checked edge lies on a cycle AND its endpoints' reports are relayed to the analyst: r > 0 proves no global explanation exists. On a cut edge r = 0 by algebra (free block absorbs / tree-δ surjective); across a truly severed edge (no reports) equivocation is provably dark. Restriction maps must be coordinate-subset selections (shared-prefix): coker(δ) ≅ ⊕_c H¹(G_c) = cycle space ⊗ shared coords; random orthonormal projections collapse coker to 0 and kill the signal (the v1 defect).
**Numbers.** d=1 mechanism reproduced by the same general detector: C₆ relayed cycle edge r = 1.225, P₆ bridge 0.000. 200 trials/arm, seed 20260816, ℝ⁵ stalks, prefix sizes 2–4: partition-on-a-cycle split-view (two_path) 200/200 cohomology-only (pairwise blind); severed-cycle arm 0/200 (honest boundary); cut edge (single_bridge) max r = 1.5e-13 (float epsilon) over 400 trials; full visibility 0 cohomology-only, 200/200 redundant; expander with 3 severed + 3 relayed edges: partition-straddling equivocator 113/200 cohomology-only, 87 dark. Localization: max-residual edge on a known-graph cycle 200/200 [internal, sheaf_harness_v2.py]. Pre-registered gates (i) and (ii) PASS; CUT condition refuted (313 of 1101 residual detections pairwise-blind). Mutation suite: D1 reintroduction refused by structural self-check (coker 0 < β₁ 7); D2 reintroduction flagged (mutant "partition" residual bit-identical to full visibility); no-equivocator control 0/200.
**Buys.** Upgrades the W7 mechanism proof to a validated statistical harness; the Stage-1 gate of the prototyping plan is passed at the sharpened scope; Paper 7's detector is now the completion residual, with the three-tier visibility model (compared / relayed / severed) as the paper's observability contract.
**Boundary.** Detection requires the reports, not the check: cohomology reads relayed-but-unchecked evidence around cycles; severed links stay dark, cut edges silent — the v1 "detections" there were D2 artifacts (hidden-edge data). Vanishing r over ℝ is not an all-clear (abelianization gap, Carù). Topological β₁ netted out: the statistic is the data residual (honest ⇒ r ≡ 0), never dim H¹; structural coker printed separately (e.g. two_path: β₁ = 1, coker = 2).

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
1. **Price of a Summary** (R1–R4): substantively complete. 2. **Regimented or Enforced** (R5): core executed. 3. **Reputation is Amortized Verification** (R7): executed. 4. **Sealed Harbor** (R9 + R5 + R10 ε-ledger + R11 canaries): finite core done. 5. **Continuity Without Metaphysics** (B5/B6 pending). 6. **What Needs an Authority** (B4 pending). 7. **Cohomology of Equivocation** (R6): committed at exact scope. 8. **agentsd systems paper** (R8 substrate; trails product Phase 2–3).
**Remaining roadmap:** B4 tractable conflict fragment; B5 engine substitution, B6 probation cliff; C2 minimum-viable take-rate; lift R8→Apalache and R9→Isabelle.

## Treatise-corrections consensus (three independent reviews agreed; fix before anything ships)
Stage game isn't a PD (δ*≈0.253 claim void); exact-key uniqueness ≠ mutual exclusion (need conflict predicate + fencing epoch); identity theorem false as stated (10/2/0 counterexample; principal-aggregation is the repair); SDT direction reversed (fixed constructively by R3); float plan conflates requester funds with provider collateral (four buckets); Anchor must compare every edge, not node-to-root; WAL auto-checkpoint bounds pages not time (per-write durability types); cryptography attests commitments, not reality (typed evidence channels; five assurance levels).

## R10 — ε-conservation of the release ledger (A3)
**Box.** Release-ledger state (σ, Λ append-only): the only spending transition release(εᵢ) atomically appends (εᵢ, artifact hash, policy hash) and adds to σ; the gate refuses when σ+εᵢ > εmax. Every reachable state satisfies σ = Σ_Λ εᵢ and σ ≤ εmax — including concurrent invocation (single-writer serialization reduces any concurrent history to a sequential interleaving; induction unchanged). Meaning of the sum: sequential composition ⇒ (εmax, 0)-DP; advanced composition (Dwork–Rothblum–Vadhan FOCS 2010) ⇒ (√(2k ln(1/δ′))ε + kε(e^ε−1), δ′)-DP for long engagements.
**Numbers.** Exhaustive: 15 reachable states × all interleavings of two racing clients, 0 violations; 2000 randomized instances, 0 violations [internal, a3_epsilon_ledger.py]. Mutations: spend-without-append caught in 1 step; torn write (log ε, add ε−1) caught in 1 step and in 3 steps drives recorded Σ_Λ = 5 > εmax = 4 — auditable over-spend, so atomicity is what makes the budget auditable. Composition crossover at δ′=1e−6: k=32,ε=0.1 basic 3.20 < advanced 3.31; k=128,ε=0.05 basic 6.40 > advanced 3.30 [verified].
**Buys.** thm:cleanroom claim 2 executed; the clean-room budget line as an auditable invariant with bond-conservation's proof shape. Paper 4.
**Boundary.** Recorded spend only — complete mediation is B3/R5's assumption (hypervisor prerequisite). Advanced composition pays only past the k-crossover. The ledger conserves the meter, not the meaning: honest per-release εᵢ is the DP mechanism's obligation.

## R11 — Canary power and SPRT latency (A4)
**Box.** Per-canary FN rate β, independent ⇒ a k-canary leak is detected w.p. 1−β^k. Uniform planting of c canaries in n spans ⇒ a leak of m spans carries K~Hypergeom(n,c,m); power 1−E[β^K] ≈ 1−(1−(c/n)(1−β))^m — the operating curve Pr(detect)=f(leak size). Wald SPRT on gate outputs (p0 permutation null vs p1 leak), targets (α,b): E1[N] = [(1−b)ln((1−b)/α)+b ln(b/(1−α))]/KL(p1‖p0); Wald–Wolfowitz optimal.
**Numbers.** n=10⁴, c=100 (1%), β=0.2: power 0.554 at m=100, 0.999 at m=800; exact/approx/sim agree to MC precision; 1−β^k verified at k=1,2,5 [internal, a4_canary_sprt.py]. SPRT p0=1e−3, p1=1e−2, α=0.01, b=0.05: Wald E1[N]=297 vs sim 359 (overshoot; realized miss 0.048, FA 0.005 — at/below targets), E0[N]=432 vs 438; 10× intensity ⇒ ≈30× faster detection [internal].
**Buys.** thm:cleanroom claim 3 executed; the contract quotes detection probability and alarm latency; the exfiltration bond re-scoped to funding detection and response. Paper 4.
**Boundary.** Independence AND planting secrecy load-bearing: an adversary stripping the canary list w.p. 0.3 drops power 0.9997→0.698 at k=5 [internal]. β is measured, not assumed. Wald formulas ignore overshoot (~20% here). The SPRT half is for sustained leaks; single-shot exfiltration is the power half's job.

## R12 — No-mint reputation inheritance (A6)
**Box.** Discount-and-split as TRANSFER: a derivation with sources S, grant fractions w_p∈[0,1], discount γ∈(0,1] gives the child Σ_p γ·w_p·spend(p) and debits each source w_p·spend(p). Theorem: total live creditable Φ ≤ total witnessed W always, and Φ is nonincreasing except at witness steps (each derivation changes Φ by Σ(γ−1)w_p·spend(p) ≤ 0 — a supermartingale); cycles safe (re-derivation draws on the already-debited balance).
**Numbers.** Sweep-first refutation on record: the budget-only closure-sum phrasing is false for γ>1/2 (full-weight chain at γ=0.9: 0.9+0.81+0.729 = 2.44 > 1) [internal, a6_no_mint.py] — the counterexample forced the transfer restatement. Restated invariant: 4000 random DAGs (chains, diamonds, multi-parent merges, re-derivations), 0 violations, max live/witnessed ratio 0.999995. Copy-full-reputation mutant: 2-op shortest mint (Φ=2.8>W=1); 8-way copy-fork = 8.2× quorum multiplication [internal].
**Buys.** Gap #4 (skill-versioning cold start) closes safely; CDM distillation gets its economic safety proof; estate export/import inherits the conservation. Paper 5 / skill economy.
**Boundary.** Conserves the inherited prior only (descendants may earn new witnessed value — the point). γ and weights are policy choices the theorem constrains but does not pick. Sybil-resistance of witnessed leaves is the identity layer + R7's auditing, not this theorem. "Creditable" = the quorum-relevant live total.
