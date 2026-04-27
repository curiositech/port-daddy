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
import { getRoadmapProgress } from '../lib/roadmap-progress.js';

interface CartographerDeps {
  /**
   * Daemon's own project directory — the canonical repo to read
   * roadmap files from when the request omits `root`.
   */
  daemonDir: string;
}

export const cartographerPlugin: FastifyPluginAsync<{ deps: CartographerDeps }> = async (
  fastify,
  opts,
) => {
  const { deps } = opts;

  fastify.get('/cartographer/roadmap-progress', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, unknown>;
    const rootDir = typeof q.root === 'string' && q.root.length > 0 ? q.root : deps.daemonDir;

    try {
      const progress = getRoadmapProgress({ rootDir });
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
