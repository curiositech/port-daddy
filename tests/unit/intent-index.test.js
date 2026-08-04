/**
 * Unit Tests for the Intent Index (lib/intent-index.ts)
 *
 * The intent index is the W2.1 semantic-search sidecar over session purposes.
 * These tests pin every stochastic surface: an in-memory better-sqlite3 with
 * the REAL sessions/resurrection_queue DDL shapes, and an injected fake
 * resolver that returns explicit unit vectors (no hashing tricks for the
 * similarity assertions — vectors are constructed so the expected dot products
 * are exact).
 *
 * What they defend:
 *   - upsert semantics (re-index replaces, never duplicates)
 *   - budgeted newest-first backfill + drift/model-swap re-embedding
 *   - circuit-open abort (the 313GB write-storm lesson: ONE detection stops
 *     the sweep, no per-row spam, no throw)
 *   - gc delete-propagation (orphans) + model-swap invalidation
 *   - the DELIBERATE absence of a freshness gate (dead + 30-day-old sessions
 *     rank — the inverse of whois)
 *   - searchSalvage enrichment: queue rows, capsule previews, forged-capsule
 *     degradation, claimable-first ranking
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createIntentIndex, DEFAULT_SALVAGE_MIN_SIMILARITY } from '../../lib/intent-index.js';

const DAY = 24 * 60 * 60 * 1000;

// ─── Deterministic fake resolver ─────────────────────────────────────────────

/**
 * Explicit vector table. 'implement salvage briefing UX' and 'build the
 * wreck-recovery welcome screen' share NO keywords but are assigned vectors
 * with dot = 0.9 — this is the embedder-not-LIKE proof at unit level.
 */
const VECTORS = new Map([
  ['implement salvage briefing UX', [1, 0, 0]],
  ['build the wreck-recovery welcome screen', [0.9, Math.sqrt(1 - 0.81), 0]],
  ['tune postgres autovacuum thresholds', [0, 0, 1]],
  ['mildly related purpose', [0.5, Math.sqrt(1 - 0.25), 0]],
]);

function makeResolver(overrides = {}) {
  return {
    modelId: 'test-model',
    embed: async (text) => VECTORS.get(text) ?? [0, 1, 0],
    ...overrides,
  };
}

// ─── Schema fixtures (mirror the real DDL columns) ───────────────────────────

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      phase TEXT DEFAULT 'in_progress',
      agent_id TEXT,
      worktree_id TEXT,
      identity_project TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      metadata TEXT
    );
    CREATE TABLE resurrection_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL UNIQUE,
      agent_name TEXT NOT NULL,
      session_id TEXT,
      purpose TEXT,
      detected_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resurrection_attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      metadata TEXT,
      identity_project TEXT,
      identity_stack TEXT,
      identity_context TEXT
    );
  `);
  return db;
}

function insertSession(db, { id, purpose, status = 'active', updatedAt = Date.now(), completedAt = null, agentId = null }) {
  db.prepare(`
    INSERT INTO sessions (id, purpose, status, agent_id, created_at, updated_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, purpose, status, agentId, updatedAt, updatedAt, completedAt);
}

