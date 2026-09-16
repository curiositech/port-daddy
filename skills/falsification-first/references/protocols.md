# Protocols — the five obligations, executable form

## 1. Counterexample sweep (before any proof)
**Tool routing by claim type:**
- Algebraic inequality / closed form / root claims → Z3/cvc5 (nlsat is complete for existential reals) or a direct numpy grid+random sweep.
- Finite-game equilibrium claims → direct indifference/best-response check in numpy, or pygambit solvers; verify BOTH players' indifference to machine precision (R7 pattern: cheat payoff exactly 0 at ρ*).
- Stochastic-game / audit-schedule IC claims → pointwise deviation-value computation over the whole schedule: max deviation ≤ 0 (+ float epsilon).
- Safety/protocol claims → explicit-state BFS on a small instance before TLA+/Apalache investment (R8 pattern: 536 states in seconds).
- Information/impossibility bounds → build the *falsification apparatus* (the bound's own predicted frontier) and try to beat it with an oracle-strength adversary; surviving the oracle is the certificate (R1 pattern).
**Sweep hygiene:** fixed seed recorded (program convention 20260816); parameter ranges logged; "zero surviving counterexamples across the sweep" is the promotion criterion to proof effort.

## 2. Commit-or-cut gate design (before the speculative run)
Write, before any code runs: (a) the exact numeric success condition; (b) the exact CUT condition, phrased so the cheap baseline can win ("CUT if every detection is also caught by O(|E|) pairwise comparison"); (c) the regime/topology in which the method must show a *unique* win; (d) what a falsifying outcome looks like in one sentence. File the gate in the report whether it passes or cuts. Case law: the sheaf gate (harbor-results L3 lesson 2) — the pre-registered cut condition is why two failed formulations produced a boundary instead of a rationalization.

## 3. Meter-integrity audit (for experiments against bounds)
Checklist, run when designing AND when an experiment appears to beat a bound:
- [ ] Enumerate every input the decision procedure can see; for each, state what it could reveal about the hidden answer.
- [ ] Confirm the budgeted resource (bits, queries, opens) is charged for *identification of the answer*, not for a proxy (rank resolution, tie-breaking, formatting). The R1 meter bug: perfect scores in, bits charged only for quantization.
- [ ] Oracle test: give the strongest adversary/encoder the true answer and verify it STILL cannot beat the bound under the metered channel. If it can, the meter leaks.
- [ ] Structure/schedule test: verify control flow (enabledness, sequence structure) is independent of the secret/answer — the schedule is a channel (R9 `structure_check` pattern).
- [ ] Only after all boxes: consider that the theorem might be wrong.

## 4. Mutation-suite design (for checkers)
- One seeded bug per invariant/guard, minimum; prefer disabling the guard over corrupting data (tests the guard's necessity, not the generator).
- Demand a counterexample per seed; BFS so counterexamples are *shortest* — they double as human-readable crime scripts and exposition material.
- Record the trace lengths; the longest legitimate-prefix crime (R8's 7-step wrong-principal payout) is your production detection playbook.
- Pick contract-violating witnesses over merely implementation-violating ones (R9's equal-parity (0,2) leaky-gate witness proves "beyond the declared release"; a (0,1) witness would not).
- Restore-and-recheck: after reverting all mutations, the full property must pass again; ship suite + checker together — the suite is the certificate.

## 5. Wrong-turn report format + provenance
**Wrong-turn entry (file next to the success):** Context (what was being tested) → The mistake (what was computed/assumed) → Why it was wrong (the mechanism) → The fix → The transferable rule → Artifact pointers (v1 and v2 scripts, both retained).
**Numeric provenance:** every number in any write-up tagged **[verified]** (externally recomputable) or **[internal, script, seed]**. Wrong-turn numbers (the 8/14) are reported with the same tags as successes.
**Why this is non-negotiable:** the external exposition audit demonstrated outside readers cannot distinguish verified theorems from internal counts unaided; and the program's three most valuable boundaries (meter integrity, data-vs-sheaf, cycle-vs-cut) were all discovered *by* wrong turns that would have been invisible if unreported.

## Ordering (the pipeline, one line)
sweep → gate (if speculative) → prove → mutation-test → expose with tagged numbers, stated regimes, and filed wrong turns.
