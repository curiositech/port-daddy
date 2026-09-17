-- Standing operator grants for the Fleetbot GitHub App publisher.
--
-- A grant id is a public reference, never a bearer. Every use also requires a
-- short-lived capability signed by the exact live workload identity named by
-- the grant. The publisher re-reads this row on every request.
CREATE TABLE IF NOT EXISTS github_publisher_credentials (
  account_user_id       TEXT    PRIMARY KEY REFERENCES users(id),
  generation            INTEGER NOT NULL CHECK (generation > 0),
  credential_enc        TEXT    NOT NULL,
  credential_iv         TEXT    NOT NULL,
  credential_key_version INTEGER NOT NULL CHECK (credential_key_version > 0),
  updated_at             INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS publisher_grants (
  grant_id             TEXT    PRIMARY KEY
                               CHECK (substr(grant_id, 1, 4) = 'pdg_'
                                 AND length(grant_id) = 36
                                 AND substr(grant_id, 5) NOT GLOB '*[^0-9a-f]*'),
  epoch                INTEGER NOT NULL CHECK (epoch > 0),
  surface              TEXT    NOT NULL CHECK (surface = 'publisher'),
  account_user_id      TEXT    NOT NULL REFERENCES users(id),
  subject_fingerprint  TEXT    NOT NULL REFERENCES identities(daemon_fingerprint)
                               CHECK (length(subject_fingerprint) = 64
                                 AND subject_fingerprint NOT GLOB '*[^0-9a-f]*'),
  subject_class        TEXT    NOT NULL CHECK (subject_class IN ('ci', 'host')),
  installation_id      INTEGER NOT NULL CHECK (installation_id > 0),
  repositories_json    TEXT    NOT NULL CHECK (json_valid(repositories_json) AND json_type(repositories_json) = 'array'
                                 AND json_array_length(repositories_json) BETWEEN 1 AND 100),
  operations_json      TEXT    NOT NULL CHECK (json_valid(operations_json) AND json_type(operations_json) = 'array'
                                 AND json_array_length(operations_json) BETWEEN 1 AND 8),
  branch_allow_json    TEXT    NOT NULL CHECK (json_valid(branch_allow_json) AND json_type(branch_allow_json) = 'array'
                                 AND json_array_length(branch_allow_json) BETWEEN 1 AND 100),
  base_allow_json      TEXT    NOT NULL CHECK (json_valid(base_allow_json) AND json_type(base_allow_json) = 'array'
                                 AND json_array_length(base_allow_json) BETWEEN 1 AND 100),
  mutations_per_day    INTEGER NOT NULL CHECK (mutations_per_day BETWEEN 1 AND 1000),
  expires_at           INTEGER NOT NULL,
  created_at           INTEGER NOT NULL,
  created_via          TEXT    NOT NULL CHECK (created_via IN ('account-ui', 'operator-bootstrap')),
  created_ip           TEXT,
  revoked_at           INTEGER,
  revoked_reason       TEXT,
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS publisher_grants_account_idx
  ON publisher_grants (account_user_id, surface, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS publisher_grants_subject_idx
  ON publisher_grants (subject_fingerprint, surface, revoked_at, expires_at);
CREATE TRIGGER IF NOT EXISTS publisher_grants_insert_scope
BEFORE INSERT ON publisher_grants
BEGIN
  -- D1's remote parser has rejected valid trigger CASE bodies as incomplete
  -- while local SQLite accepts them. Keep one parenthesized CASE statement:
  -- https://github.com/cloudflare/workers-sdk/issues/4326
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.repositories_json)
     WHERE type != 'text' OR value != lower(value) OR value NOT LIKE '%/%'
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.operations_json)
     WHERE type != 'text' OR value NOT IN (
       'pull-request.publish', 'pull-request.update', 'pull-request.ready',
       'pull-request.request-reviewers', 'pull-request.comment',
       'pull-request.review-reply', 'pull-request.enqueue', 'pull-request.inspect'
     )
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.branch_allow_json)
     WHERE type != 'text' OR length(value) > 200 OR value = ''
       OR value GLOB '*[^A-Za-z0-9._/-]*' OR value LIKE '%..%' OR value LIKE '%//%'
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.base_allow_json)
     WHERE type != 'text' OR length(value) > 200 OR value = '' OR value LIKE '%/'
       OR value GLOB '*[^A-Za-z0-9._/-]*' OR value LIKE '%..%' OR value LIKE '%//%'
  ) OR EXISTS (SELECT value FROM json_each(NEW.repositories_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.operations_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.branch_allow_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.base_allow_json) GROUP BY value HAVING count(*) > 1)
  THEN RAISE(ABORT, 'publisher grant scope invalid') END);
