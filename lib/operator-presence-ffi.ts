/**
 * Operator-presence signature verification through the Rust trust kernel.
 *
 * This is an authorization boundary, not a performance optimization. Unlike
 * byte-parity utilities, it has no TypeScript crypto fallback: if pd-anchor is
 * absent, cannot load, returns null, or returns malformed JSON, verification
 * fails closed with an operator-visible diagnostic.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const libFileName = `libpd_anchor.${process.platform === 'darwin' ? 'dylib' : 'so'}`;

interface KernelHandle {
  path: string;
  koffi: { decode: (pointer: unknown, type: string, length: number) => string };
  verify: (request: string, length: number) => unknown;
  verifyFleetBarProcess: (pid: number) => unknown;
  tryContextSlotLock: (descriptor: number) => number;
  unlockContextSlot: (descriptor: number) => number;
  free: (pointer: unknown) => void;
}

export interface OperatorPresenceKernelDiagnostic {
  available: boolean;
  required: true;
  loadedPath: string | null;
  checkedPaths: string[];
  error: string | null;
}

export interface OperatorPresenceVerificationInput {
  publicKeyX963: Uint8Array;
  signatureDer: Uint8Array;
  /** Exact daemon-provided canonical bytes. Never pass reconstructed JSON. */
  challenge: Uint8Array;
}

export interface OperatorPresenceVerificationResult {
  ok: boolean;
  code: string;
  reason: string;
  source: 'rust-kernel' | 'unavailable';
}

export interface FleetBarProcessTrustEvidence {
  pid: number;
  identity: string;
  notarized: boolean;
  hardened_runtime: boolean;
  debug_privileges: boolean;
  unsafe_dyld_environment: boolean;
}

export interface FleetBarProcessTrustResult {
  ok: boolean;
  code: string;
  reason: string;
  trust: FleetBarProcessTrustEvidence | null;
  source: 'rust-kernel' | 'unavailable';
}

let kernel: KernelHandle | null = null;
let loadAttempted = false;
let loadError: string | null = null;
let loadedPath: string | null = null;
let lastCheckedPaths: string[] = [];

function candidatePaths(): string[] {
  const override = process.env.PD_ANCHOR_DYLIB?.trim();
  if (override) return [override];
  const paths = [join(moduleDir, '../dist/core', libFileName)];
  const resourceDir = process.env.PORT_DADDY_RESOURCE_DIR?.trim();
  if (resourceDir) paths.push(join(resourceDir, 'dist/core', libFileName));
  if (process.execPath) paths.push(join(dirname(process.execPath), 'dist/core', libFileName));
  return [...new Set(paths)];
}

function loadKernel(): KernelHandle | null {
  if (loadAttempted) return kernel;
  loadAttempted = true;
  lastCheckedPaths = candidatePaths();

  try {
    const path = lastCheckedPaths.find((candidate) => existsSync(candidate));
    if (!path) {
      loadError = `required pd-anchor kernel not found (checked ${lastCheckedPaths.join(', ')})`;
      return null;
    }
    const koffi = require('koffi');
    const library = koffi.load(path);
    const verify = library.func(
      'void* pd_operator_presence_verify_json(const char* request, size_t length)',
    );
    const verifyFleetBarProcess = library.func(
      'void* pd_fleetbar_process_trust_json(int32_t pid)',
    );
    const tryContextSlotLock = library.func(
      'int32_t pd_context_slot_try_lock(int32_t fd)',
    );
    const unlockContextSlot = library.func(
      'int32_t pd_context_slot_unlock(int32_t fd)',
    );
    const free = library.func('void pd_string_free(void* pointer)');
    kernel = {
      path,
      koffi,
      verify,
      verifyFleetBarProcess,
      tryContextSlotLock,
      unlockContextSlot,
      free,
    };
    loadedPath = path;
    loadError = null;
  } catch (error) {
    loadError = error instanceof Error ? error.message : String(error);
    kernel = null;
    loadedPath = null;
  }
  return kernel;
}

export function operatorPresenceKernelDiagnostic(): OperatorPresenceKernelDiagnostic {
  const available = loadKernel() !== null;
  return {
    available,
    required: true,
    loadedPath,
    checkedPaths: [...lastCheckedPaths],
    error: loadError,
  };
}

export function operatorPresenceKernelAvailable(): boolean {
  return loadKernel() !== null;
}

export type ContextSlotKernelLockResult = 'acquired' | 'busy' | 'unavailable';

/** Acquire one non-blocking kernel lease. There is deliberately no TS fallback. */
export function tryContextSlotKernelLock(descriptor: number): ContextSlotKernelLockResult {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0) return 'unavailable';
  const loaded = loadKernel();
  if (!loaded) return 'unavailable';
  const result = loaded.tryContextSlotLock(descriptor);
  if (result === 0) return 'acquired';
  if (result === 1) return 'busy';
  return 'unavailable';
}

/** Release one kernel lease. Closing the descriptor remains the final backstop. */
export function unlockContextSlotKernelLock(descriptor: number): boolean {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0) return false;
  const loaded = loadKernel();
  return loaded ? loaded.unlockContextSlot(descriptor) === 0 : false;
}

