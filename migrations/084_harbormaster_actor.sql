-- 084_harbormaster_actor.sql -- canonical Harbormaster actor record per ADR-0037.
--
-- Idempotent. Re-running this migration is a no-op.
--
-- Harbormaster is the named actor that owns merges of *dispatched* work
-- (ADR-0035). It does not touch operator-authored PRs. The body
-- (lib/harbormaster.ts) drives the merge_queue and respects the two-key
-- safety constraint: a row is merged only when its dispatch is
-- state='accepted' AND the merge_queue entry is state='queued'.
--
-- This migration depends on migration 082 (actor model, introduces the
-- `actors` table). When 082 has not yet landed in a given install, the
-- migration creates a minimal shim `actors` table so the canonical row
-- can still be seeded. The shim columns are a subset of the ADR-0022
-- schema; the actual 082 will replace them via ALTER TABLE in its own
-- BEGIN block.

BEGIN IMMEDIATE;

-- Defensive shim: if 082 has not yet created the actors table, create
-- the columns the harbormaster row needs. Real 082 will be additive.
CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  is_canonical INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'embodied',
  project_scope TEXT NOT NULL DEFAULT '*',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  mailbox TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_actors_canonical
  ON actors(is_canonical, project_scope);

-- Seed the canonical harbormaster row. INSERT OR IGNORE keeps re-run
-- idempotent: if 082 (or a previous run of 084) already inserted a row
-- with this id, we leave it alone. Capability tokens follow ADR-0037 §Identity.
INSERT OR IGNORE INTO actors (
  id,
  is_canonical,
  kind,
  project_scope,
  capabilities_json,
  mailbox,
  created_at
) VALUES (
  'harbormaster',
  1,
  'embodied',
  '*',
  '["merge:approve","merge:execute","merge:queue-manage","conflict:resolve","gh:write"]',
  'actor:harbormaster',
  strftime('%s', 'now') * 1000
);

COMMIT;
