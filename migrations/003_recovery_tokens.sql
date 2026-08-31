-- Recovery magic-link tokens
-- Spec: whitepaper/formal/proverif/bonded/recovery/magic-link.pv
--
-- The single-use guarantee (property S) is enforced at the application
-- layer via the atomic pattern:
--
--   UPDATE recovery_tokens
--      SET consumed_at = ?
--    WHERE token = ?
--      AND consumed_at IS NULL
--      AND expires_at > ?
--    RETURNING *
--
-- consumed_at IS NULL is the linearizing column: it models the private
-- channel cap in magic-link.pv. SQLite's serialized writes ensure that
-- exactly one concurrent UPDATE can observe IS NULL and proceed.

CREATE TABLE IF NOT EXISTS recovery_tokens (
  token       TEXT    PRIMARY KEY,
  account_id  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rt_account
  ON recovery_tokens(account_id, created_at);

-- Partial index: only live (unconsumed) tokens need expiry scans.
CREATE INDEX IF NOT EXISTS idx_rt_expires
  ON recovery_tokens(expires_at)
  WHERE consumed_at IS NULL;
