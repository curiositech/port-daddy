# Changelog — postgres-row-level-security

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/postgres_row_level_security_audit.mjs`), draft-07
schema (`schemas/postgres-row-level-security-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: CREATE POLICY syntax, USING vs WITH CHECK, PERMISSIVE/RESTRICTIVE merge
semantics, canonical Supabase patterns, PostgREST role wiring, the (SELECT auth.uid())
subselect benchmark table, BYPASSRLS / SECURITY DEFINER bypass paths, anti-patterns, and
quality gates. Grounded in postgresql.org, Supabase docs, and Gary Austin's RLS-Performance
benchmarks.
