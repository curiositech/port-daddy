-- Migration 089 — canonical durable ownership epochs and exact takeover grants.
--
-- AgentNode is the durable owner. Actor souls authenticate a concrete request;
-- sessions and agent_id strings remain runtime bodies/aliases.  The roadmap's
-- assignee_id stays the current-owner projection while these append-only tables
-- preserve every historical ownership epoch and signed disposition receipt.
--
-- The idempotent runtime initializer lives in lib/durable-ownership.ts.  The
-- guarded ALTERs for legacy databases are performed there because SQLite does
-- not support ALTER TABLE ADD COLUMN IF NOT EXISTS.

ALTER TABLE sessions ADD COLUMN agent_node_id TEXT;
ALTER TABLE session_files ADD COLUMN agent_node_id TEXT;
ALTER TABLE claim_forest_claims ADD COLUMN agent_node_id TEXT;
ALTER TABLE claim_forest_claims ADD COLUMN claim_content_hash TEXT;

-- A claim's exact content witness is immutable even when later observations
-- refresh the shared selector node. Backfill historical claims once, then all
-- new claims snapshot this column at creation.
UPDATE claim_forest_claims
SET claim_content_hash = (
  SELECT content_hash FROM claim_forest_nodes WHERE claim_forest_nodes.id = claim_forest_claims.node_id
)
WHERE claim_content_hash IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_agent_node
  ON sessions(agent_node_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_session_files_agent_node
  ON session_files(agent_node_id, released_at);
CREATE INDEX IF NOT EXISTS idx_claim_forest_claims_agent_node
  ON claim_forest_claims(agent_node_id, released_at);
CREATE INDEX IF NOT EXISTS idx_claim_forest_claims_active_session_node
  ON claim_forest_claims(node_id, session_id, released_at);

CREATE TABLE IF NOT EXISTS roadmap_ownership_epochs (
  epoch_id TEXT PRIMARY KEY,
  roadmap_item_id TEXT NOT NULL REFERENCES roadmap_items(id),
  roadmap_slug TEXT NOT NULL,
  harbor TEXT NOT NULL,
  epoch_number INTEGER NOT NULL CHECK(epoch_number >= 1),
  owner_agent_node_id TEXT NOT NULL,
  prior_epoch_id TEXT REFERENCES roadmap_ownership_epochs(epoch_id),
  prior_owner_agent_node_id TEXT,
  cause TEXT NOT NULL CHECK(cause IN ('assignment','voluntary-handoff','operator-takeover')),
  source_session_id TEXT,
  successor_session_id TEXT,
  takeover_grant_id TEXT,
  work_binding_json TEXT NOT NULL,
  claim_bindings_json TEXT NOT NULL,
  claim_set_hash TEXT NOT NULL,
  briefing_hash TEXT,
  reason TEXT NOT NULL,
  authored_by_agent_node_id TEXT NOT NULL,
  authorized_actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  signature_algorithm TEXT NOT NULL,
  signature_key_id TEXT NOT NULL,
  signature_value TEXT NOT NULL,
  UNIQUE(roadmap_item_id, epoch_number)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_ownership_epochs_item
  ON roadmap_ownership_epochs(roadmap_item_id, epoch_number DESC);
CREATE INDEX IF NOT EXISTS idx_roadmap_ownership_epochs_owner
  ON roadmap_ownership_epochs(owner_agent_node_id, created_at DESC);

CREATE TABLE IF NOT EXISTS roadmap_ownership_events (
  event_id TEXT PRIMARY KEY,
  epoch_id TEXT NOT NULL REFERENCES roadmap_ownership_epochs(epoch_id),
  roadmap_item_id TEXT NOT NULL REFERENCES roadmap_items(id),
  kind TEXT NOT NULL CHECK(kind IN (
    'assigned','stale-marked','abandoned','handoff-issued','taken-over',
    'claims-transferred','briefing-attached'
  )),
  state TEXT NOT NULL CHECK(state IN ('current','stale','abandoned','transferred')),
  authored_by_agent_node_id TEXT,
  authorized_actor_id TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  details_json TEXT NOT NULL,
  caused_by_event_id TEXT,
  content_hash TEXT NOT NULL,
  signature_algorithm TEXT NOT NULL,
  signature_key_id TEXT NOT NULL,
  signature_value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roadmap_ownership_events_epoch
  ON roadmap_ownership_events(epoch_id, occurred_at);

CREATE TABLE IF NOT EXISTS durable_takeover_grants (
  grant_id TEXT PRIMARY KEY,
  roadmap_item_id TEXT NOT NULL REFERENCES roadmap_items(id),
  roadmap_slug TEXT NOT NULL,
  harbor TEXT NOT NULL,
  predecessor_epoch_id TEXT NOT NULL REFERENCES roadmap_ownership_epochs(epoch_id),
  predecessor_agent_node_id TEXT NOT NULL,
  successor_agent_node_id TEXT NOT NULL,
  issuer_agent_node_id TEXT,
  authorized_actor_id TEXT NOT NULL,
  successor_actor_id TEXT NOT NULL,
  authority_kind TEXT NOT NULL CHECK(authority_kind IN ('current-owner','operator')),
  operator_presence_receipt_json TEXT,
  reason TEXT NOT NULL,
  source_session_id TEXT NOT NULL,
  successor_session_id TEXT NOT NULL,
  source_witness_canonical INTEGER NOT NULL CHECK(source_witness_canonical IN (0,1)),
  source_witness_json TEXT NOT NULL,
  successor_witness_json TEXT NOT NULL,
  predecessor_evidence_gap_json TEXT,
  work_binding_json TEXT NOT NULL,
  claim_bindings_json TEXT NOT NULL,
  claim_set_hash TEXT NOT NULL,
  briefing_json TEXT NOT NULL,
  briefing_hash TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  signature_algorithm TEXT NOT NULL,
  signature_key_id TEXT NOT NULL,
  signature_value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_durable_takeover_grants_epoch
  ON durable_takeover_grants(predecessor_epoch_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS durable_takeover_receipts (
  receipt_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES durable_takeover_grants(grant_id),
  kind TEXT NOT NULL CHECK(kind IN ('issued','rejected','expired','consumed')),
  at INTEGER NOT NULL,
  details_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  signature_algorithm TEXT NOT NULL,
  signature_key_id TEXT NOT NULL,
  signature_value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_durable_takeover_receipts_grant
  ON durable_takeover_receipts(grant_id, at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_takeover_terminal_receipt
  ON durable_takeover_receipts(grant_id)
  WHERE kind IN ('expired','consumed');

-- Historical facts, grants, and receipts are immutable. Grant lifecycle is a
-- projection over the single signed terminal receipt (expired or consumed).
CREATE TRIGGER IF NOT EXISTS roadmap_ownership_epochs_no_update
BEFORE UPDATE ON roadmap_ownership_epochs BEGIN
  SELECT RAISE(ABORT, 'roadmap ownership epochs are append-only');
END;
CREATE TRIGGER IF NOT EXISTS roadmap_ownership_epochs_no_delete
BEFORE DELETE ON roadmap_ownership_epochs BEGIN
  SELECT RAISE(ABORT, 'roadmap ownership epochs are append-only');
END;
CREATE TRIGGER IF NOT EXISTS roadmap_ownership_events_no_update
BEFORE UPDATE ON roadmap_ownership_events BEGIN
  SELECT RAISE(ABORT, 'roadmap ownership events are append-only');
END;
CREATE TRIGGER IF NOT EXISTS roadmap_ownership_events_no_delete
BEFORE DELETE ON roadmap_ownership_events BEGIN
  SELECT RAISE(ABORT, 'roadmap ownership events are append-only');
END;
CREATE TRIGGER IF NOT EXISTS durable_takeover_receipts_no_update
BEFORE UPDATE ON durable_takeover_receipts BEGIN
  SELECT RAISE(ABORT, 'durable takeover receipts are append-only');
END;
CREATE TRIGGER IF NOT EXISTS durable_takeover_receipts_no_delete
BEFORE DELETE ON durable_takeover_receipts BEGIN
  SELECT RAISE(ABORT, 'durable takeover receipts are append-only');
END;
CREATE TRIGGER IF NOT EXISTS durable_takeover_grants_no_update
BEFORE UPDATE ON durable_takeover_grants BEGIN
  SELECT RAISE(ABORT, 'durable takeover grants are immutable');
END;
CREATE TRIGGER IF NOT EXISTS durable_takeover_grants_no_delete
BEFORE DELETE ON durable_takeover_grants BEGIN
  SELECT RAISE(ABORT, 'durable takeover grants are immutable');
END;
