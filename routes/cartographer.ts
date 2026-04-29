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

interface CartographerDeps {
  /**
   * Daemon's own project directory — the canonical repo to read
   * roadmap files from when the request omits `root`.
   */
  daemonDir: string;
  feedback?: Pick<Feedback, 'list' | 'summary'>;
}

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
};
