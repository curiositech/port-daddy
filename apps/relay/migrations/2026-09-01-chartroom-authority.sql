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
