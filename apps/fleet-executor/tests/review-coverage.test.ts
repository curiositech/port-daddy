/**
 * Fleet incremental review coverage ledger (src/review-coverage.ts).
 *
 * Covers the decision core against an in-memory store: chain growth from a
 * trusted root, every rejection family (invalid verdict, incomplete
 * evidence, malformed SHA, self-loop, missing intermediate commits,
 * unverifiable range, root trust violation, predecessor gap/mismatch,
 * conflicting replay, stale concurrent append), exact idempotent replay,
 * SHIP-only advancement of the chain head, and fail-closed behavior when
 * the store throws.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  recordReviewCoverage,
  createInMemoryCoverageStore,
  computeRangeDigest,
  MAX_COMMITS_PER_HOP,
  SHIP,
  SHIP_AFTER_FIX,
  DO_NOT_SHIP,
  type CoverageStore,
  type CoverageInput,
} from '../src/review-coverage.js';

const SUBJECT = 'owner/repo#123';
const BASE = 'a'.repeat(40);
const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);
const SHA_3 = '3'.repeat(40);
const SHA_4 = '4'.repeat(40);
const OTHER_BASE = 'b'.repeat(40);

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    subject: SUBJECT,
    base: BASE,
    head: SHA_1,
    commits: [SHA_1],
    verdict: SHIP,
    reviewerId: 'fleet-ship:purser',
    runId: 'run-0001',
    evidenceLocator: 'https://example.invalid/runs/0001',
    recordedAt: 1_700_000_000,
    ...over,
  };
}

function rootedStore(base = BASE): ReturnType<typeof createInMemoryCoverageStore> {
  const store = createInMemoryCoverageStore();
  store.setTrustedBase(SUBJECT, base);
  return store;
}

describe('recordReviewCoverage — chain growth from a trusted root', () => {
  it('accepts the first record for a subject when base matches the configured trusted base', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input());
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: true });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_1);
  });

  it('accepts a second record whose base is the current head, advancing the tip', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input());
    const outcome = await recordReviewCoverage(store, input({ base: SHA_1, head: SHA_2, commits: [SHA_2] }));
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: true });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
  });

  it('extends a chain across several records in order', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits: [SHA_1] }));
    await recordReviewCoverage(store, input({ base: SHA_1, head: SHA_2, commits: [SHA_2] }));
    const outcome = await recordReviewCoverage(store, input({ base: SHA_2, head: SHA_3, commits: [SHA_3] }));
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: true });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_3);
  });

  it('accepts a single hop that covers several intermediate commits at once', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(
      store,
      input({ base: BASE, head: SHA_3, commits: [SHA_1, SHA_2, SHA_3] }),
    );
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: true });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_3);
  });

  it('keeps independent chains for independent subjects, each with its own trusted base', async () => {
    const store = createInMemoryCoverageStore();
    store.setTrustedBase('a/a#1', BASE);
    store.setTrustedBase('b/b#1', OTHER_BASE);
    await recordReviewCoverage(store, input({ subject: 'a/a#1', base: BASE, head: SHA_1, commits: [SHA_1] }));
    const outcome = await recordReviewCoverage(
      store,
      input({ subject: 'b/b#1', base: OTHER_BASE, head: SHA_1, commits: [SHA_1] }),
    );
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: true });
    await expect(store.getHead('a/a#1')).resolves.toBe(SHA_1);
    await expect(store.getHead('b/b#1')).resolves.toBe(SHA_1);
  });

  it('accepts a caller-supplied rangeDigest that matches the canonical digest', async () => {
    const store = rootedStore();
    const digest = await computeRangeDigest(BASE, SHA_1, [SHA_1]);
    const outcome = await recordReviewCoverage(store, input({ rangeDigest: digest }));
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: true });
  });
});

describe('recordReviewCoverage — root trust', () => {
  it('rejects the first record when no trusted base is configured for the subject', async () => {
    const store = createInMemoryCoverageStore();
    const outcome = await recordReviewCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'ROOT_TRUST_VIOLATION' });
    await expect(store.getHead(SUBJECT)).resolves.toBeNull();
  });

  it('rejects the first record when base does not match the configured trusted base', async () => {
    const store = rootedStore(BASE);
    const outcome = await recordReviewCoverage(store, input({ base: OTHER_BASE, head: SHA_1, commits: [SHA_1] }));
    expect(outcome).toMatchObject({
      accepted: false,
      code: 'ROOT_TRUST_VIOLATION',
      message: expect.stringContaining(BASE),
    });
    await expect(store.getHead(SUBJECT)).resolves.toBeNull();
  });
});

describe('recordReviewCoverage — verdict and evidence shape rejections', () => {
  it('rejects a verdict outside the SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP tri-state', async () => {
    const store = rootedStore();
    // @ts-expect-error deliberately invalid verdict
    const outcome = await recordReviewCoverage(store, input({ verdict: 'HOLD' }));
    expect(outcome).toEqual({
      accepted: false,
      code: 'INVALID_VERDICT',
      message: expect.stringContaining('HOLD'),
    });
  });

  it.each([
    ['blank subject', { subject: '' }],
    ['blank reviewerId', { reviewerId: '  ' }],
    ['blank runId', { runId: '' }],
    ['blank evidenceLocator', { evidenceLocator: '' }],
  ])('rejects incomplete evidence (%s)', async (_label, over) => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input(over));
    expect(outcome).toMatchObject({ accepted: false, code: 'INCOMPLETE_EVIDENCE' });
  });

  it.each([
    ['too short', '1'.repeat(39)],
    ['too long', '1'.repeat(41)],
    ['uppercase hex', 'A'.repeat(40)],
    ['non-hex characters', 'z'.repeat(40)],
    ['a ref name', 'refs/heads/main'],
    ['empty string', ''],
  ])('rejects a malformed head (%s)', async (_label, badSha) => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input({ head: badSha, commits: [badSha] }));
    expect(outcome).toMatchObject({ accepted: false, code: 'MALFORMED_SHA' });
  });

  it('rejects a malformed base even when head is well-formed', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input({ base: 'not-a-sha' }));
    expect(outcome).toMatchObject({ accepted: false, code: 'MALFORMED_SHA' });
  });

  it('rejects a malformed entry inside commits', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(
      store,
      input({ head: SHA_2, commits: ['not-a-sha', SHA_2] }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'MALFORMED_SHA' });
  });

  it('rejects a self-loop (head === base)', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input({ base: SHA_1, head: SHA_1, commits: [SHA_1] }));
    expect(outcome).toEqual({
      accepted: false,
      code: 'SELF_LOOP',
      message: expect.stringContaining(SHA_1),
    });
  });
});

describe('recordReviewCoverage — missing intermediate commits', () => {
  it('rejects an empty commits list', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input({ commits: [] }));
    expect(outcome).toMatchObject({ accepted: false, code: 'MISSING_INTERMEDIATE_COMMITS' });
  });

  it('rejects a commits list that does not end at head (the range is not fully covered)', async () => {
    const store = rootedStore();
    // Claims head = SHA_3 but the enumerated range stops at SHA_2 — SHA_3
    // itself, and anything after SHA_2, is unaccounted for.
    const outcome = await recordReviewCoverage(
      store,
      input({ base: BASE, head: SHA_3, commits: [SHA_1, SHA_2] }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'MISSING_INTERMEDIATE_COMMITS' });
  });

  it('rejects a commits list that includes base (base is exclusive)', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(
      store,
      input({ base: BASE, head: SHA_1, commits: [BASE, SHA_1] }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'MISSING_INTERMEDIATE_COMMITS' });
  });

  it('rejects a commits list with duplicate entries', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(
      store,
      input({ base: BASE, head: SHA_2, commits: [SHA_1, SHA_1, SHA_2] }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'MISSING_INTERMEDIATE_COMMITS' });
  });
});

describe('recordReviewCoverage — malformed commits from untrusted JSON never throws', () => {
  it.each([
    ['missing (undefined)', undefined],
    ['null', null],
    ['a plain object', { length: 1, 0: SHA_1 }],
    ['a scalar string', SHA_1],
    ['a scalar number', 12345],
    ['a scalar boolean', true],
  ])('returns a structured rejection instead of throwing when commits is %s', async (_label, badCommits) => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(
      store,
      // Simulates a parsed-but-untrusted JSON body where `commits` does not
      // conform to `string[]` — the type system can't stop this at the real
      // HTTP boundary, so the runtime guard must.
      input({ commits: badCommits as unknown as string[] }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'MISSING_INTERMEDIATE_COMMITS' });
    await expect(store.getHead(SUBJECT)).resolves.toBeNull();
  });

  it('does not throw and rejects an array containing a non-string entry', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(
      store,
      input({ commits: [42 as unknown as string] }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'MALFORMED_SHA' });
  });
});

describe('recordReviewCoverage — maximum commit-range length', () => {
  it('accepts a commits list exactly at the MAX_COMMITS_PER_HOP boundary', async () => {
    const store = rootedStore();
    const commits = Array.from({ length: MAX_COMMITS_PER_HOP - 1 }, (_, i) => (i + 1).toString(16).padStart(40, '0'));
    commits.push(SHA_1);
    const outcome = await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits }));
    expect(outcome).toMatchObject({ accepted: true, replay: false, advanced: true });
  });

  it('rejects a commits list one entry over MAX_COMMITS_PER_HOP without computing a digest over it', async () => {
    const store = rootedStore();
    // Every entry is intentionally the SAME malformed placeholder — if the
    // implementation validated SHA shape or hashed the range before
    // checking the length cap, this would be slow and/or fail with
    // MALFORMED_SHA instead of the length rejection this test targets.
    const commits: string[] = new Array(MAX_COMMITS_PER_HOP + 1).fill('not-a-real-sha');
    const outcome = await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits }));
    expect(outcome).toMatchObject({
      accepted: false,
      code: 'MISSING_INTERMEDIATE_COMMITS',
      message: expect.stringContaining(String(MAX_COMMITS_PER_HOP)),
    });
  });
});

describe('recordReviewCoverage — unverifiable range', () => {
  it('rejects a rangeDigest that does not match the canonical digest', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input({ rangeDigest: 'deadbeef'.repeat(8) }));
    expect(outcome).toMatchObject({ accepted: false, code: 'UNVERIFIABLE_RANGE' });
  });

  it('rejects a rangeDigest computed from a tampered commits list', async () => {
    const store = rootedStore();
    // Digest is computed honestly from [SHA_1, SHA_2], but the submitted
    // commits list quietly drops SHA_1 — the digest and the range disagree.
    const digest = await computeRangeDigest(BASE, SHA_2, [SHA_1, SHA_2]);
    const outcome = await recordReviewCoverage(
      store,
      input({ base: BASE, head: SHA_2, commits: [SHA_2], rangeDigest: digest }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'UNVERIFIABLE_RANGE' });
  });

  it('turns a WebCrypto digest failure into a structured fail-closed rejection', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('crypto unavailable'));
    try {
      const outcome = await recordReviewCoverage(rootedStore(), input());
      expect(outcome).toMatchObject({
        accepted: false,
        code: 'UNVERIFIABLE_RANGE',
        message: expect.stringContaining('crypto unavailable'),
      });
    } finally {
      digest.mockRestore();
    }
  });
});

describe('recordReviewCoverage — predecessor gap / mismatch', () => {
  it('rejects a predecessor gap: base has no recorded SHIP coverage for this subject', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits: [SHA_1] }));
    // SHA_3's claimed base (SHA_2) was never itself covered.
    const outcome = await recordReviewCoverage(
      store,
      input({ base: SHA_2, head: SHA_3, commits: [SHA_3] }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'PREDECESSOR_GAP' });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_1);
  });

  it('rejects a predecessor mismatch: base was covered earlier but is no longer the tip', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits: [SHA_1] }));
    await recordReviewCoverage(store, input({ base: SHA_1, head: SHA_2, commits: [SHA_2] }));
    // SHA_3 tries to extend from SHA_1 (known, but stale — SHA_2 is now the tip).
    const outcome = await recordReviewCoverage(
      store,
      input({ base: SHA_1, head: SHA_3, commits: [SHA_3] }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'PREDECESSOR_MISMATCH' });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
  });
});

describe('recordReviewCoverage — verdict tri-state and SHIP-only advancement', () => {
  it('records DO-NOT-SHIP as evidence but does not advance the chain head', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input({ verdict: DO_NOT_SHIP }));
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: false });
    await expect(store.getHead(SUBJECT)).resolves.toBeNull();
    await expect(store.getEvidence(SUBJECT, SHA_1)).resolves.toMatchObject({ verdict: DO_NOT_SHIP });
  });

  it('records SHIP-AFTER-FIX as evidence but does not advance the chain head', async () => {
    const store = rootedStore();
    const outcome = await recordReviewCoverage(store, input({ verdict: SHIP_AFTER_FIX }));
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: false });
    await expect(store.getHead(SUBJECT)).resolves.toBeNull();
  });

  it('rejects a SHIP verdict for the same base/head that DO-NOT-SHIP already recorded, as a conflicting replay', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ verdict: DO_NOT_SHIP }));
    const outcome = await recordReviewCoverage(store, input({ verdict: SHIP }));
    expect(outcome).toMatchObject({ accepted: false, code: 'CONFLICTING_REPLAY' });
    await expect(store.getHead(SUBJECT)).resolves.toBeNull();
  });

  it('a non-advancing verdict for one head does not block a SHIP for a different head from advancing the chain', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ head: SHA_1, commits: [SHA_1], verdict: DO_NOT_SHIP }));
    const outcome = await recordReviewCoverage(store, input({ head: SHA_2, commits: [SHA_2], verdict: SHIP }));
    expect(outcome).toEqual({ accepted: true, replay: false, advanced: true });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
  });
});

describe('recordReviewCoverage — idempotent replay', () => {
  it('treats an exact resubmission of an already-recorded SHIP entry as a no-op success', async () => {
    const store = rootedStore();
    const first = await recordReviewCoverage(store, input());
    expect(first).toEqual({ accepted: true, replay: false, advanced: true });

    const replay = await recordReviewCoverage(store, input());
    expect(replay).toEqual({ accepted: true, replay: true, advanced: false });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_1);
  });

  it('treats an exact resubmission of a DO-NOT-SHIP entry as a no-op success that still does not advance', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ verdict: DO_NOT_SHIP }));
    const replay = await recordReviewCoverage(store, input({ verdict: DO_NOT_SHIP }));
    expect(replay).toEqual({ accepted: true, replay: true, advanced: false });
  });

  it('replay of a non-tip record does not move the head backwards', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits: [SHA_1] }));
    await recordReviewCoverage(store, input({ base: SHA_1, head: SHA_2, commits: [SHA_2] }));

    const replay = await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits: [SHA_1] }));
    expect(replay).toEqual({ accepted: true, replay: true, advanced: false });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
  });

  it('treats a retry re-stamped with a fresh recordedAt as a safe no-op for the current chain tip, keeping the original evidence', async () => {
    const store = rootedStore();
    const first = await recordReviewCoverage(store, input({ recordedAt: 1_700_000_000 }));
    expect(first).toEqual({ accepted: true, replay: false, advanced: true });

    // Same hop, same everything except recordedAt — the natural shape of a
    // retry helper that re-stamps wall-clock time on every attempt.
    const replay = await recordReviewCoverage(store, input({ recordedAt: 1_700_000_555 }));
    expect(replay).toEqual({ accepted: true, replay: true, advanced: false });

    // The persisted evidence is untouched — original recordedAt survives,
    // the resubmitted timestamp never overwrites it.
    await expect(store.getEvidence(SUBJECT, SHA_1)).resolves.toMatchObject({ recordedAt: 1_700_000_000 });
  });

  it('treats a retry re-stamped with a fresh recordedAt as a safe no-op for a now-superseded (non-tip) hop', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits: [SHA_1], recordedAt: 1_700_000_000 }));
    await recordReviewCoverage(store, input({ base: SHA_1, head: SHA_2, commits: [SHA_2], recordedAt: 1_700_000_100 }));

    // SHA_1's hop is no longer the tip (SHA_2 is), but a re-stamped retry of
    // it must still be recognized as the same evidence, not a conflict.
    const replay = await recordReviewCoverage(
      store,
      input({ base: BASE, head: SHA_1, commits: [SHA_1], recordedAt: 1_700_000_999 }),
    );
    expect(replay).toEqual({ accepted: true, replay: true, advanced: false });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
    await expect(store.getEvidence(SUBJECT, SHA_1)).resolves.toMatchObject({ recordedAt: 1_700_000_000 });
  });

  it('still rejects as a conflicting replay when recordedAt changes alongside substantive evidence', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ recordedAt: 1_700_000_000 }));
    const outcome = await recordReviewCoverage(
      store,
      input({ verdict: DO_NOT_SHIP, recordedAt: 1_700_000_555 }),
    );
    expect(outcome).toMatchObject({ accepted: false, code: 'CONFLICTING_REPLAY' });
  });

  it.each([
    ['different base', { base: OTHER_BASE }],
    ['different commits', { commits: [SHA_1, SHA_1] } as never],
    ['different verdict', { verdict: DO_NOT_SHIP }],
    ['different reviewerId', { reviewerId: 'someone-else' }],
    ['different runId', { runId: 'run-0002' }],
    ['different evidenceLocator', { evidenceLocator: 'https://example.invalid/runs/0002' }],
  ])('rejects a conflicting replay (%s)', async (_label, over) => {
    const store = rootedStore();
    await recordReviewCoverage(store, input());
    const outcome = await recordReviewCoverage(store, input(over as Partial<CoverageInput>));
    if (_label === 'different commits') {
      // A commits list of [SHA_1, SHA_1] is caught earlier as a duplicate.
      expect(outcome).toMatchObject({ accepted: false, code: 'MISSING_INTERMEDIATE_COMMITS' });
    } else {
      expect(outcome).toMatchObject({ accepted: false, code: 'CONFLICTING_REPLAY' });
    }
  });
});

describe('recordReviewCoverage — stale concurrent append (atomic CAS)', () => {
  it('rejects a racer whose append lands after a competing append already advanced the head', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits: [SHA_1] }));

    // Racer A reads head=SHA_1 and starts building evidence extending it to
    // SHA_2. Before A's own append lands, racer B reads the SAME head=SHA_1
    // and successfully appends first, advancing the head to SHA_3. A's
    // append must then fail — not silently overwrite B's result — because
    // by write time the head is no longer what A read.
    let intercepted = false;
    const racingStore: CoverageStore = {
      ...store,
      async getHead(subject) {
        const snapshot = await store.getHead(subject);
        if (!intercepted && subject === SUBJECT) {
          intercepted = true;
          await recordReviewCoverage(store, input({ base: SHA_1, head: SHA_3, commits: [SHA_3] }));
        }
        return snapshot;
      },
    };

    const outcomeA = await recordReviewCoverage(racingStore, input({ base: SHA_1, head: SHA_2, commits: [SHA_2] }));
    expect(outcomeA).toMatchObject({
      accepted: false,
      code: 'STALE_CONCURRENT_APPEND',
      message: expect.stringContaining(SHA_3),
    });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_3);
    await expect(store.getEvidence(SUBJECT, SHA_2)).resolves.toBeNull();
  });

  it('rejects a racer that loses the race even at the root (no prior head)', async () => {
    const store = rootedStore();

    let intercepted = false;
    const racingStore: CoverageStore = {
      ...store,
      async getHead(subject) {
        const snapshot = await store.getHead(subject);
        if (!intercepted && subject === SUBJECT) {
          intercepted = true;
          await recordReviewCoverage(store, input({ base: BASE, head: SHA_2, commits: [SHA_2] }));
        }
        return snapshot;
      },
    };

    const outcomeA = await recordReviewCoverage(racingStore, input({ base: BASE, head: SHA_1, commits: [SHA_1] }));
    expect(outcomeA).toMatchObject({ accepted: false, code: 'STALE_CONCURRENT_APPEND' });
    await expect(store.getHead(SUBJECT)).resolves.toBe(SHA_2);
  });
});

describe('recordReviewCoverage — persistence errors fail closed', () => {
  function throwingStore(overrides: Partial<CoverageStore>): CoverageStore {
    const base = rootedStore();
    return { ...base, ...overrides };
  }

  it('surfaces a getEvidence failure as PERSISTENCE_ERROR, before any continuity check runs', async () => {
    const store = throwingStore({
      getEvidence: async () => {
        throw new Error('d1: unavailable');
      },
    });
    const outcome = await recordReviewCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR' });
    await expect(store.getHead(SUBJECT)).resolves.toBeNull();
  });

  it('surfaces a getTrustedBase failure as PERSISTENCE_ERROR', async () => {
    const store = throwingStore({
      getTrustedBase: async () => {
        throw new Error('d1: unavailable');
      },
    });
    const outcome = await recordReviewCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR' });
  });

  it('surfaces a getHead failure as PERSISTENCE_ERROR', async () => {
    const store = throwingStore({
      getHead: async () => {
        throw new Error('d1: unavailable');
      },
    });
    const outcome = await recordReviewCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR' });
  });

  it('surfaces an isKnownShipHead failure as PERSISTENCE_ERROR', async () => {
    const store = rootedStore();
    await recordReviewCoverage(store, input({ base: BASE, head: SHA_1, commits: [SHA_1] }));
    const failing: CoverageStore = {
      ...store,
      isKnownShipHead: async () => {
        throw new Error('d1: unavailable');
      },
    };
    // base = SHA_2, unrelated to the known head SHA_1, forces the
    // isKnownShipHead lookup to distinguish gap vs. mismatch.
    const outcome = await recordReviewCoverage(failing, input({ base: SHA_2, head: SHA_3, commits: [SHA_3] }));
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR' });
  });

  it('surfaces an appendEvidence failure as PERSISTENCE_ERROR and never claims acceptance', async () => {
    const store = throwingStore({
      appendEvidence: async () => {
        throw new Error('d1: write failed');
      },
    });
    const outcome = await recordReviewCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR' });
  });

  it('a thrown non-Error value still produces a PERSISTENCE_ERROR string message', async () => {
    const store = throwingStore({
      getHead: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'boom';
      },
    });
    const outcome = await recordReviewCoverage(store, input());
    expect(outcome).toMatchObject({ accepted: false, code: 'PERSISTENCE_ERROR', message: 'boom' });
  });
});

describe('computeRangeDigest', () => {
  it('is deterministic for identical inputs', async () => {
    const a = await computeRangeDigest(BASE, SHA_1, [SHA_1]);
    const b = await computeRangeDigest(BASE, SHA_1, [SHA_1]);
    expect(a).toBe(b);
  });

  it('changes when any of base, head, or commits changes', async () => {
    const reference = await computeRangeDigest(BASE, SHA_2, [SHA_1, SHA_2]);
    const differentBase = await computeRangeDigest(OTHER_BASE, SHA_2, [SHA_1, SHA_2]);
    const differentHead = await computeRangeDigest(BASE, SHA_3, [SHA_1, SHA_2]);
    const differentCommits = await computeRangeDigest(BASE, SHA_2, [SHA_1, SHA_4, SHA_2]);
    expect(new Set([reference, differentBase, differentHead, differentCommits]).size).toBe(4);
  });
});
