/**
 * Harvest recall quality — the read-path half of the episodic-memory redo.
 *
 * Quality-bar properties from the design:
 *   P3 TTL is read-enforced (engine side): an episode past its validity never
 *      appears in recallEpisodes output, under an injected clock.
 *   P5 budget: recall never exceeds maxResults/maxContextTokens; the result's
 *      budget.used echoes real usage.
 *   P6 no silent lexical: GET /harvest/related without an embedder dep
 *      returns 503 naming the degraded-mode opt-in; it never returns
 *      lexically-ranked results unmarked.
 *   P7 recency-cut regression: 1 old exact-match episode + 20 recent partial
 *      matches, limit 5. The OLD /harvest/related logic (kept here as a
 *      reference implementation) drops the old episode via its
 *      `ORDER BY recency LIMIT limit*3` pre-cut; the new recallEpisodes route
 *      ranks it #1 with its citation. Corpus built through the REAL path:
 *      createSessions().addNote → harvestSession.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { harvestSession } from '../../lib/session-harvest.js';
import { harvestPlugin } from '../../routes/harvest.js';
import { sugarPlugin } from '../../routes/sugar.js';
import { createSugar } from '../../lib/sugar.js';
import {
  persistEpisode,
  recallEpisodes,
  estimateTokens,
  SEARCH_QUERY_SCHEMA,
  MEMORY_EPISODE_SCHEMA,
  type MemoryEpisode,
  type RecallQuery,
  type Embedder,
} from '../../lib/agent-harbor/memory-episodes.js';

/**
 * Deterministic stub embedder: 64-dim hashed token bag. Unlike a char-fold
 * stub, cosine over token bags actually reflects term overlap, so the
 * semantic leg behaves like a (crude) real embedder: exact-term matches
 * score high, one-shared-term partial matches score low.
 */
const stubEmbedder: Embedder = {
  modelId: 'stub-token-bag-64d/test',
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(64).fill(0);
      for (const tok of t.toLowerCase().split(/[^a-z0-9_./-]+/).filter((x) => x.length > 1)) {
        let h = 0;
        for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
        v[h % 64] += 1;
      }
      const norm = Math.sqrt(v.reduce((s: number, x: number) => s + x * x, 0)) || 1;
      return v.map((x: number) => x / norm);
    });
  },
};

let db: any;
let sessions: ReturnType<typeof createSessions>;

beforeEach(() => {
  db = createTestDb();
  sessions = createSessions(db);
});

afterEach(() => {
  db.close();
});

function recallQuery(queryText: string, overrides: Partial<RecallQuery> = {}): RecallQuery {
  return {
    schema: SEARCH_QUERY_SCHEMA,
    queryId: `q_${Math.random().toString(16).slice(2)}`,
    issuedAt: new Date().toISOString(),
    issuedBy: { kind: 'daemon' },
    queryText,
    mode: 'hybrid',
    sources: ['memory-episodes'],
    budget: { maxResults: 5, maxContextTokens: 1200 },
    // Matches routes/harvest.ts: related-work recall runs recency-light (see
    // the P7 arithmetic in that file's comment).
    retrievalHints: { fusion: 'rrf', recencyWeight: 0.05 },
    ...overrides,
  };
}

async function harvestNotes(
  purpose: string,
  notes: Array<{ content: string; type?: string; ageMs?: number }>,
): Promise<string> {
  const started = sessions.start(purpose, { agentId: 'agent-recall' }) as any;
  const sessionId = started.id ?? started.session?.id;
  for (const note of notes) {
    const res = sessions.addNote(sessionId, note.content, { type: note.type ?? 'finding' }) as any;
    expect(res.success).toBe(true);
    if (note.ageMs) {
      // Age the REAL note row — the content and citation stay real; only the
      // clock moves, which is exactly the recency trap under test.
      db.prepare('UPDATE session_notes SET created_at = ? WHERE id = ?')
        .run(Date.now() - note.ageMs, res.noteId);
    }
  }
  const result = await harvestSession(sessionId, db);
  expect(result.promoted).toBe(notes.length);
  return sessionId;
}

