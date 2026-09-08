-- Aggregate, per-ship Workers AI call statistics for one Fleet run. Additive
-- and forward-only per this directory's README (ADR-0119).
--
-- Design notes:
--   * ONE row per (run_id, ship), flushed once when the ship finishes, not one
--     row per Workers AI call. A single ship's MAP phase can invoke
--     `aiCircuit.run()` once per diff chunk; logging every raw call would
--     multiply D1 write volume by chunk fan-out on a database that already
--     carries billing-critical spend rows (`fleet_run_spend`). The counts and
--     millisecond sums below are accumulated in memory across the whole
--     ship (see `FleetAiCircuit.runForShip` in apps/fleet-executor) and
--     written once, mirroring the existing `recordShipSpend` pattern.
--   * `timeouts` is a subset of `errors` (every FleetAiCallDeadlineError is
--     also a Workers AI failure) — kept separate so an operator can tell "the
--     provider was slow" apart from "the provider rejected the call" without
--     re-parsing detail JSON.
--   * `max_elapsed_ms` exists because a sum/average alone hides the one call
--     that nearly tripped the deadline; it is the number worth alerting on.
--   * No FOREIGN KEY to fleet_runs: this table is written best-effort, same
--     as fleet_run_spend, and must never fail a run over an orphaned or
--     out-of-order write.

CREATE TABLE IF NOT EXISTS fleet_ai_call_stats (
  run_id          TEXT    NOT NULL,
  ship            TEXT    NOT NULL,
  calls           INTEGER NOT NULL DEFAULT 0,
  ok_calls        INTEGER NOT NULL DEFAULT 0,
  timeout_calls   INTEGER NOT NULL DEFAULT 0,
  error_calls     INTEGER NOT NULL DEFAULT 0,
  total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  max_elapsed_ms  INTEGER NOT NULL DEFAULT 0,
  deadline_ms     INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (run_id, ship)
);

CREATE INDEX IF NOT EXISTS idx_fleet_ai_call_stats_ship
  ON fleet_ai_call_stats(ship, created_at DESC);
