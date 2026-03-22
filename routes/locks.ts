/**
 * Locks Routes
 *
 * V2 Lock Endpoints for multi-agent coordination.
 * Provides distributed locking with TTL, ownership, and extension.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
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
export function createLocksRoutes(deps: LocksRouteDeps): Router {
  const { logger, metrics, locks, agents, activityLog, webhooks } = deps;
  const router = Router();

  // ==========================================================================
  // POST /locks/:name - Acquire a lock
  // ==========================================================================
  router.post('/locks/:name', (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const { owner, ttl, metadata } = req.body;

      // Validate lock name
      const nameValidation = validateLockName(name);
      if (!nameValidation.valid) {
        return res.status(400).json({ error: nameValidation.error, code: 'VALIDATION_ERROR' });
      }

      // Check agent resource limits — always enforce, even for anonymous callers
      const agentId = owner || (req.headers['x-agent-id'] as string) || `anonymous-${req.ip || 'local'}`;
      {
        const limitCheck = agents.canAcquireLock(agentId);
        if (!limitCheck.allowed) {
          return res.status(429).json({
            error: limitCheck.error,
            current: limitCheck.current,
            max: limitCheck.max
          });
        }
      }

      const result = locks.acquire(name, {
        owner: owner || req.headers['x-agent-id'] || `agent-${process.pid}`,
        pid: parseInt(req.headers['x-pid'] as string, 10) || process.pid,
        ttl: ttl || 300000,
        metadata
      });

      if (!result.success) {
        // Preserve the error code from the module if provided, otherwise default to LOCK_HELD
        const code = result.code || 'LOCK_HELD';
        const status = code === 'INVALID_TTL' ? 400 : 409; // 400 for validation errors, 409 for conflicts
        return res.status(status).json({ ...result, code });
      }

      logger.info('lock_acquired', { name, owner: result.owner as string });

      // Log activity
      activityLog.logLock.acquire(name, result.owner as string);

      // Trigger webhooks
      webhooks.trigger(WebhookEvent.LOCK_ACQUIRE, {
        lockName: name,
        owner: result.owner as string,
        expiresAt: result.expiresAt as string
      }, { targetId: name });

      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('lock_acquire_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // DELETE /locks/:name - Release a lock
  // ==========================================================================
  router.delete('/locks/:name', (req: Request, res: Response) => {
    try {
      const name = req.params.name as string;
      const { owner, force } = req.body || {};

      const result = locks.release(name, {
        owner: owner || req.headers['x-agent-id'],
        force: force === true
      });

      if (!result.success) {
        return res.status(403).json({ ...result, code: 'LOCK_NOT_FOUND' });
      }

      logger.info('lock_released', { name, released: result.released as boolean });

      // Log activity
      if (result.released) {
        activityLog.logLock.release(name, owner || 'unknown');

        // Trigger webhooks
        webhooks.trigger(WebhookEvent.LOCK_RELEASE, {
          lockName: name,
          owner: owner || 'unknown'
        }, { targetId: name });
      }

      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /locks/:name - Check lock status
  // ==========================================================================
  router.get('/locks/:name', (req: Request, res: Response) => {
    try {
      const result = locks.check(req.params.name as string);
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // GET /locks - List all locks
  // ==========================================================================
  router.get('/locks', (req: Request, res: Response) => {
    try {
      const { owner } = req.query;
      const result = locks.list({ owner: owner as string | undefined });
      res.json(result);
    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ==========================================================================
  // PUT /locks/:name - Extend lock TTL
  // ==========================================================================
  router.put('/locks/:name', (req: Request, res: Response) => {
    try {
      const { ttl, owner } = req.body || {};
      const result = locks.extend(req.params.name as string, {
        owner: owner || req.headers['x-agent-id'],
        ttl
      });

      if (!result.success) {
        // Preserve the error code from the module if provided
        const code = result.code || 'LOCK_NOT_FOUND';
        return res.status(400).json({ ...result, code });
      }

      res.json(result);

    } catch (error) {
      metrics.errors++;
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
