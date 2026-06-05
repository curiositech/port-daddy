/**
 * Unit tests for lib/cap-attenuation-monitor.ts
 *
 * Runtime-verification (the Arbiter pattern): compile the proven invariant I4
 * — "delegated capabilities can only be restricted, never expanded" — into a
 * pure-TS runtime monitor. This is the operational twin of the ProVerif proofs
 * harbor_card_v5 (single-hop) and v7 (per-hop multi-hop): the daemon's
 * CAP_ESCALATION Arbiter rule depends on a Rust FFI enforcer that is absent in
 * dev/test, silently degrading to "advisory only" (the watchman asleep). This
 * monitor keeps the watchman awake in pure TS.
 *
 * Capability grammar (ADR-0027): prefix caps `chan:pub:<prefix>` /
 * `chan:sub:<prefix>` (broader prefix dominates narrower); exact caps
 * (`spawn:agent`, `presence:write`, `backend:<id>`, …); `*` wildcard at the
 * value position dominates all values of that verb.
 */

import {
  isCapCovered,
  isAttenuation,
  checkDelegation,
  checkChain,
} from '../../lib/cap-attenuation-monitor.js';

describe('cap-attenuation: single capability coverage', () => {
  test('exact cap is covered only by itself', () => {
    expect(isCapCovered('spawn:agent', ['spawn:agent'])).toBe(true);
    expect(isCapCovered('spawn:agent', ['presence:write'])).toBe(false);
    expect(isCapCovered('backend:claude', ['backend:claude', 'spawn:agent'])).toBe(true);
    expect(isCapCovered('backend:openai', ['backend:claude'])).toBe(false);
  });

  test('prefix cap: a narrower child prefix is covered by a broader parent', () => {
    expect(isCapCovered('chan:pub:a/b', ['chan:pub:a'])).toBe(true);    // narrower ⊆ broader
    expect(isCapCovered('chan:pub:a', ['chan:pub:a'])).toBe(true);      // equal
    expect(isCapCovered('chan:pub:a', ['chan:pub:a/b'])).toBe(false);   // broaden = escalation
    expect(isCapCovered('chan:pub:ab', ['chan:pub:a'])).toBe(false);    // prefix-sibling, not under
  });

  test('verb must match: pub is not covered by sub', () => {
    expect(isCapCovered('chan:pub:a', ['chan:sub:a'])).toBe(false);
  });

  test('wildcard parent dominates all values of its verb', () => {
    expect(isCapCovered('chan:pub:anything/deep', ['chan:pub:*'])).toBe(true);
    expect(isCapCovered('chan:sub:x', ['chan:pub:*'])).toBe(false); // verb still must match
  });
});

describe('cap-attenuation: set attenuation (every child cap covered)', () => {
  test('subset is attenuation', () => {
    const r = isAttenuation(['chan:pub:a/b'], ['chan:pub:a', 'spawn:agent']);
    expect(r.ok).toBe(true);
    expect(r.expanded).toEqual([]);
  });

  test('any uncovered child cap is an expansion', () => {
    const r = isAttenuation(['chan:pub:a', 'backend:openai'], ['chan:pub:a', 'backend:claude']);
    expect(r.ok).toBe(false);
    expect(r.expanded).toEqual(['backend:openai']);
  });

  test('empty child set conveys no authority → always attenuation', () => {
    expect(isAttenuation([], ['chan:pub:a']).ok).toBe(true);
  });
});

describe('cap-attenuation: single-hop delegation check (I4)', () => {
  test('valid attenuation → no violation', () => {
    expect(checkDelegation(['chan:pub:a'], ['chan:pub:a/b'])).toBeNull();
  });

  test('escalation → violation names the expanded caps', () => {
    const v = checkDelegation(['chan:pub:a/b'], ['chan:pub:a']); // broaden = escalate
    expect(v).not.toBeNull();
    expect(v.invariant).toBe('CapAttenuation');
    expect(v.expandedCaps).toEqual(['chan:pub:a']);
  });
});

describe('cap-attenuation: per-hop chain check (the v7 discipline)', () => {
  test('monotonically narrowing chain → no violation', () => {
    const chain = [['chan:pub:a'], ['chan:pub:a/b'], ['chan:pub:a/b/c']];
    expect(checkChain(chain)).toBeNull();
  });

  test('middle-hop escalation is caught at the right hop (v6 attack → caught)', () => {
    // A:pub:* → B:pub:a (legit narrowing) → C:pub:* (escalation back to broad)
    const chain = [['chan:pub:*'], ['chan:pub:a'], ['chan:pub:*']];
    const v = checkChain(chain);
    expect(v).not.toBeNull();
    expect(v.hop).toBe(2);                     // B→C is the offending hop
    expect(v.expandedCaps).toEqual(['chan:pub:*']);
  });

  test('final-vs-root would MISS this; per-hop catches it (regression vs naive verifier)', () => {
    // final (pub:*) ⊆ root (pub:*) is true — a naive final-vs-root check passes.
    // Per-hop must still fail at B→C. This is exactly harbor_card_v6 vs v7.
    const chain = [['chan:pub:*'], ['chan:pub:a'], ['chan:pub:*']];
    expect(checkChain(chain).hop).toBe(2);
  });

  test('a single-element chain (root only) is trivially fine', () => {
    expect(checkChain([['chan:pub:a']])).toBeNull();
  });
});
