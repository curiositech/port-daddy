/**
 * Tests for lib/merkle-chain.ts.
 *
 * Most cases load golden vectors from tests/fixtures/merkle-chain-golden.json
 * which is regenerated from the Python reference scripts in
 * skills/pd-relay-zero-trust/scripts/. The TS implementation must produce
 * the same hashes, the same signed-head bytes, and the same VerifyResult
 * shape as Python.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import {
  ZERO_HASH,
  bytesToHex,
  canonicalJson,
  hexToBytes,
  head_message,
  next_hash,
  next_hash_fields,
  sign_head,
  verify_chain,
  verify_head,
  type ChainEntry,
  type ChainHeadInput,
  type SignedChainHead,
} from '../../lib/merkle-chain';

interface GoldenFixture {
  meta: {
    sha256_hash_input_format: string;
    canonical_json_rule: string;
    ed25519: { seed_hex: string; public_key_hex: string };
  };
  cases: {
    empty: { events: ChainEntry[]; verify: ReturnType<typeof verify_chain> };
    single: { events: ChainEntry[]; verify: ReturnType<typeof verify_chain> };
    five: {
      events: ChainEntry[];
      verify: ReturnType<typeof verify_chain>;
      canonical_ciphertext_event0: string;
    };
    tampered: { events: ChainEntry[]; verify: ReturnType<typeof verify_chain> };
    equivocation: {
      head_a: SignedChainHead;
      head_b: SignedChainHead;
      head_a_signed_message: string;
    };
    sign_head_round_trip: { input: ChainHeadInput; output: SignedChainHead };
  };
}

const fixturePath = join(__dirname, '..', 'fixtures', 'merkle-chain-golden.json');
const golden = JSON.parse(readFileSync(fixturePath, 'utf-8')) as GoldenFixture;

describe('canonicalJson', () => {
  test('sorts object keys', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test('sorts nested keys', () => {
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: 1 })).toBe(
      '{"a":1,"z":{"x":2,"y":1}}',
    );
  });

  test('omits whitespace', () => {
    expect(canonicalJson({ a: [1, 2, 3] })).toBe('{"a":[1,2,3]}');
  });

  test('emits non-ASCII verbatim (matches ensure_ascii=False)', () => {
    // Python's json.dumps(..., ensure_ascii=False) outputs raw UTF-8.
    expect(canonicalJson({ unicode: 'Café' })).toBe('{"unicode":"Café"}');
  });

  test('handles null, true, false', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
  });

  test('matches the canonical bytes embedded in the golden fixture', () => {
    const event0Ct = golden.cases.five.events[0].ciphertext;
    expect(canonicalJson(event0Ct)).toBe(
      golden.cases.five.canonical_ciphertext_event0,
    );
  });

  test('refuses unsupported types', () => {
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson(BigInt(1))).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('next_hash and next_hash_fields', () => {
  test('reproduces every this_hash in the 5-event golden chain', () => {
    let prev = ZERO_HASH;
    for (const evt of golden.cases.five.events) {
      const computed = next_hash_fields({
        prev_hash: prev,
        sender: evt.sender,
        channel: evt.channel,
        seq: evt.seq,
        iat: evt.iat,
        ciphertext: evt.ciphertext,
      });
      expect(computed).toBe(evt.this_hash);
      prev = computed;
    }
  });

  test('next_hash(prev, event) shorthand matches the structured form', () => {
    const evt = golden.cases.five.events[3];
    expect(next_hash(evt.prev_hash, evt)).toBe(evt.this_hash);
  });

  test('next_hash accepts string and Uint8Array inputs', () => {
    // These are not the same as the structured form; they're convenience
    // overloads for cases where the caller has already serialized.
    const a = next_hash('abc', 'def');
    const b = next_hash('abc', new TextEncoder().encode('def'));
    expect(a).toBe(b);
    // Sanity: known SHA-256 of "abcdef"
    expect(a).toBe('bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721');
  });
});

describe('verify_chain', () => {
  test('empty chain: ok with tip_seq=-1, tip_hash=ZERO_HASH', () => {
    const res = verify_chain(golden.cases.empty.events);
    expect(res).toEqual(golden.cases.empty.verify);
    expect(res.ok).toBe(true);
    expect(res.tip_hash).toBe(ZERO_HASH);
    expect(res.tip_seq).toBe(-1);
  });

  test('single event chain', () => {
    const res = verify_chain(golden.cases.single.events);
    expect(res).toEqual(golden.cases.single.verify);
  });

  test('5-event chain matches the Python golden VerifyResult', () => {
    const res = verify_chain(golden.cases.five.events);
    expect(res).toEqual(golden.cases.five.verify);
  });

  test('tampered event[2] reports this_hash_mismatch at seq=2', () => {
    const res = verify_chain(golden.cases.tampered.events);
    expect(res).toEqual(golden.cases.tampered.verify);
    expect(res.ok).toBe(false);
    expect(res.first_break?.seq).toBe(2);
    expect(res.first_break?.reason).toBe('this_hash_mismatch');
  });

  test('seq gap is detected', () => {
    const events = JSON.parse(
      JSON.stringify(golden.cases.five.events),
    ) as ChainEntry[];
    // Skip seq=2: drop the third entry
    events.splice(2, 1);
    const res = verify_chain(events);
    expect(res.ok).toBe(false);
    expect(res.first_break?.reason).toBe('seq_gap');
    expect(res.first_break?.seq).toBe(3);
  });

  test('prev_hash mismatch is detected', () => {
    const events = JSON.parse(
      JSON.stringify(golden.cases.five.events),
    ) as ChainEntry[];
    events[3].prev_hash = '00'.repeat(32);
    const res = verify_chain(events);
    expect(res.ok).toBe(false);
    expect(res.first_break?.reason).toBe('prev_hash_mismatch');
    expect(res.first_break?.seq).toBe(3);
  });

  test('expected_sender mismatch is detected on first event', () => {
    const res = verify_chain(golden.cases.five.events, {
      expected_sender: 'somebody-else',
    });
    expect(res.ok).toBe(false);
    expect(res.first_break?.reason).toBe('sender_mismatch');
  });
});

describe('sign_head and verify_head', () => {
  const seed = hexToBytes(golden.meta.ed25519.seed_hex);
  const pub = hexToBytes(golden.meta.ed25519.public_key_hex);

  test('head_message matches the Python-produced canonical bytes', () => {
    const want = golden.cases.equivocation.head_a_signed_message;
    const got = new TextDecoder().decode(
      head_message({
        sender: golden.cases.equivocation.head_a.sender,
        channel: golden.cases.equivocation.head_a.channel,
        tip_seq: golden.cases.equivocation.head_a.tip_seq,
        tip_hash: golden.cases.equivocation.head_a.tip_hash,
        issued_at: golden.cases.equivocation.head_a.issued_at,
        anchors: golden.cases.equivocation.head_a.anchors,
      }),
    );
    expect(got).toBe(want);
  });

  test('sign_head produces byte-identical output to the Python reference', () => {
    const signed = sign_head(golden.cases.sign_head_round_trip.input, seed);
    expect(signed).toEqual(golden.cases.sign_head_round_trip.output);
  });

  test('verify_head accepts a TS-produced head', () => {
    const signed = sign_head(golden.cases.sign_head_round_trip.input, seed);
    expect(verify_head(signed, pub)).toBe(true);
  });

  test('verify_head accepts a Python-produced head (cross-language)', () => {
    expect(verify_head(golden.cases.equivocation.head_a, pub)).toBe(true);
    expect(verify_head(golden.cases.equivocation.head_b, pub)).toBe(true);
  });

  test('verify_head rejects a head with a tampered tip_hash', () => {
    const tampered: SignedChainHead = {
      ...golden.cases.equivocation.head_a,
      tip_hash: '00'.repeat(32),
    };
    expect(verify_head(tampered, pub)).toBe(false);
  });

  test('verify_head rejects a head with a swapped signature', () => {
    const swapped: SignedChainHead = {
      ...golden.cases.equivocation.head_a,
      sig: golden.cases.equivocation.head_b.sig,
    };
    expect(verify_head(swapped, pub)).toBe(false);
  });

  test('verify_head rejects non-EdDSA alg', () => {
    const bogus = {
      ...golden.cases.equivocation.head_a,
      alg: 'HS256' as unknown as 'EdDSA',
    };
    expect(verify_head(bogus, pub)).toBe(false);
  });

  test('verify_head returns false on malformed sig hex', () => {
    const bogus: SignedChainHead = {
      ...golden.cases.equivocation.head_a,
      sig: 'zz', // not hex
    };
    expect(verify_head(bogus, pub)).toBe(false);
  });

  test('sign_head rejects non-32-byte seeds', () => {
    expect(() =>
      sign_head(golden.cases.sign_head_round_trip.input, new Uint8Array(31)),
    ).toThrow();
  });
});

describe('equivocation detection', () => {
  test('two signed heads at the same tip_seq with different tip_hash both verify; consumers can compare and detect the fork', () => {
    const pub = hexToBytes(golden.meta.ed25519.public_key_hex);
    const a = golden.cases.equivocation.head_a;
    const b = golden.cases.equivocation.head_b;

    expect(verify_head(a, pub)).toBe(true);
    expect(verify_head(b, pub)).toBe(true);
    expect(a.tip_seq).toBe(b.tip_seq);
    expect(a.tip_hash).not.toBe(b.tip_hash);
  });
});

describe('hex helpers', () => {
  test('round-trip', () => {
    const b = new Uint8Array([0, 1, 2, 0xff, 0x10]);
    expect(hexToBytes(bytesToHex(b))).toEqual(b);
  });

  test('hexToBytes rejects odd-length input', () => {
    expect(() => hexToBytes('abc')).toThrow();
  });
});
