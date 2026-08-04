/**
 * Tests for the Reconcile Loop (lib/squid/reconcile.ts).
 *
 * Everything here runs against a REAL matrix file in an isolated scratch root
 * (PD_HOME + PD_MATRIX_FILE), never `~/.port-daddy`. The loop's whole job is a
 * filesystem side effect — mocking the matrix away would test a mock.
 *
 * The load-bearing assertions, in the order the task cares about:
 *
 *   1. GC — a key a previous tick wrote is DELETED once its source stops
 *      reporting it, and the matrix does not grow monotonically across ticks.
 *      This is the reason the loop exists; without it `matrix.env` is a landfill.
 *   2. Per-actor addressing — a message for actor A never mints a key for B.
 *   3. The heartbeat advances every tick (that is what `isMatrixStale` reads).
 *   4. A throwing source degrades ONLY its class — and specifically does not
 *      cause its existing keys to be garbage-collected, which would turn one
 *      transient DB error into a fleet-wide coordination outage.
 *   5. The total byte budget drops the lowest-priority class FIRST.
 *   6. Per-class caps are enforced, global and per-actor.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import {
  matrixPath,
  parseMatrix,
  readMatrix,
  setKey,
} from '../../lib/squid/matrix.js';
import {
  PD_ALERT_FLEET_APPROVALS_KEY,
  PD_HALT_KEY,
  PD_RECON_HEARTBEAT_TS_KEY,
  RECONCILE_KEY_CLASSES,
  accomplishmentKey,
  actorKey,
  ciKey,
  claimKey,
  classifyReconcileKey,
  inboxKey,
  isMatrixStale,
  parleyKey,
  readHeartbeatTs,
} from '../../lib/squid/reconcile-contract.js';
import { createReconcileLoop } from '../../lib/squid/reconcile.js';
import type { LeveledSink } from '../../lib/observability/log-governor.js';

// Isolated scratch under ~/coding/tmp — NEVER /tmp (macOS purges it) and NEVER
// the operator's real ~/.port-daddy.
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-reconcile-selftest', `jest-${process.pid}`);
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

/** Read the scratch matrix as a key→value map. */
function kv(): Record<string, string> {
  return readMatrix();
}

/** Raw physical line count of the matrix file (banner included). */
function lineCount(): number {
  return readFileSync(MATRIX, 'utf8').split('\n').length;
}

/** Every key in the matrix that belongs to a projected reconcile class. */
function projectedKeys(): string[] {
  return Object.keys(kv()).filter((k) => {
    const cls = classifyReconcileKey(k);
    return cls !== undefined && cls !== 'HEARTBEAT';
  });
}

/** A recording LeveledSink so log discipline can be asserted, not assumed. */
function spySink(): LeveledSink & { calls: Array<{ level: string; message: string; meta?: unknown }> } {
  const calls: Array<{ level: string; message: string; meta?: unknown }> = [];
  return {
    calls,
    debug: (message: string, meta?: Record<string, unknown>) => { calls.push({ level: 'debug', message, meta }); },
    info: (message: string, meta?: Record<string, unknown>) => { calls.push({ level: 'info', message, meta }); },
    warn: (message: string, meta?: Record<string, unknown>) => { calls.push({ level: 'warn', message, meta }); },
    error: (message: string, meta?: Record<string, unknown>) => { calls.push({ level: 'error', message, meta }); },
  };
}

const T0 = 1_800_000_000_000;

/** A clock that starts at T0 and advances by `stepMs` on every read. */
function steppingClock(stepMs = 1_000): () => number {
  let t = T0 - stepMs;
  return () => {
    t += stepMs;
    return t;
  };
}

// ─── 1. Garbage collection — the reason this loop exists ─────────────────────

