import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  getMaritimeActor,
  listMaritimeActors,
  projectMaritimeActor,
  type MaritimeActorProjectionDeps,
} from '../lib/maritime-actors.js';

interface ActorsRouteDeps extends MaritimeActorProjectionDeps {
  metrics?: { errors: number };
  logger?: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export const actorsPlugin: FastifyPluginAsync<{ deps: ActorsRouteDeps }> = async (fastify, opts) => {
  const deps = opts.deps;

  fastify.get('/actors', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return {
        success: true,
        actors: listMaritimeActors(deps),
      };
    } catch (err) {
      deps.metrics && (deps.metrics.errors += 1);
      deps.logger?.error?.('actors_list_failed', { error: (err as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });

  fastify.get('/actors/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const actor = getMaritimeActor((request.params as { id?: string }).id ?? '');
      if (!actor) {
        reply.code(404);
        return { success: false, error: 'actor not found' };
      }

      return {
        success: true,
        actor: projectMaritimeActor(actor, deps),
      };
    } catch (err) {
      deps.metrics && (deps.metrics.errors += 1);
      deps.logger?.error?.('actors_get_failed', { error: (err as Error).message });
      reply.code(500);
      return { success: false, error: 'internal server error' };
    }
  });
};
