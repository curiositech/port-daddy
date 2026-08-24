import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import {
  AUTOMATIC_PARLEY_DEFAULTS,
  createParley,
  MAX_AUTOMATIC_PARLEY_IDEMPOTENCY_KEY_CHARS,
} from '../../lib/parley.js';
import { createAgentInbox } from '../../lib/agent-inbox.js';

let db;
let tuples;
let parley;
let clock;

beforeEach(() => {
  db = createTestDb();
  tuples = createTupleSpace(db);
  clock = 1_700_000_000_000;
  parley = createParley({ tuples, now: () => clock });
});

afterEach(() => {
  db.close();
});

function advance(ms) {
  clock += ms;
}

function openParley() {
  return parley.call({
    surface: 'lib/dispatch.ts',
    reason: 'two agents are changing dispatch semantics',
    parties: ['agent-a', 'agent-b'],
    calledBy: 'operator',
    harbor: 'port-daddy',
  });
}

function automaticInput(overrides = {}) {
  return {
    surface: 'lib/dispatch.ts#run',
    reason: 'two live claims resolve to the same symbol',
    participants: [
      {
        actorId: 'agent-b', inboxTarget: 'agent-b',
        sessionId: 'session-b', lineageRootSessionId: 'session-b',
      },
      {
        actorId: 'agent-a', inboxTarget: 'agent-a',
        sessionId: 'session-a', lineageRootSessionId: 'session-a',
      },
    ],
    trigger: 'claim_overlap',
    harbor: 'port-daddy',
    automatic: {
      idempotencyKey: 'parley-signal:v1:automatic-1',
      signalId: 'parley-signal:v1:automatic-1',
      lineageKey: 'parley-lineage:v1:claim-1',
      checkpoint: 'claim',
      kind: 'claim_overlap',
      shape: 'contract-net',
      evidenceRefs: ['claim:b', 'claim:a'],
      confidence: 0.95,
      magnitude: 2,
    },
    ...overrides,
  };
}

describe('call', () => {
  test('opens a summoned parley and writes summons tuples', () => {
    const p = openParley();

    expect(p.parleyId).toEqual(expect.any(String));
    expect(p.status).toBe('SUMMONED');
    expect(p.channel).toBe(`parley:${p.parleyId}`);

    const opened = tuples.rd(['parley:opened', p.parleyId, '*'], { harbor: 'port-daddy' });
    const summons = tuples.rd(['parley:summons', p.parleyId, '*', '*'], { harbor: 'port-daddy' });
    expect(opened).toHaveLength(1);
    expect(summons).toHaveLength(2);
  });

  test('sends structured inbox summons when an inbox dependency is provided', () => {
    const sent = [];
    const withInbox = createParley({
      tuples,
      now: () => clock,
      agentInbox: {
        send(agentId, content, options) {
          sent.push({ agentId, content, options });
          return { success: true };
        },
      },
    });

    const p = withInbox.call({
      surface: 'lib/dispatch.ts',
      reason: 'two agents are changing dispatch semantics',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      harbor: 'port-daddy',
    });

    expect(sent).toHaveLength(2);
    expect(sent.map((m) => m.agentId)).toEqual(['agent-a', 'agent-b']);
    expect(sent[0].options).toMatchObject({ from: 'operator', type: 'parley_summons', contentType: 'json' });
    expect(sent[0].content).toMatchObject({
      kind: 'parley_summons',
      parleyId: p.parleyId,
      surface: 'lib/dispatch.ts',
      channel: `parley:${p.parleyId}`,
    });
  });

  test('requires at least two parties', () => {
    expect(() => parley.call({
      surface: 'x',
      reason: 'y',
      parties: ['agent-a'],
      calledBy: 'operator',
    })).toThrow(/at least two/);
  });

  test('keeps manual calls random and ignores caller-supplied automatic fields', () => {
    const attemptedInternalFields = {
      surface: 'x',
      reason: 'y',
      parties: ['a', 'b'],
      calledBy: 'operator',
      idempotencyKey: 'caller-key',
      automatic: automaticInput().automatic,
    };
    const first = parley.call(attemptedInternalFields);
    const second = parley.call(attemptedInternalFields);

    expect(first.parleyId).not.toBe(second.parleyId);
    expect(first.automatic).toBeNull();
    expect(second.automatic).toBeNull();
  });
});

