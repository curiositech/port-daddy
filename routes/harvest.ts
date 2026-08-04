/**
 * Session Harvest Routes — note→episode promotion + related-work recall.
 *
 * POST /harvest/session/:id — harvest a session's notes into harbor memory
 *   episodes (persistEpisode gate: citations, schema, idempotency).
 * GET  /harvest/related     — task-conditioned recall over the harbor episode
 *   store via recallEpisodes (hybrid TF-IDF + dense, RRF fusion, budget-capped,
 *   validity-filtered). Lexical-only is NEVER a silent fallback: without an
 *   embedder this route refuses with 503 (ADR-0097 §4).
 */

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { harvestSession } from '../lib/session-harvest.js';
import {
  recallEpisodes,
  SEARCH_QUERY_SCHEMA,
  type RecallQuery,
  type Embedder,
} from '../lib/agent-harbor/memory-episodes.js';
import type { Database } from 'better-sqlite3';

interface HarvestRouteDeps {
  logger: {
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number };
  db: Database;
  /** Shared local embedder (server.ts galaxyEmbedder). Absent ⇒ /harvest/related refuses with 503. */
  embedder?: Embedder;
  /** Note-encryption inspector — harvest skips encrypted-at-rest notes. */
  noteEncryption?: { isEncrypted(content: string): boolean };
  blobs?: {
    store(content: string, opts: { mimeType?: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export const harvestPlugin: FastifyPluginAsync<{ deps: HarvestRouteDeps }> = async (
  fastify,
  { deps },
) => {
  const { db } = deps;

  fastify.post<{ Params: { id: string } }>(
    '/harvest/session/:id',
    async (req, reply) => {
      const sessionId = req.params.id;
      try {
        const result = await harvestSession(sessionId, db, {
          noteEncryption: deps.noteEncryption,
          blobs: deps.blobs,
        });
        return reply.send({
          sessionId,
          episodeIds: result.episodeIds,
          promoted: result.promoted,
          skipped: result.skipped,
          redacted: result.redacted,
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
   * Hybrid recall over harbor memory episodes: the FULL validity-filtered
   * candidate set is scored (TF-IDF + dense cosine, RRF k=60) before any cut —
   * no recency pre-cut can drop an old exact match anymore. Hits carry their
   * citations; the snippet is a convenience copy, the citation is the truth.
   */
  fastify.get('/harvest/related', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const purpose = query.purpose ?? '';
    const parsedLimit = parseInt(query.limit ?? '5', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 20) : 5;

    if (!purpose.trim()) {
      return reply.status(400).send({ error: 'purpose is required' });
    }

    if (!deps.embedder) {
      // Honest refusal, never a silent lexical fallback (ADR-0097 §4). A
      // caller that WANTS degraded lexical ranking must use the recall
      // engine's explicit mode:'lexical' opt-in — this route does not offer it.
      return reply.status(503).send({
        error: 'related-work recall requires the shared embedder and it is unavailable; ' +
          'lexical-only ranking is an explicit opt-in (mode: "lexical" via the recall engine), never a silent fallback',
        code: 'EMBEDDER_UNAVAILABLE',
      });
    }

    try {
      const recallQuery: RecallQuery = {
        schema: SEARCH_QUERY_SCHEMA,
        queryId: `related_${randomUUID()}`,
        issuedAt: new Date().toISOString(),
        issuedBy: { kind: 'daemon' },
        queryText: purpose,
        mode: 'hybrid',
        sources: ['memory-episodes'],
        budget: { maxResults: limit, maxContextTokens: 2000 },
        // recencyWeight 0.05, NOT the 0.2 welcome-briefing default. Related-
        // work lookup exists to resurface exact past work however old it is;
        // RRF fused relevance is rank-flat (rank1 vs rank2 differ by ~1.6%),
        // so at recencyWeight 0.2 twenty recent partial matches outscore a
        // year-old exact match (0.85 vs 0.74 in the P7 regression corpus) —
        // re-creating the recency trap this rewrite removes. Measured in
        // tests/unit/harvest-recall-quality.test.ts (P7).
        retrievalHints: { fusion: 'rrf', recencyWeight: 0.05 },
      };
      const result = await recallEpisodes(db, recallQuery, { embedder: deps.embedder });

      return reply.send({
        results: result.hits.map((hit) => ({
          type: 'episode',
          id: hit.episodeId,
          summary: hit.snippet,
          score: hit.score,
          sessionId: hit.sessionId,
          occurredAt: hit.occurredAt,
          citations: hit.citations,
          retrieve: hit.sessionId ? `pd session ${hit.sessionId}` : null,
        })),
        query: purpose,
        engine: result.engine,
        budget: result.budget,
        hint: `Run \`pd memory find "${purpose}"\` for more results.`,
      });
    } catch (err) {
      deps.metrics.errors++;
      deps.logger.error('GET /harvest/related failed', { err });
      return reply.status(500).send({ error: 'related work search failed' });
    }
  });
};
