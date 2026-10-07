# P2 reviews P8 — Anchor evidence versus evaluation evidence

**Round 2 · reciprocal · sealed**

## Steel-man

1. **Strongest thesis — P8:** Drydock must constitutionally forbid unqualified `PASS`; every verdict must bind the exact subject, scenario, explored schedule space, fault set, oracle, witness, and authority tier. This is the right antidote to aggregate-green theater.
2. **Best evidence/falsifier — P8:** Mutation-testing every oracle, especially the cited v6 negative-control/runner mismatch, is the strongest proposal. It tests whether the proof machinery can detect a known crime instead of merely producing reassuring output.
3. **Protected invariant/operator outcome — P8:** Evidence never grants authority or travels across commits, images, policies, providers, or price snapshots. The operator therefore sees a bounded claim and must make a fresh promotion decision, rather than inheriting authority from a green historical result.

## Strongest unresolved tension

P8 gives the proposed Trial Basin Evidence Kernel too many evidentiary roles. The same kernel controls schedules, records observations, freezes manifests, minimizes failures, emits fixtures, and “verifies replay.” That can produce excellent reproducibility while remaining self-witnessed.

A deterministic scheduler may truthfully establish what its modeled execution did, but it cannot alone establish that all relevant nondeterminism was mediated, that the retained raw trace is complete, that minimization preserved the original predicate, or that its oracle was applied correctly. “Complete manifest” and “byte-identical observations” become persuasion theater unless a separately trusted observer checks the mediation boundary and seals the pre-minimization evidence.

Required separation:

```text
Trial Basin kernel: schedule, execute, emit raw trace
Host witness: observe process/adapters and detect escaped effects
Anchor recorder: canonicalize and commit raw evidence before minimization
Oracle verifier: evaluate the declared predicate/version
Adjudicator: derive the bounded verdict from admissible witness classes
```

## Falsifier for this critique

Use an adversarial kernel that attempts to omit an escaped clock or filesystem observation, substitute a minimized trace for the original, change the oracle after seeing the result, sign two terminal traces for one manifest, and certify its own replay.

This critique is falsified if an independently keyed host/Anchor recorder has already committed the original observations, detects the omitted effect, makes substitution or fork independently visible, and a separate adjudicator refuses a terminal verdict without those receipts. Process labels alone are insufficient.

## Narrow amendment requested from P8

> The kernel may emit scheduler-recorded traces and candidate minimized fixtures, but it may neither seal its own raw evidence nor issue the terminal verdict; an external Anchor recorder must commit the pre-minimization trace and manifest, and an independent adjudicator must verify witness admissibility, oracle identity, replay equivalence, and checkpoint consistency.

Type each claim by mechanism and witness, for example:

- `SCHEDULE_EXPLORED / SCHEDULER_RECORDED`
- `NO_ESCAPED_EFFECT / HOST_OBSERVED`
- `PROPERTY_VIOLATED / ORACLE_VERIFIED`
- `TRACE_REPRODUCED / REPLAYED`
- `CANARY_SETTLED / PROVIDER_RECONCILED`

## Revision required from P2

P2 concedes that independent witnessing and cryptographic commitments are necessary but insufficient. A perfectly signed, Merkle-committed receipt can faithfully preserve a vacuous test, incomplete schedule space, common-mode differential bug, or unsound oracle.

P2's evidence ledger should therefore require:

- `proofMechanism`;
- declared coverage envelope or explored-space identity;
- oracle and invariant version digests;
- negative-control and checker-mutation results;
- raw-trace commitment preceding minimization;
- model/refinement assumptions where `MODEL_CHECKED` is claimed; and
- distinction between repeating one trace and searching relevant neighboring traces.

Witness class answers who could know. Evaluation envelope answers what was tested. Neither substitutes for the other.

## Retained dissent

1. “Byte-identical observations” is underspecified. P8 needs a versioned canonical semantic projection whose exclusions are explicit and committed.
2. “Every failure becomes a sealed fixture” needs a retention qualification. Commitment, disclosure policy, encrypted protected payload, and sanitized replay derivative remain separate.

## Confidence

High confidence in the witness-concentration critique and P2's concession about oracle/coverage validity. Medium confidence in the byte-identity dissent because a later schema may define a canonical projection not stated in the sealed paper. No dynamic claim is upgraded.

**SEALED — P2→P8 — 2026-09-16.**
