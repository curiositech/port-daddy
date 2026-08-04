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

-- ──────────────────────────────────────────────────────────────────────────
-- User accounts + web sessions (ADR-0101 Phase 1)
--
-- GitHub-login BFF: the relay is a confidential OAuth client. The browser only
-- ever holds an opaque __Host-pd_session cookie; the GitHub user-to-server
-- token is stored server-side, envelope-encrypted, and used only for repo-
-- access checks that gate run-page visibility. Email is stored for login
-- continuity + security notices; erasure soft-deletes then hard-deletes.
-- These live in the TEAM tier of the scope ladder (operator infrastructure).
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             TEXT    PRIMARY KEY,            -- 'u_' || randomHex(16)
  github_user_id INTEGER NOT NULL UNIQUE,        -- durable; survives login renames
  login          TEXT    NOT NULL,               -- display handle, refreshed each login
  display_name   TEXT,
  avatar_url     TEXT,
  primary_email  TEXT,                            -- verified primary from /user/emails
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER,
  deleted_at     INTEGER                          -- soft delete; erasure job hard-deletes
);

CREATE TABLE IF NOT EXISTS web_sessions (
  token_hash   TEXT    PRIMARY KEY,              -- SHA-256(cookie value); the value itself is NEVER stored
  user_id      TEXT    NOT NULL REFERENCES users(id),
  gh_token_enc TEXT,                              -- AES-GCM(user-to-server token); iv||ct, base64url; repo-access checks only
  gh_token_iv  TEXT,                              -- AES-GCM iv (base64url)
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS web_sessions_user_idx ON web_sessions (user_id);

-- Personal access tokens for non-browser surfaces (FleetBar, pd-console, CLI),
-- minted by the GitHub device flow (ADR-0101 Phase 1). Only the SHA-256 of the
-- 'pdu_' token is stored; the token itself is shown once and lives in the
-- client's Keychain. Revocable per-device; optional expiry.
CREATE TABLE IF NOT EXISTS user_tokens (
  token_hash  TEXT    PRIMARY KEY,              -- SHA-256('pdu_' token); the token is NEVER stored
  user_id     TEXT    NOT NULL REFERENCES users(id),
  label       TEXT    NOT NULL,                 -- e.g. 'pd CLI on MacBook Pro M4'
  created_at  INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at  INTEGER,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS user_tokens_user_idx ON user_tokens (user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Fleet monetization — Stripe prepaid credits + spend metering (ADR-0116)
--
-- The relay is the billing authority: it holds STRIPE_SECRET_KEY, sells one-time
-- credit packs via Stripe Checkout, and records every grant/refund as an
-- append-only credit_ledger row. An installation's balance is the SUM of its
-- delta_usd (positive grants from checkout, negative from refunds/spend). Fleet
-- runs meter their token spend into fleet_run_spend, which a negative ledger
-- entry mirrors when a run is billed. stripe_customers / subscriptions map an
-- installation to its Stripe customer + (future) recurring plan.
--
-- credit_ledger is APPEND-ONLY: balance = SUM(delta_usd) WHERE installation_id=?.
-- All amounts are USD (REAL); a "credit-cent" pack of $20 grants delta_usd=20.0.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_ledger (
  id              TEXT    PRIMARY KEY,           -- 'cl_' || randomHex(16)
  installation_id INTEGER NOT NULL,              -- GitHub App installation (the billed tenant)
  delta_usd       REAL    NOT NULL,              -- +grant (checkout) / -debit (refund, spend)
  reason          TEXT    NOT NULL,              -- 'stripe:checkout' | 'stripe:refund' | 'fleet:spend' | ...
  stripe_ref      TEXT,                           -- Stripe session/charge id (idempotency + audit)
  run_id          TEXT,                           -- fleet run this debit belongs to (spend entries)
  created_at      INTEGER NOT NULL               -- unix seconds
);
CREATE INDEX IF NOT EXISTS credit_ledger_installation_idx ON credit_ledger (installation_id);

-- Per-run token spend metering. cost_usd is what the run consumed; a matching
-- negative credit_ledger row (reason='fleet:spend') decrements the balance.
CREATE TABLE IF NOT EXISTS fleet_run_spend (
  run_id          TEXT    NOT NULL,
  ship            TEXT,
  installation_id INTEGER,
  model           TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL    NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fleet_run_spend_installation_idx ON fleet_run_spend (installation_id, created_at);

-- One Stripe customer per installation (created lazily at first checkout/portal).
CREATE TABLE IF NOT EXISTS stripe_customers (
  installation_id    INTEGER PRIMARY KEY,
  stripe_customer_id TEXT    NOT NULL,
  created_at         INTEGER NOT NULL
);

-- Future recurring plans (seats/tier). Prepaid credits work without a row here.
CREATE TABLE IF NOT EXISTS subscriptions (
  installation_id    INTEGER PRIMARY KEY,
  stripe_sub_id      TEXT,
  plan               TEXT,
  status             TEXT,
  seats              INTEGER,
  current_period_end INTEGER
);

-- ──────────────────────────────────────────────────────────────────────────
-- MERCY v1 — hospital-ship health system (src/mercy.ts).
--
-- mercy_probe     — scratch row for the D1 read-after-write latency probe.
-- mercy_health    — one snapshot per cron sweep: per-subsystem statuses (JSON),
--                   the overall green/yellow/red verdict, and the
--                   remoteHarborsPossible bit. Pruned past 7 days.
-- mercy_incidents — one row per red episode per subsystem. The partial UNIQUE
--                   index (at most ONE unresolved incident per subsystem) IS
--                   the paging dedupe; paged_at pins webhook delivery.
-- ──────────────────────────────────────────────────────────────────────────
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

-- ──────────────────────────────────────────────────────────────────────────
-- Shipwright chat (src/shipwright.ts) — conversational fleet-config architect.
--
-- One row per chat message, scoped to the signed-in web user (users.id). The
-- AUTOINCREMENT id is the conversation order (created_at is unix seconds and
-- two messages routinely share a second). ADR-0101 lifecycle: exported with
-- /account/export, cleared by the user's own control, purged by eraseUser,
-- defensively purged for soft-deleted users by the erasure sweep, and
-- age-pruned by the retention sweep (SHIPWRIGHT_RETENTION_DAYS).
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipwright_chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL REFERENCES users(id),
  role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS shipwright_chats_user_idx ON shipwright_chats (user_id, id);
CREATE INDEX IF NOT EXISTS shipwright_chats_created_idx ON shipwright_chats (created_at);

CREATE TABLE IF NOT EXISTS mercy_incidents (
  id          TEXT    PRIMARY KEY,                        -- 'mi_' || randomHex(8)
  subsystem   TEXT    NOT NULL,
  opened_at   INTEGER NOT NULL,                           -- first red sweep
  resolved_at INTEGER,                                    -- first non-red sweep after
  paged_at    INTEGER,                                    -- when the webhook POST was DELIVERED
  detail      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS mercy_incidents_open_uniq
  ON mercy_incidents (subsystem) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS mercy_incidents_opened_idx ON mercy_incidents (opened_at);
