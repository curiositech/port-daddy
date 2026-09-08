-- ADR-0101 Phase 1 — device-flow personal access tokens (pdu_) for non-browser
-- surfaces (CLI, FleetBar, pd-console). Apply on the deployed D1 with:
--   wrangler d1 execute port-daddy-relay -c wrangler.deploy.toml --remote \
--     --file=./migrations/2026-07-23-user-tokens.sql
CREATE TABLE IF NOT EXISTS user_tokens (
  token_hash   TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id),
  label        TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at   INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS user_tokens_user_idx ON user_tokens (user_id);
