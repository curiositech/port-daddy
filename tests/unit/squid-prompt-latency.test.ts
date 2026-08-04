/**
 * The keystroke budget — bin/pd-hook-prompt must cost O(cap), not O(matrix).
 * ==========================================================================
 * `pd-hook-prompt` is a UserPromptSubmit tentacle: it runs BETWEEN a human
 * pressing Enter and the model seeing their prompt. Every millisecond it spends
 * is a millisecond of dead keyboard, which makes its cost a product property,
 * not a micro-optimisation. The hook's own header states the rule it is judged
 * by: *a hook that degrades coordination is fine, a hook that breaks the vendor
 * loop is not.*
 *
 * ## The regression these tests exist to prevent
 *
 * A projection loop that runs a filter over EVERY matrix line — rather than
 * stopping once its emission budget is spent, or accounting for the remainder in
 * bulk — is O(matrix). That is invisible in the unit suites above, which seed a
 * handful of keys, and catastrophic in production, because the matrix is
 * unbounded and grows *precisely when the daemon is dead*: nothing GCs it while
 * `pd-hook-post-tool` keeps appending a pheromone per touched file per tool call,
 * so a daemon-less workday reaches thousands of keys. The shape that shipped this
 * regression forked ~4 processes per candidate line (two `sed`, up to two `date`)
 * and measured:
 *
 *     100 keys   1129 ms      500 keys   5381 ms      2000 keys   23306 ms
 *
 * Twenty-three seconds in front of a human's keystroke — and the stale-matrix
 * path was worse, doing the entire projection and then discarding all of it, for
 * 0 bytes emitted.
 *
 * ## What is asserted, and why in this shape
 *
 * 1. **Flatness, measured relatively.** The wall-clock ceiling is derived from
 *    THIS machine's own cost of running the hook against a trivial matrix, so the
 *    test states "growing the matrix 2000x must not grow the turn cost" rather
 *    than "must run in under N ms" — the latter is a CI-speed lottery. The
 *    absolute floor in the ceiling keeps it meaningful on a fast machine.
 * 2. **The stale path too.** Its own assertion, because it is the case that
 *    triggers exactly when the matrix is largest, and because throwing the work
 *    away at the end is not the same as never doing it.
 * 3. **Bounded work must not buy dishonest receipts.** Bounding the scan is only
 *    legitimate if the VoiceLog still reports what the harness truly HELD. These
 *    tests pin the held counts to the real whole-matrix totals while the scan
 *    bound is set far below them, so a future "optimisation" that reports the
 *    truncated figure as exact fails here instead of quietly lying to an
 *    operator about how much went unsaid.
 */

import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { serializeMatrix } from '../../lib/squid/matrix.js';
import {
  PD_ALERT_FLEET_APPROVALS_KEY,
  PD_RECON_HEARTBEAT_TS_KEY,
  RECONCILE_STALE_AFTER_MS,
} from '../../lib/squid/reconcile-contract.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '..', '..');
const HOOK = join(repoRoot, 'bin', 'pd-hook-prompt');

// Isolated scratch under ~/coding/tmp (NEVER /tmp — macOS purges it, and the
// repo's matrix doctrine forbids it).
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-latency', `jest-${process.pid}`);
const HOME_DIR = join(SCRATCH, 'pd-home');
const WORKSPACE = join(SCRATCH, 'workspace');
const MATRIX = join(HOME_DIR, 'matrix.env');
const VOICE_LOG = join(HOME_DIR, 'squid-voice-log.jsonl');

/**
 * Matrix size the flatness assertions are made at.
 *
 * 2000 is not arbitrary: it is the reviewer's reproduction point and a realistic
 * daemon-less day (`pd-hook-post-tool` appends one pheromone per touched file per
 * tool call, so K>=8 touched files across a few hundred tool calls lands here).
 */
const BIG = 2000;

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(HOME_DIR, { recursive: true });
  mkdirSync(join(WORKSPACE, '.portdaddy'), { recursive: true });
});

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

const isoNow = () => new Date().toISOString();

