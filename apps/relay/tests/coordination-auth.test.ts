import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  coordinationMacaroonFromRequest,
  mintCoordinationMacaroon,
  verifyCoordinationMacaroon,
} from '../src/coordination-auth.js';
import { base64UrlEncode } from '../src/crypto.js';

const ROOT = '42'.repeat(32);
const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);

interface FirstPartyParityVector {
  root_key_utf8: string;
  first_party: {
    identifier: string;
    location: string;
    caveats: string[];
    expected_signature_hex: string;
  };
}

function utf8Hex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('coordination macaroon gate', () => {
  it('mints a project + actor + verb + expiry scoped grant', () => {
    const grant = mintCoordinationMacaroon(ROOT, 'curiositech/port-daddy', 'cloud-sandbox', {
      nowMs: NOW,
      ttlMs: 60_000,
    });
    expect(grant.macaroon.caveats.map((caveat) => caveat.cid)).toEqual([
      'op = coordination-sync',
      'repo = curiositech/port-daddy',
      'session = cloud-sandbox',
      `expires = ${NOW + 60_000}`,
    ]);
    expect(verifyCoordinationMacaroon(grant.token, ROOT, {
      project: 'curiositech/port-daddy', actorId: 'cloud-sandbox', nowMs: NOW + 1,
    })).toMatchObject({ authorized: true, reason: 'verified' });
  });

  it('rejects another project, another actor, expiry, and tampering', () => {
    const grant = mintCoordinationMacaroon(ROOT, 'curiositech/port-daddy', 'cloud-sandbox', {
      nowMs: NOW,
      ttlMs: 100,
    });
    expect(verifyCoordinationMacaroon(grant.token, ROOT, {
      project: 'other/repo', actorId: 'cloud-sandbox', nowMs: NOW,
    }).reason).toMatch(/project/);
    expect(verifyCoordinationMacaroon(grant.token, ROOT, {
      project: 'curiositech/port-daddy', actorId: 'local-daemon', nowMs: NOW,
    }).reason).toMatch(/actor/);
    expect(verifyCoordinationMacaroon(grant.token, ROOT, {
      project: 'curiositech/port-daddy', actorId: 'cloud-sandbox', nowMs: NOW + 101,
    }).reason).toMatch(/expired/);

    const replacement = grant.token.endsWith('A') ? 'B' : 'A';
    const tampered = `${grant.token.slice(0, -1)}${replacement}`;
    expect(verifyCoordinationMacaroon(tampered, ROOT, {
      project: 'curiositech/port-daddy', actorId: 'cloud-sandbox', nowMs: NOW,
    }).authorized).toBe(false);
  });

  it('fails closed when the root key is missing or malformed', () => {
    const grant = mintCoordinationMacaroon(ROOT, 'curiositech/port-daddy', 'cloud-sandbox', { nowMs: NOW });
    expect(verifyCoordinationMacaroon(grant.token, '', {
      project: 'curiositech/port-daddy', actorId: 'cloud-sandbox', nowMs: NOW,
    })).toEqual({ authorized: false, reason: 'coordination macaroon gate is not configured' });
  });

  it('accepts only the Macaroon authorization scheme', () => {
    expect(coordinationMacaroonFromRequest(new Request('https://relay.invalid', {
      headers: { Authorization: 'Macaroon abc' },
    }))).toBe('abc');
    expect(coordinationMacaroonFromRequest(new Request('https://relay.invalid', {
      headers: { Authorization: 'Bearer abc' },
    }))).toBeNull();
  });

  it('matches the canonical Rust first-party macaroon byte construction', () => {
    const vector = JSON.parse(readFileSync(
      new URL('../../../tests/fixtures/macaroon-parity-vectors.json', import.meta.url),
      'utf8',
    )) as FirstPartyParityVector;
    const token = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
      location: vector.first_party.location,
      identifier: vector.first_party.identifier,
      caveats: vector.first_party.caveats.map((cid) => ({ cid })),
      signature: vector.first_party.expected_signature_hex,
    })));

    // A valid Rust signature reaches the narrower coordination policy, which
    // rejects the fixture's intentionally different `op = push` caveat.
    expect(verifyCoordinationMacaroon(token, utf8Hex(vector.root_key_utf8), {
      project: 'curiositech/port-daddy',
      actorId: 'cloud-sandbox',
      nowMs: NOW,
    })).toEqual({ authorized: false, reason: 'verb caveat mismatch' });
  });
});
