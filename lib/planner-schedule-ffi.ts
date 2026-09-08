/**
 * Planner scheduler — kernel-preferred runtime (ADR-0086 / ADR-0054).
 *
 * The canonical Critical Path Method implementation is the Rust kernel crate
 * `pd-anchor` (`core/kernel/pd-anchor/src/schedule.rs`), exposed over a C ABI
 * (`pd_schedule_dag_json`, `core/kernel/pd-anchor/src/ffi.rs`). This module
 * loads that dylib via koffi and prefers it; when the dylib is ABSENT (source
 * installs, CI — which does not build it), it falls back to the byte-parity
 * TypeScript impl in `lib/planner-schedule.ts`. Same posture `lib/arbiter.ts`
 * holds toward the harbor enforcer and `lib/macaroon-ffi.ts` holds toward the
 * macaroon verifier — this was the one FFI export in `ffi.rs` that had no TS
 * caller at all despite both sides' docstrings claiming otherwise; this file
 * closes that gap.
 *
 * Because parity is locked by `tests/parity_schedule.rs` and
 * `tests/fixtures/planner-schedule-parity-vectors.json`, the FFI path and the
 * fallback path return identical results — the FFI is a performance/trust
 * upgrade, never a behavior change.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { schedule as scheduleTs, type SchedNode, type SchedEdge, type ScheduleResult } from './planner-schedule.js';

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));

const libFileName = 'libpd_anchor.' + (process.platform === 'darwin' ? 'dylib' : 'so');

interface KernelHandle {
  koffi: { decode: (ptr: unknown, type: string, len: number) => string };
  scheduleDag: (req: string, len: number) => unknown;
  free: (ptr: unknown) => void;
}

let kernel: KernelHandle | null = null;
let loadError: string | null = null;
let loadAttempted = false;

/** Where the pd-anchor dylib may live (mirrors macaroon-ffi.ts / arbiter.ts).
 *  `PD_ANCHOR_DYLIB` overrides for tests / non-standard installs. */
function candidatePaths(): string[] {
  const paths: string[] = [];
  const override = process.env.PD_ANCHOR_DYLIB?.trim();
  if (override) paths.push(override);
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
    // Opaque pointer (not auto-decoded) so we can decode AND free it.
    const scheduleDag = lib.func('void* pd_schedule_dag_json(const char* req, size_t len)');
    const free = lib.func('void pd_string_free(void* ptr)');
    kernel = { koffi, scheduleDag, free };
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
    kernel = null;
  }
  return kernel;
}

/** True iff the Rust kernel dylib loaded — i.e. scheduling runs in Rust. */
export function schedulerKernelAvailable(): boolean {
  return loadKernel() !== null;
}

/** The reason the kernel dylib failed to load (for diagnostics), or null. */
export function schedulerKernelLoadError(): string | null {
  loadKernel();
  return loadError;
}

/** Reset the cached load (tests only). */
export function __resetSchedulerKernelForTests(): void {
  kernel = null;
  loadError = null;
  loadAttempted = false;
}

/**
 * Schedule a dependency DAG (Critical Path Method), preferring the Rust
 * kernel and falling back to the byte-parity TS impl when the dylib is
 * absent. The result is identical either way (locked by shared vectors).
 */
export function scheduleDagPreferKernel(nodes: SchedNode[], edges: SchedEdge[]): ScheduleResult {
  const k = loadKernel();
  if (k) {
    const req = JSON.stringify({ nodes, edges });
    const ptr = k.scheduleDag(req, Buffer.byteLength(req));
    if (ptr) {
      try {
        const out = k.koffi.decode(ptr, 'char', -1);
        return JSON.parse(out) as ScheduleResult;
      } finally {
        k.free(ptr);
      }
    }
    // A null pointer is a catastrophic kernel failure (vs. a clean
    // dylib-absent, handled by the loader returning null). Falling back to
    // the byte-parity TS impl is SAFE (same verdict), but it's a real
    // failure the operator should see — emit a signal rather than degrade
    // silently, matching macaroon-ffi.ts's posture.
    console.error(
      '[planner-schedule-ffi] kernel dylib loaded but pd_schedule_dag_json returned null; ' +
        'falling back to the TS scheduler. This is an infrastructure fault, not a clean absence.',
    );
  }
  return scheduleTs(nodes, edges);
}
