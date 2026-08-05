/**
 * Shared vector store — cache discipline, degradation, and fusion.
 *
 * The two things worth testing here are the ones that make a vector store
 * useful rather than merely present: that a warm cache is actually warm (an
 * unchanged corpus costs zero model calls), and that a cold or broken model
 * degrades LOUDLY. A store that silently returns no hits when the embedder
 * failed is indistinguishable from one that found nothing relevant, and that
 * confusion is the whole reason `semanticAvailable` exists.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import {
  RRF_K,
  blobToVector,
  contentHash,
  createVectorStore,
  dot,
  normalize,
  reciprocalRankFusion,
  vectorToBlob,
} from '../../lib/vector-store.js';

/**
 * Deterministic stand-in for MiniLM.
 *
 * Maps text to a vector over a tiny fixed vocabulary, so "same meaning,
 * different words" is expressible: `producers` and `sources` both load the
 * same axis. That is exactly the relationship a real embedder captures and a
 * lexical matcher cannot, and it is what the fusion tests need.
 */
const AXES = ['reconcile', 'wire', 'garbage', 'ui'] as const;
const SYNONYMS: Record<string, number> = {
  reconcile: 0, projection: 0, producers: 0, sources: 0,
  wire: 1, hook: 1, connect: 1,
  garbage: 2, collect: 2, gc: 2, prune: 2,
  ui: 3, pane: 3, render: 3,
};

function fakeEmbedder(modelId = 'fake-v1') {
  let calls = 0;
  return {
    modelId,
    get calls() {
      return calls;
    },
    async embed(texts: string[]): Promise<number[][]> {
      calls += 1;
      return texts.map((t) => {
        const v = new Array(AXES.length).fill(0);
        for (const word of t.toLowerCase().split(/\W+/)) {
          const axis = SYNONYMS[word];
          if (axis !== undefined) v[axis] += 1;
        }
        return v;
      });
    },
  };
}

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
});
afterEach(() => {
  db.close();
});

// ─── primitives ──────────────────────────────────────────────────────────────

