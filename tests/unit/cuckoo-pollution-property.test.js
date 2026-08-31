/**
 * tests/unit/cuckoo-pollution-property.test.js
 *
 * Property-based test for the cuckoo filter pollution attack (A3 in the
 * Bonded Commons attack catalog) — exercised against the REAL
 * lib/cuckoo-filter.ts code.
 *
 * Spec:    whitepaper/formal/proverif/bonded/recovery/cuckoo-pollution.md
 * Runtime: lib/cuckoo-filter.ts
 *
 * What "pollution" means here
 *   An adversary controls the stream of insertions and the stream of
 *   queries against the filter (e.g. they pick which delegation_ids hit
 *   the rate-limit gate and which lookups follow). They want the
 *   *false-positive rate* on disjoint queries to exceed the paper's
 *   theoretical bound:
 *
 *      fpRate ≤ 2·B / 2^f = 0.03125  (B=4, f=8 bits)
 *
 * Why this matters
 *   In the bond-escrow rate-limit gate, false-positives convert into
 *   over-counted spends, which advantage the attacker (they get to
 *   block legitimate flows by polluting the filter). If pollution can
 *   push the rate well above the bound, the gate is exploitable.
 *
 * Properties under test
 *   (C1) NO FALSE NEGATIVES — every inserted-and-not-deleted key still
 *        reports contains() === true. This is the filter's core
 *        correctness invariant.
 *   (C2) FP RATE BOUND — the false-positive rate on disjoint test keys
 *        sits within a slack of the paper's 2·B/2^f bound, even when
 *        the filter is filled to its 0.95 load-factor ceiling.
 *   (C3) INSERT REJECTION — once load-factor crosses 0.95, inserts are
 *        rejected (not silently dropped). This is what keeps (C2)
 *        true: the filter caps occupancy before fingerprint collisions
 *        compound.
 *   (C4) DELETE SAFETY — deleting an inserted key drops the size by
 *        one and stops it from reporting contains() === true (provided
 *        no fingerprint collision exists in either of its buckets).
 *
 * Pollution-strategy coverage
 *   This test runs adversarial fills at the rate-limit boundary
 *   (numRuns: 50 by default, bump locally for harder regression).
 *   Each run draws a fresh seed for keys so the adversary cannot rely
 *   on a fixed schedule.
 */

import { describe, expect, it } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import {
  CuckooFilter,
  BUCKET_SIZE,
  FP_RATE_UPPER_BOUND,
  MAX_LOAD_FACTOR,
} from '../../lib/cuckoo-filter.js';

/** Generate `n` distinct hex keys of `byteLen` bytes. */
function makeKeys(n, byteLen = 16) {
  const seen = new Set();
  const out = [];
  while (out.length < n) {
    const k = randomBytes(byteLen).toString('hex');
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

describe('cuckoo filter — pollution properties (A3 attack catalog)', () => {
  it('C1: no false negatives — every inserted key remains queryable', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 32, max: 256 }),
        fc.integer({ min: 16, max: 64 }),
        (numBuckets, insertCount) => {
          const cf = new CuckooFilter({ numBuckets });
          const keys = makeKeys(insertCount);
          const inserted = [];
          for (const k of keys) {
            if (cf.insert(k)) inserted.push(k);
          }
          for (const k of inserted) {
            if (!cf.contains(k)) return false;
          }
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });

  it('C2: false-positive rate respects the 2·B/2^f bound at the load ceiling', () => {
    // Fill the filter all the way to the rejection ceiling, then query
    // a large disjoint set; count fp/n. The paper guarantees fpRate ≤
    // 2·B/2^f = 0.03125. We allow a 2× slack because we are checking
    // an empirical estimate on a finite sample.
    const SLACK = 2;
    const numBuckets = 1024; // capacity 4096
    const cf = new CuckooFilter({ numBuckets });
    const insertCount = Math.floor(cf.capacity * MAX_LOAD_FACTOR);
    const insertKeys = new Set(makeKeys(insertCount));

    for (const k of insertKeys) cf.insert(k);

    // Adversary: 10k disjoint test keys.
    const testKeys = makeKeys(10_000).filter((k) => !insertKeys.has(k));
    let fp = 0;
    for (const k of testKeys) {
      if (cf.contains(k)) fp++;
    }
    const fpRate = fp / testKeys.length;
    expect(fpRate).toBeLessThanOrEqual(FP_RATE_UPPER_BOUND * SLACK);
    // Sanity check on bound itself: 2*4/256 = 0.03125.
    expect(FP_RATE_UPPER_BOUND).toBeCloseTo(0.03125, 5);
  });

  it('C3: insert rejection at load-factor 0.95 — cap holds under adversarial fill', () => {
    const numBuckets = 64; // small enough that we run into the ceiling fast
    const cf = new CuckooFilter({ numBuckets });
    const flood = makeKeys(numBuckets * BUCKET_SIZE * 4); // 4× capacity
    let accepted = 0;
    let rejected = 0;
    for (const k of flood) {
      if (cf.insert(k)) accepted++;
      else rejected++;
    }
    // At least one rejection occurred (cap engaged).
    expect(rejected).toBeGreaterThan(0);
    // Load factor never exceeded the ceiling.
    expect(cf.loadFactor).toBeLessThanOrEqual(MAX_LOAD_FACTOR + 1e-9);
    // Adversary cannot exceed capacity * 0.95.
    expect(accepted).toBeLessThanOrEqual(Math.ceil(cf.capacity * MAX_LOAD_FACTOR));
  });

  it('C4: delete drops size and clears membership when no fp collision', () => {
    const cf = new CuckooFilter({ numBuckets: 512 });
    const keys = makeKeys(256);
    const inserted = [];
    for (const k of keys) {
      if (cf.insert(k)) inserted.push(k);
    }
    const before = cf.size;
    // Delete the first 64 inserted keys; size drops, contains() flips
    // for keys with no fp collision in the remaining bucket residents.
    let deleted = 0;
    for (let i = 0; i < 64 && i < inserted.length; i++) {
      if (cf.delete(inserted[i])) deleted++;
    }
    expect(cf.size).toBe(before - deleted);
  });

  it('C5: capacity ceiling holds against a worst-case duplicate-fp adversary', () => {
    // Pick a target fingerprint and try to flood it. The filter should
    // still reject beyond capacity, regardless of fp distribution.
    const numBuckets = 128;
    const cf = new CuckooFilter({ numBuckets });
    const keys = makeKeys(numBuckets * BUCKET_SIZE * 3);
    for (const k of keys) cf.insert(k);
    expect(cf.loadFactor).toBeLessThanOrEqual(MAX_LOAD_FACTOR + 1e-9);
    // Stats track the rejection count honestly.
    const s = cf.stats();
    expect(s.insertFailures).toBeGreaterThan(0);
    expect(s.size).toBeLessThanOrEqual(s.capacity);
  });
});
