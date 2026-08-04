/**
 * Regression net for BLOCKER 1: the Reconcile Loop applied a TURN-scoped prompt
 * budget FLEET-WIDE, and then let its garbage collector delete what the budget
 * had merely declined to project.
 *
 * The failure this file pins, reproduced by execution before the fix:
 *
 *   - 5 agents × 3 messages (every agent INSIDE its per-actor cap of 3) held
 *     INBOX:15, projected INBOX:0, reported droppedClasses ['INBOX'], and wrote
 *     zero `PD_INBOX_*` keys into the matrix.
 *   - Worse, the drop fed the GC diff: a budget-dropped class read as "the
 *     source says none", so tick 1 could deliver alpha's message and tick 2
 *     (once four more agents appeared) DELETED it. Deterministic, so it recurred
 *     every tick — alpha's message was never delivered to anyone, ever.
 *
 * The two invariants asserted here, which the fix restores:
 *
 *   1. **A budget drop is a deferral, never a deletion.** Only a source that
 *      answered and stopped reporting a key may cause that key to be GC'd.
 *   2. **A per-actor cap is per actor.** Five agents with three messages each is
 *      five separate 3-entry budgets, not one 15-entry overflow — and the
 *      prompt-sized turn budget is measured against ONE agent's view of the
 *      matrix, which is all any agent's hook ever reads.
 *
 * A third block guards the fix from over-correcting: genuine GC must still
 * delete, or the loop stops being the reason this module exists.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { readMatrix } from '../../lib/squid/matrix.js';
import {
  RECONCILE_KEY_CLASSES,
  RECONCILE_MAX_PROJECTED_ENTRIES,
  accomplishmentKey,
  claimKey,
  inboxKey,
  parleyKey,
} from '../../lib/squid/reconcile-contract.js';
import {
  createReconcileLoop,
  type InboxMessage,
  type ReconcileDropReceipt,
} from '../../lib/squid/reconcile.js';
import type { LeveledSink } from '../../lib/observability/log-governor.js';

// Isolated scratch under ~/coding/tmp — never /tmp, never the real ~/.port-daddy.
const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-budget-scope', `jest-${process.pid}`);
const MATRIX = join(SCRATCH, 'matrix.env');
const T0 = 1_800_000_000_000;

const savedEnv = { PD_MATRIX_FILE: process.env.PD_MATRIX_FILE, PD_HOME: process.env.PD_HOME };

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

/** A leveled sink that records every governed line for assertion. */
function spySink(): LeveledSink & { calls: Array<{ level: string; message: string; meta?: unknown }> } {
  const calls: Array<{ level: string; message: string; meta?: unknown }> = [];
  return {
    calls,
    debug: (m: string, meta?: unknown) => calls.push({ level: 'debug', message: m, meta }),
    info: (m: string, meta?: unknown) => calls.push({ level: 'info', message: m, meta }),
    warn: (m: string, meta?: unknown) => calls.push({ level: 'warn', message: m, meta }),
    error: (m: string, meta?: unknown) => calls.push({ level: 'error', message: m, meta }),
  };
}

// ─── 1. The turn budget is per agent-turn, not per fleet ─────────────────────

