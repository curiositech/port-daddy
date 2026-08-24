-- ──────────────────────────────────────────────────────────────────────────
-- BLIND SESSIONS substrate (grand-plan DAG node blind-sessions; plan §L2
-- first slice; src/blind-sessions.ts). Sorts after 2026-08-09-mediator-body.sql
-- ('x5' > 'mediator' lexicographically) — the receipt transport depends on the
-- executor identity (N2) that the mediator-body chain already requires.
--
-- What these tables hold — and, load-bearing, what they DON'T:
--   * blind_skills      — sealed-skill METADATA only: harbor scope, the
--                         lender's fingerprint, the output contract. The skill
--                         MATERIAL never touches the relay in plaintext; the
--                         lender seals it per-run to the executor sandbox's
--                         ephemeral key and the relay stores only ciphertext
--                         (blind_runs.sealed_payload_json).
--   * blind_capabilities— the borrower's execute-only capability ledger
--                         (ADR-0101 HMAC style). The token's caveats
--                         {skill_id, harbor, max_runs, exp} are duplicated
--                         here because the DB — not the token — is the
--                         authority for runs_used and revocation: replaying a
--                         valid token past max_runs is refused by the atomic
--                         runs_used counter, not by token state.
--   * blind_runs        — one row per invocation, a strict CAS state machine:
--                         awaiting-key → key-ready → sealed → concluded, with
--                         'refused' reachable from any state (fail-closed).
--                         borrower_input is RELAY-READABLE (stated on /trust —
--                         "blind to Port Daddy" is false and never claimed);
--                         sealed_payload_json is ciphertext the relay cannot
--                         open (no key ever exists relay-side).
--   * blind_receipts    — the per-run receipt {run_id, skill_id, verdict_hash,
--                         tokens_used, iat}, one row per side (lender /
--                         borrower), both rows carrying the SAME executor-
--                         signed body and the SAME chain coordinates of the
--                         conclude event — receipt parity by construction,
--                         asserted by the adversarial harness.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blind_skills (
  skill_id           TEXT    PRIMARY KEY,        -- 'bsk_' || randomHex(12)
  harbor             TEXT    NOT NULL,           -- 'namespace/name' scope caveat
  lender_fingerprint TEXT    NOT NULL,           -- the identity that published (and may mint capabilities)
  title              TEXT    NOT NULL,           -- public metadata, NOT the material
  output_schema_json TEXT    NOT NULL,           -- the output contract (redaction gate)
  created_at         INTEGER NOT NULL,
  revoked            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS blind_skills_lender_idx ON blind_skills (lender_fingerprint);

CREATE TABLE IF NOT EXISTS blind_capabilities (
  jti        TEXT    PRIMARY KEY,                -- 'bj_' || randomHex(12)
  skill_id   TEXT    NOT NULL REFERENCES blind_skills(skill_id),
  harbor     TEXT    NOT NULL,                   -- caveat copy; must equal the skill's harbor
  max_runs   INTEGER NOT NULL,
  runs_used  INTEGER NOT NULL DEFAULT 0,         -- spent atomically; the replay containment
  exp        INTEGER NOT NULL,                   -- unix seconds
  created_at INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS blind_capabilities_skill_idx ON blind_capabilities (skill_id);

CREATE TABLE IF NOT EXISTS blind_runs (
  run_id               TEXT    PRIMARY KEY,      -- 'brun_' || randomHex(12)
  skill_id             TEXT    NOT NULL REFERENCES blind_skills(skill_id),
  jti                  TEXT    NOT NULL,         -- which capability spent a unit
  harbor               TEXT    NOT NULL,
  borrower_input       TEXT    NOT NULL,         -- relay-readable, by design and stated
  status               TEXT    NOT NULL CHECK
                         (status IN ('awaiting-key','key-ready','sealed','concluded','refused')),
  refusal_reason       TEXT,                     -- honest reason whenever status='refused'
  executor_fingerprint TEXT,                     -- pinned at key-post; only this sender may conclude
  run_pubkey           TEXT,                     -- b64url raw P-256 point — the sandbox's per-run key
  sealed_payload_json  TEXT,                     -- pd-seal/1 envelope from the lender (opaque here)
  output_json          TEXT,                     -- contract-conforming output for the borrower
  verdict_hash         TEXT,                     -- sha256 hex of the canonical output / refusal marker
  tokens_used          INTEGER,
  created_at           INTEGER NOT NULL,
  concluded_at         INTEGER
);
CREATE INDEX IF NOT EXISTS blind_runs_skill_status_idx ON blind_runs (skill_id, status);

CREATE TABLE IF NOT EXISTS blind_receipts (
  run_id        TEXT    NOT NULL REFERENCES blind_runs(run_id),
  side          TEXT    NOT NULL CHECK (side IN ('lender','borrower')),
  body_json     TEXT    NOT NULL,                -- {run_id, skill_id, verdict_hash, tokens_used, iat}
  chain_channel TEXT    NOT NULL,                -- coordinates of the executor-signed conclude event
  chain_seq     INTEGER NOT NULL,
  chain_hash    TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (run_id, side)
);
