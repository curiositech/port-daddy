/**
 * tests/unit/coordination-gates.test.js — sec-eng-lead gate operations.
 *
 * Properties under test:
 *  - assertLeadAuthority refuses without both root + signing key.
 *  - openRound stashes both fleet keys + an audit-public key.
 *  - sealAttackManifest decrypts red, rejects red envelopes signed by
 *    keys not in the verify map, and produces a defense-fleet envelope.
 *  - publishDialogue pairs smells (with .id) to fixes (with .counters),
 *    archives carried-overs with reasons, signs the audit event.
 *  - The full A → B → C round trip produces a coherent dialogue.
 *  - A non-lead caller (no keychain entries) gets a thrown error from
 *    every gate operation.
 */

import { describe, test, expect, jest, beforeAll } from '@jest/globals';
import { generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';

const fakeKeychain = new Map();
jest.unstable_mockModule('../../lib/keychain.js', () => ({
  KEYCHAIN_SERVICE: 'test',
  keychain: {
    available: () => true,
    saveSecret: (svc, acct, val) => { fakeKeychain.set(`${svc}:${acct}`, val); return true; },
    loadSecret: (svc, acct) => fakeKeychain.get(`${svc}:${acct}`) || null,
    deleteSecret: (svc, acct) => fakeKeychain.delete(`${svc}:${acct}`),
  },
}));

let cc, gates;
beforeAll(async () => {
  cc = await import('../../lib/coordination-crypto.js');
  gates = await import('../../lib/coordination-gates.js');
});

function ed25519Pair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }),
  };
}

function freshRound(label) {
  return { round: label, salt: randomBytes(32).toString('base64') };
}

function setUpLead() {
  fakeKeychain.clear();
  const root = randomBytes(64);
  fakeKeychain.set('test:secops-lead-root', root.toString('hex'));
  const { privateKey, publicKey } = ed25519Pair();
  fakeKeychain.set('test:secops-lead-sig', privateKey.toString('hex'));
  return { rootHex: root.toString('hex'), leadPrivate: privateKey, leadPublic: publicKey };
}

describe('assertLeadAuthority', () => {
  test('throws when keychain has neither root nor signing key', () => {
    fakeKeychain.clear();
    expect(() => gates.assertLeadAuthority()).toThrow(/not authorized as sec-eng-lead/);
  });
  test('throws on partial state: only signing key', () => {
    fakeKeychain.clear();
    fakeKeychain.set('test:secops-lead-sig', 'aa'.repeat(32));
    expect(() => gates.assertLeadAuthority()).toThrow(/signing key present but root missing/);
  });
  test('throws on partial state: only root', () => {
    fakeKeychain.clear();
    fakeKeychain.set('test:secops-lead-root', 'aa'.repeat(64));
    expect(() => gates.assertLeadAuthority()).toThrow(/root present but signing key missing/);
  });
  test('returns authority when both present', () => {
    setUpLead();
    const auth = gates.assertLeadAuthority();
    expect(auth.root.length).toBe(64);
    expect(auth.signingKey.length).toBeGreaterThan(0);
  });
});

describe('Gate A — openRound', () => {
  test('stashes red, defense, and audit-public fleet keys', () => {
    setUpLead();
    const round = freshRound('v2.1');
    const result = gates.openRound(round);

    expect(result.audit.gate).toBe('A');
    expect(result.audit.round).toBe('v2.1');
    expect(result.redKeyId).toBe('redteam-review-fleet-key.v2.1');
    expect(result.defKeyId).toBe('whitehat-defense-fleet-key.v2.1');

    // All three keys loadable.
    expect(cc.loadFleetKey('redteam-review', round)).not.toBeNull();
    expect(cc.loadFleetKey('whitehat-defense', round)).not.toBeNull();
    expect(cc.loadFleetKey('audit-public', round)).not.toBeNull();
  });
});