describe('reconcile — the prompt budget is scoped to one agent, not to the fleet', () => {
  test('8 agents × 1 message each: every agent keeps its own inbox AND parley key', () => {
    // 8 inbox + 8 parley = 16 entries fleet-wide, which the fleet-wide reading of
    // the 12-entry TURN cap treated as an overflow. No single agent holds more
    // than two entries, so no agent's prompt is anywhere near its budget.
    const actors = Array.from({ length: 8 }, (_, i) => `agent-${i}`);
    const loop = createReconcileLoop({
      inbox: () => actors.map((a) => ({ actor: a, msgId: 'm1', summary: `mail for ${a}`, ts: T0 })),
      parley: () => actors.map((a) => ({ actor: a, convId: 'c1', summary: `reply ${a}`, ts: T0 })),
      now: () => T0,
    });

    const report = loop.tick();

    expect(report.droppedClasses).toEqual([]);
    expect(report.suppressionReason).toBeUndefined();
    expect(report.counts.INBOX).toBe(8);
    expect(report.counts.PARLEY).toBe(8);

    const matrix = kv();
    for (const a of actors) {
      expect(matrix[inboxKey(a, 'm1')]).toContain(`mail for ${a}`);
      expect(matrix[parleyKey(a, 'c1')]).toContain(`reply ${a}`);
    }
  });

  test('5 agents × 3 messages: 15 keys land, because that is 5 separate 3-entry caps', () => {
    // The exact reproduction from the review: every agent is INSIDE the INBOX
    // per-actor cap of 3, and 15 > RECONCILE_MAX_PROJECTED_ENTRIES (12).
    expect(RECONCILE_KEY_CLASSES.INBOX.capScope).toBe('per-actor');
    expect(RECONCILE_KEY_CLASSES.INBOX.entryCap).toBe(3);
    expect(15).toBeGreaterThan(RECONCILE_MAX_PROJECTED_ENTRIES);

    const actors = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const mail: InboxMessage[] = actors.flatMap((a) =>
      [1, 2, 3].map((i) => ({ actor: a, msgId: `m${i}`, summary: `${a} msg ${i}`, ts: T0 - i })),
    );
    const loop = createReconcileLoop({ inbox: () => mail, now: () => T0 });

    const report = loop.tick();

    expect(report.held.INBOX).toBe(15);
    expect(report.counts.INBOX).toBe(15);
    expect(report.droppedClasses).toEqual([]);

    const matrix = kv();
    for (const a of actors) {
      for (const i of [1, 2, 3]) {
        expect(matrix[inboxKey(a, `m${i}`)]).toContain(`${a} msg ${i}`);
      }
    }
  });

  test('a single agent that IS over its own turn budget still gets the ordered drop', () => {
    // The budget must not be neutered: one actor holding more than the turn cap
    // is the case the bound was written for, and drop order must still apply.
    const loop = createReconcileLoop({
      panic: () => ({ armed: true, reason: 'stop' }),
      claims: () => [0, 1, 2, 3].map((i) => ({ path: `/f${i}`, holders: ['a', 'b'], ts: T0 })),
      accomplishments: () => [
        { id: 'a1', summary: 'done1', ts: T0 },
        { id: 'a2', summary: 'done2', ts: T0 },
      ],
      now: () => T0,
      maxEntries: 5, // HALT 1 + CLAIM 4 + ACCOMPLISHMENT 2 = 7 held
    });

    const report = loop.tick();

    expect(report.droppedClasses).toEqual(['ACCOMPLISHMENT']);
    expect(report.suppressionReason).toBe('over-entry-cap');
    expect(report.dropScope).toBe('per-agent-turn');
    expect(report.counts.CLAIM).toBe(4);
    expect(kv()[claimKey('/f0')]).toBeDefined();
  });
});

// ─── 2. A budget drop defers; it never deletes ───────────────────────────────

describe('reconcile — a budget-dropped class is deferred, never garbage-collected', () => {
  test('tick 1 delivers alpha’s message; tick 2 under a tight budget does NOT delete it', () => {
    // The destructive interaction, isolated: the class is dropped by the budget
    // on tick 2, and a budget drop used to read as "the source says none".
    const loop = createReconcileLoop({
      inbox: () => [{ actor: 'alpha', msgId: 'm1', summary: 'the merge is blocked on you', ts: T0 }],
      now: () => T0,
      maxEntries: RECONCILE_MAX_PROJECTED_ENTRIES,
    });

    const first = loop.tick();
    expect(first.counts.INBOX).toBe(1);
    expect(kv()[inboxKey('alpha', 'm1')]).toContain('the merge is blocked on you');

    // A second loop over the same matrix, with a budget nothing can fit into.
    const receipts: ReconcileDropReceipt[] = [];
    const starved = createReconcileLoop({
      inbox: () => [{ actor: 'alpha', msgId: 'm1', summary: 'the merge is blocked on you', ts: T0 }],
      now: () => T0 + 1_000,
      maxEntries: 0, // nothing at all fits this turn
      onDrop: (r) => receipts.push(r),
    });

    const second = starved.tick();

    expect(second.droppedClasses).toContain('INBOX');
    expect(second.held.INBOX).toBe(1);
    expect(second.counts.INBOX).toBe(0);
    // THE ASSERTION THIS FILE EXISTS FOR: the mail survives its own suppression.
    expect(kv()[inboxKey('alpha', 'm1')]).toContain('the merge is blocked on you');
    expect(second.keysDeleted).toBe(0);
    // And the operator gets a receipt naming what went unsaid.
    expect(receipts).toHaveLength(1);
    expect(receipts[0].droppedClasses).toContain('INBOX');
    expect(receipts[0].heldCounts.INBOX).toBe(1);
    expect(receipts[0].scope).toBe('per-agent-turn');
  });

  test('the 5-agent overflow does not delete the message a previous tick delivered', () => {
    // The across-ticks form of the bug, with the ORIGINAL fleet-wide budget in
    // force (maxEntries left at its default): tick 1 has one agent, tick 2 has
    // five. Alpha's key must survive tick 2 either way.
    let fleet: InboxMessage[] = [{ actor: 'alpha', msgId: 'm1', summary: 'alpha mail', ts: T0 }];
    const loop = createReconcileLoop({ inbox: () => fleet, now: () => T0 });

    loop.tick();
    expect(kv()[inboxKey('alpha', 'm1')]).toContain('alpha mail');

    fleet = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].flatMap((a) =>
      [1, 2, 3].map((i) => ({ actor: a, msgId: `m${i}`, summary: `${a} mail ${i}`, ts: T0 })),
    );
    const second = loop.tick();

    expect(kv()[inboxKey('alpha', 'm1')]).toBeDefined();
    expect(second.keysDeleted).toBe(0);
  });
});

// ─── 3. Real garbage collection still works ──────────────────────────────────

