-- ──────────────────────────────────────────────────────────────────────────
-- MERCY HOOKS (grand-plan DAG node x7-mercy-hooks; plan §X7; src/mercy-hooks.ts).
-- Sorts after 2026-08-09-mediator-body.sql (the 'z-' segment is deliberate:
-- lexicographic order is application order, and the summons-ack hook reads
-- the parley_summonses ledger that migration creates).
--
-- Additive only (ADR-0119 rule 3): three new tables + one nullable column.
--
--   1. mercy_hook_events        — the per-feature hook ledger. Hot paths
--      (publish quota refusals, run-report gaps) append one small row per
--      signal; the MERCY sweep aggregates and prunes. Append-only, bounded
--      by the sweep's retention delete.
--   2. squid_run_reconciliation — run-concluded reconciliation (X7 slice 2):
--      one row per executor run report, claimed-vs-received event totals.
--      gap != 0 is the honest loss metric fire-and-forget telemetry cannot
--      produce on its own.
--   3. mercy_slo_windows        — 5-minute SLO burn buckets (X7 slice 3):
--      per-window request/error counts written via ctx.waitUntil off the
--      response path; the sweep computes multiwindow burn from them.
--   4. mercy_health.hooks_json  — the sweep's per-feature hook verdicts ride
--      the same snapshot row the status surfaces already read (split-plane:
--      the cron writes, the pages only ever read stored rows).
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mercy_hook_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,                    -- unix seconds
  hook     TEXT    NOT NULL,                    -- e.g. 'x8_quota_exhausted'
  severity TEXT    NOT NULL CHECK (severity IN ('info','warn','crit')),
  detail   TEXT                                 -- operator-facing; never secrets
);
CREATE INDEX IF NOT EXISTS mercy_hook_events_hook_at_idx
  ON mercy_hook_events (hook, at);
CREATE INDEX IF NOT EXISTS mercy_hook_events_at_idx
  ON mercy_hook_events (at);

CREATE TABLE IF NOT EXISTS squid_run_reconciliation (
  run_id      TEXT    PRIMARY KEY,              -- 'run:<deliveryId>'
  channel     TEXT    NOT NULL,                 -- '<relayFp>:fleet-cloud:<runId>'
  sender      TEXT    NOT NULL,                 -- executor daemon fingerprint
  claimed     INTEGER NOT NULL,                 -- events the executor says it sent
  received    INTEGER NOT NULL,                 -- events rows the relay actually has
  gap         INTEGER NOT NULL,                 -- claimed - received (loss when > 0)
  reported_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS squid_run_reconciliation_at_idx
  ON squid_run_reconciliation (reported_at);

CREATE TABLE IF NOT EXISTS mercy_slo_windows (
  window_start INTEGER PRIMARY KEY,             -- unix seconds, floored to 300s
  requests     INTEGER NOT NULL DEFAULT 0,
  errors       INTEGER NOT NULL DEFAULT 0       -- HTTP 5xx only (4xx are the caller's)
);

ALTER TABLE mercy_health ADD COLUMN hooks_json TEXT;
