/**
 * Popper Routes — HTTP surface over `lib/roadmap-popper.ts`.
 *
 * GET    /popper/status                — counts + next candidate + pause flag
 * GET    /popper/next                  — what would pop next (dry-run)
 * POST   /popper/pop                   — pop one now (operator override)
 * POST   /popper/eligibility           — toggle nightshift_eligible on a roadmap row (body: { slug, eligible })
 *
 * The popper is a producer of `dispatch.state='proposed'` rows. It never
 * spawns work, never merges. These endpoints expose the same actions the
 * `pd popper` CLI exposes, so FleetBar's Nightshift surface can show
 * "next pop in 2h 14m" and "pop one now" without shelling out.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from 'better-sqlite3';

interface PopperRouteDeps {
  deps: {
    /** SQLite handle */
    db: Database;
    /** The popper instance (factory output from lib/roadmap-popper.ts) */
    popper: {
      popNext: (harbor?: string) => Promise<{ itemId: string; itemSlug: string; dispatchId: string } | null>;
      nextCandidate: (harbor?: string) => unknown;
      status: (harbor?: string) => unknown;
    };
  };
}

const popperPlugin: FastifyPluginAsync<PopperRouteDeps> = async (fastify, { deps }) => {
  const { db, popper } = deps;

  fastify.get('/popper/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const harbor = (req.query as Record<string, string | undefined>).harbor;
    return reply.send({ ok: true, ...popper.status(harbor) });
  });

  fastify.get('/popper/next', async (req: FastifyRequest, reply: FastifyReply) => {
    const harbor = (req.query as Record<string, string | undefined>).harbor;
    const candidate = popper.nextCandidate(harbor);
    return reply.send({ ok: true, candidate });
  });

  fastify.post('/popper/pop', async (req: FastifyRequest, reply: FastifyReply) => {
    const harbor = (req.query as Record<string, string | undefined>).harbor;
    try {
      const popped = await popper.popNext(harbor);
      return reply.send({ ok: true, popped });
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  fastify.post<{ Body: { slug: string; eligible: boolean; harbor?: string } }>(
    '/popper/eligibility',
    async (req, reply) => {
      const body = req.body ?? ({} as { slug: string; eligible: boolean });
      if (!body.slug || typeof body.slug !== 'string') {
        return reply.code(400).send({ ok: false, error: "missing 'slug'" });
      }
      if (typeof body.eligible !== 'boolean') {
        return reply.code(400).send({ ok: false, error: "missing or non-boolean 'eligible'" });
      }
      const harbor = body.harbor ?? 'port-daddy';
      const result = db.prepare(
        `UPDATE roadmap_items
           SET nightshift_eligible = ?, last_touched_at = ?
           WHERE slug = ? AND harbor = ?`
      ).run(body.eligible ? 1 : 0, Date.now(), body.slug, harbor);
      if (result.changes === 0) {
        return reply.code(404).send({
          ok: false,
          error: `no roadmap item with slug='${body.slug}' in harbor='${harbor}'`,
        });
      }
      return reply.send({ ok: true, slug: body.slug, eligible: body.eligible });
    },
  );
};

export { popperPlugin };
