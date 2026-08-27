-- APNs DEVICE TOKENS — the iOS push registry for operator interruptions
-- (src/push-apns.ts). Additive only (ADR-0119): a brand-new table + indexes,
-- fully compatible with the previous Worker release, which never reads it.
--
-- One row per (account, device) the operator registered from the iOS app via
-- POST /v1/push/apns/devices. The interruption nag sweep fans each DELIVERED
-- page decision out to the account's live rows (dead_at IS NULL); an APNs 410
-- Unregistered (or 400 BadDeviceToken) sets dead_at so the sweep stops paying
-- for dead tokens. Re-registration clears dead_at. `token` is globally unique:
-- one APNs token = one live device+app instance, so a token re-registered
-- under a new device/account evicts its stale row (the handler deletes first).
--
-- `user_id` is the account scope (users.id) — the same column name every other
-- account-scoped relay table uses.

CREATE TABLE IF NOT EXISTS apns_device_tokens (
  user_id      TEXT    NOT NULL,             -- account scope (users.id)
  device_id    TEXT    NOT NULL,             -- app-chosen stable device id (e.g. identifierForVendor)
  token        TEXT    NOT NULL,             -- hex APNs device token (lowercased)
  platform     TEXT    NOT NULL DEFAULT 'ios'
                       CHECK (platform IN ('ios','ipados','macos')),
  created_at   INTEGER NOT NULL,             -- unix seconds, first registration
  last_seen_at INTEGER NOT NULL,             -- bumped on every re-registration
  dead_at      INTEGER,                      -- set on APNs 410/BadDeviceToken; NULL = live
  PRIMARY KEY (user_id, device_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS apns_tokens_token_idx
  ON apns_device_tokens (token);
CREATE INDEX IF NOT EXISTS apns_tokens_user_live_idx
  ON apns_device_tokens (user_id, dead_at, last_seen_at);
