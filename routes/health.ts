/**
 * Health Routes
 *
 * Handles service health monitoring and wait operations.
 * Extracted from server.js lines 1415-1501.
 */

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
