# Changelog — node-memory-leak-hunting

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/node_memory_leak_hunting_audit.mjs`), draft-07
schema (`schemas/leak-hunt-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: the confirm-before-chasing table, signal/programmatic snapshot capture,
the two-snapshot Comparison-mode diff, retainers vs dominators, the sampling heap profiler,
six common Node.js leak shapes, --max-old-space-size discipline, anti-patterns, and
quality-gate checklist. Sourced from the Node.js diagnostics docs and practitioner posts.
