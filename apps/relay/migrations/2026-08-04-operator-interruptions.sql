-- OPERATOR INTERRUPTIONS v1 — human-in-the-loop blocking asks (src/interruptions.ts).
-- Apply on the deployed D1 with:
--   wrangler d1 execute port-daddy-relay -c wrangler.deploy.toml --remote \
--     --file=./migrations/2026-08-04-operator-interruptions.sql
--
-- Two tables:
--   operator_interruptions — one row per blocking ask an agent escalated to a
--     human. State machine: open → acked | answered | expired (terminal).
--     The DECAY/NAG engine (mercy 5-min cron) re-pages MERCY_PAGE_WEBHOOK on a
--     decaying, full-jitter schedule: `next_nag_at` is rolled ONCE per stage
--     and only advances when a page is DELIVERED — that column IS the
--     "never two pages for the same stage" dedupe (the mercy paged_at pattern).
--     After MAX_NAGS delivered nags the next due tick expires the row;
--     `gave_up_paged_at` pins delivery of the single final "gave up" page.
--   interruption_pages — the per-operator page-budget ledger: one row per
--     DELIVERED webhook page (nag / gave-up / digest). The nag engine counts
--     this ledger over the trailing hour to enforce the max-pages-per-operator
--     budget and to collapse overflow into one digest page. Pruned after 24h.

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

CREATE TABLE IF NOT EXISTS interruption_pages (
  id      TEXT    PRIMARY KEY,                   -- 'ip_' || randomHex(8)
  user_id TEXT    NOT NULL,
  kind    TEXT    NOT NULL CHECK (kind IN ('nag','gave-up','digest')),
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS interruption_pages_user_idx
  ON interruption_pages (user_id, sent_at);
