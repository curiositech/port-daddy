/**
 * Reconcile Loop — error paths that used to destroy coordination state.
 * =====================================================================
 *
 * Two HIGH regressions live here, both in the loop's *failure* handling rather
 * than its happy path, and both invisible to the existing suites because those
 * only ever hand the loop sources that work.
 *
 * **BUG A — one unreadable matrix wiped every other writer's keys.**
 * `readMatrix` collapsed "I could not read this file" into "this file is empty"
 * (a blanket `catch { return {} }`). The tick spread that `{}` into `next` and
 * then rewrote the WHOLE file, so a single transient EACCES/EIO/EMFILE made the
 * empty read authoritative — deleting `PD_LOCK_*` (what `bin/pd-hook-pre-tool`
 * reads to stop two agents editing the same file), foreign `PD_ALERT_*`, and
 * every pheromone. The deletions bypassed the counted GC path entirely, so the
 * tick reported `ok: true, keysDeleted: 0` and logged nothing.
 *
 * **BUG B — a malformed (non-throwing) source froze the heartbeat fleet-wide.**
 * `readSource` guarded only `throw`; a source returning `undefined` or a wrong
 * shape sailed through and blew up in the `.map` that followed, inside the single
 * whole-tick `try`. Result: `ok:false`, `degradedClasses: []` (the field whose
 * whole job is naming what broke named nothing), and NOTHING written — including
 * `PD_RECON_HEARTBEAT_TS`. After 60s of frozen heartbeat `isMatrixStale` goes
 * true for every agent on the machine and the harness goes silent — HALT
 * included. A malformed source thus silently disabled the emergency stop.
 *
 * Everything below runs against a REAL matrix file in an isolated scratch root.
 *
 * **How the unreadable matrix is produced, and why not `chmod 000`.** The
 * destructive asymmetry Bug A needs is a path whose *read* fails while the
 * atomic write-tmp-then-rename beside it still succeeds — in the field that is
 * `EACCES` on a mode-000 file inside a writable directory (verified by hand
 * against this branch: one tick wiped `PD_LOCK_SRC_AUTH_TS`,
 * `PD_ALERT_LEGACY_OPERATOR` and a pheromone while reporting
 * `ok:true, keysDeleted:0`). A test cannot rely on that, because root bypasses
 * DAC entirely and the regression would silently stop reproducing under a root
 * runner. A symlink loop gives the identical asymmetry — `readFileSync` fails
 * with `ELOOP`, `renameSync` replaces the link — for every uid on every POSIX
 * platform, and it exercises the exact branch, which keys on "the errno is not
 * `ENOENT`" rather than on any particular errno.
 */
import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { parseMatrix, readMatrix, setKey, tryReadMatrix } from '../../lib/squid/matrix.js';
import {
  PD_ALERT_FLEET_APPROVALS_KEY,
  PD_HALT_KEY,
  PD_RECON_HEARTBEAT_TS_KEY,
  claimKey,
  inboxKey,
  parleyKey,
} from '../../lib/squid/reconcile-contract.js';
import { createReconcileLoop, type ReconcileDeps } from '../../lib/squid/reconcile.js';

// Isolated scratch under ~/coding/tmp — NEVER /tmp (macOS purges it) and NEVER
// the operator's real ~/.port-daddy.
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-reconcile-errorpaths', `jest-${process.pid}`);
const MATRIX = join(SCRATCH, 'matrix.env');

const savedEnv = {
  PD_MATRIX_FILE: process.env.PD_MATRIX_FILE,
  PD_HOME: process.env.PD_HOME,
};

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.PD_HOME = SCRATCH;
  process.env.PD_MATRIX_FILE = MATRIX;
});

afterEach(() => {
  if (savedEnv.PD_MATRIX_FILE === undefined) delete process.env.PD_MATRIX_FILE;
  else process.env.PD_MATRIX_FILE = savedEnv.PD_MATRIX_FILE;
  if (savedEnv.PD_HOME === undefined) delete process.env.PD_HOME;
  else process.env.PD_HOME = savedEnv.PD_HOME;
  rmSync(SCRATCH, { recursive: true, force: true });
});

const T0 = 1_800_000_000_000;

