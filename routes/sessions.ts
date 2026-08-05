/**
 * Sessions & Notes Routes
 *
 * POST   /sessions                - Start a session
 * GET    /sessions                - List sessions
 * GET    /sessions/:id            - Get session details
 * PUT    /sessions/:id            - End or abandon a session
 * POST   /sessions/:id/continue   - Admit one durable linked successor
 * GET    /sessions/continuations/:receiptId - Collect successor state
 * POST   /sessions/:id/takeover   - Start a successor session without deleting notes
 * DELETE /sessions/:id            - Archive session, preserving notes
 * POST   /sessions/:id/notes      - Add a note to a session (compat alias for /notes)
 * GET    /sessions/:id/notes      - Get notes for a session
 * POST   /sessions/:id/files      - Claim files for a session
 * DELETE /sessions/:id/files      - Release files from a session
 * POST   /notes                   - Quick note (auto-creates session if needed)
 * GET    /notes                   - Recent notes across all sessions
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { checkAdversarialProjectWrite } from '../lib/coordination-route-guard.js';
import {
  evaluateSessionWorktreePolicy,
  mergeSessionWorktreeMetadata,
} from '../lib/worktree-policy.js';
import { coerceClaimType, type ClaimType } from '../lib/symbol-conflict-matrix.js';
import type { SymbolConflict } from '../lib/symbol-claims.js';
import { KNOWN_BACKEND_IDS } from '../lib/backend-catalog.js';
import {
  AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS,
  AgentRunIdempotencyConflictError,
  TERMINAL_AGENT_RUN_STATUSES,
  agentRunStatusForSpawnResult,
  createAgentRunReceiptStore,
  type AgentRunReceipt,
} from '../lib/agent-run-receipts.js';
import type { SpawnAccepted, SpawnSpec, Spawner } from '../lib/spawner.js';
import { captureWorkspaceIdentity } from '../lib/workspace-identity.js';

interface SessionsRouteDeps {
  db?: Database.Database;
  spawner?: Spawner;
  sessions: {
    start(purpose: string, options?: {
      agentId?: string | null;
      files?: string[];
      metadata?: Record<string, unknown> | null;
      worktreeId?: string | null;
      durable?: boolean;
    }): Record<string, unknown>;
    end(sessionId: string, options?: {
      note?: string;
      status?: string;
    }): Record<string, unknown>;
    abandon(sessionId: string): Record<string, unknown>;
    remove(sessionId: string): Record<string, unknown>;
    takeover(sessionId: string, options?: {
      agentId?: string | null;
      purpose?: string | null;
      note?: string | null;
      project?: string | null;
      worktreeId?: string | null;
      metadata?: Record<string, unknown> | null;
      durable?: boolean;
      claimFiles?: boolean;
    }): Record<string, unknown>;
    quickNote(content: string, options?: {
      sessionId?: string | null;
      agentId?: string | null;
      type?: string;
    }): Record<string, unknown>;
    getNotes(sessionId?: string | null, options?: {
      limit?: number;
      type?: string;
      since?: number;
      project?: string | null;
    }): Record<string, unknown>;
    claimFiles(sessionId: string, files: string[], options?: {
      regions?: Array<{ path: string; startLine?: number; endLine?: number; symbol?: string; symbolPath?: string }>;
      force?: boolean;
      agentId?: string | null;
    }): Record<string, unknown>;
    releaseFiles(sessionId: string, files: string[], options?: {
      regions?: Array<{ path: string; startLine?: number; endLine?: number; symbolPath?: string }>;
      agentId?: string | null;
    }): Record<string, unknown>;
    getFileConflicts(files: string[]): Record<string, unknown>;
    setPhase(sessionId: string, phase: string): Record<string, unknown>;
    listAllActiveClaims(options?: { path?: string; symbol?: string; symbolPath?: string; agentId?: string; purpose?: string }): Record<string, unknown>;
    getClaimOwner(filePath: string, range?: { startLine?: number; endLine?: number; symbolPath?: string }): Record<string, unknown>;
    list(options?: {
      status?: string;
      agentId?: string | null;
      project?: string | null;
      purpose?: string | null;
      worktreeId?: string | null;
      allWorktrees?: boolean;
      includeNotes?: boolean;
      limit?: number;
    }): Record<string, unknown>;
    get(sessionId: string): Record<string, unknown>;
    cleanup(options?: {
      olderThan?: number;
      status?: string;
    }): Record<string, unknown>;
  };
  metrics: { errors: number };
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  activityLog: {
    log?(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
  };
  symbolClaims?: {
    claim(
      sessionId: string,
      claims: Array<{ filePath: string; symbolPath: string; type: ClaimType }>,
      options?: { autoDeriveRadius?: boolean; radiusDepth?: number },
    ): { claimed: unknown[]; autoDerived: unknown[]; conflicts: unknown[] };
    list(sessionId: string): unknown[];
    release(sessionId: string): number;
  };
}

type SessionLifecycle = 'durable' | 'ephemeral';

function continuationText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes || normalized.includes('\0')) {
    throw new Error(`${field} exceeds its safe text boundary`);
  }
  return normalized;
}

function optionalContinuationText(value: unknown, field: string, maxBytes: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return continuationText(value, field, maxBytes);
}

function continuationIdentifier(value: unknown, field: string, maxBytes: number): string {
  const normalized = continuationText(value, field, maxBytes);
  if (/[\r\n]/.test(normalized)) throw new Error(`${field} exceeds its safe identifier boundary`);
  return normalized;
}

function optionalContinuationIdentifier(value: unknown, field: string, maxBytes: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return continuationIdentifier(value, field, maxBytes);
}

function continuationReceiptUrl(receipt: AgentRunReceipt): string {
  return `/sessions/continuations/${encodeURIComponent(receipt.id)}`;
}

function continuationSuccessor(receipt: AgentRunReceipt) {
  if (!receipt.successorAgentId || !receipt.successorSessionId || !receipt.transcriptId) return null;
  return {
    agentId: receipt.successorAgentId,
    sessionId: receipt.successorSessionId,
    transcriptId: receipt.transcriptId,
  };
}

function continuationEnvelope(
  receipt: AgentRunReceipt,
  options: {
    replayed?: boolean;
    liveProven?: boolean;
    run?: unknown;
    liveRecord?: {
      pid: number | null;
      heartbeatAt: number;
      lastActivityAt: number;
      deadlineAt: number | null;
    } | null;
  } = {},
) {
  const terminal = TERMINAL_AGENT_RUN_STATUSES.has(receipt.status);
  const outcomeUnknown = receipt.status === 'unknown';
  const successor = continuationSuccessor(receipt);
  const predecessor = receipt.predecessor ?? {
    sessionId: receipt.predecessorSessionId,
    purpose: null,
    status: 'unavailable',
  };
  return {
    success: terminal ? receipt.status === 'completed' : !outcomeUnknown,
    accepted: Boolean(successor),
    replayed: options.replayed === true,
    terminal,
    outcomeUnknown,
    status: receipt.status,
    predecessor: {
      sessionId: predecessor.sessionId,
      purpose: predecessor.purpose ?? null,
      status: predecessor.status ?? null,
    },
    successor,
    session: successor ? { id: successor.sessionId, agentId: successor.agentId } : null,
    receipt,
    monitorUrl: continuationReceiptUrl(receipt),
    cancelUrl: successor ? `/sessions/continuations/${encodeURIComponent(receipt.id)}` : null,
    transcriptUrl: successor ? `/transcripts?agentId=${encodeURIComponent(successor.agentId)}` : null,
    accounting: {
      budgetUsd: receipt.budgetUsd,
      telemetry: receipt.telemetry,
      evidence: receipt.telemetry ? 'backend-reported-and-durable' : 'not-yet-reported',
    },
    liveness: successor ? {
      live: options.liveProven === true,
      evidence: options.liveProven === true
        ? 'pid-and-fresh-supervisor-heartbeat'
        : 'not-proven-live',
      pid: options.liveRecord?.pid ?? null,
      supervisorHeartbeatAt: options.liveRecord?.heartbeatAt ?? null,
      lastActivityAt: options.liveRecord?.lastActivityAt ?? null,
      deadlineAt: options.liveRecord?.deadlineAt ?? null,
    } : null,
    ...(options.run === undefined ? {} : { run: options.run }),
  };
}

function parseSessionLifecycle(value: unknown): SessionLifecycle | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'durable' || normalized === 'ephemeral' ? normalized : null;
}

/**
 * Create sessions routes
 *
 * @param deps - Route dependencies
 * @returns Express router with session routes
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const sessionsPlugin: FastifyPluginAsync<{ deps: SessionsRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { sessions, metrics, logger, activityLog, symbolClaims, db, spawner } = deps;
  // This plugin registers before spawnPlugin and owns the one daemon-start
  // recovery pass for the shared spawn/continuation receipt ledger.
  const continuationReceipts = db && spawner ? createAgentRunReceiptStore(db) : null;
  const continuationAdmissions = new Map<string, Promise<void>>();

  const errorStatus = (result: Record<string, unknown>) => {
    switch (result.code) {
      case 'VALIDATION_ERROR':
        return 400;
      case 'SESSION_AGENT_MISMATCH':
        return 403;
      case 'SESSION_NOT_ACTIVE':
      case 'SESSION_AGENT_REQUIRED':
      case 'AMBIGUOUS_ACTIVE_SESSION':
      case 'NOTES_LIMIT_EXCEEDED':
        return 409;
      case 'SESSION_NOT_FOUND':
      case undefined:
        return 404;
      default:
        return 400;
    }
  };

  const noteWriteStatus = (result: Record<string, unknown>) => {
    switch (result.code) {
      case 'SESSION_NOT_FOUND':
        return 404;
      case 'SESSION_NOT_ACTIVE':
      case 'AMBIGUOUS_ACTIVE_SESSION':
      case 'NOTES_LIMIT_EXCEEDED':
        return 409;
      default:
        return 400;
    }
  };

  const headerAgentId = (request: FastifyRequest): string | null => {
    const value = request.headers['x-agent-id'];
    if (Array.isArray(value)) return typeof value[0] === 'string' && value[0].trim() ? value[0].trim() : null;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  const mutationAgentId = (
    request: FastifyRequest,
    bodyAgentId: unknown,
  ): { success: true; agentId: string | null } | { success: false; result: Record<string, unknown> } => {
    if (bodyAgentId !== undefined && bodyAgentId !== null && typeof bodyAgentId !== 'string') {
      return {
        success: false,
        result: { success: false, error: 'agentId must be a string', code: 'VALIDATION_ERROR' },
      };
    }
    if (typeof bodyAgentId === 'string' && !bodyAgentId.trim()) {
      return {
        success: false,
        result: { success: false, error: 'agentId must be a non-empty string when provided', code: 'VALIDATION_ERROR' },
      };
    }

    const agentId = typeof bodyAgentId === 'string' && bodyAgentId.trim()
      ? bodyAgentId.trim()
      : headerAgentId(request);
    return { success: true, agentId };
  };

  const authorizeFileMutationRoute = (
    sessionId: string,
    agentId: string | null,
    action: 'claiming' | 'releasing',
  ): { success: true } | { success: false; result: Record<string, unknown> } => {
    if (!agentId) {
      return {
        success: false,
        result: {
          success: false,
          error: `agentId is required when ${action} files for a session`,
          code: 'SESSION_AGENT_REQUIRED',
        },
      };
    }

    const lookup = sessions.get(sessionId);
    if (!lookup.success) {
      return {
        success: false,
        result: { ...lookup, code: lookup.code || 'SESSION_NOT_FOUND' },
      };
    }

    const session = lookup.session as { agentId?: unknown; status?: unknown } | undefined;
    const owner = typeof session?.agentId === 'string' ? session.agentId.trim() : '';
    if (!owner) {
      return {
        success: false,
        result: {
          success: false,
          error: `agentId is required before ${action} files for a session`,
          code: 'SESSION_AGENT_REQUIRED',
        },
      };
    }
    if (session?.status !== 'active') {
      return {
        success: false,
        result: {
          success: false,
          error: `session is ${String(session?.status)}; only active sessions can ${action === 'claiming' ? 'claim' : 'release'} files`,
          code: 'SESSION_NOT_ACTIVE',
        },
      };
    }
    if (owner !== agentId) {
      return {
        success: false,
        result: {
          success: false,
          error: `agentId "${agentId}" cannot mutate file claims for session owned by "${owner}"`,
          code: 'SESSION_AGENT_MISMATCH',
        },
      };
    }

    return { success: true };
  };

  const writeNote = (
    request: FastifyRequest,
    reply: FastifyReply,
    routeSessionId: string | null,
  ) => {
    const { content, sessionId: bodySessionId, agentId, type } = request.body as any;

    if (!content || typeof content !== 'string') {
      reply.code(400);
      return {
        success: false,
        error: 'content must be a non-empty string',
        code: 'VALIDATION_ERROR'
      };
    }

    const sessionId = routeSessionId ?? bodySessionId;

    // Adversarial-fleet projects (redteam-review, whitehat-defense) require
    // envelope-encrypted bodies. Look up the session's identity_project to
    // decide; ordinary projects are unaffected. For adversarial writes the
    // daemon persists the envelope JSON, never the plaintext content.
    let writtenContent: string = content;
    if (sessionId) {
      const lookup = sessions.get(sessionId);
      const sess = (lookup as any)?.session as { identity_project?: string | null } | undefined;
      const project = sess?.identity_project ?? null;
      const guard = checkAdversarialProjectWrite(project, request.body);
      if (guard.ok === false) {
        reply.code(guard.code);
        return {
          success: false,
          error: guard.reason,
          code: 'ADVERSARIAL_PROJECT_GUARD',
        };
      }
      if (guard.envelopeRequired && guard.envelope) {
        writtenContent = JSON.stringify(guard.envelope);
      }
    }

    const result = sessions.quickNote(writtenContent, { sessionId, agentId, type });

    if (!result.success) {
      reply.code(noteWriteStatus(result));
      return result;
    }

    logger.info('session_note_added', {
      noteId: result.noteId,
      sessionId: result.sessionId,
      type: type || 'note'
    });

    if (activityLog?.log) {
      activityLog.log('session_note', {
        details: `Note added to session ${result.sessionId}`,
        metadata: { noteId: result.noteId as number, sessionId: result.sessionId as string, type: type || 'note' }
      });
    }

    return result;
  };

  // POST /sessions - Start a session
  fastify.post('/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const {
        purpose,
        agentId,
        files,
        force,
        metadata,
        worktree,
        requireLinkedWorktree,
        allowMainWorktree,
        lifecycle: rawLifecycle,
      } = request.body as any;

      if (!purpose || typeof purpose !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'purpose must be a non-empty string',
          code: 'VALIDATION_ERROR'
        };
      }

      const sessionAgent = mutationAgentId(request, agentId);
      if (!sessionAgent.success) {
        reply.code(400);
        return sessionAgent.result;
      }

      if (files && Array.isArray(files) && files.length > 0 && !sessionAgent.agentId) {
        reply.code(400);
        return {
          success: false,
          error: 'agentId is required to start a session with file claims',
          code: 'SESSION_AGENT_REQUIRED'
        };
      }

      if (files && Array.isArray(files) && files.length > 0 && !force) {
        const conflictCheck = sessions.getFileConflicts(files);
        if (conflictCheck.conflicts && Array.isArray(conflictCheck.conflicts) && conflictCheck.conflicts.length > 0) {
          reply.code(409);
          return {
            success: false,
            error: 'File conflicts detected',
            code: 'FILE_CONFLICT',
            conflicts: conflictCheck.conflicts,
            hint: 'Use force=true to claim files anyway'
          };
        }
      }

      const worktreePolicy = evaluateSessionWorktreePolicy({ worktree, requireLinkedWorktree, allowMainWorktree });
      if (!worktreePolicy.success) {
        reply.code(400);
        return worktreePolicy;
      }

      const lifecycle = rawLifecycle === undefined ? null : parseSessionLifecycle(rawLifecycle);
      if (rawLifecycle !== undefined && !lifecycle) {
        reply.code(400);
        return {
          success: false,
          error: 'lifecycle must be "durable" or "ephemeral" when provided',
          code: 'VALIDATION_ERROR',
        };
      }

      const mergedMetadata = mergeSessionWorktreeMetadata(metadata, worktreePolicy.worktree, {
        requireLinkedWorktree,
        allowMainWorktree,
      });

      const result = sessions.start(purpose, {
        agentId: sessionAgent.agentId,
        files,
        metadata: mergedMetadata,
        worktreeId: worktreePolicy.worktree?.id,
        durable: lifecycle === 'durable',
      });

      if (!result.success) {
        reply.code(400);
        return { ...result, code: result.code || 'VALIDATION_ERROR' };
      }

      logger.info('session_started', {
        sessionId: result.id,
        purpose,
        agentId: sessionAgent.agentId,
        filesCount: files ? files.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('session_start', {
          details: `Started session: ${purpose}`,
          metadata: { sessionId: result.id as string, purpose, agentId: sessionAgent.agentId }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_start_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sessions - List sessions
  fastify.get('/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as any;
      const statusParam = q.status;
      const agentParam = q.agent;
      const projectParam = q.project;
      const purposeParam = q.purpose;
      const worktreeParam = q.worktree;
      const status = typeof statusParam === 'string' ? statusParam : undefined;
      const agentId = typeof agentParam === 'string' ? agentParam : undefined;
      const project = typeof projectParam === 'string' ? projectParam : undefined;
      const purpose = typeof purposeParam === 'string' ? purposeParam : undefined;
      const worktreeId = typeof worktreeParam === 'string' ? worktreeParam : undefined;
      const allWorktrees = q.all === 'true' || q.allWorktrees === 'true';
      const includeNotes = q.notes === 'true';
      const limitParam = q.limit;
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 50;

      const result = sessions.list({ status, agentId, project, purpose, worktreeId, allWorktrees, includeNotes, limit });

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_list_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sessions/:id - Get session details + notes + files
  fastify.get('/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      const result = sessions.get(sessionId);

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_get_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // PUT /sessions/:id - End or abandon a session
  fastify.put('/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { status, note } = request.body as any;

      let result: Record<string, unknown>;

      if (status === 'abandoned') {
        result = sessions.abandon(sessionId);
      } else {
        result = sessions.end(sessionId, { note, status });
      }

      // Symbol claims release with the session (advisory reservations are session-scoped).
      if (result.success && symbolClaims) {
        try { symbolClaims.release(sessionId); } catch { /* best-effort */ }
      }

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      logger.info('session_ended', {
        sessionId,
        status: result.status,
        releasedFiles: Array.isArray(result.releasedFiles) ? result.releasedFiles.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('session_end', {
          details: `Ended session: ${sessionId} (${result.status})`,
          metadata: { sessionId, status: result.status as string }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_end_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sessions/:id/continue — Admit exactly one durable, runnable successor.
  // The predecessor is read-only. A 202 is not emitted until the spawner has
  // durably opened BOTH the successor transcript and coordination session.
  fastify.post('/sessions/:id/continue', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!continuationReceipts || !spawner) {
      reply.code(503);
      return { success: false, error: 'session continuation runtime unavailable', code: 'RUNTIME_UNAVAILABLE' };
    }

    try {
      const predecessorId = String((request.params as { id?: string }).id ?? '').trim();
      const predecessorResult = sessions.get(predecessorId) as {
        success?: boolean;
        session?: Record<string, unknown>;
        error?: string;
      };
      if (!predecessorResult.success || !predecessorResult.session) {
        reply.code(404);
        return { success: false, error: 'predecessor session not found', code: 'SESSION_NOT_FOUND' };
      }
      const predecessor = predecessorResult.session;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const purpose = continuationText(body.purpose, 'purpose', 16 * 1024);
      const note = optionalContinuationText(body.note, 'note', 16 * 1024) ?? purpose;
      const backend = continuationIdentifier(body.backend, 'backend', 128);
      if (!KNOWN_BACKEND_IDS.has(backend)) {
        reply.code(400);
        return {
          success: false,
          error: `unknown continuation backend: ${backend}`,
          code: 'VALIDATION_ERROR',
        };
      }
      const model = optionalContinuationIdentifier(body.model, 'model', 512);
      const idempotencyKey = continuationIdentifier(body.idempotencyKey, 'idempotencyKey', 512);
      const worktree = body.worktree && typeof body.worktree === 'object' && !Array.isArray(body.worktree)
        ? body.worktree as Record<string, unknown>
        : null;
      const requestedWorkdir = optionalContinuationText(
        body.workdir ?? worktree?.root,
        'workdir',
        32 * 1024,
      );
      if (!requestedWorkdir) {
        reply.code(400);
        return { success: false, error: 'workdir is required', code: 'VALIDATION_ERROR' };
      }
      const workspaceIdentity = captureWorkspaceIdentity(requestedWorkdir);
      if (!workspaceIdentity) {
        reply.code(400);
        return {
          success: false,
          error: 'workdir must resolve to a current user-owned absolute directory',
          code: 'VALIDATION_ERROR',
        };
      }

      let timeout: number | undefined;
      if (body.timeoutMs !== undefined) {
        if (typeof body.timeoutMs !== 'number'
          || !Number.isInteger(body.timeoutMs)
          || body.timeoutMs < 1_000
          || body.timeoutMs > 6 * 60 * 60 * 1_000) {
          reply.code(400);
          return {
            success: false,
            error: 'timeoutMs must be an explicit integer from 1000 to 21600000; omit it for no task deadline',
            code: 'VALIDATION_ERROR',
          };
        }
        timeout = body.timeoutMs;
      }
      let budgetUsd: number | undefined;
      if (body.budgetUsd !== undefined) {
        if (typeof body.budgetUsd !== 'number' || !Number.isFinite(body.budgetUsd) || body.budgetUsd <= 0) {
          reply.code(400);
          return { success: false, error: 'budgetUsd must be a positive number', code: 'VALIDATION_ERROR' };
        }
        budgetUsd = body.budgetUsd;
      }

      const predecessorProject = typeof predecessor.identityProject === 'string'
        ? predecessor.identityProject.trim()
        : '';
      const requestedProject = optionalContinuationIdentifier(body.project, 'project', 512) ?? predecessorProject;
      const identity = optionalContinuationIdentifier(body.identity, 'identity', 512)
        ?? (requestedProject ? `${requestedProject}:continuation` : undefined);
      const requestMetadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata as Record<string, unknown>
        : null;
      const requestedBy = typeof requestMetadata?.source === 'string'
        ? requestMetadata.source.replace(/[\r\n\0]/g, '').slice(0, 128)
        : 'port-daddy';
      const requestFingerprint = {
        predecessorId,
        purpose,
        note,
        backend,
        model: model ?? null,
        identity: identity ?? null,
        workdir: workspaceIdentity.canonicalPath,
        workspaceIdentity,
        timeoutMs: timeout ?? null,
        budgetUsd: budgetUsd ?? null,
        requestedBy,
      };

      let admission;
      try {
        admission = continuationReceipts.accept({
          idempotencyKey,
          kind: 'session-continuation',
          request: requestFingerprint,
          predecessorSessionId: predecessorId,
          predecessor: {
            sessionId: predecessorId,
            purpose: typeof predecessor.purpose === 'string' ? predecessor.purpose : null,
            status: typeof predecessor.status === 'string' ? predecessor.status : null,
          },
          budgetUsd: budgetUsd ?? null,
        });
      } catch (error) {
        if (error instanceof AgentRunIdempotencyConflictError) {
          reply.code(409);
          return {
            success: false,
            error: error.message,
            code: 'IDEMPOTENCY_CONFLICT',
            receiptId: error.receiptId,
          };
        }
        throw error;
      }

      let receipt = admission.receipt;
      if (admission.replayed) {
        if (!continuationSuccessor(receipt) && receipt.status === 'accepted') {
          const admissionSettled = continuationAdmissions.get(receipt.id);
          if (!admissionSettled) {
            reply.code(503);
            reply.header('Retry-After', '1');
            return {
              success: false,
              accepted: false,
              replayed: true,
              code: 'ADMISSION_INDETERMINATE',
              error: 'The owning admission is not observable yet; retry the stable receipt.',
              receipt,
              monitorUrl: continuationReceiptUrl(receipt),
            };
          }
          await admissionSettled;
          receipt = continuationReceipts.get(receipt.id) ?? receipt;
        }
        const response = continuationEnvelope(receipt, { replayed: true });
        const pending = !response.terminal && !response.outcomeUnknown;
        reply.code(pending ? 202 : 200);
        reply.header('Location', response.monitorUrl);
        if (pending) reply.header('Retry-After', '1');
        return response;
      }

      let settleAdmission: (() => void) | null = null;
      const admissionSettled = new Promise<void>((resolve) => { settleAdmission = resolve; });
      continuationAdmissions.set(receipt.id, admissionSettled);
      const settleOwnedAdmission = () => {
        settleAdmission?.();
        settleAdmission = null;
        continuationAdmissions.delete(receipt.id);
      };

      const spec: SpawnSpec = {
        backend: backend as SpawnSpec['backend'],
        ...(model ? { model } : {}),
        ...(identity ? { identity } : {}),
        ...(timeout ? { timeout } : {}),
        ...(budgetUsd ? { budgetUsd } : {}),
        task: note,
        purpose,
        workdir: workspaceIdentity.canonicalPath,
        workspaceIdentity,
        coordinationLifecycle: 'durable',
        systemPrompt:
          `You are the linked successor to Port Daddy session ${predecessorId}. `
          + 'The predecessor transcript and evidence are immutable. Continue the stated direction in this isolated workspace, '
          + 'leave durable Port Daddy notes, and report completion through the successor session.',
        coordinationMetadata: {
          continuation: {
            schema: 'pd.session-continuation.v1',
            predecessorSessionId: predecessorId,
            receiptId: receipt.id,
            requestedBy,
          },
        },
      };

      let acceptRun: ((accepted: SpawnAccepted) => void) | null = null;
      const accepted = new Promise<SpawnAccepted>((resolve) => { acceptRun = resolve; });
      const run = spawner.spawn(spec, (successor) => {
        receipt = continuationReceipts.markStarting(receipt.id, {
          successorAgentId: successor.agentId,
          successorSessionId: successor.sessionId,
          transcriptId: successor.transcriptId,
        });
        settleOwnedAdmission();
        acceptRun?.(successor);
      });
      const trackedRun = run.then((result) => {
        receipt = continuationReceipts.markStatus(
          receipt.id,
          agentRunStatusForSpawnResult(result),
          { error: result.error, telemetry: result.telemetry },
        );
        settleOwnedAdmission();
        return result;
      }).catch((error) => {
        receipt = continuationReceipts.markStatus(receipt.id, 'failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        settleOwnedAdmission();
        throw error;
      });

      const first = await Promise.race([
        accepted.then((successor) => ({ kind: 'accepted' as const, successor })),
        trackedRun.then((result) => ({ kind: 'completed' as const, result })),
      ]);
      if (first.kind === 'accepted') {
        void trackedRun.catch((error) => {
          metrics.errors++;
          logger.error('session_continuation_run_error', {
            predecessorId,
            receiptId: receipt.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        const response = continuationEnvelope(receipt);
        reply.code(202);
        reply.header('Location', response.monitorUrl);
        reply.header('Retry-After', '1');
        logger.info('session_continuation_accepted', {
          predecessorId,
          successorSessionId: first.successor.sessionId,
          successorAgentId: first.successor.agentId,
          receiptId: receipt.id,
        });
        return response;
      }

      logger.info('session_continuation_not_admitted', {
        predecessorId,
        receiptId: receipt.id,
        status: receipt.status,
        error: first.result.error,
      });
      return continuationEnvelope(receipt, { run: first.result });
    } catch (error) {
      if (error instanceof Error && /(is required|safe (?:text|identifier) boundary)/.test(error.message)) {
        reply.code(400);
        return { success: false, error: error.message, code: 'VALIDATION_ERROR' };
      }
      metrics.errors++;
      logger.error('session_continuation_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  // GET /sessions/continuations/:receiptId — Stable collection across HTTP
  // disconnects and daemon restarts. Transcript presence alone never proves
  // liveness; only a direct PID plus a fresh supervisor heartbeat does.
  fastify.get('/sessions/continuations/:receiptId', async (request, reply) => {
    if (!continuationReceipts || !spawner) {
      reply.code(503);
      return { success: false, error: 'session continuation runtime unavailable', code: 'RUNTIME_UNAVAILABLE' };
    }
    try {
      const receiptId = String((request.params as { receiptId?: string }).receiptId ?? '');
      let receipt = continuationReceipts.get(receiptId);
      if (!receipt || receipt.kind !== 'session-continuation' || !receipt.predecessorSessionId) {
        reply.code(404);
        return { success: false, error: 'session continuation receipt not found', code: 'RECEIPT_NOT_FOUND' };
      }
      const agentId = receipt.successorAgentId;
      const liveRecord = agentId
        ? spawner.list().find((candidate) => candidate.agentId === agentId) ?? null
        : null;
      const observedAt = Date.now();
      const hasLiveEvidence = Boolean(
        liveRecord?.status === 'running'
        &&
        liveRecord?.pid
        && liveRecord.pid > 0
        && observedAt - liveRecord.heartbeatAt >= 0
        && observedAt - liveRecord.heartbeatAt < AGENT_RUN_LIVE_EVIDENCE_MAX_AGE_MS,
      );
      const run = agentId ? spawner.get(agentId) : null;
      if (run && !['running', 'unknown'].includes(run.status)) {
        receipt = continuationReceipts.markStatus(receipt.id, agentRunStatusForSpawnResult(run), {
          error: run.error,
          telemetry: run.telemetry,
        });
      } else if (hasLiveEvidence && !TERMINAL_AGENT_RUN_STATUSES.has(receipt.status)) {
        receipt = continuationReceipts.markStatus(receipt.id, 'live', {
          liveEvidence: {
            pid: liveRecord!.pid!,
            supervisorHeartbeatAt: liveRecord!.heartbeatAt,
          },
        });
      } else if (run?.status === 'unknown') {
        receipt = continuationReceipts.markStatus(receipt.id, 'unknown', { error: run.error });
      } else if (receipt.status === 'live' && !hasLiveEvidence) {
        receipt = continuationReceipts.markStatus(receipt.id, 'unknown', {
          error: 'The successor was previously live, but current PID and heartbeat evidence are unavailable.',
        });
      } else if (receipt.status === 'starting' && receipt.successorAgentId && !liveRecord && !run) {
        receipt = continuationReceipts.markStatus(receipt.id, 'unknown', {
          error: 'The successor was admitted, but its owning runtime is no longer observable.',
        });
      }
      const liveProven = receipt.status === 'live' && hasLiveEvidence;
      const response = continuationEnvelope(receipt, { liveProven, liveRecord, run });
      if (!response.terminal && !response.outcomeUnknown) reply.header('Retry-After', '1');
      return response;
    } catch (error) {
      metrics.errors++;
      logger.error('session_continuation_receipt_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.delete('/sessions/continuations/:receiptId', async (request, reply) => {
    if (!continuationReceipts || !spawner) {
      reply.code(503);
      return { success: false, error: 'session continuation runtime unavailable', code: 'RUNTIME_UNAVAILABLE' };
    }
    const receiptId = String((request.params as { receiptId?: string }).receiptId ?? '');
    const receipt = continuationReceipts.get(receiptId);
    if (!receipt || receipt.kind !== 'session-continuation' || !receipt.predecessorSessionId) {
      reply.code(404);
      return { success: false, error: 'session continuation receipt not found', code: 'RECEIPT_NOT_FOUND' };
    }
    if (receipt.successorAgentId && !TERMINAL_AGENT_RUN_STATUSES.has(receipt.status)) {
      spawner.cancel(receipt.successorAgentId);
    }
    const cancelled = TERMINAL_AGENT_RUN_STATUSES.has(receipt.status)
      ? receipt
      : continuationReceipts.markStatus(receipt.id, 'cancelled', { error: 'Cancelled by operator.' });
    return continuationEnvelope(cancelled);
  });

  // POST /sessions/:id/takeover - Non-destructively continue an existing session
  fastify.post('/sessions/:id/takeover', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const body = (request.body || {}) as any;
      const sessionAgent = mutationAgentId(request, body.agentId);
      if (!sessionAgent.success) {
        reply.code(400);
        return sessionAgent.result;
      }
      const lifecycle = parseSessionLifecycle(body.lifecycle);
      const worktreePolicy = evaluateSessionWorktreePolicy({
        worktree: body.worktree,
        requireLinkedWorktree: body.requireLinkedWorktree,
        allowMainWorktree: body.allowMainWorktree,
      });
      if (!worktreePolicy.success) {
        reply.code(400);
        return worktreePolicy;
      }
      const metadata = mergeSessionWorktreeMetadata(
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : null,
        worktreePolicy.worktree,
        {
          requireLinkedWorktree: body.requireLinkedWorktree,
          allowMainWorktree: body.allowMainWorktree,
        },
      );

      const result = sessions.takeover(sessionId, {
        agentId: sessionAgent.agentId,
        purpose: typeof body.purpose === 'string' ? body.purpose : null,
        note: typeof body.note === 'string' ? body.note : null,
        project: typeof body.project === 'string' ? body.project : null,
        worktreeId: typeof body.worktreeId === 'string' ? body.worktreeId : worktreePolicy.worktree?.id ?? null,
        metadata,
        durable: lifecycle ? lifecycle === 'durable' : typeof body.durable === 'boolean' ? body.durable : undefined,
        claimFiles: typeof body.claimFiles === 'boolean' ? body.claimFiles : undefined,
      });

      if (!result.success) {
        const statusCode = result.code === 'VALIDATION_ERROR' ? 400 : 404;
        reply.code(statusCode);
        return result;
      }

      logger.info('session_taken_over', {
        predecessorId: result.predecessorId,
        successorId: result.successorId,
        claimsTransferred: result.claimsTransferred,
      });

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_takeover_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // PUT /sessions/:id/phase - Set session phase
  fastify.put('/sessions/:id/phase', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { phase } = request.body as any;

      if (!phase || typeof phase !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'phase must be a non-empty string',
          code: 'VALIDATION_ERROR'
        };
      }

      const result = sessions.setPhase(sessionId, phase);

      if (!result.success) {
        const statusCode = result.error === 'session not found'
          ? 404
          : result.code === 'SESSION_NOT_ACTIVE'
            ? 409
            : 400;
        reply.code(statusCode);
        return { ...result, code: result.code || 'SESSION_NOT_FOUND' };
      }

      logger.info('session_phase_set', {
        sessionId,
        phase: result.phase,
        previousPhase: result.previousPhase
      });

      if (activityLog?.log) {
        activityLog.log('session_phase', {
          details: `Session ${sessionId} phase: ${result.previousPhase} → ${result.phase}`,
          metadata: { sessionId, phase: result.phase as string, previousPhase: result.previousPhase as string }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_phase_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /sessions/:id - Archive session and preserve notes
  fastify.delete('/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      const result = sessions.remove(sessionId);

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      logger.info('session_archived', { sessionId, notesPreserved: result.notesPreserved });

      return {
        ...result,
        message: `Session "${sessionId}" archived; notes preserved`
      };

    } catch (error) {
      metrics.errors++;
      logger.error('session_delete_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sessions/:id/notes - Compatibility alias for the canonical /notes write path
  fastify.post('/sessions/:id/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      return writeNote(request, reply, sessionId);

    } catch (error) {
      metrics.errors++;
      logger.error('session_note_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /sessions/:id/notes - Get notes for a session
  fastify.get('/sessions/:id/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const q = request.query as any;
      const typeParam = q.type;
      const limitParam = q.limit;
      const sinceParam = q.since;
      const projectParam = q.project;

      const type = typeof typeParam === 'string' ? typeParam : undefined;
      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 100;
      const since = typeof sinceParam === 'string' ? parseInt(sinceParam, 10) : undefined;
      const project = typeof projectParam === 'string' && projectParam.trim() ? projectParam.trim() : undefined;

      const result = sessions.getNotes(sessionId, { type, limit, since, project });

      if (!result.success) {
        reply.code(404);
        return { ...result, code: 'SESSION_NOT_FOUND' };
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_notes_get_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sessions/:id/files - Claim files for a session
  fastify.post('/sessions/:id/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const { files, regions, force, agentId } = request.body as any;

      const hasFiles = files && Array.isArray(files) && files.length > 0;
      const hasRegions = regions && Array.isArray(regions) && regions.length > 0;

      if (!hasFiles && !hasRegions) {
        reply.code(400);
        return {
          success: false,
          error: 'files or regions must be provided',
          code: 'VALIDATION_ERROR'
        };
      }

      if (hasRegions) {
        for (const region of regions) {
          if (!region.path || typeof region.path !== 'string') {
            reply.code(400);
            return {
              success: false,
              error: 'each region must have a non-empty path',
              code: 'VALIDATION_ERROR'
            };
          }
          if (region.startLine !== undefined && (typeof region.startLine !== 'number' || region.startLine < 1)) {
            reply.code(400);
            return {
              success: false,
              error: 'startLine must be a positive integer (1-indexed)',
              code: 'VALIDATION_ERROR'
            };
          }
          if (region.endLine !== undefined && region.startLine !== undefined && region.endLine < region.startLine) {
            reply.code(400);
            return {
              success: false,
              error: 'endLine must be >= startLine',
              code: 'VALIDATION_ERROR'
            };
          }
          if (region.symbolPath !== undefined && (typeof region.symbolPath !== 'string' || !region.symbolPath.trim())) {
            reply.code(400);
            return {
              success: false,
              error: 'symbolPath must be a non-empty string when provided',
              code: 'VALIDATION_ERROR'
            };
          }
        }
      }

      const requestAgent = mutationAgentId(request, agentId);
      if (!requestAgent.success) {
        reply.code(400);
        return requestAgent.result;
      }

      const routeAuth = authorizeFileMutationRoute(sessionId, requestAgent.agentId, 'claiming');
      if (!routeAuth.success) {
        reply.code(errorStatus(routeAuth.result));
        return routeAuth.result;
      }

      if (hasFiles && !force) {
        const conflictCheck = sessions.getFileConflicts(files);
        if (conflictCheck.conflicts && Array.isArray(conflictCheck.conflicts) && conflictCheck.conflicts.length > 0) {
          reply.code(409);
          return {
            success: false,
            error: 'File conflicts detected',
            code: 'FILE_CONFLICT',
            conflicts: conflictCheck.conflicts,
            hint: 'Use force=true to claim files anyway'
          };
        }
      }

      const result = sessions.claimFiles(sessionId, files || [], { regions, force, agentId: requestAgent.agentId });

      if (!result.success) {
        reply.code(errorStatus(result));
        return { ...result, code: result.code || 'SESSION_NOT_FOUND' };
      }

      logger.info('session_files_claimed', {
        sessionId,
        filesCount: Array.isArray(result.claimed) ? result.claimed.length : 0,
        regionsCount: hasRegions ? regions.length : 0,
        conflictsCount: Array.isArray(result.conflicts) ? result.conflicts.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('file_claim', {
          details: `Claimed ${Array.isArray(result.claimed) ? result.claimed.length : 0} files for session ${sessionId}`,
          metadata: { sessionId, filesCount: Array.isArray(result.claimed) ? result.claimed.length : 0 }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_files_claim_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /sessions/:id/symbols — declare symbol-level claims; a `modify` auto-reserves
  // its blast radius (read-claims on every downstream caller). Pre-flight validator (ast-a2-1)
  // rejects blocking conflicts. Returns predicted conflicts with other active sessions.
  fastify.post('/sessions/:id/symbols', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!symbolClaims) {
      reply.code(501);
      return { success: false, error: 'symbol claims not available' };
    }
    const sessionIdParam = (request.params as any).id;
    const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
    const body = (request.body ?? {}) as { claims?: unknown; autoDeriveRadius?: boolean; radiusDepth?: number };
    const raw = Array.isArray(body.claims) ? body.claims : [];
    const claims: Array<{ filePath: string; symbolPath: string; type: ClaimType }> = [];
    for (const c of raw as any[]) {
      if (!c || typeof c.filePath !== 'string' || typeof c.symbolPath !== 'string') {
        reply.code(400);
        return { success: false, error: 'each claim needs filePath and symbolPath', code: 'VALIDATION_ERROR' };
      }
      // read | modify | add-sibling | add-child | delete | rename (unknown → modify)
      claims.push({ filePath: c.filePath, symbolPath: c.symbolPath, type: coerceClaimType(c.type) });
    }
    if (!claims.length) {
      reply.code(400);
      return { success: false, error: 'claims must be a non-empty array', code: 'VALIDATION_ERROR' };
    }
    try {
      const result = symbolClaims.claim(sessionId, claims, {
        autoDeriveRadius: body.autoDeriveRadius,
        radiusDepth: typeof body.radiusDepth === 'number' ? body.radiusDepth : undefined,
      });

      // ast-a2-1: Claim validator pre-flight — reject blocking conflicts.
      // A blocking conflict means the symbol is already held in a way that makes
      // concurrent modification unsafe (e.g., two sessions modifying the same symbol
      // or one modifying a function another is calling). This gate makes symbol
      // conflicts predictable for the wedge rendering.
      const blockingConflicts = (result.conflicts as SymbolConflict[]).filter(c => c.severity === 'blocking');
      if (blockingConflicts.length > 0) {
        reply.code(409);
        return {
          success: false,
          error: 'symbol claim rejected: blocking conflict(s) with active session(s)',
          code: 'BLOCKING_CONFLICT',
          conflicts: blockingConflicts,
        };
      }

      return { success: true, ...result };
    } catch (error) {
      metrics.errors++;
      logger.error('session_symbol_claim_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: (error as Error).message };
    }
  });

  // GET /sessions/:id/symbols — list a session's active symbol claims.
  fastify.get('/sessions/:id/symbols', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!symbolClaims) {
      reply.code(501);
      return { success: false, error: 'symbol claims not available' };
    }
    const sessionIdParam = (request.params as any).id;
    const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
    const items = symbolClaims.list(sessionId);
    return { success: true, claims: items, count: items.length };
  });

  // DELETE /sessions/:id/files - Release files from a session
  fastify.delete('/sessions/:id/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];

      let files: string[] = [];
      let regions: Array<{ path: string; startLine?: number; endLine?: number; symbolPath?: string }> | undefined;
      const { agentId } = (request.body as any) || {};

      const pathsParam = (request.query as any).paths;
      if (pathsParam && typeof pathsParam === 'string') {
        files = pathsParam.split(',');
      } else if ((request.body as any)?.files && Array.isArray((request.body as any).files)) {
        files = (request.body as any).files;
      }

      if ((request.body as any)?.regions && Array.isArray((request.body as any).regions)) {
        regions = (request.body as any).regions;
      }

      if (files.length === 0 && (!regions || regions.length === 0)) {
        reply.code(400);
        return {
          success: false,
          error: 'files or regions must be provided via query param ?paths=file1,file2 or body { files: [], regions: [] }',
          code: 'VALIDATION_ERROR'
        };
      }

      const requestAgent = mutationAgentId(request, agentId);
      if (!requestAgent.success) {
        reply.code(400);
        return requestAgent.result;
      }

      const routeAuth = authorizeFileMutationRoute(sessionId, requestAgent.agentId, 'releasing');
      if (!routeAuth.success) {
        reply.code(errorStatus(routeAuth.result));
        return routeAuth.result;
      }

      const result = sessions.releaseFiles(sessionId, files, { regions, agentId: requestAgent.agentId });

      if (!result.success) {
        reply.code(errorStatus(result));
        return { ...result, code: result.code || 'SESSION_NOT_FOUND' };
      }

      logger.info('session_files_released', {
        sessionId,
        filesCount: Array.isArray(result.released) ? result.released.length : 0
      });

      if (activityLog?.log) {
        activityLog.log('file_release', {
          details: `Released ${Array.isArray(result.released) ? result.released.length : 0} files from session ${sessionId}`,
          metadata: { sessionId, filesCount: Array.isArray(result.released) ? result.released.length : 0 }
        });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('session_files_release_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // POST /notes - Canonical note write path
  fastify.post('/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return writeNote(request, reply, null);

    } catch (error) {
      metrics.errors++;
      logger.error('quick_note_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /files - List all active file claims across all sessions
  fastify.get('/files', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { path, symbol, symbolPath, agent, purpose } = request.query as any;
      const result = sessions.listAllActiveClaims({
        path: typeof path === 'string' ? path : undefined,
        symbol: typeof symbol === 'string' ? symbol : undefined,
        symbolPath: typeof symbolPath === 'string' ? symbolPath : undefined,
        agentId: typeof agent === 'string' ? agent : undefined,
        purpose: typeof purpose === 'string' ? purpose : undefined
      });
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('files_list_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /files/who-owns - Check who owns a specific file
  fastify.get('/files/who-owns', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const pathParam = (request.query as any).path;
      if (!pathParam || typeof pathParam !== 'string') {
        reply.code(400);
        return {
          success: false,
          error: 'path query parameter is required',
          code: 'VALIDATION_ERROR'
        };
      }

      const startLineParam = (request.query as any).startLine;
      const endLineParam = (request.query as any).endLine;
      const symbolPathParam = (request.query as any).symbolPath;
      let range: { startLine?: number; endLine?: number; symbolPath?: string } | undefined;
      if (typeof startLineParam === 'string' && typeof endLineParam === 'string') {
        range = {
          startLine: parseInt(startLineParam, 10),
          endLine: parseInt(endLineParam, 10),
        };
      }
      if (typeof symbolPathParam === 'string' && symbolPathParam.trim()) {
        range = {
          ...(range || {}),
          symbolPath: symbolPathParam,
        };
      }

      const result = sessions.getClaimOwner(pathParam, range);
      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('files_who_owns_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /notes - Recent notes across all sessions
  fastify.get('/notes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = request.query as any;
      const limitParam = q.limit;
      const typeParam = q.type;
      const sinceParam = q.since;
      const projectParam = q.project;

      const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 50;
      const type = typeof typeParam === 'string' ? typeParam : undefined;
      const since = typeof sinceParam === 'string' ? parseInt(sinceParam, 10) : undefined;
      const project = typeof projectParam === 'string' && projectParam.trim() ? projectParam.trim() : undefined;

      const result = sessions.getNotes(null, { limit, type, since, project });

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('notes_get_error', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
