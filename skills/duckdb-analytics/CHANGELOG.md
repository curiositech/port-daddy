# Changelog — duckdb-analytics

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with
frontmatter; added deterministic audit helper
(`scripts/duckdb_pipeline_audit.mjs`), draft-07 schema
(`schemas/duckdb-pipeline-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: Parquet/CSV/JSON direct reads with pushdown, S3/httpfs and
R2, ATTACH Postgres/MySQL, partitioned ZSTD exports, Python/pandas integration,
MotherDuck, single-writer and read_csv_auto anti-patterns, and quality-gate
checklist.