/**
 * Write a whole matrix in one shot through the REAL serializer.
 *
 * `setKey` re-reads, re-sorts and rewrites the entire file per call, so seeding
 * 2000 keys with it is quadratic and would make the *test* the slow thing. Going
 * through `serializeMatrix` keeps the on-disk format the production writer's,
 * which is the part that actually has to stay honest — a hand-rolled `KEY="v"`
 * string here would let a serializer change slip past the hook's parser.
 */
function seedMatrix(kv: Record<string, string>): void {
  writeFileSync(MATRIX, serializeMatrix(kv));
}

/** `n` fresh pheromone traces, all inside the project root so none is filtered. */
function pheromones(n: number, ts = isoNow()): Record<string, string> {
  const kv: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    kv[`PD_PHEROMONE_BULK_${i}`] = `${WORKSPACE}/src/f-${i}.ts | touched f-${i} | ts:${ts}`;
  }
  return kv;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/**
 * Invoke the real tentacle and time it.
 *
 * Every inherited `PD_*` variable is stripped: this suite runs under a live Port
 * Daddy session, and an inherited `PD_ACTOR` or `PD_MATRIX_FILE` would point the
 * hook at the operator's real matrix — measuring the wrong file, and on a busy
 * machine failing for reasons that have nothing to do with this code.
 */
function runHook(env: Record<string, string> = {}): RunResult {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('PD_')) continue;
    if (v !== undefined) clean[k] = v;
  }
  const started = Date.now();
  const r = spawnSync(HOOK, [], {
    input: JSON.stringify({ prompt: 'do the thing', cwd: WORKSPACE }),
    env: { ...clean, PD_HOME: HOME_DIR, PD_MATRIX_FILE: MATRIX, PD_ACTOR: 'agent-alpha', ...env },
    encoding: 'utf8',
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    ms: Date.now() - started,
  };
}

interface VoiceLine {
  outcome: 'spoke' | 'silent' | 'suppressed';
  reason?: string;
  counts?: Record<string, number>;
  bytes?: number;
  droppedClasses?: string[];
  emittedBytes?: number;
}

function lastVoice(): VoiceLine {
  expect(existsSync(VOICE_LOG)).toBe(true);
  const lines = readFileSync(VOICE_LOG, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]) as VoiceLine;
}

/**
 * Cost of one invocation against a near-empty matrix, on THIS machine.
 *
 * Everything downstream is expressed as a multiple of this, so the assertions
 * survive a slow or contended CI box without going slack: process spawn, `jq`,
 * and the fixed `date` probes are all in here, and none of them depend on how
 * many keys the matrix holds.
 */
function baselineMs(): number {
  seedMatrix({ PD_UNRELATED_KEY: 'not a projected class' });
  runHook(); // warm caches and burn the once-per-interval plan-directive nag
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) best = Math.min(best, runHook().ms);
  return best;
}

/**
 * The ceiling a large-matrix turn must come in under.
 *
 * `4x baseline` is the real assertion — an O(matrix) hook misses it by two orders
 * of magnitude at n=2000 (23306 ms vs a ~170 ms baseline), while a genuinely
 * bounded one stays within noise of it. The 2000 ms floor stops a very fast
 * machine from turning a 4x multiplier into a flake, and is still far below any
 * per-line implementation's cost at this size.
 */
const ceiling = (base: number) => Math.max(2000, base * 4);

