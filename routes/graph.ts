import type { FastifyPluginAsync } from 'fastify';
import type { GraphEdges } from '../lib/graph-edges.js';

interface GraphRouteDeps {
  graphEdges: GraphEdges;
  metrics: { errors: number };
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export const graphPlugin: FastifyPluginAsync<{ deps: GraphRouteDeps }> = async (fastify, opts) => {
  const { graphEdges, metrics, logger } = opts.deps;

  fastify.get('/graph/edges', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const edges = graphEdges.list({
        projectDir: query.projectDir,
        scope: query.scope,
        sourceType: query.sourceType,
        sourceId: query.sourceId,
        edgeType: query.edgeType,
        targetType: query.targetType,
        targetId: query.targetId,
        query: query.query || query.q,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, edges, count: edges.length };
    } catch (error) {
      metrics.errors++;
      logger.error('graph_edges_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/graph/stats', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      return { success: true, ...graphEdges.stats(query.projectDir) };
    } catch (error) {
      metrics.errors++;
      logger.error('graph_stats_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