describe('reconcile — a source that genuinely stops reporting a key still deletes it', () => {
  test('an answered source dropping a message deletes that message from the matrix', () => {
    let mail: InboxMessage[] = [
      { actor: 'alpha', msgId: 'm1', summary: 'read me', ts: T0 },
      { actor: 'alpha', msgId: 'm2', summary: 'read me too', ts: T0 },
    ];
    const loop = createReconcileLoop({ inbox: () => mail, now: () => T0 });

    loop.tick();
    expect(kv()[inboxKey('alpha', 'm1')]).toBeDefined();
    expect(kv()[inboxKey('alpha', 'm2')]).toBeDefined();

    mail = [{ actor: 'alpha', msgId: 'm2', summary: 'read me too', ts: T0 }];
    const report = loop.tick();

    expect(kv()[inboxKey('alpha', 'm1')]).toBeUndefined();
    expect(kv()[inboxKey('alpha', 'm2')]).toBeDefined();
    expect(report.keysDeleted).toBe(1);
  });

  test('per-class cap eviction still deletes: a 4th message evicts the oldest', () => {
    // cap-evict-oldest is a registry GC rule, not a budget drop — it must delete.
    let mail: InboxMessage[] = [1, 2, 3].map((i) => ({
      actor: 'alpha',
      msgId: `m${i}`,
      summary: `msg ${i}`,
      ts: T0 - (10 - i) * 1_000,
    }));
    const loop = createReconcileLoop({ inbox: () => mail, now: () => T0 });
    loop.tick();
    expect(kv()[inboxKey('alpha', 'm1')]).toBeDefined();

    mail = [...mail, { actor: 'alpha', msgId: 'm4', summary: 'msg 4', ts: T0 }];
    loop.tick();

    expect(kv()[inboxKey('alpha', 'm1')]).toBeUndefined(); // oldest evicted
    expect(kv()[inboxKey('alpha', 'm4')]).toBeDefined();
  });

  test('a class whose TTL expired is still collected', () => {
    let acc = [{ id: 'a1', summary: 'shipped', ts: T0 }];
    let now = T0;
    const loop = createReconcileLoop({ accomplishments: () => acc, now: () => now });
    loop.tick();
    expect(kv()[accomplishmentKey('a1')]).toBeDefined();

    now = T0 + 3_600_000; // well past the 15-minute accomplishment TTL
    acc = [{ id: 'a1', summary: 'shipped', ts: T0 }];
    loop.tick();

    expect(kv()[accomplishmentKey('a1')]).toBeUndefined();
  });
});

// ─── 4. The fleet-wide ceiling is a loud safety valve, not a silent shredder ──

describe('reconcile — the fleet-wide matrix ceiling', () => {
  test('fires with an error-level receipt and still deletes nothing', () => {
    const sink = spySink();
    const receipts: ReconcileDropReceipt[] = [];
    const actors = Array.from({ length: 10 }, (_, i) => `agent-${i}`);
    const loop = createReconcileLoop({
      inbox: () => [{ actor: 'alpha', msgId: 'm1', summary: 'seed', ts: T0 }],
      now: () => T0,
      logger: sink,
    });
    loop.tick();
    expect(kv()[inboxKey('alpha', 'm1')]).toBeDefined();

    const crowded = createReconcileLoop({
      // Alpha's seed is STILL asserted by the source, so nothing about it has
      // become collectable — only the ceiling stands between it and the matrix.
      inbox: () => [
        { actor: 'alpha', msgId: 'm1', summary: 'seed', ts: T0 },
        ...actors.map((a) => ({ actor: a, msgId: 'm1', summary: `mail ${a}`, ts: T0 })),
      ],
      now: () => T0 + 1_000,
      logger: sink,
      matrixEntryCeiling: 4,
      onDrop: (r) => receipts.push(r),
    });

    const report = crowded.tick();

    expect(report.droppedClasses).toContain('INBOX');
    expect(report.dropScope).toBe('fleet-matrix-ceiling');
    expect(report.keysDeleted).toBe(0);
    // Alpha's seeded mail is untouched by a bound alpha had nothing to do with.
    expect(kv()[inboxKey('alpha', 'm1')]).toContain('seed');
    // Loud: the ceiling is an operator-visible error, not a per-tick debug line.
    const loud = sink.calls.filter(
      (c) => c.message === 'reconcile_projection_suppressed' && c.level === 'error',
    );
    expect(loud).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].scope).toBe('fleet-matrix-ceiling');
  });

  test('a normal fleet stays far below the ceiling and reports no drop', () => {
    const actors = Array.from({ length: 24 }, (_, i) => `agent-${i}`);
    const loop = createReconcileLoop({
      inbox: () => actors.flatMap((a) => [1, 2, 3].map((i) => ({ actor: a, msgId: `m${i}`, summary: 's', ts: T0 }))),
      now: () => T0,
    });

    const report = loop.tick();

    expect(report.droppedClasses).toEqual([]);
    expect(report.counts.INBOX).toBe(72);
  });
});
