/**
 * Regression net born as the evidence file for a CORRECTNESS review of the
 * Reconcile Loop slice.
 *
 * Each `test` here encodes a bug found by review and reproduced by execution.
 * They were written to FAIL, and they did — all three findings below were real.
 * Every one is now FIXED, so this suite is expected to PASS: it has graduated
 * from review evidence into a permanent regression net, and a failure here
 * means one of these bugs has come back.
 *
 * Do not delete this file to make a red run green — these are the exact
 * reproductions that caught the bugs, and they are cheap to keep. (The same
 * behaviours are additionally covered by squid-matrix-mutex.test.ts and
 * squid-reconcile-budget-scope.test.ts.)
 *
 *   1. Per-actor isolation leaks when `actorKey()` truncates at 80 chars and the
 *      80th character is the `_` the separator claims to be unforgeable next to.
 *   2. Per-actor isolation collapses entirely for actor ids with no ASCII
 *      alphanumerics: every one of them normalizes to the literal `X`.
 *   3. The turn-wide entry cap is applied FLEET-WIDE, not per agent-turn, so at
 *      K>=8 parallel agents every agent's mail is dropped AND garbage-collected
 *      even though no single agent has more than one message.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { readMatrix, withLock } from '../../lib/squid/matrix.js';
import {
  PER_ACTOR_SEPARATOR,
  actorKey,
  inboxKey,
  parleyKey,
  perActorKeyPrefix,
  reconcileKeyActor,
} from '../../lib/squid/reconcile-contract.js';
import { createReconcileLoop } from '../../lib/squid/reconcile.js';

const SCRATCH = join(homedir(), 'coding', 'tmp', 'squid-review', `jest-${process.pid}`);
const MATRIX = join(SCRATCH, 'matrix.env');
const HOOK = join(process.cwd(), 'bin', 'pd-hook-prompt');

const savedEnv = { PD_MATRIX_FILE: process.env.PD_MATRIX_FILE, PD_HOME: process.env.PD_HOME };

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.PD_HOME = SCRATCH;
  process.env.PD_MATRIX_FILE = MATRIX;
});

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  if (savedEnv.PD_MATRIX_FILE === undefined) delete process.env.PD_MATRIX_FILE;
  else process.env.PD_MATRIX_FILE = savedEnv.PD_MATRIX_FILE;
  if (savedEnv.PD_HOME === undefined) delete process.env.PD_HOME;
  else process.env.PD_HOME = savedEnv.PD_HOME;
});

describe('per-actor isolation', () => {
  // VICTIM normalizes to 79 'A's + '_' (the run collapse lands the separator on
  // char 80, and the trailing-underscore strip runs BEFORE the truncation).
  // NEIGHBOUR normalizes to the same 79 'A's with no trailing underscore.
  const VICTIM = `${'a'.repeat(79)}-x`;
  const NEIGHBOUR = 'a'.repeat(79);

  test('a truncated actorKey cannot end in the separator character', () => {
    // The documented invariant: `__` is "the one string actorKey can never
    // emit". A key ending in `_` breaks it once the separator is appended.
    expect(actorKey(VICTIM).endsWith('_')).toBe(false);
  });

  test('one actor cannot read another actor\'s inbox (TS reader)', () => {
    const victimKey = inboxKey(VICTIM, 'secret-msg');
    const neighbourPrefix = perActorKeyPrefix('INBOX', NEIGHBOUR);
    expect(victimKey.startsWith(neighbourPrefix)).toBe(false);
  });

  test('one actor cannot read another actor\'s parley (real shell hook)', () => {
    const victimKey = parleyKey(VICTIM, 'c1');
    writeFileSync(MATRIX, `${victimKey}="PARLEY c1: rotate the prod key | ts:${new Date().toISOString()}"\n`);
    const out = execFileSync('/bin/sh', [HOOK], {
      input: '{}',
      env: { ...process.env, PD_ACTOR: NEIGHBOUR },
      encoding: 'utf8',
    });
    expect(out).not.toContain('rotate the prod key');
  });

  test('reconcileKeyActor round-trips actorKey', () => {
    expect(reconcileKeyActor(inboxKey(VICTIM, 'm1'))).toBe(actorKey(VICTIM));
  });

  test('actor ids with no ASCII alphanumerics get distinct mailboxes', () => {
    // Both normalize to the literal `X`, so they share one address and each
    // reads the other's mail.
    const a = '日本語エージェント';
    const b = 'дневник-агент'.replace(/[a-z-]/g, '');
    expect(actorKey(a)).not.toBe(actorKey(b));
    expect(inboxKey(a, 'm1')).not.toBe(inboxKey(b, 'm1'));
    expect(PER_ACTOR_SEPARATOR).toBe('__'); // pins the shape this test reasons about
  });
});

describe('turn-wide budget is per agent-turn, not per fleet', () => {
  test('8 agents with one message each all still receive it', () => {
    const now = 1_800_000_000_000;
    const actors = Array.from({ length: 8 }, (_, i) => `agent-${i}`);
    const loop = createReconcileLoop({
      now: () => now,
      inbox: () => actors.map((a) => ({ actor: a, msgId: 'm1', summary: `mail for ${a}` })),
      parley: () => actors.map((a) => ({ actor: a, convId: 'c1', summary: `reply needed ${a}` })),
      claims: () => [],
      ci: () => null,
      accomplishments: () => [],
      approvals: () => [],
      panic: () => ({ armed: false }),
    });

    const report = loop.tick();
    expect(report.droppedClasses).toEqual([]);

    const kv = readMatrix();
    for (const a of actors) {
      expect(Object.keys(kv)).toContain(inboxKey(a, 'm1'));
      expect(Object.keys(kv)).toContain(parleyKey(a, 'c1'));
    }
  });
});

describe('matrix mutual exclusion spans the TS and shell lock primitives', () => {
  const hasFlock = (() => {
    try {
      execFileSync('/bin/sh', ['-c', 'command -v flock'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  (hasFlock ? test : test.skip)('a shell tentacle cannot append while the TS layer holds the matrix lock', () => {
    writeFileSync(MATRIX, 'PD_ALERT_SEED="seed"\n');

    // `lib/squid/matrix.ts` (and therefore every reconcile tick) serializes on
    // the mkdir lock `${MATRIX}.lock`. On Linux `bin/pd-hook-post-tool` takes
    // `flock` on `${MATRIX}.flock` instead. Two disjoint primitives are not
    // mutual exclusion: the append lands inside the tick's read-modify-rename
    // window and is destroyed by the rename.
    const appendedInsideLock = withLock(undefined, () => {
      execFileSync('/bin/sh', [join(process.cwd(), 'bin', 'pd-hook-post-tool')], {
        input: JSON.stringify({
          tool_name: 'Edit',
          tool_input: { file_path: join(SCRATCH, 'a.ts') },
          cwd: SCRATCH,
        }),
        env: { ...process.env, PD_ACTOR: 'racer' },
      });
      return Object.keys(readMatrix()).some((k) => k.startsWith('PD_PHEROMONE_'));
    });

    expect(appendedInsideLock).toBe(false);
  });
});
