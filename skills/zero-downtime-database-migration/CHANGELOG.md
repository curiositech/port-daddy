# Changelog — zero-downtime-database-migration

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/zero_downtime_database_migration_audit.mjs`),
draft-07 schema (`schemas/zero-downtime-database-migration-plan.schema.json`), verified
sample input (`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: Postgres lock levels and the lock queue, pg11+ safe ADD COLUMN,
CREATE INDEX CONCURRENTLY, NOT VALID -> VALIDATE FK adds, expand/contract renames,
batched backfills, Stripe's 4-step dual-writes pattern, gh-ost vs pt-online-schema-change,
verification before contract, anti-patterns, quality gates, and cited primary sources.
