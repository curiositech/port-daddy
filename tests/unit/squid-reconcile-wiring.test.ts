/**
 * End-to-end proof that the five newly-wired classes reach the matrix.
 *
 * `squid-reconcile-sources.test.ts` pins the mappings in isolation; this file
 * closes the loop by running real adapters over fake stores through the REAL
 * reconcile loop and asserting on the bytes that land in a real matrix file.
 * The distinction matters because a correct adapter can still fail to project:
 * a source the daemon never threads through, or one whose shape the loop's own
 * validator rejects, produces exactly the same silence as having no data.
 *
 * The degradation cases are the point of the second half. "Absent" and "empty"
 * are different assertions — absent leaves another writer's keys alone, empty
 * deletes them — and nothing about the type system enforces that difference.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { readMatrix } from '../../lib/squid/matrix.js';
import {
  accomplishmentsSource,
  ciSource,
  claimsSource,
  inboxSource,
  parleySource,
} from '../../lib/squid/reconcile-sources.js';
import { createReconcileLoop } from '../../lib/squid/reconcile.js';

const SCRATCH = join(tmpdir(), 'pd-squid-wiring', `jest-${process.pid}`);
const MATRIX = join(SCRATCH, 'matrix.env');
const saved = { PD_MATRIX_FILE: process.env.PD_MATRIX_FILE, PD_HOME: process.env.PD_HOME };
const NOW = 1_700_000_000_000;

beforeEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.PD_HOME = SCRATCH;
  process.env.PD_MATRIX_FILE = MATRIX;
});

afterEach(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  for (const k of ['PD_MATRIX_FILE', 'PD_HOME'] as const) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Fake stores shaped like the real ones, populated with one item each. */
const stores = {
  inbox: {
    listAllUnread: () =>
      [{ id: 11, agentId: 'alpha', from: 'beta', content: 'the rebase landed', createdAt: NOW - 100 }] as never,
  },
  sessions: {
    listAllActiveClaims: () => ({
      claims: [
        { filePath: 'lib/squid/reconcile.ts', sessionId: 's1', agentId: 'alpha', claimedAt: NOW - 50 },
        { filePath: 'lib/squid/reconcile.ts', sessionId: 's2', agentId: 'beta', claimedAt: NOW - 20 },
      ] as never,
    }),
    list: () => ({ success: true, sessions: [{ id: 'sess-9', purpose: 'wired the loop', completedAt: NOW - 10 }] }),
  },
  parley: {
    list: () =>
      [
        {
          parley: { parleyId: 'p7', reason: 'who owns the mutex', parties: ['alpha', 'beta'], createdAt: NOW - 30 },
          status: 'SUMMONED',
          missingParties: ['beta'],
          expired: false,
        },
      ] as never,
  },
  telemetry: {
    recent: () =>
      [
        {
          event: 'check_run',
          conclusion: 'failure',
          owner: 'curiositech',
          repo: 'port-daddy',
          prNumber: 4925,
          sha: 'deadbeefcafe',
          ts: NOW - 5,
          metadata: null,
        },
      ] as never,
  },
};

const allSources = () => ({
  inbox: inboxSource(stores.inbox),
  claims: claimsSource(stores.sessions),
  parley: parleySource(stores.parley),
  accomplishments: accomplishmentsSource(stores.sessions, () => NOW),
  ci: ciSource(stores.telemetry, () => NOW),
});

