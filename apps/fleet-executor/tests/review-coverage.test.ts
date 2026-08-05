/**
 * Fleet incremental review coverage ledger (src/review-coverage.ts).
 *
 * Covers the decision core against an in-memory store: valid chain growth,
 * every rejection family (non-SHIP, malformed SHA, self-loop, predecessor
 * gap, predecessor mismatch, conflicting replay), exact idempotent replay,
 * and fail-closed behavior when the store throws.
 */

import { describe, it, expect } from 'vitest';
import {
  recordShipCoverage,
  createInMemoryCoverageStore,
  SHIP_KIND,
  type CoverageStore,
  type CoverageInput,
} from '../src/review-coverage.js';

const SUBJECT = 'owner/repo#123';
const BASE = 'a'.repeat(40);
const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);
const SHA_3 = '3'.repeat(40);
const OTHER_SUBJECT_SHA = 'b'.repeat(40);

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    subject: SUBJECT,
    sha: SHA_1,
    predecessorSha: BASE,
    kind: SHIP_KIND,
    recordedAt: 1_700_000_000,
    ...over,
  };
}

describe('recordShipCoverage — chain growth', () => {
  it('accepts the first record for a subject as the chain root', async () => {
    const store = createInMemoryCoverageStore();
    const outcome = await recordShipCoverage(store, input());
    expect(outcome).toEqual({ accepted: true, replay: false });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_1);
  });

  it('accepts a second record whose predecessor is the current head, advancing the tip', async () => {
    const store = createInMemoryCoverageStore();
    await recordShipCoverage(store, input());
    const outcome = await recordShipCoverage(
      store,
      input({ sha: SHA_2, predecessorSha: SHA_1 }),
    );
    expect(outcome).toEqual({ accepted: true, replay: false });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
  });

  it('extends a chain across several records in order', async () => {
    const store = createInMemoryCoverageStore();
    await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE }));
    await recordShipCoverage(store, input({ sha: SHA_2, predecessorSha: SHA_1 }));
    const outcome = await recordShipCoverage(
      store,
      input({ sha: SHA_3, predecessorSha: SHA_2 }),
    );
    expect(outcome).toEqual({ accepted: true, replay: false });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_3);
  });

  it('keeps independent chains for independent subjects', async () => {
    const store = createInMemoryCoverageStore();
    await recordShipCoverage(store, input({ subject: 'a/a#1', sha: SHA_1, predecessorSha: BASE }));
    const outcome = await recordShipCoverage(
      store,
      input({ subject: 'b/b#1', sha: SHA_1, predecessorSha: OTHER_SUBJECT_SHA }),
    );
    expect(outcome).toEqual({ accepted: true, replay: false });
    await expect(store.getHead('a/a#1')).resolves.toBe(SHA_1);
    await expect(store.getHead('b/b#1')).resolves.toBe(SHA_1);
  });
});

