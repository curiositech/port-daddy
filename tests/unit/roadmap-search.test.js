/**
 * Unit Tests for Roadmap Search (lib/roadmap-search.ts)
 *
 * Same deterministic-stub-embedder pattern as tests/unit/whois.test.ts (the
 * module this one mirrors) — no model download, fully reproducible cosine
 * scores. Covers:
 *
 *   - reindexItem: embeds + persists, no-ops on an unchanged content hash,
 *     re-embeds when the summary changes
 *   - reindexAll: backfill over a full item list, indexed/skipped counts
 *   - search: exact-slug short-circuit, BM25→cosine cascade ranks the
 *     semantically closest item first, status boost breaks near-ties toward
 *     actionable (now/backlog) over historical (done/parked) items, empty
 *     query / empty corpus -> []
 */

import { describe, it, expect } from '@jest/globals';
import Database from 'better-sqlite3';
import { createRoadmapSearch } from '../../lib/roadmap-search.js';

// ─── Deterministic stub embedder (identical shape to whois.test.ts) ───────────

const DIM = 256;
function fixedVecFor(text) {
  const norm = text.trim().toLowerCase();
  const v = new Array(DIM).fill(0);
  let h1 = 2166136261 >>> 0;
  let h2 = 5381 >>> 0;
  for (let i = 0; i < norm.length; i++) {
    const c = norm.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = ((h2 * 33) ^ c) >>> 0;
  }
  const slots = [h1 % DIM, h2 % DIM, (h1 ^ h2) % DIM];
  for (const s of slots) v[s] += 1;
  const mag = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

function makeStubResolver(overrides = {}) {
  let calls = 0;
  return {
    modelId: 'stub',
    async embed(text) {
      calls++;
      const key = text.trim().toLowerCase();
      return overrides[key] ?? fixedVecFor(text);
    },
    get callCount() {
      return calls;
    },
  };
}

/** Normalize a short vector to unit length (for pinned-cosine tests). */
function unit(v) {
  const mag = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

function makeDb() {
  return new Database(':memory:');
}

function item(overrides) {
  return {
    slug: 'a-slug',
    harbor: 'port-daddy',
    summaryMd: 'A summary',
    descriptionMd: null,
    status: 'backlog',
    ...overrides,
  };
}

describe('roadmap-search / reindexItem', () => {
  it('embeds and persists a fresh item', async () => {
    const db = makeDb();
    const search = createRoadmapSearch(db, { resolver: makeStubResolver() });
    const result = await search.reindexItem(item({ slug: 'fix-login-bug', summaryMd: 'Fix the login bug' }));
    expect(result.indexed).toBe(true);

    const row = db.prepare('SELECT * FROM roadmap_item_embeddings WHERE slug = ?').get('fix-login-bug');
    expect(row).toBeTruthy();
    expect(row.summary_md).toBe('Fix the login bug');
  });

  it('no-ops when the content hash is unchanged (idempotent re-index)', async () => {
    const db = makeDb();
    const resolver = makeStubResolver();
    const search = createRoadmapSearch(db, { resolver });
    const one = item({ slug: 'stable-item', summaryMd: 'Stable summary text' });

    const first = await search.reindexItem(one);
    expect(first.indexed).toBe(true);
    const callsAfterFirst = resolver.callCount;

    const second = await search.reindexItem(one);
    expect(second.indexed).toBe(false);
    expect(resolver.callCount).toBe(callsAfterFirst); // no new embed call
  });

  it('re-embeds when the summary text changes', async () => {
    const db = makeDb();
    const search = createRoadmapSearch(db, { resolver: makeStubResolver() });
    await search.reindexItem(item({ slug: 'drifting-item', summaryMd: 'Original summary' }));
    const changed = await search.reindexItem(item({ slug: 'drifting-item', summaryMd: 'Completely different summary' }));
    expect(changed.indexed).toBe(true);

    const row = db.prepare('SELECT summary_md FROM roadmap_item_embeddings WHERE slug = ?').get('drifting-item');
    expect(row.summary_md).toBe('Completely different summary');
  });

  it('skips items with no embeddable text', async () => {
    const db = makeDb();
    const search = createRoadmapSearch(db, { resolver: makeStubResolver() });
    const result = await search.reindexItem(item({ slug: 'empty-item', summaryMd: '' }));
    expect(result.indexed).toBe(false);
  });

  it('still indexes on descriptionMd alone when summaryMd is empty', async () => {
    // itemText() falls back to descriptionMd when present — an item with a
    // blank summary but real description text is embeddable, not skipped.
    const db = makeDb();
    const search = createRoadmapSearch(db, {
      resolver: makeStubResolver(),
    });
    const result = await search.reindexItem(
      item({ slug: 'description-only-item', summaryMd: '', descriptionMd: 'Fix the login bug' }),
    );
    expect(result.indexed).toBe(true);

    const row = db.prepare('SELECT summary_md FROM roadmap_item_embeddings WHERE slug = ?').get('description-only-item');
    expect(row).toBeTruthy();
  });
});

describe('roadmap-search / reindexAll', () => {
  it('reports indexed vs skipped counts over a batch, and is idempotent on rerun', async () => {
    const db = makeDb();
    const search = createRoadmapSearch(db, { resolver: makeStubResolver() });
    const items = [
      item({ slug: 'a', summaryMd: 'Alpha task' }),
      item({ slug: 'b', summaryMd: 'Beta task' }),
      item({ slug: 'c', summaryMd: '' }), // unindexable
    ];

    const first = await search.reindexAll(items);
    expect(first.indexed).toBe(2);
    expect(first.skipped).toBe(1);

    const second = await search.reindexAll(items);
    expect(second.indexed).toBe(0); // both unchanged now
    expect(second.skipped).toBe(3); // 2 unchanged + 1 still unindexable
  });
});

describe('roadmap-search / search', () => {
  async function seeded(overrides = {}) {
    const db = makeDb();
    const search = createRoadmapSearch(db, { resolver: makeStubResolver(overrides) });
    await search.reindexAll([
      item({ slug: 'fix-auth-timeout', harbor: 'port-daddy', summaryMd: 'Fix the auth token timeout bug', status: 'now' }),
      item({ slug: 'redesign-marketing-site', harbor: 'port-daddy', summaryMd: 'Redesign the marketing landing page', status: 'backlog' }),
      item({ slug: 'old-archived-auth-fix', harbor: 'port-daddy', summaryMd: 'Fix the auth token timeout bug', status: 'done' }),
      item({ slug: 'other-harbor-item', harbor: 'some-other-repo', summaryMd: 'Fix the auth token timeout bug', status: 'now' }),
    ]);
    return search;
  }

  it('returns [] for an empty query', async () => {
    const search = await seeded();
    expect(await search.search('   ')).toEqual([]);
  });

  it('returns [] when the corpus is empty', async () => {
    const db = makeDb();
    const search = createRoadmapSearch(db, { resolver: makeStubResolver() });
    expect(await search.search('anything')).toEqual([]);
  });

  it('short-circuits on an exact slug match', async () => {
    const search = await seeded();
    const hits = await search.search('fix-auth-timeout');
    expect(hits[0].slug).toBe('fix-auth-timeout');
    expect(hits[0].stage).toBe('exact-slug');
    expect(hits[0].similarity).toBe(1.0);
  });

  it('ranks the closest item above an unrelated one on cosine rerank', async () => {
    // The hash-based stub embedder only guarantees identical text -> identical
    // vector; it does not encode real semantic relatedness for paraphrases
    // (that's the whole reason it's a stub). So similarity is controlled
    // explicitly here — same technique tests/unit/whois.test.ts uses for its
    // tiebreak-precision cases — rather than hoping the hash coincidentally
    // agrees that two paraphrases are "close."
    // Deliberately shares zero tokens with either item's text, so BM25 scores
    // both 0 and the search falls through to cosine-over-the-full-corpus —
    // isolating the assertion to the cosine stage this test targets.
    const queryText = 'quarterly compliance review checklist';
    const query = unit([1, 0, 0, 0]);
    const closeVec = unit([0.9, 0.1, 0, 0]); // high cosine with query
    const farVec = unit([0, 0, 1, 0]); // orthogonal to query
    const db = makeDb();
    const search = createRoadmapSearch(db, {
      resolver: makeStubResolver({
        [queryText]: query,
        'fix the auth token timeout bug': closeVec,
        'redesign the marketing landing page': farVec,
      }),
    });
    await search.reindexAll([
      item({ slug: 'fix-auth-timeout', summaryMd: 'Fix the auth token timeout bug', status: 'now' }),
      item({ slug: 'redesign-marketing-site', summaryMd: 'Redesign the marketing landing page', status: 'backlog' }),
    ]);

    const hits = await search.search(queryText);
    expect(hits[0].slug).toBe('fix-auth-timeout');
    const authIdx = hits.findIndex((h) => h.slug === 'fix-auth-timeout');
    const marketingIdx = hits.findIndex((h) => h.slug === 'redesign-marketing-site');
    expect(authIdx).toBeLessThan(marketingIdx);
  });

  it('boosts an actionable item over an identically-worded done item', async () => {
    // Both items share the exact same summary text, so the stub embedder
    // guarantees identical (nonzero, pinned) raw embeddings for both —
    // structurally equal similarity — so only the status boost can break
    // the tie in score.
    const query = unit([1, 0.5, 0, 0]);
    const sharedVec = unit([0.8, 0.6, 0, 0]);
    const db = makeDb();
    const search = createRoadmapSearch(db, {
      resolver: makeStubResolver({
        'auth token timeout bug': query,
        'fix the auth token timeout bug': sharedVec,
      }),
    });
    await search.reindexAll([
      item({ slug: 'fix-auth-timeout', summaryMd: 'Fix the auth token timeout bug', status: 'now' }),
      item({ slug: 'old-archived-auth-fix', summaryMd: 'Fix the auth token timeout bug', status: 'done' }),
    ]);

    const hits = await search.search('auth token timeout bug');
    const now = hits.find((h) => h.slug === 'fix-auth-timeout');
    const done = hits.find((h) => h.slug === 'old-archived-auth-fix');
    expect(now).toBeTruthy();
    expect(done).toBeTruthy();
    expect(now.similarity).toBeCloseTo(done.similarity, 6); // same text -> same raw similarity
    expect(now.similarity).toBeGreaterThan(0); // and the pinned similarity is meaningfully nonzero
    expect(now.score).toBeGreaterThan(done.score); // status boost breaks the tie
  });

  it('scopes to the given harbor', async () => {
    const search = await seeded();
    const hits = await search.search('auth token timeout bug', { harbor: 'port-daddy' });
    expect(hits.every((h) => h.harbor === 'port-daddy')).toBe(true);
    expect(hits.find((h) => h.slug === 'other-harbor-item')).toBeUndefined();
  });

  it('respects the limit option', async () => {
    const search = await seeded();
    const hits = await search.search('bug fix', { limit: 1 });
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it.each([0, -1, -100])('clamps a non-positive limit (%i) up to 1 rather than returning nothing or erroring', async (limit) => {
    const search = await seeded();
    const hits = await search.search('bug fix', { limit });
    expect(hits.length).toBe(1);
  });

  it('clamps an oversized limit down to the 50-item cap', async () => {
    const search = await seeded();
    const hits = await search.search('bug fix', { limit: 10_000 });
    expect(hits.length).toBeLessThanOrEqual(50);
  });
});