describe('reconcile — GC: the matrix stops being append-only', () => {
  test('a key from a previous tick is DELETED once its source stops reporting it', () => {
    let claims = [
      { path: '/repo/src/auth.ts', holders: ['sess_a', 'sess_b'] },
      { path: '/repo/src/db.ts', holders: ['sess_a', 'sess_c'] },
    ];
    const loop = createReconcileLoop({ claims: () => claims, now: steppingClock() });

    const first = loop.tick();
    expect(first.ok).toBe(true);
    expect(kv()[claimKey('/repo/src/auth.ts')]).toContain('sess_a, sess_b');
    expect(kv()[claimKey('/repo/src/db.ts')]).toBeDefined();

    // The overlap on db.ts resolves; the durable source stops reporting it.
    claims = [{ path: '/repo/src/auth.ts', holders: ['sess_a', 'sess_b'] }];
    const second = loop.tick();

    expect(second.keysDeleted).toBe(1);
    expect(kv()[claimKey('/repo/src/db.ts')]).toBeUndefined();
    expect(kv()[claimKey('/repo/src/auth.ts')]).toBeDefined();
  });

  test('matrix line count does NOT grow monotonically across ticks', () => {
    // A rolling window of claims: each tick has 3, but they are different paths.
    // Append-only behaviour would reach 21 keys by tick 7; GC holds it at 3.
    let round = 0;
    const loop = createReconcileLoop({
      claims: () =>
        [0, 1, 2].map((i) => ({ path: `/repo/gen${round}/file${i}.ts`, holders: ['a', 'b'] })),
      now: steppingClock(),
    });

    const lines: number[] = [];
    const keys: number[] = [];
    for (round = 0; round < 7; round += 1) {
      loop.tick();
      lines.push(lineCount());
      keys.push(projectedKeys().length);
    }

    expect(keys).toEqual([3, 3, 3, 3, 3, 3, 3]);
    // Every tick after the first has the same physical size: no growth at all.
    expect(new Set(lines.slice(1)).size).toBe(1);
    expect(Math.max(...lines)).toBe(lines[0]);
  });

  test('emptying a source removes the whole class, including the singleton alert', () => {
    let pending = [{ agent: 'dupe_04', trigger: 'nightly-sweep' }];
    const loop = createReconcileLoop({ approvals: () => pending, now: steppingClock() });

    loop.tick();
    expect(kv()[PD_ALERT_FLEET_APPROVALS_KEY]).toContain('1 spawn approval(s) waiting');
    expect(kv()[PD_ALERT_FLEET_APPROVALS_KEY]).toContain('dupe_04 ← nightly-sweep');

    pending = [];
    const report = loop.tick();
    expect(kv()[PD_ALERT_FLEET_APPROVALS_KEY]).toBeUndefined();
    expect(report.keysDeleted).toBe(1);
  });

  test('a class with NO source is left alone — never projected, never collected', () => {
    // Migration safety: while lib/fleet-daemon.ts still owns the approvals key,
    // a loop wired without an `approvals` dep must not delete it out from under it.
    setKey(PD_ALERT_FLEET_APPROVALS_KEY, 'HITL: 2 spawn approval(s) waiting — legacy writer');
    const loop = createReconcileLoop({ claims: () => [], now: steppingClock() });

    const report = loop.tick();

    expect(report.degradedClasses).toContain('FLEET_APPROVALS');
    expect(kv()[PD_ALERT_FLEET_APPROVALS_KEY]).toContain('legacy writer');
  });

  test('GC only touches the class it recomputed — foreign prefixes survive', () => {
    setKey('PD_LOCK_REPO_SRC_AUTH_TS', 'agent_alpha');
    setKey('PD_ALERT_STEER_1', 'STEERING: rebase first | ts:2026-08-04T12:00:00.000Z');
    const loop = createReconcileLoop({ claims: () => [], now: steppingClock() });

    loop.tick();

    expect(kv()['PD_LOCK_REPO_SRC_AUTH_TS']).toBe('agent_alpha');
    // An unrelated PD_ALERT_* is NOT the FLEET_APPROVALS singleton and must survive.
    expect(kv()['PD_ALERT_STEER_1']).toContain('rebase first');
  });
});

// ─── 2. Per-actor addressing ─────────────────────────────────────────────────

