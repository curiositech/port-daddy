-- ──────────────────────────────────────────────────────────────────────────
-- MEDIATOR BODY (grand-plan DAG node mediator-body; plan §X4 second half;
-- src/mediator-body.ts). Sorts after 2026-08-09-executor-identity.sql — the
-- summons transport depends on the executor's provisioned identity.
--
-- Four coupled additions:
--   1. parleys gains `convened_by` ('user' | 'mediator') so an auto-convened
--      conflict parley is honestly labeled, and `outcome_json` so a deadline
--      lapse can record the Helm-configured default outcome instead of v1's
--      information-free plain lapse.
--   2. parley_positions gains `claim_rank` — the claimant ORDER on a
--      mediator-convened pair (1 = first claimant, 2 = second). NULL on every
--      v1 parley; the expiry default applies only where ranks exist.
--   3. mediator_pairs / parley_summonses / parley_gates — the prediction
--      registry (one OPEN parley per PR pair), the delivery-acknowledged
--      summons ledger (riding the hash chain: every summons and every daemon
--      response is a chained, signed relay event whose coordinates are
--      recorded here), and the human approve gate for irreversible actions.
--   4. harbor_helms gains `parley_expiry_default` — 'lapse' (v1 behavior) or
--      'first-proceeds' (first claimant proceeds, second rebases).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE parleys ADD COLUMN convened_by TEXT NOT NULL DEFAULT 'user'
  CHECK (convened_by IN ('user','mediator'));
ALTER TABLE parleys ADD COLUMN outcome_json TEXT;

ALTER TABLE parley_positions ADD COLUMN claim_rank INTEGER;

ALTER TABLE harbor_helms ADD COLUMN parley_expiry_default TEXT NOT NULL DEFAULT 'lapse'
  CHECK (parley_expiry_default IN ('lapse','first-proceeds'));

-- One row per predicted-conflict parley. The one-open-parley-per-PR-pair
-- invariant is enforced by lookup: before convening, the relay joins this
-- table to parleys and refuses a second parley while one for (repo, pr_lo,
-- pr_hi) is still open. pr_lo < pr_hi normalizes the pair; first_pr records
-- CLAIM order (the earlier-created PR), which is not always pr_lo.
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

-- One summons per NAMED party of a mediator-convened parley. Agent-first
-- (doctrine D11): when the party has a declared daemon, the daemon is
-- summoned first ('summoned') and only its refuse/escalate wakes the human;
-- a party with NO declared daemon escalates immediately — there is no agent
-- to try first, so the human is woken honestly rather than waited on.
-- The summons itself and every daemon response are CHAINED relay events
-- (never fire-and-forget squid); their (channel, seq, hash) coordinates are
-- recorded here so the ledger and the chain attest each other.
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

-- The human approve gate — before IRREVERSIBLE actions only (merge / revert /
-- force-push; doctrine D11). One gate per parley, created at convene when the
-- predicted conflict names an irreversible action. Verdicts enter only via a
-- named HUMAN party's authenticated session on the parleys HTML surface;
-- 'modified' carries free text that is re-injected into the losing agent's
-- re-execution (mediator:reinjection:* control-plane KV key).
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
