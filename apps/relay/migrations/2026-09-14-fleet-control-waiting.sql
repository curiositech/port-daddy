-- Replace the state constraint while preserving every admission/generation.
CREATE TABLE fleet_run_intents_control (
  delivery_id TEXT PRIMARY KEY,
  repo_full_name TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action TEXT,
  generation INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'admitting' CHECK (state IN (
    'admitting','queued','running','retrying','waiting_for_control','superseded',
    'enqueue_failed','success','failure','neutral','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  queued_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  last_progress_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  superseded_by TEXT,
  last_error TEXT,
  control_wait_count INTEGER NOT NULL DEFAULT 0,
  requeue_revision INTEGER,
  UNIQUE (repo_full_name, pr_number, generation)
);
INSERT INTO fleet_run_intents_control (
  delivery_id, repo_full_name, pr_number, pr_url, head_sha, event_type, action,
  generation, state, attempt_count, queued_at, started_at, last_progress_at,
  finished_at, superseded_by, last_error, control_wait_count)
SELECT delivery_id, repo_full_name, pr_number, pr_url, head_sha, event_type, action,
  generation,
  CASE WHEN state = 'retrying' AND last_error LIKE 'Fleet suspended:%'
    THEN 'waiting_for_control' ELSE state END,
  attempt_count, queued_at, started_at, last_progress_at, finished_at,
  superseded_by, last_error,
  CASE WHEN state = 'retrying' AND last_error LIKE 'Fleet suspended:%' THEN 1 ELSE 0 END
FROM fleet_run_intents;
DROP TABLE fleet_run_intents;
ALTER TABLE fleet_run_intents_control RENAME TO fleet_run_intents;
CREATE INDEX fleet_run_intents_pr_generation_idx ON fleet_run_intents (repo_full_name, pr_number, generation DESC);
CREATE INDEX fleet_run_intents_state_queued_idx ON fleet_run_intents (state, queued_at ASC);
CREATE INDEX fleet_run_intents_state_finished_idx ON fleet_run_intents (state, finished_at ASC);

-- One operator grant per suspension incarnation; request IDs cannot be replayed
-- to authorize a later suspension. Only signed webhook admission consumes it.
CREATE TABLE fleet_control_requeues (
  request_id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  control_wait_count INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  issuer TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (delivery_id, control_wait_count)
);
