-- CHARTROOM AUTHORITY KERNEL — append-only plans, decisions, and source lineage.
--
-- Provenance: manually reconciled from the abandoned Grand Harbor Oracle
-- prototype (migration SHA-256
-- 8bcded7e4137ec43b3b6840730e8d5650d07751bb218b3b5404c2084c67fef66;
-- module SHA-256
-- 3d9c98f3d82b621b0e1688d27c43caf16215a9e73ec58b08320970eb96a92fca).
-- This migration keeps its append-only event/CAS/hash-chain foundation while
-- replacing its repository-only tenancy, Oracle naming, and legacy-snapshot
-- cutover coupling. It is additive and forward-only: the previous Worker does
-- not know these tables and therefore remains rollback-compatible.
--
-- EVERY durable row repeats the complete isolation tuple. This is deliberate
-- denormalization: an omitted account/team/repository/harbor/resource predicate
-- becomes visible in code review instead of silently relying on a transitive
-- join. GitHub numeric ids are TEXT so JavaScript never rounds a future 64-bit
-- identifier.

CREATE TABLE IF NOT EXISTS chartroom_capabilities (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  token_hash       TEXT    NOT NULL,
  permission       TEXT    NOT NULL CHECK (permission IN ('read', 'write')),
  installation_id  TEXT    NOT NULL,
  minted_by        TEXT    NOT NULL REFERENCES users(id),
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  revoked_at       INTEGER,
  event_count      INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  max_events       INTEGER NOT NULL DEFAULT 1000 CHECK (max_events BETWEEN 1 AND 10000),
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, token_hash
  ),
  UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS chartroom_capabilities_expiry_idx ON chartroom_capabilities (
  account_id, team_id, repository_id, repo_full_name,
  harbor_id, resource_id, expires_at
);

CREATE TABLE IF NOT EXISTS chartroom_streams (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  authority_epoch  INTEGER NOT NULL CHECK (authority_epoch >= 1),
  plan_version     INTEGER NOT NULL DEFAULT 0 CHECK (plan_version >= 0),
  tip_hash         TEXT    NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
                          CHECK (length(tip_hash) = 64),
  event_count      INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id
  )
);

CREATE TABLE IF NOT EXISTS chartroom_events (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  event_id         TEXT    NOT NULL,
  event_type       TEXT    NOT NULL CHECK (event_type IN (
    'node.upsert', 'node.tombstone',
    'edge.upsert', 'edge.tombstone',
    'artifact.link', 'artifact.unlink',
    'decision.record', 'decision.supersede',
    'status.set', 'owner.assign', 'owner.unassign',
    'dependency.add', 'dependency.remove',
    'source.ingest', 'source.supersede'
  )),
  plan_version     INTEGER NOT NULL CHECK (plan_version >= 1),
  authority_epoch  INTEGER NOT NULL CHECK (authority_epoch >= 1),
  previous_hash    TEXT    NOT NULL CHECK (length(previous_hash) = 64),
  event_hash       TEXT    NOT NULL CHECK (length(event_hash) = 64),
  request_hash     TEXT    NOT NULL CHECK (length(request_hash) = 64),
  capability_token_hash TEXT NOT NULL CHECK (length(capability_token_hash) = 64),
  idempotency_key  TEXT    NOT NULL,
  intent_nonce     TEXT    NOT NULL,
  issued_at        INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  actor_kind       TEXT    NOT NULL CHECK (actor_kind IN ('operator', 'agent', 'automation', 'importer')),
  actor_id         TEXT    NOT NULL,
  session_id       TEXT    NOT NULL,
  agent_node_id    TEXT    NOT NULL,
  issuer_pubkey    TEXT    NOT NULL CHECK (length(issuer_pubkey) = 64),
  issuer_signature TEXT    NOT NULL CHECK (length(issuer_signature) = 128),
  payload_json     TEXT    NOT NULL CHECK (json_valid(payload_json)),
  accepted_at      INTEGER NOT NULL,
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, event_id
  ),
  UNIQUE (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, plan_version
  ),
  UNIQUE (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, idempotency_key
  ),
  UNIQUE (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, intent_nonce
  ),
  FOREIGN KEY (
    account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id
  ) REFERENCES chartroom_streams (
    account_id, team_id, repository_id, repo_full_name, harbor_id, resource_id
  ),
  FOREIGN KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, capability_token_hash
  ) REFERENCES chartroom_capabilities (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, token_hash
  )
);
CREATE INDEX IF NOT EXISTS chartroom_events_export_idx ON chartroom_events (
  account_id, team_id, repository_id, repo_full_name,
  harbor_id, resource_id, plan_version
);

