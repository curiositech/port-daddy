import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  __resetOperatorPresenceKernelForTests,
  operatorPresenceKernelDiagnostic,
  verifyFleetBarProcessTrust,
  verifyOperatorPresenceSignature,
} from '../../lib/operator-presence-ffi.js';

const originalOverride = process.env.PD_ANCHOR_DYLIB;
const dylib = join(
  process.cwd(),
  'core/target/debug/deps',
  `libpd_anchor.${process.platform === 'darwin' ? 'dylib' : 'so'}`,
);

const vector = {
  publicKeyX963: Buffer.from(
    '04f3385b5cd2dcc139e29e813df7609cdc2eddc16948aeebfcd946d14a32b11cc075fe887e81da93d221b3faa1c0c915cd8d9410d5cffc99714897367cb8f84bff',
    'hex',
  ),
  signatureDer: Buffer.from(
    '3045022100daa6fe68875717027c47581de53ba12b0f034e42801a0fc7eb0dc7a6e60e9f0502200dafedd299acbb67a7cf21448d47e16754ac51d217c2f84aa19c279000076789',
    'hex',
  ),
  challenge: Buffer.from('port-daddy operator presence vector v1'),
};

beforeEach(() => {
  process.env.PD_ANCHOR_DYLIB = '/nonexistent/pd-anchor-for-operator-presence.dylib';
  __resetOperatorPresenceKernelForTests();
});

afterEach(() => {
  if (originalOverride === undefined) delete process.env.PD_ANCHOR_DYLIB;
  else process.env.PD_ANCHOR_DYLIB = originalOverride;
  __resetOperatorPresenceKernelForTests();
});

describe('operator-presence-ffi kernel requirement', () => {
  test('fails closed with diagnostics when the Rust kernel is unavailable', () => {
    const result = verifyOperatorPresenceSignature(vector);
    expect(result).toMatchObject({
      ok: false,
      code: 'OPERATOR_PRESENCE_KERNEL_UNAVAILABLE',
      source: 'unavailable',
    });

    expect(operatorPresenceKernelDiagnostic()).toEqual({
      available: false,
      required: true,
      loadedPath: null,
      checkedPaths: ['/nonexistent/pd-anchor-for-operator-presence.dylib'],
      error: expect.stringContaining('required pd-anchor kernel not found'),
    });
  });

  test('never converts kernel absence into a TypeScript verification verdict', () => {
    const invalid = verifyOperatorPresenceSignature({
      publicKeyX963: new Uint8Array(),
      signatureDer: new Uint8Array(),
      challenge: new Uint8Array(),
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe('OPERATOR_PRESENCE_KERNEL_UNAVAILABLE');
    expect(invalid.source).toBe('unavailable');

    expect(verifyFleetBarProcessTrust(process.pid)).toMatchObject({
      ok: false,
      code: 'OPERATOR_PRESENCE_KERNEL_UNAVAILABLE',
      trust: null,
      source: 'unavailable',
    });
  });

  test('rejects invalid PIDs before calling the native boundary', () => {
    for (const pid of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER]) {
      expect(verifyFleetBarProcessTrust(pid)).toMatchObject({
        ok: false,
        code: 'INVALID_PID',
        trust: null,
      });
    }
  });
});

const kernelDescribe = existsSync(dylib) ? describe : describe.skip;
kernelDescribe('operator-presence-ffi fixed CryptoKit vector', () => {
  beforeEach(() => {
    process.env.PD_ANCHOR_DYLIB = dylib;
    __resetOperatorPresenceKernelForTests();
  });

  test('verifies exact bytes and rejects a one-byte message change', () => {
    expect(verifyOperatorPresenceSignature(vector)).toEqual({
      ok: true,
      code: 'VERIFIED',
      reason: 'operator presence verified',
      source: 'rust-kernel',
    });

    const changed = Buffer.from(vector.challenge);
    changed[0] ^= 1;
    expect(
      verifyOperatorPresenceSignature({ ...vector, challenge: changed }),
    ).toMatchObject({ ok: false, code: 'INVALID_SIGNATURE', source: 'rust-kernel' });
  });

  test('rejects an exited PID and the unsigned test runner', () => {
    expect(verifyFleetBarProcessTrust(2_147_483_647)).toMatchObject({
      ok: false,
      code: process.platform === 'darwin' ? 'PROCESS_UNAVAILABLE' : 'UNSUPPORTED_PLATFORM',
      trust: null,
      source: 'rust-kernel',
    });
    expect(verifyFleetBarProcessTrust(process.pid)).toMatchObject({
      ok: false,
      trust: null,
      source: 'rust-kernel',
    });
  });
});
