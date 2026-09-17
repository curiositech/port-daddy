# C-P2 — Bind evaluation adequacy separately from provenance

## Steel-man

P8 correctly shows that P2's ledger can authenticate and preserve a signed “test passed” assertion while failing to establish that the proposition, harness, oracle, explored schedules, faults, negative controls, and coverage adequately support it.

## Correction ledger

- **Disposition:** `ACCEPT`
- **Exact claim delta:** An `EvidenceEventV1` carrying a simulation, test, model, replay, shadow, or canary claim MUST include `evaluationEnvelopeRef: digest<EvaluationEnvelopeV1>`. The immutable envelope binds the exact proposition; subject, harness, model or oracle, policy, toolchain, and fixture digests; applicable seed, virtual time, schedule trace or exploration bound, and fault plan; required and observed negative controls and checker mutations; applicable empirical sample, exclusions, and uncertainty; raw and minimized failure-trace digests; and a typed `PASS | FAIL | INCOMPLETE | UNKNOWN` result. Missing, mismatched, or incomplete required envelopes force `INCOMPLETE`; signatures and Merkle inclusion cannot cure the defect.
- **Preserved invariants:** Signatures bind signers to bytes, not claims to truth. Evaluation metadata does not replace an admissible witness class. Provenance integrity and evaluation adequacy remain orthogonal. External claims still require their named witnesses. Heterogeneous results remain a typed vector rather than one synthesized green verdict.
- **Retained dissent:** A complete envelope makes a challenge inspectable but does not prove the challenge was strong enough; a correctly signed and committed weak evaluation may still be `UNKNOWN` or `INCOMPLETE`.
- **Evidence locators:** `positions/P2-anchor-evidence-and-verification.md`; `reviews/P8-reviews-P2.md`; `synthesis/manager-extraction-r1.md`.
- **Truth labels:** Existing position and critique are `SOURCE_PRESENT`; `EvaluationEnvelopeV1` is `PROPOSED`; dynamic adequacy, replay, and canary behavior are `BLOCKED_BY_HALT`.
- **Consensus-kernel impact:** No kernel change. This concretizes the existing provenance/evaluation seam.
