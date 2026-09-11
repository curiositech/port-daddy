/**
 * Actor-only continuation for pre-AgentNode sessions.
 *
 * This is deliberately not part of durable ownership. Its sole authority is a
 * daemon-verified credential actor that exactly equals the predecessor's
 * immutable identity stamp. It transfers no roadmap epoch, AgentNode, or
 * operator authority. The complete legacy/forest claim set, notes, session
 * transition, guarded split-alias repair, and verifier retirement commit in one
 * caller-owned IMMEDIATE transaction or do not happen at all.
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { buildHumanReadableId } from './agent-names.js';
import { createClaimForest } from './claim-forest.js';
import type { ExactClaimBinding } from './durable-ownership.js';
import {
  captureLegacyClaimSetWitness,
  LegacyActorContinuityError,
  normalizeLegacyContinuationWorktreeWitness,
  repairSyntheticMigratedAlias,
  type LegacyContinuationWorktreeWitness,
  type SyntheticAliasRepairResult,
} from './legacy-actor-continuity.js';
import type { NoteEncryption } from './note-encryption.js';

const MAX_NOTES_PER_SESSION = 500;
const MAX_CONTINUATION_CLAIMS = 5_000;

export interface LegacySessionContinuationOptions {
  /** Actor returned by credential verification, never request body text. */
  verifiedActorId: string;
  /** Informational class returned by the same credential verification. */
  verifiedSoulClass: string;
  /** Exact harbor in which the credential was verified. */
  harbor: string;
  /** Exact daemon-captured physical Git/worktree witness. */
  worktree: LegacyContinuationWorktreeWitness;
  purpose?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  durable?: boolean;
}

export interface LegacySessionContinuationService {
  continueSameOwner(
    predecessorSessionId: string,
    options: LegacySessionContinuationOptions,
  ): Record<string, unknown>;
}

interface SessionRow {
  id: string;
  purpose: string;
  status: string;
  phase: string | null;
  agent_id: string | null;
  agent_node_id: string | null;
  worktree_id: string | null;
  identity_project: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  metadata: string | null;
  is_durable: number | null;
  wrapped_session_key: string | null;
}

interface LegacyClaimRow {
  id: number;
  session_id: string;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  symbol: string | null;
  symbol_path: string | null;
  claimed_at: number;
  released_at: number | null;
  agent_node_id: string | null;
}

interface ForestClaimRow {
  id: number;
  node_id: string;
  session_id: string;
  claim_agent_id: string | null;
  agent_node_id: string | null;
  mode: 'S' | 'X' | 'IS' | 'IX' | 'SIX';
  intent: string | null;
  claimed_at: number;
  released_at: number | null;
  observed_by: string | null;
  confidence: number;
  legacy_session_file_id: number | null;
  claim_content_hash: string | null;
  claim_metadata: string | null;
  repo_id: string;
  world_kind: 'worktree' | 'ref' | 'commit' | 'harbor';
  world_id: string;
  selector_kind: 'repo' | 'directory' | 'file' | 'symbol' | 'range';
  path: string | null;
  symbol: string | null;
  symbol_path: string | null;
  start_line: number | null;
  end_line: number | null;
  git_oid: string | null;
  node_content_hash: string | null;
  parent_id: string | null;
  node_created_at: number;
  node_last_observed_at: number;
  node_metadata: string | null;
}

type ContinuationErrorCode =
  | 'ACTOR_ONLY_CONTINUATION_ALREADY_CONSUMED'
  | 'ACTOR_ONLY_CONTINUATION_FAILED'
  | 'ACTOR_ONLY_PREDECESSOR_REQUIRED'
  | 'ACTOR_ONLY_WORKTREE_MISMATCH'
  | 'AGENT_NODE_CONTINUATION_REQUIRED'
  | 'CLAIM_SNAPSHOT_MISMATCH'
  | 'SAME_OWNER_ACTOR_MISMATCH'
  | 'SESSION_NOT_FOUND'
  | 'VALIDATION_ERROR';

class LegacySessionContinuationError extends Error {
  /**
   * Preserve a stable transport code without leaking raw SQLite failures. The
   * design keeps every unexpected storage fault under one rollback-safe code.
   * @param message Human-readable, non-secret refusal reason.
   * @param code Stable route/client error code.
   */
  constructor(message: string, readonly code: ContinuationErrorCode) {
    super(message);
    this.name = 'LegacySessionContinuationError';
  }
}

