/**
 * Commitment Routes — `/commitments/*`
 *
 * HTTP wrapper over `lib/commitments.ts` (durable obligation object) and
 * `lib/obligation-monitor.ts` (the dual of resurrection). ADR-0041 first slice.
 *
 *   POST   /commitments            — create a durable commitment (due_at is
 *                                     daemon-derived from scope, NOT request body)
 *   GET    /commitments            — list (filter by owner/state)
 *   POST   /commitments/:id/close  — close against an oracle ref (Law 2)
 *   GET    /commitments/overdue    — run the obligation sweep, return overdue list
 *
 * Law 1 lives in the module: the route accepts a `scope`/`strategy`, never an
 * absolute `dueAt`. Law 2 lives in the module: close() refuses without an oracle.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  extractActorCredential,
  resolveWriteIdentity,
  type IdentityVerifier,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';
import type {
  Commitments,
  CommitmentScope,
  CommitmentState,
  CommitmentStrategy,
} from '../lib/commitments.js';
import type { ObligationMonitor } from '../lib/obligation-monitor.js';

interface CommitmentsDeps {
  commitments: Commitments;
  obligationMonitor: ObligationMonitor;
  logger?: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /**
   * ADR-0040 souls store (subset). Commitment writes REQUIRE the daemon-minted
   * credential (#8877 / ADR-0122): a commitment is a durable obligation
   * attributed to `ownerActorId`, so creating one demands a credential whose
   * soul IS that owner (403 otherwise — no forging obligations onto a victim),
   * and closing one demands the owner's credential too.
   */
  actorSouls?: IdentityVerifier | null;
}

const SCOPES = new Set<CommitmentScope>(['claim', 'review', 'standing', 'default']);
const STRATEGIES = new Set<CommitmentStrategy>(['single', 'open']);
const STATES = new Set<CommitmentState>(['open', 'done', 'abandoned', 'superseded']);

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

function asPosInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return undefined;
}

interface CreateBody {
  ownerActorId?: unknown;
  objectText?: unknown;
  successCheck?: unknown;
  impossibleCheck?: unknown;
  motivationCheck?: unknown;
  scope?: unknown;
  commitmentStrategy?: unknown;
}

interface CloseBody {
  oracleRef?: unknown;
}

