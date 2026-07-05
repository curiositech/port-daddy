# Changelog — d1-and-supabase-migrations

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with
frontmatter; added deterministic audit helper
(`scripts/migration_plan_audit.mjs`), draft-07 schema
(`schemas/migration-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: the repair-vs-execute trap, direct psql over the pooler,
D1 --local/--remote discipline, idempotent migrations, NOT NULL on populated
tables, drift detection, verification-over-history, anti-patterns, and
quality-gate checklist.