describe('automatic call durability', () => {
  test('uses frozen server lifecycle defaults and rejects forged lifecycle fields', () => {
    const automatic = createParley({ tuples, now: () => clock });

    expect(Object.isFrozen(AUTOMATIC_PARLEY_DEFAULTS)).toBe(true);
    const accepted = automatic.callAutomatic(automaticInput());
    expect(accepted.parley.responseDueAt).toBe(clock + AUTOMATIC_PARLEY_DEFAULTS.ttlMs);
    expect(accepted.parley.roundLimit).toBe(AUTOMATIC_PARLEY_DEFAULTS.roundLimit);

    expect(() => automatic.callAutomatic(automaticInput({ ttlMs: 1 })))
      .toThrow(/lifecycle overrides are not accepted/);
    expect(() => automatic.callAutomatic(automaticInput({ roundLimit: 99 })))
      .toThrow(/lifecycle overrides are not accepted/);
    expect(() => automatic.callAutomatic(automaticInput({ harbor: '' })))
      .toThrow(/harbor is required/);
  });

  test('rejects an automatic call whose durable key differs from its signal identity', () => {
    const automatic = createParley({ tuples, now: () => clock });

    expect(() => automatic.callAutomatic(automaticInput({
      automatic: {
        ...automaticInput().automatic,
        idempotencyKey: 'parley-signal:v1:split-identity',
      },
    }))).toThrow(/idempotencyKey must equal signalId/);
  });

  test('uses deterministic identity and creates one durable summons per party across replay', () => {
    const inbox = createAgentInbox(db);
    const automatic = createParley({ tuples, agentInbox: inbox, now: () => clock });

    const first = automatic.callAutomatic(automaticInput());
    const replay = automatic.callAutomatic(automaticInput());

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.parley).toEqual(first.parley);
    expect(replay.parley.parleyId).toMatch(/^parley-auto:/);
    expect(replay.parley.parties).toEqual(['agent-a', 'agent-b']);
    expect(replay.parley.automatic).toMatchObject({
      signalId: 'parley-signal:v1:automatic-1',
      checkpoint: 'claim',
      kind: 'claim_overlap',
      shape: 'contract-net',
      evidenceRefs: ['claim:a', 'claim:b'],
      confidence: 0.95,
      magnitude: 2,
      participants: [
        {
          actorId: 'agent-a', inboxTarget: 'agent-a',
          sessionId: 'session-a', lineageRootSessionId: 'session-a',
        },
        {
          actorId: 'agent-b', inboxTarget: 'agent-b',
          sessionId: 'session-b', lineageRootSessionId: 'session-b',
        },
      ],
    });
    expect(tuples.rd(['parley:opened', first.parley.parleyId, '*'], { harbor: 'port-daddy' })).toHaveLength(1);
    expect(tuples.rd(['parley:summons', first.parley.parleyId, '*', '*'], { harbor: 'port-daddy' })).toHaveLength(2);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    expect(inbox.list('agent-b').messages).toHaveLength(1);
    expect(inbox.list('agent-a').messages[0]).not.toHaveProperty('deliveryKey');
    expect(db.prepare('SELECT delivery_key FROM agent_inbox WHERE agent_id = ?').get('agent-a'))
      .toEqual({ delivery_key: `parley_summons:${first.parley.parleyId}:agent-a` });
  });

  test('reconciles a partial inbox delivery without duplicating prior writes', () => {
    const inbox = createAgentInbox(db);
    for (let i = 0; i < inbox.MAX_INBOX_MESSAGES; i++) {
      inbox.send('agent-b', `blocking-${i}`);
    }
    const automatic = createParley({ tuples, agentInbox: inbox, now: () => clock });

    const partial = automatic.callAutomatic(automaticInput());
    expect(partial.notificationFailures).toEqual([expect.stringMatching(/^agent-b via agent-b: Inbox full/)]);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    inbox.clear('agent-b');

    const reconciled = automatic.callAutomatic(automaticInput());
    expect(reconciled.replayed).toBe(true);
    expect(reconciled.notificationFailures).toEqual([]);
    expect(tuples.rd(['parley:opened', partial.parley.parleyId, '*'], { harbor: 'port-daddy' })).toHaveLength(1);
    expect(tuples.rd(['parley:summons', partial.parley.parleyId, '*', '*'], { harbor: 'port-daddy' })).toHaveLength(2);
    expect(inbox.list('agent-a').messages).toHaveLength(1);
    expect(inbox.list('agent-b').messages).toHaveLength(1);
  });

  test('rejects reuse of an automatic key for a different canonical call', () => {
    const automatic = createParley({ tuples, now: () => clock });
    automatic.callAutomatic(automaticInput());

    expect(() => automatic.callAutomatic(automaticInput({
      surface: 'lib/other.ts#run',
    }))).toThrow(/different canonical call/);
    expect(() => automatic.callAutomatic(automaticInput({
      participants: automaticInput().participants.map((participant, index) => (
        index === 0 ? { ...participant, inboxTarget: 'replacement-inbox' } : participant
      )),
    }))).toThrow(/different canonical call/);
    expect(tuples.rd(['parley:opened', '*', '*'], { harbor: 'port-daddy' })).toHaveLength(1);
  });

  test('separates canonical actor membership from live inbox delivery on replay', () => {
    const inbox = createAgentInbox(db);
    const automatic = createParley({ tuples, agentInbox: inbox, now: () => clock });
    const input = automaticInput({
      participants: [
        {
          actorId: 'actor-a', inboxTarget: 'spawned-agent-a',
          sessionId: 'session-a', lineageRootSessionId: 'root-a',
        },
        {
          actorId: 'actor-b', inboxTarget: 'spawned-agent-b',
          sessionId: 'session-b', lineageRootSessionId: 'root-b',
        },
      ],
    });

    const first = automatic.callAutomatic(input);
    const replay = automatic.callAutomatic(input);

    expect(first.parley.parties).toEqual(['actor-a', 'actor-b']);
    expect(first.parley.automatic.participants).toEqual(input.participants);
    expect(inbox.list('actor-a').messages).toHaveLength(0);
    expect(inbox.list('spawned-agent-a').messages).toHaveLength(1);
    expect(inbox.list('spawned-agent-b').messages).toHaveLength(1);
    expect(replay.replayed).toBe(true);
    expect(inbox.list('spawned-agent-a').messages).toHaveLength(1);
  });

  test('rejects duplicate automatic session or inbox identities', () => {
    const automatic = createParley({ tuples, agentInbox: createAgentInbox(db), now: () => clock });
    const base = automaticInput().participants;

    expect(() => automatic.callAutomatic(automaticInput({
      participants: [base[0], { ...base[1], sessionId: base[0].sessionId }],
    }))).toThrow(/sessionIds must be distinct/);
    expect(() => automatic.callAutomatic(automaticInput({
      participants: [base[0], { ...base[1], inboxTarget: base[0].inboxTarget }],
    }))).toThrow(/inboxTargets must be distinct/);
  });

  test('aligns automatic key and longest-participant bounds with tuple and inbox delivery keys', () => {
    const automatic = createParley({ tuples, agentInbox: createAgentInbox(db), now: () => clock });
    const longestKey = 'k'.repeat(MAX_AUTOMATIC_PARLEY_IDEMPOTENCY_KEY_CHARS);
    const longestParty = 'p'.repeat(128);
    const accepted = automatic.callAutomatic(automaticInput({
      participants: [
        {
          actorId: longestParty, inboxTarget: longestParty,
          sessionId: 'session-a', lineageRootSessionId: 'session-a',
        },
        {
          actorId: 'agent-b', inboxTarget: 'agent-b',
          sessionId: 'session-b', lineageRootSessionId: 'session-b',
        },
      ],
      automatic: {
        ...automaticInput().automatic,
        idempotencyKey: longestKey,
        signalId: longestKey,
      },
    }));

    expect(accepted.notificationFailures).toEqual([]);
    expect(() => automatic.callAutomatic(automaticInput({
      automatic: {
        ...automaticInput().automatic,
        idempotencyKey: `${longestKey}x`,
        signalId: `${longestKey}x`,
      },
    }))).toThrow(/idempotencyKey exceeds/);
    expect(() => automatic.callAutomatic(automaticInput({
      participants: [
        {
          actorId: `${longestParty}x`, inboxTarget: 'target-a',
          sessionId: 'session-a', lineageRootSessionId: 'session-a',
        },
        {
          actorId: 'agent-b', inboxTarget: 'agent-b',
          sessionId: 'session-b', lineageRootSessionId: 'session-b',
        },
      ],
    }))).toThrow(/participant identity exceeds/);
  });
});

