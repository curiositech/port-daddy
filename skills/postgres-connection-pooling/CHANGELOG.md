# Changelog — postgres-connection-pooling

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/postgres_connection_pooling_audit.mjs`), draft-07
schema (`schemas/postgres-connection-pooling-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates. Appended a NOT-for clause to the
frontmatter description.

## [0.1.0]

Initial authoring: pool-mode decision diagram keyed on session-state usage, the pgBouncer
feature-compatibility table (session vs transaction "Never" features), the pgBouncer 1.21+
prepared-statement flip with client-side opt-outs, Supabase Supavisor port-per-mode pattern
(5432 vs 6543), AWS RDS Proxy pinning triggers and InitQuery mitigation, pg_stat_activity
leak diagnostics with idle_in_transaction_session_timeout, connection-string cheatsheet,
anti-patterns, novice/expert timeline, quality gates.
