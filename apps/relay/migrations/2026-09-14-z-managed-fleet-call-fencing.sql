-- Per-delivery execution fence and per-provider-call stop-loss accounting.
ALTER TABLE fleet_run_reservations ADD COLUMN lease_owner TEXT;
ALTER TABLE fleet_run_reservations ADD COLUMN lease_fence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fleet_run_reservations ADD COLUMN lease_expires_at INTEGER;

CREATE TABLE IF NOT EXISTS fleet_run_call_authorizations (
  authorization_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  lease_fence INTEGER NOT NULL,
  call_sequence INTEGER NOT NULL,
  attempt_id TEXT NOT NULL,
  ship TEXT NOT NULL,
  model TEXT NOT NULL,
  max_input_tokens INTEGER NOT NULL CHECK (max_input_tokens >= 0),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens >= 0),
  authorized_cost_microusd INTEGER NOT NULL CHECK (authorized_cost_microusd >= 0),
  actual_cost_microusd INTEGER CHECK (actual_cost_microusd IS NULL OR actual_cost_microusd >= 0),
  state TEXT NOT NULL CHECK (state IN ('authorized', 'reported', 'unreported', 'failed')),
  created_at INTEGER NOT NULL,
  reconciled_at INTEGER,
  UNIQUE (run_id, lease_fence, call_sequence),
  FOREIGN KEY (run_id) REFERENCES fleet_run_reservations(run_id)
);

CREATE INDEX IF NOT EXISTS fleet_run_call_authorizations_run_idx
  ON fleet_run_call_authorizations (run_id, state, created_at);
