/**
 * lib/macaroon-ffi: kernel-preferred verification with graceful TS fallback
 * (ADR-0054 P4).
 *
 * The fallback path is exercised always (CI does not build the dylib). The FFI
 * path runs only when a dylib is present (set PD_ANCHOR_DYLIB, or build
 * dist/core/libpd_anchor) and asserts it returns the SAME result as the
 * fallback — the cross-runtime parity guarantee, at the API boundary.
 */
import { describe, expect, test, beforeEach } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mintActorBoundPushGrant,
  dischargeRentPaid,
} from '../../lib/macaroon/discharge.js';
import { prepareForRequest } from '../../lib/macaroon/macaroon.js';
import {
  verifyPushGrantPreferKernel,
  kernelAvailable,
  __resetKernelForTests,
} from '../../lib/macaroon-ffi.js';

const here = dirname(fileURLToPath(import.meta.url));
const T = 1_700_000_000_000;
const ACTOR = '01K3YR6M1WPZB8Q6V1J8K7D4MC';

const paidFacts = () => ({
  commitsSinceLastNote: 0,
  commitsTotal: 3,
  notesTotal: 3,
  claimsTotal: 1,
  commitsBehindBase: 0,
  ageMs: 60_000,
  lastSignalAgeMs: 1_000,
});

/** Build a grant + bound discharge + the args the gate takes. */
function makeArgs(branch = 'feat/dom-daddy-x') {
  const rootKey = randomBytes(32);
  const caveatKey = randomBytes(32);
  const session = 'session-ffi-test';
  const { macaroon, rentCaveatId, record } = mintActorBoundPushGrant({
    rootKey,
    grantId: 'grant-ffi-test',
    repoId: 'curiositech/port-daddy',
    actor: ACTOR,
    session,
    expiresMs: T + 60 * 60 * 1000,
    caveatKey,
    rentNonce: 'nonce-1',
  });
  const d = dischargeRentPaid({ record, rentCaveatId, session, facts: paidFacts(), nowMs: T });
  const bound = prepareForRequest(macaroon, d.discharge);
  return {
    grant: macaroon,
    actor: ACTOR,
    rootKeyHex: rootKey.toString('hex'),
    discharges: [bound],
    ctx: { op: 'push', repo: 'curiositech/port-daddy', branch, session, nowMs: T + 5 * 60 * 1000 },
    caveatKeys: { [rentCaveatId]: caveatKey.toString('hex') },
  };
}

// A dylib for the FFI path: PD_ANCHOR_DYLIB, else the standard dist/core location.
const FFI_DYLIB =
  process.env.PD_ANCHOR_DYLIB ||
  join(here, '../../dist/core', 'libpd_anchor.' + (process.platform === 'darwin' ? 'dylib' : 'so'));
const haveDylib = existsSync(FFI_DYLIB);

describe('macaroon-ffi — graceful TS fallback (dylib absent)', () => {
  beforeEach(() => {
    delete process.env.PD_ANCHOR_DYLIB;
    process.env.PD_ANCHOR_DYLIB = '/nonexistent/libpd_anchor.dylib';
    __resetKernelForTests();
  });

  test('falls back to the TS impl and authorizes a valid grant', () => {
    expect(kernelAvailable()).toBe(false); // forced-absent dylib
    const res = verifyPushGrantPreferKernel(makeArgs());
    expect(res.authorized).toBe(true);
  });

  test('fallback rejects a push to the protected branch', () => {
    const res = verifyPushGrantPreferKernel(makeArgs('main'));
    expect(res.authorized).toBe(false);
    expect(res.reason).toMatch(/branch != main/);
  });

  test('fallback rejects when no discharge key is provided', () => {
    const args = makeArgs();
    args.caveatKeys = {};
    const res = verifyPushGrantPreferKernel(args);
    expect(res.authorized).toBe(false);
  });
});

// Only runs when a real dylib is available (locally; CI does not build it).
const ffiDescribe = haveDylib ? describe : describe.skip;
ffiDescribe('macaroon-ffi — Rust kernel path (dylib present) agrees with the fallback', () => {
  beforeEach(() => {
    process.env.PD_ANCHOR_DYLIB = FFI_DYLIB;
    __resetKernelForTests();
  });

  test('the kernel loads and authorizes a valid grant identically to TS', () => {
    expect(kernelAvailable()).toBe(true);
    const args = makeArgs();
    const viaKernel = verifyPushGrantPreferKernel(args);
    expect(viaKernel.authorized).toBe(true);

    // Same inputs through the forced fallback must agree.
    process.env.PD_ANCHOR_DYLIB = '/nonexistent';
    __resetKernelForTests();
    const viaFallback = verifyPushGrantPreferKernel(args);
    expect(viaKernel.authorized).toBe(viaFallback.authorized);
  });

  test('the kernel rejects a protected-branch push identically to TS', () => {
    const args = makeArgs('main');
    expect(verifyPushGrantPreferKernel(args).authorized).toBe(false);
  });
});