describe('reconcile — per-actor addressing', () => {
  test("actor A's inbox key is present and actor B's is not", () => {
    const loop = createReconcileLoop({
      inbox: () => [
        { actor: 'port-daddy:contrib:alpha', msgId: 'm-1', summary: 'rebase before you push', from: 'navigator' },
      ],
      now: steppingClock(),
    });

    loop.tick();

    const present = inboxKey('port-daddy:contrib:alpha', 'm-1');
    expect(kv()[present]).toContain('rebase before you push');
    expect(kv()[present]).toContain('from navigator');

    // Nothing addressed to beta exists at all.
    const betaPrefix = `PD_INBOX_${actorKey('port-daddy:contrib:beta')}_`;
    expect(Object.keys(kv()).filter((k) => k.startsWith(betaPrefix))).toEqual([]);
    expect(kv()[inboxKey('port-daddy:contrib:beta', 'm-1')]).toBeUndefined();
  });

  test('two actors get disjoint key spaces from one source list', () => {
    const loop = createReconcileLoop({
      inbox: () => [
        { actor: 'alpha', msgId: 'm-1', summary: 'for alpha' },
        { actor: 'beta', msgId: 'm-2', summary: 'for beta' },
      ],
      now: steppingClock(),
    });

    loop.tick();

    expect(kv()[inboxKey('alpha', 'm-1')]).toContain('for alpha');
    expect(kv()[inboxKey('beta', 'm-2')]).toContain('for beta');
    expect(kv()[inboxKey('alpha', 'm-2')]).toBeUndefined();
    expect(kv()[inboxKey('beta', 'm-1')]).toBeUndefined();
  });

  test('parley keys are per-actor and re-summoning a conversation overwrites', () => {
    let summary = 'first ask';
    const loop = createReconcileLoop({
      parley: () => [{ actor: 'alpha', convId: 'conv-9', summary, ts: T0 }],
      now: steppingClock(),
    });

    loop.tick();
    const key = parleyKey('alpha', 'conv-9');
    expect(kv()[key]).toContain('first ask');

    summary = 'second ask';
    loop.tick();

    expect(kv()[key]).toContain('second ask');
    // Overwrite, never accumulate: still exactly one parley key.
    expect(Object.keys(kv()).filter((k) => k.startsWith('PD_PARLEY_'))).toHaveLength(1);
  });
});

// ─── 3. Heartbeat ────────────────────────────────────────────────────────────

describe('reconcile — heartbeat', () => {
  test('PD_RECON_HEARTBEAT_TS is written and advances every tick', () => {
    const loop = createReconcileLoop({ now: steppingClock(5_000) });

    loop.tick();
    const first = readHeartbeatTs(kv());
    loop.tick();
    const second = readHeartbeatTs(kv());
    loop.tick();
    const third = readHeartbeatTs(kv());

    expect(first).toBe(T0);
    expect(second).toBe(T0 + 5_000);
    expect(third).toBe(T0 + 10_000);
    expect(kv()[PD_RECON_HEARTBEAT_TS_KEY]).toBe(String(T0 + 10_000));
  });

  test('a loop with zero wired sources still heartbeats — freshness is not a source', () => {
    const loop = createReconcileLoop({ now: () => T0 });

    const report = loop.tick();

    expect(report.ok).toBe(true);
    expect(report.degradedClasses).toHaveLength(7); // every class except HEARTBEAT
    expect(isMatrixStale(readHeartbeatTs(kv()), T0)).toBe(false);
  });

  test('the heartbeat survives GC — HEARTBEAT is the one class never collected', () => {
    const loop = createReconcileLoop({ claims: () => [], now: steppingClock() });
    loop.tick();
    loop.tick();
    expect(kv()[PD_RECON_HEARTBEAT_TS_KEY]).toBeDefined();
    expect(RECONCILE_KEY_CLASSES.HEARTBEAT.gc).toBe('never');
  });
});

// ─── 4. Degradation ──────────────────────────────────────────────────────────

