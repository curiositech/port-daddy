-- Migration: fleet_runs cost/token/model telemetry (2026-07-06)
--
-- The cloud fleet's PR-review executor (apps/fleet-executor) now captures the
-- Workers AI `usage` block on every ship call and derives cost, so a fleet run
-- records real spend instead of the reserved-null `neurons` stub. schema.sql
-- carries these columns for fresh databases; run THIS file once against an
-- EXISTING relay D1 to add them in place:
--
--   wrangler d1 execute port-daddy-relay \
--     --file=./migrations/2026-07-06-fleet-run-cost-telemetry.sql
--
-- SQLite has no ADD COLUMN IF NOT EXISTS; each statement is idempotent-safe only
-- on a DB that predates the columns. Re-running on an already-migrated DB errors
-- with "duplicate column name" — that is expected and harmless (no data change).

ALTER TABLE fleet_runs ADD COLUMN input_tokens INTEGER;   -- summed Workers AI prompt tokens
ALTER TABLE fleet_runs ADD COLUMN output_tokens INTEGER;  -- summed Workers AI completion tokens
ALTER TABLE fleet_runs ADD COLUMN cost_usd REAL;          -- derived USD cost; NULL when no model priced
ALTER TABLE fleet_runs ADD COLUMN models_csv TEXT;        -- distinct Workers AI model ids used
-- `neurons` already exists (reserved since Phase C) and is now populated with
-- total tokens (input+output); no ALTER needed for it.
