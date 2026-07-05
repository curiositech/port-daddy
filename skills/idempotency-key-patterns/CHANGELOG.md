# Changelog — idempotency-key-patterns

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/idempotency_key_patterns_audit.mjs`), draft-07
schema (`schemas/idempotency-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: the Stripe/IETF `Idempotency-Key` pattern — canonical Postgres schema
(Brandur Leach), fingerprint check, in-progress lock with 409, recovery-point state machine,
storage tradeoffs, retention/reaper, anti-patterns, and quality-gate checklist.
