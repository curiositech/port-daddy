# Changelog — background-job-queue-design

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with
frontmatter; added deterministic audit helper (`scripts/job_queue_design_audit.mjs`),
draft-07 schema (`schemas/background-job-queue-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: broker selection (BullMQ / Sidekiq / SQS / Temporal), idempotency
patterns, reliable fetch and visibility timeouts, error classification + DLQ, backoff
with jitter, Redis memory hygiene, graceful shutdown, queue-vs-workflow decision,
anti-patterns, and quality gates. Grounded in BullMQ, Sidekiq, AWS SQS, and Temporal docs.
