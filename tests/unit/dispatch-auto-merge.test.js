/**
 * Tests for lib/dispatch/auto-merge.ts — the `merge_policy='auto'` sweep.
 *
 * No real `gh`/`git` subprocess or network call is made: the CommandRunner is
 * a fake that answers based on the argv it receives, mirroring how
 * harbormaster.test.js exercises lib/harbormaster.ts. The DB is in-memory.
 *
 * Covers:
 *   - readiness only passes when CI is green AND mergeable AND 0 unresolved
 *     review threads AND not a draft
 *   - a single red/pending/conflicting/draft/unresolved-thread condition
 *     blocks the merge
 *   - review/never policy dispatches are never swept
 *   - a successful merge posts one durable note, transitions cleanup
 *     (worktree reap + local branch delete), and is idempotent on a second
 *     sweep (no re-merge, no duplicate note)
 */

import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import {
  evaluateReadiness,
  findAutoMergeCandidates,
  checkAndCompleteDispatch,
  runAutoMergeSweep,
  parseGithubPrUrl,
  looksLikeGithubPrUrl,
} from '../../lib/dispatch/auto-merge.js';

const PR_URL = 'https://github.com/acme/widget/pull/42';

let db;
let queue;

beforeEach(() => {
  db = createTestDb();
  queue = createDispatchQueue({ db });
});

afterEach(() => {
  db.close();
});

/**
 * A fake CommandRunner that answers `gh pr view`, `gh api graphql`, `gh pr
 * merge`, and `git ... branch -D` based on a small config object. Tracks
 * every call so tests can assert exactly what was (and wasn't) invoked.
 */
function makeFakeRunner(config = {}) {
  const {
    prState = 'OPEN',
    isDraft = false,
    mergeable = 'MERGEABLE',
    checks = [{ name: 'ci', conclusion: 'SUCCESS' }],
    unresolvedThreads = 0,
    mergeSucceeds = true,
    branchDeleteSucceeds = true,
  } = config;

  const calls = [];
  const run = jest.fn(async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      return {
        code: 0,
        stdout: JSON.stringify({
          state: prState,
          isDraft,
          mergeable,
          mergeStateStatus: mergeable === 'MERGEABLE' ? 'CLEAN' : 'DIRTY',
          statusCheckRollup: checks,
          number: 42,
        }),
        stderr: '',
      };
    }
    if (cmd === 'gh' && args[0] === 'api' && args[1] === 'graphql') {
      const nodes = Array.from({ length: unresolvedThreads }, () => ({ isResolved: false }));
      return {
        code: 0,
        stdout: JSON.stringify({
          data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: { hasNextPage: false } } } } },
        }),
        stderr: '',
      };
    }
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
      return mergeSucceeds
        ? { code: 0, stdout: 'https://github.com/acme/widget/commit/abc1234', stderr: '' }
        : { code: 1, stdout: '', stderr: 'not mergeable' };
    }
    if (cmd === 'git' && args.includes('branch')) {
      return branchDeleteSucceeds
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 1, stdout: '', stderr: 'branch not found' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });
  return { runner: { run }, calls };
}

function proposeAutoDispatch(overrides = {}) {
  const d = queue.propose({ goal: 'ship the widget', mergePolicy: 'auto', ...overrides });
  queue.claim({ id: d.id, worktreePath: '/tmp-ish/does-not-exist', branch: 'dispatch/ship-abc', sessionId: 's1' });
  queue.start(d.id);
  queue.produce({ id: d.id, resultArtifact: PR_URL });
  queue.requestReview(d.id);
  queue.settle({ id: d.id, state: 'settled', resultArtifact: PR_URL });
  return queue.get(d.id);
}

// ── URL parsing ──────────────────────────────────────────────────────────

describe('parseGithubPrUrl / looksLikeGithubPrUrl', () => {
  test('parses a well-formed PR URL', () => {
    expect(parseGithubPrUrl(PR_URL)).toEqual({ owner: 'acme', repo: 'widget', number: 42 });
  });

  test('rejects non-PR strings', () => {
    expect(parseGithubPrUrl('not a url')).toBeNull();
    expect(looksLikeGithubPrUrl(null)).toBe(false);
    expect(looksLikeGithubPrUrl(undefined)).toBe(false);
  });
});

// ── Readiness gate ───────────────────────────────────────────────────────

