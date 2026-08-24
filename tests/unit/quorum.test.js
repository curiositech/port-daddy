import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createQuorum } from '../../lib/quorum.js';

let db;
let tuples;
let quorum;
let clock;

beforeEach(() => {
  db = createTestDb();
  tuples = createTupleSpace(db);
  clock = 1_700_000_000_000;
  quorum = createQuorum({ tuples, now: () => clock });
});

afterEach(() => {
  db.close();
});

function advance(ms) {
  clock += ms;
}

describe('propose', () => {
  test('writes a proposal tuple and returns its shape', () => {
    const proposal = quorum.propose({
      role: 'promotion-coordinator',
      reason: 'Two cuts pending, no one to merge them',
      threshold: 2,
      proposedBy: 'spark',
      harbor: 'port-daddy:fleet',
    });

    expect(proposal.proposalId).toEqual(expect.any(String));
    expect(proposal.role).toBe('promotion-coordinator');
    expect(proposal.threshold).toBe(2);
    expect(proposal.authorityVersion).toBe(1);
    expect(proposal.authorityHarbor).toBe('port-daddy:fleet');
    expect(proposal.harbor).toBe('port-daddy:fleet');
    expect(proposal.autoSpawn).toBe(false);
    expect(proposal.tupleId).toEqual(expect.any(Number));

    const tuplesWritten = tuples.rd(['quorum:proposal', '*', '*'], { harbor: 'port-daddy:fleet' });
    expect(tuplesWritten).toHaveLength(1);
    expect(proposal.tupleId).toBe(tuplesWritten[0].id);
    expect(quorum.listProposals({ harbor: 'port-daddy:fleet' })[0].tupleId).toBe(tuplesWritten[0].id);
  });

  test('rejects invalid threshold', () => {
    expect(() =>
      quorum.propose({ role: 'r', reason: 'x', threshold: 0, proposedBy: 'spark' }),
    ).toThrow(/threshold/);
  });

  test('rejects missing required fields', () => {
    expect(() =>
      quorum.propose({ role: '', reason: 'x', threshold: 1, proposedBy: 'spark' }),
    ).toThrow(/role/);
  });
});