describe('respond and status', () => {
  test('convenes after every party responds', () => {
    const p = openParley();
    parley.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'ship A',
      proposalId: 'a',
    });

    let summary = parley.get(p.parleyId);
    expect(summary.status).toBe('SUMMONED');
    expect(summary.missingParties).toEqual(['agent-b']);

    parley.respond({
      parleyId: p.parleyId,
      party: 'agent-b',
      performative: 'propose',
      content: 'ship B',
      proposalId: 'b',
    });

    summary = parley.get(p.parleyId);
    expect(summary.status).toBe('CONVENED');
    expect(summary.respondedParties).toEqual(['agent-a', 'agent-b']);
  });

  test('refuse escalates without requiring manual state mutation', () => {
    const p = openParley();
    parley.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'refuse',
      content: 'cannot accept this scope',
    });

    const summary = parley.get(p.parleyId);
    expect(summary.status).toBe('ESCALATED');
    expect(summary.risks).toContain('party refused; operator escalation required');
  });

  test('expired response TTL is visible as escalation risk', () => {
    const p = parley.call({
      surface: 'x',
      reason: 'y',
      parties: ['a', 'b'],
      calledBy: 'operator',
      ttlMs: 1000,
    });
    advance(2000);

    const summary = parley.get(p.parleyId);
    expect(summary.status).toBe('ESCALATED');
    expect(summary.expired).toBe(true);
  });

  test('rejects unsummoned parties', () => {
    const p = openParley();
    expect(() => parley.respond({
      parleyId: p.parleyId,
      party: 'agent-c',
      performative: 'inform',
      content: 'hi',
    })).toThrow(/not summoned/);
  });

  test('roundLimit caps non-terminal turns and escalates when exhausted', () => {
    const p = parley.call({
      surface: 'x',
      reason: 'y',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      roundLimit: 1,
    });
    parley.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'first proposal',
    });

    expect(() => parley.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'critique',
      content: 'extra critique',
    })).toThrow(/round limit exhausted/);

    const summary = parley.get(p.parleyId);
    expect(summary.status).toBe('ESCALATED');
    expect(summary.outcome.status).toBe('ESCALATED');
    expect(summary.outcome.reason).toBe('round limit exhausted for agent-a');
  });

  test('roundLimit still allows terminal agreement after a proposal', () => {
    const p = parley.call({
      surface: 'x',
      reason: 'y',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      roundLimit: 1,
    });
    parley.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'first proposal',
    });

    expect(() => parley.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'agree',
      content: 'I can live with this',
    })).not.toThrow();
  });
});

