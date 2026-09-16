-- X5 DIRECTORY + WHOIS — consent-first talent/skill search over harbors
-- (docs/proposals/relay-grand-plan.md §X5; doctrine D3 "no shadow index";
-- grand-plan-dag.md node directory-whois).
--
-- Additive only (ADR-0119 staging-soak lane; forward-only, rollback-compatible:
-- the previous Worker release never reads these tables). Named y1-* so it sorts
-- after every 2026-08-09 x*-prefixed migration regardless of merge order.
--
-- D3 AS SCHEMA: capability_index rows exist ONLY for operators whose
-- harbor_cards row carries listed = 1. Delisting deletes the derived rows at
-- the delist write AND the retention sweep re-enforces the invariant on every
-- fire (rows for unlisted fingerprints "do not exist", not "exist but aren't
-- served"). Derivation covers only events at/after listed_at.

-- Signed self-reports of declared capabilities (PUT /v1/harbor/card).
-- The signature is the daemon's own Ed25519 over the canonical card hash —
-- the relay verifies against the identities registry, it signs nothing.
CREATE TABLE IF NOT EXISTS harbor_cards (
  daemon_fingerprint TEXT PRIMARY KEY,             -- identities.daemon_fingerprint
  display_name       TEXT,                          -- optional, operator-published
  capabilities_json  TEXT    NOT NULL,              -- JSON array of declared capability strings
  card_iat           INTEGER NOT NULL,              -- unix seconds, signed into the card
  card_sig           TEXT    NOT NULL,              -- ed25519 hex over the canonical card hash
  listed             INTEGER NOT NULL DEFAULT 0,    -- 1 = consented to the public directory
  listed_at          INTEGER,                       -- consent instant; derivation floor (NULL when unlisted)
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_harbor_cards_listed ON harbor_cards(listed);

-- Demonstrated-capability signals, derived from chain heads and run verdicts —
-- an index over signatures, not self-reports. Rows exist only post-consent.
CREATE TABLE IF NOT EXISTS capability_index (
  daemon_fingerprint TEXT    NOT NULL,
  capability         TEXT    NOT NULL,              -- '*' = operator-level activity signal
  signal_kind        TEXT    NOT NULL,              -- 'chain-head' | 'run-verdict'
  source             TEXT    NOT NULL,              -- channel / run id the signal came from
  observed_at        INTEGER NOT NULL,              -- unix seconds (recency-decay input)
  weight             REAL    NOT NULL,              -- signed signal strength
  PRIMARY KEY (daemon_fingerprint, capability, signal_kind, source)
);

CREATE INDEX IF NOT EXISTS idx_capability_index_observed ON capability_index(observed_at);
CREATE INDEX IF NOT EXISTS idx_capability_index_fp ON capability_index(daemon_fingerprint);

-- Ranking weights — a single accountable row. Every change is ALSO written to
-- audit_log (action 'directory.ranking-weights.change'): down-weighting is
-- audited editorial power, never silent.
CREATE TABLE IF NOT EXISTS directory_ranking_weights (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  declared_weight     REAL    NOT NULL,             -- TF-IDF (declared) share
  demonstrated_weight REAL    NOT NULL,             -- recency-decayed demonstrated share
  half_life_days      REAL    NOT NULL,             -- demonstrated-signal decay half-life
  confidence_floor    REAL    NOT NULL,             -- refuse-to-route below this
  updated_at          INTEGER NOT NULL
);
