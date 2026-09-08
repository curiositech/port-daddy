-- Steward seat — append-only ledger tables (THE_FULL_WHEEL.md §4; ADR-0109).
--
-- These extend the shared `port-daddy-relay` D1 database alongside the fleet's
-- fleet_runs / fleet_run_steps fabric. Both tables are append-only by doctrine:
-- the seat's code exposes no UPDATE or DELETE path, and the schema is designed
-- to be read as history — a merge ledger you can audit years later, and a deck
-- log whose gaps are themselves evidence (a wake that wrote no entry is a
-- failed wake).
--
-- Apply with:
--   wrangler d1 execute port-daddy-relay --file=./schema.sql

-- One row per wake, ALL QUIET included — the seat's vital sign.
CREATE TABLE IF NOT EXISTS steward_deck_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_full_name TEXT NOT NULL,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('wake', 'all-quiet')),
  summary TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  wake_events INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steward_deck_log_repo_time
  ON steward_deck_log (repo_full_name, created_at);

-- Every verdict the seat ever renders. The CHECK pins the three-valued
-- vocabulary at the storage layer too — this table is the merge history of
-- record, so the type system alone is not enough defense.
CREATE TABLE IF NOT EXISTS steward_merge_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_full_name TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('LAND', 'NEEDS-WORK', 'SURFACE')),
  evidence TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steward_merge_ledger_repo_pr
  ON steward_merge_ledger (repo_full_name, pr_number, created_at);
