/**
 * tests/bun/safe-corral-bun.test.ts — ADR-0088 Phase B corral round-trip under
 * the SHIPPED daemon runtime (bun). The compiled daemon runs on bun, so the
 * corral vault + the pd-secret:// resolver + the `pd env exec` child-env
 * injection are exercised here under that runtime — not only in jest.
 *
 * Two layers:
 *   1. In-memory vault round-trip (always runs): save → resolve → child-env
 *      inject under bun, proving the resolver path is byte-identical under the
 *      real runtime and the full corral apply() succeeds.
 *   2. REAL Keychain round-trip (macOS only, when the Keychain is reachable):
 *      corral into the live OS Keychain (corral:* account namespace) and confirm
 *      it round-trips, then clean up. Skipped honestly when unavailable —
 *      NEVER faked green.
 */

import { beforeEach, afterEach, describe, expect, test } from 'bun:test';

import {
  setCorralVault,
  memoryCorralVault,
  corralSecret,
  resolveSecretRef,
  resolveSecretRefsInEnv,
  corralResolves,
  unCorralSecret,
  corralStorageStatus,
  _resetForTests,
  PD_SECRET_SCHEME,
} from '../../lib/secret-env.ts';
import { planCorral, applyCorralItem } from '../../lib/safe/corral.ts';
import { scanContent } from '../../lib/safe/secret-scanner.ts';

const HOME = '/home/test';
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const ENV_PATH = '/home/test/proj/.env';

beforeEach(() => {
  _resetForTests();
});
afterEach(() => {
  _resetForTests();
});

describe('corral round-trip under bun (in-memory vault)', () => {
  beforeEach(() => setCorralVault(memoryCorralVault()));

  test('save → resolve → child-env inject', () => {
    const r = corralSecret('STRIPE_SECRET_KEY', 'sk_live_abcdef0123456789');
    expect(r.storedAt).toBe('memory');
    expect(resolveSecretRef(`${PD_SECRET_SCHEME}STRIPE_SECRET_KEY`)).toBe('sk_live_abcdef0123456789');
    expect(corralResolves('STRIPE_SECRET_KEY')).toBe(true);

    const { env, resolved } = resolveSecretRefsInEnv({
      STRIPE_SECRET_KEY: `${PD_SECRET_SCHEME}STRIPE_SECRET_KEY`,
      UNRELATED: 'x',
    });
    expect(env.STRIPE_SECRET_KEY).toBe('sk_live_abcdef0123456789');
    expect(env.UNRELATED).toBe('x');
    expect(resolved).toContain('STRIPE_SECRET_KEY');
  });

  test('full corral apply() round-trips and rewrites source (in-memory fs)', () => {
    const original = `AWS_ACCESS_KEY_ID=${AWS_KEY}\n`;
    const findings = scanContent(ENV_PATH, original, HOME).filter((f) => f.ruleId.includes('aws'));
    expect(findings.length).toBeGreaterThan(0);
    const fs: Record<string, string> = { [ENV_PATH]: original };

    const plan = planCorral(findings, { home: HOME, readFile: (p) => fs[p] ?? null });
    const result = applyCorralItem(plan.items[0], {
      home: HOME,
      readFile: (p) => fs[p] ?? null,
      writeFile: (p, c) => {
        fs[p] = c;
      },
      mkdirp: () => {},
      exists: (p) => p in fs,
      now: () => new Date('2026-06-23T00:00:00.000Z'),
    });

    expect(result.applied).toBe(true);
    expect(result.roundTripVerified).toBe(true);
    expect(resolveSecretRef(`${PD_SECRET_SCHEME}AWS_ACCESS_KEY_ID`)).toBe(AWS_KEY);
    expect(fs[ENV_PATH]).toContain('AWS_ACCESS_KEY_ID=pd-secret://AWS_ACCESS_KEY_ID');
    expect(fs[ENV_PATH]).not.toContain(AWS_KEY);
  });
});

describe('corral round-trip against the REAL OS Keychain (macOS only)', () => {
  // Reset to the default Keychain-backed vault for this block.
  beforeEach(() => _resetForTests());

  const status = (() => {
    _resetForTests();
    return corralStorageStatus();
  })();
  const keychainPresent = status.available && status.storage === 'keychain';
  // Opt-in: the live-Keychain WRITE can trigger an interactive ACL prompt on a
  // real login Keychain, so it only runs under PD_CORRAL_KEYCHAIN_TEST=1 (CI /
  // a disposable Keychain). Otherwise it is SKIPPED honestly — never faked.
  const keychainWriteOptIn = keychainPresent && process.env.PD_CORRAL_KEYCHAIN_TEST === '1';

  test.skipIf(!keychainWriteOptIn)('corrals into and resolves from the live Keychain', () => {
    const KEY = 'PD_CORRAL_BUNTEST';
    const VALUE = 'sk-ant-bun-test-' + Date.now();
    try {
      const r = corralSecret(KEY, VALUE);
      expect(r.storedAt).toBe('keychain');
      expect(r.encryptedAtRest).toBe(true);
      // Drop the in-process cache and force a durable Keychain read-back.
      _resetForTests();
      expect(resolveSecretRef(`${PD_SECRET_SCHEME}${KEY}`)).toBe(VALUE);
    } finally {
      unCorralSecret(KEY);
    }
    expect(corralResolves(KEY)).toBe(false);
  });

  test('reports the vault status honestly (encrypted-at-rest iff Keychain present)', () => {
    // The honest invariant: encryptedAtRest is true exactly when an encrypted
    // backend (Keychain) is actually present — never claimed otherwise.
    expect(status.encryptedAtRest).toBe(keychainPresent);
  });
});
