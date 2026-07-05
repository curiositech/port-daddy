# Changelog — kafka-consumer-group-design

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/kafka_consumer_group_design_audit.mjs`), draft-07
schema (`schemas/kafka-consumer-group-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates. pairs-with covers
`idempotency-key-patterns`, `outbox-pattern-implementation` (shipped in this same
batch), and `observability-apm-expert`.

## [0.1.0]

Initial authoring: the three co-existing rebalance protocols (eager / cooperative / KIP-848
next-gen), assignment-strategy cheat sheet, the three liveness timeouts, at-most/at-least/
exactly-once commit patterns, the four DLQ patterns, five failure modes, a worked at-least-once
example, and quality-gate checklist. Sourced from Apache Kafka 4.2 docs and Confluent posts.