describe('pd-hook-prompt — the keystroke budget', () => {
  test(
    'a 2000-key matrix costs about what an empty one costs',
    () => {
      const base = baselineMs();

      seedMatrix(pheromones(BIG));
      runHook(); // one warm invocation, same as the baseline got
      const big = Math.min(runHook().ms, runHook().ms);

      expect(big).toBeLessThan(ceiling(base));
    },
    180_000,
  );

  test(
    'the stale-matrix path does not do the projection it is about to throw away',
    () => {
      const base = baselineMs();

      // A heartbeat this old is exactly the state that grows the matrix: the
      // reconcile loop is not running, so nothing is GCing what post-tool writes.
      seedMatrix({
        ...pheromones(BIG),
        [PD_RECON_HEARTBEAT_TS_KEY]: String(Date.now() - RECONCILE_STALE_AFTER_MS - 5_000),
      });
      runHook();
      const big = Math.min(runHook().ms, runHook().ms);

      expect(big).toBeLessThan(ceiling(base));

      // ...and it is still fast for the right reason: the work was skipped, not
      // the receipt. Nothing reached the model, and the operator is told exactly
      // how many entries the harness was sitting on when it went quiet.
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      const line = lastVoice();
      expect(line.outcome).toBe('suppressed');
      expect(line.reason).toBe('stale-matrix');
      expect(line.counts).toEqual({ PHEROMONE: BIG });
      expect(line.emittedBytes).toBe(0);
      expect(line.bytes).toBeGreaterThan(0);
    },
    180_000,
  );

  test(
    'a matrix of every class at once is still flat',
    () => {
      const base = baselineMs();
      const ts = isoNow();
      const kv: Record<string, string> = { ...pheromones(500, ts) };
      for (let i = 0; i < 300; i++) kv[`PD_ALERT_BULK_${i}`] = `STEERING: alert-${i} | ts:${ts}`;
      for (let i = 0; i < 300; i++) kv[`PD_CLAIM_BULK_${i}`] = `claim on f-${i} | ts:${ts}`;
      for (let i = 0; i < 300; i++) kv[`PD_CI_BULK_${i}`] = `check-${i} failing | ts:${ts}`;
      for (let i = 0; i < 300; i++) {
        kv[`PD_ACCOMPLISHMENT_BULK_${i}`] = `session s${i} shipped | ts:${ts}`;
      }
      for (let i = 0; i < 300; i++) {
        kv[`PD_INBOX_AGENT_ALPHA__M${i}`] = `tube: message ${i} | ts:${ts}`;
        kv[`PD_PARLEY_AGENT_ALPHA__C${i}`] = `PARLEY: summons ${i} | ts:${ts}`;
      }
      kv[PD_ALERT_FLEET_APPROVALS_KEY] = `2 spawns awaiting approval | ts:${ts}`;
      seedMatrix(kv);

      runHook();
      const big = Math.min(runHook().ms, runHook().ms);
      expect(big).toBeLessThan(ceiling(base));
    },
    180_000,
  );
});