describe('Gate B — sealAttackManifest', () => {
  test('decrypts red envelopes, re-encrypts under defense key', () => {
    setUpLead();
    const round = freshRound('v2.1');
    gates.openRound(round);

    const redCryptoPair = ed25519Pair();
    const env = cc.encryptEnvelope(
      { id: 'smell:vuln:crypto:bonded:7.4:0001', repro: 'see notebook' },
      {
        fleet: 'redteam-review',
        round,
        project: 'redteam-review',
        signedBy: 'redteam:crypto',
        signingKey: redCryptoPair.privateKey,
      },
    );

    const result = gates.sealAttackManifest(round, [env], {
      'redteam:crypto': redCryptoPair.publicKey,
    });

    expect(result.audit.gate).toBe('B');
    expect(result.manifest.envelope.key_id).toBe('whitehat-defense-fleet-key.v2.1');
    expect(result.manifest.manifest_hash).toMatch(/^[0-9a-f]{64}$/);

    // Defense personas can decrypt the bundle.
    const sealed = cc.decryptEnvelope(result.manifest.envelope, {
      fleet: 'whitehat-defense',
      round,
      project: 'whitehat-defense',
      knownVerifyKeys: { 'secops:lead': loadLeadPub() },
    });
    expect(sealed).not.toBeNull();
    expect(sealed.items).toHaveLength(1);
    expect(sealed.items[0].payload.id).toBe('smell:vuln:crypto:bonded:7.4:0001');
  });

  test('refuses to seal an unverified red envelope', () => {
    setUpLead();
    const round = freshRound('v2.1');
    gates.openRound(round);

    const realPair = ed25519Pair();
    const wrongPair = ed25519Pair();

    const env = cc.encryptEnvelope(
      { id: 'smell:x' },
      {
        fleet: 'redteam-review',
        round,
        project: 'redteam-review',
        signedBy: 'redteam:crypto',
        signingKey: realPair.privateKey,
      },
    );

    // Verify map has the WRONG public key for redteam:crypto.
    expect(() => gates.sealAttackManifest(round, [env], {
      'redteam:crypto': wrongPair.publicKey,
    })).toThrow(/refusing to seal an unverified manifest/);
  });
});

describe('Gate C — publishDialogue', () => {
  test('pairs smells to fixes by id, archives carried-overs with reasons', () => {
    setUpLead();
    const round = freshRound('v2.1');
    gates.openRound(round);

    // Phase 1: red posts two smells.
    const redPair = ed25519Pair();
    const env1 = cc.encryptEnvelope(
      { id: 'smell:vuln:crypto:0001', repro: 'jwt confusion' },
      { fleet: 'redteam-review', round, project: 'redteam-review',
        signedBy: 'redteam:crypto', signingKey: redPair.privateKey },
    );
    const env2 = cc.encryptEnvelope(
      { id: 'smell:vuln:crypto:0002', repro: 'cuckoo pollution' },
      { fleet: 'redteam-review', round, project: 'redteam-review',
        signedBy: 'redteam:crypto', signingKey: redPair.privateKey },
    );

    // Gate B seals.
    const sealed = gates.sealAttackManifest(round, [env1, env2], {
      'redteam:crypto': redPair.publicKey,
    });

    // Phase 2: defense answers ONE of them.
    const defPair = ed25519Pair();
    const fix1 = cc.encryptEnvelope(
      { counters: 'smell:vuln:crypto:0001', fix: 'pin algorithm in verify path' },
      { fleet: 'whitehat-defense', round, project: 'whitehat-defense',
        signedBy: 'defense:crypto', signingKey: defPair.privateKey },
    );

    // Gate C publishes.
    const result = gates.publishDialogue(
      round, sealed.manifest,
      { 'secops:lead': loadLeadPub() },
      [fix1],
      { 'defense:crypto': defPair.publicKey },
      { 'smell:vuln:crypto:0002': 'deferred to v2.2 — needs filter saturation harness' },
    );

    expect(result.audit.gate).toBe('C');
    expect(result.dialogue.round_from).toBe('v2.1');
    expect(result.dialogue.round_to).toBe('v2.2');
    expect(result.dialogue.exchanges).toHaveLength(1);
    expect(result.dialogue.exchanges[0].smell.payload.id).toBe('smell:vuln:crypto:0001');
    expect(result.dialogue.exchanges[0].fix.payload.counters).toBe('smell:vuln:crypto:0001');
    expect(result.dialogue.carried).toHaveLength(1);
    expect(result.dialogue.carried[0].payload.id).toBe('smell:vuln:crypto:0002');
    expect(result.dialogue.carried[0].reason).toMatch(/needs filter saturation harness/);
    expect(result.archived.key_id).toBe('audit-pub-key.v2.1');
  });
});

describe('non-lead callers are refused', () => {
  test('openRound throws without lead state', () => {
    fakeKeychain.clear();
    expect(() => gates.openRound(freshRound('v2.1'))).toThrow(/not authorized/);
  });
  test('sealAttackManifest throws without lead state', () => {
    fakeKeychain.clear();
    expect(() => gates.sealAttackManifest(freshRound('v2.1'), [], {})).toThrow(/not authorized/);
  });
  test('publishDialogue throws without lead state', () => {
    fakeKeychain.clear();
    expect(() => gates.publishDialogue(
      freshRound('v2.1'),
      { envelope: {}, manifest_hash: 'x' },
      {},
      [],
      {},
    )).toThrow(/not authorized/);
  });
});

// Helper: derive lead public key from the private key currently in the
// fake keychain. Not exposed by the module; we read the fake state.
function loadLeadPub() {
  const sigHex = fakeKeychain.get('test:secops-lead-sig');
  const priv = Buffer.from(sigHex, 'hex');
  const pubKey = createPublicKey({ key: priv, format: 'der', type: 'pkcs8' });
  return pubKey.export({ format: 'der', type: 'spki' });
}