describe('evaluateReadiness', () => {
  const base = {
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    failingChecks: [],
    pendingChecks: [],
    unresolvedThreads: 0,
    threadsUnknown: false,
    fetchError: null,
  };

  test('ready when OPEN + not draft + mergeable + green CI + 0 unresolved threads', () => {
    expect(evaluateReadiness(base)).toEqual({ ready: true, reasons: [] });
  });

  test('not ready on a failing check', () => {
    const r = evaluateReadiness({ ...base, failingChecks: ['unit-tests'] });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/failing checks/);
  });

  test('not ready on a pending check', () => {
    const r = evaluateReadiness({ ...base, pendingChecks: ['integration'] });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/pending checks/);
  });

  test('not ready when not mergeable (conflicts)', () => {
    const r = evaluateReadiness({ ...base, mergeable: 'CONFLICTING' });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/mergeable=CONFLICTING/);
  });

  test('not ready on a draft PR', () => {
    const r = evaluateReadiness({ ...base, isDraft: true });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/draft/);
  });

  test('not ready with unresolved review threads', () => {
    const r = evaluateReadiness({ ...base, unresolvedThreads: 2 });
    expect(r.ready).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/2 unresolved review thread/);
  });

  test('not ready when thread count could not be confirmed (errs strict)', () => {
    const r = evaluateReadiness({ ...base, threadsUnknown: true });
    expect(r.ready).toBe(false);
  });

  test('not ready when PR is not OPEN', () => {
    const r = evaluateReadiness({ ...base, state: 'CLOSED' });
    expect(r.ready).toBe(false);
  });
});

// ── Candidate selection ──────────────────────────────────────────────────

describe('findAutoMergeCandidates', () => {
  test('includes only merge_policy=auto dispatches with a live PR', () => {
    const auto = proposeAutoDispatch();
    const review = queue.propose({ goal: 'reviewed work', mergePolicy: 'review' });
    const never = queue.propose({ goal: 'never merge', mergePolicy: 'never' });

    const candidates = findAutoMergeCandidates(queue);
    expect(candidates.map((d) => d.id)).toEqual([auto.id]);
    expect(candidates.map((d) => d.id)).not.toContain(review.id);
    expect(candidates.map((d) => d.id)).not.toContain(never.id);
  });

  test('excludes auto dispatches with no PR yet (still in_progress)', () => {
    const d = queue.propose({ goal: 'not produced yet', mergePolicy: 'auto', autoClaim: true });
    queue.start(d.id);
    const candidates = findAutoMergeCandidates(queue);
    expect(candidates.map((c) => c.id)).not.toContain(d.id);
  });

  test('excludes terminal-bad auto dispatches (failed/salvage)', () => {
    const failed = queue.propose({ goal: 'blew up', mergePolicy: 'auto', autoClaim: true });
    queue.start(failed.id);
    queue.settle({ id: failed.id, state: 'failed', errorMessage: 'boom' });
    const candidates = findAutoMergeCandidates(queue);
    expect(candidates.map((c) => c.id)).not.toContain(failed.id);
  });
});

// ── checkAndCompleteDispatch: the merge + cleanup unit ───────────────────

