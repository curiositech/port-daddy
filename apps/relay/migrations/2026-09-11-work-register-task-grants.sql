-- Browser-approved, task-scoped admission to the Harbor Work Register.
--
-- The operator approves one named task for one repository while authenticated
-- through GitHub. The browser receives a one-use pairing code; only its hash is
-- stored. Exchanging that code mints a short-lived `pdr_` bearer whose hash is
-- likewise the only durable credential material. This table is deliberately
-- separate from `user_tokens`: a Register grant is not a general Relay token.
CREATE TABLE IF NOT EXISTS work_register_grants (
  id                   TEXT    NOT NULL PRIMARY KEY,
  user_id              TEXT    NOT NULL REFERENCES users(id),
  repo_full_name       TEXT    NOT NULL,
  agent                TEXT    NOT NULL,
  owner                TEXT    NOT NULL,
  pairing_code_hash    TEXT    NOT NULL UNIQUE,
  token_hash           TEXT    UNIQUE,
  created_at           INTEGER NOT NULL,
  exchange_expires_at  INTEGER NOT NULL,
  exchanged_at         INTEGER,
  token_expires_at     INTEGER,
  last_used_at         INTEGER,
  revoked_at           INTEGER,
  CHECK (length(agent) BETWEEN 1 AND 120),
  CHECK (length(owner) BETWEEN 1 AND 200),
  CHECK (exchange_expires_at > created_at),
  CHECK (
    (exchanged_at IS NULL AND token_hash IS NULL AND token_expires_at IS NULL)
    OR
    (exchanged_at IS NOT NULL AND token_hash IS NOT NULL AND token_expires_at > exchanged_at)
  )
);

CREATE INDEX IF NOT EXISTS idx_work_register_grants_operator
  ON work_register_grants(user_id, repo_full_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_register_grants_token
  ON work_register_grants(token_hash, token_expires_at, revoked_at);
