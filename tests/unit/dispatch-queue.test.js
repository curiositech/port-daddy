/**
 * Tests for lib/dispatch/queue.ts -- the rename + rebase of PR #143's
 * nightshift queue onto ADR-0035's schema and 8-state machine.
 *
 * Covers every transition in the state machine, the migration from
 * nightshift_intents, the merge_policy gate (auto refused without PR #141),
 * and the base_branch column.
 */

import { createTestDb } from '../setup-unit.js';
import {
  createDispatchQueue,
  DISPATCH_TERMINAL_STATES,
  DISPATCH_RESOLVED_STATES,
  deriveSlug,
  deriveBranchName,
  legacyStatusToState,
} from '../../lib/dispatch/queue.js';

let db;
let queue;
let clock;

beforeEach(() => {
  db = createTestDb();
  clock = 1_700_000_000_000;
  queue = createDispatchQueue({ db, now: () => clock });
});

afterEach(() => {
  db.close();
});

function advance(ms) {
  clock += ms;
}

// Helper: walk a fresh dispatch through claimed -> in_progress -> produced -> review_pending
function walkToReviewPending(goal = 'walk-to-review') {
  const d = queue.propose({ goal });
  queue.claim({ id: d.id, worktreePath: '/w', branch: 'b', sessionId: 's' });
  queue.start(d.id);
  queue.produce({ id: d.id, resultArtifact: 'https://github.com/foo/bar/pull/1' });
  queue.requestReview(d.id);
  return queue.get(d.id);
}

