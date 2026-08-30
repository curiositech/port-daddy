-- WS-B slice B3 (relay half) — device X25519-key registry + wrap-relay routes
-- (docs/adr/0123-cloud-vault-account-kms.md; src/device-keys.ts). Applied to
-- staging by deploy-relay.yml; prod via the migrations gate (ADR-0119).
-- Additive and forward-only per this directory's README.
--
-- Scope note (ADR-0123 §2 custody doctrine + this slice's own deferral): this
-- migration stores PUBLIC key material and CIPHERTEXT only. It never stores,
-- derives, or touches a channel/content/snapshot key, and it implements no
-- part of the WebAuthn device-card ceremony — device_id and the device's
-- X25519 public key are bare, caller-supplied strings, exactly as
-- KeyWrapAad.recipientDeviceId is already a bare string with no
-- enum/existence validation in lib/pd-vault-ts.ts. The full device-card
-- binding is future work, tracked separately.
--
-- device_keys — one row per (account, device): the device's registered
--   X25519 HPKE wrapping public key. Account-scoped, NOT harbor-scoped — a
--   device is enrolled once and receives wraps across every harbor its
--   account belongs to (ADR-0123 §1's device card). user_id is the account
--   scope (users.id) — the same column name every other account-scoped relay
--   table uses (apns_device_tokens). Re-registration under the same
--   (user_id, device_id) rotates the key (upsert), matching push-apns'
--   re-registration-replaces semantics.
--
--   device_id is made GLOBALLY UNIQUE (device_keys_device_id_idx below), not
--   just unique per account, mirroring apns_device_tokens.token's exact
--   precedent (its PK is also (user_id, device_id) with a separate global-
--   unique index on the value every OTHER lookup needs). This is what lets
--   GET /v1/harbors/:ns/:name/devices/:deviceId/key resolve a bare device_id
--   to its owning account with one indexed lookup instead of a table scan —
--   see src/device-keys.ts getDeviceKeyOwner. Two different accounts can
--   never register the same device_id string; the daemon-side device-id
--   generation scheme must pick collision-resistant ids (this is a real
--   constraint the future WebAuthn device-card work should revisit, not a
--   free assumption).
--
-- harbor_key_wraps — one row per HPKE-wrapped channel key handed to one
--   recipient device for one harbor, at one authority epoch, for one
--   (grant, key_purpose, key_id) coordinate. This table mirrors
--   lib/pd-vault-ts.ts's KeyWrapAad + WrappedKey wire shapes field-for-field:
--   the composite primary key IS the AAD's uniqueness — the vault's own
--   unambiguousEncoding already treats these seven fields as the identity of
--   a wrap, so the relay's row identity matches it exactly rather than
--   inventing a second notion of "the same wrap."
--   * enc / ciphertext are Base64URL TEXT (src/crypto.ts base64UrlEncode),
--     the same encoding convention as events.ciphertext and every other
--     relay-side ciphertext column — never raw bytes, never plaintext.
--   * recipient_user_id is CAPTURED AT WRAP TIME from device_keys, never
--     accepted from the poster's request body (namespace/account fields are
--     server-derived throughout this codebase, never client input) — this
--     is what lets a GET enforce "never leak a wrap across harbors or
--     accounts" with a single indexed WHERE clause instead of a join.
--   * wrapped_by is the harbor member who posted it (audit trail only; per
--     ADR-0123 §2 the relay enforces no writer-vs-member distinction here).
--   * No delete/consumed-at column in this slice (see spec's open
--     questions) — the fetch route is a pure, idempotent read.

CREATE TABLE IF NOT EXISTS device_keys (
  user_id       TEXT    NOT NULL REFERENCES users(id),
  device_id     TEXT    NOT NULL,                 -- bare caller-supplied id; no enum/existence check (scope boundary)
  x25519_pubkey TEXT    NOT NULL CHECK (length(x25519_pubkey) = 64),  -- 32-byte raw X25519 pubkey, lowercase hex
  created_at    INTEGER NOT NULL,                 -- unix seconds, first registration
  updated_at    INTEGER NOT NULL,                 -- unix seconds, bumped on every rotation
  PRIMARY KEY (user_id, device_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS device_keys_device_id_idx
  ON device_keys (device_id);

CREATE TABLE IF NOT EXISTS harbor_key_wraps (
  harbor_id            TEXT    NOT NULL REFERENCES harbors(id),
  authority_epoch      INTEGER NOT NULL,          -- ADR-0122 epoch this wrap was cut under
  recipient_device_id  TEXT    NOT NULL,          -- KeyWrapAad.recipientDeviceId (bare string)
  key_purpose          TEXT    NOT NULL,          -- KeyWrapAad.keyPurpose; e.g. "channel" — not enum-checked (matches the vault's own non-enforcement)
  key_id               TEXT    NOT NULL,          -- KeyWrapAad.keyId
  grant                TEXT    NOT NULL,          -- KeyWrapAad.grant; e.g. "use" — not enum-checked, same reason
  recipient_user_id    TEXT    NOT NULL REFERENCES users(id),  -- server-derived from device_keys at insert time, NEVER client input
  enc                  TEXT    NOT NULL,          -- Base64URL RFC 9180 `enc` (HPKE ephemeral X25519 pubkey)
  ciphertext            TEXT    NOT NULL,         -- Base64URL AES-256-GCM ciphertext (body || 16-byte tag)
  wrapped_by             TEXT    NOT NULL REFERENCES users(id),  -- the harbor member who posted this wrap (audit only)
  created_at              INTEGER NOT NULL,       -- unix seconds
  PRIMARY KEY (harbor_id, authority_epoch, recipient_device_id, key_purpose, key_id)
);
CREATE INDEX IF NOT EXISTS harbor_key_wraps_recipient_idx
  ON harbor_key_wraps (harbor_id, recipient_device_id, authority_epoch);
