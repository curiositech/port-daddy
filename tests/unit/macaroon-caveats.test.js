/**
 * Unit tests for the Port Daddy caveat grammar (ADR-0053 Appendix A §A.2).
 */
import { describe, expect, test } from '@jest/globals';
import {
  parseCaveat,
  checkCaveat,
  makeChecker,
  narrows,
  opCaveat,
  repoCaveat,
  branchCaveat,
  denyBranchCaveat,
  hostCaveat,
  spendCeilingCaveat,
  expiresCaveat,
  sessionCaveat,
} from '../../lib/macaroon/caveats.js';

const ctx = (over = {}) => ({ nowMs: 1_000_000, ...over });

describe('caveat builders produce parseable predicates', () => {
  test('every builder round-trips through parseCaveat', () => {
    expect(parseCaveat(opCaveat('push'))).toEqual({ field: 'op', op: '=', value: 'push' });
    expect(parseCaveat(repoCaveat('curiositech/port-daddy'))).toEqual({
      field: 'repo',
      op: '=',
      value: 'curiositech/port-daddy',
    });
    expect(parseCaveat(branchCaveat('feat/x-*'))).toEqual({
      field: 'branch',
      op: '=',
      value: 'feat/x-*',
    });
    expect(parseCaveat(denyBranchCaveat('main'))).toEqual({
      field: 'branch',
      op: '!=',
      value: 'main',
    });
    expect(parseCaveat(hostCaveat('api.anthropic.com'))).toEqual({
      field: 'host',
      op: '=',
      value: 'api.anthropic.com',
    });
    expect(parseCaveat(spendCeilingCaveat(2))).toEqual({
      field: 'spend_usd',
      op: '<=',
      value: '2.00',
    });
    expect(parseCaveat(expiresCaveat(1786000000000))).toEqual({
      field: 'expires',
      op: '=',
      value: '1786000000000',
    });
    expect(parseCaveat(sessionCaveat('session-abc'))).toEqual({
      field: 'session',
      op: '=',
      value: 'session-abc',
    });
  });
});

describe('parseCaveat rejects malformed / out-of-grammar predicates', () => {
  test('unknown field → null', () => {
    expect(parseCaveat('color = blue')).toBeNull();
  });
  test('illegal operator for field → null', () => {
    expect(parseCaveat('repo <= x')).toBeNull();
    expect(parseCaveat('spend_usd = 2')).toBeNull();
  });
  test('empty value → null', () => {
    expect(parseCaveat('op = ')).toBeNull();
  });
  test('garbage → null', () => {
    expect(parseCaveat('just some words')).toBeNull();
  });
});

describe('checkCaveat evaluates against a request context (fail-closed)', () => {
  test('op / repo / session equality', () => {
    expect(checkCaveat(opCaveat('push'), ctx({ op: 'push' }))).toBe(true);
    expect(checkCaveat(opCaveat('push'), ctx({ op: 'api-call' }))).toBe(false);
    expect(checkCaveat(repoCaveat('a/b'), ctx({ repo: 'a/b' }))).toBe(true);
    expect(checkCaveat(repoCaveat('a/b'), ctx({ repo: 'a/c' }))).toBe(false);
    expect(checkCaveat(sessionCaveat('s1'), ctx({ session: 's1' }))).toBe(true);
  });

  test('absent context field fails closed', () => {
    expect(checkCaveat(hostCaveat('api.x'), ctx())).toBe(false);
    expect(checkCaveat(opCaveat('push'), ctx())).toBe(false);
  });

  test('branch glob match and protected-ref deny', () => {
    expect(checkCaveat(branchCaveat('feat/dom-daddy-*'), ctx({ branch: 'feat/dom-daddy-1' }))).toBe(
      true,
    );
    expect(checkCaveat(branchCaveat('feat/dom-daddy-*'), ctx({ branch: 'feat/other' }))).toBe(false);
    expect(checkCaveat(denyBranchCaveat('main'), ctx({ branch: 'feat/x' }))).toBe(true);
    expect(checkCaveat(denyBranchCaveat('main'), ctx({ branch: 'main' }))).toBe(false);
  });

  test('spend ceiling is inclusive', () => {
    expect(checkCaveat(spendCeilingCaveat(2), ctx({ spendUsd: 1.5 }))).toBe(true);
    expect(checkCaveat(spendCeilingCaveat(2), ctx({ spendUsd: 2.0 }))).toBe(true);
    expect(checkCaveat(spendCeilingCaveat(2), ctx({ spendUsd: 2.01 }))).toBe(false);
  });

  test('expiry compares against injected nowMs', () => {
    expect(checkCaveat(expiresCaveat(1_000_001), ctx({ nowMs: 1_000_000 }))).toBe(true);
    expect(checkCaveat(expiresCaveat(999_999), ctx({ nowMs: 1_000_000 }))).toBe(false);
  });
});

describe('makeChecker binds a context for verify()', () => {
  test('returns a predicate evaluator', () => {
    const check = makeChecker(ctx({ op: 'push', branch: 'feat/x' }));
    expect(check(opCaveat('push'))).toBe(true);
    expect(check(branchCaveat('feat/x'))).toBe(true);
    expect(check(branchCaveat('release/*'))).toBe(false);
  });
});

describe('narrows() — the CAP_ESCALATION attenuation monitor', () => {
  test('a lower spend ceiling narrows; a higher one is a broadening attempt', () => {
    expect(narrows([spendCeilingCaveat(2)], spendCeilingCaveat(1))).toBe(true);
    expect(narrows([spendCeilingCaveat(2)], spendCeilingCaveat(5))).toBe(false);
  });

  test('a sooner expiry narrows; a later one is broadening', () => {
    expect(narrows([expiresCaveat(2000)], expiresCaveat(1500))).toBe(true);
    expect(narrows([expiresCaveat(2000)], expiresCaveat(3000))).toBe(false);
  });

  test('adding a caveat on a not-yet-bounded field is always a narrowing', () => {
    expect(narrows([opCaveat('push')], spendCeilingCaveat(2))).toBe(true);
    expect(narrows([], branchCaveat('feat/x'))).toBe(true);
  });

  test('branch globs narrow by language-subset, not equality', () => {
    // A more specific branch under the parent glob is valid attenuation.
    expect(narrows([branchCaveat('feat/*')], branchCaveat('feat/x'))).toBe(true);
    expect(narrows([branchCaveat('feat/*')], branchCaveat('feat/dom-*'))).toBe(true);
    expect(narrows([branchCaveat('feat/x')], branchCaveat('feat/x'))).toBe(true);
    // Broadening attempts: a wider glob, or a disjoint branch.
    expect(narrows([branchCaveat('feat/*')], branchCaveat('*'))).toBe(false);
    expect(narrows([branchCaveat('feat/*')], branchCaveat('other/x'))).toBe(false);
  });

  test('re-binding an equality field to a different value is flagged', () => {
    expect(narrows([repoCaveat('a/b')], repoCaveat('a/b'))).toBe(true);
    expect(narrows([repoCaveat('a/b')], repoCaveat('a/c'))).toBe(false);
    expect(narrows([sessionCaveat('s1')], sessionCaveat('s2'))).toBe(false);
  });

  test('an unparseable candidate is rejected', () => {
    expect(narrows([], 'color = blue')).toBe(false);
  });
});
