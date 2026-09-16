-- Bounded, repository-scoped ship history reads. Additive; no data removal.
CREATE INDEX IF NOT EXISTS fleet_runs_repo_created_idx
  ON fleet_runs (repo_full_name COLLATE NOCASE, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS fleet_run_spend_run_created_idx
  ON fleet_run_spend (run_id, created_at DESC);
