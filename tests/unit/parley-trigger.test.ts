/**
 * Tests for `lib/parley-trigger.ts` (RCP-2a) — the parley entry gate. Pure.
 */

import { describe, test, expect } from '@jest/globals';
import { shouldConvene } from '../../lib/parley-trigger.js';
import type { ThreadDigest } from '../../lib/discourse-lineage.js';

/** Minimal ThreadDigest with `n` unresolved contradictions. */
function digest(n: number): ThreadDigest {
  const edges = Array.from({ length: n }, (_, i) => ({
    from: 100 + i, to: i, sender: 'a', relationship: 'contradicts' as const,
  }));
  return {
    total: n + 1,
    participants: ['a', 'b'],
    roots: [0],
    maxDepth: 1,
    byRelationship: { supports: 0, contradicts: n, extends: 0, narrows: 0, synthesizes: 0 },
    byPerformative: {},
    contradictions: edges,
    unresolvedContradictions: edges,
    typed: n > 0,
  };
}

describe('shouldConvene', () => {
  test('convenes (debate-with-judge) when expected waste beats the parley cost', () => {
    const d = shouldConvene(digest(2), { wastePerUnresolved: 10, parleyCost: 5 });
    expect(d.convene).toBe(true);
    expect(d.shape).toBe('debate-with-judge');
    expect(d.expectedWaste).toBe(20);
    expect(d.margin).toBe(15);
    expect(d.terminated).toBeNull();
  });

  test('holds when the conflict costs less than coordinating', () => {
    const d = shouldConvene(digest(1), { wastePerUnresolved: 1, parleyCost: 5 });
    expect(d.convene).toBe(false);
    expect(d.expectedWaste).toBe(1);
    expect(d.reason).toMatch(/costs more than the conflict|≤/);
  });

  test('does not convene when there are no unresolved contradictions', () => {
    const d = shouldConvene(digest(0), { wastePerUnresolved: 100, parleyCost: 1 });
    expect(d.convene).toBe(false);
    expect(d.unresolved).toBe(0);
    expect(d.reason).toMatch(/no unresolved contradictions/);
  });

  test('pFail scales the expected waste', () => {
    const d = shouldConvene(digest(2), { wastePerUnresolved: 10, parleyCost: 5, pFail: 0.1 });
    expect(d.expectedWaste).toBeCloseTo(2); // 0.1 * 10 * 2
    expect(d.convene).toBe(false);          // 2 ≤ 5
  });

  test('pFail is clamped to [0,1]', () => {
    const hi = shouldConvene(digest(1), { wastePerUnresolved: 10, parleyCost: 1, pFail: 5 });
    expect(hi.expectedWaste).toBe(10); // clamped to 1
    const lo = shouldConvene(digest(1), { wastePerUnresolved: 10, parleyCost: 1, pFail: -3 });
    expect(lo.expectedWaste).toBe(0);  // clamped to 0
    expect(lo.convene).toBe(false);
  });

  test('hard-terminates at max rounds, regardless of economics', () => {
    const d = shouldConvene(
      digest(5),
      { wastePerUnresolved: 1000, parleyCost: 1 }, // economics scream convene
      { priorRounds: 2, maxRounds: 2 },
    );
    expect(d.convene).toBe(false);
    expect(d.terminated).toBe('max-rounds');
    expect(d.reason).toMatch(/escalate to the operator/);
  });

  test('hard-terminates on excessive delegation depth (ping-pong guard)', () => {
    const d = shouldConvene(
      digest(3),
      { wastePerUnresolved: 1000, parleyCost: 1 },
      { delegationDepth: 9, maxDelegationDepth: 4 },
    );
    expect(d.convene).toBe(false);
    expect(d.terminated).toBe('delegation-depth');
  });

  test('within limits, economics decide', () => {
    const d = shouldConvene(
      digest(3),
      { wastePerUnresolved: 10, parleyCost: 5 },
      { priorRounds: 1, maxRounds: 2, delegationDepth: 2, maxDelegationDepth: 4 },
    );
    expect(d.convene).toBe(true);
    expect(d.terminated).toBeNull();
  });
});
