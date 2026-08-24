/**
 * Tuple Space Routes — Shared coordination for agent swarms
 *
 * POST   /tuples           — Write a tuple (out)
 * GET    /tuples           — Read tuples by pattern (rd)
 * DELETE /tuples           — Take tuples by pattern (in — removes matches)
 * GET    /tuples/poll      — Poll for the next matching tuple after a cursor
 * GET    /tuples/scan      — List all tuples
 * GET    /tuples/count     — Count tuples
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { TupleSpace } from '../lib/tuples.js';
import {
  canMutateQuorumAuthorityTuple,
  isQuorumAuthorityTuple,
} from '../lib/quorum.js';
import {
  checkAdversarialProjectWrite,
  checkAdversarialTupleFields,
  projectForTupleKey,
} from '../lib/coordination-route-guard.js';

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
    if (isQuorumAuthorityTuple(fields)) {
      reply.code(403);
      return {
        success: false,
        error: 'quorum authority tuples can only be written by the trusted quorum service',
        code: 'QUORUM_TUPLE_AUTHORITY_RESERVED',
      };
    }

    // Adversarial-fleet projects (inferred from the first field, which is
    // the tuple key by convention) require envelope-encrypted bodies.
    // Ordinary tuples are unaffected.
    const inferred = projectForTupleKey(typeof fields[0] === 'string' ? fields[0] : '');
    let outFields = fields;
    if (inferred) {
      const guard = checkAdversarialProjectWrite(inferred, request.body);
      if (guard.ok === false) {
        reply.code(guard.code);
        return {
          success: false,
          error: guard.reason,
          code: 'ADVERSARIAL_PROJECT_GUARD',
        };
      }
      const fieldsGuard = checkAdversarialTupleFields(fields);
      if (fieldsGuard.ok === false) {
        reply.code(fieldsGuard.code);
        return {
          success: false,
          error: fieldsGuard.reason,
          code: 'ADVERSARIAL_PROJECT_GUARD',
        };
      }
      // Persist the envelope JSON as the tuple body (fields[1]) so the
      // ciphertext is what's stored, not the sentinel marker.
      if (guard.envelopeRequired && guard.envelope) {
        outFields = [fields[0], JSON.stringify(guard.envelope)];
      }
    }

    const tuple = tuples.out(outFields, {
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
    if (canMutateQuorumAuthorityTuple(pattern)) {
      reply.code(403);
      return {
        success: false,
        error: 'generic tuple deletion cannot select the reserved quorum authority namespace',
        code: 'QUORUM_TUPLE_AUTHORITY_RESERVED',
      };
    }

    const taken = tuples.take(pattern, {
      harbor: (harbor as string) || undefined,
      limit: typeof limit === 'number' ? limit : undefined,
    });

    return { success: true, taken, count: taken.length };
  });

  // GET /tuples/poll?pattern=[...]&harbor=...&after=...&limit=N — Poll for next matching tuple
  app.get('/tuples/poll', async (request: FastifyRequest, reply: FastifyReply) => {
    const {
      pattern: patternStr,
      harbor,
      after: afterStr,
      limit: limitStr,
    } = request.query as Record<string, string | undefined>;
    const afterId = afterStr ? parseInt(afterStr, 10) : 0;
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

    const result = tuples.poll(pattern, {
      harbor,
      afterId,
      limit,
    });
    return { success: true, tuple: result.tuple, lastId: result.lastId };
  });

  // GET /tuples/scan?harbor=...&limit=...&query=...&pattern=[...] — List tuples
  app.get('/tuples/scan', async (request: FastifyRequest) => {
    const { harbor, limit: limitStr, query, pattern: patternStr } = request.query as Record<string, string | undefined>;
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10), 1), 500) : 200;

    let all = patternStr
      ? (() => {
          try {
            const pattern = JSON.parse(patternStr) as unknown[];
            return Array.isArray(pattern) ? tuples.rd(pattern, { harbor, limit }) : [];
          } catch {
            return [];
          }
        })()
      : tuples.scan(harbor);

    if (query && query.trim()) {
      const needle = query.trim().toLowerCase();
      all = all.filter((tuple) => {
        const haystack = JSON.stringify({
          fields: tuple.fields,
          writtenBy: tuple.writtenBy,
          harbor: tuple.harbor,
        }).toLowerCase();
        return haystack.includes(needle);
      });
    }

    const sliced = all.slice(0, limit);
    return { success: true, tuples: sliced, count: sliced.length };
  });

  // GET /tuples/count?harbor=... — Count tuples
  app.get('/tuples/count', async (request: FastifyRequest) => {
    const { harbor } = request.query as Record<string, string | undefined>;
    const c = tuples.count(undefined, harbor);
    return { success: true, count: c };
  });
};
