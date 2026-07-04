# Changelog — circuit-breakers-and-retries

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with
frontmatter; added deterministic audit helper (`scripts/circuit_breaker_retry_audit.mjs`),
draft-07 schema (`schemas/circuit-breaker-retry-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: retry amplification math (64x product), the two-budget defense
(3 attempts + 10% ratio), circuit-breaker state machine with Resilience4j defaults and
slow-call detection, full-jitter backoff (Brooker), when-not-to-retry status table,
deadline propagation, the combined recipe, anti-patterns, and quality gates.
