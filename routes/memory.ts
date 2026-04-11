import type { FastifyPluginAsync } from 'fastify';
import type { EpisodicMemory } from '../lib/episodic-memory.js';

interface MemoryRouteDeps {
  episodicMemory: EpisodicMemory;
  metrics: { errors: number };
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export const memoryPlugin: FastifyPluginAsync<{ deps: MemoryRouteDeps }> = async (fastify, opts) => {
  const { episodicMemory, metrics, logger } = opts.deps;

  fastify.get('/memory/episodes', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      const episodes = episodicMemory.list({
        projectDir: query.projectDir,
        project: query.project,
        harbor: query.harbor,
        agentId: query.agentId,
        episodeType: query.episodeType,
        query: query.query || query.q,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, episodes, count: episodes.length };
    } catch (error) {
      metrics.errors++;
      logger.error('memory_episodes_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/memory/stats', async (request, reply) => {
    try {
      const query = (request.query as Record<string, string | undefined>) || {};
      return {
        success: true,
        ...episodicMemory.stats(query.projectDir, query.project),
      };
    } catch (error) {
      metrics.errors++;
      logger.error('memory_stats_error', { error: (error as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
