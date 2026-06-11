/**
 * Session Harvest Routes — manual and triggered note→episode promotion.
 *
 * POST /harvest/session/:id — harvest a specific session's notes into episodes.
 * GET  /harvest/related    — BM25 search for related past work by purpose string.
 */

import type { FastifyPluginAsync } from 'fastify';
import { harvestSession } from '../lib/session-harvest.js';
import type { EpisodicMemory } from '../lib/episodic-memory.js';
import type { Database } from 'better-sqlite3';

interface HarvestRouteDeps {
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  db: Database;
  episodicMemory: EpisodicMemory;
  blobs?: {
    store(content: string, opts: { mimeType?: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export const harvestPlugin: FastifyPluginAsync<{ deps: HarvestRouteDeps }> = async (
  fastify,
  { deps },
) => {
  const { db, episodicMemory } = deps;

  fastify.post<{ Params: { id: string } }>(
    '/harvest/session/:id',
    async (req, reply) => {
      const sessionId = req.params.id;
      try {
        const result = await harvestSession(sessionId, db, {
          episodicMemory,
          blobs: deps.blobs,
        });
        return reply.send({
          sessionId,
          episodeIds: result.episodeIds,
          promoted: result.promoted,
          skipped: result.skipped,
        });
      } catch (err) {
        deps.metrics.errors++;
        deps.logger.error('POST /harvest/session failed', { err, sessionId });
        return reply.status(500).send({ error: 'harvest failed' });
      }
    },
  );

  /**
   * GET /harvest/related?purpose=<text>&limit=5
   *
   * BM25 search over episode titles + summaries.
   * Returns compact stubs with retrieval commands.
   */
  fastify.get('/harvest/related', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const purpose = query.purpose ?? '';
    const parsedLimit = parseInt(query.limit ?? '5', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 20) : 5;

    if (!purpose.trim()) {
      return reply.status(400).send({ error: 'purpose is required' });
    }

    try {
      // BM25-style search using SQLite LIKE (full BM25 requires FTS5 — use if available)
      const terms = purpose
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 2)
        .slice(0, 8);

      if (terms.length === 0) {
        return reply.send({ results: [], query: purpose });
      }

      // Build a scored query: episodes matching more terms rank higher
      const whereClauses = terms.map(() => `(LOWER(title) LIKE ? OR LOWER(summary) LIKE ?)`).join(' OR ');
      const params: unknown[] = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
      params.push(limit * 3); // fetch more, dedupe/rank

      const rows = db.prepare(`
        SELECT id, episode_type, title, summary, source_type, source_id, project, created_at
        FROM episodic_memory
        WHERE ${whereClauses}
        ORDER BY updated_at DESC
        LIMIT ?
      `).all(...params) as Array<Record<string, unknown>>;

      // Score by term hit count
      const scored = rows
        .map(row => {
          const text = `${row.title} ${row.summary}`.toLowerCase();
          const hits = terms.filter(t => text.includes(t)).length;
          return { row, score: hits / terms.length };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return reply.send({
        results: scored.map(({ row, score }) => ({
          type: 'episode',
          id: row.id,
          episodeType: row.episode_type,
          title: row.title,
          summary: (row.summary as string).slice(0, 200),
          score,
          retrieve: `pd memory episode ${row.id}`,
          project: row.project,
        })),
        query: purpose,
        hint: `Run \`pd memory find "${purpose}"\` for more results.`,
      });
    } catch (err) {
      deps.metrics.errors++;
      deps.logger.error('GET /harvest/related failed', { err });
      return reply.status(500).send({ error: 'related work search failed' });
    }
  });
};
