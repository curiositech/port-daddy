/**
 * Unit Tests for the Whois Semantic Phonebook (lib/whois.ts)
 *
 * These tests pin time (via the `nowMs` search option) and inject a
 * deterministic stub resolver so the cascade is fully reproducible — no model
 * download, no wall-clock decay. They are written to catch real regressions in
 * the four behaviours the brief calls out:
 *
 *   - capability upsert + idempotency (PK collision refreshes, never duplicates)
 *   - the freshness state machine (1.0 fresh, decay, 0.1 floor, >7d excluded)
 *   - the cascade ranker (exact → BM25 → cosine → LLM tiebreak) and its
 *     score == similarity × freshnessWeight invariant
 *   - backfill idempotency + malformed-JSON resilience, and kind:'human' → []
 *
 * Each test runs against a fresh in-memory better-sqlite3 with a minimal
 * `agents` table so the freshness lookup has something to read.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createWhois, freshnessWeight, isReviewedSemanticWhoisHit } from '../../lib/whois.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('whois — shared reviewed-peer admission', () => {
  it('admits only a semantically or LLM-reviewed result above both shared thresholds', () => {
    expect(isReviewedSemanticWhoisHit({ stage: 'semantic', score: 0.94, similarity: 0.95 })).toBe(true);
    expect(isReviewedSemanticWhoisHit({ stage: 'llm', score: 0.94, similarity: 0.95 })).toBe(true);
    expect(isReviewedSemanticWhoisHit({ stage: 'bm25', score: 0.99, similarity: 0.99 })).toBe(false);
    expect(isReviewedSemanticWhoisHit({ stage: 'semantic', score: 0.4, similarity: 0.95 })).toBe(false);
  });
});

// ─── Deterministic stub embedder ──────────────────────────────────────────────

/**
 * Map a phrase to a fixed unit vector. Identical phrases → identical vectors
 * (dot product 1.0). The cascade's cosine stage uses a raw dot product, so unit
 * vectors keep similarity values interpretable and bounded.
 *
 * A large dimension + a multiplicative rolling hash spread across several slots
 * makes accidental collisions between distinct phrases vanishingly unlikely, so
 * "orthogonal" phrases reliably score near 0 (not coincidentally 1.0 via a
 * 16-bucket hash collision).
 */
