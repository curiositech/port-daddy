-- Bind every Fleetbot mutation to a live daemon signing-key generation, a
-- one-logical-use capability nonce, and a fenced intent lease.
--
-- Additive defaults keep the previous Worker release rollback-compatible.
ALTER TABLE identities
  ADD COLUMN key_generation INTEGER NOT NULL DEFAULT 1
  CHECK (key_generation > 0);

ALTER TABLE github_publisher_intents
  ADD COLUMN lease_fence INTEGER NOT NULL DEFAULT 0
  CHECK (lease_fence >= 0);

CREATE TABLE github_publisher_capability_uses (
  daemon_fingerprint    TEXT    NOT NULL,
  signing_key_generation INTEGER NOT NULL CHECK (signing_key_generation > 0),
  nonce                 TEXT    NOT NULL CHECK (length(nonce) = 64),
  account_user_id       TEXT    NOT NULL REFERENCES users(id),
  account_token_hash    TEXT    NOT NULL CHECK (length(account_token_hash) = 64),
  request_hash          TEXT    NOT NULL CHECK (length(request_hash) = 64),
  idempotency_key       TEXT    NOT NULL,
  consumed_at           INTEGER NOT NULL,
  PRIMARY KEY (daemon_fingerprint, signing_key_generation, nonce)
);

CREATE INDEX github_publisher_capability_account_idx
  ON github_publisher_capability_uses (account_user_id, consumed_at DESC);
