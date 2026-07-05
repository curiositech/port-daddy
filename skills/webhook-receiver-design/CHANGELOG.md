# Changelog — webhook-receiver-design

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/webhook_receiver_design_audit.mjs`), draft-07
schema (`schemas/webhook-receiver-design-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: HMAC verification over raw bytes, timing-safe comparison, replay
windows, DB-unique-constraint idempotency, the ack-fast-work-slow latency budget,
out-of-order reconciliation, dead-letter + replay tooling, provider-specific quirks
(Stripe/GitHub/Slack), anti-patterns, the 2am duplicate-charge worked example, and
quality gates.
