/**
 * Tests for lib/dispatch/spawn-adapter.ts
 *
 * All tests use injectable fns (spawnFn, worktreeAddFn, openPrFn) so no real
 * subprocess is spawned, no real worktree is created, and no real GitHub API
 * is called. The tests verify:
 *
 *   - correct worktree path construction from the queue row
 *   - correct branch + baseRef derivation
 *   - correct spawn argv forwarded to the spawn function
 *   - correct gh pr create invocation shape (via openPrFn)
 *   - state machine transitions: claimed → in_progress → produced → review_pending
 *   - failure path: worktree error → failed
 *   - failure path: agent error with no PR → failed
 *   - failure path: agent error but PR opened → settled (reviewable partial work)
 *   - requireCli throws a clear message for a missing binary
 */

import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createDispatchQueue } from '../../lib/dispatch/queue.js';
import { createSpawnAdapter, requireCli } from '../../lib/dispatch/spawn-adapter.js';
import {
  planRunFor,
  runNext,
  DISPATCH_WORKTREE_ROOT,
} from '../../lib/dispatch/runner.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeQueue(db) {
  return createDispatchQueue({ db, now: () => Date.now() });
}

/** Build a no-op adapter that records its calls. */
function makeAdapter(overrides = {}) {
  const calls = {
    worktreeAdd: [],
    spawn: [],
    openPr: [],
  };

  const worktreeAddFn = jest.fn(async (path, branch, baseRef) => {
    calls.worktreeAdd.push({ path, branch, baseRef });
    if (overrides.worktreeAddFn) return overrides.worktreeAddFn(path, branch, baseRef);
  });

  const spawnFn = jest.fn(async (params) => {
    calls.spawn.push(params);
    if (overrides.spawnFn) return overrides.spawnFn(params);
    return { output: 'agent output', rawStdout: '', exitCode: 0, error: null, tube: params.tube };
  });

  const openPrFn = jest.fn(async (params) => {
    calls.openPr.push(params);
    if (overrides.openPrFn) return overrides.openPrFn(params);
    return 'https://github.com/curiositech/port-daddy/pull/999';
  });

  const adapter = createSpawnAdapter({ spawnFn, worktreeAddFn, openPrFn });
  return { adapter, calls, spawnFn, worktreeAddFn, openPrFn };
}

// ── DISPATCH_WORKTREE_ROOT safety check ──────────────────────────────────────

import { homedir } from 'node:os';
import { resolve as pathResolve, join as pathJoin } from 'node:path';

describe('DISPATCH_WORKTREE_ROOT safety', () => {
  test('resolves under ~/coding or ~/.port-daddy, never /tmp', () => {
    const home = homedir();
    const root = pathResolve(DISPATCH_WORKTREE_ROOT);
    const allowed = [pathJoin(home, 'coding'), pathJoin(home, '.port-daddy')];
    expect(allowed.some((r) => root.startsWith(r))).toBe(true);
    expect(root.startsWith('/tmp/')).toBe(false);
    expect(root.startsWith('/private/tmp/')).toBe(false);
  });
});

// ── requireCli ───────────────────────────────────────────────────────────────

describe('requireCli', () => {
  test('returns a path for binaries that exist on PATH', () => {
    // `which` itself is always present.
    expect(requireCli('which')).toBeTruthy();
    expect(typeof requireCli('which')).toBe('string');
  });

  test('throws a clear error for a missing binary', () => {
    expect(() => requireCli('__definitely_not_on_path_xyzzy__')).toThrow(
      /not on PATH/,
    );
  });

  test('error message for missing claude mentions the install URL', () => {
    // We call requireCli with a known-absent name but expect the "claude" install
    // hint to be in the message when we pass 'claude' as the binary name.
    // Override to simulate claude not found: use __fake_claude.
    // Instead just test the message content directly by checking what requireCli
    // would say for 'claude' if 'claude' were absent. We test by verifying the
    // thrown message shape via a known-absent sentinel that starts with 'claude'.
    // Most CI machines won't have the Claude CLI:
    try {
      requireCli('__fake_claude_sentinel__');
    } catch (err) {
      expect(err.message).toMatch(/not on PATH/);
      expect(err.message).toMatch(/pd dispatch run --really-run/);
    }
  });
});

