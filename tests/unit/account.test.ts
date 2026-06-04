/**
 * Tests for lib/account.ts — user identity + bilateral pairing receipts
 * (ADR-0029 Phases A0 + A1).
 *
 * Storage is redirected to a throwaway temp dir via PORT_DADDY_HOME /
 * PORT_DADDY_CONFIG, and PORT_DADDY_DISABLE_KEYCHAIN forces the file-fallback
 * custody path so the suite is deterministic on every platform.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  base58btcEncode,
  createAccount,
  accountExists,
  loadAccount,
  loadAccountSeed,
  ensureDevice,
  buildPairingReceipt,
  verifyPairingReceipt,
  pairLocalDevice,
  loadPairings,
  revokePairing,
  accountPubkeyRaw,
  devicePubkeyRaw,
  rawPubFromSeed,
  accountIdFromRawPub,
} from '../../lib/account';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pd-account-'));
  process.env.PORT_DADDY_HOME = join(dir, 'home');
  process.env.PORT_DADDY_CONFIG = join(dir, 'config');
  process.env.PORT_DADDY_DISABLE_KEYCHAIN = '1';
});

afterEach(() => {
  delete process.env.PORT_DADDY_HOME;
  delete process.env.PORT_DADDY_CONFIG;
  delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
  rmSync(dir, { recursive: true, force: true });
});

describe('base58btcEncode', () => {
  test('single zero byte encodes to "1"', () => {
    expect(base58btcEncode(Buffer.from([0]))).toBe('1');
  });
  test('leading zero bytes become leading "1"s', () => {
    expect(base58btcEncode(Buffer.from([0, 0, 1]))).toBe('112');
  });
  test('alphabet endpoints', () => {
    expect(base58btcEncode(Buffer.from([57]))).toBe('z'); // last alphabet index
    expect(base58btcEncode(Buffer.from([58]))).toBe('21'); // carries into a second digit
  });
});

describe('account id derivation', () => {
  test('id is a function of the public key (stable, base58)', () => {
    const seed = Buffer.alloc(32, 7);
    const id = accountIdFromRawPub(rawPubFromSeed(seed));
    expect(id).toBe(accountIdFromRawPub(rawPubFromSeed(seed)));
    expect(id).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/); // base58 alphabet, no 0OIl
  });
});

describe('createAccount (A0)', () => {
  test('mints a persistent identity', () => {
    expect(accountExists()).toBe(false);
    const account = createAccount({ displayName: 'erichowens' });
    expect(account.accountId.length).toBeGreaterThan(0);
    expect(account.displayName).toBe('erichowens');
    expect(account.oidcBindings).toEqual([]);
    expect(accountExists()).toBe(true);

    const reloaded = loadAccount();
    expect(reloaded?.accountId).toBe(account.accountId);

    // Private seed persisted to the file fallback (keychain disabled).
    expect(existsSync(join(dir, 'config', 'account.key'))).toBe(true);
    const seed = loadAccountSeed();
    expect(seed?.length).toBe(32);
    // The persisted seed must derive the same public key.
    expect(accountIdFromRawPub(rawPubFromSeed(seed as Buffer))).toBe(account.accountId);
  });

  test('refuses to overwrite without force; force rotates the id', () => {
    const first = createAccount();
    expect(() => createAccount()).toThrow(/already exists/);
    const second = createAccount({ force: true });
    expect(second.accountId).not.toBe(first.accountId);
  });
});

describe('pairing receipt (A1)', () => {
  test('a bilaterally-signed receipt verifies', () => {
    const account = createAccount();
    const device = ensureDevice('MacBook Pro M4');

    const receipt = pairLocalDevice({ deviceLabel: 'MacBook Pro M4' });
    expect(receipt.version).toBe(2);
    expect(receipt.daemonFingerprint).toBe(device.daemonFingerprint);
    expect(receipt.accountId).toBe(account.accountId);

    const res = verifyPairingReceipt(
      receipt,
      accountPubkeyRaw(account),
      devicePubkeyRaw(device),
    );
    expect(res).toMatchObject({
      valid: true,
      accountSigValid: true,
      daemonSigValid: true,
      fingerprintMatches: true,
      expired: false,
    });
  });

  test('tampering with one field invalidates both signatures', () => {
    createAccount();
    const account = loadAccount()!;
    const device = ensureDevice('home-pc');
    const receipt = pairLocalDevice({ deviceLabel: 'home-pc' });

    const tampered = { ...receipt, capabilities: [...receipt.capabilities, 'admin:everything'] };
    const res = verifyPairingReceipt(tampered, accountPubkeyRaw(account), devicePubkeyRaw(device));
    expect(res.valid).toBe(false);
    expect(res.accountSigValid).toBe(false);
    expect(res.daemonSigValid).toBe(false);
  });

  test('account and daemon signatures are independent', () => {
    createAccount();
    const account = loadAccount()!;
    const device = ensureDevice('laptop');
    const receipt = pairLocalDevice({ deviceLabel: 'laptop' });

    // Corrupt only the account signature; the daemon signature stays valid.
    const badAccountSig = { ...receipt, accountSig: 'ab'.repeat(32) };
    const res = verifyPairingReceipt(badAccountSig, accountPubkeyRaw(account), devicePubkeyRaw(device));
    expect(res.accountSigValid).toBe(false);
    expect(res.daemonSigValid).toBe(true);
    expect(res.valid).toBe(false);
  });

  test('a foreign device key fails the fingerprint check', () => {
    createAccount();
    const account = loadAccount()!;
    const device = ensureDevice('laptop');
    const receipt = pairLocalDevice({ deviceLabel: 'laptop' });

    const foreignPub = rawPubFromSeed(Buffer.alloc(32, 42));
    const res = verifyPairingReceipt(receipt, accountPubkeyRaw(account), foreignPub);
    expect(res.fingerprintMatches).toBe(false);
    expect(res.daemonSigValid).toBe(false);
    expect(res.valid).toBe(false);
  });

  test('expired receipts are flagged and invalid', () => {
    const account = createAccount();
    const accountSeed = loadAccountSeed() as Buffer;
    const device = ensureDevice('phone');

    // Build directly with a past expiry.
    const receipt = buildPairingReceipt({
      account,
      accountSeed,
      device,
      deviceSeed: loadDeviceSeedForTest(),
      expiresAt: Date.now() - 1000,
    });
    const res = verifyPairingReceipt(receipt, accountPubkeyRaw(account), devicePubkeyRaw(device));
    expect(res.expired).toBe(true);
    expect(res.valid).toBe(false);
    // Signatures themselves are still cryptographically sound.
    expect(res.accountSigValid).toBe(true);
    expect(res.daemonSigValid).toBe(true);
  });
});

describe('pairing store', () => {
  test('pair → list → revoke lifecycle', () => {
    createAccount();
    pairLocalDevice({ deviceLabel: 'desk' });
    let pairings = loadPairings();
    expect(pairings).toHaveLength(1);
    expect(pairings[0].revokedAt).toBeUndefined();

    const fp = pairings[0].daemonFingerprint;
    expect(revokePairing(fp)).toBe(true);
    pairings = loadPairings();
    expect(pairings[0].revokedAt).toBeGreaterThan(0);

    // Re-pairing replaces the active receipt rather than duplicating it.
    pairLocalDevice({ deviceLabel: 'desk' });
    const active = loadPairings().filter((r) => !r.revokedAt);
    expect(active).toHaveLength(1);
  });
});

// Helper: read the device seed via the same custody path the library uses.
import { loadDeviceSeed } from '../../lib/account';
function loadDeviceSeedForTest(): Buffer {
  const seed = loadDeviceSeed();
  if (!seed) throw new Error('device seed missing in test');
  return seed;
}