describe('checkAndCompleteDispatch', () => {
  test('merges when green + mergeable + 0 unresolved threads, then cleans up and logs once', async () => {
    const d = proposeAutoDispatch();
    const { runner, calls } = makeFakeRunner({});
    const reaper = jest.fn(async () => {});
    const postNote = jest.fn(async () => {});

    const outcome = await checkAndCompleteDispatch(d, { runner, reaper, postNote, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('merged');
    expect(outcome.mergeCommit).toBe('abc1234');
    expect(outcome.cleanup.worktreeReaped).toBe(true);
    expect(outcome.cleanup.branchDeleted).toBe(true);
    expect(reaper).toHaveBeenCalledWith('/tmp-ish/does-not-exist');
    expect(postNote).toHaveBeenCalledTimes(1);
    expect(postNote.mock.calls[0][0]).toMatch(/merged/);
    expect(postNote.mock.calls[0][0]).toMatch(PR_URL);

    // The merge call itself never uses --admin or --auto, and always squashes + deletes.
    const mergeCall = calls.find((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge');
    expect(mergeCall).toEqual(['gh', 'pr', 'merge', PR_URL, '--squash', '--delete-branch']);
  });

  test('does NOT merge on red CI', async () => {
    const d = proposeAutoDispatch();
    const { runner, calls } = makeFakeRunner({ checks: [{ name: 'unit-tests', conclusion: 'FAILURE' }] });
    const postNote = jest.fn(async () => {});

    const outcome = await checkAndCompleteDispatch(d, { runner, postNote, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('not_ready');
    expect(outcome.reasons.join(' ')).toMatch(/failing checks/);
    expect(calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge')).toBe(false);
    expect(postNote).not.toHaveBeenCalled();
  });

  test('does NOT merge with unresolved review threads', async () => {
    const d = proposeAutoDispatch();
    const { runner, calls } = makeFakeRunner({ unresolvedThreads: 3 });

    const outcome = await checkAndCompleteDispatch(d, { runner, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('not_ready');
    expect(outcome.reasons.join(' ')).toMatch(/3 unresolved review thread/);
    expect(calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge')).toBe(false);
  });

  test('does NOT merge a draft PR', async () => {
    const d = proposeAutoDispatch();
    const { runner, calls } = makeFakeRunner({ isDraft: true });

    const outcome = await checkAndCompleteDispatch(d, { runner, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('not_ready');
    expect(calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge')).toBe(false);
  });

  test('does NOT merge a non-mergeable (conflicting) PR', async () => {
    const d = proposeAutoDispatch();
    const { runner, calls } = makeFakeRunner({ mergeable: 'CONFLICTING' });

    const outcome = await checkAndCompleteDispatch(d, { runner, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('not_ready');
    expect(calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge')).toBe(false);
  });

  test('is a no-op for merge_policy=review dispatches', async () => {
    const d = queue.propose({ goal: 'reviewed work', mergePolicy: 'review' });
    const { runner, calls } = makeFakeRunner({});

    const outcome = await checkAndCompleteDispatch(d, { runner, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('not_applicable');
    expect(calls.length).toBe(0);
  });

  test('is a no-op for merge_policy=never dispatches', async () => {
    const d = queue.propose({ goal: 'never merge', mergePolicy: 'never' });
    const { runner, calls } = makeFakeRunner({});

    const outcome = await checkAndCompleteDispatch(d, { runner, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('not_applicable');
    expect(calls.length).toBe(0);
  });

  test('idempotent: already-MERGED PR triggers cleanup only, never a second merge call or note', async () => {
    const d = proposeAutoDispatch();
    const { runner, calls } = makeFakeRunner({ prState: 'MERGED' });
    const reaper = jest.fn(async () => {});
    const postNote = jest.fn(async () => {});

    const outcome = await checkAndCompleteDispatch(d, { runner, reaper, postNote, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('already_merged');
    expect(reaper).toHaveBeenCalled();
    expect(postNote).not.toHaveBeenCalled();
    expect(calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge')).toBe(false);
  });

  test('reports gh pr merge failure loudly instead of pretending success', async () => {
    const d = proposeAutoDispatch();
    const { runner } = makeFakeRunner({ mergeSucceeds: false });
    const postNote = jest.fn(async () => {});

    const outcome = await checkAndCompleteDispatch(d, { runner, postNote, repoRoot: '/repo' });

    expect(outcome.outcome).toBe('error');
    expect(outcome.error).toMatch(/not mergeable/);
    expect(postNote).toHaveBeenCalledTimes(1);
    expect(postNote.mock.calls[0][0]).toMatch(/BLOCKED/);
  });
});

// ── runAutoMergeSweep: the full poller ───────────────────────────────────

describe('runAutoMergeSweep', () => {
  test('sweeps only auto-policy dispatches with a live PR, ignoring review-policy dispatches', async () => {
    const autoOne = proposeAutoDispatch({ goal: 'first auto dispatch' });
    const autoTwo = proposeAutoDispatch({ goal: 'second auto dispatch' });
    // Same shape as autoOne/autoTwo, but merge_policy=review — must be excluded
    // from the sweep entirely, even though it also has a produced PR.
    const reviewPolicy = queue.propose({ goal: 'human reviews this', mergePolicy: 'review' });
    queue.claim({ id: reviewPolicy.id, worktreePath: '/w', branch: 'b', sessionId: 's' });
    queue.start(reviewPolicy.id);
    queue.produce({ id: reviewPolicy.id, resultArtifact: PR_URL });
    queue.requestReview(reviewPolicy.id);

    const { runner } = makeFakeRunner({}); // green + mergeable + 0 threads for every gh call
    const postNote = jest.fn(async () => {});
    const reaper = jest.fn(async () => {});

    const result = await runAutoMergeSweep(queue, { runner, postNote, reaper, repoRoot: '/repo' });

    expect(result.checked).toBe(2); // autoOne + autoTwo, NOT reviewPolicy
    expect(result.merged.map((m) => m.dispatchId).sort()).toEqual([autoOne.id, autoTwo.id].sort());
    expect(result.merged.some((m) => m.dispatchId === reviewPolicy.id)).toBe(false);
    expect(postNote).toHaveBeenCalledTimes(2);
  });

  test('a second sweep after merging does cleanup only — no duplicate merge, no duplicate note', async () => {
    const d = proposeAutoDispatch();
    let prState = 'OPEN';
    const run = jest.fn(async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
        return {
          code: 0,
          stdout: JSON.stringify({
            state: prState,
            isDraft: false,
            mergeable: 'MERGEABLE',
            statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS' }],
            number: 42,
          }),
          stderr: '',
        };
      }
      if (cmd === 'gh' && args[0] === 'api') {
        return {
          code: 0,
          stdout: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: {} } } } } }),
          stderr: '',
        };
      }
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
        prState = 'MERGED';
        return { code: 0, stdout: 'deadbeef', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    const postNote = jest.fn(async () => {});

    const first = await runAutoMergeSweep(queue, { runner: { run }, postNote, reaper: async () => {}, repoRoot: '/repo' });
    expect(first.merged.length).toBe(1);
    expect(postNote).toHaveBeenCalledTimes(1);

    const second = await runAutoMergeSweep(queue, { runner: { run }, postNote, reaper: async () => {}, repoRoot: '/repo' });
    expect(second.merged.length).toBe(0);
    expect(postNote).toHaveBeenCalledTimes(1); // still just once — no re-log
  });
});