END;
-- A grant is a signed standing authority, not a mutable policy document. Scope
-- changes mint a new grant id; the only permitted mutation is one-way
-- revocation. Keeping epoch immutable also makes every capability's authority
-- stable under retry and audit.
CREATE TRIGGER IF NOT EXISTS publisher_grants_immutable_authority
BEFORE UPDATE OF grant_id, epoch, surface, account_user_id, subject_fingerprint,
  subject_class, installation_id, repositories_json, operations_json,
  branch_allow_json, base_allow_json, mutations_per_day, expires_at,
  created_at, created_via, created_ip ON publisher_grants
BEGIN
  SELECT RAISE(ABORT, 'publisher grant authority is immutable; create a new grant');
END;
CREATE TRIGGER IF NOT EXISTS publisher_grants_irreversible_revocation
BEFORE UPDATE OF revoked_at, revoked_reason ON publisher_grants
BEGIN
  SELECT CASE WHEN OLD.revoked_at IS NOT NULL
      OR NEW.revoked_at IS NULL OR NEW.revoked_reason IS NULL
      OR length(trim(NEW.revoked_reason)) = 0
    THEN RAISE(ABORT, 'publisher grant revocation is irreversible') END;
END;

-- A session id belongs to a workload identity, not to any one tenant grant.
-- The first-grant reference is nullable provenance, not ownership: the same
-- workload session may exercise independently authorized grants for different
-- tenants. Erasing the first tenant nulls that provenance without destroying
-- another tenant's replay evidence or allowing the session id to be rebound.
CREATE TABLE IF NOT EXISTS github_publisher_session_bindings (
  session_id           TEXT PRIMARY KEY,
  subject_fingerprint  TEXT NOT NULL REFERENCES identities(daemon_fingerprint),
  first_grant_id       TEXT REFERENCES publisher_grants(grant_id) ON DELETE SET NULL,
  bound_at             INTEGER NOT NULL
);

-- Keep the v1 table at its original name. D1 applies migrations before the new
-- Worker is deployed, so the previous Worker and a rollback must remain able to
-- record their already-authorized uses during the rollout. New code is v2-only.
CREATE TABLE IF NOT EXISTS github_publisher_capability_uses_v2 (
  daemon_fingerprint     TEXT    NOT NULL,
  signing_key_generation INTEGER NOT NULL CHECK (signing_key_generation > 0),
  nonce                  TEXT    NOT NULL CHECK (length(nonce) = 64),
  grant_id               TEXT    NOT NULL REFERENCES publisher_grants(grant_id),
  grant_epoch            INTEGER NOT NULL CHECK (grant_epoch > 0),
  session_id             TEXT    NOT NULL REFERENCES github_publisher_session_bindings(session_id),
  request_hash           TEXT    NOT NULL CHECK (length(request_hash) = 64),
  idempotency_key        TEXT    NOT NULL,
  is_mutation            INTEGER NOT NULL CHECK (is_mutation IN (0, 1)),
  consumed_at            INTEGER NOT NULL,
  PRIMARY KEY (daemon_fingerprint, signing_key_generation, nonce),
  UNIQUE (grant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS github_publisher_capability_v2_grant_idx
  ON github_publisher_capability_uses_v2 (grant_id, consumed_at DESC, is_mutation);
CREATE INDEX IF NOT EXISTS github_publisher_capability_v2_session_idx
  ON github_publisher_capability_uses_v2 (session_id, consumed_at DESC);
