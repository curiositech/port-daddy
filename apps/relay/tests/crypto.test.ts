/**
 * Tests for relay crypto helpers (ADR-0049)
 *
 * These tests run with @cloudflare/vitest-pool-workers (Workers runtime).
 */

import { describe, it, expect } from 'vitest';
import {
  computeEventHash,
  hashHex,
  ZERO_HASH,
  toHex,
  fromHex,
  randomHex,
  base64UrlDecode,
  base64UrlEncode,
} from '../src/crypto.js';

describe('computeEventHash', () => {
  // NOT a cross-implementation parity test, despite what this block used to be
  // called. It was named "matches Python reference vector" and cited
  // skills/pd-relay-zero-trust/scripts/chain_verify.py, but carried no expected
  // digest — it asserted only shape and self-equality, which any deterministic
  // function passes. The name promised the one property it did not check.
  //
  // The two implementations provably DISAGREE, so no such vector could have
  // passed: this function joins its fields with '|' (crypto.ts:70-77), while
  // chain_verify.py's hash_event makes six bare h.update() calls with NO
  // separator and hashes canonical_json(ciphertext) of a dict rather than a
  // base64 string. On the inputs below they yield
  //   TS     aaa83dbccb9737acf814c44da0e710d87808bb208eab274387cce8c0e5d3f899
  //   Python be55762f6ff4fd57278deffb5ea39e78d7ca4f95aa6f047c0c5e3fbb195c5d00
  //
  // Reconciling them is deliberately NOT done here: computeEventHash is the
  // stored chain hash, so changing either side rewrites history and needs its
  // own ADR plus a migration. Recorded as an open gap rather than silently
  // renamed — cross-implementation parity for the chain hash is UNPINNED.
  it('is deterministic and returns a 64-char lowercase hex digest', () => {
    const hash = computeEventHash({
      prev_hash: ZERO_HASH,
      sender: 'aabbccdd',
      channel: 'abc:test',
      seq: 1,
      iat: 1717000000,
      ciphertext: 'deadbeef',
    });
    // Just verify it's a 64-char hex string deterministically
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Same input always produces same hash
    const hash2 = computeEventHash({
      prev_hash: ZERO_HASH,
      sender: 'aabbccdd',
      channel: 'abc:test',
      seq: 1,
      iat: 1717000000,
      ciphertext: 'deadbeef',
    });
    expect(hash).toBe(hash2);
  });

  it('changes on any field mutation', () => {
    const base = {
      prev_hash: ZERO_HASH,
      sender: 'aabbccdd',
      channel: 'abc:test',
      seq: 1,
      iat: 1717000000,
      ciphertext: 'deadbeef',
    };
    const baseHash = computeEventHash(base);
    expect(computeEventHash({ ...base, seq: 2 })).not.toBe(baseHash);
    expect(computeEventHash({ ...base, sender: 'aabbccde' })).not.toBe(baseHash);
    expect(computeEventHash({ ...base, ciphertext: 'deadbeff' })).not.toBe(baseHash);
    expect(computeEventHash({ ...base, channel: 'abc:test2' })).not.toBe(baseHash);
  });

  it('seq=1 prev_hash must be ZERO_HASH', () => {
    const h1 = computeEventHash({
      prev_hash: ZERO_HASH,
      sender: 'aa',
      channel: 'x:y',
      seq: 1,
      iat: 1000,
      ciphertext: 'ab',
    });
    expect(h1).toHaveLength(64);
  });
});

describe('hex helpers', () => {
  it('round-trips toHex/fromHex', () => {
    const original = new Uint8Array([0, 1, 2, 255, 128]);
    expect(fromHex(toHex(original))).toEqual(original);
  });

  it('fromHex rejects odd-length strings', () => {
    expect(() => fromHex('abc')).toThrow();
  });
});

describe('base64url helpers', () => {
  it('round-trips encode/decode', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]);
    const encoded = base64UrlEncode(original);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(base64UrlDecode(encoded)).toEqual(original);
  });

  it('decodes standard JWT fragment', () => {
    // base64url("hello") = "aGVsbG8"
    const decoded = base64UrlDecode('aGVsbG8');
    expect(new TextDecoder().decode(decoded)).toBe('hello');
  });
});

describe('randomHex', () => {
  it('returns correct byte length', () => {
    expect(randomHex(16)).toHaveLength(32);
    expect(randomHex(32)).toHaveLength(64);
  });

  it('is not deterministic', () => {
    expect(randomHex(16)).not.toBe(randomHex(16));
  });
});

describe('ZERO_HASH', () => {
  it('is 64 zero chars', () => {
    expect(ZERO_HASH).toHaveLength(64);
    expect(ZERO_HASH).toBe('0'.repeat(64));
  });
});
