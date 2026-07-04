# Changelog — feature-flag-rollout-strategist

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with
frontmatter; added deterministic audit helper (`scripts/flag_rollout_audit.mjs`),
draft-07 schema (`schemas/flag-rollout-plan.schema.json`), verified sample
input (`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: flag-type taxonomy (release/experiment/operational/
kill-switch/circuit-breaker/permission) with lifetimes and owners, the
1-5-25-50-100 ramp, kill-switch and alert-driven circuit-breaker patterns,
cleanup/TTL discipline, provider-failure defaults, evaluation-context design,
OpenFeature-first vendor selection, anti-patterns, and quality-gate checklist.
