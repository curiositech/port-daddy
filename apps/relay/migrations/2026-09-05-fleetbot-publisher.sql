-- General Fleetbot GitHub App publisher.
--
-- A single sealed credential contains the access/refresh pair and their
-- expirations. AES-GCM AAD binds it to (table kind, token_hash, user_id,
-- key_version); the version selects the explicit rotation keyring.
-- Existing pdu_ rows remain valid for non-publisher APIs but have no GitHub
-- grant and therefore fail closed for publication until the device reauths.
ALTER TABLE user_tokens ADD COLUMN gh_credential_enc TEXT;
ALTER TABLE user_tokens ADD COLUMN gh_credential_iv TEXT;
ALTER TABLE user_tokens ADD COLUMN gh_credential_key_version INTEGER;

-- One durable intent per authenticated account + installation + repository +
-- exact source boundary. The canonical request hash detects a reused key with
-- different bytes; receipt_json makes ambiguous network retries recoverable.
CREATE TABLE github_publisher_intents (
  account_user_id       TEXT    NOT NULL REFERENCES users(id),
  account_github_user_id INTEGER NOT NULL,
  installation_id       INTEGER NOT NULL,
  repository            TEXT    NOT NULL,
  scope_sha              TEXT    NOT NULL CHECK (length(scope_sha) = 40),
  idempotency_key        TEXT    NOT NULL,
  request_hash           TEXT    NOT NULL CHECK (length(request_hash) = 64),
  operation              TEXT    NOT NULL CHECK (operation IN (
    'pull-request.publish',
    'pull-request.update',
    'pull-request.ready',
    'pull-request.request-reviewers',
    'pull-request.comment',
    'pull-request.review-reply',
    'pull-request.enqueue',
    'pull-request.inspect'
  )),
  state                  TEXT    NOT NULL CHECK (state IN (
    'reserved', 'running', 'ambiguous', 'succeeded', 'failed'
  )),
  actor_id               TEXT    NOT NULL,
  agent_id               TEXT    NOT NULL,
  session_id             TEXT    NOT NULL,
  identity_project       TEXT    NOT NULL,
  roadmap_item           TEXT,
  resource_number        INTEGER,
  resource_url           TEXT,
  published_branch       TEXT,
  github_head_sha        TEXT,
  receipt_json           TEXT CHECK (receipt_json IS NULL OR json_valid(receipt_json)),
  error_code             TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  PRIMARY KEY (account_user_id, installation_id, repository, scope_sha, idempotency_key)
);
CREATE INDEX github_publisher_session_idx
  ON github_publisher_intents (session_id, updated_at DESC);
CREATE INDEX github_publisher_resource_idx
  ON github_publisher_intents (repository, resource_number, updated_at DESC);
