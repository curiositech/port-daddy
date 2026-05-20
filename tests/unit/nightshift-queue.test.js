import { createTestDb } from '../setup-unit.js';
import {
  createNightshiftQueue,
  NIGHTSHIFT_TERMINAL_STATUSES,
  deriveSlug,
  deriveBranchName,
} from '../../lib/nightshift/queue.js';

let db;
let queue;
let clock;

beforeEach(() => {
  db = createTestDb();
  clock = 1_700_000_000_000;
  queue = createNightshiftQueue({ db, now: () => clock });
});

afterEach(() => {
  db.close();
});

function advance(ms) {
  clock += ms;
}

describe('propose', () => {
  test('stores an intent with a derived slug and tags', () => {
    const intent = queue.propose({
      intent: 'Normalize the design tokens across the marketing site',
      tags: ['design', 'marketing'],
      budgetUsd: 4,
      timeoutMs: 60 * 60 * 1000,
    });
    expect(intent.id).toEqual(expect.any(String));
    expect(intent.slug).toBe('normalize-the-design-tokens-across-the-marketing-site');
    expect(intent.status).toBe('proposed');
    expect(intent.tags).toEqual(['design', 'marketing']);
    expect(intent.budgetUsd).toBe(4);
    expect(intent.timeoutMs).toBe(60 * 60 * 1000);
    expect(intent.createdAt).toBe(clock);
    expect(intent.queuedAt).toBeNull();
  });

  test('autoQueue lands intent directly in queued status with queuedAt set', () => {
    const intent = queue.propose({
      intent: 'Prototype landing-page Bostock visualization',
      autoQueue: true,
    });
    expect(intent.status).toBe('queued');
    expect(intent.queuedAt).toBe(clock);
  });

  test('rejects empty intent', () => {
    expect(() => queue.propose({ intent: '' })).toThrow(/intent text/);
    expect(() => queue.propose({ intent: '   ' })).toThrow(/intent text/);
  });

  test('rejects intent over 4000 chars', () => {
    const huge = 'x'.repeat(4001);
    expect(() => queue.propose({ intent: huge })).toThrow(/4000/);
  });

  test('rejects non-positive budget', () => {
    expect(() => queue.propose({ intent: 'foo', budgetUsd: 0 })).toThrow(/budget/);
    expect(() => queue.propose({ intent: 'foo', budgetUsd: -5 })).toThrow(/budget/);
  });

  test('rejects non-positive timeout', () => {
    expect(() => queue.propose({ intent: 'foo', timeoutMs: 0 })).toThrow(/timeout/);
  });

  test('limits tags to 16 entries and filters non-strings', () => {
    const tags = [];
    for (let i = 0; i < 20; i += 1) tags.push(`tag${i}`);
    tags.push(123, null, undefined);
    const intent = queue.propose({ intent: 'foo', tags });
    expect(intent.tags).toHaveLength(16);
    expect(intent.tags.every((t) => typeof t === 'string')).toBe(true);
  });
});

describe('queue (promote proposed -> queued)', () => {
  test('promotes a proposed intent', () => {
    const proposed = queue.propose({ intent: 'foo' });
    advance(1000);
    const queued = queue.queue(proposed.id);
    expect(queued.status).toBe('queued');
    expect(queued.queuedAt).toBe(clock);
  });

  test('is idempotent on already-queued intents', () => {
    const proposed = queue.propose({ intent: 'foo', autoQueue: true });
    const requeued = queue.queue(proposed.id);
    expect(requeued.status).toBe('queued');
    expect(requeued.queuedAt).toBe(proposed.queuedAt);
  });

  test('refuses to queue a terminal intent', () => {
    const proposed = queue.propose({ intent: 'foo', autoQueue: true });
    queue.markRunning({
      id: proposed.id,
      worktreePath: '/tmp/x',
      branchName: 'night-shift/foo-1',
      sessionId: 'sess-1',
    });
    queue.markComplete({ id: proposed.id, status: 'succeeded' });
    expect(() => queue.queue(proposed.id)).toThrow(/succeeded/);
  });

  test('throws when intent does not exist', () => {
    expect(() => queue.queue('no-such-id')).toThrow(/not found/);
  });
});