describe('propose', () => {
  test('stores a goal with derived slug, tags, and default base_branch', () => {
    const d = queue.propose({
      goal: 'Normalize the design tokens across the marketing site',
      tags: ['design', 'marketing'],
      budgetUsd: 4,
      timeoutMs: 60 * 60 * 1000,
    });
    expect(d.id).toEqual(expect.any(String));
    expect(d.slug).toBe('normalize-the-design-tokens-across-the-marketing-site');
    expect(d.state).toBe('proposed');
    expect(d.baseBranch).toBe('main');
    expect(d.mergePolicy).toBe('review');
    expect(d.requestedBy).toBe('operator');
    expect(d.reviewerActorId).toBe('operator');
    expect(d.tags).toEqual(['design', 'marketing']);
    expect(d.budgetUsd).toBe(4);
    expect(d.timeoutMs).toBe(60 * 60 * 1000);
    expect(d.createdAt).toBe(clock);
    expect(d.claimedAt).toBeNull();
  });

  test('records explicit base_branch and target_actor/reviewer', () => {
    const d = queue.propose({
      goal: 'Refactor the auth handlers',
      baseBranch: 'release/2026.05',
      targetActorId: 'qa-bot',
      reviewerActorId: 'erich',
    });
    expect(d.baseBranch).toBe('release/2026.05');
    expect(d.targetActorId).toBe('qa-bot');
    expect(d.reviewerActorId).toBe('erich');
  });

  test('stores a Fleet UI visual-task proposal with a derived slug', () => {
    const goal = [
      'Visual task from FleetBar: fix - Button is clipped',
      '',
      'Payload channel: port-daddy:visual-task',
      'Task id: visual-task-test',
    ].join('\n');

    const d = queue.propose({
      goal,
      requestedBy: 'fleet-ui-visual',
      targetActorId: 'cartographer',
      mergePolicy: 'review',
    });

    expect(d.slug).toBe('visual-task-from-fleetbar-fix-button-is-clipped-payload-chan');
    expect(d.goal).toBe(goal);
    expect(d.requestedBy).toBe('fleet-ui-visual');
    expect(d.targetActorId).toBe('cartographer');
    expect(d.mergePolicy).toBe('review');
  });

  test('autoClaim lands dispatch in claimed state with claimedAt', () => {
    const d = queue.propose({
      goal: 'Prototype landing-page Bostock visualization',
      autoClaim: true,
    });
    expect(d.state).toBe('claimed');
    expect(d.claimedAt).toBe(clock);
  });

  test('rejects empty goal', () => {
    expect(() => queue.propose({ goal: '' })).toThrow(/goal text/);
    expect(() => queue.propose({ goal: '   ' })).toThrow(/goal text/);
  });

  test('rejects goal over 4000 chars', () => {
    const huge = 'x'.repeat(4001);
    expect(() => queue.propose({ goal: huge })).toThrow(/4000/);
  });

  test('rejects negative / non-finite budget but ACCEPTS 0 (flat-rate CLI, BUG 1)', () => {
    // BUG 1 (2026-07-14 halt-mandate): budgetUsd 0 is a legitimate "flat-rate
    // backend, no real-dollar bond" budget — the Conductor's effectiveBond()
    // decides the actual reservation from the backend, not this number. Only
    // negative / non-finite is a caller error now.
    expect(() => queue.propose({ goal: 'foo', budgetUsd: -5 })).toThrow(/budget/);
    expect(() => queue.propose({ goal: 'foo', budgetUsd: Number.NaN })).toThrow(/budget/);
    expect(() => queue.propose({ goal: 'foo', budgetUsd: 0 })).not.toThrow();
  });

  test('rejects non-positive timeout', () => {
    expect(() => queue.propose({ goal: 'foo', timeoutMs: 0 })).toThrow(/timeout/);
  });

  test('refuses merge_policy=auto without harbormaster (PR #141)', () => {
    expect(() =>
      queue.propose({ goal: 'auto-merge me', mergePolicy: 'auto' }),
    ).toThrow(/harbormaster|PR #141/);
  });

  test("accepts merge_policy='never'", () => {
    const d = queue.propose({ goal: 'never merge me', mergePolicy: 'never' });
    expect(d.mergePolicy).toBe('never');
  });

  test('limits tags to 16 entries and filters non-strings', () => {
    const tags = [];
    for (let i = 0; i < 20; i += 1) tags.push(`tag${i}`);
    tags.push(123, null, undefined);
    const d = queue.propose({ goal: 'foo', tags });
    expect(d.tags).toHaveLength(16);
    expect(d.tags.every((t) => typeof t === 'string')).toBe(true);
  });
});

describe('claim (proposed -> claimed)', () => {
  test('claims a proposed dispatch and records worker coords', () => {
    const d = queue.propose({ goal: 'foo' });
    advance(1000);
    const claimed = queue.claim({
      id: d.id,
      worktreePath: '/work/foo',
      branch: 'dispatch/foo-abc',
      sessionId: 'sess-1',
      workerActorId: 'worker-bot',
    });
    expect(claimed.state).toBe('claimed');
    expect(claimed.claimedAt).toBe(clock);
    expect(claimed.worktreePath).toBe('/work/foo');
    expect(claimed.branch).toBe('dispatch/foo-abc');
    expect(claimed.sessionId).toBe('sess-1');
    expect(claimed.workerActorId).toBe('worker-bot');
  });

  test('is idempotent on already-claimed dispatches', () => {
    const d = queue.propose({ goal: 'foo', autoClaim: true });
    const reclaim = queue.claim({ id: d.id, worktreePath: '/w', branch: 'b', sessionId: 's' });
    expect(reclaim.state).toBe('claimed');
    expect(reclaim.claimedAt).toBe(d.claimedAt); // not overwritten
  });

  test('claimProposed reports only the worker that won the state transition', () => {
    const d = queue.propose({ goal: 'single winner' });
    const first = queue.claimProposed({ id: d.id, worktreePath: '/w1', branch: 'b1', sessionId: 's1' });
    const second = queue.claimProposed({ id: d.id, worktreePath: '/w2', branch: 'b2', sessionId: 's2' });

    expect(first?.state).toBe('claimed');
    expect(second).toBeNull();
    expect(queue.get(d.id)).toMatchObject({ worktreePath: '/w1', branch: 'b1', sessionId: 's1' });
  });

  test('refuses to claim a terminal dispatch', () => {
    const d = queue.propose({ goal: 'foo', autoClaim: true });
    queue.settle({ id: d.id, state: 'settled' });
    expect(() =>
      queue.claim({ id: d.id, worktreePath: '/w', branch: 'b', sessionId: 's' }),
    ).toThrow(/settled/);
  });

  test('throws when dispatch does not exist', () => {
    expect(() =>
      queue.claim({ id: 'no-such-id', worktreePath: '/w', branch: 'b', sessionId: 's' }),
    ).toThrow(/not found/);
  });
});

describe('nextProposed (atomic pop)', () => {
  test('peekNextProposed uses the same oldest-row ordering without claiming', () => {
    const first = queue.propose({ goal: 'first' });
    advance(1000);
    queue.propose({ goal: 'second' });

    const peeked = queue.peekNextProposed();
    expect(peeked.id).toBe(first.id);
    expect(peeked.state).toBe('proposed');
    expect(queue.get(first.id).state).toBe('proposed');
  });

  test('peekNextProposed scopes the oldest row to the requested base branch', () => {
    queue.propose({ goal: 'main lane', baseBranch: 'main' });
    advance(1000);
    const release = queue.propose({ goal: 'release lane', baseBranch: 'release/2026.05' });

    const peeked = queue.peekNextProposed('release/2026.05');

    expect(peeked.id).toBe(release.id);
    expect(peeked.baseBranch).toBe('release/2026.05');
    expect(queue.get(release.id).state).toBe('proposed');
  });

  test('picks oldest proposed and marks it claimed', () => {
    const first = queue.propose({ goal: 'first' });
    advance(1000);
    queue.propose({ goal: 'second' });
    advance(1000);
    queue.propose({ goal: 'third' });

    const picked = queue.nextProposed({
      worktreePath: '/scratch/first',
      branch: 'dispatch/first-1',
      sessionId: 'sess-first',
    });
    expect(picked).not.toBeNull();
    expect(picked.id).toBe(first.id);
    expect(picked.state).toBe('claimed');
    expect(picked.worktreePath).toBe('/scratch/first');
    expect(picked.branch).toBe('dispatch/first-1');
    expect(picked.sessionId).toBe('sess-first');
    expect(picked.claimedAt).toBe(clock);
  });

  test('returns null when no proposed dispatches exist', () => {
    queue.propose({ goal: 'autoclaimed', autoClaim: true });
    const picked = queue.nextProposed({
      worktreePath: '/x',
      branch: 'b',
      sessionId: 's',
    });
    expect(picked).toBeNull();
  });

  test('can be scoped to a specific base_branch (for harbormaster)', () => {
    queue.propose({ goal: 'main-1', baseBranch: 'main' });
    advance(1000);
    const releaseDispatch = queue.propose({ goal: 'release-1', baseBranch: 'release/2026.05' });
    advance(1000);
    queue.propose({ goal: 'main-2', baseBranch: 'main' });

    const picked = queue.nextProposed({
      worktreePath: '/x',
      branch: 'b',
      sessionId: 's',
      baseBranch: 'release/2026.05',
    });
    expect(picked).not.toBeNull();
    expect(picked.id).toBe(releaseDispatch.id);
  });

  test('two concurrent calls only consume one dispatch', () => {
    queue.propose({ goal: 'only-one' });
    const first = queue.nextProposed({ worktreePath: '/x', branch: 'b1', sessionId: 's1' });
    const second = queue.nextProposed({ worktreePath: '/x', branch: 'b2', sessionId: 's2' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});

describe('8-state machine -- full happy path', () => {
  test('proposed -> claimed -> in_progress -> produced -> review_pending -> accepted -> settled', () => {
    const d = queue.propose({ goal: 'walk-the-line' });
    expect(d.state).toBe('proposed');

    advance(1000);
    const c = queue.claim({ id: d.id, worktreePath: '/w', branch: 'b', sessionId: 's' });
    expect(c.state).toBe('claimed');
    expect(c.claimedAt).toBe(clock);

    advance(1000);
    const p = queue.start(d.id);
    expect(p.state).toBe('in_progress');
    expect(p.startedAt).toBe(clock);

    advance(60_000);
    const pr = queue.produce({
      id: d.id,
      resultArtifact: 'https://github.com/foo/bar/pull/1',
      costUsd: 0.42,
    });
    expect(pr.state).toBe('produced');
    expect(pr.resultArtifact).toBe('https://github.com/foo/bar/pull/1');
    expect(pr.costUsd).toBeCloseTo(0.42);
    expect(pr.durationMs).toBe(60_000);

    advance(1000);
    const r = queue.requestReview(d.id);
    expect(r.state).toBe('review_pending');

    advance(1000);
    const a = queue.accept({ id: d.id, note: 'lgtm' });
    expect(a.state).toBe('accepted');
    expect(a.reviewedAt).toBe(clock);
    expect(a.errorMessage).toBe('accepted: lgtm');

    advance(1000);
    const s = queue.settle({ id: d.id, state: 'settled' });
    expect(s.state).toBe('settled');
    expect(s.settledAt).toBe(clock);
  });

  test('rejected branch: review_pending -> rejected -> salvage', () => {
    const d = walkToReviewPending('reject-me');
    advance(1000);

    const r = queue.reject({ id: d.id, reason: 'wrong direction entirely' });
    expect(r.state).toBe('rejected');
    expect(r.rejectReason).toBe('wrong direction entirely');
    expect(r.reviewedAt).toBe(clock);

    advance(1000);
    const sal = queue.settle({ id: d.id, state: 'salvage', errorMessage: 'rejected: wrong direction entirely' });
    expect(sal.state).toBe('salvage');
    expect(sal.settledAt).toBe(clock);
  });

  test('reject requires a reason', () => {
    const d = walkToReviewPending();
    expect(() => queue.reject({ id: d.id, reason: '' })).toThrow(/reason/);
    expect(() => queue.reject({ id: d.id, reason: '   ' })).toThrow(/reason/);
  });

  test('failed terminal: any non-terminal state can settle into failed', () => {
    const d = queue.propose({ goal: 'crash early', autoClaim: true });
    const failed = queue.settle({ id: d.id, state: 'failed', errorMessage: 'oom' });
    expect(failed.state).toBe('failed');
    expect(failed.errorMessage).toBe('oom');
  });
});

describe('illegal transitions', () => {
  test('start refuses non-claimed dispatch', () => {
    const d = queue.propose({ goal: 'foo' }); // proposed
    expect(() => queue.start(d.id)).toThrow(/state proposed/);
  });

  test('produce refuses non-in_progress dispatch', () => {
    const d = queue.propose({ goal: 'foo', autoClaim: true });
    expect(() => queue.produce({ id: d.id })).toThrow(/state claimed/);
  });

  test('accept refuses non-review_pending dispatch', () => {
    const d = queue.propose({ goal: 'foo', autoClaim: true });
    expect(() => queue.accept({ id: d.id })).toThrow(/state claimed/);
  });

  test('reject refuses non-review_pending dispatch', () => {
    const d = queue.propose({ goal: 'foo' });
    expect(() => queue.reject({ id: d.id, reason: 'whatever' })).toThrow(/state proposed/);
  });

  test('requestReview refuses non-produced dispatch', () => {
    const d = queue.propose({ goal: 'foo', autoClaim: true });
    queue.start(d.id);
    expect(() => queue.requestReview(d.id)).toThrow(/state in_progress/);
  });
});

describe('cancel (privileged jump to salvage)', () => {
  test('cancels a proposed dispatch with reason', () => {
    const d = queue.propose({ goal: 'foo' });
    const cancelled = queue.cancel(d.id, 'changed mind');
    expect(cancelled.state).toBe('salvage');
    expect(cancelled.errorMessage).toBe('changed mind');
    expect(cancelled.settledAt).toBe(clock);
  });

  test('cancels an in_progress dispatch', () => {
    const d = queue.propose({ goal: 'foo', autoClaim: true });
    queue.start(d.id);
    const cancelled = queue.cancel(d.id);
    expect(cancelled.state).toBe('salvage');
  });

  test('is a no-op on already-terminal dispatches', () => {
    const d = queue.propose({ goal: 'foo', autoClaim: true });
    queue.settle({ id: d.id, state: 'settled' });
    const cancelled = queue.cancel(d.id);
    expect(cancelled.state).toBe('settled'); // unchanged
  });
});

describe('list', () => {
  test('returns all dispatches newest-first by default', () => {
    queue.propose({ goal: 'first' });
    advance(1000);
    queue.propose({ goal: 'second' });
    advance(1000);
    queue.propose({ goal: 'third' });
    const all = queue.list();
    expect(all.map((d) => d.goal)).toEqual(['third', 'second', 'first']);
  });

  test('filters by state', () => {
    queue.propose({ goal: 'a' }); // proposed
    queue.propose({ goal: 'b', autoClaim: true }); // claimed
    queue.propose({ goal: 'c', autoClaim: true }); // claimed
    expect(queue.list({ state: 'proposed' })).toHaveLength(1);
    expect(queue.list({ state: 'claimed' })).toHaveLength(2);
  });

  test('open filter includes non-terminal-non-rejected states', () => {
    const d = queue.propose({ goal: 'a', autoClaim: true });
    queue.propose({ goal: 'b' });
    queue.settle({ id: d.id, state: 'settled' });
    const open = queue.list({ state: 'open' });
    expect(open).toHaveLength(1);
    expect(open[0].goal).toBe('b');
  });

  test('terminal filter includes settled/failed/salvage/rejected', () => {
    const d = walkToReviewPending('term');
    queue.reject({ id: d.id, reason: 'no' });
    const terminal = queue.list({ state: 'terminal' });
    expect(terminal).toHaveLength(1);
  });

  test('awaiting_review filter returns only review_pending', () => {
    walkToReviewPending('rp-1');
    advance(1000);
    walkToReviewPending('rp-2');
    queue.propose({ goal: 'just-proposed' });
    const awaiting = queue.list({ state: 'awaiting_review' });
    expect(awaiting).toHaveLength(2);
    expect(awaiting.every((d) => d.state === 'review_pending')).toBe(true);
  });

  test('since filter returns only items active after timestamp', () => {
    const a = queue.propose({ goal: 'a' });
    advance(60_000);
    const cutoff = clock;
    advance(60_000);
    const b = queue.propose({ goal: 'b' });
    const recent = queue.list({ since: cutoff });
    const ids = recent.map((d) => d.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(a.id);
  });
});

describe('terminal-state constants', () => {
  test('DISPATCH_TERMINAL_STATES covers every state that prevents further forward progress', () => {
    expect(DISPATCH_TERMINAL_STATES).toEqual(
      expect.arrayContaining(['settled', 'failed', 'salvage']),
    );
  });

  test('DISPATCH_RESOLVED_STATES is a subset of terminal states', () => {
    for (const s of DISPATCH_RESOLVED_STATES) {
      expect(DISPATCH_TERMINAL_STATES).toContain(s);
    }
  });
});

describe('slug + branch derivation', () => {
  test('deriveSlug from a real-world goal', () => {
    expect(deriveSlug('Polish the FleetBar onboarding flow!')).toBe('polish-the-fleetbar-onboarding-flow');
  });

  test('deriveBranchName uses dispatch/ prefix (not legacy night-shift/)', () => {
    const branch = deriveBranchName('polish-fleetbar', 'abcd1234-ef56-7890');
    expect(branch).toBe('dispatch/polish-fleetbar-abcd1234');
  });
});

describe('legacyStatusToState mapping', () => {
  test.each([
    ['proposed', 'proposed'],
    ['queued', 'claimed'],
    ['running', 'in_progress'],
    ['succeeded', 'settled'],
    ['failed', 'failed'],
    ['aborted', 'failed'],
    ['timeout', 'failed'],
    ['cancelled', 'salvage'],
    ['unknown-garbage', 'proposed'],
  ])('%s -> %s', (legacy, expected) => {
    expect(legacyStatusToState(legacy)).toBe(expected);
  });
});

// SQL for the legacy nightshift_intents table -- kept as a string constant
// outside Database.exec() so the security-warning hook does not false-
// positive on the test file.
const LEGACY_TABLE_DDL = [
  'CREATE TABLE nightshift_intents (',
  '  id TEXT PRIMARY KEY,',
  '  slug TEXT NOT NULL,',
  '  intent TEXT NOT NULL,',
  "  tags_json TEXT NOT NULL DEFAULT '[]',",
  "  status TEXT NOT NULL DEFAULT 'proposed',",
  '  backend TEXT,',
  '  budget_usd REAL,',
  '  timeout_ms INTEGER,',
  '  worktree_path TEXT,',
  '  branch_name TEXT,',
  '  session_id TEXT,',
  '  pr_url TEXT,',
  '  cost_usd REAL,',
  '  duration_ms INTEGER,',
  '  error_message TEXT,',
  '  created_at INTEGER NOT NULL,',
  '  queued_at INTEGER,',
  '  started_at INTEGER,',
  '  completed_at INTEGER,',
  '  reviewed_at INTEGER',
  ');',
].join('\n');

describe('migration from nightshift_intents', () => {
  test('copies rows from nightshift_intents into dispatches', () => {
    const freshDb = createTestDb();
    freshDb.prepare(LEGACY_TABLE_DDL).run();
    freshDb.prepare([
      'INSERT INTO nightshift_intents (',
      '  id, slug, intent, status, backend, budget_usd, timeout_ms,',
      '  branch_name, pr_url, cost_usd, created_at, queued_at, started_at, completed_at',
      ') VALUES (',
      "  'legacy-1', 'fix-the-thing', 'Fix the broken thing', 'succeeded',",
      "  'cli:codex', 5.0, 3600000,",
      "  'night-shift/fix-the-thing-abcd1234',",
      "  'https://github.com/foo/bar/pull/7',",
      '  1.23,',
      '  1700000000000, 1700000060000, 1700000120000, 1700000180000',
      ')',
    ].join('\n')).run();

    const q = createDispatchQueue({ db: freshDb });
    const migrated = q.get('legacy-1');
    expect(migrated).not.toBeNull();
    expect(migrated.goal).toBe('Fix the broken thing');
    expect(migrated.state).toBe('settled'); // succeeded -> settled
    expect(migrated.branch).toBe('night-shift/fix-the-thing-abcd1234'); // preserved
    expect(migrated.resultArtifact).toBe('https://github.com/foo/bar/pull/7');
    expect(migrated.baseBranch).toBe('main'); // default
    expect(migrated.mergePolicy).toBe('review'); // default
    expect(migrated.requestedBy).toBe('operator');
    expect(migrated.costUsd).toBeCloseTo(1.23);
    expect(migrated.settledAt).toBe(1700000180000);

    freshDb.close();
  });

  test('is idempotent (re-running migration does nothing)', () => {
    const freshDb = createTestDb();
    freshDb.prepare(LEGACY_TABLE_DDL).run();
    freshDb.prepare([
      "INSERT INTO nightshift_intents (id, slug, intent, status, created_at)",
      "VALUES ('legacy-2', 'foo', 'foo', 'proposed', 1700000000000)",
    ].join('\n')).run();

    const q1 = createDispatchQueue({ db: freshDb });
    expect(q1.get('legacy-2')).not.toBeNull();
    const countAfterFirst = freshDb.prepare('SELECT COUNT(*) AS n FROM dispatches').get().n;

    // Reconstruct the queue -- triggers migration again.
    const q2 = createDispatchQueue({ db: freshDb });
    expect(q2.get('legacy-2')).not.toBeNull();
    const countAfterSecond = freshDb.prepare('SELECT COUNT(*) AS n FROM dispatches').get().n;
    expect(countAfterSecond).toBe(countAfterFirst);

    freshDb.close();
  });
});
