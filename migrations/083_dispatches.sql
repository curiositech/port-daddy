-- 083_dispatches.sql -- dispatches table per ADR-0035.
--
-- Renames PR #143's `nightshift_intents` to `dispatches`, expands the column
-- set to the ADR's schema (requested_by, target_actor_id, worker_actor_id,
-- reviewer_actor_id, base_branch, merge_policy, etc.), and replaces the
-- nightshift status enum with the dispatch 8-state machine plus terminals.
--
-- Idempotent. Safe to run before 082_actor_model.sql lands -- the FK columns
-- to actors / body_leases are stored as plain TEXT here. A follow-up
-- migration (after 082) tightens them to REFERENCES.
--
-- The migration also copies any rows from `nightshift_intents` into
-- `dispatches`. The legacy `nightshift_intents` table is kept in place so a
-- rollback can fall back to the PR #143 schema if needed; it can be
-- dropped in a later migration once the operator confirms no stale tooling
-- still reads from it.
--
-- The runtime daemon's lib/dispatch/queue.ts module ALSO calls
-- CREATE TABLE IF NOT EXISTS dispatches and a migrateNightshiftIntents()
-- step at construction time -- that path covers the in-process daemon. This
-- migration file is the offline / sortie / fresh-install path.

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS dispatches (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  goal TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'proposed'
    CHECK(state IN (
      'proposed','claimed','in_progress','produced','review_pending',
      'accepted','rejected','settled','failed','salvage'
    )),
  requested_by TEXT NOT NULL DEFAULT 'operator',
  target_actor_id TEXT,
  worker_actor_id TEXT,
  reviewer_actor_id TEXT,
  base_branch TEXT NOT NULL DEFAULT 'main',
  backend TEXT,
  budget_usd REAL,
  timeout_ms INTEGER,
  worktree_path TEXT,
  branch TEXT,
  session_id TEXT,
  result_artifact TEXT,
  cost_usd REAL,
  duration_ms INTEGER,
  error_message TEXT,
  merge_policy TEXT NOT NULL DEFAULT 'review'
    CHECK(merge_policy IN ('review','auto','never')),
  reject_reason TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  started_at INTEGER,
  produced_at INTEGER,
  reviewed_at INTEGER,
  settled_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dispatches_state
  ON dispatches(state, created_at);
CREATE INDEX IF NOT EXISTS idx_dispatches_slug ON dispatches(slug);
CREATE INDEX IF NOT EXISTS idx_dispatches_base_branch
  ON dispatches(base_branch, state);

-- Ensure the legacy table exists (as an empty shell) so the INSERT below
-- parses on fresh installs that never had nightshift_intents. The shell has
-- the columns we copy from; if PR #143 already created it, this is a no-op.
CREATE TABLE IF NOT EXISTS nightshift_intents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  intent TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'proposed',
  backend TEXT,
  budget_usd REAL,
  timeout_ms INTEGER,
  worktree_path TEXT,
  branch_name TEXT,
  session_id TEXT,
  pr_url TEXT,
  cost_usd REAL,
  duration_ms INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  queued_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  reviewed_at INTEGER
);

-- Copy any nightshift_intents rows that aren't already in dispatches.
-- INSERT OR IGNORE keeps this migration idempotent: re-running it does
-- nothing to already-migrated rows.
--
-- Status mapping (mirrors lib/dispatch/queue.ts:legacyStatusToState):
--   proposed  -> proposed
--   queued    -> claimed
--   running   -> in_progress
--   succeeded -> settled
--   failed    -> failed
--   aborted   -> failed
--   timeout   -> failed
--   cancelled -> salvage
INSERT OR IGNORE INTO dispatches (
  id, slug, goal, tags_json, state, requested_by, base_branch, backend,
  budget_usd, timeout_ms, worktree_path, branch, session_id,
  result_artifact, cost_usd, duration_ms, error_message,
  merge_policy, created_at, claimed_at, started_at, produced_at,
  reviewed_at, settled_at
)
SELECT
  id,
  slug,
  intent,
  tags_json,
  CASE status
    WHEN 'proposed'  THEN 'proposed'
    WHEN 'queued'    THEN 'claimed'
    WHEN 'running'   THEN 'in_progress'
    WHEN 'succeeded' THEN 'settled'
    WHEN 'failed'    THEN 'failed'
    WHEN 'aborted'   THEN 'failed'
    WHEN 'timeout'   THEN 'failed'
    WHEN 'cancelled' THEN 'salvage'
    ELSE 'proposed'
  END,
  'operator',
  'main',
  backend,
  budget_usd,
  timeout_ms,
  worktree_path,
  branch_name,
  session_id,
  pr_url,
  cost_usd,
  duration_ms,
  error_message,
  'review',
  created_at,
  queued_at,
  started_at,
  CASE WHEN pr_url IS NOT NULL THEN completed_at ELSE NULL END,
  reviewed_at,
  completed_at
FROM nightshift_intents;

COMMIT;