-- SQL is the final compare-and-swap guard. The handler also reports friendly
-- conflict codes, but a concurrent writer cannot bypass these checks between
-- its read and the transactional D1 batch.
CREATE TRIGGER IF NOT EXISTS chartroom_events_chain_guard
BEFORE INSERT ON chartroom_events
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM chartroom_capabilities
    WHERE account_id = NEW.account_id AND team_id = NEW.team_id
      AND repository_id = NEW.repository_id AND repo_full_name = NEW.repo_full_name
      AND harbor_id = NEW.harbor_id AND resource_id = NEW.resource_id
      AND token_hash = NEW.capability_token_hash AND permission = 'write'
      AND revoked_at IS NULL AND expires_at >= NEW.accepted_at
      AND event_count < max_events
  ) THEN RAISE(ABORT, 'CHARTROOM_CAPABILITY_REJECTED') END;
  SELECT CASE WHEN NEW.plan_version != (
    SELECT plan_version + 1 FROM chartroom_streams
    WHERE account_id = NEW.account_id AND team_id = NEW.team_id
      AND repository_id = NEW.repository_id AND repo_full_name = NEW.repo_full_name
      AND harbor_id = NEW.harbor_id AND resource_id = NEW.resource_id
  ) THEN RAISE(ABORT, 'CHARTROOM_STALE_PLAN_VERSION') END;
  SELECT CASE WHEN NEW.previous_hash != (
    SELECT tip_hash FROM chartroom_streams
    WHERE account_id = NEW.account_id AND team_id = NEW.team_id
      AND repository_id = NEW.repository_id AND repo_full_name = NEW.repo_full_name
      AND harbor_id = NEW.harbor_id AND resource_id = NEW.resource_id
  ) THEN RAISE(ABORT, 'CHARTROOM_HASH_CHAIN_BREAK') END;
  SELECT CASE WHEN NEW.authority_epoch < (
    SELECT authority_epoch FROM chartroom_streams
    WHERE account_id = NEW.account_id AND team_id = NEW.team_id
      AND repository_id = NEW.repository_id AND repo_full_name = NEW.repo_full_name
      AND harbor_id = NEW.harbor_id AND resource_id = NEW.resource_id
  ) THEN RAISE(ABORT, 'CHARTROOM_STALE_AUTHORITY_EPOCH') END;
END;