/**
 * Replace the matrix path with a symlink loop, making it exist but be unopenable.
 *
 * **Purpose.** This is the test's stand-in for the field's `EACCES`/`EIO`/
 * `EMFILE`: `readFileSync` fails with `ELOOP` while the directory around it
 * stays fully writable, so the loop's `writeFileSync`+`renameSync` would still
 * succeed — which is exactly the asymmetry that made Bug A destroy state
 * instead of merely degrading. The design intent of choosing a symlink loop
 * over `chmod 000` is uid independence: root bypasses permission bits, so a
 * mode-000 fixture makes the regression untestable on a root CI runner, while
 * `ELOOP` is enforced by the kernel's path resolver for everyone.
 *
 * @returns Nothing; leaves an unreadable path at {@link MATRIX}.
 */
function makeMatrixUnreadable(): void {
  rmSync(MATRIX, { force: true });
  const other = join(SCRATCH, 'matrix.loop');
  rmSync(other, { force: true });
  symlinkSync(other, MATRIX);
  symlinkSync(MATRIX, other);
}

/** Read the scratch matrix as a key→value map, bypassing the module under test. */
function rawKv(): Record<string, string> {
  return parseMatrix(readFileSync(MATRIX, 'utf8'));
}

/**
 * Seed the matrix with keys written by OTHER writers than the reconcile loop.
 *
 * Design intent: every key here belongs to a class the loop does not own, so any
 * disappearance is unambiguously the whole-file rewrite destroying a neighbour's
 * state rather than the loop legitimately collecting its own projection.
 *
 * @returns Nothing; writes the file directly.
 */
