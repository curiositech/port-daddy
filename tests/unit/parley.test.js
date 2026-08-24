import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import { createParley } from '../../lib/parley.js';
import { CONFLICT_SIGNAL_LIMITS } from '../../lib/parley-trigger.js';
import { createTestDb } from '../setup-unit.js';

const TENANT = 'parley-unit-test';
const HARBOR = 'port-daddy';
const BASE_TIME = 1_700_000_000_000;

let db;
let clock;
let inbox;
let parley;

beforeEach(() => {
  db = createTestDb();
  clock = BASE_TIME;
  inbox = createAgentInbox(db);
  parley = createParley({
    db,
    tenantId: TENANT,
    defaultHarbor: HARBOR,
    agentInbox: inbox,
    now: () => clock,
  });
});

afterEach(() => {
  db.close();
});

function advance(ms) {
  clock += ms;
}

function openParley(overrides = {}) {
  return parley.call({
    surface: 'lib/dispatch.ts',
    reason: 'two agents are changing dispatch semantics',
    parties: ['agent-a', 'agent-b'],
    calledBy: 'operator',
    harbor: HARBOR,
    ...overrides,
  });
}

function count(table, suffix = '', params = []) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count FROM ${table}
    WHERE tenant_id = ? AND harbor = ?${suffix}
  `).get(TENANT, HARBOR, ...params).count);
}

function recordingInbox(deliver) {
  const deliveries = [];
  const successfulKeys = new Set();
  return {
    deliveries,
    internal: {
      sendOnce(agentId, content, options) {
        deliveries.push({ agentId, content, options });
        const result = deliver?.(agentId, content, options) ?? { success: true };
        if (result.success) successfulKeys.add(options.deliveryKey);
        return result.success
          ? { success: true, messageId: successfulKeys.size }
          : result;
      },
    },
  };
}

describe('manual Parley admission', () => {
  test('opens one indexed Parley and durably delivers one summons per party', () => {
    const opened = openParley();

    expect(opened).toMatchObject({
      parleyId: expect.any(String),
      status: 'SUMMONED',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      harbor: HARBOR,
      automatic: null,
    });
    expect(opened.channel).toBe(`parley:${opened.parleyId}`);
    expect(count('parley_records', ' AND parley_id = ?', [opened.parleyId])).toBe(1);
    expect(count('parley_participants', ' AND parley_id = ?', [opened.parleyId])).toBe(3);
    expect(count('parley_notification_outbox', ' AND parley_id = ? AND state = ?', [opened.parleyId, 'delivered']))
      .toBe(2);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    expect(inbox.list('agent-b').messages).toHaveLength(1);
    expect(db.prepare('SELECT delivery_key FROM agent_inbox WHERE agent_id = ?').get('agent-a'))
      .toEqual({ delivery_key: `parley_summons:${opened.parleyId}:agent-a` });
  });

  test('uses the idempotent internal inbox boundary and sends structured summons', () => {
    const target = recordingInbox();
    const instance = createParley({
      db,
      tenantId: TENANT,
      defaultHarbor: HARBOR,
      agentInbox: target,
      now: () => clock,
    });

    const opened = instance.call({
      surface: 'lib/sessions.ts',
      reason: 'overlapping ownership',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
    });

    expect(target.deliveries.map((message) => message.agentId)).toEqual(['agent-a', 'agent-b']);
    expect(target.deliveries[0].options).toMatchObject({
      from: 'operator',
      type: 'parley_summons',
      contentType: 'json',
      deliveryKey: `parley_summons:${opened.parleyId}:agent-a`,
    });
    expect(target.deliveries[0].content).toMatchObject({
      kind: 'parley_summons',
      parleyId: opened.parleyId,
      surface: 'lib/sessions.ts',
      channel: `parley:${opened.parleyId}`,
    });
  });

  test('requires exactly one SQLite authority and a tenant for direct database construction', () => {
    expect(() => createParley({})).toThrow(/exactly one of store or db/);
    expect(() => createParley({ db })).toThrow(/tenantId is required/);
  });

  test('rejects malformed or over-capacity calls before durable side effects', () => {
    expect(() => openParley({ parties: ['agent-a'] })).toThrow(/at least two parties/);
    expect(() => openParley({ surface: 's'.repeat(CONFLICT_SIGNAL_LIMITS.maxSurfaceChars + 1) }))
      .toThrow(/surface exceeds/);
    expect(() => openParley({ reason: 'r'.repeat(CONFLICT_SIGNAL_LIMITS.maxReasonChars + 1) }))
      .toThrow(/reason exceeds/);
    expect(() => openParley({ ttlMs: -1 })).toThrow(/bounded non-negative integer/);
    expect(() => openParley({ roundLimit: 65 })).toThrow(/between 1 and 64/);
    expect(() => openParley({
      parties: Array.from({ length: CONFLICT_SIGNAL_LIMITS.maxParties + 1 }, (_, index) => `agent-${index}`),
    })).toThrow(/parties exceed/);
    expect(count('parley_records')).toBe(0);
    expect(count('parley_notification_outbox')).toBe(0);
  });

  test('manual identities stay random and caller-supplied automatic fields are ignored', () => {
    const attemptedInternalFields = {
      surface: 'x',
      reason: 'y',
      parties: ['a', 'b'],
      calledBy: 'operator',
      harbor: HARBOR,
      idempotencyKey: 'caller-key',
      automatic: { signalId: 'forged' },
    };
    const first = parley.call(attemptedInternalFields);
    const second = parley.call(attemptedInternalFields);

    expect(first.parleyId).not.toBe(second.parleyId);
    expect(first.automatic).toBeNull();
    expect(second.automatic).toBeNull();
  });
});

describe('turns and terminal settlement', () => {
  test('convenes only after every summoned party responds', () => {
    const opened = openParley();
    parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'ship A',
      proposalId: 'a',
    });

    expect(parley.get(opened.parleyId)).toMatchObject({
      status: 'SUMMONED',
      respondedParties: ['agent-a'],
      missingParties: ['agent-b'],
    });

    parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-b',
      performative: 'critique',
      content: 'A needs one revision',
    });

    expect(parley.get(opened.parleyId)).toMatchObject({
      status: 'CONVENED',
      respondedParties: ['agent-a', 'agent-b'],
      missingParties: [],
    });
  });

  test('refusal escalates atomically and later turns are rejected', () => {
    const opened = openParley();
    parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-a',
      performative: 'refuse',
      content: 'cannot accept this scope',
    });

    const summary = parley.get(opened.parleyId);
    expect(summary.status).toBe('ESCALATED');
    expect(summary.outcome).toMatchObject({
      status: 'ESCALATED',
      reason: 'agent-a refused the Parley',
      dissenters: ['agent-a'],
    });
    expect(() => parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-b',
      performative: 'inform',
      content: 'too late',
    })).toThrow(/already ESCALATED/);
  });

  test('read-path TTL settlement is exact and idempotent', () => {
    const opened = openParley({ ttlMs: 1_000 });
    advance(1_000);
    expect(parley.get(opened.parleyId)).toMatchObject({ status: 'SUMMONED', expired: false });

    advance(1);
    const settled = parley.get(opened.parleyId);
    expect(settled).toMatchObject({ status: 'ESCALATED', expired: true });
    expect(settled.outcome.reason).toBe('response TTL expired without terminal outcome');
    expect(parley.get(opened.parleyId).outcome).toEqual(settled.outcome);
    expect(count('parley_outcomes', ' AND parley_id = ?', [opened.parleyId])).toBe(1);
  });

  test('rejects unsummoned actors', () => {
    const opened = openParley();
    expect(() => parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-c',
      performative: 'inform',
      content: 'hi',
    })).toThrow(/not summoned/);
  });

  test('round limits escalate budgeted turns but still allow agreement', () => {
    const limited = openParley({ roundLimit: 1 });
    parley.respond({
      parleyId: limited.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'first proposal',
    });
    expect(() => parley.respond({
      parleyId: limited.parleyId,
      party: 'agent-a',
      performative: 'critique',
      content: 'extra critique',
    })).toThrow(/round limit exhausted/);
    expect(parley.get(limited.parleyId).outcome.reason).toBe('round limit exhausted for agent-a');

    const agreement = openParley({ roundLimit: 1 });
    parley.respond({
      parleyId: agreement.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'first proposal',
    });
    expect(() => parley.respond({
      parleyId: agreement.parleyId,
      party: 'agent-a',
      performative: 'agree',
      content: 'I can live with this',
    })).not.toThrow();
  });

  test('production resolve is unreachable and exposes no raw store escape hatch', () => {
    const opened = openParley();
    expect(() => parley.resolve({
      parleyId: opened.parleyId,
      status: 'COLLAPSED',
      decision: 'forged decision',
      resolvedBy: 'self-asserted-operator',
    })).toThrow(/unavailable until CAP0/);
    expect(parley.internal).toEqual({
      admitAutomaticInTransaction: expect.any(Function),
      drainNotifications: expect.any(Function),
    });
    expect(parley.internal).not.toHaveProperty('store');
    expect(parley.get(opened.parleyId).status).toBe('SUMMONED');
  });
});

describe('durable notification fan-out', () => {
  test('a turn reaches every other participant, including the caller', () => {
    const target = recordingInbox();
    const instance = createParley({
      db,
      tenantId: TENANT,
      defaultHarbor: HARBOR,
      agentInbox: target,
      now: () => clock,
    });
    const opened = instance.call({
      surface: 'lib/dispatch.ts',
      reason: 'overlap',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
    });
    target.deliveries.length = 0;

    const result = instance.respond({
      parleyId: opened.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'ship A',
      evidenceRefs: ['docs/adr/0119.md'],
    });

    expect(result.notified).toEqual(['agent-b', 'operator']);
    expect(result.notifyFailures).toEqual([]);
    expect(target.deliveries.map((message) => message.agentId)).toEqual(['agent-b', 'operator']);
    expect(target.deliveries[0]).toMatchObject({
      agentId: 'agent-b',
      content: {
        kind: 'parley_turn',
        parleyId: opened.parleyId,
        party: 'agent-a',
        performative: 'propose',
        evidenceRefs: ['docs/adr/0119.md'],
      },
      options: { type: 'parley_turn', from: 'agent-a' },
    });
  });

  test('delivery failure never rolls back a committed turn and retries from the outbox', () => {
    let failAgentB = false;
    const target = recordingInbox((agentId, _content, options) => {
      if (failAgentB && options.type === 'parley_turn' && agentId === 'agent-b') {
        return { success: false, error: 'injected inbox outage' };
      }
      return { success: true };
    });
    const instance = createParley({
      db,
      tenantId: TENANT,
      defaultHarbor: HARBOR,
      agentInbox: target,
      now: () => clock,
    });
    const opened = instance.call({
      surface: 'lib/dispatch.ts',
      reason: 'overlap',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
    });
    failAgentB = true;

    const result = instance.respond({
      parleyId: opened.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'ship A',
    });

    expect(result.notified).toEqual(['operator']);
    expect(result.notifyFailures).toEqual(['agent-b: injected inbox outage']);
    expect(instance.get(opened.parleyId).turns).toHaveLength(1);
    expect(count('parley_notification_outbox', ' AND parley_id = ? AND state = ?', [opened.parleyId, 'pending']))
      .toBe(1);

    failAgentB = false;
    advance(250);
    instance.internal.drainNotifications(HARBOR);
    expect(instance.get(opened.parleyId).turns).toHaveLength(1);
    expect(count('parley_notification_outbox', ' AND parley_id = ? AND state = ?', [opened.parleyId, 'pending']))
      .toBe(0);
  });
});

describe('seen receipts', () => {
  test('summaries report per-participant unseen turns and durable watermarks', () => {
    const opened = openParley();
    parley.respond({ parleyId: opened.parleyId, party: 'agent-a', performative: 'propose', content: 'ship A' });
    advance(1_000);
    parley.respond({ parleyId: opened.parleyId, party: 'agent-b', performative: 'critique', content: 'A breaks dispatch' });

    expect(parley.get(opened.parleyId).receipts).toEqual([
      { party: 'agent-a', lastSeenAt: null, unseenTurns: 1 },
      { party: 'agent-b', lastSeenAt: null, unseenTurns: 1 },
      { party: 'operator', lastSeenAt: null, unseenTurns: 2 },
    ]);

    const receipt = parley.markSeen({ parleyId: opened.parleyId, party: 'agent-a' });
    expect(receipt).toEqual({ party: 'agent-a', lastSeenAt: clock, unseenTurns: 0 });
    expect(parley.get(opened.parleyId).receipts.find((item) => item.party === 'operator').unseenTurns)
      .toBe(2);
  });

  test('a stale turn sequence cannot regress and repeated reads keep one authoritative row', () => {
    const opened = openParley();
    parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'first durable turn',
      idempotencyKey: 'seen-stale:first',
    });
    parley.markSeen({ parleyId: opened.parleyId, party: 'agent-a' });
    advance(1_000);
    parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-b',
      performative: 'critique',
      content: 'second durable turn',
      idempotencyKey: 'seen-stale:second',
    });
    parley.markSeen({ parleyId: opened.parleyId, party: 'agent-a' });
    advance(1_000);

    const stale = parley.markSeen({
      parleyId: opened.parleyId,
      party: 'agent-a',
      throughTurnSequence: 0,
    });
    expect(stale.lastSeenAt).toBe(clock - 1_000);
    expect(count('parley_seen_receipts', ' AND parley_id = ? AND actor_id = ?', [opened.parleyId, 'agent-a']))
      .toBe(1);
  });

  test('a beyond-frontier turn sequence is rejected and cannot hide a later turn', () => {
    const opened = openParley();
    expect(() => parley.markSeen({
      parleyId: opened.parleyId,
      party: 'agent-a',
      throughTurnSequence: 1,
    })).toThrow(/exceeds durable turn frontier 0/);

    advance(1);
    parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-b',
      performative: 'inform',
      content: 'this turn must remain visible',
      idempotencyKey: 'seen-future:later-turn',
    });
    expect(parley.get(opened.parleyId).receipts.find((item) => item.party === 'agent-a'))
      .toEqual({ party: 'agent-a', lastSeenAt: null, unseenTurns: 1 });
  });

  test('acknowledging sequence one cannot hide sequence two from the same millisecond', () => {
    const opened = openParley();
    const first = parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'first turn in the shared millisecond',
      idempotencyKey: 'public-same-ms:first',
    });
    const second = parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-b',
      performative: 'critique',
      content: 'second turn in the shared millisecond',
      idempotencyKey: 'public-same-ms:second',
    });

    expect(first.turn.at).toBe(clock);
    expect(second.turn.at).toBe(clock);
    expect(first.turnSequence).toBe(1);
    expect(second.turnSequence).toBe(2);

    expect(parley.markSeen({
      parleyId: opened.parleyId,
      party: 'operator',
      throughTurnSequence: 1,
    })).toEqual({ party: 'operator', lastSeenAt: clock, unseenTurns: 1 });
    expect(parley.get(opened.parleyId).receipts.find((item) => item.party === 'operator'))
      .toEqual({ party: 'operator', lastSeenAt: clock, unseenTurns: 1 });
  });

  test('timestamp seen watermarks are rejected rather than treated as compatibility input', () => {
    const opened = openParley();
    expect(() => parley.markSeen({
      parleyId: opened.parleyId,
      party: 'agent-a',
      throughAt: clock,
    })).toThrow(/timestamp watermarks are not accepted/);
  });

  test('unknown participants cannot write receipts', () => {
    const opened = openParley();
    expect(() => parley.markSeen({ parleyId: opened.parleyId, party: 'stranger' }))
      .toThrow(/not part of/);
  });
});

test('manual call, turn, and receipt paths never write tuple authority', () => {
  const opened = openParley();
  parley.respond({
    parleyId: opened.parleyId,
    party: 'agent-a',
    performative: 'propose',
    content: 'ship A',
  });
  parley.markSeen({ parleyId: opened.parleyId, party: 'agent-b' });

  expect(db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name = 'tuples'
  `).get()).toEqual({ count: 0 });
});

test('production Parley authority has no tuple dependency or tuple event vocabulary', () => {
  const authoritySources = [
    new URL('../../lib/parley.ts', import.meta.url),
    new URL('../../lib/parley-auto-trigger.ts', import.meta.url),
    new URL('../../lib/parley-store.ts', import.meta.url),
  ].map((url) => readFileSync(url, 'utf8'));
  const serverSource = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');

  for (const source of authoritySources) {
    expect(source).not.toMatch(/from ['"][^'"]*tuples(?:\.js)?['"]/);
    expect(source).not.toMatch(/\b(?:outOnce|getByIdempotencyKey|takeByIdempotencyKey)\s*\(/);
    expect(source).not.toMatch(/parley:(?:opened|summons|turn|outcome|seen|auto)/);
  }
  expect(serverSource).toMatch(/createParley\(\{\s*db,\s*tenantId:/);
  expect(serverSource).not.toMatch(/createParley\(\{[^}]*\btuples\b/s);

});
