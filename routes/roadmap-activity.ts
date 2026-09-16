/**
 * Roadmap Activity Routes — `/roadmap/activity` + `/roadmap/items/:slug/activity`
 *
 * HTTP wrapper over `lib/roadmap-activity.ts`, the live-work join between
 * roadmap items and in-flight agent work (operator mandate 2026-08-22:
 * the roadmap must show ACTIVE IN-PROGRESS AGENT WORK and let the operator
 * jump into live transcripts).
 *
 *   GET /roadmap/items/:slug/activity — who is on this item RIGHT NOW:
 *       attachments with honest liveness (active/stale/done), the cockpit
 *       links (/agents/:id/stream SSE; interrupt is a capability-flagged
 *       affordance, not a wired control — see RoadmapInterruptAffordance),
 *       transcript timeline URLs (/sessions/:id/events), the item's
 *       canonical dispatch state, and any held HITL approvals.
 *
 *   GET /roadmap/activity — the board-wide feed: every item with in-flight
 *       work, its stage in the operator's flow vocabulary
 *       (stacked → executing → review → done) as a documented rollup over
 *       the canonical dispatches.state enum, plus header counts including
 *       failed/rejected/salvage attention items.
 *
 * Kept as a separate plugin (not folded into routes/roadmap.ts) on purpose:
 * this is a read-only derived view with its own dep (`roadmapActivity`),
 * and the separation keeps the slice disjoint from concurrent work on the
 * roadmap CRUD routes. Registration lives in routes/index.ts, gated on the
 * dep being present — the same mount pattern the roadmap plugin uses.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { RoadmapActivity } from '../lib/roadmap-activity.js';

interface RoadmapActivityRouteDeps {
  roadmapActivity: RoadmapActivity;
}

/**
 * Coerce an unknown query value into a trimmed non-empty string.
 * Motivation: Fastify query params arrive untyped; every filter here is
 * optional and a blank string must behave like "absent", not like a filter
 * that matches nothing.
 *
 * @param v - Raw query value.
 * @returns The trimmed string, or undefined.
 */
function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Coerce an unknown query value into a positive integer (listing cap).
 * Purpose: reject NaN/negative/zero caps so the lib layer's defaults win
 * instead of a garbage limit silently emptying the feed.
 *
 * @param v - Raw query value.
 * @returns Positive integer, or undefined when unusable.
 */
function asPosInt(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Interpret common truthy query spellings for boolean flags. Why: query
 * strings deliver '1'/'true' as strings; accepting both spellings keeps
 * curl-driven operators and typed SDK callers on the same behavior.
 *
 * @param v - Raw query value.
 * @returns True for '1'/'true'/true.
 */
function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === '1';
}

/**
 * The roadmap-activity Fastify plugin. Read-only by design — both routes
 * are pure projections; nothing here writes coordination state, so the
 * plugin needs no guard hooks and cannot corrupt the plan-of-record.
 *
 * @param fastify - Fastify instance.
 * @param opts - `{ deps: { roadmapActivity } }` from routes/index.ts.
 * @returns Resolves when routes are registered.
 */
export const roadmapActivityPlugin: FastifyPluginAsync<{ deps: RoadmapActivityRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { roadmapActivity } = opts.deps;

  // Board-wide feed. Registered before the per-item route only for reading
  // order; Fastify path matching keeps them unambiguous either way.
  fastify.get('/roadmap/activity', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const q = (request.query ?? {}) as Record<string, unknown>;
      const board = roadmapActivity.board({
        harbor: asString(q.harbor),
        includeStacked: asBool(q.includeStacked),
        limit: asPosInt(q.limit),
      });
      return { success: true, ...board };
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'roadmap activity board failed',
      };
    }
  });

  // Per-item live-work join. 404 only for an unknown slug — an existing
  // item with no in-flight work returns 200 with attachments: [] (the null
  // state the UI renders), because "nobody is on this" is an answer, not
  // an error.
  fastify.get(
    '/roadmap/items/:slug/activity',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { slug?: string };
      const slug = asString(params.slug);
      if (!slug) {
        reply.code(400);
        return { success: false, error: 'slug required in path' };
      }
      try {
        const q = (request.query ?? {}) as Record<string, unknown>;
        const activity = roadmapActivity.itemActivity(slug, { harbor: asString(q.harbor) });
        if (!activity) {
          reply.code(404);
          return { success: false, error: `roadmap item '${slug}' not found` };
        }
        return { success: true, activity };
      } catch (error) {
        reply.code(500);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'roadmap item activity failed',
        };
      }
    },
  );
};