describe('reconcile — a throwing source degrades only its class', () => {
  test('the failing class keeps its old keys; every other class still reconciles', () => {
    let claimsBroken = false;
    const sink = spySink();
    const loop = createReconcileLoop({
      claims: () => {
        if (claimsBroken) throw new Error('SQLITE_BUSY: database is locked');
        return [{ path: '/repo/src/auth.ts', holders: ['a', 'b'] }];
      },
      inbox: () => [{ actor: 'alpha', msgId: 'm-1', summary: 'still delivered' }],
      now: steppingClock(),
      logger: sink,
    });

    loop.tick();
    expect(kv()[claimKey('/repo/src/auth.ts')]).toBeDefined();

    claimsBroken = true;
    const report = loop.tick();

    // Did not throw, and the tick still succeeded.
    expect(report.ok).toBe(true);
    expect(report.degradedClasses).toContain('CLAIM');
    // INBOX answered, so it is NOT degraded — the failure did not spread.
    expect(report.degradedClasses).not.toContain('INBOX');
    // The claim key is NOT collected: a failed read is not an empty read.
    expect(kv()[claimKey('/repo/src/auth.ts')]).toBeDefined();
    // Unrelated classes are unaffected.
    expect(kv()[inboxKey('alpha', 'm-1')]).toContain('still delivered');
    expect(readHeartbeatTs(kv())).toBe(T0 + 1_000);
    // And it was reported once, at warn, with the class in meta not in the key.
    const warns = sink.calls.filter((c) => c.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toBe('reconcile_source_failed');
    expect(warns[0].meta).toMatchObject({ class: 'CLAIM' });
  });

  test('every source can throw at once and tick() still returns a report', () => {
    const boom = () => { throw new Error('nope'); };
    const sink = spySink();
    const loop = createReconcileLoop({
      approvals: boom,
      panic: boom,
      inbox: boom,
      claims: boom,
      ci: boom,
      parley: boom,
      accomplishments: boom,
      now: steppingClock(),
      logger: sink,
    });

    const report = loop.tick();

    expect(report.ok).toBe(true);
    expect(report.degradedClasses.sort()).toEqual(
      ['ACCOMPLISHMENT', 'CI', 'CLAIM', 'FLEET_APPROVALS', 'HALT', 'INBOX', 'PARLEY'].sort(),
    );
    expect(readHeartbeatTs(kv())).toBe(T0);
    // Seven DISTINCT governor keys → seven warns (one per class), not one storm.
    expect(sink.calls.filter((c) => c.level === 'warn')).toHaveLength(7);
  });

  test('a source failing every tick is logged ONCE per window, not once per tick', () => {
    // The cardinal anti-pattern from skills/responsible-logging: an error inside
    // an unthrottled loop. The governor must collapse it.
    const sink = spySink();
    const loop = createReconcileLoop({
      claims: () => { throw new Error('SQLITE_BUSY'); },
      now: steppingClock(1_000), // 8 ticks span 8s — well inside the 60s window
      logger: sink,
    });

    for (let i = 0; i < 8; i += 1) loop.tick();

    expect(sink.calls.filter((c) => c.level === 'warn')).toHaveLength(1);

    // …and the suppressed tail is never silently lost: stop() flushes a rollup.
    loop.stop();
    const rollups = sink.calls.filter(
      (c) => c.level === 'warn' && (c.meta as Record<string, unknown>)?.log_rollup === true,
    );
    expect(rollups).toHaveLength(1);
    expect((rollups[0].meta as Record<string, unknown>).suppressed).toBe(7);
  });

  test('a throwing pheromone sink cannot break the tick', () => {
    setKey('PD_PHEROMONE_SRC_AUTH_TS_1799999990000', `/repo/src/auth.ts | deprecated v1_hook | intensity:3 | ts:${new Date(T0 - 10_000).toISOString()}`);
    const sink = spySink();
    const loop = createReconcileLoop({
      pheromones: () => { throw new Error('durable store offline'); },
      now: () => T0,
      logger: sink,
    });

    const report = loop.tick();

    expect(report.ok).toBe(true);
    expect(report.pheromonesKept).toBe(1);
    expect(sink.calls.some((c) => c.message === 'reconcile_pheromone_sink_failed')).toBe(true);
  });
});

// ─── 5. Budget + truncation priority ─────────────────────────────────────────

describe('reconcile — the total byte budget drops the lowest-priority class first', () => {
  test('ACCOMPLISHMENT is sacrificed before CLAIM when the projection is over budget', () => {
    // Sized so the four CLAIM lines alone fit the 4096-byte budget (~4044) while
    // the two ACCOMPLISHMENT lines push the total over it.
    const fat = 'x'.repeat(940);
    const sink = spySink();
    const loop = createReconcileLoop({
      claims: () => [0, 1, 2, 3].map((i) => ({ path: `/repo/f${i}.ts`, holders: [fat] })),
      accomplishments: () => [
        { id: 'acc-1', summary: 'shipped the relay' },
        { id: 'acc-2', summary: 'shipped the tube' },
      ],
      now: () => T0,
      logger: sink,
    });

    const report = loop.tick();

    expect(report.suppressionReason).toBe('over-budget');
    expect(report.droppedClasses).toEqual(['ACCOMPLISHMENT']);
    // Held two accomplishments, projected zero.
    expect(report.held.ACCOMPLISHMENT).toBe(2);
    expect(report.counts.ACCOMPLISHMENT).toBe(0);
    expect(report.counts.CLAIM).toBe(4);
    expect(report.bytes).toBeLessThanOrEqual(4096);

    expect(kv()[accomplishmentKey('acc-1')]).toBeUndefined();
    expect(kv()[accomplishmentKey('acc-2')]).toBeUndefined();
    expect(kv()[claimKey('/repo/f0.ts')]).toBeDefined();

    // Audible, per the contract: suppression is logged under a stable key.
    const warns = sink.calls.filter((c) => c.message === 'reconcile_projection_suppressed');
    expect(warns).toHaveLength(1);
    expect(warns[0].meta).toMatchObject({ reason: 'over-budget', dropped_classes: ['ACCOMPLISHMENT'] });
  });

  test('HALT outranks everything — it survives a projection that drops five classes', () => {
    const fat = 'y'.repeat(900);
    const loop = createReconcileLoop({
      panic: () => ({ armed: true, reason: 'operator pulled the cord' }),
      approvals: () => [{ agent: fat, trigger: 'x' }],
      claims: () => [0, 1, 2, 3].map((i) => ({ path: `/repo/f${i}.ts`, holders: [fat] })),
      ci: () => ({ branch: 'main', summary: fat }),
      inbox: () => [{ actor: 'alpha', msgId: 'm-1', summary: fat }],
      accomplishments: () => [{ id: 'acc-1', summary: fat }],
      now: () => T0,
    });

    const report = loop.tick();

    expect(kv()[PD_HALT_KEY]).toContain('operator pulled the cord');
    expect(report.counts.HALT).toBe(1);
    expect(report.droppedClasses.length).toBeGreaterThanOrEqual(4);
    // Drop order is strictly lowest-priority-first.
    expect(report.droppedClasses[0]).toBe('ACCOMPLISHMENT');
    expect(report.droppedClasses[1]).toBe('INBOX');
    expect(report.droppedClasses).not.toContain('HALT');
    expect(report.bytes).toBeLessThanOrEqual(4096);
  });

  test('a fully-loaded fleet (14 capped entries) is cut to the 12-entry turn budget', () => {
    // The registry's caps sum to 14 by design; the TURN cap is 12. The projector
    // must make that cut itself, in drop order, instead of letting the shell's
    // `break` truncate silently.
    const loop = createReconcileLoop({
      panic: () => ({ armed: true, reason: 'stop' }),
      parley: () => [
        { actor: 'alpha', convId: 'c1', summary: 'p1', ts: T0 },
        { actor: 'alpha', convId: 'c2', summary: 'p2', ts: T0 },
      ],
      approvals: () => [{ agent: 'a', trigger: 't' }],
      claims: () => [0, 1, 2, 3].map((i) => ({ path: `/f${i}`, holders: ['a', 'b'], ts: T0 })),
      ci: () => ({ branch: 'main', summary: 'red', ts: T0 }),
      inbox: () => [
        { actor: 'alpha', msgId: 'm1', summary: 'i1', ts: T0 },
        { actor: 'alpha', msgId: 'm2', summary: 'i2', ts: T0 },
        { actor: 'alpha', msgId: 'm3', summary: 'i3', ts: T0 },
      ],
      accomplishments: () => [
        { id: 'a1', summary: 'done1', ts: T0 },
        { id: 'a2', summary: 'done2', ts: T0 },
      ],
      now: () => T0,
    });

    const report = loop.tick();

    const heldTotal = Object.values(report.held).reduce((a, b) => a + b, 0);
    expect(heldTotal).toBe(14);
    expect(report.suppressionReason).toBe('over-entry-cap');
    expect(report.droppedClasses).toEqual(['ACCOMPLISHMENT']);
    expect(projectedKeys()).toHaveLength(12);
    expect(report.bytes).toBeLessThanOrEqual(4096);
  });

  test('a projection inside both bounds drops nothing and reports no suppression', () => {
    const loop = createReconcileLoop({
      claims: () => [{ path: '/repo/a.ts', holders: ['x', 'y'] }],
      accomplishments: () => [{ id: 'acc-1', summary: 'merged #412' }],
      now: () => T0,
    });

    const report = loop.tick();

    expect(report.droppedClasses).toEqual([]);
    expect(report.suppressionReason).toBeUndefined();
    expect(kv()[accomplishmentKey('acc-1')]).toContain('merged #412');
  });
});

// ─── 6. Caps ─────────────────────────────────────────────────────────────────

describe('reconcile — per-class caps are enforced', () => {
  test('INBOX keeps the 3 newest per actor and DELETES the rest (cap-evict-oldest)', () => {
    const loop = createReconcileLoop({
      inbox: () =>
        [1, 2, 3, 4, 5].map((i) => ({
          actor: 'alpha',
          msgId: `m-${i}`,
          summary: `msg ${i}`,
          ts: T0 - (6 - i) * 1_000, // m-5 newest
        })),
      now: () => T0,
    });

    const report = loop.tick();

    expect(report.counts.INBOX).toBe(3);
    expect(kv()[inboxKey('alpha', 'm-5')]).toBeDefined();
    expect(kv()[inboxKey('alpha', 'm-4')]).toBeDefined();
    expect(kv()[inboxKey('alpha', 'm-3')]).toBeDefined();
    expect(kv()[inboxKey('alpha', 'm-2')]).toBeUndefined();
    expect(kv()[inboxKey('alpha', 'm-1')]).toBeUndefined();
  });

  test('the INBOX cap is PER ACTOR, not global — three each for two actors', () => {
    const loop = createReconcileLoop({
      inbox: () =>
        ['alpha', 'beta'].flatMap((actor) =>
          [1, 2, 3, 4].map((i) => ({ actor, msgId: `m-${i}`, summary: 's', ts: T0 - (5 - i) * 1_000 })),
        ),
      now: () => T0,
      maxEntries: 99, // isolate the per-class cap from the turn cap
    });

    const report = loop.tick();

    expect(report.counts.INBOX).toBe(6);
    for (const actor of ['alpha', 'beta']) {
      const mine = Object.keys(kv()).filter((k) => k.startsWith(`PD_INBOX_${actorKey(actor)}_`));
      expect(mine).toHaveLength(3);
      expect(kv()[inboxKey(actor, 'm-1')]).toBeUndefined();
    }
  });

  test('CLAIM is capped at 4 globally and CI at 1', () => {
    const loop = createReconcileLoop({
      claims: () => [1, 2, 3, 4, 5, 6].map((i) => ({ path: `/repo/f${i}.ts`, holders: ['a'], ts: T0 - (7 - i) * 1_000 })),
      now: () => T0,
      maxEntries: 99,
    });

    const report = loop.tick();

    expect(report.counts.CLAIM).toBe(4);
    expect(Object.keys(kv()).filter((k) => k.startsWith('PD_CLAIM_'))).toHaveLength(4);
    expect(kv()[claimKey('/repo/f6.ts')]).toBeDefined(); // newest survives
    expect(kv()[claimKey('/repo/f1.ts')]).toBeUndefined(); // oldest evicted
    expect(RECONCILE_KEY_CLASSES.CI.entryCap).toBe(1);
  });

  test('PARLEY drops summonses past its TTL before the cap is even considered', () => {
    const loop = createReconcileLoop({
      parley: () => [
        { actor: 'alpha', convId: 'fresh', summary: 'answer me', ts: T0 - 60_000 },
        { actor: 'alpha', convId: 'ancient', summary: 'answer me', ts: T0 - 3_600_000 },
      ],
      now: () => T0,
    });

    const report = loop.tick();

    expect(report.counts.PARLEY).toBe(1);
    expect(kv()[parleyKey('alpha', 'fresh')]).toBeDefined();
    expect(kv()[parleyKey('alpha', 'ancient')]).toBeUndefined();
  });

  test('ACCOMPLISHMENT drops entries past its 15-minute TTL', () => {
    const loop = createReconcileLoop({
      accomplishments: () => [
        { id: 'recent', summary: 'merged #1', ts: T0 - 60_000 },
        { id: 'stale', summary: 'merged #0', ts: T0 - 1_800_000 },
      ],
      now: () => T0,
    });

    loop.tick();

    expect(kv()[accomplishmentKey('recent')]).toBeDefined();
    expect(kv()[accomplishmentKey('stale')]).toBeUndefined();
  });
});

// ─── 7. Pheromone duty (decay → top-N → GC) ──────────────────────────────────

describe('reconcile — pheromone decay and garbage collection', () => {
  /** Seed a shell-style pheromone append at a chosen age. */
  function seedPheromone(id: string, ageMs: number, intensity = 4): string {
    const ts = T0 - ageMs;
    const key = `PD_PHEROMONE_${id}_${ts}`;
    setKey(key, `/repo/src/${id}.ts | note ${id} | intensity:${intensity} | actor:alpha | ts:${new Date(ts).toISOString()}`);
    return key;
  }

  test('only the top-N freshest survive; the rest are deleted from the matrix', () => {
    const keys = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => seedPheromone(`p${i}`, i * 1_000));
    const loop = createReconcileLoop({ now: () => T0, pheromoneTopN: 6 });

    const report = loop.tick();

    expect(report.pheromonesKept).toBe(6);
    expect(report.pheromonesFaded).toBe(2);
    const live = Object.keys(kv()).filter((k) => k.startsWith('PD_PHEROMONE_'));
    expect(live).toHaveLength(6);
    // The two oldest lost the cut.
    expect(live).not.toContain(keys[7]);
    expect(live).not.toContain(keys[6]);
    expect(live).toContain(keys[0]);
  });

  test('intensity decays with age and is rewritten into the value', () => {
    const key = seedPheromone('aged', 600_000, 4); // exactly one half-life
    const loop = createReconcileLoop({ now: () => T0, pheromoneHalfLifeMs: 600_000 });

    loop.tick();

    expect(kv()[key]).toContain('intensity:2');
    // The subject must stay first — bin/pd-hook-prompt slices on the first ' | '.
    expect(kv()[key].startsWith('/repo/src/aged.ts | ')).toBe(true);
    expect(kv()[key]).toContain('actor:alpha');
  });

  test('a trace past the pheromone TTL is deleted outright, however intense', () => {
    const old = seedPheromone('ancient', 3_600_000, 1000);
    const fresh = seedPheromone('fresh', 1_000, 1);
    const loop = createReconcileLoop({ now: () => T0, pheromoneTtlMs: 1_800_000 });

    const report = loop.tick();

    expect(kv()[old]).toBeUndefined();
    expect(kv()[fresh]).toBeDefined();
    expect(report.pheromonesFaded).toBe(1);
  });

  test('a trace whose intensity has decayed below the fade floor is deleted', () => {
    const key = seedPheromone('faint', 400_000, 1);
    const loop = createReconcileLoop({ now: () => T0, pheromoneHalfLifeMs: 60_000 });

    loop.tick();

    expect(kv()[key]).toBeUndefined();
  });

  test('the durable sink sees every trace the tick handled, retained and faded', () => {
    seedPheromone('keep', 1_000);
    seedPheromone('drop', 3_600_000);
    const seen: Array<{ subject: string; retained: boolean }> = [];
    const loop = createReconcileLoop({
      now: () => T0,
      pheromones: (drained) => { for (const d of drained) seen.push({ subject: d.subject, retained: d.retained }); },
    });

    loop.tick();

    expect(seen).toEqual(
      expect.arrayContaining([
        { subject: '/repo/src/keep.ts', retained: true },
        { subject: '/repo/src/drop.ts', retained: false },
      ]),
    );
  });

  test('pheromone GC does not disturb reconciled classes in the same tick', () => {
    seedPheromone('p1', 1_000);
    const loop = createReconcileLoop({
      claims: () => [{ path: '/repo/src/auth.ts', holders: ['a', 'b'] }],
      now: () => T0,
    });

    loop.tick();

    expect(kv()[claimKey('/repo/src/auth.ts')]).toBeDefined();
    expect(Object.keys(kv()).filter((k) => k.startsWith('PD_PHEROMONE_'))).toHaveLength(1);
  });
});

