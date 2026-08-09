-- X6 DEPRECATION MACHINERY (RFC 9745 Deprecation + RFC 8594 Sunset)
-- (docs/proposals/relay-grand-plan.md SX6; grand-plan DAG node
-- x6-deprecation-alias; src/deprecations.ts). Applied to staging by
-- deploy-relay.yml; prod via the migrations gate (ADR-0119). Additive only.
--
--   deprecations           - one row per deprecated surface, mirroring the
--                            code registry src/deprecations.json (the Worker
--                            middleware reads the JSON, NEVER this table on
--                            the hot path - the table exists so lifecycle
--                            questions are answerable by SQL and joinable
--                            against sightings).
--   deprecation_sightings  - last-seen per (deprecation, protocol, caller
--                            fingerprint), written ONLY by the retention
--                            sweep flushing the KV buffer - never by request
--                            handling. Cardinality is capped in code
--                            (SIGHTING_ROW_CAP); overflow folds into the
--                            synthetic '__overflow__' fingerprint.
--
-- The X6 deletion policy is a query over these tables: a surface may be
-- removed only when zero identities were seen in the last 30 days -
--   SELECT COUNT(*) FROM deprecation_sightings
--    WHERE deprecation_id = ? AND last_seen >= unixepoch() - 30*86400;
-- (surfaceRemovalAllowed in src/deprecations.ts).

CREATE TABLE IF NOT EXISTS deprecations (
  id               TEXT    PRIMARY KEY,           -- registry id, e.g. 'auth-unversioned'
  prefix           TEXT    NOT NULL,              -- deprecated path prefix, e.g. '/auth/'
  successor_prefix TEXT    NOT NULL,              -- canonical prefix, e.g. '/v1/auth/'
  deprecated_at    INTEGER NOT NULL,              -- unix seconds (UTC midnight)
  sunset_at        INTEGER,                       -- unix seconds; NULL = no sunset scheduled
  docs_url         TEXT,
  tombstoned       INTEGER NOT NULL DEFAULT 0,    -- 1 once the surface answers 410
  note             TEXT
);

CREATE TABLE IF NOT EXISTS deprecation_sightings (
  deprecation_id TEXT    NOT NULL,                -- deprecations.id
  protocol       TEXT    NOT NULL,                -- sanitized x-pd-protocol, or 'unversioned'
  fingerprint    TEXT    NOT NULL,                -- pseudonymous caller hash, 'anon', or '__overflow__'
  last_seen      INTEGER NOT NULL,                -- unix seconds
  last_path      TEXT,                            -- sample deprecated path, forensics only
  PRIMARY KEY (deprecation_id, protocol, fingerprint)
);
CREATE INDEX IF NOT EXISTS deprecation_sightings_seen_idx
  ON deprecation_sightings (deprecation_id, last_seen);

-- Seed rows mirror src/deprecations.json as of this migration. Later registry
-- changes ship as further additive migrations (never edits to this file).
INSERT OR IGNORE INTO deprecations
  (id, prefix, successor_prefix, deprecated_at, sunset_at, docs_url, tombstoned, note)
VALUES
  ('auth-unversioned', '/auth/', '/v1/auth/',
   unixepoch('2026-08-09'), unixepoch('2027-03-01'),
   'https://portdaddy.dev/docs/relay-deprecations', 0,
   'Bare /auth/* moved under /v1/. Pure alias: same handlers, byte-identical bodies.'),
  ('billing-unversioned', '/billing/', '/v1/billing/',
   unixepoch('2026-08-09'), unixepoch('2027-03-01'),
   'https://portdaddy.dev/docs/relay-deprecations', 0,
   'Bare /billing/* moved under /v1/. Pure alias: same handlers, byte-identical bodies.');
