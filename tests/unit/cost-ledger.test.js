/**
 * Unit tests for lib/cost-ledger.ts
 */
import { describe, test, expect, beforeEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createCostLedger } from '../../lib/cost-ledger.js';
import { createTranscriptStore } from '../../lib/transcript-store.js';
import { createCostTracker } from '../../lib/cost-tracker.js';

function freshDb() {
  const db = new Database(':memory:');
  return db;
}

describe('cost-ledger / rollup', () => {
  let db, ledger, transcripts, tracker, clock;

  beforeEach(() => {
    db = freshDb();
    clock = 1_700_000_000_000;
    const now = () => clock;
    transcripts = createTranscriptStore(db, { now });
    tracker = createCostTracker(db);
    ledger = createCostLedger(db, { now, proximityThreshold: 0.8 });
  });

  test('all-window rollup sums both transcript and spawn rows', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'assistant', eventType: 'turn_complete',
      content: 'ok', model: 'sonnet', backend: 'anthropic',
      tokensIn: 100, tokensOut: 50, costUsd: 0.001,
    });
    tracker.record({
      backend: 'claude-cli', model: 'sonnet',
      projectName: 'port-daddy', identity: 'pd:agent', spawnId: 'sp1',
      inputTokens: 200, outputTokens: 80,
    });

    const r = ledger.rollup({ window: 'all' });
    expect(r.turnCount).toBe(2);
    expect(r.totalUsd).toBeGreaterThan(0);
    expect(r.inputTokens).toBe(300);
    expect(r.outputTokens).toBe(130);
  });

  test('window=hour excludes events older than 1h', () => {
    // Old event 2h ago
    clock = 1_700_000_000_000 - 7_200_000;
    transcripts.record({
      actorId: 'a1', turnId: 'old', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 5, tokensIn: 0, tokensOut: 0,
    });
    // Recent event (now)
    clock = 1_700_000_000_000;
    transcripts.record({
      actorId: 'a1', turnId: 'new', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 1, tokensIn: 0, tokensOut: 0,
    });

    expect(ledger.rollup({ window: 'hour' }).totalUsd).toBe(1);
    expect(ledger.rollup({ window: 'all' }).totalUsd).toBe(6);
  });

  test('rollup ignores transcript events without cost_usd', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'tool', eventType: 'tool_call',
      content: 'pd note', // no costUsd
    });
    expect(ledger.rollup({ window: 'all' }).turnCount).toBe(0);
  });

  test('rollup ignores non-turn_complete transcript events', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'tool', eventType: 'tool_result',
      content: '', costUsd: 99,
    });
    expect(ledger.rollup({ window: 'all' }).turnCount).toBe(0);
  });

  test('invalid window throws', () => {
    expect(() => ledger.rollup({ window: 'fortnight' })).toThrow(/invalid window/);
  });

  test('filter narrows rollup', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 1, tokensIn: 0, tokensOut: 0, backend: 'anthropic',
    });
    transcripts.record({
      actorId: 'a2', turnId: 't2', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 2, tokensIn: 0, tokensOut: 0, backend: 'cloudflare',
    });
    expect(ledger.rollup({ window: 'all', filter: { actor: 'a1' } }).totalUsd).toBe(1);
    expect(ledger.rollup({ window: 'all', filter: { backend: 'cloudflare' } }).totalUsd).toBe(2);
  });
});

describe('cost-ledger / bySlice', () => {
  let db, ledger, transcripts, tracker, clock;
  beforeEach(() => {
    db = freshDb();
    clock = 1_700_000_000_000;
    const now = () => clock;
    transcripts = createTranscriptStore(db, { now });
    tracker = createCostTracker(db);
    ledger = createCostLedger(db, { now });
  });

  test('bySlice("actor") groups by actor across both sources', () => {
    transcripts.record({
      actorId: 'comms', turnId: 't1', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 1, tokensIn: 100, tokensOut: 50,
    });
    tracker.record({
      backend: 'claude-cli', model: 'sonnet',
      projectName: 'port-daddy', identity: 'comms', spawnId: 'sp',
      inputTokens: 200, outputTokens: 100,
    });
    const rows = ledger.bySlice('actor', { window: 'all' });
    const comms = rows.find(r => r.key === 'comms');
    expect(comms).toBeDefined();
    expect(comms.turnCount).toBe(2);
    expect(comms.inputTokens).toBe(300);
  });

  test('bySlice("project") only sees spawn rows (transcript has no project)', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 1, tokensIn: 0, tokensOut: 0,
    });
    tracker.record({
      backend: 'claude-cli', model: 'sonnet',
      projectName: 'port-daddy', identity: 'a1', spawnId: 'sp',
    });
    const rows = ledger.bySlice('project', { window: 'all' });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('port-daddy');
  });

  test('invalid slice throws', () => {
    expect(() => ledger.bySlice('vibes')).toThrow(/invalid slice/);
  });
});