// ─── 8. Atomicity + lifecycle ────────────────────────────────────────────────

describe('reconcile — one lock per tick, and the tick never throws', () => {
  test('a tick is all-or-nothing: a held matrix lock leaves the file untouched', () => {
    const loop = createReconcileLoop({
      claims: () => [0, 1, 2, 3].map((i) => ({ path: `/repo/f${i}.ts`, holders: ['a'] })),
      inbox: () => [{ actor: 'alpha', msgId: 'm1', summary: 's' }],
      now: () => T0,
      lockTimeoutMs: 40,
    });

    // Another writer (a shell tentacle) holds the lock for the whole tick.
    mkdirSync(`${matrixPath()}.lock`, { recursive: true });
    const report = loop.tick();

    expect(report.ok).toBe(false);
    expect(report.error).toContain('could not acquire matrix lock');
    // NOT partially written — the matrix does not exist at all yet.
    expect(existsSync(MATRIX)).toBe(false);

    // Once the lock clears, the next tick writes everything in one shot.
    rmSync(`${matrixPath()}.lock`, { recursive: true, force: true });
    const second = loop.tick();
    expect(second.ok).toBe(true);
    expect(projectedKeys()).toHaveLength(5);
  });

  test('the lock is released after a tick — a nested lock would have deadlocked', () => {
    // Every mutation runs inside ONE withLock(); the mkdir lock is not reentrant,
    // so if the implementation had called setKey/deleteKey per key inside that
    // lock, this tick would have blown its timeout instead of writing 5 keys.
    const loop = createReconcileLoop({
      claims: () => [0, 1, 2, 3].map((i) => ({ path: `/repo/f${i}.ts`, holders: ['a'] })),
      inbox: () => [{ actor: 'alpha', msgId: 'm1', summary: 's' }],
      now: () => T0,
      lockTimeoutMs: 200,
    });

    const report = loop.tick();

    expect(report.ok).toBe(true);
    expect(projectedKeys()).toHaveLength(5);
    expect(existsSync(`${matrixPath()}.lock`)).toBe(false);
  });

  test('the matrix stays parseable and mode-0600 after a tick', () => {
    const loop = createReconcileLoop({
      claims: () => [{ path: '/repo/a "quoted" \\ path.ts', holders: ['a', 'b'] }],
      now: () => T0,
    });

    loop.tick();

    const raw = readFileSync(MATRIX, 'utf8');
    expect(raw).toContain('PORT DADDY STIGMERGIC ATTENTION MATRIX');
    expect(parseMatrix(raw)[PD_RECON_HEARTBEAT_TS_KEY]).toBe(String(T0));
    expect(statSync(MATRIX).mode & 0o777).toBe(0o600);
  });

  test('start() ticks immediately, is idempotent, and stop() is safe to repeat', () => {
    const sink = spySink();
    const loop = createReconcileLoop({
      claims: () => [{ path: '/repo/a.ts', holders: ['a', 'b'] }],
      now: steppingClock(),
      intervalMs: 3_600_000, // never fires during the test
      logger: sink,
    });

    loop.start();
    expect(kv()[claimKey('/repo/a.ts')]).toBeDefined();
    const afterFirst = readHeartbeatTs(kv());

    loop.start(); // second start must NOT mint a second timer or a second tick
    expect(readHeartbeatTs(kv())).toBe(afterFirst);
    expect(sink.calls.filter((c) => c.message === 'reconcile_loop_started')).toHaveLength(1);

    loop.stop();
    loop.stop();
  });

  test('ci and halt round-trip their values into the exact contract keys', () => {
    const loop = createReconcileLoop({
      panic: () => ({ armed: true }),
      ci: () => ({ branch: 'feat/squid-reconcile-loop', summary: 'jest unit suite failed' }),
      now: () => T0,
    });

    loop.tick();

    expect(kv()[PD_HALT_KEY]).toContain('HALT:');
    expect(kv()[ciKey('feat/squid-reconcile-loop')]).toContain('CI RED on feat/squid-reconcile-loop');
    // Every projected value carries the freshness stamp bin/pd-hook-prompt reads.
    for (const key of projectedKeys()) expect(kv()[key]).toMatch(/\| ts:\d{4}-\d{2}-\d{2}T/);
  });

  test('disarming panic deletes the halt key on the very next tick', () => {
    let armed = true;
    const loop = createReconcileLoop({ panic: () => ({ armed }), now: steppingClock() });

    loop.tick();
    expect(kv()[PD_HALT_KEY]).toBeDefined();

    armed = false;
    loop.tick();
    expect(kv()[PD_HALT_KEY]).toBeUndefined();
  });
});
