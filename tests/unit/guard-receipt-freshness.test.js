import { describe, expect, test } from '@jest/globals';
import { DEFAULT_GUARD_CONFIG, evaluateGuardFacts } from '../../cli/commands/guard.js';

const now = 1_788_000_000_000;
const evaluate = (agentId, receipt, nowMs = now) => evaluateGuardFacts({
  config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce', requireClaims: false },
  active: true, atCommitTime: true, files: ['cli/commands/guard.ts'],
  agentId, sessionId: 'synthetic-session', nowMs, roadmapReceipts: [receipt],
}).violations.some((violation) => violation.code === 'roadmap-receipt-missing');

describe('per-author roadmap freshness', () => {
  test('writer B cannot refresh promoter A through shared lastTouchedAt', () => {
    const receipt = { slug: 'existing-plan', promotedByAgentId: 'A', promotedAt: 1, lastTouchedAt: now,
      notes: [{ at: 1, by: 'A', text: 'Historical A work' }, { at: now, by: 'B', text: 'Current B work' }] };
    expect(evaluate('A', receipt)).toBe(true);
    expect(evaluate('B', receipt)).toBe(false);
  });
  test.each([NaN, Infinity, -Infinity, 0, -1, now + 1, now + 0.5, Number.MAX_SAFE_INTEGER])('rejects invalid or future note timestamp %s', (at) => {
    expect(evaluate('A', { slug: 'plan', lastTouchedAt: now, promotedByAgentId: 'A', notes: [{ at, by: 'A' }] })).toBe(true);
  });
  test('exact current own note counts, regardless of stale shared touch metadata', () => {
    expect(evaluate('A', { slug: 'plan', lastTouchedAt: 1, promotedByAgentId: 'B', notes: [{ at: now, by: 'A' }] })).toBe(false);
  });
  test('same-label substring, absent author and a rollback-future receipt do not count', () => {
    expect(evaluate('A', { slug: 'plan', notes: [{ at: now, by: 'AA' }] })).toBe(true);
    expect(evaluate(null, { slug: 'plan', notes: [{ at: now, by: null }] })).toBe(true);
    expect(evaluate('A', { slug: 'plan', notes: [{ at: now, by: 'A' }] }, now - 100)).toBe(true);
  });
});