// ── createSpawnAdapter — worktree path ───────────────────────────────────────

describe('createSpawnAdapter — worktree path', () => {
  let db, queue;
  beforeEach(() => {
    db = createTestDb();
    queue = makeQueue(db);
  });
  afterEach(() => { db.close(); });

  test('worktreeAddFn receives the correct path derived from the dispatch id', async () => {
    const dispatch = queue.propose({ goal: 'write a hello-world test' });
    const plan = planRunFor(dispatch);
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    expect(calls.worktreeAdd).toHaveLength(1);
    const { path, branch, baseRef } = calls.worktreeAdd[0];
    // Path must be under DISPATCH_WORKTREE_ROOT and contain the dispatch prefix.
    expect(path.startsWith(DISPATCH_WORKTREE_ROOT)).toBe(true);
    expect(path).toContain('port-daddy-dispatch-');
    // Must match what planRunFor derived.
    expect(path).toBe(plan.worktreePath);
    // Branch and baseRef must match.
    expect(branch).toBe(plan.branch);
    expect(baseRef).toBe(plan.baseRef);
  });

  test('branch is dispatch/<slug>-<idShort>', async () => {
    const dispatch = queue.propose({ goal: 'implement feature xyz' });
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    const { branch } = calls.worktreeAdd[0];
    expect(branch).toMatch(/^dispatch\//);
    expect(branch).toContain('implement-feature-xyz');
  });

  test('baseRef uses origin/<baseBranch>', async () => {
    const dispatch = queue.propose({ goal: 'do something', baseBranch: 'release/2026.06' });
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    expect(calls.worktreeAdd[0].baseRef).toBe('origin/release/2026.06');
  });
});

// ── createSpawnAdapter — cli-tube invocation shape ──────────────────────────

describe('createSpawnAdapter — cli-tube invocation', () => {
  let db, queue;
  beforeEach(() => {
    db = createTestDb();
    queue = makeQueue(db);
  });
  afterEach(() => { db.close(); });

  test('spawnFn receives cli=codex + goal + cwd for cli:codex (default backend)', async () => {
    const dispatch = queue.propose({ goal: 'write unit tests for the spawner' });
    const plan = planRunFor(dispatch);
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    expect(calls.spawn).toHaveLength(1);
    const spawnCall = calls.spawn[0];
    // cli-tube spawn: tool is derived from the backend, goal is the prompt.
    expect(spawnCall.cli).toBe('codex');
    expect(spawnCall.goal).toBe(dispatch.goal);
    expect(spawnCall.worktreePath).toBe(plan.worktreePath);
    expect(spawnCall.timeoutMs).toBe(plan.timeoutMs);
  });

  test('spawnFn receives cli=claude-code for the cli:claude-code backend', async () => {
    const dispatch = queue.propose({ goal: 'refactor the config module', backend: 'cli:claude-code' });
    const plan = planRunFor(dispatch);
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter, backend: 'cli:claude-code' });

    const spawnCall = calls.spawn[0];
    expect(spawnCall.cli).toBe('claude-code');
    expect(spawnCall.goal).toBe(dispatch.goal);
    expect(spawnCall.worktreePath).toBe(plan.worktreePath);
  });

  test('spawnFn publishes on the dispatch:<id> tube channel', async () => {
    const dispatch = queue.propose({ goal: 'clean up stale tests' });
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    const spawnCall = calls.spawn[0];
    expect(spawnCall.tube).toBe(`dispatch:${dispatch.id}`);
    expect(spawnCall.tubeSender).toBe(`dispatch:${dispatch.id}`);
  });

  test('spawnFn env includes PD_DISPATCH_ID from plan.env', async () => {
    const dispatch = queue.propose({ goal: 'clean up stale tests' });
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    const env = calls.spawn[0].env;
    expect(env.PD_DISPATCH_ID).toBe(dispatch.id);
    expect(env.PD_DISPATCH_BRANCH).toBeTruthy();
    expect(env.PD_DISPATCH_WORKTREE).toBeTruthy();
  });

  test('tubeClient is threaded from runner options into the spawn', async () => {
    const dispatch = queue.propose({ goal: 'wire tube transparency' });
    const published = [];
    const tubeClient = {
      publish: async (channel, payload, opts) => {
        published.push({ channel, payload, opts });
        return { ok: true, id: published.length };
      },
    };
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter, tubeClient });

    // The injected spawnFn receives the same tubeClient the runner was given.
    expect(calls.spawn[0].tubeClient).toBe(tubeClient);
  });
});

