import { createTestDb } from '../setup-unit.js';
import { createCommitments } from '../../lib/commitments.js';

let db;
let clock;
let commitments;

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  db = createTestDb();
  clock = 1_700_000_000_000;
  commitments = createCommitments(db, { now: () => clock });
});

afterEach(() => {
  db.close();
});

describe('create', () => {
  test('creates an open commitment with daemon-derived due_at (Law 1)', () => {
    const c = commitments.create({
      ownerActorId: 'agent-7',
      objectText: 'keep tests green',
      scope: 'claim',
      successCheck: 'npm test',
    });
    expect(c.id).toEqual(expect.any(String));
    expect(c.state).toBe('open');
    expect(c.ownerActorId).toBe('agent-7');
    expect(c.closedByOracleRef).toBeNull();
    // due_at is created_at + the scope's policy duration, NOT anything the agent passed.
    expect(c.dueAt).toBe(clock + commitments.deadlinePolicy.claim);
  });

  test('due_at is module-derived, not agent-trusted: an agent-passed dueAt is ignored (Law 1)', () => {
    // The agent tries to smuggle in an absolute deadline far in the future.
    const farFuture = clock + 9999 * HOUR;
    const c = commitments.create({
      ownerActorId: 'agent-7',
      objectText: 'sneaky deadline',
      scope: 'default',
      // @ts-expect-error — dueAt is intentionally NOT part of the input contract.
      dueAt: farFuture,
      due_at: farFuture,
    });
    // The derived deadline wins; the smuggled value has no effect.
    expect(c.dueAt).toBe(clock + commitments.deadlinePolicy.default);
    expect(c.dueAt).not.toBe(farFuture);
  });

  test('different scopes derive different deadlines from policy', () => {
    const a = commitments.create({ ownerActorId: 'x', objectText: 'a', scope: 'claim' });
    const b = commitments.create({ ownerActorId: 'x', objectText: 'b', scope: 'standing' });
    expect(b.dueAt - a.dueAt).toBe(
      commitments.deadlinePolicy.standing - commitments.deadlinePolicy.claim,
    );
  });

  test('rejects missing owner or object text', () => {
    expect(() => commitments.create({ ownerActorId: '', objectText: 'x' })).toThrow(/ownerActorId/);
    expect(() => commitments.create({ ownerActorId: 'a', objectText: '   ' })).toThrow(/objectText/);
  });
});

describe('close (Law 2 — closure binds to an oracle)', () => {
  test('refuses to mark done without a non-empty oracle ref', () => {
    const c = commitments.create({ ownerActorId: 'a', objectText: 'do the thing' });
    const empty = commitments.close(c.id, '');
    expect(empty.success).toBe(false);
    expect(empty.error).toMatch(/oracle/i);
    const whitespace = commitments.close(c.id, '   ');
    expect(whitespace.success).toBe(false);
    // The row is still open — no free-text close happened.
    expect(commitments.get(c.id).state).toBe('open');
  });

  test('closes with a real oracle ref and records it', () => {
    const c = commitments.create({ ownerActorId: 'a', objectText: 'merge the fix' });
    const result = commitments.close(c.id, 'sha:deadbeef');
    expect(result.success).toBe(true);
    expect(result.commitment.state).toBe('done');
    expect(result.commitment.closedByOracleRef).toBe('sha:deadbeef');
    expect(commitments.get(c.id).state).toBe('done');
  });

  test('cannot close a missing commitment, or close an already-closed one', () => {
    const missing = commitments.close('nope', 'sha:abc');
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/no commitment/);

    const c = commitments.create({ ownerActorId: 'a', objectText: 'x' });
    expect(commitments.close(c.id, 'sha:1').success).toBe(true);
    const again = commitments.close(c.id, 'sha:2');
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/not 'open'/);
  });
});

describe('list', () => {
  test('filters by owner and state', () => {
    commitments.create({ ownerActorId: 'a', objectText: '1' });
    const c2 = commitments.create({ ownerActorId: 'a', objectText: '2' });
    commitments.create({ ownerActorId: 'b', objectText: '3' });
    commitments.close(c2.id, 'sha:x');

    expect(commitments.list({ ownerActorId: 'a' })).toHaveLength(2);
    expect(commitments.list({ ownerActorId: 'a', state: 'open' })).toHaveLength(1);
    expect(commitments.list({ ownerActorId: 'a', state: 'done' })).toHaveLength(1);
    expect(commitments.list({ state: 'open' })).toHaveLength(2);
  });
});