describe('resolve', () => {
  test('collapses with a decision and blocks later turns', () => {
    const p = openParley();
    const outcome = parley.resolve({
      parleyId: p.parleyId,
      status: 'COLLAPSED',
      decision: 'agent-a owns dispatch; agent-b rebases docs only',
      resolvedBy: 'operator',
      dissenters: [],
    });

    expect(outcome.status).toBe('COLLAPSED');
    const summary = parley.get(p.parleyId);
    expect(summary.status).toBe('COLLAPSED');
    expect(summary.outcome.decision).toMatch(/agent-a owns/);
    expect(() => parley.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'inform',
      content: 'too late',
    })).toThrow(/already COLLAPSED/);
  });

  test('requires decision for collapsed outcome', () => {
    const p = openParley();
    expect(() => parley.resolve({
      parleyId: p.parleyId,
      status: 'COLLAPSED',
      resolvedBy: 'operator',
    })).toThrow(/decision/);
  });
});

describe('turn fan-out', () => {
  function inboxParley(sendImpl) {
    const sent = [];
    const instance = createParley({
      tuples,
      now: () => clock,
      agentInbox: {
        send(agentId, content, options) {
          sent.push({ agentId, content, options });
          return sendImpl ? sendImpl(agentId, content, options) : { success: true };
        },
      },
    });
    return { instance, sent };
  }

  test('respond delivers a parley_turn to every other participant, including the caller', () => {
    const { instance, sent } = inboxParley();
    const p = instance.call({
      surface: 'lib/dispatch.ts',
      reason: 'two agents are changing dispatch semantics',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      harbor: 'port-daddy',
    });
    sent.length = 0;

    const result = instance.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'ship A',
      evidenceRefs: ['docs/adr/0084.md'],
    });

    expect(result.turn.performative).toBe('propose');
    expect(result.notified).toEqual(['agent-b', 'operator']);
    expect(result.notifyFailures).toEqual([]);
    expect(sent.map((m) => m.agentId)).toEqual(['agent-b', 'operator']);
    expect(sent[0].options).toMatchObject({ from: 'agent-a', type: 'parley_turn', contentType: 'json' });
    expect(sent[0].content).toMatchObject({
      kind: 'parley_turn',
      parleyId: p.parleyId,
      surface: 'lib/dispatch.ts',
      channel: `parley:${p.parleyId}`,
      party: 'agent-a',
      performative: 'propose',
      content: 'ship A',
      evidenceRefs: ['docs/adr/0084.md'],
    });
  });

  test('turn delivery failure is non-fatal: the turn persists and the failure is reported', () => {
    const { instance } = inboxParley((agentId, _content, options) => (
      options?.type === 'parley_turn' && agentId === 'agent-b'
        ? { success: false, error: 'inbox full' }
        : { success: true }
    ));
    const p = instance.call({
      surface: 'lib/dispatch.ts',
      reason: 'overlap',
      parties: ['agent-a', 'agent-b'],
      calledBy: 'operator',
      harbor: 'port-daddy',
    });

    const result = instance.respond({
      parleyId: p.parleyId,
      party: 'agent-a',
      performative: 'propose',
      content: 'ship A',
    });

    expect(result.notified).toEqual(['operator']);
    expect(result.notifyFailures).toEqual(['agent-b: inbox full']);
    expect(instance.get(p.parleyId).turns).toHaveLength(1);
  });
});