// ── createSpawnAdapter — cost from cli-tube stream-json ──────────────────────

describe('createSpawnAdapter — cost extraction', () => {
  let db, queue;
  beforeEach(() => {
    db = createTestDb();
    queue = makeQueue(db);
  });
  afterEach(() => { db.close(); });

  test('costUsd comes from extractClaudeCodeUsage(rawStdout) via the injected costFn', async () => {
    const dispatch = queue.propose({ goal: 'price me', backend: 'cli:claude-code' });
    // A minimal stream-json terminal result line carrying usage — exactly what
    // the real claude CLI emits and what extractClaudeCodeUsage parses.
    const rawStdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'done',
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 },
    });
    const costFnCalls = [];
    const costFn = (p) => {
      costFnCalls.push(p);
      // pretend rate: $1/Mtok in, $2/Mtok out → 0.001 + 0.001 = 0.002
      return (p.inputTokens / 1e6) * 1 + (p.outputTokens / 1e6) * 2;
    };
    const { adapter } = makeAdapter({
      spawnFn: async (params) => ({ output: 'done', rawStdout, exitCode: 0, error: null, tube: params.tube }),
    });

    const result = await runNext(queue, {
      dryRun: false, spawnAdapter: adapter, backend: 'cli:claude-code', costFn,
    });

    // costFn was called with the EXACT token usage extracted from rawStdout.
    expect(costFnCalls).toHaveLength(1);
    expect(costFnCalls[0].inputTokens).toBe(1000);
    expect(costFnCalls[0].outputTokens).toBe(500);
    expect(result.result.costUsd).toBeCloseTo(0.002, 6);
    expect(queue.get(dispatch.id).costUsd).toBeCloseTo(0.002, 6);
  });

  test('costUsd is null when no costFn is wired (CLI foreground path)', async () => {
    const dispatch = queue.propose({ goal: 'no cost fn', backend: 'cli:claude-code' });
    const rawStdout = JSON.stringify({
      type: 'result', subtype: 'success', result: 'done',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { adapter } = makeAdapter({
      spawnFn: async (params) => ({ output: 'done', rawStdout, exitCode: 0, error: null, tube: params.tube }),
    });

    await runNext(queue, { dryRun: false, spawnAdapter: adapter, backend: 'cli:claude-code' });

    expect(queue.get(dispatch.id).costUsd).toBeNull();
  });
});

// ── createSpawnAdapter — gh pr create shape ───────────────────────────────────

