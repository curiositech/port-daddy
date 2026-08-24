/**
 * Sessions & Notes Routes
 *
 * POST   /sessions                - Start a session
 * GET    /sessions                - List sessions
 * GET    /sessions/:id            - Get session details
 * PUT    /sessions/:id            - End or abandon a session
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
import { createHash } from 'node:crypto';
import { checkAdversarialProjectWrite } from '../lib/coordination-route-guard.js';
import {
  evaluateSessionWorktreePolicy,
  mergeSessionWorktreeMetadata,
} from '../lib/worktree-policy.js';
import { coerceClaimType, type ClaimType } from '../lib/symbol-conflict-matrix.js';
import type { SymbolConflict } from '../lib/symbol-claims.js';
import type { Suggestions } from '../lib/suggestions.js';
import {
  surfaceSymbolConflictAdvice,
  type BrokerActivityLog,
  type BrokerInbox,
} from '../lib/suggestion-broker.js';
import {
  extractActorCredential,
  resolveWriteIdentity,
  stampIdentityMetadata,
  type IdentityVerifier,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';
import {
  conflictSignalId,
  CONFLICT_SIGNAL_LIMITS,
  CONFLICT_SIGNAL_PRODUCERS,
  CONFLICT_SIGNAL_SCHEMA_VERSION,
  type ConflictSignal,
} from '../lib/parley-trigger.js';
import type { ParleyAutoTriggerResult } from '../lib/parley-auto-trigger.js';

interface SessionsRouteDeps {
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
  activityLog: BrokerActivityLog;
  suggestions?: Suggestions;
  agentInbox?: BrokerInbox;
  symbolClaims?: {
    claim(
      sessionId: string,
      claims: Array<{ filePath: string; symbolPath: string; type: ClaimType }>,
      options?: { autoDeriveRadius?: boolean; radiusDepth?: number },
    ): { claimed: unknown[]; autoDerived: unknown[]; conflicts: unknown[] };
    list(sessionId: string): unknown[];
    release(sessionId: string): number;
  };
  /**
   * ADR-0040 souls store (subset). Session/note/file-claim writes REQUIRE the
   * daemon-minted credential (#8877 / ADR-0122 slice 1): a self-asserted
   * agentId without a credential is rejected 401, a presented credential must
   * verify (401 otherwise), and a verified credential cannot write under
   * another soul's name (403). Anonymous writes (no identity claim at all)
   * remain possible only where the route accepts unattributed writes.
   */
  actorSouls?: (IdentityVerifier & {
    constants?: { defaultHarbor?: string };
  }) | null;
  /**
   * Explicit G2/C1 injection boundary. Production server wiring remains absent
   * until the U0 authenticated actions, U1 operator surface, and Q1 gates pass.
   */
  parleyAutoTrigger?: {
    evaluate(signal: ConflictSignal, context: { harbor: string }): ParleyAutoTriggerResult;
  } | null;
}

type SessionLifecycle = 'durable' | 'ephemeral';

/**
 * Parse the explicit lifecycle vocabulary accepted by session mutations. The design
 * keeps validation centralized so unknown values never silently become ephemeral.
 *
 * @param value - Untrusted request or CLI lifecycle value.
 * @returns Normalized lifecycle, or null when the value is not supported.
 */
function parseSessionLifecycle(value: unknown): SessionLifecycle | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'durable' || normalized === 'ephemeral' ? normalized : null;
}