describe('seen receipts', () => {
  test('markSeen records a receipt and the summary reports unseen turns per participant', () => {
    const p = openParley();
    parley.respond({ parleyId: p.parleyId, party: 'agent-a', performative: 'propose', content: 'ship A' });
    advance(1000);
    parley.respond({ parleyId: p.parleyId, party: 'agent-b', performative: 'critique', content: 'A breaks dispatch' });

    let summary = parley.get(p.parleyId);
    expect(summary.receipts).toEqual([
      { party: 'agent-a', lastSeenAt: null, unseenTurns: 1 },
      { party: 'agent-b', lastSeenAt: null, unseenTurns: 1 },
      { party: 'operator', lastSeenAt: null, unseenTurns: 2 },
    ]);

    const receipt = parley.markSeen({ parleyId: p.parleyId, party: 'agent-a' });
    expect(receipt.lastSeenAt).toBe(clock);

    summary = parley.get(p.parleyId);
    expect(summary.receipts.find((r) => r.party === 'agent-a')).toEqual({
      party: 'agent-a',
      lastSeenAt: clock,
      unseenTurns: 0,
    });
    expect(summary.receipts.find((r) => r.party === 'operator').unseenTurns).toBe(2);
  });

  test('later turns show as unseen until the receipt watermark advances', () => {
    const p = openParley();
    parley.respond({ parleyId: p.parleyId, party: 'agent-a', performative: 'propose', content: 'ship A' });
    parley.markSeen({ parleyId: p.parleyId, party: 'agent-b' });
    advance(1000);
    parley.respond({ parleyId: p.parleyId, party: 'agent-a', performative: 'revise', content: 'ship A2' });

    let receipt = parley.get(p.parleyId).receipts.find((r) => r.party === 'agent-b');
    expect(receipt.unseenTurns).toBe(1);

    parley.markSeen({ parleyId: p.parleyId, party: 'agent-b' });
    receipt = parley.get(p.parleyId).receipts.find((r) => r.party === 'agent-b');
    expect(receipt.unseenTurns).toBe(0);
  });

  test('repeated markSeen without new turns does not grow the tuple space', () => {
    const p = openParley();
    parley.markSeen({ parleyId: p.parleyId, party: 'agent-a' });
    advance(1000);
    parley.markSeen({ parleyId: p.parleyId, party: 'agent-a' });
    advance(1000);
    const receipt = parley.markSeen({ parleyId: p.parleyId, party: 'agent-a', throughAt: clock - 5000 });

    // Stale watermark never regresses the receipt.
    expect(receipt.lastSeenAt).toBe(clock - 1000);
    const rows = tuples.rd(['parley:seen', p.parleyId, 'agent-a', '*'], { harbor: 'port-daddy' });
    expect(rows.length).toBe(2);
  });

  test('markSeen rejects participants that were not summoned', () => {
    const p = openParley();
    expect(() => parley.markSeen({ parleyId: p.parleyId, party: 'stranger' })).toThrow(/not part of/);
  });
});