describe('list', () => {
  test('returns all intents newest-first by default', () => {
    queue.propose({ intent: 'first' });
    advance(1000);
    queue.propose({ intent: 'second' });
    advance(1000);
    queue.propose({ intent: 'third' });
    const all = queue.list();
    expect(all.map((i) => i.intent)).toEqual(['third', 'second', 'first']);
  });

  test('filters by status', () => {
    queue.propose({ intent: 'a' });
    queue.propose({ intent: 'b', autoQueue: true });
    queue.propose({ intent: 'c', autoQueue: true });
    expect(queue.list({ status: 'queued' })).toHaveLength(2);
    expect(queue.list({ status: 'proposed' })).toHaveLength(1);
  });

  test('open filter includes proposed, queued, running but not terminal', () => {
    const a = queue.propose({ intent: 'a', autoQueue: true });
    queue.propose({ intent: 'b' });
    queue.markRunning({
      id: a.id,
      worktreePath: '/tmp/x',
      branchName: 'night-shift/a-1',
      sessionId: 's',
    });
    queue.markComplete({ id: a.id, status: 'succeeded' });
    expect(queue.list({ status: 'open' })).toHaveLength(1);
    expect(queue.list({ status: 'terminal' })).toHaveLength(1);
  });

  test('since filter returns only items completed-or-created after timestamp', () => {
    const a = queue.propose({ intent: 'a' });
    advance(60_000);
    const cutoff = clock;
    advance(60_000);
    const b = queue.propose({ intent: 'b' });
    const recent = queue.list({ since: cutoff });
    const ids = recent.map((i) => i.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(a.id);
  });
});

describe('next (atomic pop)', () => {
  test('picks the oldest queued intent and marks it running', () => {
    const first = queue.propose({ intent: 'first', autoQueue: true });
    advance(1000);
    queue.propose({ intent: 'second', autoQueue: true });
    advance(1000);
    queue.propose({ intent: 'third', autoQueue: true });

    const picked = queue.next({
      worktreePath: '/scratch/first',
      branchName: 'night-shift/first-1',
      sessionId: 'sess-first',
    });
    expect(picked).not.toBeNull();
    expect(picked.id).toBe(first.id);
    expect(picked.status).toBe('running');
    expect(picked.worktreePath).toBe('/scratch/first');
    expect(picked.branchName).toBe('night-shift/first-1');
    expect(picked.sessionId).toBe('sess-first');
    expect(picked.startedAt).toBe(clock);
  });

  test('returns null when no queued intents exist', () => {
    queue.propose({ intent: 'proposed-not-queued' });
    const picked = queue.next({
      worktreePath: '/x',
      branchName: 'b',
      sessionId: 's',
    });
    expect(picked).toBeNull();
  });

  test('skips already-running and terminal intents', () => {
    const a = queue.propose({ intent: 'a', autoQueue: true });
    queue.next({
      worktreePath: '/x',
      branchName: 'night-shift/a-1',
      sessionId: 's',
    });
    queue.markComplete({ id: a.id, status: 'succeeded' });
    const second = queue.next({
      worktreePath: '/x',
      branchName: 'b',
      sessionId: 's',
    });
    expect(second).toBeNull();
  });

  test('two concurrent calls only consume one intent', () => {
    queue.propose({ intent: 'only-one', autoQueue: true });
    const first = queue.next({
      worktreePath: '/x',
      branchName: 'b1',
      sessionId: 's1',
    });
    const second = queue.next({
      worktreePath: '/x',
      branchName: 'b2',
      sessionId: 's2',
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});

describe('markComplete', () => {
  test('records terminal status, PR url, cost, and duration', () => {
    const proposed = queue.propose({ intent: 'do-thing', autoQueue: true });
    queue.markRunning({
      id: proposed.id,
      worktreePath: '/w',
      branchName: 'b',
      sessionId: 's',
    });
    advance(60_000);
    const completed = queue.markComplete({
      id: proposed.id,
      status: 'succeeded',
      prUrl: 'https://github.com/curiositech/port-daddy/pull/9999',
      costUsd: 1.23,
    });
    expect(completed.status).toBe('succeeded');
    expect(completed.prUrl).toContain('/pull/9999');
    expect(completed.costUsd).toBeCloseTo(1.23);
    expect(completed.durationMs).toBe(60_000);
    expect(completed.completedAt).toBe(clock);
  });

  test('refuses to complete a non-running intent', () => {
    const proposed = queue.propose({ intent: 'a' });
    expect(() => queue.markComplete({ id: proposed.id, status: 'succeeded' })).toThrow(/running/);
  });

  test.each(['succeeded', 'failed', 'aborted', 'timeout'])(
    'accepts %s as terminal status',
    (status) => {
      const proposed = queue.propose({ intent: 'a', autoQueue: true });
      queue.markRunning({
        id: proposed.id,
        worktreePath: '/w',
        branchName: 'b',
        sessionId: 's',
      });
      const result = queue.markComplete({ id: proposed.id, status });
      expect(result.status).toBe(status);
    },
  );
});

describe('cancel', () => {
  test('cancels a queued intent with operator reason', () => {
    const proposed = queue.propose({ intent: 'foo', autoQueue: true });
    const cancelled = queue.cancel(proposed.id, 'operator changed mind');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.errorMessage).toBe('operator changed mind');
    expect(cancelled.completedAt).toBe(clock);
  });

  test('cancels a running intent', () => {
    const proposed = queue.propose({ intent: 'foo', autoQueue: true });
    queue.markRunning({
      id: proposed.id,
      worktreePath: '/w',
      branchName: 'b',
      sessionId: 's',
    });
    const cancelled = queue.cancel(proposed.id);
    expect(cancelled.status).toBe('cancelled');
  });

  test('is a no-op on already-terminal intents', () => {
    const proposed = queue.propose({ intent: 'foo', autoQueue: true });
    queue.markRunning({
      id: proposed.id,
      worktreePath: '/w',
      branchName: 'b',
      sessionId: 's',
    });
    queue.markComplete({ id: proposed.id, status: 'succeeded' });
    const cancelled = queue.cancel(proposed.id);
    expect(cancelled.status).toBe('succeeded');
  });
});

describe('markReviewed', () => {
  test('stamps the reviewedAt timestamp', () => {
    const proposed = queue.propose({ intent: 'foo' });
    advance(1000);
    const reviewed = queue.markReviewed(proposed.id);
    expect(reviewed.reviewedAt).toBe(clock);
  });
});

describe('terminal status constant', () => {
  test('covers every status that prevents requeueing', () => {
    expect(NIGHTSHIFT_TERMINAL_STATUSES).toEqual(
      expect.arrayContaining(['succeeded', 'failed', 'aborted', 'timeout', 'cancelled']),
    );
  });
});

describe('deriveSlug + deriveBranchName re-exported', () => {
  test('deriveSlug from a real-world intent', () => {
    expect(deriveSlug('Polish the FleetBar onboarding flow!')).toBe('polish-the-fleetbar-onboarding-flow');
  });

  test('deriveBranchName composes slug + id suffix', () => {
    const branch = deriveBranchName('polish-fleetbar', 'abcd1234-ef56-7890');
    expect(branch).toBe('night-shift/polish-fleetbar-abcd1234');
  });
});
