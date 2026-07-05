# Changelog — postgres-explain-analyzer

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/postgres_explain_analyzer_audit.mjs`), draft-07
schema (`schemas/postgres-explain-analyzer-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: EXPLAIN (ANALYZE, BUFFERS) reading guide, node-type table, planner-mismatch
causes, index-type selection, autovacuum tuning, pg_stat_statements workflow, anti-patterns,
and the post-deploy p99-cliff worked example.
