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
  proof_method       TEXT    NOT NULL CHECK (proof_method IN ('oidc','acme','wot','operator-provisioned')),
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

-- Durable queue-admission truth, written before the queue consumer starts.
-- One PR can have many immutable generations as new heads arrive; only the
-- latest queued/running generation remains active and older work is marked
-- superseded.  Delivery id is the webhook idempotency key.
CREATE TABLE IF NOT EXISTS fleet_run_intents (
  delivery_id        TEXT    PRIMARY KEY,
  repo_full_name     TEXT    NOT NULL,
  pr_number          INTEGER NOT NULL,
  pr_url             TEXT    NOT NULL,
  head_sha           TEXT    NOT NULL,
  event_type         TEXT    NOT NULL,
  action             TEXT,
  generation         INTEGER NOT NULL,
  state              TEXT    NOT NULL DEFAULT 'admitting'
                             CHECK (state IN (
                               'admitting', 'queued', 'running', 'retrying',
                               'superseded', 'enqueue_failed',
                               'success', 'failure', 'neutral', 'cancelled'
                             )),
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  queued_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at         INTEGER,
  last_progress_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at        INTEGER,
  superseded_by      TEXT,
  last_error         TEXT,
  UNIQUE (repo_full_name, pr_number, generation)
);
CREATE INDEX IF NOT EXISTS fleet_run_intents_pr_generation_idx
  ON fleet_run_intents (repo_full_name, pr_number, generation DESC);
CREATE INDEX IF NOT EXISTS fleet_run_intents_state_queued_idx
  ON fleet_run_intents (state, queued_at ASC);
CREATE INDEX IF NOT EXISTS fleet_run_intents_state_finished_idx
  ON fleet_run_intents (state, finished_at ASC);

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
-- Session Intelligence findings (cloud mining ingest boundary)
--
-- Raw material for eureka/coordination mining lives only on the operator's
-- local machine (~/.claude/projects transcripts, the local daemon's SQLite
-- store) -- relay has no filesystem access to either. The LOCAL side runs
-- the existing structural detectors (lib/session-intel/), applies the
-- single-expert-oracle recurrence guard AND redaction (lib/session-intel/
-- redact.js's structural grammars) BEFORE anything leaves the machine, then
-- POSTs the resulting already-small, already-redacted findings here via
-- POST /v1/session-intel/ingest (operatorOnly-gated -- see handlers.ts).
-- Nothing in this table has ever contained a raw transcript or full
-- conversation text; excerpts are pre-clipped (~240 chars) structural
-- snippets, same shape as the local coordination-training ledger.
--
-- This table is the READ side for a cloud-native judgment ship (not yet
-- built -- separate follow-up) that decides skill/prompt/roadmap
-- worthiness and, for worthy findings, calls the SAME captureProposals /
-- fleet_ideas pipeline the spark/spider/lookout/snipe ideation ships
-- already use, rather than inventing a second proposal-tracking mechanism.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_intel_findings (
  id             TEXT    PRIMARY KEY,            -- 'sif_' || randomHex(16)
  batch_id       TEXT    NOT NULL,               -- one id per ingest call (one local digest run)
  kind           TEXT    NOT NULL,               -- 'coordination-suggestion'|'recurring-eureka-arc'
  digest_date    TEXT    NOT NULL,               -- YYYY-MM-DD, the local digest cycle's date (idempotency aid)
  title          TEXT    NOT NULL,
  occurrences    INTEGER NOT NULL,
  session_count  INTEGER NOT NULL,               -- distinct sessions this recurred across (>= 2, guard already applied locally)
  payload_json   TEXT    NOT NULL,               -- the full structured finding (already redacted, already clipped)
  status         TEXT    NOT NULL DEFAULT 'pending', -- 'pending'|'judged'|'proposed'|'dismissed'
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS session_intel_findings_status_idx ON session_intel_findings (status, created_at);
CREATE INDEX IF NOT EXISTS session_intel_findings_batch_idx ON session_intel_findings (batch_id);

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

-- Per-repo agent-behavior settings, account-scoped (the /account/repos screen).
-- One row per (user, repo full name). sitrep_end_of_turn is the launch dial;
-- settings_json is the forward-compatible bag for the settings the screen grows
-- next. The account is the RECORD of cross-device intent; enforcement stays in
-- each clone's local agent.config.json, converged via GET /v1/repo-settings.
CREATE TABLE IF NOT EXISTS repo_settings (
  user_id            TEXT    NOT NULL REFERENCES users(id),
  repo_full_name     TEXT    NOT NULL,
  sitrep_end_of_turn TEXT    NOT NULL DEFAULT 'off'
    CHECK (sitrep_end_of_turn IN ('off','suggest','enforce')),
  settings_json      TEXT    NOT NULL DEFAULT '{}'
    CHECK (json_valid(settings_json)),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, repo_full_name)
);
CREATE INDEX IF NOT EXISTS idx_repo_settings_user
  ON repo_settings(user_id, updated_at DESC);

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
  subsystems_json         TEXT    NOT NULL,               -- [{name,status,latencyMs,detail}]
  hooks_json              TEXT                            -- [{name,status,metric,detail}] per-feature hooks (X7)
);
CREATE INDEX IF NOT EXISTS mercy_health_at_idx ON mercy_health (at);

