/**
 * Config Routes
 *
 * Configuration loading endpoint.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loadConfig } from '../lib/config.js';

interface ConfigRouteDeps {
  metrics: { errors: number };
}

/**
 * Create config routes
 *
 * @param deps - Route dependencies
 * @returns Express router with config routes
 */


// =============================================================================
// Fastify plugin export
// =============================================================================
export const configPlugin: FastifyPluginAsync<{ deps: ConfigRouteDeps }> = async (fastify, opts) => {
  const { deps } = opts;
  const { metrics } = deps;

  // GET /config
  fastify.get('/config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { dir } = request.query as any;
      const targetDir: string = (dir as string) || process.cwd();

      const config = loadConfig(targetDir);

      if (!config) {
        reply.code(404);
        return {
          success: false,
          error: 'No .portdaddyrc found',
          suggestion: 'Run port-daddy scan to create one'
        };
      }

      return {
        success: true,
        config,
        path: (config as Record<string, unknown>)._path
      };

    } catch (error) {
      if ((error as Error).message.includes('Failed to parse')) {
        reply.code(400);
        return { success: false, error: (error as Error).message };
      }
      metrics.errors++;
      reply.code(500);
      return { error: 'internal server error' };
    }
  });
};
