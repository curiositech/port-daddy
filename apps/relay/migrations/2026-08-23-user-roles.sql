-- ADR-0101 Phase 1: account-backed Cloud Fleet operator authorization.
--
-- pdu_ device tokens prove user identity. This separate server-owned ledger
-- grants the team-scoped operator authority used by /v1/fleet/*, replacing the
-- impossible requirement that native clients know RELAY_OPERATOR_TOKEN.

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT    NOT NULL REFERENCES users(id),
  role       TEXT    NOT NULL CHECK (role IN ('operator')),
  source     TEXT    NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, role)
);
