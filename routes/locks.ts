/**
 * Locks Routes
 *
 * V2 Lock Endpoints for multi-agent coordination.
 * Provides distributed locking with TTL, ownership, and extension.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateLockName } from '../shared/validators.js';
import { WebhookEvent } from '../lib/webhooks.js';

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
}

/**
 * Create locks routes
 *
 * @param deps - Route dependencies
 * @returns Express router with lock routes
 */


// =============================================================================
// Fastify plugin (dual-export)
// =============================================================================
export const locksPlugin: FastifyPluginAsync<{ deps: LocksRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { logger, metrics, locks, agents, activityLog, webhooks } = deps;

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

      const agentId = owner || (request.headers['x-agent-id'] as string) || `anonymous-${request.ip || 'local'}`;
      {
        const limitCheck = agents.canAcquireLock(agentId);
        if (!limitCheck.allowed) {
          reply.code(429);
          return {
            error: limitCheck.error,
            current: limitCheck.current,
            max: limitCheck.max
          };
        }
      }

      const result = locks.acquire(name, {
        owner: owner || request.headers['x-agent-id'] || `agent-${process.pid}`,
        pid: parseInt(request.headers['x-pid'] as string, 10) || process.pid,
        ttl: ttl || 300000,
        metadata
      });

      if (!result.success) {
        const code = result.code || 'LOCK_HELD';
        const status = code === 'INVALID_TTL' ? 400 : 409;
        reply.code(status);
        return { ...result, code };
      }

      logger.info('lock_acquired', { name, owner: result.owner as string });

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

      const result = locks.release(name, {
        owner: owner || request.headers['x-agent-id'],
        force: force === true
      });

      if (!result.success) {
        reply.code(403);
        return { ...result, code: 'LOCK_NOT_FOUND' };
      }

      logger.info('lock_released', { name, released: result.released as boolean });

      if (result.released) {
        activityLog.logLock.release(name, owner || 'unknown');

        webhooks.trigger(WebhookEvent.LOCK_RELEASE, {
          lockName: name,
          owner: owner || 'unknown'
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
      const { ttl, owner } = (request.body as any) || {};
      const result = locks.extend((request.params as any).name as string, {
        owner: owner || request.headers['x-agent-id'],
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