-- Event-specific URI constraints are repeated at the storage boundary. The
-- Worker performs the richer URL parse (credentials included); this trigger
-- prevents direct SQL or a future handler from admitting a local/unknown
-- scheme, query, or fragment into the immutable ledger.
CREATE TRIGGER IF NOT EXISTS chartroom_events_uri_guard
BEFORE INSERT ON chartroom_events
BEGIN
  SELECT CASE WHEN json_type(NEW.payload_json, '$.type') IS NOT 'text'
    OR json_extract(NEW.payload_json, '$.type') != NEW.event_type
  THEN RAISE(ABORT, 'CHARTROOM_URI_REJECTED') END;
  SELECT CASE WHEN NEW.event_type = 'artifact.link' AND (
    json_type(NEW.payload_json, '$.uri') IS NOT 'text'
    OR length(json_extract(NEW.payload_json, '$.uri')) > 4000
    OR NOT COALESCE(
      (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 8) = 'https://'
        AND substr(json_extract(NEW.payload_json, '$.uri'), 9, 1) NOT IN ('', '/', '?', '#')
        AND instr(json_extract(NEW.payload_json, '$.uri'), '@') = 0)
      OR (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 7) = 'github:'
        AND length(json_extract(NEW.payload_json, '$.uri')) > 7)
      OR (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 10) = 'portdaddy:'
        AND length(json_extract(NEW.payload_json, '$.uri')) > 10)
      OR (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 3) = 'r2:'
        AND length(json_extract(NEW.payload_json, '$.uri')) > 3)
      OR (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 5) = 'repo:'
        AND length(json_extract(NEW.payload_json, '$.uri')) > 5),
      0
    )
    OR instr(COALESCE(json_extract(NEW.payload_json, '$.uri'), ''), '?') > 0
    OR instr(COALESCE(json_extract(NEW.payload_json, '$.uri'), ''), '#') > 0
  ) THEN RAISE(ABORT, 'CHARTROOM_URI_REJECTED') END;
  SELECT CASE WHEN NEW.event_type = 'source.ingest' AND (
    json_type(NEW.payload_json, '$.uri') IS NULL
    OR json_type(NEW.payload_json, '$.uri') NOT IN ('null', 'text')
    OR (json_type(NEW.payload_json, '$.uri') = 'text' AND (
      length(json_extract(NEW.payload_json, '$.uri')) > 4000
      OR NOT COALESCE(
        (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 8) = 'https://'
          AND substr(json_extract(NEW.payload_json, '$.uri'), 9, 1) NOT IN ('', '/', '?', '#')
          AND instr(json_extract(NEW.payload_json, '$.uri'), '@') = 0)
        OR (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 7) = 'github:'
          AND length(json_extract(NEW.payload_json, '$.uri')) > 7)
        OR (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 10) = 'portdaddy:'
          AND length(json_extract(NEW.payload_json, '$.uri')) > 10)
        OR (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 3) = 'r2:'
          AND length(json_extract(NEW.payload_json, '$.uri')) > 3)
        OR (substr(lower(json_extract(NEW.payload_json, '$.uri')), 1, 5) = 'repo:'
          AND length(json_extract(NEW.payload_json, '$.uri')) > 5),
        0
      )
      OR instr(COALESCE(json_extract(NEW.payload_json, '$.uri'), ''), '?') > 0
      OR instr(COALESCE(json_extract(NEW.payload_json, '$.uri'), ''), '#') > 0
    ))
  )
  THEN RAISE(ABORT, 'CHARTROOM_URI_REJECTED') END;
END;

-- The event log is evidence, not a mutable application table. These guards
-- protect append-only history even if a later Worker accidentally issues an
-- UPDATE or DELETE outside the typed Chartroom module. Privileged recovery can
-- still prove corruption by exporting evidence from a restored copy; it must
-- never rewrite the production ledger in place.
CREATE TRIGGER IF NOT EXISTS chartroom_events_update_guard
BEFORE UPDATE ON chartroom_events
BEGIN
  SELECT RAISE(ABORT, 'CHARTROOM_EVENTS_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS chartroom_events_delete_guard
BEFORE DELETE ON chartroom_events
BEGIN
  SELECT RAISE(ABORT, 'CHARTROOM_EVENTS_APPEND_ONLY');
END;

-- Acceptance receipts are stored in the same transactional batch as their
-- events. Keeping the original canonical JSON makes ambiguous retries stable
-- across Relay signing-key and harbor authority-epoch rotation.
CREATE TABLE IF NOT EXISTS chartroom_acceptance_receipts (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  event_id         TEXT    NOT NULL,
  request_hash     TEXT    NOT NULL CHECK (length(request_hash) = 64),
  receipt_json     TEXT    NOT NULL CHECK (json_valid(receipt_json)),
  receipt_hash     TEXT    NOT NULL CHECK (length(receipt_hash) = 64),
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, event_id
  ),
  UNIQUE (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, request_hash
  ),
  FOREIGN KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, event_id
  ) REFERENCES chartroom_events (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, event_id
  )
);

