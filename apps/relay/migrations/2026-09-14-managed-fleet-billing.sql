-- Managed Fleet billing stop-loss. Additive and forward-only.
--
-- These tables intentionally do not retrofit uniqueness onto credit_ledger or
-- fleet_run_spend: both legacy tables may contain duplicate historical rows.
-- The v2 spend identity starts clean with a deterministic (run_id, ship) key.
-- All money is integer micro-USD; REAL dollar columns are presentation-only
-- legacy state and are never consulted for admission or settlement here.

CREATE TABLE IF NOT EXISTS fleet_managed_entitlements (
  installation_id          INTEGER PRIMARY KEY,
  state                    TEXT    NOT NULL CHECK (state IN ('active', 'paused', 'revoked')),
  retail_balance_microusd  INTEGER NOT NULL CHECK (
    typeof(retail_balance_microusd) = 'integer' AND retail_balance_microusd >= 0
  ),
  run_retail_microusd      INTEGER NOT NULL CHECK (
    typeof(run_retail_microusd) = 'integer' AND run_retail_microusd > 0
  ),
  source_ref               TEXT    NOT NULL,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fleet_run_reservations (
  run_id                       TEXT    PRIMARY KEY,
  installation_id             INTEGER NOT NULL,
  retail_microusd              INTEGER NOT NULL CHECK (
    typeof(retail_microusd) = 'integer' AND retail_microusd > 0
  ),
  provider_cost_cap_microusd   INTEGER NOT NULL CHECK (
    typeof(provider_cost_cap_microusd) = 'integer'
    AND provider_cost_cap_microusd >= 0
    AND provider_cost_cap_microusd * 4 <= retail_microusd
  ),
  provider_cost_microusd       INTEGER CHECK (
    provider_cost_microusd IS NULL OR (
      typeof(provider_cost_microusd) = 'integer'
      AND provider_cost_microusd >= 0
      AND provider_cost_microusd <= provider_cost_cap_microusd
    )
  ),
  state                        TEXT    NOT NULL CHECK (state IN ('reserved', 'settled', 'released')),
  created_at                   INTEGER NOT NULL,
  updated_at                   INTEGER NOT NULL,
  settled_at                   INTEGER,
  released_at                  INTEGER,
  FOREIGN KEY (installation_id) REFERENCES fleet_managed_entitlements(installation_id),
  CHECK (
    (state = 'reserved' AND settled_at IS NULL AND released_at IS NULL AND provider_cost_microusd IS NULL)
    OR (state = 'settled' AND settled_at IS NOT NULL AND released_at IS NULL AND provider_cost_microusd IS NOT NULL)
    OR (state = 'released' AND released_at IS NOT NULL AND settled_at IS NULL AND provider_cost_microusd IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS fleet_run_reservations_installation_state_idx
  ON fleet_run_reservations (installation_id, state, created_at);

CREATE TABLE IF NOT EXISTS fleet_run_spend_v2 (
  run_id                    TEXT    NOT NULL,
  ship                      TEXT    NOT NULL,
  installation_id          INTEGER NOT NULL,
  model                     TEXT    NOT NULL,
  input_tokens              INTEGER NOT NULL CHECK (typeof(input_tokens) = 'integer' AND input_tokens >= 0),
  output_tokens             INTEGER NOT NULL CHECK (typeof(output_tokens) = 'integer' AND output_tokens >= 0),
  provider_cost_microusd    INTEGER NOT NULL CHECK (
    typeof(provider_cost_microusd) = 'integer' AND provider_cost_microusd >= 0
  ),
  created_at                INTEGER NOT NULL,
  PRIMARY KEY (run_id, ship),
  FOREIGN KEY (run_id) REFERENCES fleet_run_reservations(run_id),
  FOREIGN KEY (installation_id) REFERENCES fleet_managed_entitlements(installation_id)
);

CREATE INDEX IF NOT EXISTS fleet_run_spend_v2_installation_created_idx
  ON fleet_run_spend_v2 (installation_id, created_at);
