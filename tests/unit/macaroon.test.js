/**
 * Unit tests for the macaroon core crypto (ADR-0053 Phase 1).
 *
 * These exercise the construction invariants the whole enforcement story rests
 * on: the chained signature catches tampering, authority can only narrow, and a
 * third-party caveat cannot be satisfied without a correctly-keyed, request-bound
 * discharge macaroon.
 */
import { describe, expect, test } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import {
  create,
  addFirstPartyCaveat,
  addThirdPartyCaveat,
  prepareForRequest,
  verify,
  serialize,
  deserialize,
} from '../../lib/macaroon/macaroon.js';

const ALWAYS = () => true;
const NEVER = () => false;

describe('macaroon core — minting and first-party caveats', () => {
  test('a freshly minted macaroon verifies under its root key', () => {
    const root = randomBytes(32);
    const m = create(root, 'grant-1', 'pd://daemon/repo');
    expect(verify(m, root, [], ALWAYS).ok).toBe(true);
  });

  test('a wrong root key fails verification', () => {
    const m = create(randomBytes(32), 'grant-1', 'pd://daemon/repo');
    const res = verify(m, randomBytes(32), [], ALWAYS);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/signature mismatch/);
  });

  test('a satisfied first-party caveat verifies; an unsatisfied one fails', () => {
    const root = randomBytes(32);
    const m = addFirstPartyCaveat(create(root, 'g', 'loc'), 'op = push');
    expect(verify(m, root, [], (p) => p === 'op = push').ok).toBe(true);
    const res = verify(m, root, [], NEVER);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('op = push');
  });

  test('addFirstPartyCaveat does not mutate its input (functional attenuation)', () => {
    const root = randomBytes(32);
    const base = create(root, 'g', 'loc');
    const sigBefore = base.signature;
    const narrowed = addFirstPartyCaveat(base, 'branch = feat/x');
    expect(base.signature).toBe(sigBefore);
    expect(base.caveats).toHaveLength(0);
    expect(narrowed.caveats).toHaveLength(1);
    expect(narrowed.signature).not.toBe(sigBefore);
  });

  test('attenuation is one-directional: removing a caveat breaks the signature', () => {
    const root = randomBytes(32);
    const m = addFirstPartyCaveat(
      addFirstPartyCaveat(create(root, 'g', 'loc'), 'op = push'),
      'branch = feat/x',
    );
    // Forge: strip the last caveat but keep the (now-stale) signature.
    const forged = { ...m, caveats: [m.caveats[0]] };
    expect(verify(forged, root, [], ALWAYS).ok).toBe(false);
  });

  test('tampering with a caveat predicate breaks the signature', () => {
    const root = randomBytes(32);
    const m = addFirstPartyCaveat(create(root, 'g', 'loc'), 'spend_usd <= 2.00');
    const forged = { ...m, caveats: [{ cid: 'spend_usd <= 9999.00' }] };
    // Even a checker that would accept the forged predicate must fail: the MAC
    // no longer matches.
    expect(verify(forged, root, [], ALWAYS).ok).toBe(false);
  });
});

