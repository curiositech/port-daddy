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
