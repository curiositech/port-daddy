/**
 * Tests for lib/dispatch/runner.ts -- planning the autonomous spawn for a
 * dispatch. Renamed + rebased from nightshift-slug.test.js.
 */

import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createDispatchQueue, deriveSlug, deriveBranchName } from '../../lib/dispatch/queue.js';
import { buildCliTubeArgs } from '../../lib/spawner/backends/cli-tube-provider-specs.js';
import {
  planRunFor,
  runNext,
  buildSpawnArgv,
  deriveWorktreePath,
  DEFAULT_BACKEND,
  DEFAULT_BUDGET_USD,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  DISPATCH_WORKTREE_ROOT,
} from '../../lib/dispatch/runner.js';

describe('deriveSlug', () => {
  test('lowercases + replaces non-alphanumerics with -', () => {
    expect(deriveSlug('Hello, World!')).toBe('hello-world');
  });

  test('collapses runs of separators', () => {
    expect(deriveSlug('foo___bar...baz')).toBe('foo-bar-baz');
  });

  test('trims to 60 chars', () => {
    const long = 'word '.repeat(50).trim();
    const slug = deriveSlug(long);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  test('returns untitled for empty / whitespace / pure-punctuation input', () => {
    expect(deriveSlug('')).toBe('untitled');
    expect(deriveSlug('   ')).toBe('untitled');
    expect(deriveSlug('!!!')).toBe('untitled');
    expect(deriveSlug(null)).toBe('untitled');
    expect(deriveSlug(undefined)).toBe('untitled');
  });

  test('is deterministic -- same input yields same slug', () => {
    const a = deriveSlug('Normalize design tokens');
    const b = deriveSlug('Normalize design tokens');
    expect(a).toBe(b);
  });

  test('strips trailing dashes after truncation', () => {
    const input = 'a'.repeat(60) + '-extra-words-that-fall-off';
    const slug = deriveSlug(input);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('deriveBranchName', () => {
  test('produces a dispatch/ prefixed branch with slug + idShort', () => {
    expect(deriveBranchName('foo-bar', 'abcdef0123456789')).toBe('dispatch/foo-bar-abcdef01');
  });

  test('handles short ids by padding with noid-ish fallback', () => {
    expect(deriveBranchName('s', '')).toBe('dispatch/s-noid');
  });

  test('strips non-alphanumerics from id portion', () => {
    expect(deriveBranchName('s', 'aa-bb-cc-dd-ee')).toBe('dispatch/s-aabbccdd');
  });
});

describe('deriveWorktreePath', () => {
  test('sits under the dispatch worktree root', () => {
    const p = deriveWorktreePath('abcd1234ef56');
    expect(p.startsWith(DISPATCH_WORKTREE_ROOT)).toBe(true);
    // Path uses port-daddy-dispatch-<shortId> naming.
    expect(p).toMatch(/port-daddy-dispatch-/);
  });

  test('never lands under /tmp', () => {
    const p = deriveWorktreePath('id');
    expect(p.startsWith('/tmp/')).toBe(false);
    expect(p.startsWith('/private/tmp/')).toBe(false);
  });
});

describe('buildSpawnArgv', () => {
  test('claude backend uses --dangerously-skip-permissions and -p', () => {
    const { command, args } = buildSpawnArgv(
      'cli:claude-code',
      '/scratch/x',
      'do the thing',
    );
    expect(command).toBe('claude');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toBe('do the thing');
  });

  test('codex backend uses the cli-tube auto-reviewed workspace-write contract', () => {
    const { command, args } = buildSpawnArgv(
      'cli:codex',
      '/scratch/x',
      'do the thing',
    );
    expect(command).toBe('codex');
    expect(args).toContain('--approve-for-me');
    expect(args).not.toContain('--full-auto');
    expect(args).not.toContain('--sandbox');
    expect(args).toContain('/scratch/x');
    expect(args[args.length - 1]).toBe('do the thing');

    const cwdIndex = args.indexOf('-C');
    const providerArgs = args.filter((_, index) => index !== cwdIndex && index !== cwdIndex + 1);
    expect(providerArgs).toEqual(buildCliTubeArgs('codex', { prompt: 'do the thing' }).args);
  });

  test('attaches --model when provided', () => {
    const claude = buildSpawnArgv('cli:claude-code', '/x', 'foo', 'sonnet-4.7');
    expect(claude.args).toContain('--model');
    expect(claude.args[claude.args.indexOf('--model') + 1]).toBe('sonnet-4.7');
    const codex = buildSpawnArgv('cli:codex', '/x', 'foo', 'gpt-5.4-mini');
    expect(codex.args).toContain('--model');
  });
});

describe('planRunFor', () => {
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

  test('produces a deterministic plan keyed off the dispatch', () => {
    const d = queue.propose({ goal: 'normalize design tokens' });
    const plan = planRunFor(d);
    expect(plan.dispatch.id).toBe(d.id);
    expect(plan.backend).toBe(DEFAULT_BACKEND);
    expect(plan.worktreePath).toContain('port-daddy-dispatch-');
    expect(plan.branch.startsWith('dispatch/normalize-design-tokens-')).toBe(true);
    expect(plan.baseRef).toBe('origin/main');
    expect(plan.command === 'claude' || plan.command === 'codex').toBe(true);
  });

  test('uses dispatch.baseBranch for baseRef', () => {
    const d = queue.propose({ goal: 'foo', baseBranch: 'release/2026.05' });
    const plan = planRunFor(d);
    expect(plan.baseRef).toBe('origin/release/2026.05');
  });

  test('rationale calls out the merge_policy', () => {
    const d = queue.propose({ goal: 'foo', mergePolicy: 'never' });
    const plan = planRunFor(d);
    expect(plan.rationale.some((line) => line.includes('merge_policy = never'))).toBe(true);
  });

  test('applies the default budget when dispatch does not set one', () => {
    const d = queue.propose({ goal: 'foo' });
    const plan = planRunFor(d);
    expect(plan.budgetUsd).toBe(DEFAULT_BUDGET_USD);
  });

  test('clamps timeout below MIN and above MAX', () => {
    const tiny = queue.propose({ goal: 'a', timeoutMs: 1 });
    expect(planRunFor(tiny).timeoutMs).toBe(MIN_TIMEOUT_MS);
    const huge = queue.propose({ goal: 'b', timeoutMs: 10 * MAX_TIMEOUT_MS });
    expect(planRunFor(huge).timeoutMs).toBe(MAX_TIMEOUT_MS);
  });

  test('uses the default timeout when dispatch does not set one', () => {
    const d = queue.propose({ goal: 'foo' });
    expect(planRunFor(d).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  test('honours backend override from caller', () => {
    const d = queue.propose({ goal: 'foo' });
    expect(planRunFor(d, { backend: 'cli:claude-code' }).backend).toBe('cli:claude-code');
    expect(planRunFor(d, { backend: 'cli:codex' }).backend).toBe('cli:codex');
  });

  test('honours backend stored on the dispatch', () => {
    const d = queue.propose({ goal: 'foo', backend: 'cli:claude-code' });
    expect(planRunFor(d).backend).toBe('cli:claude-code');
  });

  test('throws on unsupported backend', () => {
    const d = queue.propose({ goal: 'foo' });
    expect(() => planRunFor(d, { backend: 'cli:weird' })).toThrow(/backend/);
  });

  test('rationale enumerates the blast-radius decisions', () => {
    const d = queue.propose({ goal: 'foo', backend: 'cli:codex' });
    const plan = planRunFor(d);
    const rationaleText = plan.rationale.join('\n');
    expect(rationaleText).toContain('codex');
    expect(rationaleText).toContain('workspace-write');
    expect(rationaleText).toContain('budget');
    expect(rationaleText).toContain('base_branch');
  });

  test('env includes PD_DISPATCH_BASE_BRANCH for the worker', () => {
    const d = queue.propose({ goal: 'foo', baseBranch: 'develop' });
    const plan = planRunFor(d);
    expect(plan.env.PD_DISPATCH_BASE_BRANCH).toBe('develop');
    expect(plan.env.PD_DISPATCH_ID).toBe(d.id);
  });
});

describe('runNext (dry-run mode)', () => {
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

  test('returns null on empty queue', async () => {
    const result = await runNext(queue);
    expect(result).toBeNull();
  });

  test('returns a plan but does NOT consume the queue when dryRun=true', async () => {
    const d = queue.propose({ goal: 'a' });
    const result = await runNext(queue);
    expect(result).not.toBeNull();
    expect(result.plan.dispatch.id).toBe(d.id);
    const reloaded = queue.get(d.id);
    expect(reloaded.state).toBe('proposed'); // not claimed
  });

  test('picks the oldest proposed dispatch first', async () => {
    const first = queue.propose({ goal: 'first' });
    clock += 1000;
    queue.propose({ goal: 'second' });
    const result = await runNext(queue);
    expect(result.plan.dispatch.id).toBe(first.id);
  });

  test('errors when dryRun=false but no spawnAdapter is supplied', async () => {
    queue.propose({ goal: 'a' });
    await expect(runNext(queue, { dryRun: false })).rejects.toThrow(/spawnAdapter/);
  });

  test('with dryRun=false + adapter, consumes queue and records adapter result', async () => {
    const d = queue.propose({ goal: 'a' });
    const adapter = jest.fn(async () => ({
      state: 'settled',
      costUsd: 0.42,
      resultArtifact: 'https://example.com/pr/1',
    }));
    const result = await runNext(queue, { dryRun: false, spawnAdapter: adapter });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(result.result.state).toBe('settled');
    const reloaded = queue.get(d.id);
    expect(reloaded.state).toBe('settled');
    expect(reloaded.costUsd).toBeCloseTo(0.42);
    expect(reloaded.resultArtifact).toBe('https://example.com/pr/1');
  });

  test('adapter exception marks dispatch failed with the error message', async () => {
    const d = queue.propose({ goal: 'b' });
    const adapter = jest.fn(async () => {
      throw new Error('spawn blew up');
    });
    const result = await runNext(queue, { dryRun: false, spawnAdapter: adapter });
    expect(result.result.state).toBe('failed');
    const reloaded = queue.get(d.id);
    expect(reloaded.state).toBe('failed');
    expect(reloaded.errorMessage).toMatch(/spawn blew up/);
  });

  test('the adapter receives a plan whose dispatch state is claimed', async () => {
    queue.propose({ goal: 'c' });
    let observedState = null;
    const adapter = jest.fn(async ({ plan }) => {
      observedState = plan.dispatch.state;
      return { state: 'settled' };
    });
    await runNext(queue, { dryRun: false, spawnAdapter: adapter });
    expect(observedState).toBe('claimed');
  });
});
