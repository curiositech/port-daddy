# L3 Tacit Lessons — the hard-won knowledge behind the results

Load BEFORE extending, re-implementing, or designing anything adjacent to R1–R9. Each lesson: context → the mistake → the fix → the transferable rule → where it bit. These are the errors a fresh session will otherwise repeat.

## 1. The unpriced side channel (the meter bug)
**Context.** Falsifying the information floor (R1): simulate digests at budget B, measure miss rate against the floor.
**Mistake.** Gave the oracle encoder a perfect per-item score vector and charged B bits only for quantizing rank resolution (tie-breaking). Result: 8/14 apparent floor "violations."
**Fix.** Make B a literal message length: digest = encoder e:(features)→{0,1}^B, decoder d:{0,1}^B→(m-subset), shared data-independent codebook. Bits now gate *identification*. Violations → 0/16.
**Rule.** An information bound constrains what a channel carries; any simulation that appears to beat one is leaking through an unpriced side channel. Audit the meter before doubting the theorem — and before trusting the "refutation."
**Bit.** a7_experiment.py v1 vs v2; documented in Execution Report #1 §3.3. Repo: wrong turn at whitepaper/research/wrong-turns/a7_experiment.py; fixed at skills/harbor-results/scripts/a7_experiment.py.

## 2. Cohomology of the data, not the sheaf
**Context.** Testing whether sheaf cohomology detects equivocation (R6).
**Mistake #1.** Computed dim H¹(G;F) of the abstract sheaf. That is a property of the *restriction maps* — data-independent; with generic vector readouts the coboundary is surjective and H¹=0 regardless of any lie.
**Fix #1.** The right object is the obstruction of the *observed assignment*: is the disagreement cochain g in im(δ)? Its harmonic component (projection onto coker δ) is the equivocation signal — exactly the Abramsky–Brandenburger contextuality construction, which had been cited but not coded.
**Mistake #2.** Tested on two cliques joined by a single bridge. A bridge is a *cut edge*: it lies on no cycle, so it carries no cocycle constraint — the one topology where the method provably cannot help.
**Fix #2.** The value-add requires the uncompared edge to lie on a cycle (redundant paths). Minimal decisive case: C₆ with one uncompared edge — signal 1.225 while pairwise is blind; same lie on P₆'s bridge — signal 0.000.
**Rules.** (a) Sheaf invariants of the *space* vs obstructions of the *data* are different objects; equivocation/contextuality lives in the data. (b) Before crediting a topological method, check the topology admits the constraint (cycles for cocycles). (c) Topological β₁ contaminates any counting claim — net it out against the honest baseline.
**Bit.** sheaf_experiment.py (wrong twice) → sheaf_diagnosis.py (right). Repo: wrong turns at whitepaper/research/wrong-turns/{sheaf_experiment.py, sheaf_verdict.py}; working proof at skills/harbor-results/scripts/sheaf_mechanism_proof.py; rebuild spec HANDOFF §3.3.

## 3. Zoom's regime, stated or wrong
**Context.** Quantifying adaptive group-split inspection (R4).
**Mistake.** First comparison put k≈F·(2/3) positives inside the flagged set (flag rate 1.5p) — group testing's *worst* case; adaptive "advantage" came out at 0.5× (worse than flat).
**Fix.** Group splitting pays when positives are *sparse in the tested pool*: conservative over-flagging digests (F large, k small). There: 15.3× at F=2500,k=10, tracking k·log₂(F/k).
**Rule.** Every "X beats Y" claim carries a regime; find the regime where it flips and state both. The flip is often the more publishable sentence.
**Bit.** b1_experiment.py v1 vs b1_fix.py. Repo: whitepaper/research/wrong-turns/b1_experiment.py vs skills/harbor-results/scripts/b1_frontier.py.

