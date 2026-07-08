-- Port Daddy Relay v0 — D1 Schema
-- Apply with: wrangler d1 execute port-daddy-relay --file=./schema.sql --remote
-- See ADR-0049 for field-level documentation.
--
-- NOTE: no `PRAGMA journal_mode` here. D1 manages journaling itself and its
-- SQL authorizer rejects PRAGMA writes with SQLITE_AUTH, which aborts the whole
-- batch. D1 is already WAL-style under the hood, so the pragma was both
-- forbidden and unnecessary.

CREATE TABLE IF NOT EXISTS identities (
  daemon_fingerprint TEXT    PRIMARY KEY,
  pub_key            TEXT    NOT NULL,
  proof_method       TEXT    NOT NULL CHECK (proof_method IN ('oidc','acme','wot')),
  proof_metadata     TEXT    NOT NULL,
  expires_at         INTEGER,
  revoked            INTEGER NOT NULL DEFAULT 0,
  revoked_reason     TEXT,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS harbor_members (
  harbor_fingerprint TEXT    NOT NULL,
  daemon_fingerprint TEXT    NOT NULL,
  admitted_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (harbor_fingerprint, daemon_fingerprint)
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT    PRIMARY KEY,
  fingerprint  TEXT    NOT NULL,
  nonce_c      TEXT    NOT NULL,
  nonce_s      TEXT    NOT NULL,
  subs_json    TEXT    NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender       TEXT    NOT NULL,
  channel      TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  prev_hash    TEXT    NOT NULL,
  this_hash    TEXT    NOT NULL,
  iat          INTEGER NOT NULL,
  arrived_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  ciphertext   TEXT    NOT NULL,
  sig          TEXT    NOT NULL,
  UNIQUE (sender, channel, seq)
);
CREATE INDEX IF NOT EXISTS events_channel_idx ON events (channel, arrived_at);

CREATE TABLE IF NOT EXISTS chain_heads (
  sender       TEXT NOT NULL,
  channel      TEXT NOT NULL,
  tip_seq      INTEGER NOT NULL,
  tip_hash     TEXT NOT NULL,
  issued_at    INTEGER NOT NULL,
  signed_head  TEXT NOT NULL,
  anchors_json TEXT,
  PRIMARY KEY (sender, channel)
);

CREATE TABLE IF NOT EXISTS revocations (
  jti             TEXT    PRIMARY KEY,
  revoked_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  revoking_daemon TEXT    NOT NULL,
  reason          TEXT
);

-- All OIDC issuers the relay trusts. Operator manages via PUT /v1/config/issuers/:id.
CREATE TABLE IF NOT EXISTS issuers (
  issuer_id   TEXT    PRIMARY KEY,
  jwks_uri    TEXT    NOT NULL,
  audience    TEXT    NOT NULL,
  disabled    INTEGER NOT NULL DEFAULT 0,
  disabled_at INTEGER,
  last_fetch  INTEGER
);

-- S5: OIDC JTI deduplication — each OIDC token redeemable exactly once.
CREATE TABLE IF NOT EXISTS oidc_exchanges (
  oidc_jti           TEXT    PRIMARY KEY,
  exchanged_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  daemon_fingerprint TEXT    NOT NULL
);

-- Seed GitHub Actions OIDC issuer.
INSERT OR IGNORE INTO issuers (issuer_id, jwks_uri, audience)
VALUES (
  'https://token.actions.githubusercontent.com',
  'https://token.actions.githubusercontent.com/.well-known/jwks',
  'https://github.com/curiositech'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  at                 INTEGER NOT NULL DEFAULT (unixepoch()),
  daemon_fingerprint TEXT,
  action             TEXT    NOT NULL,
  target             TEXT,
  ip                 TEXT,
  detail             TEXT
);
CREATE INDEX IF NOT EXISTS audit_log_fp_idx ON audit_log (daemon_fingerprint, at);

-- ──────────────────────────────────────────────────────────────────────────
-- Phase C: fleet observability — transcript + audit trail (ADR-0049 follow-on)
--
-- The fleet-executor writes one fleet_runs row per GitHub delivery (the audit
-- header: PR context + final conclusion + wall time) and an append-only stream
-- of fleet_run_steps (the immutable transcript: MAP chunks, REDUCE, findings,
-- verdicts, posts, check completion). The relay's operator-gated read endpoints
-- (/v1/fleet/activity, /v1/fleet/runs/:id, /v1/fleet/health) project these for
-- the pd-console Cloud Fleet pane.
-- ──────────────────────────────────────────────────────────────────────────

-- One row per GitHub delivery / fleet execution.
CREATE TABLE IF NOT EXISTS fleet_runs (
  id                 TEXT    PRIMARY KEY,         -- UUID or delivery_id hex
  delivery_id        TEXT    NOT NULL UNIQUE,     -- GitHub webhook deliveryId (idempotency key)
  repo_full_name     TEXT    NOT NULL,            -- owner/repo
  pr_number          INTEGER NOT NULL,            -- GitHub PR number
  pr_url             TEXT    NOT NULL,            -- https://github.com/owner/repo/pull/NN
  head_sha           TEXT    NOT NULL,            -- commit SHA
  conclusion         TEXT    NOT NULL,            -- 'success'|'failure'|'neutral'|'cancelled'|'pending'
  ships_csv          TEXT    NOT NULL,            -- comma-separated ship names that ran
  neurons            INTEGER,                     -- reserved (Phase D): total AI token spend
  ms                 INTEGER NOT NULL,            -- wall-clock elapsed milliseconds
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS fleet_runs_created_idx ON fleet_runs (created_at DESC);

-- Immutable transcript of each step within a run.
CREATE TABLE IF NOT EXISTS fleet_run_steps (
  run_id             TEXT    NOT NULL,            -- FK to fleet_runs.id
  seq                INTEGER NOT NULL,            -- 0-indexed step sequence within the run
  kind               TEXT    NOT NULL,            -- 'map-chunk'|'reduce'|'ship-finding'|'ship-verdict'|'review-posted'|'check-completed'
                                                  -- Reserved (Phase D): 'thinking'|'tool-call'|'chat-rpc'
  ship               TEXT,                        -- ship name (null for reduce/review/check)
  title              TEXT    NOT NULL,            -- one-line summary
  detail             TEXT,                        -- JSON blob (findings, verdict line, metadata, etc.)
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (run_id, seq)
);
CREATE INDEX IF NOT EXISTS fleet_run_steps_run_idx ON fleet_run_steps (run_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Fleet idea tracking (ADR-0085 semantic dedup; fleet-executor ideas-store.ts)
--
-- Ideation ships (spark, spider, lookout, snipe) capture proposals here instead
-- of a markdown file: one canonical row per novel idea, keyed by a content-
-- addressed `slug`, carrying its embedding for cosine dedup (>= 0.92 => a
-- `duplicate_of` back-reference rather than a new GitHub issue). The
-- fleet-executor creates this at runtime via ensureIdeasTable() (CREATE TABLE IF
-- NOT EXISTS); this block is the committed, canonical schema-of-record so the
-- shared relay DB shape stays documented alongside fleet_runs / fleet_run_steps.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet_ideas (
  slug           TEXT    PRIMARY KEY,            -- slugify(title)-contentHash(idea) (content-addressed idempotency key)
  title          TEXT    NOT NULL,               -- proposal headline
  rationale      TEXT    NOT NULL,               -- why it matters (the syllogism / argument)
  evidence_json  TEXT,                           -- JSON array of supporting evidence, if any
  action         TEXT    NOT NULL,               -- the runnable command / next step the proposal renders
  ship           TEXT    NOT NULL,               -- originating ideation ship (spark|spider|lookout|snipe)
  owner          TEXT,                            -- repo owner at capture time
  repo           TEXT,                            -- repo name at capture time
  pr_number      INTEGER,                         -- PR that surfaced the idea
  embedding_json TEXT    NOT NULL,               -- JSON float[] embedding (cosine dedup vector)
  issue_number   INTEGER,                         -- GitHub issue number once tracked
  issue_url      TEXT,                            -- GitHub issue URL once tracked
  duplicate_of   TEXT,                            -- canonical slug if this was deduped (NULL => canonical)
  status         TEXT    NOT NULL DEFAULT 'tracked',
  created_at     INTEGER NOT NULL
);
-- Dedup scan reads only canonical rows (duplicate_of IS NULL); index that predicate.
CREATE INDEX IF NOT EXISTS fleet_ideas_canonical_idx ON fleet_ideas (duplicate_of);