const DIM = 256;
function fixedVecFor(text: string): number[] {
  const norm = text.trim().toLowerCase();
  const v = new Array<number>(DIM).fill(0);
  // Distribute energy across 3 derived slots so two distinct strings almost
  // never coincide on all of them, while identical strings coincide on all.
  let h1 = 2166136261 >>> 0;
  let h2 = 5381 >>> 0;
  for (let i = 0; i < norm.length; i++) {
    const c = norm.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = ((h2 * 33) ^ c) >>> 0;
  }
  const slots = [h1 % DIM, h2 % DIM, (h1 ^ h2) % DIM];
  for (const s of slots) v[s] += 1;
  // Normalize to unit length.
  const mag = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

/** Normalize a short vector to unit length (for pinned-cosine tests). */
function unit(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

/**
 * Build a stub resolver. Optionally pass an explicit phrase→vector map for
 * tests that need to control cosine similarities precisely (e.g. tiebreaks);
 * unknown phrases fall back to the deterministic hash above.
 */
function makeStubResolver(overrides: Record<string, number[]> = {}) {
  let calls = 0;
  return {
    modelId: 'stub',
    async embed(text: string): Promise<number[]> {
      calls++;
      const key = text.trim().toLowerCase();
      return overrides[key] ?? fixedVecFor(text);
    },
    get callCount() {
      return calls;
    },
  };
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      last_heartbeat INTEGER
    );
    CREATE TABLE harbor_members (
      harbor_name TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      capabilities TEXT,
      PRIMARY KEY (harbor_name, agent_id)
    );
  `);
  return db;
}

function insertAgent(db: Database.Database, id: string, name: string | null, lastHeartbeat: number | null): void {
  db.prepare('INSERT OR REPLACE INTO agents (id, name, last_heartbeat) VALUES (?, ?, ?)')
    .run(id, name, lastHeartbeat);
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('whois — registerCapabilities', () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it('upserts capability phrases and embeds each one', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    const result = await whois.registerCapabilities('agent-1', 'h:fleet', ['react', 'typescript']);

    expect(result.inserted).toBe(2);
    expect(result.phrases).toEqual(['react', 'typescript']);

    const count = db.prepare(
      'SELECT COUNT(*) AS c FROM harbor_member_capability_embeddings',
    ).get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('is idempotent — re-registering the same phrase updates in place, no PK duplicate', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    await whois.registerCapabilities('agent-1', 'h:fleet', ['react']);
    await whois.registerCapabilities('agent-1', 'h:fleet', ['react']);

    const rows = db.prepare(
      'SELECT harbor_name, agent_id, phrase FROM harbor_member_capability_embeddings',
    ).all() as Array<{ harbor_name: string; agent_id: string; phrase: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ harbor_name: 'h:fleet', agent_id: 'agent-1', phrase: 'react' });
  });

  it('dedupes + trims phrases within a single call and skips blanks', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    const result = await whois.registerCapabilities('agent-1', 'h:fleet', ['  react  ', 'react', '', '   ']);
    expect(result.inserted).toBe(1);
    expect(result.phrases).toEqual(['react']);
  });

  it('returns inserted:0 when agentId or harbor is missing', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    expect(await whois.registerCapabilities('', 'h:fleet', ['react'])).toEqual({ inserted: 0, phrases: [] });
    expect(await whois.registerCapabilities('agent-1', '', ['react'])).toEqual({ inserted: 0, phrases: [] });
  });
});

describe('whois — freshnessWeight state machine', () => {
  const now = 1_000_000_000_000;

  it('returns weight 1.0 when heartbeat is now', () => {
    expect(freshnessWeight(now, now)).toEqual({ weight: 1, eligible: true });
  });

  it('returns weight 1.0 anywhere inside the 30-minute fresh window', () => {
    const f = freshnessWeight(now - 29 * 60 * 1000, now);
    expect(f.weight).toBe(1);
    expect(f.eligible).toBe(true);
  });

  it('decays monotonically between 30 minutes and 24 hours', () => {
    const early = freshnessWeight(now - 2 * HOUR, now);
    const late = freshnessWeight(now - 12 * HOUR, now);
    expect(early.eligible).toBe(true);
    expect(late.eligible).toBe(true);
    expect(early.weight).toBeLessThan(1);
    expect(early.weight).toBeGreaterThan(late.weight);
    expect(late.weight).toBeGreaterThan(0.1);
  });

  it('floors to 0.1 between 24 hours and 7 days', () => {
    const f = freshnessWeight(now - 3 * DAY, now);
    expect(f.weight).toBeCloseTo(0.1, 10);
    expect(f.eligible).toBe(true);
  });

  it('excludes agents whose heartbeat is older than 7 days', () => {
    const f = freshnessWeight(now - 8 * DAY, now);
    expect(f.eligible).toBe(false);
    expect(f.weight).toBe(0);
  });

  it('treats an unknown (null) heartbeat as stale-but-eligible at the 0.1 floor', () => {
    expect(freshnessWeight(null, now)).toEqual({ weight: 0.1, eligible: true });
  });
});

describe('whois — search cascade', () => {
  const now = 1_000_000_000_000;
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it('Stage 1 exact match returns similarity 1.0, freshness-ranked', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    insertAgent(db, 'fresh', 'Fresh Agent', now);          // weight 1.0
    insertAgent(db, 'stale', 'Stale Agent', now - 3 * DAY); // weight 0.1
    await whois.registerCapabilities('fresh', 'h:fleet', ['react server components']);
    await whois.registerCapabilities('stale', 'h:fleet', ['react server components']);

    const hits = await whois.search('react server components', { nowMs: now });
    expect(hits).toHaveLength(2);
    // exact match → similarity 1.0 for both; the fresher agent ranks first.
    expect(hits[0].agentId).toBe('fresh');
    expect(hits[0].stage).toBe('exact');
    expect(hits[0].similarity).toBe(1.0);
    expect(hits[0].score).toBeCloseTo(1.0, 10);
    expect(hits[1].agentId).toBe('stale');
    expect(hits[1].score).toBeCloseTo(0.1, 10);
  });

  it('keeps raw exact lookup while product semantic review reranks the same phrase', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    insertAgent(db, 'fresh', 'Fresh Agent', now);
    await whois.registerCapabilities('fresh', 'h:fleet', ['coordinate the shared Sugar workflow']);

    const raw = await whois.search('coordinate the shared Sugar workflow', { nowMs: now });
    const reviewed = await whois.search('coordinate the shared Sugar workflow', {
      nowMs: now,
      semanticReview: true,
    });

    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ stage: 'exact', similarity: 1, score: 1 });
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]).toMatchObject({ stage: 'semantic' });
    // Embeddings round-trip through a Float32 sidecar, so a unit-vector
    // cosine can be microscopically below one even for the identical phrase.
    expect(reviewed[0].similarity).toBeCloseTo(1, 6);
    expect(reviewed[0].score).toBeCloseTo(1, 6);
    expect(isReviewedSemanticWhoisHit(reviewed[0])).toBe(true);
  });

  it('score equals similarity × freshnessWeight for every hit', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    insertAgent(db, 'a', 'A', now - 12 * HOUR); // decayed weight in (0.1, 1)
    await whois.registerCapabilities('a', 'h:fleet', ['kubernetes']);

    const hits = await whois.search('kubernetes', { nowMs: now });
    expect(hits).toHaveLength(1);
    const expectedWeight = freshnessWeight(now - 12 * HOUR, now).weight;
    expect(hits[0].freshnessWeight).toBeCloseTo(expectedWeight, 10);
    expect(hits[0].score).toBeCloseTo(hits[0].similarity * hits[0].freshnessWeight, 10);
  });

  it('excludes a >7d-stale agent even on a perfect phrase match', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    insertAgent(db, 'ghost', 'Ghost', now - 10 * DAY); // excluded
    await whois.registerCapabilities('ghost', 'h:fleet', ['rust ffi']);

    const hits = await whois.search('rust ffi', { nowMs: now });
    expect(hits).toEqual([]);
  });

  it('falls through to cosine when no exact phrase matches, scoring an unrelated phrase far below 1.0', async () => {
    // Pin the vectors so the cosine outcome is exact: query and phrase are
    // orthogonal unit vectors → dot product 0.
    const qVec = new Array<number>(256).fill(0); qVec[0] = 1;
    const pVec = new Array<number>(256).fill(0); pVec[1] = 1;
    const whois = createWhois(db, {
      resolver: makeStubResolver({
        'quantum chromodynamics': qVec,
        'gardening': pVec,
      }),
    });
    insertAgent(db, 'a', 'A', now);
    await whois.registerCapabilities('a', 'h:fleet', ['gardening']);

    const hits = await whois.search('quantum chromodynamics', { nowMs: now });
    // Eligible (fresh) but orthogonal → similarity 0, score 0; still a hit.
    expect(hits).toHaveLength(1);
    expect(hits[0].stage).not.toBe('exact');
    expect(hits[0].similarity).toBeCloseTo(0, 10);
    expect(hits[0].score).toBeCloseTo(0, 10);
  });

  it('kind:"human" short-circuits to an empty list (v1 only persists agents)', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    insertAgent(db, 'a', 'A', now);
    await whois.registerCapabilities('a', 'h:fleet', ['react']);

    expect(await whois.search('react', { kind: 'human', nowMs: now })).toEqual([]);
  });

  it('returns [] for a blank query', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    expect(await whois.search('   ', { nowMs: now })).toEqual([]);
  });

  it('freshMinSeconds filters out agents older than the floor even on exact match', async () => {
    const whois = createWhois(db, { resolver: makeStubResolver() });
    insertAgent(db, 'recent', 'Recent', now - 1 * HOUR);
    insertAgent(db, 'old', 'Old', now - 6 * HOUR);
    await whois.registerCapabilities('recent', 'h:fleet', ['airflow']);
    await whois.registerCapabilities('old', 'h:fleet', ['airflow']);

    // 2h freshness floor → only the 1h-old agent survives.
    const hits = await whois.search('airflow', { nowMs: now, freshMinSeconds: 2 * 3600 });
    expect(hits.map((h) => h.agentId)).toEqual(['recent']);
  });

  // NOTE: the LLM tiebreak only runs in the BM25/semantic (cosine) path — the
  // exact-match stage returns early before the tiebreak block. So these tests
  // deliberately use NON-exact queries that reach cosine, with pinned vectors
  // controlling the final score gap.
  it('fires the LLM tiebreak only when the top-2 cosine scores fall within TIEBREAK_MARGIN', async () => {
    // Query is near-equidistant to two distinct phrases → cosine scores within
    // the 0.02 margin → tiebreak SHOULD fire.
    const qVec = unit([1, 0, 0]);
    const tied = createWhois(db, {
      resolver: makeStubResolver({
        'graphql api': qVec,
        'graphql schemas': unit([0.99, 0.141, 0]),    // cos ≈ 0.990
        'graphql resolvers': unit([0.995, 0, 0.0999]), // cos ≈ 0.995  (gap ≈ 0.005 < 0.02)
      }),
    });
    insertAgent(db, 'x', 'X', now);
    insertAgent(db, 'y', 'Y', now);
    await tied.registerCapabilities('x', 'h:fleet', ['graphql schemas']);
    await tied.registerCapabilities('y', 'h:fleet', ['graphql resolvers']);

    let firedTied = false;
    const tiedHits = await tied.search('graphql api', {
      nowMs: now,
      llmTiebreak: async (_q, _candidates) => {
        firedTied = true;
        return ['x', 'y']; // force x first regardless of raw cosine order
      },
    });
    expect(firedTied).toBe(true);
    expect(tiedHits[0].agentId).toBe('x');
    expect(tiedHits[0].stage).toBe('llm');

    // Separated pair: identical fresh weight but a large cosine gap (> margin)
    // → tiebreak SHOULD NOT fire.
    const db2 = makeDb();
    const sep = createWhois(db2, {
      resolver: makeStubResolver({
        'graphql api': unit([1, 0, 0]),
        'graphql schemas': unit([1, 0, 0]),       // cos 1.0
        'graphql resolvers': unit([0.6, 0.8, 0]), // cos 0.6  (gap 0.4 ≫ 0.02)
      }),
    });
    insertAgent(db2, 'p', 'P', now);
    insertAgent(db2, 'q', 'Q', now);
    await sep.registerCapabilities('p', 'h:fleet', ['graphql schemas']);
    await sep.registerCapabilities('q', 'h:fleet', ['graphql resolvers']);

    let firedSep = false;
    const sepHits = await sep.search('graphql api', {
      nowMs: now,
      llmTiebreak: async () => { firedSep = true; return ['q', 'p']; },
    });
    expect(firedSep).toBe(false);
    expect(sepHits[0].agentId).toBe('p'); // raw cosine order preserved
    db2.close();
  });
});

describe('whois — backfill', () => {
  const now = 1_000_000_000_000;
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it('embeds capabilities from harbor_members and is idempotent on a second run', async () => {
    db.prepare('INSERT INTO harbor_members (harbor_name, agent_id, capabilities) VALUES (?, ?, ?)')
      .run('h:fleet', 'agent-1', JSON.stringify(['react', 'typescript']));
    insertAgent(db, 'agent-1', 'Agent One', now);

    const whois = createWhois(db, { resolver: makeStubResolver() });
    const first = await whois.backfill();
    expect(first.scanned).toBe(1);
    expect(first.embedded).toBe(2);

    const second = await whois.backfill();
    expect(second.scanned).toBe(1);
    expect(second.embedded).toBe(0); // already present → nothing new embedded

    const count = db.prepare(
      'SELECT COUNT(*) AS c FROM harbor_member_capability_embeddings',
    ).get() as { c: number };
    expect(count.c).toBe(2);

    // And the backfilled phrases are searchable.
    const hits = await whois.search('react', { nowMs: now });
    expect(hits.map((h) => h.agentId)).toContain('agent-1');
  });

  it('skips members whose capabilities JSON is malformed without throwing', async () => {
    db.prepare('INSERT INTO harbor_members (harbor_name, agent_id, capabilities) VALUES (?, ?, ?)')
      .run('h:fleet', 'good', JSON.stringify(['react']));
    db.prepare('INSERT INTO harbor_members (harbor_name, agent_id, capabilities) VALUES (?, ?, ?)')
      .run('h:fleet', 'broken', '{not valid json');
    insertAgent(db, 'good', 'Good', now);

    const whois = createWhois(db, { resolver: makeStubResolver() });
    const result = await whois.backfill();
    // Both members are scanned; only the valid one contributes an embedding.
    expect(result.scanned).toBe(2);
    expect(result.embedded).toBe(1);
  });
});