## 4. Conventions change the headline number
**Context.** ρ* for the inspection game (R7).
**Fact.** Keep-gain convention: ρ* = G/(dB). Confiscation (capture forfeits the gain too): ρ*_c = G/(d(G+B)) — cheaper. Same game, ~17% different audit budget at the session parameters.
**Rule.** Before quoting an equilibrium threshold, pin the payoff convention to the *actual settlement rule*. Related forks recorded: amortization is Θ(log T) if losses occur only-if-audited but O(1) if cheats independently surface (rate r) — an empirical fork, not a modeling taste.
**Bit.** b2_tower.py derives both; the exemplar write-up states both.

## 5. Mutation-test the checker or it proves nothing
**Context.** Model-checking the work-unit machine (R8) and the sealed room (R9).
**Practice.** A green checker is unvalidated until seeded bugs turn it red: disable each guard / plant each leak and demand a counterexample. R8: all five guards proven critical with shortest crimes (4,2,4,1,7 steps). R9: leaky gate and bypass both caught with witness traces.
**Rules.** (a) Ship the mutation suite with the checker; the suite *is* the checker's certificate. (b) BFS gives shortest counterexamples — human-readable crimes, gold for exposition and debugging. (c) Note which crime needs the longest trace: R8's wrong-principal payout walks the entire legitimate path before the one illegal step — exactly how the fraud would look in production, so the test doubles as a detection playbook.
**Bit.** c0_workunit.py, c1_noninterference.py.

## 6. The schedule is a channel
**Context.** Two-run noninterference checking (R9).
**Insight.** If action *enabledness* depends on the secret, the interleaving structure itself leaks — before any observation content does. Check schedule secret-independence as a separate, prior verification.
**Rule.** In any two-run/purge-style security check, verify control-flow equality across secrets first; only then compare observations.
**Bit.** c1_noninterference.py `structure_check()`.

## 7. Pick mutation witnesses that prove the contract, not just a bug
**Context.** R9's leaky-gate mutation.
**Insight.** The caught witness distinguishes secrets (0,2) — an *equal-parity* pair the honest gate provably keeps identical. That single trace demonstrates "beyond the declared release" precisely, which a (0,1) witness (different parity, legally distinguishable) would not.
**Rule.** Choose/report the counterexample that violates the *contract*, not merely the implementation; it is simultaneously the sharpest test and the best expository example.

## 8. Gate the channel, never the token — proven twice
**Context.** Clean-room security (R5 + R9).
**Insight.** Token-level taint through an LLM is not soundly definable (everything read taints everything written). The compound policy "no egress after reading a secret" is regimentable *because* it permits the uncontrollable read (recording taint) and gates only the controllable egress (R5); two-run equivalence then shows the gate suffices (R9). One design rule, two independent proofs.
**Rule.** For any "prevent X after Y" policy where Y is uncontrollable: never try to forbid Y; record it and gate the controllable consequence. Claims of "mathematically cannot phone home" via token taint are overclaims — the honest claim is "every release is explicit, gated, and bounded."

## 9. Refute before you prove (the ordering that caught everything above)
**Context.** Program-wide discipline.
**Practice.** No bound is formalized until it survives an automated counterexample sweep; no speculative direction (sheaf) proceeds without a pre-registered commit-or-cut gate; wrong turns are *reported* (they locate boundaries — lessons 1–3 exist because of this).
**Rule.** The order is: sweep → gate → prove → mutation-test → expose with boundaries. Details and protocols: the falsification-first skill.

## 10. Super-additivity of split floors (a surprise worth remembering)
**Context.** Joint digests for two readers (R2).
**Fact.** Floor(N,2k,m) ≈ 2.1× Floor(N,k,m) — MORE than double (ratio over 2× is 1.05–1.08 across regimes), because log₂C(N,2k) grows faster than 2log₂C(N,k).
**Rule.** When two guarantees share one artifact, cost the union directly; "sum of the parts" can be an *under*-estimate for combinatorial floors. One stored compaction under-provisions divergent readers by more than 2×.
