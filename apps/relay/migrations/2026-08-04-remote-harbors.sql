-- X2 REMOTE HARBORS v1 — keypair + namespace + membership, nothing more
-- (docs/proposals/relay-grand-plan.md §X2; src/harbors.ts). Applied to staging
-- by deploy-relay.yml; prod via the migrations gate (ADR-0119).
--
-- Two tables:
--   harbors            — one row per remote harbor: a NAME in a NAMESPACE plus
--                        an ed25519 PUBKEY. The keypair is generated CLIENT-side
--                        and only the public half ever reaches the relay — the
--                        relay signs nothing on a harbor's behalf. The namespace
--                        is the creator's GitHub login (server-derived, never
--                        client-supplied), so namespaces cannot be squatted.
--   harbor_memberships — who belongs to a harbor (a relay user account or a
--                        daemon identity) and with what role. NOT the legacy
--                        zero-trust `harbor_members` daemon-admission table the
--                        publish/handshake path gates on (src/handlers.ts):
--                        a row HERE grants operator-plane API visibility only,
--                        never channel publish rights. Deliberately separate so
--                        session-auth writes can never widen the crypto plane.

CREATE TABLE IF NOT EXISTS harbors (
  id         TEXT    PRIMARY KEY,               -- 'h_' || randomHex(16)
  namespace  TEXT    NOT NULL,                  -- creator's GitHub login, lowercased (server-derived)
  name       TEXT    NOT NULL,                  -- client-chosen short name, lowercased
  pubkey     TEXT    NOT NULL,                  -- ed25519 public key, 64 hex chars (client-generated)
  created_by TEXT    NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,                  -- unix seconds
  UNIQUE (namespace, name)
);

CREATE TABLE IF NOT EXISTS harbor_memberships (
  harbor_id   TEXT    NOT NULL REFERENCES harbors(id),
  member_kind TEXT    NOT NULL CHECK (member_kind IN ('user','daemon')),
  member_id   TEXT    NOT NULL,                 -- users.id ('user') or identities.daemon_fingerprint ('daemon')
  role        TEXT    NOT NULL CHECK (role IN ('owner','member')),
  added_at    INTEGER NOT NULL,                 -- unix seconds
  added_by    TEXT    NOT NULL,                 -- users.id of the operator who added the row
  PRIMARY KEY (harbor_id, member_kind, member_id)
);
CREATE INDEX IF NOT EXISTS harbor_memberships_member_idx
  ON harbor_memberships (member_kind, member_id);