describe('recordShipCoverage — rejections', () => {
  it('rejects a non-SHIP kind', async () => {
    const store = createInMemoryCoverageStore();
    const outcome = await recordShipCoverage(store, input({ kind: 'HOLD' }));
    expect(outcome).toEqual({
      accepted: false,
      code: 'INVALID_KIND',
      message: expect.stringContaining('HOLD'),
    });
    await expect(store.getHead(SUBJECT)).resolves.toBeNull();
  });

  it.each([
    ['too short', '1'.repeat(39)],
    ['too long', '1'.repeat(41)],
    ['uppercase hex', 'A'.repeat(40)],
    ['non-hex characters', 'z'.repeat(40)],
    ['a ref name', 'refs/heads/main'],
    ['empty string', ''],
  ])('rejects a malformed sha (%s)', async (_label, badSha) => {
    const store = createInMemoryCoverageStore();
    const outcome = await recordShipCoverage(store, input({ sha: badSha }));
    expect(outcome.accepted).toBe(false);
    expect(outcome as { code: string }).toMatchObject({ code: 'MALFORMED_SHA' });
  });

  it('rejects a malformed predecessorSha even when sha is well-formed', async () => {
    const store = createInMemoryCoverageStore();
    const outcome = await recordShipCoverage(store, input({ predecessorSha: 'not-a-sha' }));
    expect(outcome).toMatchObject({ accepted: false, code: 'MALFORMED_SHA' });
  });

  it('rejects a self-loop (sha === predecessorSha)', async () => {
    const store = createInMemoryCoverageStore();
    const outcome = await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: SHA_1 }));
    expect(outcome).toEqual({
      accepted: false,
      code: 'SELF_LOOP',
      message: expect.stringContaining(SHA_1),
    });
  });

  it('rejects a predecessor gap: predecessor was never itself covered', async () => {
    const store = createInMemoryCoverageStore();
    await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE }));
    // SHA_3's claimed predecessor (SHA_2) has no record at all for this subject.
    const outcome = await recordShipCoverage(
      store,
      input({ sha: SHA_3, predecessorSha: SHA_2 }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'PREDECESSOR_GAP' });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_1);
  });

  it('rejects a predecessor mismatch: predecessor was covered but is no longer the tip', async () => {
    const store = createInMemoryCoverageStore();
    await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE }));
    await recordShipCoverage(store, input({ sha: SHA_2, predecessorSha: SHA_1 }));
    // SHA_3 tries to extend from SHA_1 (known, but stale — SHA_2 is now the tip).
    const outcome = await recordShipCoverage(
      store,
      input({ sha: SHA_3, predecessorSha: SHA_1 }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'PREDECESSOR_MISMATCH' });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
  });

  it('rejects a conflicting replay: same sha, different predecessor', async () => {
    const store = createInMemoryCoverageStore();
    await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE }));
    const outcome = await recordShipCoverage(
      store,
      input({ sha: SHA_1, predecessorSha: SHA_2 }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'CONFLICTING_REPLAY' });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_1);
  });

  it('rejects a conflicting replay: same sha and predecessor, different kind', async () => {
    const store = createInMemoryCoverageStore();
    await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE, kind: SHIP_KIND }));
    // getRecord only ever returns kind='SHIP' rows from this store, but a
    // hostile/buggy caller resubmitting a non-SHIP kind must still be caught
    // by the kind check before it ever reaches the replay/conflict logic.
    const outcome = await recordShipCoverage(
      store,
      input({ sha: SHA_1, predecessorSha: BASE, kind: 'HOLD' }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'INVALID_KIND' });
  });
});

describe('recordShipCoverage — idempotent replay', () => {
  it('treats an exact resubmission of an already-recorded entry as a no-op success', async () => {
    const store = createInMemoryCoverageStore();
    const first = await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE }));
    expect(first).toEqual({ accepted: true, replay: false });

    const replay = await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE }));
    expect(replay).toEqual({ accepted: true, replay: true });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_1);
  });

  it('replay of a non-tip record does not move the head backwards', async () => {
    const store = createInMemoryCoverageStore();
    await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE }));
    await recordShipCoverage(store, input({ sha: SHA_2, predecessorSha: SHA_1 }));

    const replay = await recordShipCoverage(store, input({ sha: SHA_1, predecessorSha: BASE }));
    expect(replay).toEqual({ accepted: true, replay: true });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
  });
});

describe('recordShipCoverage — persistence errors fail closed', () => {
  function throwingStore(overrides: Partial<CoverageStore>): CoverageStore {
    const base = createInMemoryCoverageStore();
    return { ...base, ...overrides };
  }

  it('surfaces a getRecord failure as PERSISTENCE_ERROR, not as "no record"', async () => {
    const store = throwingStore({
      getRecord: async () => {
        throw new Error('d1: unavailable');
      },
    });
    const outcome = await recordShipCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR' });
  });

  it('surfaces a getHead failure as PERSISTENCE_ERROR', async () => {
    const store = throwingStore({
      getHead: async () => {
        throw new Error('d1: unavailable');
      },
    });
    const outcome = await recordShipCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR' });
  });

  it('surfaces an append failure as PERSISTENCE_ERROR and never claims acceptance', async () => {
    const store = throwingStore({
      append: async () => {
        throw new Error('d1: write failed');
      },
    });
    const outcome = await recordShipCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR' });
  });

  it('a thrown non-Error value still produces a PERSISTENCE_ERROR string message', async () => {
    const store = throwingStore({
      getHead: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'boom';
      },
    });
    const outcome = await recordShipCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR', message: 'boom' });
  });
});