CREATE TRIGGER IF NOT EXISTS chartroom_acceptance_receipts_insert_guard
BEFORE INSERT ON chartroom_acceptance_receipts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM chartroom_events
    WHERE account_id = NEW.account_id AND team_id = NEW.team_id
      AND repository_id = NEW.repository_id AND repo_full_name = NEW.repo_full_name
      AND harbor_id = NEW.harbor_id AND resource_id = NEW.resource_id
      AND event_id = NEW.event_id AND request_hash = NEW.request_hash
      AND accepted_at = NEW.created_at
  ) THEN RAISE(ABORT, 'CHARTROOM_RECEIPT_EVENT_MISMATCH') END;
  SELECT CASE WHEN json_extract(NEW.receipt_json, '$.schema') != 'port-daddy.chartroom-acceptance.v1'
    OR json_extract(NEW.receipt_json, '$.scope.accountId') != NEW.account_id
    OR json_extract(NEW.receipt_json, '$.scope.teamId') != NEW.team_id
    OR json_extract(NEW.receipt_json, '$.scope.repositoryId') != NEW.repository_id
    OR json_extract(NEW.receipt_json, '$.scope.repository') != NEW.repo_full_name
    OR json_extract(NEW.receipt_json, '$.scope.harborId') != NEW.harbor_id
    OR json_extract(NEW.receipt_json, '$.scope.resourceId') != NEW.resource_id
    OR json_extract(NEW.receipt_json, '$.eventId') != NEW.event_id
    OR json_extract(NEW.receipt_json, '$.requestHash') != NEW.request_hash
    OR json_extract(NEW.receipt_json, '$.acceptedAt') != NEW.created_at
  THEN RAISE(ABORT, 'CHARTROOM_RECEIPT_EVENT_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS chartroom_acceptance_receipts_update_guard
BEFORE UPDATE ON chartroom_acceptance_receipts
BEGIN
  SELECT RAISE(ABORT, 'CHARTROOM_RECEIPTS_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS chartroom_acceptance_receipts_delete_guard
BEFORE DELETE ON chartroom_acceptance_receipts
BEGIN
  SELECT RAISE(ABORT, 'CHARTROOM_RECEIPTS_APPEND_ONLY');
END;

CREATE TABLE IF NOT EXISTS chartroom_nodes (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  node_id          TEXT    NOT NULL,
  node_kind        TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  summary          TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'proposed',
  owner_actor_id   TEXT,
  supersedes_id    TEXT,
  payload_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  plan_version     INTEGER NOT NULL,
  tombstoned_at    INTEGER,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, node_id
  )
);

CREATE TABLE IF NOT EXISTS chartroom_edges (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  edge_id          TEXT    NOT NULL,
  edge_type        TEXT    NOT NULL,
  source_id        TEXT    NOT NULL,
  target_id        TEXT    NOT NULL,
  payload_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  plan_version     INTEGER NOT NULL,
  tombstoned_at    INTEGER,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, edge_id
  )
);

CREATE TABLE IF NOT EXISTS chartroom_artifact_links (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  link_id          TEXT    NOT NULL,
  node_id          TEXT,
  artifact_kind    TEXT    NOT NULL,
  uri              TEXT    NOT NULL,
  digest           TEXT,
  title            TEXT    NOT NULL DEFAULT '',
  payload_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  plan_version     INTEGER NOT NULL,
  tombstoned_at    INTEGER,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, link_id
  )
);

CREATE TABLE IF NOT EXISTS chartroom_decisions (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  decision_id      TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  rationale        TEXT    NOT NULL,
  status           TEXT    NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
  affected_ids_json TEXT   NOT NULL DEFAULT '[]' CHECK (json_valid(affected_ids_json)),
  supersedes_id    TEXT,
  superseded_by_id TEXT,
  payload_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  plan_version     INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, decision_id
  )
);

CREATE TABLE IF NOT EXISTS chartroom_sources (
  account_id       TEXT    NOT NULL REFERENCES users(id),
  team_id          TEXT    NOT NULL,
  repository_id    TEXT    NOT NULL,
  repo_full_name   TEXT    NOT NULL,
  harbor_id        TEXT    NOT NULL REFERENCES harbors(id),
  resource_id      TEXT    NOT NULL,
  source_id        TEXT    NOT NULL,
  revision_id      TEXT    NOT NULL,
  source_kind      TEXT    NOT NULL,
  uri              TEXT,
  digest           TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  summary          TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL CHECK (status IN ('active', 'superseded', 'tombstoned')),
  supersedes_revision_id TEXT,
  superseded_by_revision_id TEXT,
  payload_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  plan_version     INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (
    account_id, team_id, repository_id, repo_full_name,
    harbor_id, resource_id, source_id, revision_id
  )
);
CREATE INDEX IF NOT EXISTS chartroom_sources_current_idx ON chartroom_sources (
  account_id, team_id, repository_id, repo_full_name,
  harbor_id, resource_id, source_id, status, plan_version
);