-- ──────────────────────────────────────────────────────────────────────────
-- MERCY HOOKS (grand-plan node x7-mercy-hooks; plan §X7; src/mercy-hooks.ts;
-- migration 2026-08-09-z-mercy-hooks.sql).
--
-- mercy_hook_events        — per-feature hook ledger: hot paths (publish
--                            quota refusals, run-report gaps) append one row
--                            per signal; the sweep aggregates and prunes.
-- squid_run_reconciliation — run-concluded reconciliation: one row per
--                            executor run report, claimed-vs-received event
--                            totals; gap != 0 is the honest loss metric
--                            fire-and-forget telemetry cannot self-produce.
-- mercy_slo_windows        — 5-minute SLO burn buckets (per-window request /
--                            5xx counts, written via ctx.waitUntil); the
--                            sweep computes multiwindow burn from them.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mercy_hook_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,                              -- unix seconds
  hook     TEXT    NOT NULL,                              -- e.g. 'x8_quota_exhausted'
  severity TEXT    NOT NULL CHECK (severity IN ('info','warn','crit')),
  detail   TEXT                                           -- operator-facing; never secrets
);
CREATE INDEX IF NOT EXISTS mercy_hook_events_hook_at_idx
  ON mercy_hook_events (hook, at);
CREATE INDEX IF NOT EXISTS mercy_hook_events_at_idx
  ON mercy_hook_events (at);

