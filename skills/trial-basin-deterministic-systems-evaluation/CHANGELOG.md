# Changelog

## 1.0.4 — 2026-09-21

- Enforce closed `EVIDENCE_CLASSES` vocabulary (`STATIC`, `MODEL`, `RUNTIME`, `HUMAN`) in `validateEvaluation`.
- Reject unsupported evidence classes such as `PRODUCTION` with `E_EVIDENCE_CLASS` and add adversarial mutation test case.

## 1.0.3 — 2026-09-17

- Reject result-vector statuses outside the closed evidence-state vocabulary.
- Add an adversarial status mutation that cannot bypass PASS evidence checks.

## 1.0.2 — 2026-09-17

- Require a positive integer mutation corpus and a non-negative integer killed count bounded by that corpus.
- Add zero, negative, and fractional mutation-count adversarial cases.

## 1.0.1 — 2026-09-17

- Closed the published JSON Schema root.
- Reject truth states outside the four-state evidence ladder and exercise the failure with an adversarial mutation.

## 1.0.0 — 2026-09-16

- Establish deterministic evaluation envelopes with sealed model, schedule, fault, oracle, witness, and promotion boundaries.
- Separate scheduler, subject, recorder, oracle, and adjudicator control domains.
- Require raw commitment before minimization, semantic replay, manifest-declared negative controls, and oracle mutation.
- Preserve typed subordinate results and static-versus-runtime evidence limits.
- Add a closed schema, executable example, semantic validator, activation corpus, and adversarial test bundle.
