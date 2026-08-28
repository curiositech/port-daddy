/**
 * Whois Routes — Semantic Phonebook
 *
 * GET /whois?q=<query>&kind=agent|human|any&fresh_min=<seconds>&limit=<n>
 *            [&semantic_review=true]
 *
 * Single endpoint by design — the cascade ranker is the canonical pattern,
 * and we deliberately do not expose stage-specific shortcuts (BM25-only,
 * semantic-only). If callers want to inspect the ranker, the response
 * includes `stage` on every hit.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Whois, WhoisKind } from '../lib/whois.js';

interface WhoisRouteDeps {
  whois: Whois;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

function parseKind(value: unknown): WhoisKind {
  if (value === 'agent' || value === 'human' || value === 'any') return value;
  return 'agent';
}

function parsePositiveInt(value: unknown, fallback: number, cap: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), cap);
}

/**
 * Parse the explicit product-admission switch without treating arbitrary text
 * as a search policy. The normal phonebook remains exact-first; callers that
 * may act on a peer must request an actual semantic resolver review.
 *
 * @param value - Raw query parameter value from Fastify.
 * @returns True only for the documented literal flag.
 */
function parseSemanticReview(value: unknown): boolean {
  return value === true || value === 'true';
}

export const whoisPlugin: FastifyPluginAsync<{ deps: WhoisRouteDeps }> = async (fastify, opts) => {
  const { whois, logger } = opts.deps;

  fastify.get('/whois', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const q = typeof query.q === 'string' ? query.q.trim() : '';
      if (!q) {
        reply.code(400);
        return { error: 'q required', code: 'VALIDATION_ERROR' };
      }

      const kind = parseKind(query.kind);
      const limit = parsePositiveInt(query.limit, 10, 100);
      const freshMinSeconds = query.fresh_min !== undefined
        ? parsePositiveInt(query.fresh_min, 0, 7 * 24 * 3600)
        : undefined;
      const semanticReview = parseSemanticReview(query.semantic_review);

      const hits = await whois.search(q, {
        kind,
        limit,
        freshMinSeconds: freshMinSeconds && freshMinSeconds > 0 ? freshMinSeconds : undefined,
        semanticReview,
      });

      return {
        success: true,
        query: q,
        kind,
        count: hits.length,
        hits,
      };
    } catch (err) {
      logger.error('whois_search_failed', { error: (err as Error).message });
      reply.code(500);
      return { error: 'internal error' };
    }
  });
};