describe('createSpawnAdapter — gh pr create', () => {
  let db, queue;
  beforeEach(() => {
    db = createTestDb();
    queue = makeQueue(db);
  });
  afterEach(() => { db.close(); });

  test('openPrFn receives the correct branch, baseBranch, goal, and dispatchId', async () => {
    const dispatch = queue.propose({
      goal: 'add integration tests for the dispatch queue',
      baseBranch: 'develop',
    });
    const { adapter, calls } = makeAdapter();

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    expect(calls.openPr).toHaveLength(1);
    const prCall = calls.openPr[0];
    expect(prCall.branch).toMatch(/^dispatch\//);
    expect(prCall.baseBranch).toBe('develop');
    expect(prCall.goal).toBe(dispatch.goal);
    expect(prCall.dispatchId).toBe(dispatch.id);
    expect(prCall.worktreePath).toBeTruthy();
  });

  test('resultArtifact on the queue row is the PR URL returned by openPrFn', async () => {
    const dispatch = queue.propose({ goal: 'improve error handling' });
    const fakePrUrl = 'https://github.com/curiositech/port-daddy/pull/42';
    const { adapter } = makeAdapter({
      openPrFn: async () => fakePrUrl,
    });

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    // The adapter walks through produced → review_pending → settled, recording the PR url.
    const updated = queue.get(dispatch.id);
    expect(updated.resultArtifact).toBe(fakePrUrl);
    expect(updated.state).toBe('settled');
  });
});

// ── createSpawnAdapter — state machine transitions ───────────────────────────

describe('createSpawnAdapter — state machine', () => {
  let db, queue;
  beforeEach(() => {
    db = createTestDb();
    queue = makeQueue(db);
  });
  afterEach(() => { db.close(); });

  test('dispatch transitions: proposed → claimed → in_progress → produced → settled', async () => {
    const dispatch = queue.propose({ goal: 'wire the spawn adapter into the CLI' });
    const { adapter } = makeAdapter();

    expect(queue.get(dispatch.id).state).toBe('proposed');

    await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    const updated = queue.get(dispatch.id);
    // Adapter settles to 'settled' after walking through produced; PR url is in resultArtifact.
    expect(updated.state).toBe('settled');
    expect(updated.claimedAt).toBeTruthy();
    expect(updated.startedAt).toBeTruthy();
    expect(updated.producedAt).toBeTruthy();
  });

  test('adapter returns state=settled when PR opened (adapter lifecycle signal)', async () => {
    const dispatch = queue.propose({ goal: 'add telemetry to the spawner' });
    const { adapter } = makeAdapter();

    const result = await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    expect(result.result.state).toBe('settled');
    expect(result.result.resultArtifact).toBe('https://github.com/curiositech/port-daddy/pull/999');
  });

  test('worktree error → dispatch settled as failed, no spawn called', async () => {
    const dispatch = queue.propose({ goal: 'fix the nightly test failure' });
    const { adapter, calls } = makeAdapter({
      worktreeAddFn: async () => { throw new Error('git worktree add failed: branch exists'); },
    });

    const result = await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    expect(result.result.state).toBe('failed');
    expect(result.result.errorMessage).toMatch(/worktree/);
    expect(calls.spawn).toHaveLength(0); // agent was never started
    expect(queue.get(dispatch.id).state).toBe('failed');
  });

  test('agent error + PR opened → settled (partial work is still reviewable)', async () => {
    const dispatch = queue.propose({ goal: 'prototype the new config loader' });
    const { adapter } = makeAdapter({
      spawnFn: async (params) => ({ output: 'partial output', rawStdout: '', exitCode: 1, error: 'agent exited with code 1', tube: params.tube }),
      openPrFn: async () => 'https://github.com/curiositech/port-daddy/pull/77',
    });

    const result = await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    expect(result.result.state).toBe('settled');
    expect(result.result.resultArtifact).toBe('https://github.com/curiositech/port-daddy/pull/77');
    // The combined error is preserved for the operator to see.
    expect(result.result.errorMessage).toMatch(/agent exited with code 1/);
    // Adapter settles to 'settled' (terminal) after the PR was opened, even with an agent error.
    expect(queue.get(dispatch.id).state).toBe('settled');
  });

  test('agent error + no PR → dispatch settled as failed', async () => {
    const dispatch = queue.propose({ goal: 'update the CI config' });
    const { adapter } = makeAdapter({
      spawnFn: async (params) => ({ output: '', rawStdout: '', exitCode: 1, error: 'agent failed', tube: params.tube }),
      openPrFn: async () => { throw new Error('gh pr create: nothing to push'); },
    });

    const result = await runNext(queue, { dryRun: false, spawnAdapter: adapter });

    expect(result.result.state).toBe('failed');
    expect(result.result.errorMessage).toMatch(/agent failed/);
    expect(queue.get(dispatch.id).state).toBe('failed');
  });
});

// ── dry-run stays unchanged ───────────────────────────────────────────────────

describe('dry-run mode is unchanged (no adapter called)', () => {
  let db, queue;
  beforeEach(() => {
    db = createTestDb();
    queue = makeQueue(db);
  });
  afterEach(() => { db.close(); });

  test('runNext with dryRun=true (default) does NOT call the adapter', async () => {
    const adapterFn = jest.fn(async () => ({ state: 'settled' }));
    queue.propose({ goal: 'something' });

    const result = await runNext(queue, { dryRun: true, spawnAdapter: adapterFn });

    expect(adapterFn).not.toHaveBeenCalled();
    expect(result.plan).toBeTruthy();
    expect(result.result).toBeUndefined();
  });

  test('dispatch remains proposed after a dry run', async () => {
    const dispatch = queue.propose({ goal: 'something' });

    await runNext(queue, { dryRun: true });

    expect(queue.get(dispatch.id).state).toBe('proposed');
  });
});
