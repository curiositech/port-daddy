/**
 * Constitutional AgentRun admission for durable roster identities.
 *
 * An AgentNode is the durable principal; a sessions.agent_id is only the
 * replaceable body currently doing work.  This module is the one production
 * bridge between those stores.  It accepts no caller-selected identity facts:
 * the node must have been minted by the verified session-promotion path, the
 * source session must already carry a daemon-verified actor stamp, and the
 * live worktree must still match the session witness byte-for-byte.
 *
 * Grand Harbor/Porthole may project or cite the resulting AgentRun.  Presence,
 * recordings, handoff prose, and UI state are never admission authority.
 */

import { createHash } from 'node:crypto';
import type { DatabaseInstance } from './sqlite-runtime.js';
import {
  appendEvent,
  canonicalJson,
  ensureEventLedgerSchema,
  type AppendResult,
} from './agent-harbor/event-ledger.js';
import {
  captureCanonicalGitWorkspace,
  ensureDurableOwnershipSchema,
  type CanonicalGitWorkspaceIdentity,
} from './durable-ownership.js';
import type { DurableAgentRecord } from './durable-agent-roster.js';
import { getWorktreeInfo, type WorktreeInfo } from './worktree.js';

export const AGENT_RUN_SCHEMA = 'pd.agent-harbor.agent-run.v0' as const;

type AgentRunBodyKind =
  | 'claude-code'
  | 'codex-cli'
  | 'cloudflare'
  | 'ollama'
  | 'lmstudio'
  | 'custom-stdio'
  | 'custom-http'
  | 'spawner-child'
  | 'human';

interface SessionRow {
  id: string;
  purpose: string;
  status: string;
  agent_id: string | null;
  agent_node_id: string | null;
  worktree_id: string | null;
  created_at: number;
  metadata: string | null;
  is_durable: number | null;
}

interface SessionWorktreeWitness {
  id: string;
  root: string;
  branch: string;
}

export interface PromotedSessionPreflightInput {
  sourceSessionId: string;
  authorizedActorId: string;
  authorizedHarbor: string;
  expectedSourceAgentId: string;
  expectedSourceAdapter: string;
}

export interface AdmitPromotedSessionInput extends PromotedSessionPreflightInput {
  agentNodeId: string;
}

export interface PromotedSessionAdmissionWitness {
  sourceSessionId: string;
  sourceAgentId: string;
  authorizedActorId: string;
  authorizedHarbor: string;
  sourceAdapter: string;
  worktreeId: string;
  worktreeRoot: string;
  branch: string;
  workspace: CanonicalGitWorkspaceIdentity;
}

export interface AgentRunAdmissionResult extends PromotedSessionAdmissionWitness {
  agentNodeId: string;
  runId: string;
  eventId: string;
  ledgerSeq: number;
  replayed: boolean;
}

export class AgentRunAdmissionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'ADMISSION_VALIDATION_ERROR'
      | 'ADMISSION_SESSION_NOT_FOUND'
      | 'ADMISSION_SESSION_INACTIVE'
      | 'ADMISSION_IDENTITY_MISMATCH'
      | 'ADMISSION_LINEAGE_MISMATCH'
      | 'ADMISSION_WORKTREE_MISMATCH'
      | 'ADMISSION_AGENT_NODE_MISMATCH'
      | 'ADMISSION_AGENT_NODE_RETIRED'
      | 'ADMISSION_EVENT_CONFLICT',
    readonly statusCode: 400 | 403 | 404 | 409 | 503,
  ) {
    super(message);
    this.name = 'AgentRunAdmissionError';
  }
}

export interface AgentRunAdmissionDeps {
  getAgentNode(agentNodeId: string): DurableAgentRecord;
  probeWorktree?: (root: string) => WorktreeInfo | null;
  /** Hermetic-test seam; production uses the shared canonical Git capture. */
  captureWorkspace?: (root: string) => CanonicalGitWorkspaceIdentity;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identifier(value: unknown, field: string, maxBytes = 4_096): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentRunAdmissionError(`${field} is required`, 'ADMISSION_VALIDATION_ERROR', 400);
  }
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes || /[\0\r\n]/.test(normalized)) {
    throw new AgentRunAdmissionError(`${field} is outside its safe identifier boundary`, 'ADMISSION_VALIDATION_ERROR', 400);
  }
  return normalized;
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  try {
    return object(raw ? JSON.parse(raw) : null) ?? {};
  } catch {
    throw new AgentRunAdmissionError(
      'source session metadata is malformed',
      'ADMISSION_LINEAGE_MISMATCH',
      409,
    );
  }
}