describe('vector primitives', () => {
  test('blob round-trips a vector', () => {
    const v = [0.5, -0.25, 0.125];
    const back = blobToVector(vectorToBlob(v), v.length);
    expect(Array.from(back)).toEqual(v);
  });

  test('normalize makes dot product equal cosine', () => {
    const a = normalize([3, 4, 0, 0]);
    expect(dot(a, a)).toBeCloseTo(1, 6);
  });

  test('a zero vector normalizes to zeros, not NaN', () => {
    // A degenerate document must score 0 against everything rather than
    // poisoning every comparison it takes part in.
    const z = normalize([0, 0, 0]);
    expect(z.every((x) => Number.isFinite(x))).toBe(true);
    expect(dot(z, normalize([1, 1, 1]))).toBe(0);
  });

  test('contentHash is stable and change-sensitive', () => {
    expect(contentHash('a')).toBe(contentHash('a'));
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});

// ─── the warm cache ──────────────────────────────────────────────────────────

describe('warm cache', () => {
  const items = [
    { id: 'a', text: 'wire the reconcile producers' },
    { id: 'b', text: 'garbage collect stale keys' },
  ];

  test('first warm embeds everything', async () => {
    const emb = fakeEmbedder();
    const store = createVectorStore({ db, embedder: emb });
    const r = await store.warm('k', items);
    expect(r).toMatchObject({ embedded: 2, reused: 0, semanticAvailable: true });
  });

  test('re-warming an UNCHANGED corpus costs zero model calls', async () => {
    // This is the entire point of a warm cache. If this regresses, every
    // arrival pays full embedding cost and the feature becomes too slow to
    // leave on the session-start path.
    const emb = fakeEmbedder();
    const store = createVectorStore({ db, embedder: emb });
    await store.warm('k', items);
    const callsAfterFirst = emb.calls;

    const r = await store.warm('k', items);
    expect(r).toMatchObject({ embedded: 0, reused: 2 });
    expect(emb.calls).toBe(callsAfterFirst);
  });

  test('only the CHANGED item is re-embedded', async () => {
    const emb = fakeEmbedder();
    const store = createVectorStore({ db, embedder: emb });
    await store.warm('k', items);
    const r = await store.warm('k', [items[0], { id: 'b', text: 'prune the ui pane' }]);
    expect(r).toMatchObject({ embedded: 1, reused: 1 });
  });

  test('a different model id invalidates without a migration', async () => {
    const store1 = createVectorStore({ db, embedder: fakeEmbedder('v1') });
    await store1.warm('k', items);
    expect(store1.count('k')).toBe(2);

    const store2 = createVectorStore({ db, embedder: fakeEmbedder('v2') });
    // v2 sees a cold corpus; v1's rows survive untouched, so this is reversible.
    expect(store2.count('k')).toBe(0);
    await store2.warm('k', items);
    expect(store1.count('k')).toBe(2);
    expect(store2.count('k')).toBe(2);
  });

  test('prune drops vectors for items that no longer exist', async () => {
    const store = createVectorStore({ db, embedder: fakeEmbedder() });
    await store.warm('k', items);
    await store.warm('k', [items[0]], { prune: true });
    expect(store.count('k')).toBe(1);
  });

  test('prune is OFF by default, so a partial page does not wipe the corpus', async () => {
    const store = createVectorStore({ db, embedder: fakeEmbedder() });
    await store.warm('k', items);
    await store.warm('k', [items[0]]);
    expect(store.count('k')).toBe(2);
  });
});

// ─── degradation ─────────────────────────────────────────────────────────────

describe('degradation is loud, not silent', () => {
  const brokenEmbedder = {
    modelId: 'broken',
    async embed(): Promise<number[][]> {
      throw new Error('onnxruntime failed to load');
    },
  };

  test('a failing embedder reports semanticAvailable false, with a reason', async () => {
    const store = createVectorStore({ db, embedder: brokenEmbedder });
    const r = await store.warm('k', [{ id: 'a', text: 'x' }]);
    expect(r.semanticAvailable).toBe(false);
    expect(r.reason).toContain('onnxruntime');
  });

  test('searching a COLD kind is degraded, not "no matches"', async () => {
    // The distinction that matters: an operator seeing zero hits must be able
    // to tell "nothing is similar" from "nothing is indexed".
    const store = createVectorStore({ db, embedder: fakeEmbedder() });
    const r = await store.search('never-warmed', 'reconcile');
    expect(r.hits).toEqual([]);
    expect(r.semanticAvailable).toBe(false);
    expect(r.reason).toContain('no vectors indexed');
  });

  test('an unembeddable query degrades rather than throwing', async () => {
    const store = createVectorStore({ db, embedder: brokenEmbedder });
    const r = await store.search('k', 'anything');
    expect(r.semanticAvailable).toBe(false);
  });

  test('partial progress survives a mid-batch failure', async () => {
    // A flaky model should make the cache warm up slowly, never never.
    let n = 0;
    const flaky = {
      modelId: 'flaky',
      async embed(texts: string[]): Promise<number[][]> {
        n += 1;
        if (n > 1) throw new Error('died on the second batch');
        return texts.map(() => [1, 0, 0, 0]);
      },
    };
    const store = createVectorStore({ db, embedder: flaky, batchSize: 1 });
    const r = await store.warm('k', [
      { id: 'a', text: 'one' },
      { id: 'b', text: 'two' },
    ]);
    expect(r.semanticAvailable).toBe(false);
    expect(r.embedded).toBe(1);
    expect(store.count('k')).toBe(1);
  });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('search', () => {
  test('ranks by cosine and finds the synonym match a lexical scorer misses', async () => {
    const store = createVectorStore({ db, embedder: fakeEmbedder() });
    await store.warm('k', [
      { id: 'same-words', text: 'wire reconcile producers' },
      { id: 'same-meaning', text: 'hook up the projection sources' },
      { id: 'unrelated', text: 'render the ui pane' },
    ]);
    const r = await store.search('k', 'connect the reconcile sources', 3);
    expect(r.semanticAvailable).toBe(true);
    // 'unrelated' shares no axis and must not outrank either real match.
    expect(r.hits[r.hits.length - 1]?.id).toBe('unrelated');
    expect(r.hits.slice(0, 2).map((h) => h.id).sort()).toEqual(['same-meaning', 'same-words']);
  });

  test('accepts a precomputed vector so one query serves many kinds', async () => {
    const store = createVectorStore({ db, embedder: fakeEmbedder() });
    await store.warm('k1', [{ id: 'a', text: 'reconcile' }]);
    await store.warm('k2', [{ id: 'b', text: 'reconcile' }]);
    const vec = await store.embedQuery('reconcile');
    expect(vec).not.toBeNull();
    const before = store.stats().embedCalls;
    await store.search('k1', vec!, 5);
    await store.search('k2', vec!, 5);
    // Reusing the vector means neither search invoked the model.
    expect(store.stats().embedCalls).toBe(before);
  });

  test('respects k', async () => {
    const store = createVectorStore({ db, embedder: fakeEmbedder() });
    await store.warm('k', [1, 2, 3, 4, 5].map((i) => ({ id: `i${i}`, text: 'reconcile' })));
    expect((await store.search('k', 'reconcile', 2)).hits).toHaveLength(2);
  });
});

// ─── fusion ──────────────────────────────────────────────────────────────────

describe('reciprocalRankFusion', () => {
  test('an item ranked well by BOTH tiers beats one ranked well by either', () => {
    const fused = reciprocalRankFusion([
      ['both', 'lexical-only'],
      ['both', 'semantic-only'],
    ]);
    expect(fused.get('both')!).toBeGreaterThan(fused.get('lexical-only')!);
    expect(fused.get('both')!).toBeGreaterThan(fused.get('semantic-only')!);
  });

  test('uses position, not score magnitude', () => {
    // The reason RRF is right here: BM25 is unbounded and corpus-dependent
    // while cosine sits in [-1,1], so any weighted sum lets one tier dominate
    // by accident of scale.
    const a = reciprocalRankFusion([['x', 'y']]);
    const b = reciprocalRankFusion([['x', 'y']]);
    expect(a.get('x')).toBe(b.get('x'));
    expect(a.get('x')).toBeCloseTo(1 / (RRF_K + 1), 12);
  });

  test('a single ranking still fuses', () => {
    expect([...reciprocalRankFusion([['only']]).keys()]).toEqual(['only']);
  });
});