describe('P3 validity is read-enforced in recall', () => {
  test('an episode whose validUntil has passed never appears as a current fact', async () => {
    const nowIso = new Date().toISOString();
    const expired: MemoryEpisode = {
      schema: MEMORY_EPISODE_SCHEMA,
      episodeId: 'note-expired00000000000000',
      tier: 'recall',
      summary: 'stale fact: deployment uses the retired jenkins pipeline',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-02-01T00:00:00.000Z',
      ingestedAt: nowIso,
      extractedBy: { kind: 'daemon' },
      citations: [{ kind: 'claim', claimRef: 'session-note:sess-old:1', sessionId: 'sess-old' }],
      sourcePayloadState: 'present',
      importance: 9,
    };
    const open: MemoryEpisode = {
      ...expired,
      episodeId: 'note-open0000000000000000000',
      summary: 'current fact: deployment uses the github actions pipeline',
      validUntil: null,
    };
    expect(persistEpisode(db, expired).inserted).toBe(true);
    expect(persistEpisode(db, open).inserted).toBe(true);

    const result = await recallEpisodes(db, recallQuery('deployment pipeline'), {
      embedder: stubEmbedder,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });
    const ids = result.hits.map((h) => h.episodeId);
    expect(ids).toContain('note-open0000000000000000000');
    expect(ids).not.toContain('note-expired00000000000000');
  });
});

