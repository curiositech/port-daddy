# Changelog — outbox-pattern-implementation

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/outbox_pattern_implementation_audit.mjs`), draft-07
schema (`schemas/outbox-pattern-implementation-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: the dual-write hazard and its fix, the canonical Debezium-compatible outbox
schema, polling-publisher vs CDC relay selection (with SKIP LOCKED loop and EventRouter SMT
config), pruning strategies including time-partitioning, consumer idempotency via DB unique
constraint, inbox pattern, when NOT to use the outbox, anti-pattern catalog, quality gates,
grounded in Debezium, Conduktor, microservices.io, and SeatGeek writeups.
