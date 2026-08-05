-- Shipwright chat (src/shipwright.ts) — the conversational fleet-config
-- architect at GET /account/shipwright. Applied on staging by CI
-- (deploy-relay.yml), then on prod once the ledger gate passes:
--   wrangler d1 execute port-daddy-relay -c wrangler.deploy.toml --remote \
--     --file=./migrations/2026-08-04-shipwright-chats.sql
--
-- One row per chat message, scoped to the signed-in web user (users.id).
-- The INTEGER AUTOINCREMENT id is the conversation order (created_at is
-- unix seconds and two messages routinely share a second). Lifecycle is
-- ADR-0101-shaped: rows are exported with /account/export, deleted with the
-- user's own clear control, purged immediately by eraseUser, defensively
-- purged for soft-deleted users by the erasure sweep, and age-pruned by the
-- retention sweep (SHIPWRIGHT_RETENTION_DAYS).

CREATE TABLE IF NOT EXISTS shipwright_chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL REFERENCES users(id),
  role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
-- (user_id, id) covers the session-scoped ordered read AND the per-user purge.
CREATE INDEX IF NOT EXISTS shipwright_chats_user_idx ON shipwright_chats (user_id, id);
-- The retention sweep prunes by age.
CREATE INDEX IF NOT EXISTS shipwright_chats_created_idx ON shipwright_chats (created_at);
