# Agent Resurrection and Body Continuity — Changelog

## v1.0.1 (2026-09-14)

- Recomputed effect fingerprints from logical identity, operation,
  destination, normalized arguments, and approval slot.
- Sealed resurrection capsule semantics under an explicit digest scope and
  bound signature-verification receipts to the digest, signer, algorithm, and
  signature bytes.
- Validated referenced capacity evidence structurally and semantically after
  content-addressing it.
- Made native-resume mode and verdict bidirectional and required an exclusive
  lease receipt on either assertion.

## v1.0.0 (2026-09-11)

- Established `AgentNode` as the durable person and `BodyLease` as a temporary,
  generation-fenced embodiment.
- Separated takeover, durable-session reactivation, identity resurrection, and
  ordinary rebodiment.
- Added cold-birth, process-loss, provider-loss, native-resume, and cross-family
  successor procedures.
- Required effect reconciliation, artifact-backed capsules, fresh capability
  translation, native-unit capacity reservations, external witnesses, and one
  retry owner.
- Added schema, template, synthetic example, activation cases, and adversarial
  protocol references.
- Added verdict-conditioned schema constraints, a semantic validator, an unsafe
  ready fixture, content-addressed capacity evidence, and an execution-class
  boundary that prevents fake evidence from authorizing real-provider work.