/**
 * Create the sessions routes. The design keeps lifecycle, identity, claims, notes,
 * and their new durable advice projection behind one Fastify plugin so every caller
 * observes the same authoritative session mutation boundaries.
 *
 * @param fastify - Fastify instance receiving the route registrations.
 * @param opts - Injected sessions and coordination dependencies.
 * @returns Promise resolved after the route surface is registered.
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const sessionsPlugin: FastifyPluginAsync<{ deps: SessionsRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const {
    sessions,
    metrics,
    logger,
    activityLog,
    symbolClaims,
    actorSouls,
    suggestions,
    agentInbox,
    parleyAutoTrigger,
  } = deps;

  interface ClaimConflictRecord {
    filePath: string;
    sessionId: string;
    claimedAt: number;
    startLine?: number | null;
    endLine?: number | null;
    symbolPath?: string | null;
  }

  function canonicalActorForSession(sessionId: string): string | null {
    const result = sessions.get(sessionId) as {
      success?: boolean;
      session?: { status?: unknown; agentId?: unknown };
    };
    const session = result.session;
    if (!result.success || session?.status !== 'active' || typeof session.agentId !== 'string') return null;
    const storedAgentId = session.agentId.trim();
    if (!storedAgentId || !actorSouls) return null;
    const resolved = actorSouls.resolveActor(storedAgentId);
    return resolved.soulClass === 'unknown' ? null : resolved.actorId;
  }

  function hasActiveCanonicalActor(actorId: string): boolean {
    const active = sessions.list({ status: 'active', allWorktrees: true, limit: 1000 }) as {
      sessions?: Array<{ agentId?: unknown }>;
    };
    return (active.sessions ?? []).some((session) => {
      if (typeof session.agentId !== 'string' || !actorSouls) return false;
      const resolved = actorSouls.resolveActor(session.agentId.trim());
      return resolved.soulClass !== 'unknown' && resolved.actorId === actorId;
    });
  }

  function claimAddress(conflict: ClaimConflictRecord): string | null {
    if (typeof conflict.filePath !== 'string' || !conflict.filePath.trim()) return null;
    const filePath = conflict.filePath.trim();
    if (typeof conflict.symbolPath === 'string' && conflict.symbolPath.trim()) {
      return `${filePath}#${conflict.symbolPath.trim()}`;
    }
    if (Number.isInteger(conflict.startLine) || Number.isInteger(conflict.endLine)) {
      return `${filePath}#L${conflict.startLine ?? '*'}-${conflict.endLine ?? '*'}`;
    }
    return filePath;
  }

  function buildClaimConflictSignal(
    requesterActorId: string,
    rawConflicts: unknown[],
  ): ConflictSignal | null {
    if (rawConflicts.length === 0
      || rawConflicts.length > CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs) return null;
    const observations = rawConflicts.map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const conflict = raw as ClaimConflictRecord;
      const address = claimAddress(conflict);
      const party = typeof conflict.sessionId === 'string'
        ? canonicalActorForSession(conflict.sessionId)
        : null;
      if (!address || !party || !Number.isSafeInteger(conflict.claimedAt) || conflict.claimedAt <= 0) {
        return null;
      }
      return {
        address,
        party,
        evidenceRef: `session-claim:${conflict.sessionId}:${address}:${conflict.claimedAt}`,
      };
    });
    if (observations.length === 0 || observations.some((value) => value === null)) return null;
    const complete = observations as Array<{ address: string; party: string; evidenceRef: string }>;
    const parties = [...new Set([requesterActorId, ...complete.map((item) => item.party)])].sort();
    const evidenceRefs = [...new Set(complete.map((item) => item.evidenceRef.trim()))].sort();
    const addresses = [...new Set(complete.map((item) => item.address))].sort();
    if (parties.length < 2 || evidenceRefs.length === 0 || addresses.length === 0) return null;
    const surface = addresses.length === 1
      ? `file-claim:${addresses[0]}`
      : `file-claim-set:${createHash('sha256').update(JSON.stringify(addresses)).digest('hex')}`;
    const checkpoint = 'claim' as const;
    const kind = 'claim_overlap' as const;
    return {
      schemaVersion: CONFLICT_SIGNAL_SCHEMA_VERSION,
      signalId: conflictSignalId({ checkpoint, kind, surface, parties, evidenceRefs }),
      kind,
      checkpoint,
      shape: 'contract-net',
      parties,
      surface,
      magnitude: evidenceRefs.length,
      confidence: 0.95,
      reason: `${evidenceRefs.length} verified live file claim overlap(s)`,
      evidenceRefs,
      provenance: {
        producer: CONFLICT_SIGNAL_PRODUCERS.claimConflict,
        trustTier: 'INTERNAL',
        producedAt: Date.now(),
      },
    };
  }

  function evaluateClaimConflictBestEffort(
    verdict: IdentityWriteVerdict,
    conflicts: unknown[],
  ): void {
    if (!parleyAutoTrigger || !verdict.ok || verdict.kind !== 'verified') return;
    try {
      if (conflicts.length === 0) return;
      if (conflicts.length > CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs) {
        logger.error('parley_auto_trigger_failed', {
          reason: `claim conflict count exceeds bounded maximum ${CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs}`,
          conflictsCount: conflicts.length,
        });
        return;
      }
      if (!hasActiveCanonicalActor(verdict.actorId)) {
        logger.info('parley_auto_trigger_skipped', {
          reason: 'verified requester has no active daemon session',
          actorId: verdict.actorId,
        });
        return;
      }
      const signal = buildClaimConflictSignal(verdict.actorId, conflicts);
      if (!signal) {
        logger.error('parley_auto_trigger_failed', {
          reason: 'claim conflict did not resolve to two distinct live canonical actor identities',
          conflictsCount: conflicts.length,
        });
        return;
      }
      const harbor = actorSouls?.constants?.defaultHarbor?.trim();
      if (!harbor) {
        logger.error('parley_auto_trigger_failed', {
          reason: 'automatic Parley requires the actor identity store canonical harbor',
        });
        return;
      }
      const result = parleyAutoTrigger.evaluate(signal, { harbor });
      if (result.state === 'failed') {
        logger.error('parley_auto_trigger_failed', {
          signalId: signal.signalId,
          reason: result.reason,
        });
      } else {
        logger.info('parley_auto_trigger_evaluated', {
          signalId: signal.signalId,
          state: result.state,
          parleyId: result.parleyId,
        });
      }
    } catch (error) {
      logger.error('parley_auto_trigger_failed', {
        reason: error instanceof Error ? error.message : 'unknown automatic Parley failure',
      });
    }
  }

  /**
   * Map general session mutation errors to HTTP status. The intent is one stable
   * transport contract for callers regardless of the underlying sessions method.
   *
   * @param result - Structured sessions-module error result.
   * @returns HTTP status appropriate for the error code.
   */
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

  /**
   * Map note-specific failures without treating a missing session as a validation
   * error. The design preserves the distinction clients need for recovery flows.
   *
   * @param result - Structured note-write error result.
   * @returns HTTP status appropriate for the note failure.
   */
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

  /**
   * Read the optional agent identity header defensively. Its purpose is to normalize
   * Fastify's string-or-array representation before identity verification.
   *
   * @param request - Incoming Fastify request.
   * @returns Trimmed agent id, or null when absent or empty.
   */
  const headerAgentId = (request: FastifyRequest): string | null => {
    const value = request.headers['x-agent-id'];
    if (Array.isArray(value)) return typeof value[0] === 'string' && value[0].trim() ? value[0].trim() : null;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  /**
   * Resolve the asserted mutation agent from body or header before credential checks.
   * The design rejects malformed assertions early while leaving authorization to the
   * canonical identity-write boundary below.
   *
   * @param request - Incoming Fastify mutation request.
   * @param bodyAgentId - Optional agent id asserted in the JSON body.
   * @returns Normalized agent identity or a structured validation error.
   */
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

  /**
   * #8877 / ADR-0122 slice 1: the identity write boundary for this plugin's
   * mutation routes.
   *
   * Why it exists: sessions and notes are durable attributed records, and the
   * old `mutationAgentId` helper accepted whatever string the caller
   * asserted — the impersonation gap issue #8877 records. This wrapper keeps
   * the extraction points (body `agentId`, `x-agent-id` header) but routes the
   * result through `resolveWriteIdentity`, whose design is fail-closed with
   * no middle state: a self-asserted agentId with no credential ⇒ 401, a
   * presented credential must verify (invalid ⇒ 401, never a silent
   * fallback), and a valid credential cannot write under another soul's name
   * (403). Only a request asserting no identity at all resolves anonymous.
   *
   * @param request - The incoming Fastify request (headers + body carriers).
   * @param bodyAgentId - The raw `agentId` field from the request body.
   * @param route - Route label for structured reject logs.
   * @returns On success, the effective agentId plus the identity verdict
   *          (verified / anonymous) for stamping records and responses; on
   *          failure, the HTTP status and error body to return.
   */
  const mutationIdentity = (
    request: FastifyRequest,
    bodyAgentId: unknown,
    route: string,
    options?: { requireIdentity?: boolean },
  ):
    | { success: true; agentId: string | null; verdict: Extract<IdentityWriteVerdict, { ok: true }> }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    const base = mutationAgentId(request, bodyAgentId);
    if (!base.success) {
      return { success: false, httpStatus: 400, result: base.result };
    }
    const verdict = resolveWriteIdentity({
      souls: actorSouls,
      credential: extractActorCredential(request.headers as Record<string, unknown>, request.body),
      assertedAgentId: base.agentId,
      route,
      logger,
      requireIdentity: options?.requireIdentity,
    });
    if (!verdict.ok) {
      return {
        success: false,
        httpStatus: verdict.httpStatus,
        result: { success: false, error: verdict.error, code: verdict.code },
      };
    }
    return { success: true, agentId: verdict.agentId, verdict };
  };

  /**
   * Authorize a file-claim mutation (claim/release) against the target
   * session.
   *
   * Purpose: file claims are coordination state OWNED by a session; letting
   * any caller mutate them under the owner's name is the blocking/stealing
   * attack the #8877 audit records. The design checks, in order: an agentId
   * is present (claims are always attributed), the session exists and is
   * active, the asserted agentId matches the session's owner string, and —
   * when the session was started with a verified identity stamp — that the
   * caller's VERIFIED minted actor is the same soul that owns the session.
   * The last check is what makes the string comparison sound: a session
   * stamped `identity.actorId` can only have its claims mutated by a caller
   * holding that soul's credential, not by anyone who learned the display
   * name.
   *
   * @param sessionId - Target session id from the route path.
   * @param agentId - Effective attribution id from the identity verdict.
   * @param action - Which mutation is being authorized (for error text).
   * @param verdict - The successful identity verdict for this request.
   * @returns Success, or the error body (and implied status) to return.
   */
  const authorizeFileMutationRoute = (
    sessionId: string,
    agentId: string | null,
    action: 'claiming' | 'releasing',
    verdict?: Extract<IdentityWriteVerdict, { ok: true }>,
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

    // When the session record carries a verified identity stamp, the caller's
    // minted actor must be the SAME soul — knowing the owner's display string
    // is not ownership.
    const stamped = (session as { metadata?: { identity?: { verified?: unknown; actorId?: unknown } } })
      ?.metadata?.identity;
    if (
      stamped &&
      stamped.verified === true &&
      typeof stamped.actorId === 'string' &&
      verdict?.kind === 'verified' &&
      verdict.actorId !== stamped.actorId
    ) {
      return {
        success: false,
        result: {
          success: false,
          error: `the presented credential's actor does not own session "${sessionId}"`,
          code: 'SESSION_AGENT_MISMATCH',
        },
      };
    }

    return { success: true };
  };

  /**
   * Shared handler for the canonical `POST /notes` and the compat alias
   * `POST /sessions/:id/notes`.
   *
   * Purpose: notes are the durable narrative of record (they feed
   * changelog-from-note, briefings, and roster projections), so this is a
   * security-relevant write boundary. The design enforces, in order: content
   * validation, the #8877 identity write boundary (a self-asserted id without
   * a daemon-minted credential is 401, a forged credential is 401, another
   * soul's name is 403 — before anything persists), the adversarial-project
   * envelope guard, and only then the actual note write — with the identity
   * verdict echoed on the response.
   *
   * @param request - The incoming Fastify request.
   * @param reply - Fastify reply used to set the HTTP status code.
   * @param routeSessionId - Session id from the path for the alias route, or
   *        null for `POST /notes` (session comes from the body / agent scope).
   * @returns The note-write result body, including an `identity` verdict for
   *          attributed writes.
   */
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

    // #8877: notes are durable attributed records — enforce the identity
    // write boundary before anything is persisted.
    const noteIdentity = mutationIdentity(request, agentId, routeSessionId ? 'POST /sessions/:id/notes' : 'POST /notes');
    if (!noteIdentity.success) {
      reply.code(noteIdentity.httpStatus);
      return noteIdentity.result;
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

    const result = sessions.quickNote(writtenContent, { sessionId, agentId: noteIdentity.agentId, type });

    if (!result.success) {
      reply.code(noteWriteStatus(result));
      return result;
    }

    // Surface the verified identity verdict on the response so the caller
    // sees which minted actor the note was attributed to.
    if (noteIdentity.verdict.kind !== 'anonymous') {
      result.identity = noteIdentity.verdict.identity;
    }

    logger.info('session_note_added', {
      noteId: result.noteId,
      sessionId: result.sessionId,
      type: type || 'note',
      identityVerified: noteIdentity.verdict.kind === 'verified'
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

      const sessionAgent = mutationIdentity(request, agentId, 'POST /sessions');
      if (!sessionAgent.success) {
        reply.code(sessionAgent.httpStatus);
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
          evaluateClaimConflictBestEffort(sessionAgent.verdict, conflictCheck.conflicts);
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

      // #8877: the session row is the durable attributed record — stamp the
      // verified identity verdict into its metadata so the record itself
      // testifies which minted actor started it (and a caller-supplied
      // `identity` key can never pre-fill the daemon's verdict slot).
      const stampedMetadata = stampIdentityMetadata(mergedMetadata, sessionAgent.verdict);

      const result = sessions.start(purpose, {
        agentId: sessionAgent.agentId,
        files,
        metadata: stampedMetadata,
        worktreeId: worktreePolicy.worktree?.id,
        durable: lifecycle === 'durable',
      });

      if (!result.success) {
        reply.code(400);
        return { ...result, code: result.code || 'VALIDATION_ERROR' };
      }

      if (force && Array.isArray(result.conflicts) && result.conflicts.length > 0) {
        evaluateClaimConflictBestEffort(sessionAgent.verdict, result.conflicts);
      }

      if (sessionAgent.verdict.kind !== 'anonymous') {
        result.identity = sessionAgent.verdict.identity;
      }

      logger.info('session_started', {
        sessionId: result.id,
        purpose,
        agentId: sessionAgent.agentId,
        filesCount: files ? files.length : 0,
        identityVerified: sessionAgent.verdict.kind === 'verified'
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

  // POST /sessions/:id/takeover - Non-destructively continue an existing session
  fastify.post('/sessions/:id/takeover', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sessionIdParam = (request.params as any).id;
      const sessionId = typeof sessionIdParam === 'string' ? sessionIdParam : sessionIdParam[0];
      const body = (request.body || {}) as any;
      // Takeover is ALWAYS attributed: when no agentId is asserted the
      // successor inherits the predecessor's agent id, so an anonymous
      // takeover would write an attributed record under someone else's name.
      // requireIdentity turns even a bare no-claim takeover into a 401.
      const sessionAgent = mutationIdentity(request, body.agentId, 'POST /sessions/:id/takeover', { requireIdentity: true });
      if (!sessionAgent.success) {
        reply.code(sessionAgent.httpStatus);
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
        metadata: stampIdentityMetadata(metadata, sessionAgent.verdict),
        durable: lifecycle ? lifecycle === 'durable' : typeof body.durable === 'boolean' ? body.durable : undefined,
        claimFiles: typeof body.claimFiles === 'boolean' ? body.claimFiles : undefined,
      });

      if (!result.success) {
        const statusCode = result.code === 'VALIDATION_ERROR' ? 400 : 404;
        reply.code(statusCode);
        return result;
      }

      if (sessionAgent.verdict.kind !== 'anonymous') {
        result.identity = sessionAgent.verdict.identity;
      }

      logger.info('session_taken_over', {
        predecessorId: result.predecessorId,
        successorId: result.successorId,
        claimsTransferred: result.claimsTransferred,
        identityVerified: sessionAgent.verdict.kind === 'verified',
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

      const requestAgent = mutationIdentity(request, agentId, 'POST /sessions/:id/files');
      if (!requestAgent.success) {
        reply.code(requestAgent.httpStatus);
        return requestAgent.result;
      }

      const routeAuth = authorizeFileMutationRoute(sessionId, requestAgent.agentId, 'claiming', requestAgent.verdict);
      if (!routeAuth.success) {
        reply.code(errorStatus(routeAuth.result));
        return routeAuth.result;
      }

      if (hasFiles && !force) {
        const conflictCheck = sessions.getFileConflicts(files);
        if (conflictCheck.conflicts && Array.isArray(conflictCheck.conflicts) && conflictCheck.conflicts.length > 0) {
          evaluateClaimConflictBestEffort(requestAgent.verdict, conflictCheck.conflicts);
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

      if (Array.isArray(result.conflicts) && result.conflicts.length > 0) {
        evaluateClaimConflictBestEffort(requestAgent.verdict, result.conflicts);
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

      const conflicts = result.conflicts as SymbolConflict[];
      if (conflicts.length > 0 && suggestions && agentInbox) {
        try {
          const sessionResult = typeof sessions.get === 'function'
            ? sessions.get(sessionId) as {
                session?: { agentId?: string | null; purpose?: string | null };
              }
            : null;
          surfaceSymbolConflictAdvice(
            { suggestions, inbox: agentInbox, activityLog },
            {
              sessionId,
              agentId: sessionResult?.session?.agentId ?? null,
              purpose: sessionResult?.session?.purpose ?? null,
              conflicts,
            },
          );
        } catch (error) {
          // Advice is durable enrichment over the authoritative claim verdict. A
          // delivery outage must be visible, but cannot rewrite blocked → allowed
          // or warning → failed.
          logger.error('symbol_conflict_advice_error', {
            sessionId,
            conflictsCount: conflicts.length,
            error: (error as Error).message,
          });
        }
      }

      // ast-a2-1: Claim validator pre-flight — reject blocking conflicts.
      // A blocking conflict means the symbol is already held in a way that makes
      // concurrent modification unsafe (e.g., two sessions modifying the same symbol
      // or one modifying a function another is calling). This gate makes symbol
      // conflicts predictable for the wedge rendering.
      const blockingConflicts = conflicts.filter(c => c.severity === 'blocking');
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

      const requestAgent = mutationIdentity(request, agentId, 'DELETE /sessions/:id/files');
      if (!requestAgent.success) {
        reply.code(requestAgent.httpStatus);
        return requestAgent.result;
      }

      const routeAuth = authorizeFileMutationRoute(sessionId, requestAgent.agentId, 'releasing', requestAgent.verdict);
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
