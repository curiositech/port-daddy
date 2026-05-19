/**
 * Cartographer Route — `/cartographer/roadmap-progress`
 *
 * The FOMO-killer endpoint. Wraps `lib/roadmap-progress.ts` so the
 * dashboard, FleetBar, and `pd roadmap` CLI can render Cartographer's
 * curated state in a single fetch.
 *
 * Read-only. Cartographer (the fleet agent) is the only writer. We
 * never mutate `docs/ROADMAP.md`, `IDEAS-TROVE.md`,
 * `DOGFOOD-FEEDBACK.md`, `CURRENT-WORK.md`, or `.cartographer/status.md`
 * from this route.
 *
 * GET /cartographer/roadmap-progress?root=/path/to/repo
 *
 * Response shape: see `RoadmapProgress` in lib/roadmap-progress.ts.
 *
 * Why mounted at `/cartographer/...` rather than `/roadmap/...`:
 * Cartographer is the durable actor that owns this surface. Putting
 * the route under that namespace makes the ownership boundary obvious
 * to operators and consistent with `/actors/cartographer/*` patterns
 * we already use elsewhere.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Feedback, FeedbackStatus } from '../lib/feedback.js';
import { getRoadmapProgress } from '../lib/roadmap-progress.js';
import type { RoadmapPop, RoadmapPopKind } from '../lib/roadmap-pop.js';
import { ALL_KINDS } from '../lib/roadmap-pop.js';

interface CartographerDeps {
  /**
   * Daemon's own project directory — the canonical repo to read
   * roadmap files from when the request omits `root`.
   */
  daemonDir: string;
  feedback?: Pick<Feedback, 'list' | 'summary'>;
  /** Roadmap claim primitive (ADR-0033). When absent, /roadmap-pop returns 503. */
  roadmapPop?: RoadmapPop;
}

const ROADMAP_POP_KINDS = new Set<RoadmapPopKind | 'any'>(['any', ...ALL_KINDS]);

