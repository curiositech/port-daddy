-- Durable admission ledger for Cloud Fleet review generations.
--
-- fleet_runs is written only after a queue consumer starts.  That made queued
-- work, duplicate deliveries, superseded PR heads, and retry timing invisible.
-- This additive table is written by the relay before queue.send() and updated
-- by the executor as attempts make progress.  Older Worker versions ignore it,
-- so the migration is safe to leave in place during a rollback.

CREATE TABLE IF NOT EXISTS fleet_run_intents (
  delivery_id        TEXT    PRIMARY KEY,
  repo_full_name     TEXT    NOT NULL,
  pr_number          INTEGER NOT NULL,
  pr_url             TEXT    NOT NULL,
  head_sha           TEXT    NOT NULL,
  event_type         TEXT    NOT NULL,
  action             TEXT,
  generation         INTEGER NOT NULL,
  state              TEXT    NOT NULL DEFAULT 'admitting'
                             CHECK (state IN (
                               'admitting', 'queued', 'running', 'retrying',
                               'superseded', 'enqueue_failed',
                               'success', 'failure', 'neutral', 'cancelled'
                             )),
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  queued_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at         INTEGER,
  last_progress_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at        INTEGER,
  superseded_by      TEXT,
  last_error         TEXT,
  UNIQUE (repo_full_name, pr_number, generation)
);

CREATE INDEX IF NOT EXISTS fleet_run_intents_pr_generation_idx
  ON fleet_run_intents (repo_full_name, pr_number, generation DESC);

CREATE INDEX IF NOT EXISTS fleet_run_intents_state_queued_idx
  ON fleet_run_intents (state, queued_at ASC);

CREATE INDEX IF NOT EXISTS fleet_run_intents_state_finished_idx
  ON fleet_run_intents (state, finished_at ASC);
