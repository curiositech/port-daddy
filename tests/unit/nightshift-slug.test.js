import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createNightshiftQueue, deriveSlug, deriveBranchName } from '../../lib/nightshift/queue.js';
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
  NIGHTSHIFT_WORKTREE_ROOT,
} from '../../lib/nightshift/runner.js';

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
    // 60-char boundary lands on a dash; slug should not end with -
    const input = 'a'.repeat(60) + '-extra-words-that-fall-off';
    const slug = deriveSlug(input);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('deriveBranchName', () => {
  test('produces a night-shift/ prefixed branch with slug + idShort', () => {
    expect(deriveBranchName('foo-bar', 'abcdef0123456789')).toBe('night-shift/foo-bar-abcdef01');
  });

  test('handles short ids by padding with noid-ish fallback', () => {
    expect(deriveBranchName('s', '')).toBe('night-shift/s-noid');
  });

  test('strips non-alphanumerics from id portion', () => {
    expect(deriveBranchName('s', 'aa-bb-cc-dd-ee')).toBe('night-shift/s-aabbccdd');
  });
});

describe('deriveWorktreePath', () => {
  test('sits under the nightshift worktree root', () => {
    const p = deriveWorktreePath('abcd-1234');
    expect(p.startsWith(NIGHTSHIFT_WORKTREE_ROOT)).toBe(true);
    expect(p.endsWith('abcd-1234')).toBe(true);
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
    // intent must be passed as its own arg, never concatenated into a shell string
    expect(args[args.indexOf('-p') + 1]).toBe('do the thing');
  });

  test('codex backend uses --full-auto + --sandbox workspace-write', () => {
    const { command, args } = buildSpawnArgv(
      'cli:codex',
      '/scratch/x',
      'do the thing',
    );
    expect(command).toBe('codex');
    expect(args).toContain('--full-auto');
    expect(args.indexOf('--sandbox')).toBeGreaterThanOrEqual(0);
    expect(args[args.indexOf('--sandbox') + 1]).toBe('workspace-write');
    expect(args).toContain('/scratch/x');
    // intent must be the last positional, untouched
    expect(args[args.length - 1]).toBe('do the thing');
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
    queue = createNightshiftQueue({ db, now: () => clock });
  });
  afterEach(() => {
    db.close();
  });

  test('produces a deterministic plan keyed off the intent', () => {
    const intent = queue.propose({ intent: 'normalize design tokens' });
    const plan = planRunFor(intent);
    expect(plan.intent.id).toBe(intent.id);
    expect(plan.backend).toBe(DEFAULT_BACKEND);
    expect(plan.worktreePath).toContain(intent.id);
    expect(plan.branchName.startsWith('night-shift/normalize-design-tokens-')).toBe(true);
    expect(plan.baseRef).toBe('origin/main');
    expect(plan.command === 'claude' || plan.command === 'codex').toBe(true);
  });

  test('applies the default budget when intent does not set one', () => {
    const intent = queue.propose({ intent: 'foo' });
    const plan = planRunFor(intent);
    expect(plan.budgetUsd).toBe(DEFAULT_BUDGET_USD);
  });

  test('clamps timeout below MIN and above MAX', () => {
    const tiny = queue.propose({ intent: 'a', timeoutMs: 1 });
    expect(planRunFor(tiny).timeoutMs).toBe(MIN_TIMEOUT_MS);
    const huge = queue.propose({ intent: 'b', timeoutMs: 10 * MAX_TIMEOUT_MS });
    expect(planRunFor(huge).timeoutMs).toBe(MAX_TIMEOUT_MS);
  });

  test('uses the default timeout when intent does not set one', () => {
    const intent = queue.propose({ intent: 'foo' });
    expect(planRunFor(intent).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  test('honours backend override from caller', () => {
    const intent = queue.propose({ intent: 'foo' });
    expect(planRunFor(intent, { backend: 'cli:claude-code' }).backend).toBe('cli:claude-code');
    expect(planRunFor(intent, { backend: 'cli:codex' }).backend).toBe('cli:codex');
  });

  test('honours backend stored on the intent', () => {
    const intent = queue.propose({ intent: 'foo', backend: 'cli:claude-code' });
    expect(planRunFor(intent).backend).toBe('cli:claude-code');
  });

  test('throws on unsupported backend', () => {
    const intent = queue.propose({ intent: 'foo' });
    expect(() => planRunFor(intent, { backend: 'cli:weird' })).toThrow(/backend/);
  });

  test('rationale enumerates the blast-radius decisions', () => {
    const intent = queue.propose({ intent: 'foo', backend: 'cli:codex' });
    const plan = planRunFor(intent);
    const rationaleText = plan.rationale.join('\n');
    expect(rationaleText).toContain('codex');
    expect(rationaleText).toContain('workspace-write');
    expect(rationaleText).toContain('budget');
  });
});

describe('runNext (dry-run mode)', () => {
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

  test('returns null on empty queue', async () => {
    const result = await runNext(queue);
    expect(result).toBeNull();
  });

  test('returns a plan but does NOT consume the queue when dryRun=true', async () => {
    const intent = queue.propose({ intent: 'a', autoQueue: true });
    const result = await runNext(queue);
    expect(result).not.toBeNull();
    expect(result.plan.intent.id).toBe(intent.id);
    const reloaded = queue.get(intent.id);
    expect(reloaded.status).toBe('queued'); // not running
  });

  test('picks the oldest queued intent first', async () => {
    const first = queue.propose({ intent: 'first', autoQueue: true });
    clock += 1000;
    queue.propose({ intent: 'second', autoQueue: true });
    const result = await runNext(queue);
    expect(result.plan.intent.id).toBe(first.id);
  });

  test('errors when dryRun=false but no spawnAdapter is supplied', async () => {
    queue.propose({ intent: 'a', autoQueue: true });
    await expect(runNext(queue, { dryRun: false })).rejects.toThrow(/spawnAdapter/);
  });

  test('with dryRun=false + adapter, consumes queue and records adapter result', async () => {
    const intent = queue.propose({ intent: 'a', autoQueue: true });
    const adapter = jest.fn(async () => ({
      status: 'succeeded',
      costUsd: 0.42,
      prUrl: 'https://example.com/pr/1',
    }));
    const result = await runNext(queue, { dryRun: false, spawnAdapter: adapter });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(result.result.status).toBe('succeeded');
    const reloaded = queue.get(intent.id);
    expect(reloaded.status).toBe('succeeded');
    expect(reloaded.costUsd).toBeCloseTo(0.42);
    expect(reloaded.prUrl).toBe('https://example.com/pr/1');
  });

  test('adapter exception marks intent failed with the error message', async () => {
    const intent = queue.propose({ intent: 'b', autoQueue: true });
    const adapter = jest.fn(async () => {
      throw new Error('spawn blew up');
    });
    const result = await runNext(queue, { dryRun: false, spawnAdapter: adapter });
    expect(result.result.status).toBe('failed');
    const reloaded = queue.get(intent.id);
    expect(reloaded.status).toBe('failed');
    expect(reloaded.errorMessage).toMatch(/spawn blew up/);
  });

  test('the adapter receives a plan whose intent has status=running', async () => {
    queue.propose({ intent: 'c', autoQueue: true });
    let observedStatus = null;
    const adapter = jest.fn(async ({ plan }) => {
      observedStatus = plan.intent.status;
      return { status: 'succeeded' };
    });
    await runNext(queue, { dryRun: false, spawnAdapter: adapter });
    expect(observedStatus).toBe('running');
  });
});
