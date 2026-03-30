/**
 * Health Routes
 *
 * Handles service health monitoring and wait operations.
 * Extracted from server.js lines 1415-1501.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { validateIdentity } from '../shared/validators.js';

interface HealthRouteDeps {
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  health: {
    check(id: string): Promise<unknown>;
    waitFor(id: string, opts: { timeout: number }): Promise<unknown>;
    waitForAll(ids: string[], opts: { timeout: number }): Promise<unknown>;
    listStatus(): unknown;
  };
}

/**
 * Create health routes
 *
 * @param deps - Dependencies
 * @returns Express router
 */
export function createHealthRoutes(deps: HealthRouteDeps): Router {
  const { logger, metrics, health } = deps;
  const router = Router();

  // =========================================================================
  // GET /services/health/:id - Check health of a service
  // =========================================================================
  router.get('/services/health/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const idValidation = validateIdentity(id);
      if (!idValidation.valid) {
        return res.status(400).json({ error: idValidation.error });
      }

      const result = await health.check(id);
      res.json(result);

    } catch (error) {
      metrics.errors++;
      logger.error('health_check_failed', { id: req.params.id as string, error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /wait/:id - Wait for a single service to be healthy
  // =========================================================================
  router.get('/wait/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const idValidation = validateIdentity(id);
      if (!idValidation.valid) {
        return res.status(400).json({ error: idValidation.error });
      }

      // Max 5 minutes timeout, default 60 seconds
      const timeout = Math.min(parseInt(req.query.timeout as string, 10) || 60000, 300000);

      const result = await health.waitFor(id, { timeout });
      res.json(result);

    } catch (error) {
      if ((error as Error).message.includes('Timeout')) {
        return res.status(408).json({ success: false, error: (error as Error).message });
      }
      metrics.errors++;
      logger.error('wait_for_failed', { id: req.params.id as string, error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // POST /wait - Wait for multiple services to be healthy
  // =========================================================================
  router.post('/wait', async (req: Request, res: Response) => {
    try {
      const { services: serviceIds, timeout } = req.body;

      if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
        return res.status(400).json({ error: 'services must be a non-empty array' });
      }

      if (serviceIds.length > 20) {
        return res.status(400).json({ error: 'too many services (max 20)' });
      }

      for (const id of serviceIds) {
        const validation = validateIdentity(id);
        if (!validation.valid) {
          return res.status(400).json({ error: `invalid service id '${id}': ${validation.error}` });
        }
      }

      // Max 5 minutes timeout, default 60 seconds
      const safeTimeout = Math.min(timeout || 60000, 300000);

      const result = await health.waitForAll(serviceIds, { timeout: safeTimeout });
      res.json(result);

    } catch (error) {
      if ((error as Error).message.includes('Timeout')) {
        return res.status(408).json({ success: false, error: (error as Error).message });
      }
      metrics.errors++;
      logger.error('wait_for_all_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // =========================================================================
  // GET /services/health - List all health statuses
  // =========================================================================
  router.get('/services/health', (_req: Request, res: Response) => {
    try {
      const result = health.listStatus();
      res.json(result);
    } catch (error) {
      metrics.errors++;
      logger.error('list_health_failed', { error: (error as Error).message });
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}

// =============================================================================
// Fastify plugin export
// =============================================================================
export const healthPlugin: FastifyPluginAsync<{ deps: HealthRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { logger, metrics, health } = deps;

  // GET /services/health/:id
  fastify.get('/services/health/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const id = (request.params as any).id as string;
      const idValidation = validateIdentity(id);
      if (!idValidation.valid) {
        reply.code(400);
        return { error: idValidation.error };
      }

      const result = await health.check(id);
      return result;

    } catch (error) {
      metrics.errors++;
      logger.error('health_check_failed', { id: (request.params as any).id as string, error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });

  // NOTE: /wait/:id and POST /wait are NOT registered here in Fastify.
  // In Express, these shadowed the servicesPlugin versions (health mounted first).
  // In Fastify, duplicate routes throw. servicesPlugin owns the /wait endpoints
  // (tested, full-featured with polling loops). Health-specific wait logic
  // remains available via health.waitFor() / health.waitForAll() if needed.

  // GET /services/health
  fastify.get('/services/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = health.listStatus();
      return result;
    } catch (error) {
      metrics.errors++;
      logger.error('list_health_failed', { error: (error as Error).message });
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