const FEEDBACK_STATUSES = new Set<FeedbackStatus | 'all'>(['open', 'harvested', 'wontfix', 'all']);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const cartographerPlugin: FastifyPluginAsync<{ deps: CartographerDeps }> = async (
  fastify,
  opts,
) => {
  const { deps } = opts;

  fastify.get('/cartographer/roadmap-progress', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, unknown>;
    const rootDir = asString(q.root) ?? deps.daemonDir;
    const feedbackHarbor = asString(q.feedbackHarbor);
    const feedbackStatusRaw = asString(q.feedbackStatus);
    const feedbackStatus = feedbackStatusRaw && FEEDBACK_STATUSES.has(feedbackStatusRaw as FeedbackStatus | 'all')
      ? feedbackStatusRaw as FeedbackStatus | 'all'
      : undefined;
    const feedbackLimit = asPositiveInt(q.feedbackLimit);

    try {
      const progress = getRoadmapProgress({
        rootDir,
        feedback: deps.feedback,
        feedbackHarbor,
        feedbackStatus,
        feedbackLimit,
      });
      return progress;
    } catch (error) {
      reply.code(500);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read roadmap progress',
      };
    }
  });

  /**
   * Pop one entry off the curated pile and atomically claim it (ADR-0033).
   *
   * Body: { claimedBy, kind?, slug?, root?, feedbackHarbor? }
   *
   * 201 → { success, entry, claim }
   * 404 → { success: false, reason: 'pile-empty' | 'slug-not-on-pile' }
   * 409 → { success: false, reason: 'slug-already-claimed', claim }
   * 503 → claim primitive not wired (older daemon profile)
   */
  fastify.post('/cartographer/roadmap-pop', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.roadmapPop) {
      reply.code(503);
      return { success: false, error: 'roadmap-pop primitive not available on this daemon' };
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const claimedBy = asString(body.claimedBy);
    if (!claimedBy) {
      reply.code(400);
      return { success: false, error: 'claimedBy is required' };
    }

    const kindRaw = asString(body.kind);
    const kind = kindRaw && ROADMAP_POP_KINDS.has(kindRaw as RoadmapPopKind | 'any')
      ? (kindRaw as RoadmapPopKind | 'any')
      : 'any';

    const slug = asString(body.slug);
    const rootDir = asString(body.root) ?? deps.daemonDir;
    const feedbackHarbor = asString(body.feedbackHarbor);
    const sessionId = asString(body.sessionId);
    const agentId = asString(body.agentId);

    try {
      const result = deps.roadmapPop.pop({ claimedBy, kind, slug, rootDir, feedbackHarbor, sessionId, agentId });
      if ('reason' in result) {
        if (result.reason === 'slug-already-claimed') {
          reply.code(409);
          return { success: false, reason: result.reason, slug: result.slug, claim: result.claim };
        }
        reply.code(404);
        if (result.reason === 'slug-not-on-pile') {
          return { success: false, reason: result.reason, slug: result.slug };
        }
        return { success: false, reason: result.reason };
      }
      reply.code(201);
      return { success: true, entry: result.entry, claim: result.claim };
    } catch (error) {
      reply.code(400);
      return { success: false, error: error instanceof Error ? error.message : 'pop failed' };
    }
  });

  fastify.post('/cartographer/roadmap-release', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.roadmapPop) {
      reply.code(503);
      return { success: false, error: 'roadmap-pop primitive not available on this daemon' };
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const slug = asString(body.slug);
    const releasedBy = asString(body.releasedBy);
    const reason = asString(body.reason);
    if (!slug || !releasedBy) {
      reply.code(400);
      return { success: false, error: 'slug and releasedBy are required' };
    }
    try {
      const result = deps.roadmapPop.release({ slug, releasedBy, reason });
      if (!result.released) {
        reply.code(404);
        return { success: false, error: `no active claim for slug '${slug}'` };
      }
      return { success: true, released: true, claim: result.claim };
    } catch (error) {
      reply.code(400);
      return { success: false, error: error instanceof Error ? error.message : 'release failed' };
    }
  });

  fastify.get('/cartographer/roadmap-claims', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.roadmapPop) {
      reply.code(503);
      return { success: false, error: 'roadmap-pop primitive not available on this daemon' };
    }
    const q = (request.query ?? {}) as Record<string, unknown>;
    const statusRaw = asString(q.status);
    const status = statusRaw === 'released' || statusRaw === 'all' ? statusRaw : 'open';
    const claimedBy = asString(q.claimedBy);
    const limit = asPositiveInt(q.limit);
    const claims = deps.roadmapPop.listClaims({ status, claimedBy, limit });
    return { success: true, claims, count: claims.length };
  });

  /**
   * Link an existing claim to a session and/or agent (ADR-0034). Used by
   * `pop --begin` after `pd begin` returns the new IDs, and by the manual
   * `pd roadmap claim-link` rebind verb.
   *
   * Body: { slug? | claimId?, sessionId?, agentId?, force? }
   *   - one of {slug, claimId} required
   *   - at least one of {sessionId, agentId} required
   *
   * 200 → { success: true, claim }
   * 404 → { success: false, reason: 'no-active-claim' }
   * 409 → { success: false, reason: 'already-linked', claim }   (use force:true to rebind)
   * 503 → claim primitive not wired
   */
  fastify.post('/cartographer/roadmap-claim-link', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.roadmapPop) {
      reply.code(503);
      return { success: false, error: 'roadmap-pop primitive not available on this daemon' };
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const slug = asString(body.slug);
    const claimId = asPositiveInt(body.claimId);
    const sessionId = asString(body.sessionId);
    const agentId = asString(body.agentId);
    const force = body.force === true;

    if (!slug && !claimId) {
      reply.code(400);
      return { success: false, error: 'slug or claimId required' };
    }
    if (!sessionId && !agentId) {
      reply.code(400);
      return { success: false, error: 'at least one of sessionId or agentId required' };
    }

    try {
      const result = deps.roadmapPop.linkClaim({ slug, claimId, sessionId, agentId, force });
      if (!result.ok) {
        reply.code(result.reason === 'already-linked' ? 409 : 404);
        return { success: false, reason: result.reason, claim: result.claim };
      }
      return { success: true, claim: result.claim };
    } catch (error) {
      reply.code(400);
      return { success: false, error: error instanceof Error ? error.message : 'link failed' };
    }
  });
};
