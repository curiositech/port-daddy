/**
 * Galaxy routes — the session-galaxy HTTP surface.
 *
 *   GET /galaxy/map          — 2-D embedding map of recent agent sessions
 *   GET /galaxy/session/:id  — full click-through detail for one galaxy point
 *
 * Params are hand-validated (routes/parley.ts idiom): a param that is present
 * but unparsable is a 400, an omitted param falls back to the daemon-owned
 * default inside lib/galaxy.ts. Responses use the { success } envelope and
 * never throw to Fastify.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { GalaxyModule } from '../lib/galaxy.js';

interface GalaxyRouteDeps {
  galaxy: GalaxyModule;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/** True when a query param was supplied at all (empty string counts as absent). */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export const galaxyPlugin: FastifyPluginAsync<{ deps: GalaxyRouteDeps }> = async (fastify, opts) => {
  const { galaxy } = opts.deps;

  fastify.get('/galaxy/map', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;

    // A numeric param that is present but not a positive integer is a client
    // error — reject rather than silently substituting the default.
    const numeric: Record<string, number | undefined> = {};
    for (const name of ['windowHours', 'tailTokens', 'minTokens', 'limit'] as const) {
      if (!isPresent(query[name])) continue;
      const parsed = asPositiveInt(query[name]);
      if (parsed === undefined) {
        reply.code(400);
        return { success: false, error: `${name} must be a positive integer` };
      }
      numeric[name] = parsed;
    }

    try {
      const map = await galaxy.getMap({
        windowHours: numeric.windowHours,
        tailTokens: numeric.tailTokens,
        minTokens: numeric.minTokens,
        limit: numeric.limit,
        project: asString(query.project) ?? null,
      });
      return map;
    } catch (error) {
      reply.code(500);
      return { success: false, error: error instanceof Error ? error.message : 'galaxy map failed' };
    }
  });

  fastify.get('/galaxy/session/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id?: string };
    const id = asString(params.id);
    if (!id) {
      reply.code(400);
      return { success: false, error: 'transcript id required in path' };
    }
    try {
      const detail = galaxy.getSessionDetail(id);
      if (!detail) {
        reply.code(404);
        return { success: false, error: 'not found' };
      }
      return { success: true, detail };
    } catch (error) {
      reply.code(500);
      return { success: false, error: error instanceof Error ? error.message : 'galaxy detail failed' };
    }
  });
};
