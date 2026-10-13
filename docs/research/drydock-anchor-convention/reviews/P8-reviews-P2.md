# P8 reviews P2 — Evaluation adequacy versus provenance integrity

**Round 2 · reciprocal · sealed**

## Steel-man

1. **Strongest thesis/mechanism — P2:** Anchor belongs beneath Drydock as a field-level evidence ledger whose assertions identify witness class, witness identity, capture artifact, time bounds, and verification result. Signatures do not become truth, Merkle inclusion does not become non-equivocation, and adjudication remains separate from worker, broker, controller, and UI.
2. **Best evidence/falsifier — P2:** Paired fork and witness-substitution attacks are strong: produce two valid futures from one head and require independent checkpoint comparison; let a guest sign “network absent” and require `INCOMPLETE`; delay provider settlement and forbid promotion from bounded protocol authority to bounded financial loss.
3. **Invariant/operator outcome — P2:** No component requests, authorizes, executes, and certifies one effect; new body generations receive fresh narrowed grants; provider reconciliation, broker dispatch, and host lifecycle evidence remain separate. The operator sees `INCOMPLETE` when a required witness is absent.

## Strongest unresolved tension

P2 is provenance-complete but evaluation-incomplete.

`EvidenceEventV1` records `verificationMethod` and `verificationVerdict`, but the proposed schema does not require the exact proposition, subject/harness digests, oracle/model version, seed, virtual-time origin, schedule decisions or exploration bound, injected faults, generator/shrinker versions, negative controls, mutation results, coverage claim, or minimized counterexample fixture.

A cryptographically impeccable ledger can therefore preserve “tests passed” when the scheduler explored one interleaving, the generator never reached the dangerous state, or the checker became vacuous. Durable publication makes weak evidence harder to alter; it does not strengthen it.

The repository contains the warning case: `whitepaper/corpus.json` classifies the Harbor Card v6 multi-hop attack as a negative control, while `run-proverif.py` derives negative status from filename globs that do not match that model. P2's ledger could faithfully preserve the runner's verdict without detecting semantic-classification drift.

## Falsifier for this critique

The critique is falsified if a schema-valid P2 adjudication demonstrates without discretionary prose that:

- Removing schedule digest, exploration bound, fault map, oracle digest, or negative-control evidence invalidates a simulation/model-checking pass or returns `INCOMPLETE`.
- Replaying one manifest twice yields the same normalized semantic trace and terminal state.
- A seeded checker mutation is caught even when its output is correctly signed and included.
- The v6 manifest classification overrides filename convention and requires the expected false result.
- A minimized counterexample is content-addressed, replayable, and linked as the permanent repaired fixture.

## Narrow amendment requested from P2

Add a conditionally mandatory field:

`evaluationEnvelopeRef: digest<EvaluationEnvelopeV1>`

Require it for simulation, property testing, differential testing, model checking, replay, shadowing, or canary evaluation. The immutable envelope binds:

- claim identifier and exact proposition;
- subject, harness, model/oracle, policy, toolchain, and fixture digests;
- seed, virtual time, schedule trace or exploration bound, and fault plan;
- required and observed negative controls and checker mutations;
- empirical baseline, sample, exclusions, and uncertainty where applicable;
- raw and minimized failure-trace digests; and
- narrow result class: `PASS`, `FAIL`, `INCOMPLETE`, or `UNKNOWN`.

This authenticates P8's proof envelope without creating a competing ledger.

## Revision required from P8

P8 concedes that a deterministic trace is not self-authenticating. Trial Basin needs P2's field-level witness admissibility, key scope, bilateral receipts, and independently witnessed checkpoints. A simulator-controlled receipt cannot establish host containment, provider settlement, or non-equivocation because it is reproducible.

P8 also revises its byte-identity rule: deterministic core trace and normalized state projection are byte-identical for the same sealed manifest; evidence envelopes need not be. Observation timestamps, signatures, checkpoints, and independent attestations may differ while referring to the same semantic trace.

## Retained dissent

P8 rejects one synthesized terminal verdict across heterogeneous claims. A host-containment pass, model-checking pass, replay pass, and provider-reconciliation unknown remain a typed result vector with visible conflicts.

P2's falsifiers test evidence integrity and witness legitimacy more strongly than test adequacy. Anchor establishes what was committed and who observed it; Trial Basin establishes how aggressively the claim was challenged.

## Confidence

High confidence in the schema-level tension and amendment; medium confidence that no companion artifact already supplies the missing envelope. No runtime claim was tested.

**SEALED — P8→P2 — 2026-09-16.**