CREATE TABLE IF NOT EXISTS squid_run_reconciliation (
  run_id      TEXT    PRIMARY KEY,                        -- 'run:<deliveryId>'
  channel     TEXT    NOT NULL,                           -- '<relayFp>:fleet-cloud:<runId>'
  sender      TEXT    NOT NULL,                           -- executor daemon fingerprint
  claimed     INTEGER NOT NULL,                           -- events the executor says it sent
  received    INTEGER NOT NULL,                           -- events rows the relay actually has
  gap         INTEGER NOT NULL,                           -- claimed - received (loss when > 0)
  reported_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS squid_run_reconciliation_at_idx
  ON squid_run_reconciliation (reported_at);

CREATE TABLE IF NOT EXISTS mercy_slo_windows (
  window_start INTEGER PRIMARY KEY,                       -- unix seconds, floored to 300s
  requests     INTEGER NOT NULL DEFAULT 0,
  errors       INTEGER NOT NULL DEFAULT 0                 -- HTTP 5xx only (4xx are the caller's)
);

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

-- OPERATOR INTERRUPTIONS v1 — human-in-the-loop blocking asks
-- (src/interruptions.ts). An agent that hits a blocking degradation escalates
-- a real ask to the operator; the mercy cron nags on a decaying full-jitter
-- schedule until answered/acked, then hard-stops (expired + one "gave up"
-- page). next_nag_at / gave_up_paged_at advance ONLY on DELIVERED pages — the
-- mercy paged_at dedupe pattern ("never two pages for the same stage").

CREATE TABLE IF NOT EXISTS operator_interruptions (
  id               TEXT    PRIMARY KEY,          -- 'oi_' || randomHex(8)
  user_id          TEXT    NOT NULL,             -- operator scope (users.id)
  installation_id  INTEGER,                      -- optional GitHub App installation scope
  source_agent     TEXT    NOT NULL,             -- e.g. 'fleet-executor/purser'
  source_session   TEXT,                         -- run/session id at the source
  title            TEXT    NOT NULL,
  body             TEXT    NOT NULL,
  urgency          TEXT    NOT NULL CHECK (urgency IN ('low','normal','high','critical')),
  state            TEXT    NOT NULL DEFAULT 'open'
                           CHECK (state IN ('open','acked','answered','expired')),
  answer           TEXT,                         -- operator's answer text (answered only)
  created_at       INTEGER NOT NULL,             -- unix seconds
  last_nagged_at   INTEGER,                      -- last DELIVERED page for this row
  nag_count        INTEGER NOT NULL DEFAULT 0,   -- delivered nags (digest delivery counts)
  decay_stage      INTEGER NOT NULL DEFAULT 0,   -- backoff stage; advances with nag_count
  next_nag_at      INTEGER NOT NULL,             -- jittered due time; advances ONLY on delivery
  closed_at        INTEGER,                      -- when it left 'open'
  gave_up_paged_at INTEGER                       -- final "gave up" page delivery pin
);
CREATE INDEX IF NOT EXISTS interruptions_state_due_idx
  ON operator_interruptions (state, next_nag_at);
CREATE INDEX IF NOT EXISTS interruptions_user_idx
  ON operator_interruptions (user_id, state);
CREATE INDEX IF NOT EXISTS interruptions_source_idx
  ON operator_interruptions (user_id, source_agent, created_at);

-- Per-operator page-budget ledger: one row per DELIVERED page. Pruned at 24h.
CREATE TABLE IF NOT EXISTS interruption_pages (
  id      TEXT    PRIMARY KEY,                   -- 'ip_' || randomHex(8)
  user_id TEXT    NOT NULL,
  kind    TEXT    NOT NULL CHECK (kind IN ('nag','gave-up','digest')),
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS interruption_pages_user_idx
  ON interruption_pages (user_id, sent_at);

-- ──────────────────────────────────────────────────────────────────────────
-- X2 REMOTE HARBORS v1 — keypair + namespace + membership, nothing more
-- (docs/proposals/relay-grand-plan.md §X2; src/harbors.ts; migration
-- 2026-08-04-remote-harbors.sql).
--
-- harbors            — a NAME in a NAMESPACE plus an ed25519 PUBKEY. The
--                      keypair is generated CLIENT-side and only the public
--                      half ever reaches the relay — the relay signs nothing
--                      on a harbor's behalf. The namespace is the creator's
--                      GitHub login (server-derived, never client-supplied),
--                      so namespaces cannot be squatted.
-- harbor_memberships — who belongs to a harbor (a relay user account or a
--                      daemon identity) and with what role. NOT the legacy
--                      zero-trust `harbor_members` daemon-admission table the
--                      publish/handshake path gates on (src/handlers.ts):
--                      a row HERE grants operator-plane API visibility only,
--                      never channel publish rights.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS harbors (
  id         TEXT    PRIMARY KEY,               -- 'h_' || randomHex(16)
  namespace  TEXT    NOT NULL,                  -- creator's GitHub login, lowercased (server-derived)
  name       TEXT    NOT NULL,                  -- client-chosen short name, lowercased
  pubkey     TEXT    NOT NULL,                  -- ed25519 public key, 64 hex chars (client-generated)
  created_by TEXT    NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,                  -- unix seconds
  UNIQUE (namespace, name)
);

CREATE TABLE IF NOT EXISTS harbor_memberships (
  harbor_id   TEXT    NOT NULL REFERENCES harbors(id),
  member_kind TEXT    NOT NULL CHECK (member_kind IN ('user','daemon')),
  member_id   TEXT    NOT NULL,                 -- users.id ('user') or identities.daemon_fingerprint ('daemon')
  role        TEXT    NOT NULL CHECK (role IN ('owner','member')),
  added_at    INTEGER NOT NULL,                 -- unix seconds
  added_by    TEXT    NOT NULL,                 -- users.id of the operator who added the row
  PRIMARY KEY (harbor_id, member_kind, member_id)
);
CREATE INDEX IF NOT EXISTS harbor_memberships_member_idx
  ON harbor_memberships (member_kind, member_id);

-- ──────────────────────────────────────────────────────────────────────────
-- X3 PRESENCE + HELM v1 — presence first, the Helm without ballots
-- (docs/proposals/relay-grand-plan.md §X3, D5/D6; src/presence.ts; migration
-- 2026-08-04-x3-presence-helm.sql).
--
-- Presence itself lives in the HarborChannel Durable Object (hot, TTL ~90s —
-- not a D1 concern). D1 holds only the AUTHORITY record + its audit trail:
--
-- harbor_helms — one explicit authority record per harbor: holder + ORDERED
--                succession list, owner-set. NO voting machinery, ever (D6):
--                the helm changes only by an owner's PUT or the dead-man rule
--                (holder presence expired past grace ⇒ next PRESENT
--                successor). `seq` is the dead-man CAS guard.
-- helm_events  — append-only audit rows; every helm change (owner set,
--                dead-man pass, dead-man vacancy) lands here. A helm NEVER
--                changes silently.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS harbor_helms (
  harbor_id       TEXT    PRIMARY KEY REFERENCES harbors(id),
  holder_kind     TEXT    CHECK (holder_kind IN ('user','daemon')),  -- NULL when vacant
  holder_id       TEXT,                          -- users.id ('user') or identities.daemon_fingerprint ('daemon')
  holder_label    TEXT,                          -- display label captured at set time (login / fingerprint)
  succession_json TEXT    NOT NULL,              -- ordered JSON array of {kind,id,label}
  state           TEXT    NOT NULL CHECK (state IN ('held','vacant')),
  vacant_flagged  INTEGER NOT NULL DEFAULT 0,    -- 1 after a dead-man pass found NO present successor
  seq             INTEGER NOT NULL,              -- bumps on every change; dead-man CAS guard
  updated_at      INTEGER NOT NULL,              -- unix seconds
  updated_by      TEXT    NOT NULL,              -- users.id (owner PUT) or 'relay:dead-man'
  -- mediator-body: what a parley DEADLINE LAPSE does in this harbor.
  -- 'lapse' = v1 plain lapse; 'first-proceeds' = the Helm's default outcome
  -- (first claimant proceeds, second rebases) is recorded in outcome_json.
  parley_expiry_default TEXT NOT NULL DEFAULT 'lapse' CHECK (parley_expiry_default IN ('lapse','first-proceeds'))
);

CREATE TABLE IF NOT EXISTS helm_events (
  id        TEXT    PRIMARY KEY,                 -- 'he_' || randomHex(8)
  harbor_id TEXT    NOT NULL REFERENCES harbors(id),
  at        INTEGER NOT NULL,                    -- unix seconds
  kind      TEXT    NOT NULL CHECK (kind IN ('helm_set','dead_man_pass','dead_man_vacant')),
  detail    TEXT    NOT NULL                     -- JSON: {from,to,...} — who held, who took over, why
);
CREATE INDEX IF NOT EXISTS helm_events_harbor_idx ON helm_events (harbor_id, at);

-- ──────────────────────────────────────────────────────────────────────────
-- X4 PARLEY v1 — signed multi-party agreements over harbors
-- (docs/proposals/relay-grand-plan.md §X4; src/parleys.ts; migration
-- 2026-08-04-x4-parleys.sql).
--
-- parleys          — one artifact per convened parley: harbor, subject,
--                    proposer, hard deadline, and a three-state machine:
--                    open → agreed | lapsed. AGREED requires every NAMED
--                    party to have signed 'accept'; a non-open parley is
--                    IMMUTABLE. Expiry is checked lazily on read/write —
--                    parley is never a liveness hole.
-- parley_positions — one row per participant identity. is_party=1 rows are
--                    NAMED parties whose signed 'accept' is required;
--                    is_party=0 rows are reserved observers — the
--                    tier-labeled 'pd-mediator' seat lives here.
--                    A signed position (stance + text + signed_at) is
--                    write-once: signatures are never edited.
--                    MEDIATOR NOTE (src/mediator.ts, opt-in, default OFF):
--                    the mediator's observer row reuses `position` to hold
--                    its machine-written OBSERVATION. No schema change was
--                    needed and none was made. Its `stance` and `signed_at`
--                    stay NULL forever — recordMediatorObservation's SET
--                    list names `position` alone and its WHERE pins
--                    party_kind='mediator' AND is_party=0, so the mediator
--                    is structurally unable to sign, to alter another
--                    party's row, or to affect agreement (which counts
--                    is_party=1 rows only). A NULL signed_at on that row is
--                    the durable proof it never signed.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parleys (
  id             TEXT    PRIMARY KEY,            -- 'p_' || randomHex(16)
  harbor_id      TEXT    NOT NULL REFERENCES harbors(id),
  subject        TEXT    NOT NULL,               -- what is being agreed (free text, bounded)
  proposer_id    TEXT    NOT NULL REFERENCES users(id),
  proposer_label TEXT    NOT NULL,               -- login captured at convene time
  state          TEXT    NOT NULL CHECK (state IN ('open','agreed','lapsed')),
  deadline_at    INTEGER NOT NULL,               -- unix seconds; default now + 24h
  created_at     INTEGER NOT NULL,               -- unix seconds
  resolved_at    INTEGER,                        -- unix seconds when agreed/lapsed; NULL while open
  -- mediator-body (2026-08-09-mediator-body.sql): who convened this parley
  -- ('mediator' = auto-convened on a predicted PR conflict; the proposer row
  -- still names the FIRST CLAIMANT, a real named party, so the FK holds), and
  -- the outcome the Helm's expiry default recorded when a lapse applied one.
  convened_by    TEXT    NOT NULL DEFAULT 'user' CHECK (convened_by IN ('user','mediator')),
  outcome_json   TEXT
);
CREATE INDEX IF NOT EXISTS parleys_harbor_idx ON parleys (harbor_id, created_at);

CREATE TABLE IF NOT EXISTS parley_positions (
  parley_id   TEXT    NOT NULL REFERENCES parleys(id),
  party_kind  TEXT    NOT NULL CHECK (party_kind IN ('user','daemon','mediator')),
  party_id    TEXT    NOT NULL,                  -- users.id / identities.daemon_fingerprint / 'pd-mediator'
  party_label TEXT    NOT NULL,                  -- login / fingerprint / 'pd-mediator'
  tier        TEXT    NOT NULL,                  -- 'human' | identity proof_method | 'mediator'
  is_party    INTEGER NOT NULL,                  -- 1 = named party (accept required); 0 = reserved observer
  stance      TEXT    CHECK (stance IN ('accept','reject')),  -- NULL until signed
  position    TEXT,                              -- free text signed alongside the stance
  signed_at   INTEGER,                           -- unix seconds; NULL until signed (write-once)
  claim_rank  INTEGER,                           -- mediator-body: claimant order (1 = first claimant); NULL on v1 parleys
  PRIMARY KEY (parley_id, party_kind, party_id)
);


-- ──────────────────────────────────────────────────────────────────────────
-- MEDIATOR BODY (grand-plan DAG node mediator-body; plan §X4 second half;
-- src/mediator-body.ts; migration 2026-08-09-mediator-body.sql).
--
-- mediator_pairs    — one row per auto-convened conflict parley, keyed by
--                     the normalized PR pair; the one-OPEN-parley-per-pair
--                     invariant is enforced by joining to parleys.state.
-- parley_summonses  — delivery-acknowledged summons ledger. Every summons
--                     and every daemon response is a CHAINED, signed relay
--                     event; its (channel, seq, hash) coordinates live here
--                     so ledger and chain attest each other. Agent-first
--                     (D11): only refuse/escalate (or no declared daemon)
--                     wakes the human.
-- parley_gates      — human approve gate before IRREVERSIBLE actions only
--                     (merge/revert/force-push). Approve/Modify/Reject via
--                     a named human party's session on the parleys page;
--                     Modify's free text is the re-injection payload.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mediator_pairs (
  repo         TEXT    NOT NULL,               -- 'owner/name'
  pr_lo        INTEGER NOT NULL,
  pr_hi        INTEGER NOT NULL,
  first_pr     INTEGER NOT NULL,               -- the FIRST CLAIMANT's PR number
  parley_id    TEXT    NOT NULL REFERENCES parleys(id),
  confidence   REAL    NOT NULL,               -- prediction confidence at convene
  symbols_json TEXT    NOT NULL,               -- JSON [{file, symbol}] overlap evidence
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (repo, pr_lo, pr_hi, parley_id)
);
CREATE INDEX IF NOT EXISTS mediator_pairs_parley_idx ON mediator_pairs (parley_id);

CREATE TABLE IF NOT EXISTS parley_summonses (
  id                 TEXT    PRIMARY KEY,       -- 'sm_' || randomHex(12)
  parley_id          TEXT    NOT NULL REFERENCES parleys(id),
  party_kind         TEXT    NOT NULL CHECK (party_kind IN ('user','daemon')),
  party_id           TEXT    NOT NULL,          -- users.id / daemon fingerprint
  party_label        TEXT    NOT NULL,
  daemon_fingerprint TEXT,                      -- the daemon that speaks for this party; NULL = none declared
  summons_channel    TEXT    NOT NULL,          -- chain channel the summons event rode
  summons_seq        INTEGER NOT NULL,
  summons_hash       TEXT    NOT NULL,          -- this_hash of the summons event
  issued_at          INTEGER NOT NULL,
  state              TEXT    NOT NULL CHECK (state IN ('summoned','acked','refused','escalated')),
  response_channel   TEXT,                      -- chain coordinates of the daemon's response
  response_seq       INTEGER,
  response_hash      TEXT,
  responded_at       INTEGER,
  escalated_at       INTEGER                    -- set the moment a human is woken (refuse/escalate/no-daemon)
);
CREATE INDEX IF NOT EXISTS parley_summonses_parley_idx ON parley_summonses (parley_id);

CREATE TABLE IF NOT EXISTS parley_gates (
  parley_id        TEXT    PRIMARY KEY REFERENCES parleys(id),
  action           TEXT    NOT NULL CHECK (action IN ('merge','revert','force-push')),
  state            TEXT    NOT NULL CHECK (state IN ('pending','approved','modified','rejected')),
  verdict_by       TEXT,                        -- users.id of the deciding human
  verdict_by_label TEXT,
  verdict_at       INTEGER,
  modify_text      TEXT,                        -- the Modify free text (re-injection payload)
  created_at       INTEGER NOT NULL
);

-- ── SEAMANSHIP (src/seamanship.ts; migration 2026-08-22-seamanship-listings.sql)
--
-- The operator's own skill catalog (/account/seamanship) and the opt-in public
-- directory (/skills). The repo is the source of truth; NEITHER table mirrors
-- the corpus, and neither has a `body` column — structurally, not by convention.
--
--   seamanship_skill_cache — short-TTL (5 min) cache of parsed SKILL.md
--     FRONTMATTER, scoped to the user who read it under their own GitHub App
--     installation. Fully reconstructible from the repo.
--   skill_listings — the listed-tier projection: one row per skill whose author
--     wrote `visibility: listed`/`public` into the SKILL.md and published. The
--     row IS the listed payload (name + description); the repo coordinates ride
--     along for the on-demand public-tier body fetch and are never serialized
--     into a public response.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seamanship_skill_cache (
  user_id         TEXT    NOT NULL REFERENCES users(id),
  repo_full_name  TEXT    NOT NULL,
  source_path     TEXT    NOT NULL,
  skill_id        TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  category        TEXT    NOT NULL DEFAULT '',
  tags_json       TEXT    NOT NULL DEFAULT '[]',
  owner           TEXT,
  repos_json      TEXT    NOT NULL DEFAULT '[]',
  visibility      TEXT    NOT NULL DEFAULT 'private',
  pairs_with_json TEXT    NOT NULL DEFAULT '[]',
  fetched_at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, repo_full_name, source_path)
);
CREATE INDEX IF NOT EXISTS seamanship_skill_cache_age_idx
  ON seamanship_skill_cache (fetched_at);