describe('vote', () => {
  test('records a vote and tallies yesWeight', () => {
    const p = quorum.propose({
      role: 'promotion-coordinator',
      reason: 'merge backlog',
      threshold: 2,
      proposedBy: 'spark',
    });

    const vote = quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'yes' });
    const status = quorum.getStatusById(p.proposalId);
    expect(status.yesWeight).toBe(1);
    expect(status.passed).toBe(false);
    expect(status.remainingNeeded).toBe(1);
    expect(vote.tupleId).toEqual(expect.any(Number));
    expect(status.votes[0].tupleId).toBe(vote.tupleId);
  });

  test('passes when yes-weight crosses threshold and emits passed tuple', () => {
    const p = quorum.propose({
      role: 'promotion-coordinator',
      reason: 'merge backlog',
      threshold: 2,
      proposedBy: 'spark',
    });

    quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'yes' });
    quorum.vote({ proposalId: p.proposalId, voterId: 'cartographer', stance: 'yes' });

    const status = quorum.getStatusById(p.proposalId);
    expect(status.passed).toBe(true);
    expect(status.remainingNeeded).toBe(0);

    const passed = tuples.rd(['quorum:passed', p.proposalId, '*']);
    expect(passed).toHaveLength(1);
  });

  test('latest vote per voter wins (stance change)', () => {
    const p = quorum.propose({
      role: 'r',
      reason: 'x',
      threshold: 2,
      proposedBy: 'spark',
    });

    quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'yes' });
    advance(1000);
    quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'no' });

    const status = quorum.getStatusById(p.proposalId);
    expect(status.yesWeight).toBe(0);
    expect(status.noWeight).toBe(1);
  });

  test('durable tuple order breaks same-timestamp vote ties', () => {
    const p = quorum.propose({
      role: 'r',
      reason: 'x',
      threshold: 2,
      proposedBy: 'spark',
    });

    const first = quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'yes' });
    const second = quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'no' });

    expect(first.at).toBe(second.at);
    expect(second.tupleId).toBeGreaterThan(first.tupleId);
    const status = quorum.getStatusById(p.proposalId);
    expect(status.votes).toHaveLength(1);
    expect(status.votes[0]).toEqual(expect.objectContaining({
      tupleId: second.tupleId,
      voterId: 'qa',
      stance: 'no',
    }));
  });

  test('a later malformed authority row cannot replace a valid canonical ballot', () => {
    const p = quorum.propose({
      role: 'r',
      reason: 'malformed durable rows must fail closed',
      threshold: 2,
      proposedBy: 'spark',
    });
    const valid = quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'no' });
    const malformed = tuples.out(['quorum:vote', p.proposalId, 'qa', {
      authorityVersion: 1,
      proposalId: 'laundered-proposal-id',
      voterId: 'qa',
      stance: 'yes',
      weight: 999,
      at: clock + 1,
    }], { harbor: p.harbor, writtenBy: 'qa' });
    expect(malformed.id).toBeGreaterThan(valid.tupleId);

    const status = quorum.getStatusById(p.proposalId);
    expect(status.votes).toHaveLength(1);
    expect(status.votes[0]).toEqual(expect.objectContaining({
      tupleId: valid.tupleId,
      voterId: 'qa',
      stance: 'no',
      weight: 1,
    }));
    expect(status.yesWeight).toBe(0);
    expect(status.noWeight).toBe(1);
  });

  test('one actor cannot evict another actor ballot by appending over 1000 replacements', () => {
    const p = quorum.propose({
      role: 'r',
      reason: 'ballot stream must not have a fixed event window',
      threshold: 3,
      proposedBy: 'spark',
    });
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      tuples.out(['quorum:vote', p.proposalId, 'quiet-voter', {
        authorityVersion: 1,
        proposalId: p.proposalId,
        voterId: 'quiet-voter',
        stance: 'yes',
        weight: 1,
        at: clock,
      }], { harbor: p.harbor, writtenBy: 'quiet-voter' });

      for (let i = 0; i < 1_001; i++) {
        dateNow.mockReturnValue(1_700_000_000_001 + i);
        tuples.out(['quorum:vote', p.proposalId, 'flooding-voter', {
          authorityVersion: 1,
          proposalId: p.proposalId,
          voterId: 'flooding-voter',
          stance: i === 1_000 ? 'no' : 'yes',
          weight: 1,
          at: clock + i + 1,
        }], { harbor: p.harbor, writtenBy: 'flooding-voter' });
      }

      const status = quorum.getStatusById(p.proposalId);
      expect(status.votes).toHaveLength(2);
      expect(status.votes).toEqual(expect.arrayContaining([
        expect.objectContaining({ voterId: 'quiet-voter', stance: 'yes' }),
        expect.objectContaining({ voterId: 'flooding-voter', stance: 'no' }),
      ]));
      expect(status.yesWeight).toBe(1);
      expect(status.noWeight).toBe(1);
    } finally {
      dateNow.mockRestore();
    }
  });

  test('abstain counts toward participation, not yes-weight', () => {
    const p = quorum.propose({
      role: 'r',
      reason: 'x',
      threshold: 1,
      proposedBy: 'spark',
    });

    quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'abstain' });
    const status = quorum.getStatusById(p.proposalId);
    expect(status.passed).toBe(false);
    expect(status.abstainWeight).toBe(1);
    expect(status.yesWeight).toBe(0);
  });

  test('trusted direct-module callers retain explicit weighted votes', () => {
    const p = quorum.propose({
      role: 'r',
      reason: 'trusted internal weighting',
      threshold: 3,
      proposedBy: 'spark',
    });

    const vote = quorum.vote({
      proposalId: p.proposalId,
      voterId: 'trusted-policy-engine',
      stance: 'yes',
      weight: 2.5,
    });
    expect(vote.weight).toBe(2.5);
    expect(quorum.getStatusById(p.proposalId).yesWeight).toBe(2.5);
  });

  test('rejects vote on expired proposal', () => {
    const p = quorum.propose({
      role: 'r',
      reason: 'x',
      threshold: 1,
      proposedBy: 'spark',
      ttlMs: 1000,
    });
    advance(2000);
    expect(() =>
      quorum.vote({ proposalId: p.proposalId, voterId: 'qa', stance: 'yes' }),
    ).toThrow(/expired/);
  });

  test('rejects vote on unknown proposal', () => {
    expect(() =>
      quorum.vote({ proposalId: 'nope', voterId: 'qa', stance: 'yes' }),
    ).toThrow(/no proposal/);
  });
});

describe('listProposals', () => {
  test('scopes by harbor', () => {
    quorum.propose({ role: 'a', reason: 'x', threshold: 1, proposedBy: 'spark', harbor: 'h1' });
    quorum.propose({ role: 'b', reason: 'x', threshold: 1, proposedBy: 'spark', harbor: 'h2' });

    const h1 = quorum.listProposals({ harbor: 'h1' });
    expect(h1).toHaveLength(1);
    expect(h1[0].role).toBe('a');
  });
});

describe('getStatusById', () => {
  test('returns null for unknown proposal', () => {
    expect(quorum.getStatusById('nope')).toBeNull();
  });

  test('marks expired status correctly', () => {
    const p = quorum.propose({
      role: 'r',
      reason: 'x',
      threshold: 1,
      proposedBy: 'spark',
      ttlMs: 1000,
    });
    advance(2000);
    const status = quorum.getStatusById(p.proposalId);
    expect(status.expired).toBe(true);
  });
});
