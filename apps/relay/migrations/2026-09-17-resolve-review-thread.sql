-- Add the exact, reviewable Fleetbot operation that closes one GitHub review
-- thread after a reply. Rebuild the intent table because SQLite cannot widen
-- an existing CHECK constraint in place.
DROP INDEX IF EXISTS github_publisher_session_idx;
DROP INDEX IF EXISTS github_publisher_resource_idx;
ALTER TABLE github_publisher_intents RENAME TO github_publisher_intents_before_thread_resolution;

CREATE TABLE github_publisher_intents (
  account_user_id TEXT NOT NULL REFERENCES users(id),
  account_github_user_id INTEGER NOT NULL,
  installation_id INTEGER NOT NULL,
  repository TEXT NOT NULL,
  scope_sha TEXT NOT NULL CHECK (length(scope_sha) = 40),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  operation TEXT NOT NULL CHECK (operation IN (
    'pull-request.publish','pull-request.update','pull-request.ready',
    'pull-request.request-reviewers','pull-request.comment',
    'pull-request.review-reply','pull-request.resolve-review-thread',
    'pull-request.enqueue','pull-request.inspect')),
  state TEXT NOT NULL CHECK (state IN ('reserved','running','ambiguous','succeeded','failed')),
  actor_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  identity_project TEXT NOT NULL,
  roadmap_item TEXT,
  resource_number INTEGER,
  resource_url TEXT,
  published_branch TEXT,
  github_head_sha TEXT,
  receipt_json TEXT CHECK (receipt_json IS NULL OR json_valid(receipt_json)),
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  lease_fence INTEGER NOT NULL DEFAULT 0 CHECK (lease_fence >= 0),
  recovery_binding_json TEXT CHECK (
    recovery_binding_json IS NULL OR (
      json_valid(recovery_binding_json)
      AND json_type(recovery_binding_json) = 'object'
      AND json_type(recovery_binding_json, '$.grantId') = 'text'
      AND length(json_extract(recovery_binding_json, '$.grantId')) = 36
      AND substr(json_extract(recovery_binding_json, '$.grantId'), 1, 4) = 'pdg_'
      AND substr(json_extract(recovery_binding_json, '$.grantId'), 5) NOT GLOB '*[^0-9a-f]*'
      AND json_type(recovery_binding_json, '$.grantEpoch') = 'integer'
      AND json_extract(recovery_binding_json, '$.grantEpoch') > 0
      AND json_type(recovery_binding_json, '$.repository') = 'text'
      AND length(json_extract(recovery_binding_json, '$.repository')) BETWEEN 3 AND 201
      AND instr(json_extract(recovery_binding_json, '$.repository'), '/') > 1
      AND json_type(recovery_binding_json, '$.operation') = 'text'
      AND json_extract(recovery_binding_json, '$.operation') IN (
        'pull-request.publish','pull-request.update','pull-request.ready',
        'pull-request.request-reviewers','pull-request.comment',
        'pull-request.review-reply','pull-request.resolve-review-thread',
        'pull-request.enqueue','pull-request.inspect')
      AND json_type(recovery_binding_json, '$.baseBranch') = 'text'
      AND length(json_extract(recovery_binding_json, '$.baseBranch')) BETWEEN 1 AND 255
      AND json_type(recovery_binding_json, '$.baseSha') = 'text'
      AND length(json_extract(recovery_binding_json, '$.baseSha')) = 40
      AND json_extract(recovery_binding_json, '$.baseSha') NOT GLOB '*[^0-9a-fA-F]*'
      AND json_type(recovery_binding_json, '$.headSha') = 'text'
      AND length(json_extract(recovery_binding_json, '$.headSha')) = 40
      AND json_extract(recovery_binding_json, '$.headSha') NOT GLOB '*[^0-9a-fA-F]*'
      AND json_type(recovery_binding_json, '$.sessionId') = 'text'
      AND length(json_extract(recovery_binding_json, '$.sessionId')) BETWEEN 1 AND 256
      AND json_type(recovery_binding_json, '$.requestHash') = 'text'
      AND length(json_extract(recovery_binding_json, '$.requestHash')) = 64
      AND json_extract(recovery_binding_json, '$.requestHash') NOT GLOB '*[^0-9a-fA-F]*'
      AND json_type(recovery_binding_json, '$.idempotencyKey') = 'text'
      AND length(json_extract(recovery_binding_json, '$.idempotencyKey')) BETWEEN 1 AND 256
    )
  ),
  PRIMARY KEY (account_user_id, installation_id, repository, scope_sha, idempotency_key)
);

INSERT INTO github_publisher_intents (
  account_user_id, account_github_user_id, installation_id, repository,
  scope_sha, idempotency_key, request_hash, operation, state, actor_id,
  agent_id, session_id, identity_project, roadmap_item, resource_number,
  resource_url, published_branch, github_head_sha, receipt_json, error_code,
  created_at, updated_at, lease_fence, recovery_binding_json
)
SELECT
  account_user_id, account_github_user_id, installation_id, repository,
  scope_sha, idempotency_key, request_hash, operation, state, actor_id,
  agent_id, session_id, identity_project, roadmap_item, resource_number,
  resource_url, published_branch, github_head_sha, receipt_json, error_code,
  created_at, updated_at, lease_fence, recovery_binding_json
FROM github_publisher_intents_before_thread_resolution;

DROP TABLE github_publisher_intents_before_thread_resolution;
CREATE INDEX github_publisher_session_idx
  ON github_publisher_intents (session_id, updated_at DESC);
CREATE INDEX github_publisher_resource_idx
  ON github_publisher_intents (repository, resource_number, updated_at DESC);

-- Existing grants may opt into the new operation only after an operator mints
-- that exact scope. Keep every other allow-list rule unchanged.
DROP TRIGGER publisher_grants_insert_scope;
CREATE TRIGGER publisher_grants_insert_scope
BEFORE INSERT ON publisher_grants
BEGIN
  -- D1's remote parser has rejected valid trigger CASE bodies as incomplete
  -- while local SQLite accepts them. Avoid CASE and keep one statement:
  -- https://github.com/cloudflare/workers-sdk/issues/4326
  SELECT RAISE(ABORT, 'publisher grant scope invalid') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.repositories_json)
     WHERE type != 'text' OR value != lower(value) OR value NOT LIKE '%/%'
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.operations_json)
     WHERE type != 'text' OR value NOT IN (
       'pull-request.publish', 'pull-request.update', 'pull-request.ready',
       'pull-request.request-reviewers', 'pull-request.comment',
       'pull-request.review-reply', 'pull-request.resolve-review-thread',
       'pull-request.enqueue', 'pull-request.inspect'
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
    OR EXISTS (SELECT value FROM json_each(NEW.base_allow_json) GROUP BY value HAVING count(*) > 1);
END;