describe('the five classes reach the matrix', () => {
  test('one tick projects a key for every wired class', () => {
    createReconcileLoop({ ...allSources(), now: () => NOW }).tick();
    const keys = Object.keys(readMatrix());

    // Each class has its own prefix; assert the prefix is present rather than
    // the exact key, so per-actor address digests stay an implementation detail.
    expect(keys.some((k) => k.startsWith('PD_INBOX_'))).toBe(true);
    expect(keys.some((k) => k.startsWith('PD_CLAIM'))).toBe(true);
    expect(keys.some((k) => k.startsWith('PD_PARLEY_'))).toBe(true);
    expect(keys.some((k) => k.startsWith('PD_ACCOMPLISHMENT_'))).toBe(true);
    expect(keys.some((k) => k.startsWith('PD_CI'))).toBe(true);
  });

  test('the projected values carry the content an agent would act on', () => {
    createReconcileLoop({ ...allSources(), now: () => NOW }).tick();
    const blob = Object.values(readMatrix()).join('\n');

    expect(blob).toContain('the rebase landed');
    expect(blob).toContain('lib/squid/reconcile.ts');
    expect(blob).toContain('who owns the mutex');
    expect(blob).toContain('wired the loop');
    expect(blob).toContain('PR #4925');
  });

  test('no projected value contains a newline', () => {
    // The matrix is a flat KEY="value" file the POSIX hook parses line by line.
    createReconcileLoop({ ...allSources(), now: () => NOW }).tick();
    for (const [key, value] of Object.entries(readMatrix())) {
      expect(`${key}=${value}`).not.toContain('\n');
    }
  });

  test('ticking twice is idempotent — stable ids overwrite, never accumulate', () => {
    const loop = createReconcileLoop({ ...allSources(), now: () => NOW });
    loop.tick();
    const first = Object.keys(readMatrix()).sort();
    loop.tick();
    expect(Object.keys(readMatrix()).sort()).toEqual(first);
  });
});

describe('absent is not empty', () => {
  /** A foreign key the loop must never touch for a class it cannot see. */
  const FOREIGN = 'PD_INBOX_SOMEONE_ELSE_99__M1';

  test('an ABSENT source leaves an existing key of that class alone', () => {
    writeFileSync(MATRIX, `${FOREIGN}="INBOX: written by another daemon"\n`);
    // No `inbox` source at all: the class is degraded, so the loop has no basis
    // to conclude this key is stale.
    createReconcileLoop({ claims: claimsSource(stores.sessions), now: () => NOW }).tick();
    expect(readMatrix()[FOREIGN]).toBeDefined();
  });

  test('an EMPTY source deletes it, because empty is a factual claim', () => {
    writeFileSync(MATRIX, `${FOREIGN}="INBOX: written by another daemon"\n`);
    // This is the behaviour that makes `() => []` dangerous as a default, and
    // the reason server.ts spreads its sources conditionally.
    createReconcileLoop({ inbox: () => [], now: () => NOW }).tick();
    expect(readMatrix()[FOREIGN]).toBeUndefined();
  });

  test('a THROWING source degrades that class rather than wiping it', () => {
    writeFileSync(MATRIX, `${FOREIGN}="INBOX: written by another daemon"\n`);
    createReconcileLoop({
      inbox: () => {
        throw new Error('db locked');
      },
      now: () => NOW,
    }).tick();
    expect(readMatrix()[FOREIGN]).toBeDefined();
  });

  test('one dead source does not silence the others', () => {
    // Per-class degradation: a store outage must cost exactly its own class.
    createReconcileLoop({
      ...allSources(),
      inbox: () => {
        throw new Error('inbox down');
      },
      now: () => NOW,
    }).tick();
    const keys = Object.keys(readMatrix());
    expect(keys.some((k) => k.startsWith('PD_INBOX_'))).toBe(false);
    expect(keys.some((k) => k.startsWith('PD_PARLEY_'))).toBe(true);
    expect(keys.some((k) => k.startsWith('PD_CI'))).toBe(true);
  });

  test('CI wired but green retracts a stale red key', () => {
    // The positive-claim direction: once ingestion is live, `null` genuinely
    // means green and the old failure must stop being reported.
    createReconcileLoop({ ...allSources(), now: () => NOW }).tick();
    expect(Object.keys(readMatrix()).some((k) => k.startsWith('PD_CI'))).toBe(true);

    createReconcileLoop({ ...allSources(), ci: () => null, now: () => NOW }).tick();
    expect(Object.keys(readMatrix()).some((k) => k.startsWith('PD_CI'))).toBe(false);
  });

  test('CI UNWIRED leaves a red key standing rather than implying green', () => {
    // The whole reason server.ts probes ingestion before wiring: a daemon that
    // cannot see CI must not quietly retract someone else's failure notice.
    createReconcileLoop({ ...allSources(), now: () => NOW }).tick();
    const ciKey = Object.keys(readMatrix()).find((k) => k.startsWith('PD_CI'))!;
    expect(ciKey).toBeDefined();

    const { ci: _omitted, ...withoutCi } = allSources();
    createReconcileLoop({ ...withoutCi, now: () => NOW }).tick();
    expect(readMatrix()[ciKey]).toBeDefined();
  });
});