function seedForeignKeys(): void {
  writeFileSync(
    MATRIX,
    [
      '# seeded',
      'PD_LOCK_SRC_AUTH_TS="port-daddy:contrib:alpha"',
      'PD_ALERT_LEGACY_OPERATOR="operator: do not touch the release branch"',
      `PD_PHEROMONE_SRC_AUTH_TS_${T0}="src/auth.ts | uses deprecated v1_hook | intensity:3 | ts:${new Date(T0).toISOString()}"`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
}

// ─── BUG A — never rewrite a matrix you could not read ────────────────────────

describe('BUG A: an unreadable matrix must never be treated as an empty one', () => {
  test('tryReadMatrix distinguishes absent from present from unreadable', () => {
    expect(tryReadMatrix().state).toBe('absent');
    expect(readMatrix()).toEqual({});

    seedForeignKeys();
    const present = tryReadMatrix();
    expect(present.state).toBe('present');
    expect(present.kv.PD_LOCK_SRC_AUTH_TS).toBe('port-daddy:contrib:alpha');

    makeMatrixUnreadable();
    const unreadable = tryReadMatrix();
    expect(unreadable.state).toBe('unreadable');
    expect(unreadable.kv).toEqual({});
    expect(unreadable.error?.code).toBeDefined();
    // Backward compatibility for read-only consumers: still `{}`, no throw.
    expect(readMatrix()).toEqual({});
  });

  test('a tick over an unreadable matrix does not rewrite the file it could not read', () => {
    makeMatrixUnreadable();

    const loop = createReconcileLoop({
      now: () => T0,
      panic: () => ({ armed: true, reason: 'drill' }),
      claims: () => [{ path: 'src/auth.ts', holders: ['alpha', 'beta'] }],
    });

    const report = loop.tick();

    // 1. The path is untouched. Before the fix the tick renamed its own
    //    projection over it, making an empty read authoritative — which in the
    //    field means every PD_LOCK_*/PD_ALERT_*/pheromone key is gone.
    expect(lstatSync(MATRIX).isSymbolicLink()).toBe(true);

    // 2. The tick said so out loud instead of reporting a clean success.
    expect(report.ok).toBe(false);
    expect(report.matrixUnreadable).toBe(true);
    expect(String(report.error)).toMatch(/unreadable/i);
    expect(report.keysWritten).toBe(0);
    expect(report.keysDeleted).toBe(0);
    expect(report.counts).toEqual({});
  });

  test('the unreadable tick is logged at error, not silently swallowed', () => {
    makeMatrixUnreadable();
    const calls: Array<{ level: string; message: string }> = [];
    const loop = createReconcileLoop({
      now: () => T0,
      logger: {
        debug: (message: string) => { calls.push({ level: 'debug', message }); },
        info: (message: string) => { calls.push({ level: 'info', message }); },
        warn: (message: string) => { calls.push({ level: 'warn', message }); },
        error: (message: string) => { calls.push({ level: 'error', message }); },
      },
    });

    loop.tick();

    expect(calls.some((c) => c.level === 'error' && c.message === 'reconcile_matrix_unreadable')).toBe(true);
  });

  test('setKey refuses to rewrite a matrix it could not read', () => {
    // Same whole-file-rewrite-from-an-unread-file defect, one layer down: every
    // matrix mutator serializes the complete map it just read.
    makeMatrixUnreadable();

    expect(() => setKey('PD_ALERT_NEW', 'hello')).toThrow(/unreadable/i);
    expect(lstatSync(MATRIX).isSymbolicLink()).toBe(true);
  });

  test('an ABSENT matrix is still legitimately empty (no regression on first boot)', () => {
    const loop = createReconcileLoop({ now: () => T0, panic: () => ({ armed: true, reason: 'drill' }) });
    const report = loop.tick();
    expect(report.ok).toBe(true);
    expect(report.matrixUnreadable).toBeFalsy();
    expect(rawKv()[PD_HALT_KEY]).toContain('drill');
    expect(rawKv()[PD_RECON_HEARTBEAT_TS_KEY]).toBe(String(T0));
  });
});

// ─── BUG B — a malformed source degrades ONE class, never the heartbeat ───────

/**
 * Every source, paired with the key its class projects when it is healthy.
 *
 * Purpose: the malformed-shape test must run once per source, and hand-writing
 * seven near-identical cases is how one of them ends up subtly not asserting
 * anything. The `probe` is a key that MUST appear when the source is healthy and
 * MUST NOT when it is degraded.
 */
const SOURCES: ReadonlyArray<{
  name: string;
  healthy: ReconcileDeps;
  probe: string;
  bad: readonly unknown[];
}> = [
  {
    name: 'FLEET_APPROVALS',
    healthy: { approvals: () => [{ agent: 'navigator', trigger: 'issue:412' }] },
    probe: PD_ALERT_FLEET_APPROVALS_KEY,
    bad: [undefined, null, {}, [{ agent: 'navigator' }], 'nope'],
  },
  {
    name: 'HALT',
    healthy: { panic: () => ({ armed: true, reason: 'drill' }) },
    probe: PD_HALT_KEY,
    bad: [{ armed: 'yes' }, [], 'armed'],
  },
  {
    name: 'CLAIM',
    healthy: { claims: () => [{ path: 'src/auth.ts', holders: ['alpha', 'beta'] }] },
    probe: claimKey('src/auth.ts'),
    bad: [undefined, null, [{ path: 'src/auth.ts' }], [{ path: 'x', holders: 'alpha' }]],
  },
  {
    name: 'INBOX',
    healthy: { inbox: () => [{ actor: 'alpha', msgId: 'm1', summary: 'ping' }] },
    probe: inboxKey('alpha', 'm1'),
    bad: [undefined, null, [{ actor: 'alpha' }], [null]],
  },
  {
    name: 'PARLEY',
    healthy: { parley: () => [{ actor: 'alpha', convId: 'c1', summary: 'reply?' }] },
    probe: parleyKey('alpha', 'c1'),
    bad: [undefined, null, [{ actor: 'alpha', convId: 'c1' }]],
  },
];

describe('BUG B: a malformed source degrades only its class and never freezes the heartbeat', () => {
  for (const src of SOURCES) {
    for (const [i, badValue] of src.bad.entries()) {
      test(`${src.name} returning ${JSON.stringify(badValue) ?? 'undefined'} (#${i}) degrades only ${src.name}`, () => {
        // A second, healthy class must keep working in the SAME tick — the
        // verified cascade was that one bad source lost a valid armed panic too.
        const healthyKey = src.name === 'HALT' ? claimKey('src/other.ts') : PD_HALT_KEY;
        const deps: ReconcileDeps = {
          now: () => T0,
          ...(src.name === 'HALT'
            ? { claims: () => [{ path: 'src/other.ts', holders: ['a', 'b'] }] }
            : { panic: () => ({ armed: true, reason: 'drill' }) }),
          // The malformed source under test, typed through `unknown` because the
          // whole point is a producer that lies about its contract at runtime.
          ...Object.fromEntries(
            Object.keys(src.healthy).map((k) => [k, () => badValue as never]),
          ),
        };

        const loop = createReconcileLoop(deps);
        const report = loop.tick();

        // 1. The class that broke is NAMED. Before the fix this array was empty.
        expect(report.degradedClasses).toContain(src.name);
        // 2. The heartbeat is stamped regardless. This is the fleet's liveness
        //    signal; freezing it silences every agent on the machine after 60s.
        expect(rawKv()[PD_RECON_HEARTBEAT_TS_KEY]).toBe(String(T0));
        // 3. The healthy class in the same tick still reached the matrix.
        expect(rawKv()[healthyKey]).toBeDefined();
        // 4. The degraded class projected nothing.
        expect(rawKv()[src.probe]).toBeUndefined();
      });
    }
  }

  test('a healthy source still projects (the guard is not just refusing everything)', () => {
    for (const src of SOURCES) {
      rmSync(MATRIX, { force: true });
      const loop = createReconcileLoop({ now: () => T0, ...src.healthy });
      const report = loop.tick();
      expect(report.degradedClasses).not.toContain(src.name);
      expect(rawKv()[src.probe]).toBeDefined();
    }
  });

  test('a persistently malformed source does not freeze the heartbeat across ticks', () => {
    let t = T0;
    const loop = createReconcileLoop({
      now: () => (t += 15_000),
      approvals: () => undefined as never,
      panic: () => ({ armed: true, reason: 'drill' }),
    });

    const stamps: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      loop.tick();
      stamps.push(rawKv()[PD_RECON_HEARTBEAT_TS_KEY]);
    }

    expect(new Set(stamps).size).toBe(5);
    expect(stamps.every((s) => Number.isFinite(Number(s)))).toBe(true);
    // The armed HALT survived every one of those ticks.
    expect(rawKv()[PD_HALT_KEY]).toContain('drill');
  });

  test('a malformed source does not delete the keys its class already had', () => {
    const good = createReconcileLoop({
      now: () => T0,
      claims: () => [{ path: 'src/auth.ts', holders: ['alpha', 'beta'] }],
    });
    good.tick();
    expect(rawKv()[claimKey('src/auth.ts')]).toBeDefined();

    const bad = createReconcileLoop({ now: () => T0 + 1_000, claims: () => undefined as never });
    const report = bad.tick();
    expect(report.degradedClasses).toContain('CLAIM');
    // Degraded means "not recomputed", which means "not judged". Deleting here
    // would turn one malformed producer into a fleet-wide coordination outage.
    expect(rawKv()[claimKey('src/auth.ts')]).toBeDefined();
  });
});

// ─── The contract nit: tick() never throws, not even on a bad clock ───────────

describe('tick() honours its never-throws contract', () => {
  test('an injected clock that throws does not escape tick() or start()', () => {
    const loop = createReconcileLoop({
      now: () => {
        throw new Error('clock exploded');
      },
    });

    let report!: ReturnType<typeof loop.tick>;
    expect(() => {
      report = loop.tick();
    }).not.toThrow();
    expect(report.ok).toBe(false);
    expect(String(report.error)).toMatch(/clock/i);

    expect(() => loop.start()).not.toThrow();
    loop.stop();
  });
});

// ─── Sanity: the happy path is untouched ──────────────────────────────────────

describe('the happy path still works', () => {
  test('a fully healthy tick projects, GCs and heartbeats as before', () => {
    let armed = true;
    const loop = createReconcileLoop({
      now: () => T0,
      panic: () => ({ armed, reason: 'drill' }),
      approvals: () => [{ agent: 'navigator', trigger: 'issue:412' }],
      claims: () => [{ path: 'src/auth.ts', holders: ['alpha', 'beta'] }],
      inbox: () => [{ actor: 'alpha', msgId: 'm1', summary: 'ping' }],
    });

    const first = loop.tick();
    expect(first.ok).toBe(true);
    expect(first.degradedClasses).toEqual(expect.arrayContaining(['CI', 'PARLEY', 'ACCOMPLISHMENT']));
    expect(readMatrix()[PD_HALT_KEY]).toContain('drill');

    armed = false;
    const second = loop.tick();
    expect(second.ok).toBe(true);
    expect(second.keysDeleted).toBeGreaterThanOrEqual(1);
    expect(readMatrix()[PD_HALT_KEY]).toBeUndefined();
    expect(readMatrix()[claimKey('src/auth.ts')]).toBeDefined();
  });
});
