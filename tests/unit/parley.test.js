import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createParley } from '../../lib/parley.js';

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
