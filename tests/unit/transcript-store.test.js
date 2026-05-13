/**
 * Unit tests for lib/transcript-store.ts.
 *
 * Tests cover:
 *   - schema creation + idempotent re-init
 *   - record() validation (actorId, turnId, role, eventType, content)
 *   - query() filters (actor, session, turn, eventType, since/until, limit, order)
 *   - stats() aggregations (totals, distinct counts, cost/token sums)
 *   - large-content truncation with metadata flag
 *   - JSON metadata round-trip + parse-error fallback
 *   - clamping query limit to MAX_QUERY_LIMIT
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createTranscriptStore } from '../../lib/transcript-store.js';

describe('transcript-store', () => {
  let db;
  let now;
  let clock;
  let store;

  beforeEach(() => {
    db = createTestDb();
    clock = 1_700_000_000_000;
    now = () => clock;
    store = createTranscriptStore(db, { now });
  });

  afterEach(() => {
    if (db) db.close();
  });

  // ---------------------------------------------------------------------
  // Schema + idempotency
  // ---------------------------------------------------------------------

  describe('schema', () => {
    it('creates the transcript_events table on construction', () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='transcript_events'"
      ).all();
      expect(tables).toHaveLength(1);
    });

    it('creates the four indexes', () => {
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_transcript_%'"
      ).all().map((r) => r.name);
      expect(indexes).toEqual(expect.arrayContaining([
        'idx_transcript_actor_ts',
        'idx_transcript_session_ts',
        'idx_transcript_event_type_ts',
        'idx_transcript_turn',
      ]));
    });

    it('is idempotent on re-construction (no error, existing rows preserved)', () => {
      store.record({
        actorId: 'agent-x',
        turnId: 'turn-1',
        role: 'assistant',
        eventType: 'turn_complete',
        content: 'hello',
      });
      const second = createTranscriptStore(db, { now });
      const all = second.query();
      expect(all).toHaveLength(1);
      expect(all[0].content).toBe('hello');
    });
  });

  // ---------------------------------------------------------------------
  // record()
  // ---------------------------------------------------------------------

  describe('record', () => {
    it('writes a minimal turn_complete row', () => {
      const ev = store.record({
        actorId: 'agent-x',
        turnId: 'turn-1',
        role: 'assistant',
        eventType: 'turn_complete',
        content: 'hi',
      });
      expect(ev.id).toBeGreaterThan(0);
      expect(ev.actorId).toBe('agent-x');
      expect(ev.turnId).toBe('turn-1');
      expect(ev.role).toBe('assistant');
      expect(ev.eventType).toBe('turn_complete');
      expect(ev.content).toBe('hi');
      expect(ev.ts).toBe(clock);
      expect(ev.sessionId).toBeNull();
      expect(ev.tokensIn).toBeNull();
      expect(ev.metadata).toBeNull();
    });

    it('persists all rich fields including session, tokens, model, backend, cost, metadata', () => {
      const ev = store.record({
        actorId: 'comms-officer',
        sessionId: 'session-abc',
        turnId: 'turn-7',
        role: 'assistant',
        eventType: 'turn_complete',
        content: 'thinking out loud',
        tokensIn: 120,
        tokensOut: 250,
        cachedTokensIn: 80,
        model: '@cf/zai-org/glm-4.7-flash',
        backend: 'cloudflare',
        costUsd: 0.0023,
        metadata: { intent: 'route', confidence: 0.91 },
      });
      expect(ev.sessionId).toBe('session-abc');
      expect(ev.tokensIn).toBe(120);
      expect(ev.tokensOut).toBe(250);
      expect(ev.cachedTokensIn).toBe(80);
      expect(ev.model).toBe('@cf/zai-org/glm-4.7-flash');
      expect(ev.backend).toBe('cloudflare');
      expect(ev.costUsd).toBeCloseTo(0.0023);
      expect(ev.metadata).toEqual({ intent: 'route', confidence: 0.91 });
    });

    it('rejects empty actorId', () => {
      expect(() => store.record({
        actorId: '',
        turnId: 't',
        role: 'assistant',
        eventType: 'turn_complete',
        content: 'x',
      })).toThrow(/actorId/);
    });

    it('rejects empty turnId', () => {
      expect(() => store.record({
        actorId: 'a',
        turnId: '',
        role: 'assistant',
        eventType: 'turn_complete',
        content: 'x',
      })).toThrow(/turnId/);
    });

    it('rejects unknown role', () => {
      expect(() => store.record({
        actorId: 'a',
        turnId: 't',
        role: 'wizard',
        eventType: 'turn_complete',
        content: 'x',
      })).toThrow(/role/);
    });

    it('rejects unknown eventType', () => {
      expect(() => store.record({
        actorId: 'a',
        turnId: 't',
        role: 'assistant',
        eventType: 'magic',
        content: 'x',
      })).toThrow(/eventType/);
    });

    it('truncates content over maxContentBytes and records originalLength', () => {
      const tinyStore = createTranscriptStore(createTestDb(), { now, maxContentBytes: 16 });
      const huge = 'x'.repeat(10_000);
      const ev = tinyStore.record({
        actorId: 'a',
        turnId: 't',
        role: 'assistant',
        eventType: 'turn_complete',
        content: huge,
      });
      expect(ev.content.length).toBe(16);
      expect(ev.metadata).toMatchObject({
        truncated: true,
        originalLength: 10_000,
        originalBytes: 10_000,
      });
    });

    it('preserves caller metadata when truncating (merges with truncation flags)', () => {
      const tinyStore = createTranscriptStore(createTestDb(), { now, maxContentBytes: 8 });
      const ev = tinyStore.record({
        actorId: 'a',
        turnId: 't',
        role: 'assistant',
        eventType: 'turn_complete',
        content: 'x'.repeat(500),
        metadata: { intent: 'route' },
      });
      expect(ev.metadata).toMatchObject({
        intent: 'route',
        truncated: true,
      });
    });
  });

  // ---------------------------------------------------------------------
  // query()
  // ---------------------------------------------------------------------

  describe('query', () => {
    function seedFixtures(s) {
      const events = [
        { actorId: 'agent-x', sessionId: 's1', turnId: 't1', role: 'user', eventType: 'turn_complete', content: 'one' },
        { actorId: 'agent-x', sessionId: 's1', turnId: 't2', role: 'assistant', eventType: 'turn_complete', content: 'two' },
        { actorId: 'agent-y', sessionId: 's2', turnId: 't3', role: 'tool', eventType: 'tool_call', content: 'three' },
        { actorId: 'agent-x', sessionId: 's1', turnId: 't4', role: 'assistant', eventType: 'error', content: 'four' },
        { actorId: 'agent-y', turnId: 't5', role: 'audit', eventType: 'cli_call', content: 'five' },
      ];
      events.forEach((e, i) => {
        clock = 1_700_000_000_000 + i * 1000;
        s.record(e);
      });
    }

    it('returns most-recent-first by default', () => {
      seedFixtures(store);
      const all = store.query();
      expect(all.map((e) => e.content)).toEqual(['five', 'four', 'three', 'two', 'one']);
    });

    it('respects order: asc', () => {
      seedFixtures(store);
      const all = store.query({ order: 'asc' });
      expect(all.map((e) => e.content)).toEqual(['one', 'two', 'three', 'four', 'five']);
    });

    it('filters by actorId', () => {
      seedFixtures(store);
      const xs = store.query({ actorId: 'agent-x' });
      expect(xs.map((e) => e.content).sort()).toEqual(['four', 'one', 'two']);
    });

    it('filters by sessionId', () => {
      seedFixtures(store);
      const s1 = store.query({ sessionId: 's1' });
      expect(s1).toHaveLength(3);
      expect(s1.every((e) => e.sessionId === 's1')).toBe(true);
    });

    it('filters by turnId', () => {
      seedFixtures(store);
      const t3 = store.query({ turnId: 't3' });
      expect(t3).toHaveLength(1);
      expect(t3[0].content).toBe('three');
    });

    it('filters by eventType', () => {
      seedFixtures(store);
      const errs = store.query({ eventType: 'error' });
      expect(errs).toHaveLength(1);
      expect(errs[0].content).toBe('four');
    });

    it('filters by since (inclusive)', () => {
      seedFixtures(store);
      const sinceT3 = store.query({ since: 1_700_000_002_000, order: 'asc' });
      expect(sinceT3.map((e) => e.content)).toEqual(['three', 'four', 'five']);
    });

    it('filters by until (inclusive)', () => {
      seedFixtures(store);
      const untilT3 = store.query({ until: 1_700_000_002_000, order: 'asc' });
      expect(untilT3.map((e) => e.content)).toEqual(['one', 'two', 'three']);
    });

    it('respects limit', () => {
      seedFixtures(store);
      const two = store.query({ limit: 2 });
      expect(two).toHaveLength(2);
      expect(two.map((e) => e.content)).toEqual(['five', 'four']);
    });

    it('clamps limit above MAX_QUERY_LIMIT', () => {
      seedFixtures(store);
      const ten = store.query({ limit: 1_000_000 });
      expect(ten.length).toBeLessThanOrEqual(10_000);
    });

    it('clamps limit at or below 1', () => {
      seedFixtures(store);
      const zero = store.query({ limit: 0 });
      expect(zero.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // stats()
  // ---------------------------------------------------------------------

  describe('stats', () => {
    it('returns zeros on empty store', () => {
      const s = store.stats();
      expect(s).toEqual({
        total: 0,
        uniqueActors: 0,
        uniqueSessions: 0,
        uniqueTurns: 0,
        firstEventTs: null,
        lastEventTs: null,
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
      });
    });

    it('aggregates totals across all events', () => {
      clock = 100;
      store.record({ actorId: 'a', sessionId: 's1', turnId: 't1', role: 'assistant', eventType: 'turn_complete', content: 'x', tokensIn: 10, tokensOut: 20, costUsd: 0.001 });
      clock = 200;
      store.record({ actorId: 'a', sessionId: 's1', turnId: 't2', role: 'assistant', eventType: 'turn_complete', content: 'y', tokensIn: 5, tokensOut: 15, costUsd: 0.0005 });
      clock = 300;
      store.record({ actorId: 'b', sessionId: 's2', turnId: 't3', role: 'assistant', eventType: 'turn_complete', content: 'z', tokensIn: 100, tokensOut: 200, costUsd: 0.05 });

      const s = store.stats();
      expect(s.total).toBe(3);
      expect(s.uniqueActors).toBe(2);
      expect(s.uniqueSessions).toBe(2);
      expect(s.uniqueTurns).toBe(3);
      expect(s.firstEventTs).toBe(100);
      expect(s.lastEventTs).toBe(300);
      expect(s.totalCostUsd).toBeCloseTo(0.0515);
      expect(s.totalTokensIn).toBe(115);
      expect(s.totalTokensOut).toBe(235);
    });

    it('scopes stats by actorId', () => {
      clock = 100;
      store.record({ actorId: 'a', turnId: 't1', role: 'assistant', eventType: 'turn_complete', content: 'x', tokensIn: 10, costUsd: 0.001 });
      store.record({ actorId: 'b', turnId: 't2', role: 'assistant', eventType: 'turn_complete', content: 'y', tokensIn: 100, costUsd: 0.05 });

      const s = store.stats({ actorId: 'a' });
      expect(s.total).toBe(1);
      expect(s.totalTokensIn).toBe(10);
      expect(s.totalCostUsd).toBeCloseTo(0.001);
    });

    it('scopes stats by since/until', () => {
      clock = 100;
      store.record({ actorId: 'a', turnId: 't1', role: 'assistant', eventType: 'turn_complete', content: 'x', costUsd: 0.001 });
      clock = 500;
      store.record({ actorId: 'a', turnId: 't2', role: 'assistant', eventType: 'turn_complete', content: 'y', costUsd: 0.002 });
      clock = 1000;
      store.record({ actorId: 'a', turnId: 't3', role: 'assistant', eventType: 'turn_complete', content: 'z', costUsd: 0.003 });

      const window = store.stats({ since: 200, until: 800 });
      expect(window.total).toBe(1);
      expect(window.totalCostUsd).toBeCloseTo(0.002);
    });
  });

  // ---------------------------------------------------------------------
  // metadata edge cases
  // ---------------------------------------------------------------------

  describe('metadata round-trip', () => {
    it('preserves nested objects and arrays', () => {
      const ev = store.record({
        actorId: 'a',
        turnId: 't',
        role: 'tool',
        eventType: 'tool_call',
        content: '{}',
        metadata: { tool: 'pd:knowledge.ideas_search', args: { q: 'auth', tags: ['security', 'session'] }, nested: { depth: 2 } },
      });
      const got = store.query({ turnId: 't' })[0];
      expect(got.metadata).toEqual({
        tool: 'pd:knowledge.ideas_search',
        args: { q: 'auth', tags: ['security', 'session'] },
        nested: { depth: 2 },
      });
      expect(got.id).toBe(ev.id);
    });

    it('returns null metadata when not provided', () => {
      store.record({ actorId: 'a', turnId: 't', role: 'audit', eventType: 'cli_call', content: 'pd whoami' });
      const got = store.query({ turnId: 't' })[0];
      expect(got.metadata).toBeNull();
    });

    it('falls back to {_parseError, raw} if metadata column is hand-corrupted', () => {
      // Simulate corruption: write malformed JSON directly (would only happen
      // via direct DB tampering — record() always JSON.stringifies).
      db.prepare(`
        INSERT INTO transcript_events (
          actor_id, turn_id, role, event_type, content, ts, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('a', 'tcorrupt', 'audit', 'cli_call', 'x', clock, '{not json');
      const got = store.query({ turnId: 'tcorrupt' })[0];
      expect(got.metadata).toMatchObject({ _parseError: true });
    });
  });
});