CREATE TABLE IF NOT EXISTS skill_listings (
  namespace      TEXT    NOT NULL,
  skill_id       TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL,
  repo_full_name TEXT    NOT NULL,
  source_path    TEXT    NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (namespace, skill_id)
);
CREATE INDEX IF NOT EXISTS skill_listings_updated_idx ON skill_listings (updated_at);

-- ── Snipe: suggestions, the approval gate, and the Engineman's chat ──────────
--
-- Schema-of-record mirror of migrations/2026-08-22-seamanship-suggestions.sql
-- and migrations/2026-08-22-snipe-chat-spend.sql. Read those files for the
-- reasoning; the short version is the rule these tables enforce:
--
--   No approval ⇒ no build ⇒ no pull request, structurally.
--
--   seamanship_suggestions      the proposals. `status`'s CHECK is the outer
--                               fence; the legal transitions between its values
--                               are enforced by conditional UPDATEs naming the
--                               required prior state (src/snipe-suggestions.ts).
--   seamanship_build_grants     the capability. One per suggestion, forever
--                               (suggestion_id is the PK), minted only by the
--                               approval transition, spent by a conditional
--                               UPDATE on `consumed_at IS NULL`, and revocable
--                               until it is spent.
--   seamanship_suggestion_jobs  the async admission receipt, written BEFORE any
--                               work starts (the fleet_run_intents idiom).
--   agent_chats / agent_chat_spend  the shared chat store and its per-user
--                               daily budget. Generic in `agent` so a third
--                               surface is a new column value, not a migration.
--
-- There is no `body` column anywhere below: a built skill lives in the
-- operator's repo behind a pull request they merged, and a column that does not
-- exist cannot become a second, divergent catalog.

