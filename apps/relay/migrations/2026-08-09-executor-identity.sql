-- N2 EXECUTOR IDENTITY — widen identities.proof_method to admit
-- 'operator-provisioned' (docs/proposals/relay-grand-plan.md N2;
-- src/fleet-executor-identity.ts). Applied to staging by deploy-relay.yml;
-- prod via the migrations gate (ADR-0119).
--
-- SQLite cannot ALTER a CHECK constraint, so this is the standard rebuild:
-- create the widened table, copy, drop, rename. Column set is IDENTICAL to
-- the previous shape, so the previous Worker release keeps working after a
-- rollback (rule 3: forward-only, rollback-compatible).

CREATE TABLE identities_n2 (
  daemon_fingerprint TEXT    PRIMARY KEY,
  pub_key            TEXT    NOT NULL,
  proof_method       TEXT    NOT NULL CHECK (proof_method IN ('oidc','acme','wot','operator-provisioned')),
  proof_metadata     TEXT    NOT NULL,
  expires_at         INTEGER,
  revoked            INTEGER NOT NULL DEFAULT 0,
  revoked_reason     TEXT,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO identities_n2
  SELECT daemon_fingerprint, pub_key, proof_method, proof_metadata,
         expires_at, revoked, revoked_reason, created_at
  FROM identities;

DROP TABLE identities;

ALTER TABLE identities_n2 RENAME TO identities;