function insertQueueRow(db, { agentId, sessionId, metadata = null, status = 'pending', detectedAt = Date.now() }) {
  db.prepare(`
    INSERT INTO resurrection_queue (agent_id, agent_name, session_id, detected_at, status, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(agentId, `Agent ${agentId}`, sessionId, detectedAt, status, metadata);
}

function sidecarRows(db) {
  return db.prepare('SELECT * FROM session_purpose_embeddings ORDER BY session_id').all();
}

describe('Intent Index', () => {
  let db;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('indexSession', () => {
    it('upserts a row and re-index with a new purpose replaces it', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      insertSession(db, { id: 's1', purpose: 'implement salvage briefing UX' });

      const first = await index.indexSession('s1', 'implement salvage briefing UX');
      expect(first.indexed).toBe(true);
      expect(sidecarRows(db)).toHaveLength(1);
      expect(sidecarRows(db)[0].purpose).toBe('implement salvage briefing UX');

      const second = await index.indexSession('s1', 'tune postgres autovacuum thresholds');
      expect(second.indexed).toBe(true);
      const rows = sidecarRows(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].purpose).toBe('tune postgres autovacuum thresholds');
      expect(rows[0].model).toBe('test-model');
    });

    it('returns indexed:false on empty purpose and on embed failure (never throws)', async () => {
      const failing = makeResolver({ embed: async () => { throw new Error('boom'); } });
      const index = createIntentIndex(db, { resolver: failing });
      expect(await index.indexSession('s1', '   ')).toEqual({ indexed: false });
      expect(await index.indexSession('s1', 'anything')).toEqual({ indexed: false });
      expect(sidecarRows(db)).toHaveLength(0);
    });
  });

  describe('backfill', () => {
    it('embeds missing rows newest-first and respects the budget', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        insertSession(db, { id: `s${i}`, purpose: `purpose ${i}`, updatedAt: now - i * DAY });
      }

      const result = await index.backfill({ budget: 2 });
      expect(result).toEqual({ embedded: 2, scanned: 2, exhausted: true });
      // Newest-first: s0 (updated now) and s1 (now - 1d) got indexed first.
      const ids = sidecarRows(db).map((r) => r.session_id).sort();
      expect(ids).toEqual(['s0', 's1']);

      const rest = await index.backfill({ budget: 10 });
      expect(rest.embedded).toBe(3);
      expect(rest.exhausted).toBe(false);
      // Idempotence: a fresh sweep finds nothing to do.
      const idle = await index.backfill({ budget: 10 });
      expect(idle).toEqual({ embedded: 0, scanned: 0, exhausted: false });
    });

    it('re-embeds on purpose drift and model mismatch', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      insertSession(db, { id: 's1', purpose: 'implement salvage briefing UX' });
      await index.backfill({ budget: 10 });
      expect(sidecarRows(db)[0].purpose).toBe('implement salvage briefing UX');

      // Purpose drift: the session's purpose changed under the sidecar.
      db.prepare("UPDATE sessions SET purpose = 'tune postgres autovacuum thresholds' WHERE id = 's1'").run();
      const drift = await index.backfill({ budget: 10 });
      expect(drift.embedded).toBe(1);
      expect(sidecarRows(db)[0].purpose).toBe('tune postgres autovacuum thresholds');

      // Model mismatch: rows embedded under another model are re-embedded.
      db.prepare("UPDATE session_purpose_embeddings SET model = 'old-model' WHERE session_id = 's1'").run();
      const swap = await index.backfill({ budget: 10 });
      expect(swap.embedded).toBe(1);
      expect(sidecarRows(db)[0].model).toBe('test-model');
    });

    it('aborts the whole sweep on a circuit-open error without throwing', async () => {
      let attempts = 0;
      const circuitErr = new Error("circuit OPEN for backend 'embedder:test'; retry later");
      circuitErr.name = 'CircuitOpenError';
      const resolver = makeResolver({
        embed: async () => { attempts++; throw circuitErr; },
      });
      const infos = [];
      const errors = [];
      const index = createIntentIndex(db, {
        resolver,
        logger: {
          info: (msg) => infos.push(msg),
          error: (msg) => errors.push(msg),
        },
      });
      for (let i = 0; i < 5; i++) insertSession(db, { id: `s${i}`, purpose: `purpose ${i}` });

      const result = await index.backfill({ budget: 10 });
      expect(attempts).toBe(1);               // ONE attempt, then abort
      expect(result.embedded).toBe(0);
      expect(result.scanned).toBe(1);
      expect(result.exhausted).toBe(false);
      expect(infos).toContain('intent_backfill_embedder_unavailable');
      expect(errors).toHaveLength(0);          // no per-row error spam
    });
  });

  describe('gc', () => {
    it('deletes orphaned rows and wrong-model rows', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      insertSession(db, { id: 'alive', purpose: 'p' });
      await index.indexSession('alive', 'p');
      // Orphan: derived row whose session was deleted (delete-propagation).
      db.prepare(`
        INSERT INTO session_purpose_embeddings (session_id, purpose, model, embedding, created_at)
        VALUES ('ghost', 'x', 'test-model', x'00000000', 0)
      `).run();
      // Wrong-model row for a live session.
      insertSession(db, { id: 'oldmodel', purpose: 'q' });
      db.prepare(`
        INSERT INTO session_purpose_embeddings (session_id, purpose, model, embedding, created_at)
        VALUES ('oldmodel', 'q', 'ancient-model', x'00000000', 0)
      `).run();

      const result = index.gc();
      expect(result.deleted).toBe(2);
      expect(sidecarRows(db).map((r) => r.session_id)).toEqual(['alive']);
    });
  });

  describe('search (no freshness gate — the inverse of whois)', () => {
    it('returns a completed session last updated 30 days ago', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      const monthAgo = Date.now() - 30 * DAY;
      insertSession(db, {
        id: 'ancient',
        purpose: 'build the wreck-recovery welcome screen',
        status: 'completed',
        updatedAt: monthAgo,
        completedAt: monthAgo,
      });
      await index.backfill({ budget: 10 });

      const hits = await index.search('implement salvage briefing UX');
      expect(hits).toHaveLength(1);
      expect(hits[0].sessionId).toBe('ancient');
      expect(hits[0].status).toBe('completed');
      expect(hits[0].isDead).toBe(true);
      expect(hits[0].similarity).toBeCloseTo(0.9, 5);
      expect(hits[0].completedAt).toBe(monthAgo);
    });

    it('applies excludeSessionId and the minSimilarity floor', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      insertSession(db, { id: 'self', purpose: 'implement salvage briefing UX' });
      insertSession(db, { id: 'close', purpose: 'build the wreck-recovery welcome screen' });
      insertSession(db, { id: 'far', purpose: 'tune postgres autovacuum thresholds' });
      await index.backfill({ budget: 10 });

      const hits = await index.search('implement salvage briefing UX', {
        excludeSessionId: 'self',
        minSimilarity: 0.5,
      });
      expect(hits.map((h) => h.sessionId)).toEqual(['close']);
    });

    it('returns [] for empty query or empty corpus', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      expect(await index.search('')).toEqual([]);
      expect(await index.search('implement salvage briefing UX')).toEqual([]);
    });
  });

  describe('searchSalvage', () => {
    const capsule = {
      telosVerdict: 'partial',
      doable: 'yes',
      whyStopped: 'ran out of context window mid-refactor',
      nextPlan: ['finish the render function', 'add tests'],
      evidence: ['commit abc123'],
    };

    async function seed(index) {
      // Dead session WITH a queue row + capsule.
      insertSession(db, {
        id: 'dead-queued',
        purpose: 'build the wreck-recovery welcome screen',
        status: 'abandoned',
        updatedAt: Date.now() - 2 * DAY,
      });
      insertQueueRow(db, {
        agentId: 'agent-queued',
        sessionId: 'dead-queued',
        metadata: JSON.stringify({ salvageCapsule: capsule }),
      });
      // Dead session with NO queue row (dormant prior work — the >7d path).
      insertSession(db, {
        id: 'dead-dormant',
        purpose: 'mildly related purpose',
        status: 'completed',
        updatedAt: Date.now() - 30 * DAY,
        completedAt: Date.now() - 30 * DAY,
      });
      // Alive session — must never appear in salvage matches.
      insertSession(db, { id: 'alive', purpose: 'implement salvage briefing UX', status: 'active' });
      await index.backfill({ budget: 10 });
    }

    it('enriches queue-bearing dead sessions and ranks them first', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      await seed(index);

      const matches = await index.searchSalvage('implement salvage briefing UX');
      expect(matches.map((m) => m.sessionId)).toEqual(['dead-queued', 'dead-dormant']);

      const queued = matches[0];
      expect(queued.salvageAgentId).toBe('agent-queued');
      expect(queued.queueStatus).toBe('pending');
      expect(queued.hasCapsule).toBe(true);
      expect(queued.capsulePreview.telosVerdict).toBe('partial');
      expect(queued.capsulePreview.doable).toBe('yes');
      expect(queued.capsulePreview.whyStopped).toBe('ran out of context window mid-refactor');
      expect(queued.capsulePreview.nextPlanHead).toBe('finish the render function');
      expect(queued.command).toBe('pd salvage show agent-queued');

      const dormant = matches[1];
      expect(dormant.salvageAgentId).toBeNull();
      expect(dormant.queueStatus).toBeNull();
      expect(dormant.hasCapsule).toBe(false);
      expect(dormant.capsulePreview).toBeNull();
      expect(dormant.command).toBeNull();

      // Alive session excluded even though it is the closest match (dot 1.0).
      expect(matches.some((m) => m.sessionId === 'alive')).toBe(false);
    });

    it('degrades forged capsule metadata without throwing', async () => {
      const index = createIntentIndex(db, { resolver: makeResolver() });
      insertSession(db, {
        id: 'dead-forged',
        purpose: 'build the wreck-recovery welcome screen',
        status: 'abandoned',
      });
      // Non-object capsule + giant strings — attacker-controlled metadata.
      insertQueueRow(db, {
        agentId: 'agent-forged',
        sessionId: 'dead-forged',
        metadata: JSON.stringify({
          salvageCapsule: { whyStopped: 'A'.repeat(5000), telosVerdict: 42, nextPlan: 'not-an-array' },
        }),
      });
      insertSession(db, { id: 'dead-nonobj', purpose: 'mildly related purpose', status: 'abandoned' });
      insertQueueRow(db, { agentId: 'agent-nonobj', sessionId: 'dead-nonobj', metadata: JSON.stringify({ salvageCapsule: 'just a string' }) });
      insertSession(db, { id: 'dead-corrupt', purpose: 'mildly related purpose', status: 'abandoned' });
      db.prepare("UPDATE resurrection_queue SET metadata = '{corrupt json' WHERE agent_id = 'agent-nonobj'").run();
      await index.backfill({ budget: 10 });

      const matches = await index.searchSalvage('implement salvage briefing UX', { limit: 10 });
      const forged = matches.find((m) => m.sessionId === 'dead-forged');
      expect(forged.hasCapsule).toBe(true);
      expect(forged.capsulePreview.whyStopped).toHaveLength(200); // truncated
      expect(forged.capsulePreview.telosVerdict).toBeUndefined(); // non-string dropped
      expect(forged.capsulePreview.nextPlanHead).toBeUndefined(); // non-array dropped

      const nonObj = matches.find((m) => m.sessionId === 'dead-nonobj');
      expect(nonObj.hasCapsule).toBe(false);
      expect(nonObj.capsulePreview).toBeNull();
    });

    it('applies the default similarity floor', async () => {
      expect(DEFAULT_SALVAGE_MIN_SIMILARITY).toBeGreaterThan(0);
      const index = createIntentIndex(db, { resolver: makeResolver() });
      insertSession(db, { id: 'noise', purpose: 'tune postgres autovacuum thresholds', status: 'completed' });
      await index.backfill({ budget: 10 });
      // dot('implement salvage briefing UX', 'tune postgres…') = 0 < 0.45 floor.
      const matches = await index.searchSalvage('implement salvage briefing UX');
      expect(matches).toEqual([]);
    });
  });
});
