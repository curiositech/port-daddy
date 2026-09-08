/**
 * Locks Routes
 *
 * V2 Lock Endpoints for multi-agent coordination.
 * Provides distributed locking with TTL, ownership, and extension.
 *
 * #8877 / ADR-0122: every lock mutation (acquire / release / extend) is an
 * ATTRIBUTED write — release semantics depend entirely on who the owner is —
 * so all three require a daemon-minted ADR-0040 credential. The old
 * self-asserted owner strings and the `anonymous-<ip>` / `agent-<pid>`
 * fallbacks are DELETED: a caller with no verifiable identity cannot hold a
 * lock another caller must be able to trust.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateLockName } from '../shared/validators.js';
import { WebhookEvent } from '../lib/webhooks.js';
import {
  extractActorCredential,
  resolveWriteIdentity,
  type IdentityVerifier,
  type IdentityWriteVerdict,
} from '../lib/identity-write-boundary.js';

interface LocksRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  locks: {
    acquire(name: string, opts: Record<string, unknown>): Record<string, unknown>;
    release(name: string, opts: Record<string, unknown>): Record<string, unknown>;
    check(name: string): unknown;
    list(opts: { owner?: string }): unknown;
    extend(name: string, opts: Record<string, unknown>): Record<string, unknown>;
  };
  agents: {
    canAcquireLock(agentId: string): { allowed: boolean; error?: string; current?: number; max?: number };
  };
  activityLog: {
    logLock: {
      acquire(name: string, owner: string): void;
      release(name: string, owner: string): void;
    };
  };
  webhooks: {
    trigger(event: string, payload: Record<string, unknown>, opts: { targetId: string }): void;
  };
  /**
   * ADR-0040 souls store (subset). Lock mutations REQUIRE the daemon-minted
   * credential (#8877 / ADR-0122): no credential is 401, a forged one is 401,
   * and an owner string bound to a different soul is 403.
   */
  actorSouls?: IdentityVerifier | null;
}

// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const locksPlugin: FastifyPluginAsync<{ deps: LocksRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { logger, metrics, locks, agents, activityLog, webhooks, actorSouls } = deps;

  /**
   * The strict identity gate for every lock mutation.
   *
   * Purpose: a lock's whole value is that only its owner can release or
   * extend it; a self-asserted owner string makes that guarantee a fiction
   * (name the holder's string and the lock is yours). This helper resolves
   * the asserted owner (body `owner` or `x-agent-id` header) through the
   * #8877 identity write boundary with `requireIdentity: true` — a
   * daemon-minted credential is REQUIRED even when no owner is asserted,
   * because lock writes are attributed by construction. On success the
   * effective owner is the asserted display name (verified against the
   * credential's soul) or, absent one, the minted actorId itself.
   *
   * @param request - The incoming Fastify request (credential + owner carriers).
   * @param bodyOwner - The raw `owner` field from the request body.
   * @param route - Route label for structured reject logs.
   * @returns The verified verdict plus the effective owner string, or the
   *          HTTP status and error body to return.
   */
  const requireLockIdentity = (
    request: FastifyRequest,
    bodyOwner: unknown,
    route: string,
  ):
    | { success: true; verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>; owner: string }
    | { success: false; httpStatus: number; result: Record<string, unknown> } => {
    const headerAgent = request.headers['x-agent-id'];
    const headerOwner = Array.isArray(headerAgent) ? headerAgent[0] : headerAgent;
    const asserted = typeof bodyOwner === 'string' && bodyOwner.trim()
      ? bodyOwner.trim()
      : typeof headerOwner === 'string' && headerOwner.trim()
        ? headerOwner.trim()
        : null;

    const verdict = resolveWriteIdentity({
      souls: actorSouls,
      credential: extractActorCredential(request.headers as Record<string, unknown>, request.body),
      assertedAgentId: asserted,
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
    // requireIdentity guarantees the success case is `verified`.
    const verified = verdict as Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>;
    return { success: true, verdict: verified, owner: verified.agentId };
  };

  /**
   * Enforce that the caller's minted actor owns the lock it is mutating.
   *
   * Why this exists in addition to lib/locks' owner-string match: locks
   * acquired through this plugin carry the acquirer's minted `actorId` in
   * their metadata, and the string owner is only a display name. Comparing
   * the stored actorId against the verified verdict is what makes ownership
   * unforgeable — knowing (or guessing) the display string is not ownership.
   * `force: true` skips the ownership comparison (operator escape hatch for
   * wedged locks) but still required a verified credential to get here.
   *
   * @param name - Lock name being mutated.
   * @param verdict - The caller's verified identity verdict.
   * @param force - Whether the caller invoked the force escape hatch.
   * @returns Success, or the 403 error body to return.
   */
  const authorizeLockMutation = (
    name: string,
    verdict: Extract<IdentityWriteVerdict, { ok: true; kind: 'verified' }>,
    force: boolean,
  ): { success: true } | { success: false; result: Record<string, unknown> } => {
    if (force) return { success: true };
    const status = locks.check(name) as
      | { held?: boolean; metadata?: { actorId?: unknown } | null }
      | undefined;
    const stampedActor = status?.held ? status?.metadata?.actorId : undefined;
    if (typeof stampedActor === 'string' && stampedActor !== verdict.actorId) {
      return {
        success: false,
        result: {
          success: false,
          error: `the presented credential's actor does not hold lock "${name}"`,
          code: 'LOCK_OWNER_MISMATCH',
        },
      };
    }
    return { success: true };
  };

  // POST /locks/:name - Acquire a lock
  fastify.post('/locks/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const name = (request.params as any).name as string;
      const { owner, ttl, metadata } = request.body as any;

      const nameValidation = validateLockName(name);
      if (!nameValidation.valid) {
        reply.code(400);
        return { error: nameValidation.error, code: 'VALIDATION_ERROR' };
      }

      const identity = requireLockIdentity(request, owner, 'POST /locks/:name');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }

      {
        const limitCheck = agents.canAcquireLock(identity.owner);
        if (!limitCheck.allowed) {
          reply.code(429);
          return {
            error: limitCheck.error,
            current: limitCheck.current,
            max: limitCheck.max
          };
        }
      }

      // Stamp the minted actorId into the lock's metadata: release/extend
      // compare against it, so ownership is bound to the soul, not the
      // display string. The caller-supplied metadata cannot pre-fill it.
      const lockMetadata = {
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        actorId: identity.verdict.actorId,
      };

      const result = locks.acquire(name, {
        owner: identity.owner,
        pid: parseInt(request.headers['x-pid'] as string, 10) || process.pid,
        ttl: ttl || 300000,
        metadata: lockMetadata
      });

      if (!result.success) {
        const code = result.code || 'LOCK_HELD';
        const status = code === 'INVALID_TTL' ? 400 : 409;
        reply.code(status);
        return { ...result, code };
      }

      logger.info('lock_acquired', { name, owner: result.owner as string, actorId: identity.verdict.actorId });

      activityLog.logLock.acquire(name, result.owner as string);

      webhooks.trigger(WebhookEvent.LOCK_ACQUIRE, {
        lockName: name,
        owner: result.owner as string,
        expiresAt: result.expiresAt as string
      }, { targetId: name });

      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('lock_acquire_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // DELETE /locks/:name - Release a lock
  fastify.delete('/locks/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const name = (request.params as any).name as string;
      const { owner, force } = (request.body as any) || {};

      const identity = requireLockIdentity(request, owner, 'DELETE /locks/:name');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }

      const lockAuth = authorizeLockMutation(name, identity.verdict, force === true);
      if (!lockAuth.success) {
        reply.code(403);
        return lockAuth.result;
      }

      const result = locks.release(name, {
        owner: identity.owner,
        force: force === true
      });

      if (!result.success) {
        reply.code(403);
        return { ...result, code: 'LOCK_NOT_FOUND' };
      }

      logger.info('lock_released', { name, released: result.released as boolean, actorId: identity.verdict.actorId });

      if (result.released) {
        activityLog.logLock.release(name, identity.owner);

        webhooks.trigger(WebhookEvent.LOCK_RELEASE, {
          lockName: name,
          owner: identity.owner
        }, { targetId: name });
      }

      return result;

    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /locks/:name - Check lock status
  fastify.get('/locks/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = locks.check((request.params as any).name as string);
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // GET /locks - List all locks
  fastify.get('/locks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { owner } = request.query as any;
      const result = locks.list({ owner: owner as string | undefined });
      return result;
    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // PUT /locks/:name - Extend lock TTL
  fastify.put('/locks/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const name = (request.params as any).name as string;
      const { ttl, owner } = (request.body as any) || {};

      const identity = requireLockIdentity(request, owner, 'PUT /locks/:name');
      if (!identity.success) {
        reply.code(identity.httpStatus);
        return identity.result;
      }

      const lockAuth = authorizeLockMutation(name, identity.verdict, false);
      if (!lockAuth.success) {
        reply.code(403);
        return lockAuth.result;
      }

      const result = locks.extend(name, {
        owner: identity.owner,
        ttl
      });

      if (!result.success) {
        const code = result.code || 'LOCK_NOT_FOUND';
        reply.code(400);
        return { ...result, code };
      }

      return result;

    } catch (error) {
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