CREATE TABLE IF NOT EXISTS seamanship_suggestions (
  id              TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id),
  repo_full_name  TEXT    NOT NULL,
  skill_name      TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  rationale       TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed', 'approved', 'dismissed', 'built')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  approved_at     INTEGER,
  approved_by     TEXT,
  pr_url          TEXT,
  build_error     TEXT,
  job_id          TEXT,
  -- Dedup at the storage layer: the same skill cannot be proposed twice for one
  -- repo, including by two jobs racing each other.
  UNIQUE (user_id, repo_full_name, skill_name)
);
CREATE INDEX IF NOT EXISTS seamanship_suggestions_scope_idx
  ON seamanship_suggestions (user_id, repo_full_name, status);
CREATE INDEX IF NOT EXISTS seamanship_suggestions_created_idx
  ON seamanship_suggestions (created_at);

CREATE TABLE IF NOT EXISTS seamanship_build_grants (
  suggestion_id   TEXT    PRIMARY KEY REFERENCES seamanship_suggestions(id),
  grant_id        TEXT    NOT NULL UNIQUE,
  user_id         TEXT    NOT NULL REFERENCES users(id),
  repo_full_name  TEXT    NOT NULL,
  -- Ownership proven by the APPROVING SESSION and recorded here, because the
  -- build runs later on a sweep where no session exists to re-prove it.
  installation_id INTEGER NOT NULL,
  issued_at       INTEGER NOT NULL,
  issued_by       TEXT    NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  consumed_at     INTEGER,
  revoked_at      INTEGER
);
CREATE INDEX IF NOT EXISTS seamanship_build_grants_open_idx
  ON seamanship_build_grants (user_id, consumed_at);

