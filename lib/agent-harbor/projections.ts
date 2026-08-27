/**
 * Agent Harbor Projections (binder ch18 Work Order C1; ADR-0095).
 *
 * Disposable read models materialized from the append-only event ledger
 * (lib/agent-harbor/event-ledger.ts). Six projections: roster, transcript
 * timeline, files touched, costs, compliance, work receipts.
 *
 * Shibboleths enforced here (binder ch18):
 *   - The event log is sacred; projections are disposable. `rebuildProjections`
 *     truncates every projection table and replays the ledger from seq 0.
 *   - A UI pane can be stale, but a tool gate cannot be authorized from stale
 *     data: every read helper returns a `stale` label, and
 *     `assertProjectionFreshForCommand` throws StaleProjectionError so a
 *     command path physically cannot proceed on a stale view.
 *   - Duplicate delivery is idempotent: each (projection, event) application
 *     is deduped through the harbor_proj_applied unique constraint — the DB
 *     unique constraint IS the idempotency primitive (outbox-pattern skill),
 *     so replaying the same event twice cannot double-count a cost or a
 *     file touch.
 *   - Tolerant reader (agent-interchange-formats / ADR-0095 §6): unknown
 *     payload fields are ignored-but-preserved, unknown transcript kinds are
 *     timeline rows like any other, and handlers never crash on extra data.
 *   - Compliance is daemon-witnessed (ADR-0095 §8): the compliance projection
 *     recomputes witnessing through the frozen compliance-invariants.mjs.
 *     A probe that over-claims is stored with witness_valid = 0 and NEVER
 *     advances the roster's compliance level.
 */

import type { DatabaseInstance } from '../sqlite-runtime.js';
import {
  ensureEventLedgerSchema,
  ledgerHeadSeq,
  readEvents,
  type LedgerRow,
} from './event-ledger.js';
import {
  checkNodeWitnessing,
  checkProbeWitnessing,
} from '../../schemas/agent-harbor/v0/compliance-invariants.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Projection registry
// ─────────────────────────────────────────────────────────────────────────────

export const PROJECTIONS = [
  'roster',
  'transcript-timeline',
  'files-touched',
  'costs',
  'compliance',
  'work-receipts',
  'doctrine',
] as const;

export type ProjectionName = (typeof PROJECTIONS)[number];