describe('cost-ledger / caps', () => {
  let db, ledger, transcripts, clock;
  beforeEach(() => {
    db = freshDb();
    clock = 1_700_000_000_000;
    const now = () => clock;
    transcripts = createTranscriptStore(db, { now });
    createCostTracker(db);
    ledger = createCostLedger(db, { now, proximityThreshold: 0.8 });
  });

  test('setCap then listCaps round-trips', () => {
    const cap = ledger.setCap('global', '', 'day', 5);
    expect(cap.usdLimit).toBe(5);
    expect(ledger.listCaps()).toHaveLength(1);
  });

  test('setCap upserts on conflict', () => {
    ledger.setCap('global', '', 'day', 5);
    ledger.setCap('global', '', 'day', 10);
    const caps = ledger.listCaps();
    expect(caps).toHaveLength(1);
    expect(caps[0].usdLimit).toBe(10);
  });

  test('global scope rejects non-empty scopeKey', () => {
    expect(() => ledger.setCap('global', 'something', 'day', 1)).toThrow(/empty scopeKey/);
  });

  test('non-global scope requires scopeKey', () => {
    expect(() => ledger.setCap('actor', '', 'day', 1)).toThrow(/non-empty scopeKey/);
  });

  test('negative or non-finite limits throw', () => {
    expect(() => ledger.setCap('global', '', 'day', -1)).toThrow();
    expect(() => ledger.setCap('global', '', 'day', NaN)).toThrow();
    expect(() => ledger.setCap('global', '', 'day', Infinity)).toThrow();
  });

  test('capsStatus computes percentUsed against rollup', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 4, tokensIn: 0, tokensOut: 0,
    });
    ledger.setCap('global', '', 'day', 10);
    const [proximity] = ledger.capsStatus();
    expect(proximity.spentUsd).toBe(4);
    expect(proximity.percentUsed).toBe(40);
    expect(proximity.exceeded).toBe(false);
    expect(proximity.remainingUsd).toBe(6);
  });

  test('capsStatus exceeded=true when over limit', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 11, tokensIn: 0, tokensOut: 0,
    });
    ledger.setCap('global', '', 'day', 10);
    const [proximity] = ledger.capsStatus();
    expect(proximity.exceeded).toBe(true);
    expect(proximity.remainingUsd).toBe(0);
  });

  test('capsStatus({onlyNear:true}) filters below proximityThreshold', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 1, tokensIn: 0, tokensOut: 0,
    });
    ledger.setCap('global', '', 'day', 10);   // 10% used → not near
    ledger.setCap('actor', 'a1', 'day', 1.1);  // 91% used → near
    const near = ledger.capsStatus({ onlyNear: true });
    expect(near).toHaveLength(1);
    expect(near[0].cap.scope).toBe('actor');
  });

  test('capsStatus actor-scoped cap only counts that actor', () => {
    transcripts.record({
      actorId: 'a1', turnId: 't1', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 5, tokensIn: 0, tokensOut: 0,
    });
    transcripts.record({
      actorId: 'a2', turnId: 't2', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 3, tokensIn: 0, tokensOut: 0,
    });
    ledger.setCap('actor', 'a1', 'day', 10);
    const [proximity] = ledger.capsStatus();
    expect(proximity.spentUsd).toBe(5);
  });

  test('removeCap returns true when found, false otherwise', () => {
    const cap = ledger.setCap('global', '', 'day', 1);
    expect(ledger.removeCap(cap.id)).toBe(true);
    expect(ledger.removeCap(cap.id)).toBe(false);
    expect(ledger.listCaps()).toHaveLength(0);
  });
});

describe('cost-ledger / recent', () => {
  let db, ledger, transcripts, clock;
  beforeEach(() => {
    db = freshDb();
    clock = 1_700_000_000_000;
    const now = () => clock;
    transcripts = createTranscriptStore(db, { now });
    createCostTracker(db);
    ledger = createCostLedger(db, { now });
  });

  test('recent returns events newest-first', () => {
    transcripts.record({
      actorId: 'a', turnId: '1', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 0.5, tokensIn: 0, tokensOut: 0,
    });
    clock += 1000;
    transcripts.record({
      actorId: 'a', turnId: '2', role: 'assistant', eventType: 'turn_complete',
      content: '', costUsd: 0.7, tokensIn: 0, tokensOut: 0,
    });
    const rows = ledger.recent({ limit: 10 });
    expect(rows[0].costUsd).toBe(0.7);
    expect(rows[1].costUsd).toBe(0.5);
    expect(rows[0].source).toBe('transcript');
  });

  test('recent limit clamps within bounds', () => {
    for (let i = 0; i < 5; i++) {
      transcripts.record({
        actorId: 'a', turnId: `t${i}`, role: 'assistant', eventType: 'turn_complete',
        content: '', costUsd: 0.01, tokensIn: 0, tokensOut: 0,
      });
    }
    expect(ledger.recent({ limit: 3 })).toHaveLength(3);
  });
});

describe('cost-ledger / coexistence with cost-tracker view', () => {
  test('view survives even if tables initialize in different order', () => {
    const db = freshDb();
    // Create ledger first — it should idempotently shell the source tables.
    const ledger = createCostLedger(db);
    // Then layer on the real cost-tracker (would re-create cost_events).
    const tracker = createCostTracker(db);
    tracker.record({
      backend: 'claude-cli', model: 'sonnet',
      projectName: 'port-daddy', identity: 'a', spawnId: 'sp',
    });
    expect(ledger.rollup({ window: 'all' }).turnCount).toBe(1);
  });
});
