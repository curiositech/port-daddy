-- Standing operator grants for the Fleetbot GitHub App publisher.
--
-- A grant id is a public reference, never a bearer. Every use also requires a
-- short-lived capability signed by the exact live workload identity named by
-- the grant. The publisher re-reads this row on every request.
CREATE TABLE publisher_grants (
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
CREATE INDEX publisher_grants_account_idx
  ON publisher_grants (account_user_id, surface, revoked_at, expires_at);
CREATE INDEX publisher_grants_subject_idx
  ON publisher_grants (subject_fingerprint, surface, revoked_at, expires_at);
CREATE TRIGGER publisher_grants_insert_scope
BEFORE INSERT ON publisher_grants
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.repositories_json)
     WHERE type != 'text' OR value != lower(value) OR value NOT LIKE '%/%'
  ) THEN RAISE(ABORT, 'publisher grant repository scope invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.operations_json)
     WHERE type != 'text' OR value NOT IN (
       'pull-request.publish', 'pull-request.update', 'pull-request.ready',
       'pull-request.request-reviewers', 'pull-request.comment',
       'pull-request.review-reply', 'pull-request.enqueue', 'pull-request.inspect'
     )
  ) THEN RAISE(ABORT, 'publisher grant operation scope invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.branch_allow_json)
     WHERE type != 'text' OR length(value) > 200 OR value = ''
       OR value GLOB '*[^A-Za-z0-9._/-]*' OR value LIKE '%..%' OR value LIKE '%//%'
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.base_allow_json)
     WHERE type != 'text' OR length(value) > 200 OR value = '' OR value LIKE '%/'
       OR value GLOB '*[^A-Za-z0-9._/-]*' OR value LIKE '%..%' OR value LIKE '%//%'
  ) THEN RAISE(ABORT, 'publisher grant branch scope invalid') END;
  SELECT CASE WHEN EXISTS (SELECT value FROM json_each(NEW.repositories_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.operations_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.branch_allow_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.base_allow_json) GROUP BY value HAVING count(*) > 1)
  THEN RAISE(ABORT, 'publisher grant scope contains duplicates') END;
END;
CREATE TRIGGER publisher_grants_update_epoch
BEFORE UPDATE OF subject_fingerprint, subject_class, installation_id,
  repositories_json, operations_json, branch_allow_json, base_allow_json,
  mutations_per_day, expires_at ON publisher_grants
BEGIN
  SELECT CASE WHEN NEW.epoch != OLD.epoch + 1
    THEN RAISE(ABORT, 'publisher grant scope update must increment epoch') END;
END;
CREATE TRIGGER publisher_grants_update_scope
BEFORE UPDATE ON publisher_grants
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.repositories_json)
     WHERE type != 'text' OR value != lower(value) OR value NOT LIKE '%/%'
  ) THEN RAISE(ABORT, 'publisher grant repository scope invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.operations_json)
     WHERE type != 'text' OR value NOT IN (
       'pull-request.publish', 'pull-request.update', 'pull-request.ready',
       'pull-request.request-reviewers', 'pull-request.comment',
       'pull-request.review-reply', 'pull-request.enqueue', 'pull-request.inspect'
     )
  ) THEN RAISE(ABORT, 'publisher grant operation scope invalid') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.branch_allow_json)
     WHERE type != 'text' OR length(value) > 200 OR value = ''
       OR value GLOB '*[^A-Za-z0-9._/-]*' OR value LIKE '%..%' OR value LIKE '%//%'
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.base_allow_json)
     WHERE type != 'text' OR length(value) > 200 OR value = '' OR value LIKE '%/'
       OR value GLOB '*[^A-Za-z0-9._/-]*' OR value LIKE '%..%' OR value LIKE '%//%'
  ) THEN RAISE(ABORT, 'publisher grant branch scope invalid') END;
  SELECT CASE WHEN EXISTS (SELECT value FROM json_each(NEW.repositories_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.operations_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.branch_allow_json) GROUP BY value HAVING count(*) > 1)
    OR EXISTS (SELECT value FROM json_each(NEW.base_allow_json) GROUP BY value HAVING count(*) > 1)
  THEN RAISE(ABORT, 'publisher grant scope contains duplicates') END;
END;

-- The first valid use permanently namespaces a session id to one workload.
CREATE TABLE github_publisher_session_bindings (
  session_id           TEXT PRIMARY KEY,
  subject_fingerprint  TEXT NOT NULL REFERENCES identities(daemon_fingerprint),
  first_grant_id       TEXT NOT NULL REFERENCES publisher_grants(grant_id),
  bound_at             INTEGER NOT NULL
);

-- Preserve retired v1 replay evidence. There is no authored v1 client, so the
-- runtime is v2-only rather than carrying an operator-bearer compatibility path.
ALTER TABLE github_publisher_capability_uses
  RENAME TO github_publisher_capability_uses_v1_retired;
DROP INDEX github_publisher_capability_account_idx;

CREATE TABLE github_publisher_capability_uses (
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
  PRIMARY KEY (daemon_fingerprint, signing_key_generation, nonce)
);
CREATE INDEX github_publisher_capability_grant_idx
  ON github_publisher_capability_uses (grant_id, consumed_at DESC, is_mutation);
CREATE INDEX github_publisher_capability_session_idx
  ON github_publisher_capability_uses (session_id, consumed_at DESC);