CREATE TABLE IF NOT EXISTS seamanship_suggestion_jobs (
  job_id          TEXT    PRIMARY KEY,
  user_id         TEXT    NOT NULL REFERENCES users(id),
  repo_full_name  TEXT    NOT NULL,
  state           TEXT    NOT NULL DEFAULT 'queued'
                    CHECK (state IN ('queued', 'running', 'done', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  requested_at    INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  produced          INTEGER NOT NULL DEFAULT 0,
  rejected_dupe     INTEGER NOT NULL DEFAULT 0,
  rejected_boundary INTEGER NOT NULL DEFAULT 0,
  rejected_capped   INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);
-- One active job per (account, repo), structurally.
CREATE UNIQUE INDEX IF NOT EXISTS seamanship_suggestion_jobs_active_idx
  ON seamanship_suggestion_jobs (user_id, repo_full_name)
  WHERE state IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS seamanship_suggestion_jobs_state_idx
  ON seamanship_suggestion_jobs (state, requested_at);

CREATE TABLE IF NOT EXISTS agent_chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent      TEXT    NOT NULL,
  user_id    TEXT    NOT NULL REFERENCES users(id),
  role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_chats_scope_idx ON agent_chats (agent, user_id, id);
CREATE INDEX IF NOT EXISTS agent_chats_created_idx ON agent_chats (created_at);

CREATE TABLE IF NOT EXISTS agent_chat_spend (
  agent        TEXT    NOT NULL,
  user_id      TEXT    NOT NULL REFERENCES users(id),
  -- UTC midnight of the day this row counts. Rollover is key arithmetic, not a
  -- scheduled job: a new day reads a row that does not exist and counts zero.
  window_start INTEGER NOT NULL,
  messages     INTEGER NOT NULL DEFAULT 0,
  est_tokens   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent, user_id, window_start)
);
CREATE INDEX IF NOT EXISTS agent_chat_spend_window_idx ON agent_chat_spend (window_start);
