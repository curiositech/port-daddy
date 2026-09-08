/**
 * Binary Drift Detector
 *
 * When `brew upgrade port-daddy` (or any in-place binary swap) lands a newer
 * binary at the canonical runtime path, the currently-running daemon process
 * keeps executing the OLD binary in memory. Routes added in the new version
 * return 404. Embedded assets present in the new binary are missing. The user
 * has no obvious signal that they need to `pd stop && pd start`.
 *
 * This module detects that condition by comparing two file digests:
 *   - runningHash: SHA-256 of the binary that this process was launched from
 *     (process.execPath, snapshotted at startup before any upgrade can swap it)
 *   - onDiskHash:  SHA-256 of the comparable on-disk runtime binary
 *
 * When the two diverge, the daemon emits a drift signal that /health surfaces.
 *
 * Why hash both:
 *   - Comparing only paths fails when brew keeps the same symlink target.
 *   - Comparing only sizes fails on patch-level releases of identical size.
 *   - mtimes are unreliable: tar extract, rsync, and cp -p all preserve them.
 *
 * Why snapshot the running hash at startup:
 *   - On macOS, replacing an executable's file (mv) breaks process.execPath's
 *     visibility into the original. We hash once at boot so the snapshot is
 *     stable even after the on-disk file is replaced.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';

export interface BinaryDriftSnapshot {
  /** Absolute, realpath-resolved path to the binary this process was launched from. */
  runningPath: string;
  /** SHA-256 of the running binary at daemon startup (cached). */
  runningHash: string | null;
  /** Size in bytes of the running binary at startup, for human-readable diagnostics. */
  runningSizeBytes: number | null;
  /** Absolute, realpath-resolved path to the comparable on-disk runtime binary. */
  onDiskPath: string | null;
  /** SHA-256 of the comparable on-disk runtime binary right now. */
  onDiskHash: string | null;
  /** Size in bytes of the comparable on-disk runtime binary right now. */
  onDiskSizeBytes: number | null;
  /** True when the running binary digest differs from the on-disk digest. */
  drifted: boolean;
  /** Human-readable explanation. Null when we cannot determine. */
  reason: string | null;
  /** When this snapshot was computed. */
  checkedAt: number;
}

/** SHA-256 a file by streaming-free `readFileSync` (binaries are bounded, ~150MB). */
function hashFile(path: string): string | null {
  try {
    const buf = readFileSync(path);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function safeSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical on-disk `pd` binary path.
 *
 * Strategy:
 *   1. Honor PORT_DADDY_BIN_OVERRIDE for test injection.
 *   2. Otherwise run `command -v pd` (POSIX) to find the path on PATH.
 *   3. realpathSync the result so we follow brew's Cellar symlink.
 *
 * Returns null when no `pd` is on PATH or the resolver fails. We do NOT throw —
 * a daemon installed without the `pd` symlink (rare, but possible for dev
 * builds) should not crash health checks.
 */
export function resolveOnDiskPdPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.PORT_DADDY_BIN_OVERRIDE) {
    return safeRealpath(env.PORT_DADDY_BIN_OVERRIDE);
  }
  try {
    const out = execFileSync('/bin/sh', ['-c', 'command -v pd'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
    }).trim();
    if (!out) return null;
    return safeRealpath(out);
  } catch {
    return null;
  }
}

function resolveComparableOnDiskPath(
  runningPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.PORT_DADDY_BIN_OVERRIDE) {
    return resolveOnDiskPdPath(env);
  }

  if (basename(runningPath) === 'port-daddy-daemon') {
    const siblingDaemon = join(dirname(runningPath), 'port-daddy-daemon');
    if (existsSync(siblingDaemon)) {
      return safeRealpath(siblingDaemon);
    }
  }

  // Homebrew installs a small `pd` launcher beside the compiled `port-daddy`
  // runtime. Their hashes and sizes are intentionally different, so comparing
  // the daemon to `command -v pd` creates permanent false drift even immediately
  // after a clean restart. The comparable artifact is the same executable name
  // in the same keg; an in-place bottle upgrade still changes this file's hash.
  if (basename(runningPath) === 'port-daddy') {
    const siblingRuntime = join(dirname(runningPath), 'port-daddy');
    if (existsSync(siblingRuntime)) {
      return safeRealpath(siblingRuntime);
    }
  }

  return resolveOnDiskPdPath(env);
}

/**
 * Snapshot the running binary at daemon startup. Call this exactly once, as
 * early as possible in server boot, and pass the result into `detectDrift`
 * later. Cached because we cannot trust process.execPath's contents to remain
 * stable across an in-place binary swap.
 */
export function snapshotRunningBinary(execPath: string = process.execPath): {
  runningPath: string;
  runningHash: string | null;
  runningSizeBytes: number | null;
} {
  const runningPath = safeRealpath(execPath);
  const runningHash = existsSync(runningPath) ? hashFile(runningPath) : null;
  const runningSizeBytes = safeSize(runningPath);
  return { runningPath, runningHash, runningSizeBytes };
}

export interface DetectDriftOptions {
  /** The snapshot taken at startup via `snapshotRunningBinary`. */
  runningSnapshot: ReturnType<typeof snapshotRunningBinary>;
  /** Optional override of the on-disk path resolver. Used in tests. */
  resolveOnDisk?: (env: NodeJS.ProcessEnv) => string | null;
  /** Env to consult for PATH / overrides. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override the wall-clock for tests. */
  now?: () => number;
}

/**
 * Compare the startup snapshot to the canonical on-disk binary right now.
 * Cheap (one realpath + one hash). Suitable for /health requests.
 */
export function detectDrift(opts: DetectDriftOptions): BinaryDriftSnapshot {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const { runningPath, runningHash, runningSizeBytes } = opts.runningSnapshot;
  const resolve = opts.resolveOnDisk ?? ((candidateEnv: NodeJS.ProcessEnv) => resolveComparableOnDiskPath(runningPath, candidateEnv));

  const onDiskPath = resolve(env);
  const onDiskExists = onDiskPath !== null && existsSync(onDiskPath);
  const onDiskHash = onDiskExists ? hashFile(onDiskPath!) : null;
  const onDiskSizeBytes = onDiskExists ? safeSize(onDiskPath!) : null;

  let drifted = false;
  let reason: string | null = null;

  if (!runningHash) {
    reason = 'Running binary could not be hashed at startup; drift detection unavailable.';
  } else if (!onDiskPath) {
    reason = 'No comparable Port Daddy binary found on disk; cannot compare.';
  } else if (!onDiskExists) {
    reason = `Comparable Port Daddy binary path ${onDiskPath} does not exist; cannot compare.`;
  } else if (!onDiskHash) {
    reason = `Comparable Port Daddy binary at ${onDiskPath} could not be hashed; cannot compare.`;
  } else if (onDiskHash !== runningHash) {
    drifted = true;
    reason = `Running daemon hash (${runningHash.slice(0, 12)}…) differs from on-disk Port Daddy binary (${onDiskHash.slice(0, 12)}…). Restart required: pd stop && pd start`;
  } else {
    reason = 'Running daemon matches comparable on-disk Port Daddy binary.';
  }

  return {
    runningPath,
    runningHash,
    runningSizeBytes,
    onDiskPath,
    onDiskHash,
    onDiskSizeBytes,
    drifted,
    reason,
    checkedAt: now(),
  };
}
