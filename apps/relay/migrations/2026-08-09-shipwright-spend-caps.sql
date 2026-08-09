-- Shipwright chat spend caps (src/shipwright.ts, grand-plan §chat-spend-caps).
-- Applied staging-first by CI (deploy-relay.yml) per ADR-0119; the prod gate
-- refuses to release until this file appears in applied-staging.json.
--
-- One counter row per (user, UTC day): how many chat turns the user has spent
-- and the estimated tokens those turns cost. The chat route reads the current
-- day's row BEFORE calling Workers AI and refuses with 429 + Retry-After once
-- either daily budget is spent — a looping client can no longer burn AI quota
-- indefinitely (previously the only bounds were per-message chars and the
-- 40-message history window).
--
-- Deliberately NOT the per-harbor X8 budget machinery: chat spend is scoped to
-- the signed-in web user (users.id), not a harbor, and a plain D1 counter row
-- keyed by (user_id, window_start) is the whole requirement — no ledger, no
-- reservations, no cross-plane accounting.
--
-- Lifecycle: rows reference users(id) and are purged immediately by eraseUser,
-- defensively purged for soft-deleted users by the erasure sweep, and
-- age-pruned by the retention sweep (SHIPWRIGHT_SPEND_RETENTION_DAYS) — a
-- counter is meaningless the moment its UTC day ends, so nothing here is
-- retained as history. Additive-only: rollback-safe per ADR-0119 rule 3.

CREATE TABLE IF NOT EXISTS shipwright_spend (
  user_id      TEXT    NOT NULL REFERENCES users(id),
  -- UTC midnight (unix seconds) of the day this row counts. A new day is a
  -- new row — "reset at rollover" is key arithmetic, not an UPDATE job.
  window_start INTEGER NOT NULL,
  messages     INTEGER NOT NULL DEFAULT 0,
  est_tokens   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, window_start)
);
-- The retention sweep prunes by window age.
CREATE INDEX IF NOT EXISTS shipwright_spend_window_idx ON shipwright_spend (window_start);