export class StaleProjectionError extends Error {
  code = 'STALE_PROJECTION' as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema (idempotent + verified)
// ─────────────────────────────────────────────────────────────────────────────

const PROJECTION_SCHEMA_SQL = `
  -- Checkpoints: one row per projection. stale = checkpoint < ledger head.
  CREATE TABLE IF NOT EXISTS harbor_proj_meta (
    projection       TEXT PRIMARY KEY,
    last_ledger_seq  INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT,
    last_rebuild_at  TEXT
  );

  -- Per-(projection, event) dedup. INSERT OR IGNORE; zero changes = skip.
  CREATE TABLE IF NOT EXISTS harbor_proj_applied (
    projection  TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    PRIMARY KEY (projection, event_id)
  );

  CREATE TABLE IF NOT EXISTS harbor_proj_roster (
    agent_node_id       TEXT PRIMARY KEY,
    identity            TEXT,
    display_name        TEXT,
    class               TEXT,
    role                TEXT,
    authority           TEXT,
    compliance_level    TEXT NOT NULL DEFAULT 'C0',
    compliance_probe_id TEXT,
    transcript_fidelity TEXT,
    official_mode       TEXT,
    status              TEXT,
    plan_id             TEXT,
    intent_id           TEXT,
    harbor_id           TEXT,
    current_session_id  TEXT,
    current_body_id     TEXT,
    current_run_id      TEXT,
    workspace_json      TEXT,
    created_at          TEXT,
    last_heartbeat_at   TEXT,
    last_event_at       TEXT,
    event_count         INTEGER NOT NULL DEFAULT 0,
    placeholder         INTEGER NOT NULL DEFAULT 0,
    updated_ledger_seq  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS harbor_proj_timeline (
    session_id        TEXT NOT NULL,
    sequence          REAL NOT NULL,
    event_id          TEXT NOT NULL UNIQUE,
    agent_node_id     TEXT,
    body_id           TEXT,
    turn_id           TEXT,
    kind              TEXT,
    visibility        TEXT,
    occurred_at       TEXT,
    ingested_at       TEXT,
    redaction_state   TEXT,
    blob_count        INTEGER NOT NULL DEFAULT 0,
    content_hash      TEXT,
    prev_hash         TEXT,
    PRIMARY KEY (session_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS harbor_proj_files_touched (
    session_id      TEXT NOT NULL,
    path            TEXT NOT NULL,
    touch_kind      TEXT NOT NULL,
    agent_node_id   TEXT,
    absolute_path   TEXT,
    touch_count     INTEGER NOT NULL DEFAULT 0,
    first_event_id  TEXT,
    last_event_id   TEXT,
    first_at        TEXT,
    last_at         TEXT,
    PRIMARY KEY (session_id, path, touch_kind)
  );

  CREATE TABLE IF NOT EXISTS harbor_proj_costs (
    agent_node_id       TEXT NOT NULL,
    session_key         TEXT NOT NULL DEFAULT '',
    run_key             TEXT NOT NULL DEFAULT '',
    event_count         INTEGER NOT NULL DEFAULT 0,
    total_estimated_usd REAL NOT NULL DEFAULT 0,
    total_actual_usd    REAL NOT NULL DEFAULT 0,
    meters_json         TEXT NOT NULL DEFAULT '{}',
    last_budget_action  TEXT,
    last_occurred_at    TEXT,
    PRIMARY KEY (agent_node_id, session_key, run_key)
  );

  CREATE TABLE IF NOT EXISTS harbor_proj_compliance (
    agent_node_id        TEXT PRIMARY KEY,
    probe_id             TEXT,
    probed_at            TEXT,
    asserted_level       TEXT,
    recomputed_level     TEXT,
    transcript_fidelity  TEXT,
    witness_valid        INTEGER NOT NULL DEFAULT 0,
    violations_json      TEXT NOT NULL DEFAULT '[]',
    failed_checks_json   TEXT NOT NULL DEFAULT '[]',
    updated_ledger_seq   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS harbor_proj_work_receipts (
    receipt_id           TEXT PRIMARY KEY,
    agent_node_id        TEXT,
    session_id           TEXT,
    run_id               TEXT,
    strength             TEXT,
    verification_status  TEXT,
    artifact_backed      INTEGER,
    transcript_head_hash TEXT,
    created_at           TEXT,
    pr_refs_json         TEXT NOT NULL DEFAULT '[]'
  );

  -- Advisory doctrine is a disposable projection over doctrine-evidence
  -- events. The primary evidence chain remains in harbor_events; this table
  -- exists so the harbor-ledger doctrine projection commands can expose
  -- freshness and recover a UI read model without inventing another authority.
  CREATE TABLE IF NOT EXISTS harbor_proj_doctrine (
    doctrine_id          TEXT PRIMARY KEY,
    candidate_id         TEXT,
    episode_id           TEXT,
    experiment_id        TEXT,
    decision_class       TEXT,
    project_dir          TEXT,
    title                TEXT,
    status               TEXT NOT NULL DEFAULT 'candidate',
    contested_reason     TEXT,
    last_event_id        TEXT,
    last_occurred_at     TEXT,
    updated_ledger_seq   INTEGER NOT NULL DEFAULT 0
  );
`;

const PROJECTION_TABLES: Record<ProjectionName, string> = {
  roster: 'harbor_proj_roster',
  'transcript-timeline': 'harbor_proj_timeline',
  'files-touched': 'harbor_proj_files_touched',
  costs: 'harbor_proj_costs',
  compliance: 'harbor_proj_compliance',
  'work-receipts': 'harbor_proj_work_receipts',
  doctrine: 'harbor_proj_doctrine',
};

/** Required columns per projection table — the post-apply probe checks shape, not mere existence. */
const REQUIRED_PROJ_COLUMNS: Record<string, string[]> = {
  harbor_proj_meta: ['projection', 'last_ledger_seq', 'updated_at', 'last_rebuild_at'],
  harbor_proj_applied: ['projection', 'event_id'],
  harbor_proj_roster: [
    'agent_node_id', 'identity', 'display_name', 'class', 'role', 'authority',
    'compliance_level', 'compliance_probe_id', 'transcript_fidelity',
    'official_mode', 'status', 'plan_id', 'intent_id', 'harbor_id',
    'current_session_id', 'current_body_id', 'current_run_id', 'workspace_json',
    'created_at', 'last_heartbeat_at', 'last_event_at', 'event_count',
    'placeholder', 'updated_ledger_seq',
  ],
  harbor_proj_timeline: [
    'session_id', 'sequence', 'event_id', 'agent_node_id', 'body_id', 'turn_id',
    'kind', 'visibility', 'occurred_at', 'ingested_at', 'redaction_state',
    'blob_count', 'content_hash', 'prev_hash',
  ],
  harbor_proj_files_touched: [
    'session_id', 'path', 'touch_kind', 'agent_node_id', 'absolute_path',
    'touch_count', 'first_event_id', 'last_event_id', 'first_at', 'last_at',
  ],
  harbor_proj_costs: [
    'agent_node_id', 'session_key', 'run_key', 'event_count',
    'total_estimated_usd', 'total_actual_usd', 'meters_json',
    'last_budget_action', 'last_occurred_at',
  ],
  harbor_proj_compliance: [
    'agent_node_id', 'probe_id', 'probed_at', 'asserted_level',
    'recomputed_level', 'transcript_fidelity', 'witness_valid',
    'violations_json', 'failed_checks_json', 'updated_ledger_seq',
  ],
  harbor_proj_work_receipts: [
    'receipt_id', 'agent_node_id', 'session_id', 'run_id', 'strength',
    'verification_status', 'artifact_backed', 'transcript_head_hash',
    'created_at', 'pr_refs_json',
  ],
  harbor_proj_doctrine: [
    'doctrine_id', 'candidate_id', 'episode_id', 'experiment_id',
    'decision_class', 'project_dir', 'title', 'status', 'contested_reason',
    'last_event_id', 'last_occurred_at', 'updated_ledger_seq',
  ],
};

/**
 * Idempotent schema apply + post-apply verification probe.
 *
 * Per sqlite-durable-agent-state ("Migration History Is Not Migration"): the
 * probe inspects the real tables AND their required columns — a
 * partially/wrongly-shaped table fails closed instead of passing on mere
 * existence.
 */
export function ensureProjectionSchema(db: DatabaseInstance): void {
  ensureEventLedgerSchema(db);
  db.exec(PROJECTION_SCHEMA_SQL);
  for (const [table, required] of Object.entries(REQUIRED_PROJ_COLUMNS)) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.length === 0) {
      throw new Error(`projection migration verification failed: table ${table} missing`);
    }
    const present = new Set(cols.map((c) => c.name));
    const missing = required.filter((c) => !present.has(c));
    if (missing.length > 0) {
      throw new Error(
        `projection migration verification failed: table ${table} missing column(s) ${missing.join(', ')}. ` +
        'Projections cannot run against a partial schema.',
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler plumbing
// ─────────────────────────────────────────────────────────────────────────────

function parsePayload(row: LedgerRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.payload_json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function s(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Idempotence gate: true when this (projection, event) pair has not been
 * applied yet. The unique constraint makes duplicate application a no-op —
 * replay the same event twice and the second application is skipped.
 */
function firstApplication(db: DatabaseInstance, projection: ProjectionName, eventId: string): boolean {
  const info = db
    .prepare('INSERT OR IGNORE INTO harbor_proj_applied (projection, event_id) VALUES (?, ?)')
    .run(projection, eventId);
  return info.changes > 0;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

// ─────────────────────────────────────────────────────────────────────────────
// Roster projection
// consumes: agent-node, agent-run, transcript-event, compliance-probe-result
// ─────────────────────────────────────────────────────────────────────────────

function ensureRosterRow(db: DatabaseInstance, agentNodeId: string, placeholder: boolean): void {
  // A transcript arriving before any AgentNode fact creates an honest
  // placeholder: C0, observed — a body without a registered node is never
  // presented as official (ADR-0095 fork 4).
  db.prepare(
    `INSERT OR IGNORE INTO harbor_proj_roster
       (agent_node_id, compliance_level, official_mode, status, placeholder)
     VALUES (?, 'C0', 'observed', 'active', ?)`,
  ).run(agentNodeId, placeholder ? 1 : 0);
}

function applyRoster(db: DatabaseInstance, row: LedgerRow, payload: Record<string, unknown>): void {
  const agentNodeId = row.agent_node_id;
  if (!agentNodeId) return;

  if (row.stream_type === 'agent-node') {
    ensureRosterRow(db, agentNodeId, false);

    // Compliance is daemon-witnessed only (ADR-0095 §8): the node fact's
    // complianceLevel is honored only when checkNodeWitnessing validates it
    // against its linked, already-ledgered probe — otherwise the roster keeps
    // its probe-derived level. There is no self-report upgrade path through
    // an agent-node fact (level-advances-on-self-report stop rule).
    const claimedLevel = s(payload.complianceLevel);
    let grantedLevel: string | null = null;
    let grantedProbeId: string | null = null;
    let grantedFidelity: string | null = null;
    if (claimedLevel !== null && claimedLevel !== 'C0') {
      const probeId = s(payload.complianceProbeId);
      const probeRow = probeId
        ? (db
            .prepare(
              "SELECT payload_json FROM harbor_events WHERE stream_type = 'compliance-probe-result' AND event_id = ?",
            )
            .get(probeId) as { payload_json: string } | undefined)
        : undefined;
      let probe: Record<string, unknown> | undefined;
      try {
        probe = probeRow ? (JSON.parse(probeRow.payload_json) as Record<string, unknown>) : undefined;
      } catch {
        probe = undefined;
      }
      const { valid } = checkNodeWitnessing(payload, probe);
      if (valid) {
        grantedLevel = claimedLevel;
        grantedProbeId = probeId;
        grantedFidelity = s(payload.transcriptFidelity);
      }
    }

    db.prepare(
      `UPDATE harbor_proj_roster SET
         identity = ?, display_name = ?, class = ?, role = ?, authority = ?,
         compliance_level = COALESCE(?, compliance_level),
         compliance_probe_id = COALESCE(?, compliance_probe_id),
         transcript_fidelity = COALESCE(?, transcript_fidelity),
         official_mode = COALESCE(?, official_mode),
         status = ?, plan_id = ?, intent_id = ?, harbor_id = ?,
         current_session_id = ?, current_body_id = ?, current_run_id = ?,
         workspace_json = ?, created_at = ?,
         last_heartbeat_at = COALESCE(?, last_heartbeat_at),
         last_event_at = COALESCE(?, last_event_at),
         placeholder = 0, updated_ledger_seq = ?
       WHERE agent_node_id = ?`,
    ).run(
      s(payload.identity),
      s(payload.displayName),
      s(payload.class),
      s(payload.role),
      s(payload.authority),
      grantedLevel,
      grantedProbeId,
      grantedFidelity,
      // officialMode is optional in the frozen schema: COALESCE keeps the
      // previously materialized value (e.g. the honest 'observed' default)
      // instead of erasing it with NULL when the fact omits the field.
      s(payload.officialMode),
      s(payload.status),
      s(payload.planId),
      s(payload.intentId),
      s(payload.harborId),
      s(payload.currentSessionId),
      s(payload.currentBodyId),
      s(payload.currentRunId),
      payload.workspace ? JSON.stringify(payload.workspace) : null,
      s(payload.createdAt),
      s(payload.lastHeartbeatAt),
      s(payload.lastEventAt),
      row.ledger_seq,
      agentNodeId,
    );
    return;
  }

  if (row.stream_type === 'agent-run') {
    ensureRosterRow(db, agentNodeId, true);
    const status = s(payload.status);
    const live = status !== null && ['attaching', 'running', 'paused', 'human-gate', 'blocked'].includes(status);
    db.prepare(
      `UPDATE harbor_proj_roster SET
         current_run_id = ?, current_session_id = ?, current_body_id = ?,
         last_event_at = COALESCE(?, last_event_at), updated_ledger_seq = ?
       WHERE agent_node_id = ?`,
    ).run(
      live ? s(payload.runId) : null,
      live ? s(payload.sessionId) : null,
      live ? s(payload.bodyId) : null,
      s(payload.startedAt),
      row.ledger_seq,
      agentNodeId,
    );
    return;
  }

  if (row.stream_type === 'transcript-event') {
    ensureRosterRow(db, agentNodeId, true);
    const heartbeat = row.kind === 'heartbeat' ? (row.occurred_at ?? row.ingested_at) : null;
    const existing = db
      .prepare('SELECT last_event_at, last_heartbeat_at FROM harbor_proj_roster WHERE agent_node_id = ?')
      .get(agentNodeId) as { last_event_at: string | null; last_heartbeat_at: string | null };
    db.prepare(
      `UPDATE harbor_proj_roster SET
         event_count = event_count + 1,
         last_event_at = ?,
         last_heartbeat_at = ?,
         updated_ledger_seq = ?
       WHERE agent_node_id = ?`,
    ).run(
      maxIso(existing.last_event_at, row.occurred_at ?? row.ingested_at),
      maxIso(existing.last_heartbeat_at, heartbeat),
      row.ledger_seq,
      agentNodeId,
    );
    return;
  }

  if (row.stream_type === 'compliance-probe-result') {
    ensureRosterRow(db, agentNodeId, true);
    const { valid, witnessedLevel } = checkProbeWitnessing(payload);
    if (valid) {
      // Witness-valid probes advance (or downgrade) the roster level to the
      // granted level — which the invariant guarantees is <= witnessedLevel.
      db.prepare(
        `UPDATE harbor_proj_roster SET
           compliance_level = ?, compliance_probe_id = ?, transcript_fidelity = ?,
           updated_ledger_seq = ?
         WHERE agent_node_id = ?`,
      ).run(
        s(payload.complianceLevel) ?? witnessedLevel,
        s(payload.probeId),
        s(payload.transcriptFidelity),
        row.ledger_seq,
        agentNodeId,
      );
    }
    // An invalid (self-attested / over-claiming) probe NEVER advances the
    // roster: level-advances-on-self-report is the executable stop rule
    // (ADR-0095 §8). The compliance projection records the violation.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transcript timeline projection — consumes: transcript-event
// ─────────────────────────────────────────────────────────────────────────────

function applyTimeline(db: DatabaseInstance, row: LedgerRow, payload: Record<string, unknown>): void {
  if (row.stream_type !== 'transcript-event') return;
  const blobs = Array.isArray(payload.payloadBlobRefs) ? payload.payloadBlobRefs.length : 0;
  db.prepare(
    `INSERT OR REPLACE INTO harbor_proj_timeline
       (session_id, sequence, event_id, agent_node_id, body_id, turn_id, kind,
        visibility, occurred_at, ingested_at, redaction_state, blob_count,
        content_hash, prev_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.session_id,
    row.sequence,
    row.event_id,
    row.agent_node_id,
    s(payload.bodyId),
    s(payload.turnId),
    row.kind,
    s(payload.visibility),
    row.occurred_at,
    row.ingested_at,
    s(payload.redactionState),
    blobs,
    row.content_hash,
    row.prev_hash,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Files-touched projection — consumes: transcript-event (file family kinds)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The file event family is the STRUCTURED kind enum from the frozen
 * transcript-event schema description (files/git family) — exact match on a
 * contract-controlled field, not keyword NLP over free text.
 */
const FILE_KIND_MAP: Record<string, string> = {
  file_read: 'read',
  file_write: 'write',
  file_diff: 'diff',
  file_touch: 'touch',
};

function applyFilesTouched(db: DatabaseInstance, row: LedgerRow, payload: Record<string, unknown>): void {
  if (row.stream_type !== 'transcript-event' || !row.kind) return;
  const touchKind = FILE_KIND_MAP[row.kind];
  if (!touchKind || !row.session_id) return;
  const pj = (payload.payloadJson ?? {}) as Record<string, unknown>;
  const path = s(pj.path) ?? s(pj.absolutePath);
  if (!path) return;
  const at = row.occurred_at ?? row.ingested_at;
  db.prepare(
    `INSERT INTO harbor_proj_files_touched
       (session_id, path, touch_kind, agent_node_id, absolute_path, touch_count,
        first_event_id, last_event_id, first_at, last_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT (session_id, path, touch_kind) DO UPDATE SET
       touch_count = touch_count + 1,
       absolute_path = COALESCE(excluded.absolute_path, absolute_path),
       last_event_id = excluded.last_event_id,
       last_at = excluded.last_at`,
  ).run(
    row.session_id,
    path,
    touchKind,
    row.agent_node_id,
    s(pj.absolutePath),
    row.event_id,
    row.event_id,
    at,
    at,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Costs projection — consumes: cost-accrual-event
// ─────────────────────────────────────────────────────────────────────────────

function applyCosts(db: DatabaseInstance, row: LedgerRow, payload: Record<string, unknown>): void {
  if (row.stream_type !== 'cost-accrual-event' || !row.agent_node_id) return;
  const sessionKey = row.session_id ?? '';
  const runKey = row.run_id ?? '';
  const estimated = n(payload.estimatedCostUsd) ?? 0;
  const actual = n(payload.actualCostUsd) ?? 0;
  const meter = s(payload.meter) ?? 'custom';
  const unit = s(payload.unit) ?? 'unknown';
  const quantity = n(payload.quantity) ?? 0;
  const budgetAction = s(payload.budgetAction);

  const existing = db
    .prepare(
      'SELECT meters_json, last_occurred_at FROM harbor_proj_costs WHERE agent_node_id = ? AND session_key = ? AND run_key = ?',
    )
    .get(row.agent_node_id, sessionKey, runKey) as
    | { meters_json: string; last_occurred_at: string | null }
    | undefined;

  let meters: Record<string, number> = {};
  if (existing) {
    try {
      meters = JSON.parse(existing.meters_json) as Record<string, number>;
    } catch {
      meters = {};
    }
  }
  const meterKey = `${meter}:${unit}`;
  meters[meterKey] = (meters[meterKey] ?? 0) + quantity;

  db.prepare(
    `INSERT INTO harbor_proj_costs
       (agent_node_id, session_key, run_key, event_count, total_estimated_usd,
        total_actual_usd, meters_json, last_budget_action, last_occurred_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT (agent_node_id, session_key, run_key) DO UPDATE SET
       event_count = event_count + 1,
       total_estimated_usd = total_estimated_usd + excluded.total_estimated_usd,
       total_actual_usd = total_actual_usd + excluded.total_actual_usd,
       meters_json = ?,
       last_budget_action = COALESCE(excluded.last_budget_action, last_budget_action),
       last_occurred_at = MAX(COALESCE(last_occurred_at, ''), COALESCE(excluded.last_occurred_at, ''))`,
  ).run(
    row.agent_node_id,
    sessionKey,
    runKey,
    estimated,
    actual,
    JSON.stringify(meters),
    budgetAction && budgetAction !== 'none' ? budgetAction : null,
    row.occurred_at,
    JSON.stringify(meters),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance projection — consumes: compliance-probe-result
// ─────────────────────────────────────────────────────────────────────────────

function applyCompliance(db: DatabaseInstance, row: LedgerRow, payload: Record<string, unknown>): void {
  if (row.stream_type !== 'compliance-probe-result' || !row.agent_node_id) return;
  const { valid, witnessedLevel, violations } = checkProbeWitnessing(payload);
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];

  // Latest probe wins per node (ledger order = daemon receive order).
  db.prepare(
    `INSERT INTO harbor_proj_compliance
       (agent_node_id, probe_id, probed_at, asserted_level, recomputed_level,
        transcript_fidelity, witness_valid, violations_json, failed_checks_json,
        updated_ledger_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (agent_node_id) DO UPDATE SET
       probe_id = excluded.probe_id,
       probed_at = excluded.probed_at,
       asserted_level = excluded.asserted_level,
       recomputed_level = excluded.recomputed_level,
       transcript_fidelity = excluded.transcript_fidelity,
       witness_valid = excluded.witness_valid,
       violations_json = excluded.violations_json,
       failed_checks_json = excluded.failed_checks_json,
       updated_ledger_seq = excluded.updated_ledger_seq
     WHERE excluded.updated_ledger_seq >= updated_ledger_seq`,
  ).run(
    row.agent_node_id,
    row.event_id,
    row.occurred_at,
    s(payload.complianceLevel),
    witnessedLevel,
    s(payload.transcriptFidelity),
    valid ? 1 : 0,
    JSON.stringify(violations),
    JSON.stringify(failedChecks),
    row.ledger_seq,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Work-receipts projection — consumes: work-receipt
// ─────────────────────────────────────────────────────────────────────────────

function applyWorkReceipts(db: DatabaseInstance, row: LedgerRow, payload: Record<string, unknown>): void {
  if (row.stream_type !== 'work-receipt') return;
  const validation = (payload.validation ?? {}) as Record<string, unknown>;
  const provenance = (payload.provenance ?? {}) as Record<string, unknown>;
  db.prepare(
    `INSERT OR REPLACE INTO harbor_proj_work_receipts
       (receipt_id, agent_node_id, session_id, run_id, strength,
        verification_status, artifact_backed, transcript_head_hash, created_at,
        pr_refs_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.event_id,
    row.agent_node_id,
    row.session_id,
    row.run_id,
    s(payload.strength),
    s(payload.verificationStatus) ?? 'unverified',
    validation.artifactBacked === true ? 1 : validation.artifactBacked === false ? 0 : null,
    s(provenance.transcriptHeadHash),
    s(payload.createdAt),
    JSON.stringify(Array.isArray(payload.prRefs) ? payload.prRefs : []),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrine projection — consumes: doctrine-evidence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal read model for repair/status tooling. Detailed episodes, treatments,
 * receipts, applications, and outcomes are replayed by lib/doctrine.ts; this
 * table intentionally stores only the current revision card, so it can never
 * become a rival source of truth.
 */
function applyDoctrine(db: DatabaseInstance, row: LedgerRow, payload: Record<string, unknown>): void {
  if (row.stream_type !== 'doctrine-evidence') return;
  const body = (payload.payload ?? {}) as Record<string, unknown>;
  const kind = s(payload.kind);
  const entityId = s(payload.entityId);
  if (!kind || !entityId) return;

  if (kind === 'doctrine_candidate_induced') {
    const doctrineId = s(body.doctrineId);
    if (!doctrineId) return;
    db.prepare(
      `INSERT INTO harbor_proj_doctrine
         (doctrine_id, candidate_id, episode_id, decision_class, project_dir,
          title, status, last_event_id, last_occurred_at, updated_ledger_seq)
       VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?)
       ON CONFLICT (doctrine_id) DO NOTHING`,
    ).run(
      doctrineId,
      entityId,
      s(body.episodeId),
      s(body.decisionClass),
      s(payload.projectDir),
      s(body.title),
      row.event_id,
      row.occurred_at,
      row.ledger_seq,
    );
    return;
  }

  if (kind === 'doctrine_revision_admitted') {
    db.prepare(
      `UPDATE harbor_proj_doctrine SET
         candidate_id = COALESCE(?, candidate_id),
         experiment_id = ?,
         status = ?,
         contested_reason = NULL,
         last_event_id = ?,
         last_occurred_at = ?,
         updated_ledger_seq = ?
       WHERE doctrine_id = ?`,
    ).run(
      s(body.candidateId),
      s(body.experimentId),
      s(body.status) ?? 'provisional',
      row.event_id,
      row.occurred_at,
      row.ledger_seq,
      entityId,
    );
    return;
  }

  if (kind === 'doctrine_contested' || kind === 'doctrine_deprecated') {
    db.prepare(
      `UPDATE harbor_proj_doctrine SET
         status = ?,
         contested_reason = ?,
         last_event_id = ?,
         last_occurred_at = ?,
         updated_ledger_seq = ?
       WHERE doctrine_id = ?`,
    ).run(
      kind === 'doctrine_deprecated' ? 'deprecated' : 'contested',
      s(body.reason),
      row.event_id,
      row.occurred_at,
      row.ledger_seq,
      entityId,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Projection engine: catch-up, staleness, rebuild
// ─────────────────────────────────────────────────────────────────────────────

type Handler = (db: DatabaseInstance, row: LedgerRow, payload: Record<string, unknown>) => void;

const HANDLERS: Record<ProjectionName, Handler> = {
  roster: applyRoster,
  'transcript-timeline': applyTimeline,
  'files-touched': applyFilesTouched,
  costs: applyCosts,
  compliance: applyCompliance,
  'work-receipts': applyWorkReceipts,
  doctrine: applyDoctrine,
};

function getCheckpoint(db: DatabaseInstance, projection: ProjectionName): number {
  const row = db
    .prepare('SELECT last_ledger_seq FROM harbor_proj_meta WHERE projection = ?')
    .get(projection) as { last_ledger_seq: number } | undefined;
  return row ? row.last_ledger_seq : 0;
}

function setCheckpoint(db: DatabaseInstance, projection: ProjectionName, seq: number, rebuild = false): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO harbor_proj_meta (projection, last_ledger_seq, updated_at, last_rebuild_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (projection) DO UPDATE SET
       last_ledger_seq = excluded.last_ledger_seq,
       updated_at = excluded.updated_at,
       last_rebuild_at = COALESCE(excluded.last_rebuild_at, last_rebuild_at)`,
  ).run(projection, seq, now, rebuild ? now : null);
}

export interface ProjectResult {
  projection: ProjectionName;
  applied: number;
  skippedDuplicates: number;
  fromSeq: number;
  toSeq: number;
}

/**
 * Catch every projection (or one named projection) up to the ledger head.
 * Safe to call repeatedly and concurrently-with-appends: each event is applied
 * at most once per projection (harbor_proj_applied dedup), and the checkpoint
 * only advances over events actually read.
 */
export function projectPending(
  db: DatabaseInstance,
  opts: { projection?: ProjectionName; batchSize?: number } = {},
): ProjectResult[] {
  ensureProjectionSchema(db);
  const targets = opts.projection ? [opts.projection] : [...PROJECTIONS];
  const results: ProjectResult[] = [];

  for (const projection of targets) {
    const handler = HANDLERS[projection];
    const fromSeq = getCheckpoint(db, projection);
    let cursor = fromSeq;
    let applied = 0;
    let skipped = 0;

    const txn = db.transaction(() => {
      for (;;) {
        const rows = readEvents(db, { afterSeq: cursor, limit: opts.batchSize ?? 1000 });
        if (rows.length === 0) break;
        for (const row of rows) {
          if (firstApplication(db, projection, row.event_id)) {
            handler(db, row, parsePayload(row));
            applied += 1;
          } else {
            skipped += 1;
          }
          cursor = row.ledger_seq;
        }
      }
      setCheckpoint(db, projection, cursor);
    });
    txn();

    results.push({ projection, applied, skippedDuplicates: skipped, fromSeq, toSeq: cursor });
  }
  return results;
}

/**
 * The rebuild command: projections are disposable — truncate the read model,
 * reset the checkpoint and dedup rows, and replay the ledger from seq 0.
 */
export function rebuildProjections(
  db: DatabaseInstance,
  opts: { projection?: ProjectionName } = {},
): ProjectResult[] {
  ensureProjectionSchema(db);
  const targets = opts.projection ? [opts.projection] : [...PROJECTIONS];
  const txn = db.transaction(() => {
    for (const projection of targets) {
      db.prepare(`DELETE FROM ${PROJECTION_TABLES[projection]}`).run();
      db.prepare('DELETE FROM harbor_proj_applied WHERE projection = ?').run(projection);
      setCheckpoint(db, projection, 0, true);
    }
  });
  txn();
  return projectPending(db, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Staleness: label always, authorize never
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectionStatus {
  projection: ProjectionName;
  lastLedgerSeq: number;
  headSeq: number;
  stale: boolean;
  lagEvents: number;
  updatedAt: string | null;
  lastRebuildAt: string | null;
}

export function getProjectionStatus(db: DatabaseInstance): ProjectionStatus[] {
  ensureProjectionSchema(db);
  const head = ledgerHeadSeq(db);
  return PROJECTIONS.map((projection) => {
    const meta = db
      .prepare('SELECT last_ledger_seq, updated_at, last_rebuild_at FROM harbor_proj_meta WHERE projection = ?')
      .get(projection) as
      | { last_ledger_seq: number; updated_at: string | null; last_rebuild_at: string | null }
      | undefined;
    const lastSeq = meta ? meta.last_ledger_seq : 0;
    return {
      projection,
      lastLedgerSeq: lastSeq,
      headSeq: head,
      stale: lastSeq < head,
      lagEvents: Math.max(0, head - lastSeq),
      updatedAt: meta?.updated_at ?? null,
      lastRebuildAt: meta?.last_rebuild_at ?? null,
    };
  });
}

export function isProjectionFresh(db: DatabaseInstance, projection: ProjectionName): boolean {
  ensureProjectionSchema(db);
  return getCheckpoint(db, projection) >= ledgerHeadSeq(db);
}

/**
 * The command-authorization gate (binder ch18 acceptance gate: "stale views
 * are labeled and never used for command authorization"). Any command path
 * that reads a projection MUST call this first; a stale projection throws —
 * fail closed — with the remediation path in the message.
 */
export function assertProjectionFreshForCommand(db: DatabaseInstance, projection: ProjectionName): void {
  ensureProjectionSchema(db);
  const lastSeq = getCheckpoint(db, projection);
  const head = ledgerHeadSeq(db);
  if (lastSeq < head) {
    throw new StaleProjectionError(
      `projection "${projection}" is STALE (checkpoint ${lastSeq} < ledger head ${head}); ` +
      'stale views may display but never authorize commands. ' +
      'Remediate: projectPending(db) or `pd harbor-ledger project` / `pd harbor-ledger rebuild`.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read helpers — every read is stale-labeled
// ─────────────────────────────────────────────────────────────────────────────

interface LabeledResult<T> {
  stale: boolean;
  lastLedgerSeq: number;
  headSeq: number;
  rows: T[];
}

function labeled<T>(db: DatabaseInstance, projection: ProjectionName, rows: T[]): LabeledResult<T> {
  const lastSeq = getCheckpoint(db, projection);
  const head = ledgerHeadSeq(db);
  return { stale: lastSeq < head, lastLedgerSeq: lastSeq, headSeq: head, rows };
}

export function getRoster(db: DatabaseInstance): LabeledResult<Record<string, unknown>> {
  ensureProjectionSchema(db);
  const rows = db
    .prepare('SELECT * FROM harbor_proj_roster ORDER BY agent_node_id')
    .all() as Record<string, unknown>[];
  return labeled(db, 'roster', rows);
}

export function getTranscriptTimeline(
  db: DatabaseInstance,
  sessionId: string,
): LabeledResult<Record<string, unknown>> {
  ensureProjectionSchema(db);
  const rows = db
    .prepare('SELECT * FROM harbor_proj_timeline WHERE session_id = ? ORDER BY sequence ASC')
    .all(sessionId) as Record<string, unknown>[];
  return labeled(db, 'transcript-timeline', rows);
}

export function getFilesTouched(
  db: DatabaseInstance,
  filter: { sessionId?: string; agentNodeId?: string } = {},
): LabeledResult<Record<string, unknown>> {
  ensureProjectionSchema(db);
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (filter.sessionId) {
    where.push('session_id = ?');
    params.push(filter.sessionId);
  }
  if (filter.agentNodeId) {
    where.push('agent_node_id = ?');
    params.push(filter.agentNodeId);
  }
  const rows = db
    .prepare(`SELECT * FROM harbor_proj_files_touched WHERE ${where.join(' AND ')} ORDER BY last_at DESC`)
    .all(...params) as Record<string, unknown>[];
  return labeled(db, 'files-touched', rows);
}

export function getCostSummary(
  db: DatabaseInstance,
  filter: { agentNodeId?: string } = {},
): LabeledResult<Record<string, unknown>> {
  ensureProjectionSchema(db);
  const rows = (
    filter.agentNodeId
      ? db.prepare('SELECT * FROM harbor_proj_costs WHERE agent_node_id = ?').all(filter.agentNodeId)
      : db.prepare('SELECT * FROM harbor_proj_costs').all()
  ) as Record<string, unknown>[];
  return labeled(db, 'costs', rows);
}

export function getCompliance(
  db: DatabaseInstance,
  agentNodeId?: string,
): LabeledResult<Record<string, unknown>> {
  ensureProjectionSchema(db);
  const rows = (
    agentNodeId
      ? db.prepare('SELECT * FROM harbor_proj_compliance WHERE agent_node_id = ?').all(agentNodeId)
      : db.prepare('SELECT * FROM harbor_proj_compliance').all()
  ) as Record<string, unknown>[];
  return labeled(db, 'compliance', rows);
}

export function getWorkReceipts(
  db: DatabaseInstance,
  filter: { agentNodeId?: string } = {},
): LabeledResult<Record<string, unknown>> {
  ensureProjectionSchema(db);
  const rows = (
    filter.agentNodeId
      ? db
          .prepare('SELECT * FROM harbor_proj_work_receipts WHERE agent_node_id = ? ORDER BY created_at DESC')
          .all(filter.agentNodeId)
      : db.prepare('SELECT * FROM harbor_proj_work_receipts ORDER BY created_at DESC').all()
  ) as Record<string, unknown>[];
  return labeled(db, 'work-receipts', rows);
}

/** Current doctrine-revision cards, explicitly stale-labeled like every Harbor projection. */
export function getDoctrineProjection(
  db: DatabaseInstance,
  filter: { projectDir?: string; decisionClass?: string; status?: string } = {},
): LabeledResult<Record<string, unknown>> {
  ensureProjectionSchema(db);
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (filter.projectDir) {
    where.push('project_dir = ?');
    params.push(filter.projectDir);
  }
  if (filter.decisionClass) {
    where.push('decision_class = ?');
    params.push(filter.decisionClass);
  }
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status);
  }
  const rows = db
    .prepare(`SELECT * FROM harbor_proj_doctrine WHERE ${where.join(' AND ')} ORDER BY last_occurred_at DESC`)
    .all(...params) as Record<string, unknown>[];
  return labeled(db, 'doctrine', rows);
}
