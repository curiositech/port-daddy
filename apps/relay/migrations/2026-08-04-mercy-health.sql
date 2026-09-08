-- MERCY v1 — hospital-ship health system (src/mercy.ts). Apply on the deployed
-- D1 with:
--   wrangler d1 execute port-daddy-relay -c wrangler.deploy.toml --remote \
--     --file=./migrations/2026-08-04-mercy-health.sql
--
-- Three tables:
--   mercy_probe     — the single scratch row the D1 read-after-write probe hits.
--   mercy_health    — one snapshot per cron sweep: per-subsystem statuses
--                     (JSON), the overall green/yellow/red verdict, and the
--                     remoteHarborsPossible bit. Pruned past 7 days.
--   mercy_incidents — one row per red episode per subsystem. The partial
--                     UNIQUE index (at most ONE unresolved incident per
--                     subsystem) IS the paging dedupe: a page is sent only when
--                     the opening INSERT wins, and paged_at pins delivery.

CREATE TABLE IF NOT EXISTS mercy_probe (
  k  TEXT    PRIMARY KEY,
  v  TEXT    NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mercy_health (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  at                      INTEGER NOT NULL,               -- unix seconds (sweep time)
  overall                 TEXT    NOT NULL CHECK (overall IN ('green','yellow','red')),
  remote_harbors_possible INTEGER NOT NULL,               -- 0/1 (D1 + DO channel not red)
  subsystems_json         TEXT    NOT NULL                -- [{name,status,latencyMs,detail}]
);
CREATE INDEX IF NOT EXISTS mercy_health_at_idx ON mercy_health (at);

CREATE TABLE IF NOT EXISTS mercy_incidents (
  id          TEXT    PRIMARY KEY,                        -- 'mi_' || randomHex(8)
  subsystem   TEXT    NOT NULL,
  opened_at   INTEGER NOT NULL,                           -- first red sweep
  resolved_at INTEGER,                                    -- first non-red sweep after
  paged_at    INTEGER,                                    -- when the webhook POST was DELIVERED
  detail      TEXT
);
-- The dedupe row: at most one unresolved incident per subsystem, ever.
CREATE UNIQUE INDEX IF NOT EXISTS mercy_incidents_open_uniq
  ON mercy_incidents (subsystem) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS mercy_incidents_opened_idx ON mercy_incidents (opened_at);