describe('P5 budget is an enforced cap', () => {
  test('recall never exceeds maxResults or maxContextTokens; usage is echoed', async () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({
      content: `Finding ${i}: retrieval budget discipline case number ${i} with plenty of words to weigh against the token meter`,
    }));
    await harvestNotes('budget corpus', notes);

    const result = await recallEpisodes(
      db,
      recallQuery('retrieval budget discipline', { budget: { maxResults: 4, maxContextTokens: 60 } }),
      { embedder: stubEmbedder },
    );

    expect(result.hits.length).toBeLessThanOrEqual(4);
    expect(result.budget.configured).toEqual({ maxResults: 4, maxContextTokens: 60 });
    expect(result.budget.used.results).toBe(result.hits.length);
    const snippetTokens = result.hits.reduce((s, h) => s + (h.snippet ? estimateTokens(h.snippet) : 0), 0);
    expect(snippetTokens).toBeLessThanOrEqual(60);
    expect(result.budget.used.contextTokensEstimate).toBe(snippetTokens);
    expect(result.budget.truncated).toBe(true);
    // Hits over the token budget keep their citations with snippet: null —
    // the citation is the truth, the snippet is a convenience copy.
    for (const hit of result.hits) {
      expect(hit.citations.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('P6 no silent lexical fallback on /harvest/related', () => {
  async function buildApp(deps: Record<string, unknown> = {}) {
    const app = Fastify();
    await app.register(harvestPlugin, {
      deps: {
        db,
        metrics: { errors: 0 },
        logger: { error: jest.fn() },
        ...deps,
      },
    } as any);
    return app;
  }

  test('embedder absent ⇒ 503 naming the lexical opt-in, never unmarked lexical results', async () => {
    await harvestNotes('lexical trap', [{ content: 'Finding: something searchable exists' }]);
    const app = await buildApp(); // no embedder dep

    const res = await app.inject({ method: 'GET', url: '/harvest/related?purpose=searchable' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.code).toBe('EMBEDDER_UNAVAILABLE');
    expect(body.error).toMatch(/lexical/i);
    expect(body.results).toBeUndefined();
    await app.close();
  });

  test('with the embedder the route serves hybrid-ranked, cited hits', async () => {
    const sessionId = await harvestNotes('happy path', [
      { content: 'Finding: notarytool signs the console bundle' },
    ]);
    const app = await buildApp({ embedder: stubEmbedder });

    const res = await app.inject({ method: 'GET', url: '/harvest/related?purpose=notarytool%20console' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.engine.mode).toBe('hybrid');
    expect(body.engine.fusion).toBe('rrf');
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    const hit = body.results[0];
    expect(hit.citations[0].claimRef).toMatch(new RegExp(`^session-note:${sessionId}:`));
    expect(hit.retrieve).toBe(`pd session ${sessionId}`);
    await app.close();
  });
});

describe('P8 read-in-practice: GET /sugar/welcome serves cited episodes from a real harvest', () => {
  test('a harvested finding surfaces in the welcome briefing relatedMemory with its citation', async () => {
    const DISTINCTIVE = 'Finding: deployed pd-console via cargo-bundle plus notarytool stapler';
    const sessionId = await harvestNotes('deploy the console', [{ content: DISTINCTIVE }]);

    // The real server.ts wiring shape: a recallEpisodes closure over the same
    // db + embedder, injected into createSugar, served by the real route.
    const recallMemory = async (
      queryText: string,
      budget: { maxResults: number; maxContextTokens: number },
    ) => {
      const result = await recallEpisodes(db, recallQuery(queryText, { budget }), { embedder: stubEmbedder });
      return {
        hits: result.hits as unknown as Array<Record<string, unknown>>,
        budget: result.budget as unknown as Record<string, unknown>,
      };
    };
    const sugar = createSugar({
      agents: { register: () => ({ success: true }), unregister: () => ({ success: true }), get: () => ({}) } as any,
      sessions: sessions as any,
      activityLog: { log: () => {} },
      feedback: {
        list: () => [{
          feedbackId: 'fb-p8', slug: 'deploy-console', summary: 'deployed console cargo-bundle notarytool question',
          severity: 'high', status: 'open', droppedBy: 'op', surface: null, at: Date.now(),
        }],
      },
      recallMemory,
    });

    const app = Fastify();
    await app.register(sugarPlugin, {
      deps: { sugar, metrics: { errors: 0 }, logger: { info: jest.fn(), error: jest.fn() } },
    } as any);

    const res = await app.inject({ method: 'GET', url: '/sugar/welcome' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.relatedMemory.available).toBe(true);
    expect(body.relatedMemory.hits.length).toBeGreaterThanOrEqual(1);
    const hit = body.relatedMemory.hits[0];
    expect(hit.snippet).toContain('notarytool');
    expect(hit.citations[0].claimRef).toMatch(new RegExp(`^session-note:${sessionId}:`));
    // Budget echo — the P5 invariant is auditable per response.
    expect(body.relatedMemory.budget.configured).toEqual({ maxResults: 5, maxContextTokens: 1200 });
    await app.close();
  });
});

describe('P7 recency-cut regression (before/after evidence)', () => {
  const OLD_FACT = 'deployed pd-console via cargo-bundle plus notarytool stapler';
  const LIMIT = 5;

  /**
   * REFERENCE IMPLEMENTATION of the old GET /harvest/related ranking, ported
   * onto the harvested corpus: recency-ordered `LIMIT limit*3` pre-cut, THEN
   * term-hit scoring. Kept verbatim in spirit so the regression is measured
   * against the actual defective algorithm, not a strawman.
   */
  function oldRelatedWork(purpose: string, limit: number): Array<{ episodeId: string; score: number }> {
    const terms = purpose.toLowerCase().split(/\s+/).filter((t) => t.length > 2).slice(0, 8);
    const whereClauses = terms.map(() => `LOWER(summary) LIKE ?`).join(' OR ');
    const params: unknown[] = terms.map((t) => `%${t}%`);
    params.push(limit * 3); // the recency pre-cut under test
    const rows = db.prepare(`
      SELECT episode_id, summary FROM harbor_memory_episodes
      WHERE ${whereClauses}
      ORDER BY valid_from DESC
      LIMIT ?
    `).all(...params) as Array<{ episode_id: string; summary: string }>;
    return rows
      .map((row) => {
        const text = row.summary.toLowerCase();
        const hits = terms.filter((t) => text.includes(t)).length;
        return { episodeId: row.episode_id, score: hits / terms.length };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async function buildRecencyTrapCorpus(): Promise<{ oldEpisodeId: string }> {
    const YEAR = 365 * 24 * 60 * 60 * 1000;
    // 1 old exact match…
    const oldSession = await harvestNotes('the old deploy', [
      { content: OLD_FACT, type: 'finding', ageMs: YEAR },
    ]);
    const oldRow = db.prepare(
      'SELECT episode_id FROM harbor_memory_episodes WHERE session_id = ?',
    ).get(oldSession) as { episode_id: string };
    // …and 20 recent partial matches sharing one term ("console").
    await harvestNotes('recent console chatter', Array.from({ length: 20 }, (_, i) => ({
      content: `note ${i}: console layout tweak number ${i} for the status pane`,
      type: 'note' as const,
    })));
    return { oldEpisodeId: oldRow.episode_id };
  }

  test('BEFORE: the old algorithm drops the old exact match via the LIMIT limit*3 recency cut', async () => {
    const { oldEpisodeId } = await buildRecencyTrapCorpus();
    const before = oldRelatedWork('deployed console cargo-bundle notarytool', LIMIT);
    // 20 recent partial matches fill the limit*3 recency window before the
    // year-old exact match is ever scored.
    expect(before.map((r) => r.episodeId)).not.toContain(oldEpisodeId);
  });

  test('AFTER: recallEpisodes scores the FULL candidate set — old exact match ranks #1 with its citation', async () => {
    const { oldEpisodeId } = await buildRecencyTrapCorpus();
    const result = await recallEpisodes(
      db,
      recallQuery('deployed console cargo-bundle notarytool', { budget: { maxResults: LIMIT, maxContextTokens: 2000 } }),
      { embedder: stubEmbedder },
    );
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits[0].episodeId).toBe(oldEpisodeId);
    expect(result.hits[0].citations[0].kind).toBe('claim');
    expect(String(result.hits[0].citations[0].claimRef)).toMatch(/^session-note:/);
  });
});
