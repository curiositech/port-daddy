/**
 * tests/unit/coordination-crypto.test.js — Adversarial-fleet envelope crypto.
 *
 * Properties under test:
 *  1. Round-trip inside same fleet+round.
 *  2. Cross-fleet decrypt fails (AD binding) even when both keys exist.
 *  3. Forged signature rejected.
 *  4. Tampered ciphertext rejected.
 *  5. Wrong-round envelope rejected.
 *  6. Daemon guard rejects malformed / cross-namespace key_ids.
 *  7. ACL refuses cross-fleet read, plaintext write, lead without gate op.
 */

import { describe, test, expect, jest, beforeAll } from '@jest/globals';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

// Mock the keychain module BEFORE importing the modules under test.
const fakeKeychain = new Map();
jest.unstable_mockModule('../../lib/keychain.js', () => ({
  KEYCHAIN_SERVICE: 'test',
  keychain: {
    available: () => true,
    saveSecret: (svc, acct, val) => {
      fakeKeychain.set(`${svc}:${acct}`, val);
      return true;
    },
    loadSecret: (svc, acct) => fakeKeychain.get(`${svc}:${acct}`) || null,
    deleteSecret: (svc, acct) => fakeKeychain.delete(`${svc}:${acct}`),
  },
}));

// Dynamic imports happen after mock registration.
let cc, acl;
beforeAll(async () => {
  cc = await import('../../lib/coordination-crypto.js');
  acl = await import('../../lib/coordination-acl.js');
});

function freshRound(label) {
  return { round: label, salt: randomBytes(32).toString('base64') };
}

function freshSigningPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }),
  };
}

function setUpFleetKeys(round) {
  const root = randomBytes(64);
  fakeKeychain.set('test:secops-lead-root', root.toString('hex'));
  cc.deriveAndStashFleetKey(root, 'redteam-review', round);
  cc.deriveAndStashFleetKey(root, 'whitehat-defense', round);
}

describe('coordination-crypto envelope', () => {
  test('round-trips inside same fleet+round', () => {
    const round = freshRound('v2.1');
    setUpFleetKeys(round);
    const { privateKey, publicKey } = freshSigningPair();

    const env = cc.encryptEnvelope(
      { smell: 'vuln:crypto:bonded:7.4:0001', repro: 'see notebook' },
      {
        fleet: 'redteam-review',
        round,
        project: 'redteam-review',
        signedBy: 'redteam:crypto',
        signingKey: privateKey,
      },
    );
    const out = cc.decryptEnvelope(env, {
      fleet: 'redteam-review',
      round,
      project: 'redteam-review',
      knownVerifyKeys: { 'redteam:crypto': publicKey },
    });
    expect(out).toEqual({ smell: 'vuln:crypto:bonded:7.4:0001', repro: 'see notebook' });
  });

  test('cross-fleet decrypt fails (AD binding)', () => {
    const round = freshRound('v2.1');
    setUpFleetKeys(round);
    const { privateKey, publicKey } = freshSigningPair();

    const env = cc.encryptEnvelope(
      { smell: 'redonly' },
      {
        fleet: 'redteam-review',
        round,
        project: 'redteam-review',
        signedBy: 'redteam:crypto',
        signingKey: privateKey,
      },
    );
    const out = cc.decryptEnvelope(env, {
      fleet: 'whitehat-defense',
      round,
      project: 'whitehat-defense',
      knownVerifyKeys: { 'redteam:crypto': publicKey },
    });
    expect(out).toBeNull();
  });

  test('forged signature is rejected', () => {
    const round = freshRound('v2.1');
    setUpFleetKeys(round);
    const { privateKey } = freshSigningPair();
    const { publicKey: wrongPub } = freshSigningPair();

    const env = cc.encryptEnvelope(
      { smell: 'x' },
      {
        fleet: 'redteam-review',
        round,
        project: 'redteam-review',
        signedBy: 'redteam:crypto',
        signingKey: privateKey,
      },
    );
    const out = cc.decryptEnvelope(env, {
      fleet: 'redteam-review',
      round,
      project: 'redteam-review',
      knownVerifyKeys: { 'redteam:crypto': wrongPub },
    });
    expect(out).toBeNull();
  });

  test('tampered ciphertext is rejected', () => {
    const round = freshRound('v2.1');
    setUpFleetKeys(round);
    const { privateKey, publicKey } = freshSigningPair();

    const env = cc.encryptEnvelope(
      { smell: 'real' },
      {
        fleet: 'redteam-review',
        round,
        project: 'redteam-review',
        signedBy: 'redteam:crypto',
        signingKey: privateKey,
      },
    );
    const tampered = Buffer.from(env.ct, 'base64');
    tampered[0] = tampered[0] ^ 0x01;
    const evil = { ...env, ct: tampered.toString('base64') };

    const out = cc.decryptEnvelope(evil, {
      fleet: 'redteam-review',
      round,
      project: 'redteam-review',
      knownVerifyKeys: { 'redteam:crypto': publicKey },
    });
    expect(out).toBeNull();
  });

  test('wrong-round envelope is rejected', () => {
    const r1 = freshRound('v2.1');
    const r2 = freshRound('v2.2');
    setUpFleetKeys(r1);
    setUpFleetKeys(r2);
    const { privateKey, publicKey } = freshSigningPair();

    const env = cc.encryptEnvelope(
      { smell: 'old' },
      {
        fleet: 'redteam-review',
        round: r1,
        project: 'redteam-review',
        signedBy: 'redteam:crypto',
        signingKey: privateKey,
      },
    );
    const out = cc.decryptEnvelope(env, {
      fleet: 'redteam-review',
      round: r2,
      project: 'redteam-review',
      knownVerifyKeys: { 'redteam:crypto': publicKey },
    });
    expect(out).toBeNull();
  });

  test('daemon guard rejects malformed envelope', () => {
    expect(cc.daemonAcceptsEnvelopeFor({ v: 1 }, 'redteam-review')).toBe(false);
    expect(cc.daemonAcceptsEnvelopeFor(
      {
        v: 1,
        key_id: 'whitehat-defense-fleet-key.v2.1',
        iv: '', ct: '', tag: '', ad: '', ts: '', signed_by: '', sig: '',
      },
      'redteam-review',
    )).toBe(false);
  });
});

describe('coordination-acl', () => {
  test('refuses cross-fleet read', () => {
    const d = acl.check({
      persona: 'redteam:crypto',
      op: 'read',
      project: 'whitehat-defense',
    });
    expect(d.allow).toBe(false);
    expect(d.logViolation).toBe(true);
  });

  test('refuses lead cross-fleet without gate op', () => {
    const d = acl.check({
      persona: 'secops:lead',
      op: 'read',
      project: 'redteam-review',
    });
    expect(d.allow).toBe(false);
  });

  test('permits sec-eng-lead at named gate', () => {
    const d = acl.check({
      persona: 'secops:lead',
      op: 'read',
      project: 'redteam-review',
      gateOp: 'B_seal',
    });
    expect(d.allow).toBe(true);
  });

  test('refuses plaintext writes from a valid persona', () => {
    const d = acl.check({
      persona: 'redteam:crypto',
      op: 'write',
      project: 'redteam-review',
    });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('plaintext-write-refused');
  });
});
