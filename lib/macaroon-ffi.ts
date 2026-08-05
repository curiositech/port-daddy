/**
 * Macaroon gate — kernel-preferred runtime (ADR-0054 P4).
 *
 * The canonical macaroon verifier is the Rust kernel crate `pd-anchor`
 * (`core/kernel/pd-anchor`), exposed over a C ABI (`pd_macaroon_verify_json`).
 * This module loads that dylib via koffi and prefers it; when the dylib is
 * ABSENT (source installs, CI — which does not build it), it falls back to the
 * deprecated, byte-parity TypeScript impl in `lib/macaroon`. Same posture
 * `lib/arbiter.ts` holds toward the harbor enforcer.
 *
 * Because parity is locked by shared test vectors (ADR-0054 P6), the FFI path and
 * the fallback path return identical results — the FFI is a performance/trust
 * upgrade, never a behavior change.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { verifyPushGrant, type GateResult } from './macaroon/gate.js';
import type { Macaroon, RequestContext } from './macaroon/types.js';

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));

const libFileName = 'libpd_anchor.' + (process.platform === 'darwin' ? 'dylib' : 'so');

interface KernelHandle {
  koffi: { decode: (ptr: unknown, type: string, len: number) => string };
  verify: (req: string, len: number) => unknown;
  free: (ptr: unknown) => void;
}

let kernel: KernelHandle | null = null;
let loadError: string | null = null;
let loadAttempted = false;

/** Where the macaroon dylib may live (mirrors arbiter.ts). `PD_ANCHOR_DYLIB`
 *  overrides for tests / non-standard installs. */
function candidatePaths(): string[] {
  const override = process.env.PD_ANCHOR_DYLIB?.trim();
  // An explicit override is authoritative. Falling through to an auto-discovered
  // build makes it impossible to force the documented TS fallback in tests or
  // to pin a non-standard install path safely.
  if (override) return [override];
  const paths: string[] = [];
  paths.push(join(moduleDir, '../dist/core', libFileName));
  const resourceDir = process.env.PORT_DADDY_RESOURCE_DIR?.trim();
  if (resourceDir) paths.push(join(resourceDir, 'dist/core', libFileName));
  if (process.execPath) paths.push(join(dirname(process.execPath), 'dist/core', libFileName));
  return [...new Set(paths)];
}

function loadKernel(): KernelHandle | null {
  if (loadAttempted) return kernel;
  loadAttempted = true;
  try {
    const path = candidatePaths().find((p) => existsSync(p));
    if (!path) {
      loadError = `libpd_anchor not found (checked ${candidatePaths().join(', ')})`;
      return null;
    }
    const koffi = require('koffi');
    const lib = koffi.load(path);
    // Return an opaque pointer (not auto-decoded) so we can decode AND free it.
    const verify = lib.func('void* pd_macaroon_verify_json(const char* req, size_t len)');
    const free = lib.func('void pd_string_free(void* ptr)');
    kernel = { koffi, verify, free };
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
    kernel = null;
  }
  return kernel;
}

/** True iff the Rust kernel dylib loaded — i.e. verification runs in Rust. */
export function kernelAvailable(): boolean {
  return loadKernel() !== null;
}

/** The reason the kernel dylib failed to load (for diagnostics), or null. */
export function kernelLoadError(): string | null {
  loadKernel();
  return loadError;
}

/** Reset the cached load (tests only). */
export function __resetKernelForTests(): void {
  kernel = null;
  loadError = null;
  loadAttempted = false;
}

export interface VerifyPushGrantArgs {
  grant: Macaroon;
  /** Daemon-held grant root key, hex. */
  rootKeyHex: string;
  discharges: Macaroon[];
  ctx: RequestContext;
  /** caveat id -> discharge key (hex). The verifier holds these. */
  caveatKeys: Record<string, string>;
}

/**
 * Verify a push grant, preferring the Rust kernel and falling back to the
 * byte-parity TS impl when the dylib is absent. The result is identical either
 * way (locked by shared vectors).
 */
/** Translate a TS macaroon to the Rust kernel's wire shape. The only field that
 *  differs is the signature: TS serializes `signature`, Rust expects
 *  `signature_hex` (the byte-parity vectors prove the VALUES match; the FFI just
 *  needs the field names to align). Caveats ({cid, vid?, cl?}) already match. */
function toRustMacaroon(m: Macaroon): Record<string, unknown> {
  return {
    location: m.location,
    identifier: m.identifier,
    caveats: m.caveats,
    signature_hex: m.signature,
  };
}

export function verifyPushGrantPreferKernel(args: VerifyPushGrantArgs): GateResult {
  const k = loadKernel();
  if (k) {
    const req = JSON.stringify({
      macaroon: toRustMacaroon(args.grant),
      root_key_hex: args.rootKeyHex,
      discharges: args.discharges.map(toRustMacaroon),
      ctx: {
        op: args.ctx.op ?? null,
        repo: args.ctx.repo ?? null,
        branch: args.ctx.branch ?? null,
        host: args.ctx.host ?? null,
        spend_usd: args.ctx.spendUsd ?? null,
        session: args.ctx.session ?? null,
        now_ms: args.ctx.nowMs,
      },
      caveat_keys: args.caveatKeys,
    });
    const ptr = k.verify(req, Buffer.byteLength(req));
    if (ptr) {
      try {
        // Decode the NUL-terminated C string from the pointer (koffi: ('char', -1)
        // reads until NUL). We keep the raw pointer so we can free it afterward.
        const out = k.koffi.decode(ptr, 'char', -1);
        const parsed = JSON.parse(out) as { ok: boolean; reason: string };
        return { authorized: parsed.ok, reason: parsed.reason };
      } finally {
        k.free(ptr);
      }
    }
    // A null pointer is a catastrophic kernel failure (vs. a clean dylib-absent,
    // handled by the loader returning null). Falling back to the byte-parity TS
    // impl is SAFE (same verdict), but it's a real failure the operator should
    // see — emit a signal rather than degrade silently.
    console.error(
      '[macaroon-ffi] kernel dylib loaded but pd_macaroon_verify_json returned null; ' +
        'falling back to the TS verifier. This is an infrastructure fault, not a clean absence.',
    );
  }
  // Validate the hex before decoding so a malformed caveat key resolves to null
  // (→ "no discharge key", fail-closed) exactly like the Rust path's filter_map,
  // rather than yielding a wrong-length Buffer.
  const resolveCaveatKey = (caveatId: string): Buffer | null => {
    const hex = args.caveatKeys[caveatId];
    if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
    return Buffer.from(hex, 'hex');
  };
  return verifyPushGrant(
    args.grant,
    Buffer.from(args.rootKeyHex, 'hex'),
    args.discharges,
    args.ctx,
    resolveCaveatKey,
  );
}