export const commitmentsPlugin: FastifyPluginAsync<{ deps: CommitmentsDeps }> = async (
  fastify,
  opts,
) => {
  const { commitments, obligationMonitor, actorSouls, logger } = opts.deps;

  /**
   * The strict identity gate for commitment writes.
   *
   * Purpose: a commitment (ADR-0041) is a durable obligation pinned to an
   * actor; letting a caller create or close one under an arbitrary
   * `ownerActorId` string forges obligations onto victims (or closes theirs).
   * The design requires a verified daemon-minted credential
   * (`requireIdentity: true` — there is no anonymous commitment), then
   * requires the owner id in play to resolve to the SAME minted soul as the
   * credential: owning the display string is not owning the obligation.
   *
   * @param request - The incoming Fastify request (credential carriers).
   * @param ownerActorId - The owner id being written or mutated.
   * @param route - Route label for structured reject logs.
   * @returns The verified verdict, or the HTTP status and error body.
   */
  const requireCommitmentOwner = (
    request: FastifyRequest,
    ownerActorId: string,
    route: string,
  ):
    | { success: true; verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }> }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    const verdict = resolveWriteIdentity({
      souls: actorSouls,
      credential: extractActorCredential(request.headers as Record<string, unknown>, request.body),
      assertedAgentId: null,
      route,
      logger,
      requireIdentity: true,
    });
    if (!verdict.ok) {
      return {
        success: false,
        httpStatus: verdict.httpStatus,
        result: { success: false, error: verdict.error, code: verdict.code },
      };
    }
    const verified = verdict as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;
    const resolvedOwner = actorSouls
      ? actorSouls.resolveActor(ownerActorId).actorId
      : ownerActorId;
    if (resolvedOwner !== verified.actorId) {
      logger?.error('identity_write_rejected', {
        route,
        code: 'IDENTITY_ALIAS_MISMATCH',
        actorId: verified.actorId,
        ownerActorId,
      });
      return {
        success: false,
        httpStatus: 403,
        result: {
          success: false,
          error: `ownerActorId "${ownerActorId}" does not resolve to the presented credential's actor`,
          code: 'IDENTITY_ALIAS_MISMATCH',
        },
      };
    }
    return { success: true, verdict: verified };
  };

  fastify.post('/commitments', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as CreateBody;
    const ownerActorId = asString(body.ownerActorId);
    const objectText = asString(body.objectText);
    if (!ownerActorId || !objectText) {
      reply.code(400);
      return { success: false, error: 'ownerActorId and objectText are required' };
    }
    const owner = requireCommitmentOwner(request, ownerActorId, 'POST /commitments');
    if (!owner.success) {
      reply.code(owner.httpStatus);
      return owner.result;
    }
    const scopeRaw = asString(body.scope);
    const scope = scopeRaw && SCOPES.has(scopeRaw as CommitmentScope)
      ? (scopeRaw as CommitmentScope)
      : undefined;
    const strategyRaw = asString(body.commitmentStrategy);
    const commitmentStrategy = strategyRaw && STRATEGIES.has(strategyRaw as CommitmentStrategy)
      ? (strategyRaw as CommitmentStrategy)
      : undefined;
    try {
      const commitment = commitments.create({
        ownerActorId,
        objectText,
        successCheck: asString(body.successCheck) ?? null,
        impossibleCheck: asString(body.impossibleCheck) ?? null,
        motivationCheck: asString(body.motivationCheck) ?? null,
        scope,
        commitmentStrategy,
      });
      reply.code(201);
      return { success: true, commitment };
    } catch (error) {
      reply.code(400);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'create failed',
      };
    }
  });

  fastify.get('/commitments', async (request: FastifyRequest) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const ownerActorId = asString(q.ownerActorId);
    const limit = asPosInt(q.limit);
    const stateRaw = asString(q.state);
    const state =
      stateRaw === 'all'
        ? 'all'
        : stateRaw && STATES.has(stateRaw as CommitmentState)
          ? (stateRaw as CommitmentState)
          : undefined;
    const items = commitments.list({ ownerActorId, state, limit });
    return { success: true, commitments: items, count: items.length };
  });

  // Static path must register BEFORE the parameterized close so /overdue is not
  // swallowed by /:id matching on some routers. Fastify path matching is
  // explicit, but ordering keeps intent clear.
  fastify.get('/commitments/overdue', async (request: FastifyRequest) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    // Default to the daemon's wall clock; tests/tools may pin `now`.
    const nowParam = asPosInt(q.now);
    const now = nowParam ?? Date.now();
    // GET must be safe/idempotent: do NOT emit OBLIGATION_OVERDUE here. The
    // daemon's periodic sweep owns emission (emit defaults true); a polling
    // dashboard hitting this endpoint should never write activity events.
    const result = obligationMonitor.checkOverdue(now, { emit: false });
    return result;
  });

  fastify.post('/commitments/:id/close', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id?: string };
    const id = asString(params.id);
    if (!id) {
      reply.code(400);
      return { success: false, error: 'id required in path' };
    }
    const existing = commitments.get(id);
    if (!existing) {
      reply.code(404);
      return { success: false, error: `no commitment with id ${id}` };
    }
    // #8877: only the owning soul may close its obligation.
    const owner = requireCommitmentOwner(request, existing.ownerActorId, 'POST /commitments/:id/close');
    if (!owner.success) {
      reply.code(owner.httpStatus);
      return owner.result;
    }
    const body = (request.body ?? {}) as CloseBody;
    const oracleRef = asString(body.oracleRef);
    const result = commitments.close(id, oracleRef ?? '');
    if (!result.success) {
      // 422 when the refusal is the Law 2 oracle gate; 404 when the row is missing.
      reply.code(/no commitment with id/.test(result.error ?? '') ? 404 : 422);
      return result;
    }
    return result;
  });
};
