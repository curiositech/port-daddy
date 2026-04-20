import type { FastifyPluginAsync } from 'fastify';
import type { SemanticResolver, SemanticResolutionDecision } from '../lib/semantic-resolver.js';

interface SemanticRouteDeps {
  semanticResolver: SemanticResolver;
  metrics: { errors: number };
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Internal semantic-resolution API.
 *
 * Sample calls:
 * - `GET /semantic/stats?projectDir=/Users/erichowens/coding/port-daddy`
 * - `GET /semantic/resolutions?decision=review&limit=20`
 * - `GET /semantic/search?q=port+daddy+css+tokens&limit=5`
 *
 * Sample response payload:
 * ```json
 * {
 *   "success": true,
 *   "model": "Xenova/all-MiniLM-L6-v2",
 *   "autoThreshold": 0.88,
 *   "reviewThreshold": 0.8,
 *   "reviewBacklog": 3
 * }
 * ```
 */
export const semanticPlugin: FastifyPluginAsync<{ deps: SemanticRouteDeps }> = async (fastify, opts) => {
  const { semanticResolver, metrics, logger } = opts.deps;

  /**
   * Return threshold and backlog health for the embedding join policy.
   */
  fastify.get('/semantic/stats', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      return {
        success: true,
        ...semanticResolver.stats(query.projectDir),
      };
    } catch (error) {
      metrics.errors += 1;
      logger.error('semantic_stats_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  /**
   * Return recent persisted decisions so operators can inspect false positives,
   * misses, and near-threshold review candidates.
   */
  fastify.get('/semantic/resolutions', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const decision = query.decision as SemanticResolutionDecision | undefined;
      const resolutions = semanticResolver.listResolutions({
        projectDir: query.projectDir,
        decision,
        query: query.query || query.q,
        minSimilarity: query.minSimilarity ? parseFloat(query.minSimilarity) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, resolutions, count: resolutions.length };
    } catch (error) {
      metrics.errors += 1;
      logger.error('semantic_resolutions_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  /**
   * Run nearest-neighbor search over the known semantic term inventory.
   */
  fastify.get('/semantic/search', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const text = query.query || query.q;
      if (!text?.trim()) {
        reply.code(400);
        return { success: false, error: 'query is required' };
      }
      const matches = await semanticResolver.search(text, {
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, matches, count: matches.length };
    } catch (error) {
      metrics.errors += 1;
      logger.error('semantic_search_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