describe('pd-hook-prompt — bounded work, exact receipts', () => {
  /**
   * The bound is a latency guard, never a licence to under-report.
   *
   * This is the honesty half of the fix. `PD_SQUID_PROMPT_SCAN_BOUND` caps how
   * many lines PER CLASS the shell loop may walk; everything past it is accounted
   * for in one batched pipeline rather than by looping. If a future change
   * replaced that pipeline with "report what we scanned", these numbers would
   * collapse to the bound — and an operator reading `pd squid voice` would be
   * told 12 entries went unsaid when the real figure was 400.
   */
  test('held counts past the scan bound are the WHOLE-MATRIX totals, not the bound', () => {
    const ts = isoNow();
    const kv: Record<string, string> = { ...pheromones(400, ts) };
    for (let i = 0; i < 90; i++) kv[`PD_ALERT_BULK_${i}`] = `STEERING: alert-${i} | ts:${ts}`;
    kv[PD_ALERT_FLEET_APPROVALS_KEY] = `2 spawns awaiting approval | ts:${ts}`;
    seedMatrix(kv);

    const r = runHook({ PD_SQUID_PROMPT_SCAN_BOUND: '12' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');

    const line = lastVoice();
    expect(line.outcome).toBe('suppressed');
    // 400 pheromones and 90 legacy alerts, with the single approvals key split
    // out of the alert tally even though it sits far past the 12-line bound.
    expect(line.counts).toEqual({ FLEET_APPROVALS: 1, ALERT: 90, PHEROMONE: 400 });
    expect(line.droppedClasses).toEqual(['PHEROMONE', 'ALERT', 'FLEET_APPROVALS']);
  });

  test('the receipt is identical whether or not the bound truncated the scan', () => {
    const ts = isoNow();
    seedMatrix(pheromones(300, ts));

    const bounded = runHook({ PD_SQUID_PROMPT_SCAN_BOUND: '15' });
    const boundedLine = lastVoice();
    rmSync(VOICE_LOG, { force: true });
    const unbounded = runHook({ PD_SQUID_PROMPT_SCAN_BOUND: '5000' });
    const unboundedLine = lastVoice();

    // Same emitted context, same held counts, same "bytes we wanted" figure —
    // the bound changed how much shell ran, and nothing an operator can observe.
    expect(bounded.stdout).toBe(unbounded.stdout);
    expect(boundedLine.counts).toEqual(unboundedLine.counts);
    expect(boundedLine.bytes).toBe(unboundedLine.bytes);
    expect(boundedLine.droppedClasses).toEqual(unboundedLine.droppedClasses);
    expect(boundedLine.emittedBytes).toBe(unboundedLine.emittedBytes);
  });

  /**
   * What the bound DOES cost, stated out loud.
   *
   * Reach. A relevant entry sitting past `SCAN_BOUND` positions within its own
   * class is not seen this turn. That is the deliberate trade — it is why the
   * default (128) is ~10x the 12-entry emission budget — and it degrades exactly
   * the way the hook's header demands: the operator still gets a `suppressed`
   * receipt naming the class and the honest held count, so the harness went
   * quieter, not blind. Pinning it here keeps the trade a decision rather than a
   * surprise for whoever tunes the default next.
   */
  test('a too-small bound loses REACH but never loses the receipt', () => {
    const ts = isoNow();
    const kv: Record<string, string> = {};
    // 20 traces from a neighbouring project, then the one that matters. The
    // wrong-project entries sort first, so a 10-line bound cannot reach it.
    for (let i = 0; i < 20; i++) {
      kv[`PD_PHEROMONE_AAA_${i}`] = `${WORKSPACE}-other/src/x-${i}.ts | elsewhere | ts:${ts}`;
    }
    kv.PD_PHEROMONE_ZZZ = `${WORKSPACE}/src/REAL.ts | the one that matters | ts:${ts}`;
    seedMatrix(kv);

    const short = runHook({ PD_SQUID_PROMPT_SCAN_BOUND: '10' });
    expect(short.stdout).not.toContain('the one that matters');
    const shortLine = lastVoice();
    expect(shortLine.counts).toEqual({ PHEROMONE: 21 }); // still the honest total
    expect(shortLine.outcome).toBe('suppressed');

    rmSync(VOICE_LOG, { force: true });
    const full = runHook({ PD_SQUID_PROMPT_SCAN_BOUND: '128' }); // the default
    expect(full.stdout).toContain('the one that matters');
    expect(lastVoice().counts).toEqual({ PHEROMONE: 21 });
  });
});

describe('pd-hook-prompt — freshness without a process per line', () => {
  /**
   * The speed came from replacing a per-line `sed`+`date` pair with parameter
   * expansion against pre-rendered cut-offs. These pin the three timestamp
   * verdicts that rewrite had to preserve exactly, because each one is a
   * different production behaviour and they are easy to collapse into each other.
   */
  test('an UNSTAMPED legacy entry stays visible', () => {
    seedMatrix({ PD_ALERT_LEGACY: 'STEERING: written before stamps existed' });
    expect(runHook().stdout).toContain('written before stamps existed');
    expect(lastVoice().outcome).toBe('spoke');
  });

  test('a STAMPED but unparseable entry is treated as stale, not as legacy', () => {
    seedMatrix({ PD_ALERT_CORRUPT: 'STEERING: broken stamp | ts:not-a-date' });
    runHook(); // burn the nag so the directive cannot mask the silence
    rmSync(VOICE_LOG, { force: true });
    const r = runHook();
    expect(r.stdout).toBe('');
    const line = lastVoice();
    expect(line.outcome).toBe('suppressed');
    expect(line.reason).toBe('ttl-expired');
  });

  test('a FUTURE-stamped entry is rejected the same way an expired one is', () => {
    seedMatrix({
      PD_ALERT_FUTURE: `STEERING: from the future | ts:${new Date(Date.now() + 9_000_000).toISOString()}`,
    });
    runHook();
    rmSync(VOICE_LOG, { force: true });
    const r = runHook();
    expect(r.stdout).toBe('');
    expect(lastVoice().reason).toBe('ttl-expired');
  });

  test('a fractional-second stamp inside the TTL is fresh', () => {
    seedMatrix({ PD_ALERT_MS: `STEERING: sub-second precision | ts:${new Date().toISOString()}` });
    expect(runHook().stdout).toContain('sub-second precision');
    expect(lastVoice().outcome).toBe('spoke');
  });
});
