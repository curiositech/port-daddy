/**
 * Tuple Space Routes — Shared coordination for agent swarms
 *
 * POST   /tuples           — Write a tuple (out)
 * GET    /tuples           — Read tuples by pattern (rd)
 * DELETE /tuples           — Take tuples by pattern (in — removes matches)
 * GET    /tuples/scan      — List all tuples
 * GET    /tuples/count     — Count tuples
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { TupleSpace } from '../lib/tuples.js';

interface TupleOpts {
  tuples: TupleSpace;
}

export const tuplesPlugin: FastifyPluginAsync<TupleOpts> = async (app, opts) => {
  const { tuples } = opts;

  // POST /tuples — Write a tuple
  app.post('/tuples', async (request: FastifyRequest, reply: FastifyReply) => {
    const { fields, harbor, writtenBy, ttlMs } = request.body as Record<string, unknown>;

    if (!Array.isArray(fields) || fields.length === 0) {
      reply.code(400);
      return { success: false, error: 'fields must be a non-empty array', code: 'VALIDATION_ERROR' };
    }

    const tuple = tuples.out(fields, {
      harbor: (harbor as string) || undefined,
      writtenBy: (writtenBy as string) || undefined,
      ttlMs: typeof ttlMs === 'number' ? ttlMs : undefined,
    });

    return { success: true, tuple };
  });

  // GET /tuples?pattern=[...]&harbor=...&limit=N — Read by pattern
  app.get('/tuples', async (request: FastifyRequest, reply: FastifyReply) => {
    const { pattern: patternStr, harbor, limit: limitStr } = request.query as Record<string, string | undefined>;
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    let pattern: unknown[] = ['*'];
    if (patternStr) {
      try {
        pattern = JSON.parse(patternStr);
        if (!Array.isArray(pattern)) {
          reply.code(400);
          return { success: false, error: 'pattern must be a JSON array' };
        }
      } catch {
        reply.code(400);
        return { success: false, error: 'pattern must be valid JSON array' };
      }
    }

    const matches = tuples.rd(pattern, { harbor, limit });
    return { success: true, tuples: matches, count: matches.length };
  });

  // DELETE /tuples — Take (remove) matching tuples
  app.delete('/tuples', async (request: FastifyRequest, reply: FastifyReply) => {
    const { pattern, harbor, limit } = request.body as Record<string, unknown>;

    if (!Array.isArray(pattern)) {
      reply.code(400);
      return { success: false, error: 'pattern must be a JSON array' };
    }

    const taken = tuples.take(pattern, {
      harbor: (harbor as string) || undefined,
      limit: typeof limit === 'number' ? limit : undefined,
    });

    return { success: true, taken, count: taken.length };
  });

  // GET /tuples/scan?harbor=... — List all tuples
  app.get('/tuples/scan', async (request: FastifyRequest) => {
    const { harbor } = request.query as Record<string, string | undefined>;
    const all = tuples.scan(harbor);
    return { success: true, tuples: all, count: all.length };
  });

  // GET /tuples/count?harbor=... — Count tuples
  app.get('/tuples/count', async (request: FastifyRequest) => {
    const { harbor } = request.query as Record<string, string | undefined>;
    const c = tuples.count(undefined, harbor);
    return { success: true, count: c };
  });
};