function objectOrEmpty(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizedText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function sessionMetadataMatchesWorktree(
  metadata: Record<string, unknown>,
  worktree: LegacyContinuationWorktreeWitness,
): boolean {
  const candidate = metadata.worktree;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const row = candidate as Record<string, unknown>;
  return row.id === worktree.id
    && row.root === worktree.root
    && row.name === worktree.name
    && row.branch === worktree.branch
    && row.isMain === worktree.isMain;
}

function legacyClaimKey(row: LegacyClaimRow): string {
  return JSON.stringify([
    row.file_path,
    row.symbol_path || row.symbol
      ? 'symbol'
      : row.start_line != null || row.end_line != null ? 'range' : 'file',
    row.start_line,
    row.end_line,
    row.symbol,
    row.symbol_path,
  ]);
}

function forestSelectorKey(row: ForestClaimRow): string {
  return JSON.stringify([
    row.path ?? '',
    row.selector_kind,
    row.start_line,
    row.end_line,
    row.symbol,
    row.symbol_path,
  ]);
}

function forestAuthorityKey(
  row: ForestClaimRow,
  overrides: {
    sessionId?: string;
    agentId?: string | null;
    agentNodeId?: string | null;
    claimedAt?: number;
    releasedAt?: number | null;
    observedBy?: string | null;
    legacySessionFileId?: number | null;
    metadata?: string | null;
  } = {},
): string {
  return JSON.stringify([
    row.node_id,
    row.repo_id,
    row.world_kind,
    row.world_id,
    row.git_oid,
    row.selector_kind,
    row.path,
    row.symbol,
    row.symbol_path,
    row.start_line,
    row.end_line,
    row.node_content_hash,
    row.parent_id,
    row.node_created_at,
    row.node_last_observed_at,
    row.node_metadata,
    row.claim_content_hash,
    row.mode,
    row.intent,
    row.confidence,
    overrides.sessionId ?? row.session_id,
    Object.prototype.hasOwnProperty.call(overrides, 'agentId')
      ? overrides.agentId
      : row.claim_agent_id,
    Object.prototype.hasOwnProperty.call(overrides, 'agentNodeId')
      ? overrides.agentNodeId
      : row.agent_node_id,
    overrides.claimedAt ?? row.claimed_at,
    Object.prototype.hasOwnProperty.call(overrides, 'releasedAt')
      ? overrides.releasedAt
      : row.released_at,
    Object.prototype.hasOwnProperty.call(overrides, 'observedBy')
      ? overrides.observedBy
      : row.observed_by,
    Object.prototype.hasOwnProperty.call(overrides, 'legacySessionFileId')
      ? overrides.legacySessionFileId
      : row.legacy_session_file_id,
    Object.prototype.hasOwnProperty.call(overrides, 'metadata')
      ? overrides.metadata
      : row.claim_metadata,
  ]);
}

function continuationClaimMetadata(
  source: ForestClaimRow,
  predecessorSessionId: string,
  transferredAt: number,
): Record<string, unknown> {
  let prior: Record<string, unknown> = {};
  if (source.claim_metadata) {
    try {
      const parsed = JSON.parse(source.claim_metadata);
      prior = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { predecessorMetadataRaw: source.claim_metadata };
    } catch {
      prior = { predecessorMetadataRaw: source.claim_metadata };
    }
  }
  return {
    ...prior,
    actorOnlyContinuation: {
      predecessorSessionId,
      predecessorClaimId: source.id,
      predecessorClaimNodeId: source.node_id,
      transferredAt,
    },
  };
}

function hasDocumentedLegacyClaimActor(
  source: ForestClaimRow,
  predecessorAgentId: string,
  stampedActorId: string,
): boolean {
  if (source.claim_agent_id === predecessorAgentId) return true;
  let metadata: Record<string, unknown> | null = null;
  try {
    const parsed = source.claim_metadata ? JSON.parse(source.claim_metadata) : null;
    metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return false;
  }
  const witness = metadata?.legacyActorClaimActor;
  if (!witness || typeof witness !== 'object' || Array.isArray(witness)) return false;
  const record = witness as Record<string, unknown>;
  if (
    record.predecessorAgentId !== predecessorAgentId
    || record.stampedActorId !== stampedActorId
  ) return false;
  return source.claim_agent_id === null
    ? record.state === 'historically-missing'
    : source.claim_agent_id === stampedActorId && record.state === 'daemon-stamped-actor';
}

/**
 * Construct the isolated pre-AgentNode continuation writer. Its purpose is to
 * keep legacy authority out of the signed AgentNode ownership coordinator while
 * still sharing the canonical claim-node address validator.
 * @param db Daemon registry connection and sole transaction writer.
 * @param noteEncryption Optional daemon note encryption service.
 * @returns Actor-only continuation service.
 */
export function createLegacySessionContinuation(
  db: Database.Database,
  noteEncryption?: NoteEncryption,
): LegacySessionContinuationService {
  const claimForest = createClaimForest(db);
  const statements = {
    getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    insertSession: db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, agent_node_id, worktree_id,
        identity_project, created_at, updated_at, completed_at, metadata,
        is_durable
      ) VALUES (?, ?, 'active', 'in_progress', ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
    `),
    setWrappedKey: db.prepare(`
      UPDATE sessions SET wrapped_session_key = ?
      WHERE id = ? AND wrapped_session_key IS NULL
    `),
    setMetadata: db.prepare(`
      UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?
    `),
    abandonActive: db.prepare(`
      UPDATE sessions
      SET status = 'abandoned', phase = 'abandoned', updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'active'
    `),
    activeLegacy: db.prepare(`
      SELECT * FROM session_files
      WHERE session_id = ? AND released_at IS NULL
      ORDER BY id
    `),
    releaseLegacy: db.prepare(`
      UPDATE session_files SET released_at = ?
      WHERE session_id = ? AND released_at IS NULL
    `),
    insertLegacy: db.prepare(`
      INSERT INTO session_files (
        session_id, file_path, start_line, end_line, symbol, symbol_path,
        claimed_at, released_at, agent_node_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `),
    activeForest: db.prepare(`
      SELECT c.id, c.node_id, c.session_id, c.agent_id AS claim_agent_id,
             c.agent_node_id, c.mode, c.intent, c.claimed_at, c.released_at,
             c.observed_by, c.confidence, c.legacy_session_file_id,
             c.claim_content_hash, c.metadata AS claim_metadata,
             n.repo_id, n.world_kind, n.world_id, n.selector_kind, n.path,
             n.symbol, n.symbol_path, n.start_line, n.end_line, n.git_oid,
             n.content_hash AS node_content_hash, n.parent_id,
             n.created_at AS node_created_at,
             n.last_observed_at AS node_last_observed_at,
             n.metadata AS node_metadata
      FROM claim_forest_claims c
      JOIN claim_forest_nodes n ON n.id = c.node_id
      WHERE c.session_id = ? AND c.released_at IS NULL
      ORDER BY c.id
    `),
    insertForest: db.prepare(`
      INSERT INTO claim_forest_claims (
        node_id, session_id, agent_id, agent_node_id, mode, intent, claimed_at,
        released_at, observed_by, confidence, legacy_session_file_id,
        claim_content_hash, metadata
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    `),
    countNotes: db.prepare('SELECT COUNT(*) AS count FROM session_notes WHERE session_id = ?'),
    insertNote: db.prepare(`
      INSERT INTO session_notes (session_id, content, type, created_at)
      VALUES (?, ?, 'actor-only-continuation', ?)
    `),
    countActiveLegacy: db.prepare(`
      SELECT COUNT(*) AS count FROM session_files
      WHERE session_id = ? AND released_at IS NULL
    `),
    countActiveForest: db.prepare(`
      SELECT COUNT(*) AS count FROM claim_forest_claims
      WHERE session_id = ? AND released_at IS NULL
    `),
  };

  const forestRows = (sessionId: string): ForestClaimRow[] =>
    statements.activeForest.all(sessionId) as ForestClaimRow[];

  const formatSession = (row: SessionRow): Record<string, unknown> => ({
    id: row.id,
    purpose: row.purpose,
    status: row.status,
    phase: row.phase || 'in_progress',
    agentId: row.agent_id,
    agentNodeId: row.agent_node_id,
    worktreeId: row.worktree_id,
    identityProject: row.identity_project,
    fileCount: Number((statements.countActiveLegacy.get(row.id) as { count: number }).count),
    noteCount: Number((statements.countNotes.get(row.id) as { count: number }).count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    metadata: objectOrEmpty(row.metadata),
    durable: row.is_durable === 1,
  });

  const noteScope = (project: string | null): string | null =>
    project ? `${project}:fleet` : null;

  /**
   * Continue one exact pre-AgentNode session. The intent is a narrow rescue for
   * a principal that still holds its original daemon credential, not a general
   * takeover or cleanup primitive.
   * @param predecessorSessionId Exact active or abandoned predecessor.
   * @param options Credential-derived actor and daemon-probed worktree evidence.
   * @returns Committed successor receipt or a stable fail-closed error.
   */
  function continueSameOwner(
    predecessorSessionId: string,
    options: LegacySessionContinuationOptions,
  ): Record<string, unknown> {
    const sourceId = normalizedText(predecessorSessionId);
    const verifiedActorId = normalizedText(options?.verifiedActorId);
    const verifiedSoulClass = normalizedText(options?.verifiedSoulClass);
    const harbor = normalizedText(options?.harbor);
    const worktree = normalizeLegacyContinuationWorktreeWitness(options?.worktree);
    const worktreeId = worktree?.id ?? null;
    if (!sourceId || !verifiedActorId || !verifiedSoulClass || !harbor || !worktree || !worktreeId) {
      return {
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'actor-only continuation requires a predecessor, verified actor, harbor, and exact probed Git worktree',
      };
    }
    if (db.inTransaction) {
      return {
        success: false,
        code: 'ACTOR_ONLY_CONTINUATION_FAILED',
        error: 'actor-only continuation must own its IMMEDIATE transaction',
      };
    }
    if (options.purpose !== undefined && options.purpose !== null && typeof options.purpose !== 'string') {
      return { success: false, code: 'VALIDATION_ERROR', error: 'purpose must be a string' };
    }
    if (options.note !== undefined && options.note !== null && typeof options.note !== 'string') {
      return { success: false, code: 'VALIDATION_ERROR', error: 'note must be a string' };
    }
    if (options.metadata !== undefined && options.metadata !== null && (
      typeof options.metadata !== 'object' || Array.isArray(options.metadata)
    )) {
      return { success: false, code: 'VALIDATION_ERROR', error: 'metadata must be an object' };
    }

    let predecessorKey: Buffer | null = null;
    let successorKey: Buffer | null = null;
    const keysToWipe: Buffer[] = [];
    try {
      return db.transaction(() => {
        const predecessor = statements.getSession.get(sourceId) as SessionRow | undefined;
        if (!predecessor) {
          throw new LegacySessionContinuationError('session not found', 'SESSION_NOT_FOUND');
        }
        if (predecessor.status !== 'active' && predecessor.status !== 'abandoned') {
          throw new LegacySessionContinuationError(
            'actor-only continuation accepts only an active or abandoned predecessor',
            'ACTOR_ONLY_PREDECESSOR_REQUIRED',
          );
        }
        if (normalizedText(predecessor.agent_node_id)) {
          throw new LegacySessionContinuationError(
            'AgentNode-bound sessions require the signed durable-owner continuation path',
            'AGENT_NODE_CONTINUATION_REQUIRED',
          );
        }
        const predecessorAgentId = normalizedText(predecessor.agent_id);
        if (!predecessorAgentId) {
          throw new LegacySessionContinuationError(
            'actor-only continuation requires the predecessor agent label',
            'ACTOR_ONLY_PREDECESSOR_REQUIRED',
          );
        }

        const predecessorMetadata = objectOrEmpty(predecessor.metadata);
        const identity = predecessorMetadata.identity;
        const stampedActorId = identity && typeof identity === 'object' && !Array.isArray(identity)
          && (identity as Record<string, unknown>).verified === true
          && typeof (identity as Record<string, unknown>).actorId === 'string'
          ? normalizedText((identity as Record<string, unknown>).actorId as string)
          : null;
        if (!stampedActorId || stampedActorId !== verifiedActorId) {
          throw new LegacySessionContinuationError(
            'credential actor does not equal the predecessor session daemon stamp',
            'SAME_OWNER_ACTOR_MISMATCH',
          );
        }
        if (Object.prototype.hasOwnProperty.call(predecessorMetadata, 'actorOnlyContinuation')) {
          throw new LegacySessionContinuationError(
            'actor-only continuation was already consumed for this predecessor',
            'ACTOR_ONLY_CONTINUATION_ALREADY_CONSUMED',
          );
        }
        if (!predecessor.worktree_id || predecessor.worktree_id !== worktreeId) {
          throw new LegacySessionContinuationError(
            'daemon-probed caller worktree does not equal the predecessor claim world',
            'ACTOR_ONLY_WORKTREE_MISMATCH',
          );
        }
        if (!sessionMetadataMatchesWorktree(predecessorMetadata, worktree)) {
          throw new LegacySessionContinuationError(
            'predecessor session lacks the exact daemon-probed worktree witness',
            'ACTOR_ONLY_WORKTREE_MISMATCH',
          );
        }

        const activeLegacy = statements.activeLegacy.all(sourceId) as LegacyClaimRow[];
        const activeForest = forestRows(sourceId);
        if (activeLegacy.length > MAX_CONTINUATION_CLAIMS || activeForest.length > MAX_CONTINUATION_CLAIMS) {
          throw new LegacySessionContinuationError(
            'actor-only continuation claim set exceeds the bounded maximum',
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }
        if (activeLegacy.some(row => normalizedText(row.agent_node_id))
          || activeForest.some(row => normalizedText(row.agent_node_id))) {
          throw new LegacySessionContinuationError(
            'AgentNode-bound claims require the signed durable-owner continuation path',
            'AGENT_NODE_CONTINUATION_REQUIRED',
          );
        }
        if (activeForest.some(claim => !hasDocumentedLegacyClaimActor(
          claim,
          predecessorAgentId,
          stampedActorId,
        ))) {
          throw new LegacySessionContinuationError(
            'predecessor claim actor attribution conflicts with the daemon-stamped session owner',
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }

        const legacySnapshot = activeLegacy.map(legacyClaimKey).sort();
        const forestSnapshot = activeForest.map(forestSelectorKey).sort();
        if (
          legacySnapshot.length !== forestSnapshot.length
          || JSON.stringify(legacySnapshot) !== JSON.stringify(forestSnapshot)
        ) {
          throw new LegacySessionContinuationError(
            'legacy and claim-forest snapshots differ; no continuation state was changed',
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }
        if (activeForest.some(claim => claim.world_kind !== 'worktree' || claim.world_id !== worktreeId)) {
          throw new LegacySessionContinuationError(
            'actor-only continuation requires every claim in the exact predecessor worktree world',
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }

        const canonicalBindings: ExactClaimBinding[] = activeForest.map(claim => ({
          claimNodeId: claim.node_id,
          filePath: claim.path ?? '',
          selectorKind: claim.selector_kind,
          startLine: claim.start_line,
          endLine: claim.end_line,
          symbol: claim.symbol,
          symbolPath: claim.symbol_path,
          worldKind: claim.world_kind,
          worldId: claim.world_id,
          claimedAt: claim.claimed_at,
          mode: claim.mode,
          contentHash: claim.claim_content_hash,
          disposition: 'release',
        }));
        try {
          claimForest.planAnchorRepairClaimMappings(
            sourceId,
            canonicalBindings,
            `${worktreeId}:actor-only-address-validation`,
          );
        } catch (error) {
          throw new LegacySessionContinuationError(
            `predecessor claim node/address validation failed: ${(error as Error).message}`,
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }
        const claimSet = captureLegacyClaimSetWitness(db, sourceId);
        if (claimSet.count !== activeForest.length) {
          throw new LegacySessionContinuationError(
            'predecessor claim witness cardinality changed before continuation',
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }

        const now = Date.now();
        const successorPurpose = normalizedText(options.purpose) ?? predecessor.purpose;
        const successorId = buildHumanReadableId(
          'session',
          successorPurpose,
          randomBytes(6).toString('hex'),
          'work',
        );
        const takeoverReason = normalizedText(options.note);
        const successorMetadata: Record<string, unknown> = {
          ...(options.metadata ?? {}),
          worktree: {
            id: worktree.id,
            root: worktree.root,
            name: worktree.name,
            branch: worktree.branch,
            isMain: worktree.isMain,
          },
          identity: {
            verified: true,
            actorId: verifiedActorId,
            soulClass: verifiedSoulClass,
          },
          predecessorSessionId: sourceId,
          predecessorStatus: predecessor.status,
          predecessorAgentId,
          predecessorActorId: verifiedActorId,
          predecessorWorktreeId: worktreeId,
          actorOnlyWorktreeWitness: worktree,
          actorOnlyClaimSetWitness: claimSet,
          actorOnlyContinuation: true,
          durableOwnershipTransferred: false,
          agentNodeUpgradeRequired: true,
          continuedAt: now,
          takeoverReason,
        };
        const insertedSession = statements.insertSession.run(
          successorId,
          successorPurpose,
          predecessorAgentId,
          worktreeId,
          predecessor.identity_project,
          now,
          now,
          JSON.stringify(successorMetadata),
          (options.durable ?? predecessor.is_durable === 1) ? 1 : 0,
        );
        if (insertedSession.changes !== 1) {
          throw new LegacySessionContinuationError(
            'actor-only successor session was not inserted exactly',
            'ACTOR_ONLY_CONTINUATION_FAILED',
          );
        }

        if (noteEncryption?.isEnabled()) {
          if (predecessor.wrapped_session_key) {
            predecessorKey = noteEncryption.unwrapSessionKey(
              predecessor.wrapped_session_key,
              noteScope(predecessor.identity_project),
            );
            keysToWipe.push(predecessorKey);
          } else {
            predecessorKey = noteEncryption.generateSessionKey();
            keysToWipe.push(predecessorKey);
            const wrapped = noteEncryption.wrapSessionKey(
              predecessorKey,
              noteScope(predecessor.identity_project),
            );
            if (statements.setWrappedKey.run(wrapped, sourceId).changes !== 1) {
              throw new LegacySessionContinuationError(
                'predecessor note key changed during continuation',
                'ACTOR_ONLY_CONTINUATION_FAILED',
              );
            }
          }
          successorKey = noteEncryption.generateSessionKey();
          keysToWipe.push(successorKey);
          const successorWrapped = noteEncryption.wrapSessionKey(
            successorKey,
            noteScope(predecessor.identity_project),
          );
          if (statements.setWrappedKey.run(successorWrapped, successorId).changes !== 1) {
            throw new LegacySessionContinuationError(
              'successor note key was not stored exactly',
              'ACTOR_ONLY_CONTINUATION_FAILED',
            );
          }
        }

        const predecessorNextMetadata = {
          ...predecessorMetadata,
          actorOnlyContinuation: {
            successorSessionId: successorId,
            actorId: verifiedActorId,
            continuedAt: now,
            claimsTransferred: activeLegacy.length,
            worktree,
            claimSet,
          },
        };
        if (statements.setMetadata.run(JSON.stringify(predecessorNextMetadata), now, sourceId).changes !== 1) {
          throw new LegacySessionContinuationError(
            'predecessor continuation marker lost its compare-and-swap',
            'ACTOR_ONLY_CONTINUATION_FAILED',
          );
        }
        if (predecessor.status === 'active'
          && statements.abandonActive.run(now, now, sourceId).changes !== 1) {
          throw new LegacySessionContinuationError(
            'active predecessor status changed during continuation',
            'ACTOR_ONLY_CONTINUATION_FAILED',
          );
        }

        const aliasRepair: SyntheticAliasRepairResult = predecessorAgentId === verifiedActorId
          ? {
              status: 'not-needed',
              alias: predecessorAgentId,
              actorId: verifiedActorId,
            }
          : repairSyntheticMigratedAlias(db, {
            harbor,
            alias: predecessorAgentId,
            actorId: verifiedActorId,
            repairedAt: now,
            predecessorSessionId: sourceId,
            successorSessionId: successorId,
            worktree,
            claimSet,
          });

        if (Number((statements.countNotes.get(sourceId) as { count: number }).count) >= MAX_NOTES_PER_SESSION) {
          throw new LegacySessionContinuationError(
            'predecessor note limit prevents an atomic continuation receipt',
            'ACTOR_ONLY_CONTINUATION_FAILED',
          );
        }
        const predecessorNote = `Continued by actor-only successor ${successorId} (${verifiedActorId}).${takeoverReason ? ` Reason: ${takeoverReason}` : ''}`;
        const successorNote = `Actor-only successor for ${sourceId}; no AgentNode or roadmap ownership was transferred.${takeoverReason ? ` Reason: ${takeoverReason}` : ''}`;
        const predecessorStored = predecessorKey && noteEncryption
          ? noteEncryption.encryptNote(predecessorNote, predecessorKey)
          : predecessorNote;
        const successorStored = successorKey && noteEncryption
          ? noteEncryption.encryptNote(successorNote, successorKey)
          : successorNote;
        const predecessorNoteId = Number(statements.insertNote.run(
          sourceId,
          predecessorStored,
          now,
        ).lastInsertRowid);
        const successorNoteId = Number(statements.insertNote.run(
          successorId,
          successorStored,
          now,
        ).lastInsertRowid);

        const releasedLegacy = statements.releaseLegacy.run(now, sourceId).changes;
        const releasedForest = claimForest.releaseAllBySession(sourceId, now);
        if (releasedLegacy !== activeLegacy.length || releasedForest !== activeForest.length) {
          throw new LegacySessionContinuationError(
            'predecessor claim release cardinality changed during continuation',
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }

        const legacyIds = new Map<string, number[]>();
        for (const source of activeLegacy) {
          const inserted = statements.insertLegacy.run(
            successorId,
            source.file_path,
            source.start_line,
            source.end_line,
            source.symbol,
            source.symbol_path,
            now,
          );
          if (inserted.changes !== 1) {
            throw new LegacySessionContinuationError(
              'successor compatibility claim was not inserted exactly',
              'CLAIM_SNAPSHOT_MISMATCH',
            );
          }
          const key = legacyClaimKey(source);
          const ids = legacyIds.get(key) ?? [];
          ids.push(Number(inserted.lastInsertRowid));
          legacyIds.set(key, ids);
        }

        const expectedSuccessorForest = new Map<string, string[]>();
        for (const source of activeForest) {
          const ids = legacyIds.get(forestSelectorKey(source));
          const legacySessionFileId = ids?.shift();
          if (!legacySessionFileId) {
            throw new LegacySessionContinuationError(
              'claim forest row has no exact successor compatibility row',
              'CLAIM_SNAPSHOT_MISMATCH',
            );
          }
          const claimMetadata = continuationClaimMetadata(source, sourceId, now);
          const serializedMetadata = JSON.stringify(claimMetadata);
          const inserted = statements.insertForest.run(
            source.node_id,
            successorId,
            predecessorAgentId,
            source.mode,
            source.intent,
            now,
            'sessions.actor-only-continuation',
            source.confidence,
            legacySessionFileId,
            source.claim_content_hash,
            serializedMetadata,
          );
          if (inserted.changes !== 1) {
            throw new LegacySessionContinuationError(
              'successor claim forest row was not recreated exactly',
              'CLAIM_SNAPSHOT_MISMATCH',
            );
          }
          const authorityKey = forestAuthorityKey(source, {
            sessionId: successorId,
            agentId: predecessorAgentId,
            agentNodeId: null,
            claimedAt: now,
            releasedAt: null,
            observedBy: 'sessions.actor-only-continuation',
            legacySessionFileId,
            metadata: serializedMetadata,
          });
          const expected = expectedSuccessorForest.get(authorityKey) ?? [];
          expected.push(source.node_id);
          expectedSuccessorForest.set(authorityKey, expected);
        }
        if ([...legacyIds.values()].some(ids => ids.length !== 0)) {
          throw new LegacySessionContinuationError(
            'successor compatibility claim set contains unmatched rows',
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }

        const successorLegacy = statements.activeLegacy.all(successorId) as LegacyClaimRow[];
        const successorForest = forestRows(successorId);
        const actualSuccessorForest = new Map<string, string[]>();
        for (const claim of successorForest) {
          const authorityKey = forestAuthorityKey(claim);
          const actual = actualSuccessorForest.get(authorityKey) ?? [];
          actual.push(claim.node_id);
          actualSuccessorForest.set(authorityKey, actual);
        }
        const expectedAuthoritySnapshot = [...expectedSuccessorForest.entries()]
          .map(([key, nodeIds]) => [key, nodeIds.sort()] as const)
          .sort(([left], [right]) => left.localeCompare(right));
        const actualAuthoritySnapshot = [...actualSuccessorForest.entries()]
          .map(([key, nodeIds]) => [key, nodeIds.sort()] as const)
          .sort(([left], [right]) => left.localeCompare(right));
        const activeSourceLegacy = Number((statements.countActiveLegacy.get(sourceId) as { count: number }).count);
        const activeSourceForest = Number((statements.countActiveForest.get(sourceId) as { count: number }).count);
        if (
          activeSourceLegacy !== 0
          || activeSourceForest !== 0
          || JSON.stringify(successorLegacy.map(legacyClaimKey).sort()) !== JSON.stringify(legacySnapshot)
          || JSON.stringify(successorForest.map(forestSelectorKey).sort()) !== JSON.stringify(forestSnapshot)
          || JSON.stringify(actualAuthoritySnapshot) !== JSON.stringify(expectedAuthoritySnapshot)
        ) {
          throw new LegacySessionContinuationError(
            'successor exact-claim readback failed; all continuation state was rolled back',
            'CLAIM_SNAPSHOT_MISMATCH',
          );
        }

        const committedPredecessor = statements.getSession.get(sourceId) as SessionRow | undefined;
        const committedSuccessor = statements.getSession.get(successorId) as SessionRow | undefined;
        const committedPredecessorMetadata = committedPredecessor
          ? objectOrEmpty(committedPredecessor.metadata)
          : {};
        const committedSuccessorMetadata = committedSuccessor
          ? objectOrEmpty(committedSuccessor.metadata)
          : {};
        const committedPredecessorIdentity = committedPredecessorMetadata.identity;
        const committedSuccessorIdentity = committedSuccessorMetadata.identity;
        const predecessorContinuation = committedPredecessorMetadata.actorOnlyContinuation;
        const predecessorContinuationRecord = predecessorContinuation
          && typeof predecessorContinuation === 'object'
          && !Array.isArray(predecessorContinuation)
          ? predecessorContinuation as Record<string, unknown>
          : null;
        const predecessorCommittedWorktree = normalizeLegacyContinuationWorktreeWitness(
          predecessorContinuationRecord?.worktree,
        );
        const successorCommittedWorktree = normalizeLegacyContinuationWorktreeWitness(
          committedSuccessorMetadata.actorOnlyWorktreeWitness,
        );
        const predecessorCommittedClaimSet = predecessorContinuationRecord?.claimSet;
        const successorCommittedClaimSet = committedSuccessorMetadata.actorOnlyClaimSetWitness;
        const exactAliasBinding = predecessorAgentId === verifiedActorId
          ? verifiedActorId
          : (db.prepare(`
              SELECT actor_id FROM actor_alias WHERE harbor = ? AND alias = ?
            `).get(harbor, predecessorAgentId) as { actor_id: string } | undefined)?.actor_id;
        if (
          !committedPredecessor
          || committedPredecessor.status !== 'abandoned'
          || committedPredecessor.agent_id !== predecessorAgentId
          || committedPredecessor.agent_node_id !== null
          || committedPredecessor.worktree_id !== worktreeId
          || !committedSuccessor
          || committedSuccessor.status !== 'active'
          || committedSuccessor.agent_id !== predecessorAgentId
          || committedSuccessor.agent_node_id !== null
          || committedSuccessor.worktree_id !== worktreeId
          || !committedPredecessorIdentity
          || typeof committedPredecessorIdentity !== 'object'
          || Array.isArray(committedPredecessorIdentity)
          || (committedPredecessorIdentity as Record<string, unknown>).verified !== true
          || (committedPredecessorIdentity as Record<string, unknown>).actorId !== verifiedActorId
          || !committedSuccessorIdentity
          || typeof committedSuccessorIdentity !== 'object'
          || Array.isArray(committedSuccessorIdentity)
          || (committedSuccessorIdentity as Record<string, unknown>).verified !== true
          || (committedSuccessorIdentity as Record<string, unknown>).actorId !== verifiedActorId
          || (committedSuccessorIdentity as Record<string, unknown>).soulClass !== verifiedSoulClass
          || predecessorContinuationRecord?.successorSessionId !== successorId
          || predecessorContinuationRecord.actorId !== verifiedActorId
          || predecessorContinuationRecord.claimsTransferred !== activeLegacy.length
          || !predecessorCommittedWorktree
          || JSON.stringify(predecessorCommittedWorktree) !== JSON.stringify(worktree)
          || JSON.stringify(predecessorCommittedClaimSet) !== JSON.stringify(claimSet)
          || committedSuccessorMetadata.predecessorSessionId !== sourceId
          || committedSuccessorMetadata.predecessorAgentId !== predecessorAgentId
          || committedSuccessorMetadata.predecessorActorId !== verifiedActorId
          || committedSuccessorMetadata.predecessorWorktreeId !== worktreeId
          || committedSuccessorMetadata.actorOnlyContinuation !== true
          || committedSuccessorMetadata.durableOwnershipTransferred !== false
          || committedSuccessorMetadata.agentNodeUpgradeRequired !== true
          || !successorCommittedWorktree
          || JSON.stringify(successorCommittedWorktree) !== JSON.stringify(worktree)
          || JSON.stringify(successorCommittedClaimSet) !== JSON.stringify(claimSet)
          || exactAliasBinding !== verifiedActorId
        ) {
          throw new LegacySessionContinuationError(
            'session continuation readback failed; all state was rolled back',
            'ACTOR_ONLY_CONTINUATION_FAILED',
          );
        }

        return {
          success: true,
          predecessorId: sourceId,
          successorId,
          session: formatSession(committedSuccessor),
          predecessorStatus: 'abandoned',
          predecessorAgentId,
          successorAgentId: predecessorAgentId,
          actorId: verifiedActorId,
          actorOnlyContinuation: true,
          durableOwnershipTransferred: false,
          agentNodeId: null,
          agentNodeUpgradeRequired: true,
          notesPreserved: true,
          predecessorNoteId,
          successorNoteId,
          claimsTransferred: activeLegacy.length,
          claimReadback: {
            compatibilityRows: successorLegacy.length,
            forestRows: successorForest.length,
            nodeIds: successorForest.map(claim => claim.node_id).sort(),
          },
          aliasRepair,
        };
      }).immediate();
    } catch (error) {
      if (error instanceof LegacySessionContinuationError || error instanceof LegacyActorContinuityError) {
        return { success: false, code: error.code, error: error.message };
      }
      return {
        success: false,
        code: 'ACTOR_ONLY_CONTINUATION_FAILED',
        error: 'actor-only continuation failed; sessions, notes, aliases, credentials, and claims are unchanged',
      };
    } finally {
      for (const key of keysToWipe) key.fill(0);
    }
  }

  return { continueSameOwner };
}