function verifiedActorId(metadata: Record<string, unknown>): string | null {
  const identity = object(metadata.identity);
  return identity?.verified === true && typeof identity.actorId === 'string' && identity.actorId.trim()
    ? identity.actorId.trim()
    : null;
}

function sessionWorktree(metadata: Record<string, unknown>): SessionWorktreeWitness | null {
  const worktree = object(metadata.worktree);
  if (
    typeof worktree?.id !== 'string'
    || !worktree.id.trim()
    || typeof worktree.root !== 'string'
    || !worktree.root.trim()
    || typeof worktree.branch !== 'string'
    || !worktree.branch.trim()
  ) return null;
  return {
    id: worktree.id.trim(),
    root: worktree.root.trim(),
    branch: worktree.branch.trim(),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function adapterBody(adapter: string): { kind: AgentRunBodyKind; provider: string; launchMode: 'native' | 'hooked' } {
  const normalized = adapter.toLowerCase();
  if (normalized.includes('claude')) return { kind: 'claude-code', provider: 'anthropic', launchMode: 'native' };
  if (normalized.includes('codex')) return { kind: 'codex-cli', provider: 'openai', launchMode: 'native' };
  if (normalized.includes('cloudflare')) return { kind: 'cloudflare', provider: 'cloudflare', launchMode: 'hooked' };
  if (normalized.includes('ollama')) return { kind: 'ollama', provider: 'ollama', launchMode: 'native' };
  if (normalized.includes('lmstudio')) return { kind: 'lmstudio', provider: 'lmstudio', launchMode: 'native' };
  return { kind: 'custom-stdio', provider: adapter, launchMode: 'hooked' };
}

function sameRunBinding(
  payload: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  const workspace = object(payload.workspace);
  const expectedWorkspace = object(expected.workspace);
  const admission = object(payload.admission);
  const expectedAdmission = object(expected.admission);
  return payload.schema === expected.schema
    && payload.runId === expected.runId
    && payload.agentNodeId === expected.agentNodeId
    && payload.sessionId === expected.sessionId
    && payload.bodyId === expected.bodyId
    && workspace !== null
    && expectedWorkspace !== null
    && canonicalJson(workspace) === canonicalJson(expectedWorkspace)
    && admission !== null
    && expectedAdmission !== null
    && canonicalJson(admission) === canonicalJson(expectedAdmission);
}

/**
 * Construct the single daemon-owned admission service.  The service may run
 * standalone or inside the durable-roster creation transaction; in the latter
 * case every node/run/session/claim mutation commits or rolls back together.
 */
export function createAgentRunAdmissionService(db: DatabaseInstance, deps: AgentRunAdmissionDeps) {
  ensureEventLedgerSchema(db);
  ensureDurableOwnershipSchema(db);
  const probeWorktree = deps.probeWorktree ?? getWorktreeInfo;
  const captureWorkspace = deps.captureWorkspace ?? captureCanonicalGitWorkspace;
  const selectSession = db.prepare(`
    SELECT id, purpose, status, agent_id, agent_node_id, worktree_id,
           created_at, metadata, is_durable
    FROM sessions WHERE id = ?
  `);

  function preflightPromotedSession(input: PromotedSessionPreflightInput): PromotedSessionAdmissionWitness {
    const sourceSessionId = identifier(input.sourceSessionId, 'sourceSessionId');
    const authorizedActorId = identifier(input.authorizedActorId, 'authorizedActorId');
    const authorizedHarbor = identifier(input.authorizedHarbor, 'authorizedHarbor', 512);
    const expectedSourceAgentId = identifier(input.expectedSourceAgentId, 'expectedSourceAgentId');
    const expectedSourceAdapter = identifier(input.expectedSourceAdapter, 'expectedSourceAdapter', 512);
    const row = selectSession.get(sourceSessionId) as SessionRow | undefined;
    if (!row) {
      throw new AgentRunAdmissionError('source session not found', 'ADMISSION_SESSION_NOT_FOUND', 404);
    }
    if (row.status !== 'active' || row.is_durable !== 1) {
      throw new AgentRunAdmissionError(
        'only an active durable session can be admitted to an AgentNode',
        'ADMISSION_SESSION_INACTIVE',
        409,
      );
    }
    if (!row.agent_id || row.agent_id !== expectedSourceAgentId) {
      throw new AgentRunAdmissionError(
        'handoff source agent does not match the daemon session body',
        'ADMISSION_LINEAGE_MISMATCH',
        409,
      );
    }
    const metadata = parseMetadata(row.metadata);
    if (verifiedActorId(metadata) !== authorizedActorId) {
      throw new AgentRunAdmissionError(
        'the verified caller does not own the source session',
        'ADMISSION_IDENTITY_MISMATCH',
        403,
      );
    }
    const witnessed = sessionWorktree(metadata);
    if (!witnessed || row.worktree_id !== witnessed.id) {
      throw new AgentRunAdmissionError(
        'source session lacks one exact worktree id/root/branch witness',
        'ADMISSION_WORKTREE_MISMATCH',
        409,
      );
    }
    const live = probeWorktree(witnessed.root);
    if (
      !live
      || live.id !== witnessed.id
      || live.root !== witnessed.root
      || live.branch !== witnessed.branch
    ) {
      throw new AgentRunAdmissionError(
        'live worktree no longer matches the source session witness',
        'ADMISSION_WORKTREE_MISMATCH',
        409,
      );
    }
    let workspace: CanonicalGitWorkspaceIdentity;
    try {
      workspace = captureWorkspace(witnessed.root);
    } catch {
      throw new AgentRunAdmissionError(
        'cannot capture the source session physical Git identity',
        'ADMISSION_WORKTREE_MISMATCH',
        409,
      );
    }
    if (
      workspace.worktreeId !== witnessed.id
      || workspace.worktreeRoot !== witnessed.root
      || workspace.branch !== witnessed.branch
    ) {
      throw new AgentRunAdmissionError(
        'canonical Git identity disagrees with the source session witness',
        'ADMISSION_WORKTREE_MISMATCH',
        409,
      );
    }
    return {
      sourceSessionId,
      sourceAgentId: expectedSourceAgentId,
      authorizedActorId,
      authorizedHarbor,
      sourceAdapter: expectedSourceAdapter,
      worktreeId: witnessed.id,
      worktreeRoot: witnessed.root,
      branch: witnessed.branch,
      workspace,
    };
  }

  function admitInTransaction(input: AdmitPromotedSessionInput): AgentRunAdmissionResult {
    const agentNodeId = identifier(input.agentNodeId, 'agentNodeId');
    const witness = preflightPromotedSession(input);
    let agent: DurableAgentRecord;
    try {
      agent = deps.getAgentNode(agentNodeId);
    } catch {
      throw new AgentRunAdmissionError('promoted AgentNode not found', 'ADMISSION_AGENT_NODE_MISMATCH', 404);
    }
    if (agent.profile.lifecycle === 'retired') {
      throw new AgentRunAdmissionError('retired AgentNode cannot admit a run', 'ADMISSION_AGENT_NODE_RETIRED', 409);
    }
    const origin = agent.profile.origin;
    if (
      origin.kind !== 'session-promotion'
      || origin.sourceSessionId !== witness.sourceSessionId
      || origin.sourceAgentId !== witness.sourceAgentId
      || origin.sourceAdapter !== witness.sourceAdapter
      || origin.handoffEpisodeId === null
    ) {
      throw new AgentRunAdmissionError(
        'AgentNode promotion lineage does not match the verified session',
        'ADMISSION_LINEAGE_MISMATCH',
        409,
      );
    }

    const row = selectSession.get(witness.sourceSessionId) as SessionRow | undefined;
    if (!row) throw new AgentRunAdmissionError('source session disappeared', 'ADMISSION_SESSION_NOT_FOUND', 404);
    if (row.agent_node_id && row.agent_node_id !== agentNodeId) {
      throw new AgentRunAdmissionError(
        'source session is already bound to a different AgentNode',
        'ADMISSION_AGENT_NODE_MISMATCH',
        409,
      );
    }
    const mismatchLegacy = db.prepare(`
      SELECT COUNT(*) AS count FROM session_files
      WHERE session_id = ? AND agent_node_id IS NOT NULL AND agent_node_id != ?
    `).get(row.id, agentNodeId) as { count: number };
    const mismatchForest = db.prepare(`
      SELECT COUNT(*) AS count FROM claim_forest_claims
      WHERE session_id = ? AND agent_node_id IS NOT NULL AND agent_node_id != ?
    `).get(row.id, agentNodeId) as { count: number };
    if (mismatchLegacy.count > 0 || mismatchForest.count > 0) {
      throw new AgentRunAdmissionError(
        'source session claims are already bound to a different AgentNode',
        'ADMISSION_AGENT_NODE_MISMATCH',
        409,
      );
    }

    const runId = `agent_run_${sha256(canonicalJson({
      agentNodeId,
      sessionId: row.id,
      bodyId: row.agent_id,
      harbor: witness.authorizedHarbor,
      repoId: witness.workspace.repoId,
      worktreeId: witness.worktreeId,
      worktreeRoot: witness.worktreeRoot,
      worktreePhysicalId: witness.workspace.worktreePhysicalId,
      gitDirPhysicalId: witness.workspace.gitDirPhysicalId,
      branch: witness.branch,
      head: witness.workspace.head,
      base: witness.workspace.base,
    })).slice(0, 40)}`;
    const adapter = adapterBody(witness.sourceAdapter);
    const payload: Record<string, unknown> = {
      schema: AGENT_RUN_SCHEMA,
      runId,
      agentNodeId,
      sessionId: row.id,
      bodyId: row.agent_id,
      body: {
        kind: adapter.kind,
        provider: adapter.provider,
        modelTier: 'custom',
        modelName: null,
        launchMode: adapter.launchMode,
      },
      workspace: {
        repo: agent.profile.scope.repoRoot ?? witness.worktreeRoot,
        repoId: witness.workspace.repoId,
        repoScopeKey: agent.profile.scope.key,
        repoCommonDir: witness.workspace.repoCommonDir,
        worktree: witness.worktreeRoot,
        worktreeId: witness.worktreeId,
        worktreeRealpath: witness.workspace.worktreeRealpath,
        worktreePhysicalId: witness.workspace.worktreePhysicalId,
        gitDirRealpath: witness.workspace.gitDirRealpath,
        gitDirPhysicalId: witness.workspace.gitDirPhysicalId,
        branch: witness.branch,
        headCommit: witness.workspace.head,
        baseCommit: witness.workspace.base,
      },
      transcriptId: null,
      status: 'running',
      startedAt: new Date(row.created_at).toISOString(),
      stoppedAt: null,
      stopReason: null,
      predecessorRunId: null,
      successorRunId: null,
      admission: {
        kind: 'verified-session-promotion',
        authorizedActorId: witness.authorizedActorId,
        harbor: witness.authorizedHarbor,
        sourceAdapter: witness.sourceAdapter,
        handoffEpisodeId: origin.handoffEpisodeId,
        profileRevision: agent.profile.revision,
        profileLedgerSeq: agent.ledgerSeq,
      },
    };

    const existing = db.prepare(`
      SELECT ledger_seq, event_id, agent_node_id, run_id, payload_json
      FROM harbor_events
      WHERE stream_type = 'agent-run' AND session_id = ?
      ORDER BY ledger_seq
    `).all(row.id) as Array<{
      ledger_seq: number;
      event_id: string;
      agent_node_id: string | null;
      run_id: string | null;
      payload_json: string;
    }>;
    if (existing.length > 0) {
      for (const fact of existing) {
        let decoded: Record<string, unknown> | null = null;
        try {
          decoded = object(JSON.parse(fact.payload_json));
        } catch {
          decoded = null;
        }
        if (
          !decoded
          || fact.agent_node_id !== agentNodeId
          || fact.run_id !== runId
          || !sameRunBinding(decoded, payload)
        ) {
          throw new AgentRunAdmissionError(
            'source session already has a conflicting AgentRun admission',
            'ADMISSION_EVENT_CONFLICT',
            409,
          );
        }
      }
    }

    let appended: AppendResult;
    if (existing.length === 0) {
      appended = appendEvent(db, { streamType: 'agent-run', payload });
    } else {
      appended = {
        duplicate: true,
        ledgerSeq: existing[0].ledger_seq,
        eventId: existing[0].event_id,
        contentHash: null,
        prevHash: null,
      };
    }

    db.prepare('UPDATE sessions SET agent_node_id = ? WHERE id = ? AND agent_node_id IS NULL')
      .run(agentNodeId, row.id);
    db.prepare('UPDATE session_files SET agent_node_id = ? WHERE session_id = ? AND agent_node_id IS NULL')
      .run(agentNodeId, row.id);
    db.prepare('UPDATE claim_forest_claims SET agent_node_id = ? WHERE session_id = ? AND agent_node_id IS NULL')
      .run(agentNodeId, row.id);

    return {
      ...witness,
      agentNodeId,
      runId,
      eventId: appended.eventId,
      ledgerSeq: appended.ledgerSeq,
      replayed: appended.duplicate,
    };
  }

  function admitPromotedSession(input: AdmitPromotedSessionInput): AgentRunAdmissionResult {
    const connection = db as DatabaseInstance & { inTransaction?: boolean };
    if (connection.inTransaction) return admitInTransaction(input);
    return db.transaction(() => admitInTransaction(input)).immediate();
  }

  return { preflightPromotedSession, admitPromotedSession };
}

export type AgentRunAdmissionService = ReturnType<typeof createAgentRunAdmissionService>;