describe('macaroon core — third-party caveats and discharge', () => {
  function mintWithThirdParty() {
    const root = randomBytes(32);
    const caveatKey = randomBytes(32);
    const caveatId = 'rent:session-abc:nonce-xyz';
    const m = addThirdPartyCaveat(
      addFirstPartyCaveat(create(root, 'grant', 'pd://daemon/repo'), 'op = push'),
      caveatKey,
      caveatId,
      'pd://daemon/rent',
    );
    return { root, caveatKey, caveatId, m };
  }

  test('verifies when a correctly-keyed, request-bound discharge is presented', () => {
    const { root, caveatKey, caveatId, m } = mintWithThirdParty();
    const discharge = create(caveatKey, caveatId, 'pd://daemon/rent');
    const bound = prepareForRequest(m, discharge);
    expect(verify(m, root, [bound], ALWAYS).ok).toBe(true);
  });

  test('fails when the discharge is missing entirely', () => {
    const { root, m } = mintWithThirdParty();
    const res = verify(m, root, [], ALWAYS);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no discharge macaroon/);
  });

  test('fails when the discharge is present but not bound to this request', () => {
    const { root, caveatKey, caveatId, m } = mintWithThirdParty();
    const unbound = create(caveatKey, caveatId, 'pd://daemon/rent');
    const res = verify(m, root, [unbound], ALWAYS);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/signature mismatch/);
  });

  test('fails when the discharge is signed with the wrong caveat key', () => {
    const { root, caveatId, m } = mintWithThirdParty();
    const wrong = create(randomBytes(32), caveatId, 'pd://daemon/rent');
    const bound = prepareForRequest(m, wrong);
    expect(verify(m, root, [bound], ALWAYS).ok).toBe(false);
  });

  test('a discharge bound to a different root macaroon does not transfer', () => {
    const a = mintWithThirdParty();
    const b = mintWithThirdParty();
    // Discharge minted for A, bound to A, presented against B.
    const dischargeA = prepareForRequest(a.m, create(a.caveatKey, a.caveatId, 'pd://daemon/rent'));
    expect(verify(b.m, b.root, [dischargeA], ALWAYS).ok).toBe(false);
  });

  test('first-party caveats on the discharge are also enforced', () => {
    const { root, caveatKey, caveatId, m } = mintWithThirdParty();
    // Discharge carries its own expiry caveat; verifier rejects it.
    const discharge = addFirstPartyCaveat(
      create(caveatKey, caveatId, 'pd://daemon/rent'),
      'discharge-expires = 123',
    );
    const bound = prepareForRequest(m, discharge);
    const res = verify(m, root, [bound], (p) => p === 'op = push');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('discharge-expires');
  });
});

describe('macaroon core — fail-closed on malformed / hostile input', () => {
  const root = randomBytes(32);

  test('a non-hex or wrong-length root signature is rejected, never thrown', () => {
    const m = create(root, 'g', 'loc');
    expect(() => verify({ ...m, signature: 'zzzz' }, root, [], ALWAYS)).not.toThrow();
    expect(verify({ ...m, signature: 'zzzz' }, root, [], ALWAYS).ok).toBe(false);
    expect(verify({ ...m, signature: 'ab' }, root, [], ALWAYS).ok).toBe(false);
    expect(verify({ ...m, signature: 'x'.repeat(64) }, root, [], ALWAYS).ok).toBe(false);
  });

  test('a malformed caveat object fails closed instead of crashing the gate', () => {
    const m = addFirstPartyCaveat(create(root, 'g', 'loc'), 'op = push');
    const bad = { ...m, caveats: [{ notcid: 1 }] };
    expect(() => verify(bad, root, [], ALWAYS)).not.toThrow();
    expect(verify(bad, root, [], ALWAYS).ok).toBe(false);
  });

  test('an oversized third-party vid is rejected without a large decode', () => {
    const root2 = randomBytes(32);
    const m = addThirdPartyCaveat(create(root2, 'g', 'loc'), randomBytes(32), 'cid', 'loc');
    const bloated = {
      ...m,
      caveats: [{ ...m.caveats[0], vid: 'a'.repeat(100_000) }],
    };
    expect(() => verify(bloated, root2, [], ALWAYS)).not.toThrow();
    expect(verify(bloated, root2, [], ALWAYS).ok).toBe(false);
  });

  test('deserialize rejects malformed caveat shapes', () => {
    const sig = 'a'.repeat(64);
    expect(() =>
      deserialize(JSON.stringify({ location: 'l', identifier: 'i', signature: sig, caveats: [{ notcid: 1 }] })),
    ).toThrow(/malformed/);
    expect(() =>
      deserialize(JSON.stringify({ location: 'l', identifier: 'i', signature: sig, caveats: [{ cid: 'x', vid: 'zz' }] })),
    ).toThrow(/malformed/);
    expect(() =>
      deserialize(JSON.stringify({ location: 'l', identifier: 'i', signature: 'short', caveats: [] })),
    ).toThrow(/malformed/);
  });
});

describe('macaroon core — serialization', () => {
  test('serialize/deserialize round-trips and preserves verifiability', () => {
    const root = randomBytes(32);
    const m = addFirstPartyCaveat(create(root, 'g', 'loc'), 'op = push');
    const round = deserialize(serialize(m));
    expect(round).toEqual(m);
    expect(verify(round, root, [], ALWAYS).ok).toBe(true);
  });

  test('deserialize rejects malformed input', () => {
    expect(() => deserialize('{"location":"x"}')).toThrow(/malformed/);
    expect(() => deserialize('not json')).toThrow();
  });
});