function unavailable(code: string, reason: string): OperatorPresenceVerificationResult {
  return { ok: false, code, reason, source: 'unavailable' };
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

/**
 * Verify a P-256/DER signature in pd-anchor. The request transports three byte
 * strings only; no signed object is parsed or reserialized on this side.
 */
export function verifyOperatorPresenceSignature(
  input: OperatorPresenceVerificationInput,
): OperatorPresenceVerificationResult {
  const loaded = loadKernel();
  if (!loaded) {
    return unavailable(
      'OPERATOR_PRESENCE_KERNEL_UNAVAILABLE',
      loadError ?? 'required pd-anchor operator-presence verifier is unavailable',
    );
  }

  const request = JSON.stringify({
    public_key_x963_hex: bytesToHex(input.publicKeyX963),
    signature_der_hex: bytesToHex(input.signatureDer),
    challenge_hex: bytesToHex(input.challenge),
  });
  const pointer = loaded.verify(request, Buffer.byteLength(request));
  if (!pointer) {
    return unavailable(
      'OPERATOR_PRESENCE_KERNEL_FAILURE',
      'pd-anchor returned a null response; authorization was refused',
    );
  }

  try {
    const raw = loaded.koffi.decode(pointer, 'char', -1);
    const parsed = JSON.parse(raw) as Partial<{
      ok: boolean;
      code: string;
      reason: string;
    }>;
    if (
      typeof parsed.ok !== 'boolean' ||
      typeof parsed.code !== 'string' ||
      typeof parsed.reason !== 'string'
    ) {
      return unavailable(
        'OPERATOR_PRESENCE_KERNEL_RESPONSE_INVALID',
        'pd-anchor returned an invalid operator-presence response; authorization was refused',
      );
    }
    return {
      ok: parsed.ok,
      code: parsed.code,
      reason: parsed.reason,
      source: 'rust-kernel',
    };
  } catch (error) {
    return unavailable(
      'OPERATOR_PRESENCE_KERNEL_RESPONSE_INVALID',
      `pd-anchor response could not be decoded; authorization was refused: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    loaded.free(pointer);
  }
}

/**
 * Verify a live helper PID against pd-anchor's compiled-in FleetBar policy.
 * The caller cannot supply a path or requirement and therefore cannot weaken
 * the Developer-ID, notarization, hardened-runtime, entitlement, or DYLD gates.
 */
export function verifyFleetBarProcessTrust(pid: number): FleetBarProcessTrustResult {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fff_ffff) {
    return {
      ok: false,
      code: 'INVALID_PID',
      reason: 'FleetBar helper PID must be a positive 32-bit integer',
      trust: null,
      source: 'unavailable',
    };
  }
  const loaded = loadKernel();
  if (!loaded) {
    return {
      ok: false,
      code: 'OPERATOR_PRESENCE_KERNEL_UNAVAILABLE',
      reason: loadError ?? 'required pd-anchor FleetBar process verifier is unavailable',
      trust: null,
      source: 'unavailable',
    };
  }
  const pointer = loaded.verifyFleetBarProcess(pid);
  if (!pointer) {
    return {
      ok: false,
      code: 'OPERATOR_PRESENCE_KERNEL_FAILURE',
      reason: 'pd-anchor returned a null FleetBar process-trust response',
      trust: null,
      source: 'unavailable',
    };
  }
  try {
    const raw = loaded.koffi.decode(pointer, 'char', -1);
    const parsed = JSON.parse(raw) as Partial<{
      ok: boolean;
      code: string;
      reason: string;
      trust: FleetBarProcessTrustEvidence | null;
    }>;
    const trustValid =
      parsed.trust === null ||
      (typeof parsed.trust === 'object' &&
        parsed.trust !== null &&
        Number.isSafeInteger(parsed.trust.pid) &&
        typeof parsed.trust.identity === 'string' &&
        typeof parsed.trust.notarized === 'boolean' &&
        typeof parsed.trust.hardened_runtime === 'boolean' &&
        typeof parsed.trust.debug_privileges === 'boolean' &&
        typeof parsed.trust.unsafe_dyld_environment === 'boolean');
    if (
      typeof parsed.ok !== 'boolean' ||
      typeof parsed.code !== 'string' ||
      typeof parsed.reason !== 'string' ||
      !trustValid ||
      (parsed.ok && parsed.trust === null) ||
      (!parsed.ok && parsed.trust !== null)
    ) {
      throw new Error('response shape is invalid');
    }
    return {
      ok: parsed.ok,
      code: parsed.code,
      reason: parsed.reason,
      trust: parsed.trust ?? null,
      source: 'rust-kernel',
    };
  } catch (error) {
    return {
      ok: false,
      code: 'OPERATOR_PRESENCE_KERNEL_RESPONSE_INVALID',
      reason: `pd-anchor FleetBar process-trust response was refused: ${
        error instanceof Error ? error.message : String(error)
      }`,
      trust: null,
      source: 'unavailable',
    };
  } finally {
    loaded.free(pointer);
  }
}

/** Reset loader state for isolated tests. Never call in production code. */
export function __resetOperatorPresenceKernelForTests(): void {
  kernel = null;
  loadAttempted = false;
  loadError = null;
  loadedPath = null;
  lastCheckedPaths = [];
}
