import { createTestDb } from '../setup-unit.js';
import { createSuggestions } from '../../lib/suggestions.js';

let db;
let clock;
let suggestions;

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  db = createTestDb();
  clock = 1_700_000_000_000;
  suggestions = createSuggestions(db, { now: () => clock });
});

afterEach(() => {
  db.close();
});

function make(overrides = {}) {
  return suggestions.create({
    agentId: 'agent-a',
    kind: 'claim-overlap-headsup',
    payload: { filePath: 'lib/x.ts', note: 'overlap' },
    payloadHash: 'hash-1',
    ...overrides,
  });
}

describe('create', () => {
  test('surfaces a pending suggestion with parsed payload', () => {
    const res = make();
    expect(res.created).toBe(true);
    const s = res.suggestion;
    expect(s.status).toBe('pending');
    expect(s.agentId).toBe('agent-a');
    expect(s.kind).toBe('claim-overlap-headsup');
    expect(s.payload).toEqual({ filePath: 'lib/x.ts', note: 'overlap' });
    expect(s.confidence).toBe(suggestions.policy.defaultConfidence);
    expect(s.createdAt).toBe(clock);
  });

  test('derives a payloadHash when none is supplied', () => {
    const res = suggestions.create({ agentId: 'a', kind: 'prior-art-doc', payload: { x: 1 } });
    expect(res.created).toBe(true);
    expect(res.suggestion.payloadHash).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('cooldown', () => {
  test('suppresses an identical (agent, kind, hash) within the window', () => {
    expect(make().created).toBe(true);
    clock += HOUR; // still inside the 4h default
    const res = make();
    expect(res.created).toBe(false);
    expect(res).toMatchObject({ reason: 'cooldown' });
  });

  test('re-surfaces once the cooldown lapses', () => {
    expect(make().created).toBe(true);
    clock += 4 * HOUR + 1;
    expect(make().created).toBe(true);
  });

  test('declining re-anchors the cooldown to the decline time, not createdAt', () => {
    const first = make();
    // Let the suggestion sit nearly the whole window, THEN decline. If the cooldown
    // were anchored only to createdAt, advancing 3h here + 2h below (5h > 4h) would
    // let the same hash re-surface. Anchoring to the decline keeps it quiet.
    clock += 3 * HOUR;
    suggestions.decline(first.suggestion.id);
    clock += 2 * HOUR; // 5h since create, but only 2h since decline
    // a *different* hash is unaffected
    expect(make({ payloadHash: 'hash-2' }).created).toBe(true);
    // same hash still cooling down because decline re-armed the 4h window
    expect(make().created).toBe(false);
    // and it re-surfaces once 4h have passed since the decline
    clock += 2 * HOUR + 1;
    expect(make().created).toBe(true);
  });
});

describe('budget', () => {
  test('caps surfaced suggestions per agent per rolling hour', () => {
    const budgetDb = createTestDb();
    try {
      const s = createSuggestions(budgetDb, { now: () => clock, policy: { hourlyBudget: 3 } });
      for (let i = 0; i < 3; i++) {
        expect(s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: { i }, payloadHash: `h${i}` }).created).toBe(true);
      }
      const over = s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: { i: 4 }, payloadHash: 'h4' });
      expect(over).toMatchObject({ created: false, reason: 'budget' });
    } finally {
      budgetDb.close();
    }
  });

  test('budget is per-agent, not global', () => {
    const budgetDb = createTestDb();
    try {
      const s = createSuggestions(budgetDb, { now: () => clock, policy: { hourlyBudget: 1 } });
      expect(s.create({ agentId: 'a', kind: 'claim-overlap-headsup', payload: {}, payloadHash: 'x' }).created).toBe(true);
      expect(s.create({ agentId: 'b', kind: 'claim-overlap-headsup', payload: {}, payloadHash: 'x' }).created).toBe(true);
    } finally {
      budgetDb.close();
    }
  });
});

describe('mute', () => {
  test('mutes a whole kind for an agent until the deadline', () => {
    suggestions.mute('agent-a', 'claim-overlap-headsup', clock + 24 * HOUR);
    expect(make()).toMatchObject({ created: false, reason: 'muted' });
    // other agent unaffected
    expect(make({ agentId: 'agent-b' }).created).toBe(true);
  });

  test('mute lapses after its deadline', () => {
    suggestions.mute('agent-a', 'claim-overlap-headsup', clock + HOUR);
    expect(make().created).toBe(false);
    clock += HOUR + 1;
    expect(make().created).toBe(true);
  });
});

describe('lifecycle', () => {
  test('accept moves pending → accepted and refuses double-accept', () => {
    const { suggestion } = make();
    const ok = suggestions.accept(suggestion.id);
    expect(ok.success).toBe(true);
    expect(ok.suggestion.status).toBe('accepted');
    expect(ok.suggestion.actedOnAt).toBe(clock);
    expect(suggestions.accept(suggestion.id)).toMatchObject({ success: false });
  });

  test('decline moves pending → declined', () => {
    const { suggestion } = make();
    expect(suggestions.decline(suggestion.id).suggestion.status).toBe('declined');
  });

  test('list filters by agent and status', () => {
    make();
    make({ agentId: 'agent-b', payloadHash: 'hb' });
    expect(suggestions.list({ agentId: 'agent-a' })).toHaveLength(1);
    expect(suggestions.list({ status: 'pending' })).toHaveLength(2);
  });

  test('expireStale sweeps old pending suggestions', () => {
    make();
    clock += 48 * HOUR;
    const moved = suggestions.expireStale(24 * HOUR);
    expect(moved).toBe(1);
    expect(suggestions.list({ status: 'expired' })).toHaveLength(1);
  });
});
