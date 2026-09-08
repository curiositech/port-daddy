/**
 * Cross-runtime parity gate for the hv:2 harbor card — **TypeScript half**.
 *
 * ADR-0120 rule 1: a security primitive gets one canonical implementation
 * (Rust), and a surface that cannot reach it over FFI implements a twin locked
 * to a shared fixture generated from the canonical side. The relay is exactly
 * that surface: the Workers runtime cannot `dlopen` `libharbor_card_rs`, so
 * `apps/relay/src/auth.ts` hand-implements hv:2 verification and this suite
 * pins it to `tests/fixtures/harbor-card-hv2-parity-vectors.json`. The Rust
 * half is `core/harbor-card-rs/tests/hv2_parity_vectors.rs`.
 *
 * The fixture is GENERATED FROM RUST and must not be edited here to make this
 * suite pass — that would reclassify a relay behavior change as expected
 * (ADR-0120 rule 4). Each vector carries an `expected.ts` column; this file
 * asserts only that column, and the fixture's `divergence` notes record every
 * place where `expected.ts` and `expected.rust` disagree.
 *
 * Scope note: `verifyCard` also refuses a card whose `jti` is in the D1
 * revocation table. That is stateful relay policy which the kernel crate
 * deliberately does not implement, so the D1 lookup is stubbed to "not
 * revoked" here and the fixture measures format verification only.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyCard, matchCapability, CardError } from '../src/auth.js';
import type { CapabilityEntry } from '../src/types.js';

interface CardVector {
  name: string;
  note: string;
  token: string;
  now_ts: number;
  required_op: 'pub' | 'sub' | 'admin';
  required_channel: string;
  issuer_public_key_hex: string;
  expected: { rust: string; ts: string };
  divergence?: string;
}

interface CapabilityVector {
  name: string;
  cap: CapabilityEntry[];
  required_op: 'pub' | 'sub' | 'admin';
  required_channel: string;
  expected_match: boolean;
}

interface Fixture {
  signing_scheme: string;
  issuer_public_key_hex: string;
  card_vectors: CardVector[];
  capability_vectors: CapabilityVector[];
  structured_subset_vectors_rust_only: { _comment: string; vectors: unknown[] };
}

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../tests/fixtures/harbor-card-hv2-parity-vectors.json', import.meta.url),
    'utf8',
  ),
) as Fixture;

/**
 * A D1 stand-in whose revocation lookup always answers "not revoked".
 * `isRevoked` issues `SELECT ... .first()`, which returns null for a miss.
 */
const notRevokedDb = {
  prepare: () => ({
    bind: () => ({ first: async () => null }),
  }),
} as unknown as D1Database;

/** Pin the wall clock a vector was generated against. */
function at(unixSeconds: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(unixSeconds * 1000));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('hv:2 harbor card parity (relay ⇄ core/harbor-card-rs shared fixture)', () => {
  it('fixture is present, non-trivial, and pins the signing scheme', () => {
    expect(fixture.card_vectors.length).toBeGreaterThanOrEqual(15);
    expect(fixture.capability_vectors.length).toBeGreaterThanOrEqual(10);
    // The construction this whole file exists to keep honest: the signature
    // covers the SHA-256 digest of the signing input, not the input itself.
    expect(fixture.signing_scheme).toContain('SHA-256');
  });

  for (const v of fixture.card_vectors) {
    it(`${v.name}: auth.ts yields ${v.expected.ts}`, async () => {
      at(v.now_ts);
      const verify = () =>
        verifyCard(
          v.token,
          notRevokedDb,
          v.issuer_public_key_hex,
          v.required_op,
          v.required_channel,
        );

      if (v.expected.ts === 'accept') {
        const payload = await verify();
        expect(payload.hv).toBe(2);
        expect(matchCapability(payload.cap, v.required_op, v.required_channel)).not.toBeNull();
        return;
      }

      // Refusals must be typed CardErrors carrying the recorded code — a
      // generic throw would mean the relay refused for a reason nobody modelled.
      await expect(verify()).rejects.toBeInstanceOf(CardError);
      await expect(verify()).rejects.toMatchObject({ code: v.expected.ts });
    });
  }
});

describe('matchCapability grammar parity (op admin-wildcard + channel globs)', () => {
  for (const v of fixture.capability_vectors) {
    it(`${v.name}: ${v.expected_match ? 'matches' : 'does not match'}`, () => {
      const matched = matchCapability(v.cap, v.required_op, v.required_channel);
      expect(matched !== null).toBe(v.expected_match);
    });
  }
});

describe('declared divergences between the two verifiers', () => {
  it('every vector whose columns disagree carries a written reason', () => {
    const equivalent: Record<string, string> = {
      accept: 'accept',
      InvalidSignature: 'BAD_SIG',
      Expired: 'EXPIRED',
      NotYetValid: 'NOT_YET_VALID',
      WrongVersion: 'WRONG_VERSION',
      UnsupportedAlgorithm: 'WRONG_ALG',
      Malformed: 'MALFORMED',
      InsufficientCapability: 'INSUFFICIENT_CAP',
    };
    for (const v of fixture.card_vectors) {
      if (equivalent[v.expected.rust] !== v.expected.ts) {
        expect(v.divergence, `vector ${v.name} diverges with no explanation`).toBeTruthy();
      }
    }
  });

  it('does not claim to implement the Rust-only structured attenuation check', () => {
    // `verify_capability_subset_structured` (pattern-covers-pattern + ceiling
    // attenuation) has no counterpart in auth.ts, which only ever asks whether
    // a card grants the concrete channel in front of it. The fixture keeps
    // those vectors in a clearly-labelled Rust-only section and this suite
    // asserts the label rather than quietly re-implementing the grammar — a
    // third implementation is what ADR-0120 rule 3 forbids.
    expect(fixture.structured_subset_vectors_rust_only.vectors.length).toBeGreaterThan(0);
    expect(fixture.structured_subset_vectors_rust_only._comment).toContain('NO counterpart');
  });
});
