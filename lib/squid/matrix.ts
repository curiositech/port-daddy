/**
 * The Ink Cloud — POSIX Stigmergic Attention Matrix (ADR-0091, Giant Squid Harness)
 * =================================================================================
 *
 * A flat, POSIX-readable `KEY="value"` environment matrix that lives at
 * `~/.port-daddy/matrix.env`. It is the *hot read/write cache* the shell hook
 * "tentacles" (`bin/pd-hook-*`) grep at native speed — NOT a second source of
 * truth. The durable coordination state remains in `lib/attention.ts` /
 * `lib/pheromone.ts`; the daemon reconciles the two (see RECONCILE TODO below).
 *
 * Hard rules (from the ADR):
 *  - Path is `~/.port-daddy/matrix.env`, NEVER `/tmp`. macOS purges /tmp.
 *  - Writes are atomic and guarded by a sibling lockfile so the *Jamie Madrox*
 *    pattern (K≥8 highly-parallel ephemeral agents) can append pheromones with
 *    zero torn lines.
 *  - A per-fleet shard MAY live at `~/.port-daddy/matrix/<fleet>.env`.
 *
 * Locking note (platform truth): the ADR says "flock-guarded". `flock(1)` is a
 * Linux util and is NOT present on macOS. The portable primitive that is atomic
 * on every POSIX filesystem is an exclusive directory create (`mkdir`), which is
 * exactly what we use here and in the shell hooks. When `flock(1)` IS present
 * (Linux), the shell hooks prefer it; the semantics are identical (a held lock
 * is a held lock). The TS layer always uses the mkdir lock so behaviour matches
 * across platforms.
 */

import {
  mkdirSync,
  rmdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// ─── Paths ───────────────────────────────────────────────────────────────────

/**
 * Root of all Port Daddy runtime state. NEVER /tmp.
 * Honors `PD_HOME` (the same override the shell hooks read) so the TS layer and
 * the `pd-hook-*` tentacles always agree on one matrix location — load-bearing
 * for hermetic tests and for fleets that relocate their runtime root.
 */
export function pdRoot(): string {
  const env = process.env.PD_HOME;
  if (env && env.trim()) return env;
  return join(homedir(), '.port-daddy');
}

/** Absolute path to the global Ink Cloud matrix file. */
export function matrixPath(fleet?: string): string {
  // `PD_MATRIX_FILE` is the most specific override (a single concrete file the
  // hooks read). It wins for the unsharded matrix; per-fleet shards still derive
  // from pdRoot() so a fleet shard and the global file can coexist.
  if (!fleet) {
    const fileEnv = process.env.PD_MATRIX_FILE;
    if (fileEnv && fileEnv.trim()) return fileEnv;
  }
  if (fleet && fleet.trim()) {
    // Per-fleet shard: ~/.port-daddy/matrix/<fleet>.env
    const safe = fleet.replace(/[^A-Za-z0-9._-]/g, '_');
    return join(pdRoot(), 'matrix', `${safe}.env`);
  }
  return join(pdRoot(), 'matrix.env');
}

/** The sibling lock *directory* (mkdir-atomic) guarding a given matrix file. */
export function matrixLockPath(fleet?: string): string {
  return `${matrixPath(fleet)}.lock`;
}

// ─── Lock primitive (portable, atomic) ────────────────────────────────────────

export interface LockOptions {
  /** Total time to keep retrying the lock before giving up (ms). */
  timeoutMs?: number;
  /** Sleep between attempts (ms). */
  retryMs?: number;
  /** A held lock older than this is treated as stale and broken (ms). */
  staleMs?: number;
}

const DEFAULT_LOCK: Required<LockOptions> = {
  timeoutMs: 5000,
  retryMs: 15,
  staleMs: 30_000,
};

function sleepBusy(ms: number): void {
  // Synchronous, tiny spin-wait. We deliberately keep the lock-held window
  // microscopic (read string → mutate string → atomic rename), so contention
  // resolves in well under the 5ms grep-latency budget at K=8.
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

/**
 * Acquire the matrix lock by atomically creating the lock directory.
 * `mkdir` is the POSIX-atomic compare-and-swap available on macOS AND Linux.
 * Breaks a stale lock (older than `staleMs`) so a crashed agent can't wedge the
 * Ink Cloud forever — degraded coordination beats a hung fleet (ADR mitigation).
 */
export function acquireLock(fleet?: string, opts: LockOptions = {}): () => void {
  const o = { ...DEFAULT_LOCK, ...opts };
  const lock = matrixLockPath(fleet);
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + o.timeoutMs;

  for (;;) {
    try {
      mkdirSync(lock); // throws EEXIST if held — this is the atomic CAS
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          rmdirSync(lock);
        } catch {
          /* already gone — fine */
        }
      };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;
      // Held. Break if stale.
      try {
        const age = Date.now() - statSync(lock).mtimeMs;
        if (age > o.staleMs) {
          try {
            rmdirSync(lock);
          } catch {
            /* lost the race to break it — loop and retry */
          }
          continue;
        }
      } catch {
        /* stat failed → lock vanished under us; loop and retry */
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `[squid/matrix] could not acquire matrix lock ${lock} within ${o.timeoutMs}ms`,
        );
      }
      sleepBusy(o.retryMs);
    }
  }
}

/** Run `fn` while holding the matrix lock, always releasing it. */
export function withLock<T>(fleet: string | undefined, fn: () => T, opts?: LockOptions): T {
  const release = acquireLock(fleet, opts);
  try {
    return fn();
  } finally {
    release();
  }
}

// ─── Serialization (the POSIX-readable format) ────────────────────────────────

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Escape a value for the `KEY="value"` POSIX line format. */
export function escapeValue(v: string): string {
  // Collapse newlines (the format is one-line-per-key so `grep` works) and
  // escape `"` and `\` so the line round-trips and stays shell-parseable.
  const flat = String(v).replace(/\r?\n/g, ' ');
  return flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Inverse of {@link escapeValue}. */
export function unescapeValue(v: string): string {
  return v.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/** Parse raw matrix text into a key→value map (defensive: ignores junk lines). */
export function parseMatrix(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = ENV_LINE.exec(line);
    if (!m) continue;
    let val = m[2];
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      val = unescapeValue(val.slice(1, -1));
    }
    out[m[1]] = val;
  }
  return out;
}

const MATRIX_BANNER = [
  '# ============================================================================',
  '# PORT DADDY STIGMERGIC ATTENTION MATRIX  (~/.port-daddy/matrix.env)',
  '# The Ink Cloud (ADR-0091). Hot cache for pd-hook-* tentacles. POSIX-readable.',
  "# Lines are KEY=\"value\". Do not hand-edit while agents are voyaging.",
  '# ============================================================================',
  '',
].join('\n');

/** Serialize a key→value map back to the banner + `KEY="value"` lines. */
export function serializeMatrix(kv: Record<string, string>): string {
  const lines = Object.keys(kv)
    .sort()
    .map((k) => `${k}="${escapeValue(kv[k])}"`);
  return `${MATRIX_BANNER}${lines.join('\n')}\n`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read and parse the matrix. Returns `{}` when the file does not exist yet. */
export function readMatrix(fleet?: string): Record<string, string> {
  const p = matrixPath(fleet);
  if (!existsSync(p)) return {};
  try {
    return parseMatrix(readFileSync(p, 'utf8'));
  } catch {
    // Defensive: a half-written or unreadable matrix must never crash a reader.
    return {};
  }
}

/** Atomically write the whole matrix (lock + temp-file + rename). */
function writeMatrixLocked(kv: Record<string, string>, fleet?: string): void {
  const p = matrixPath(fleet);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, serializeMatrix(kv), { mode: 0o600 });
  renameSync(tmp, p); // atomic on POSIX
}

/** Set (or overwrite) a single KEY under the lock. */
export function setKey(key: string, value: string, fleet?: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`[squid/matrix] invalid matrix key: ${JSON.stringify(key)}`);
  }
  withLock(fleet, () => {
    const kv = readMatrix(fleet);
    kv[key] = value;
    writeMatrixLocked(kv, fleet);
  });
}

/** Delete a single KEY under the lock. No-op if absent. */
export function deleteKey(key: string, fleet?: string): void {
  withLock(fleet, () => {
    const kv = readMatrix(fleet);
    if (key in kv) {
      delete kv[key];
      writeMatrixLocked(kv, fleet);
    }
  });
}

export interface PheromoneTrace {
  /** Subject of the trace (e.g. a file path or symbol). */
  subject: string;
  /** Human-readable note ("auth.ts uses deprecated v1_hook"). */
  note: string;
  /** Intensity 1..n — fades via pheromone decay once reconciled by the daemon. */
  intensity?: number;
  /** Actor that left the trace. */
  actor?: string;
}

/** Normalize an arbitrary string into a matrix-key-safe suffix. */
export function keySuffix(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 80) || 'X';
}

/**
 * Append a pheromone trace under a unique `PD_PHEROMONE_*` key (lock-guarded).
 * Returns the key that was written. This is what the daemon later reconciles
 * into the durable pheromone store; here it is just an append into the Ink Cloud.
 */
export function appendPheromone(trace: PheromoneTrace, fleet?: string): string {
  const intensity = trace.intensity ?? 1;
  const stamp = Date.now();
  const key = `PD_PHEROMONE_${keySuffix(trace.subject)}_${stamp}`;
  const value =
    `${trace.subject} | ${trace.note} | intensity:${intensity}` +
    (trace.actor ? ` | actor:${trace.actor}` : '') +
    ` | ts:${new Date(stamp).toISOString()}`;
  setKey(key, value, fleet);
  return key;
}

/** Read all pheromone traces (keys prefixed `PD_PHEROMONE_`). */
export function readPheromones(fleet?: string): Record<string, string> {
  return filterByPrefix(readMatrix(fleet), 'PD_PHEROMONE_');
}

export interface LockEntry {
  /** The path/subject this lock covers (decoded from the key). */
  subject: string;
  /** The raw `PD_LOCK_*` key. */
  key: string;
  /** Who holds it (the value). */
  owner: string;
}

/** Compute the canonical `PD_LOCK_<path>` key for a file path. */
export function lockKeyForPath(filePath: string): string {
  return `PD_LOCK_${keySuffix(filePath)}`;
}

/** Set a file lock owned by `owner`. Used by the daemon / tests, read by hooks. */
export function setLock(filePath: string, owner: string, fleet?: string): string {
  const key = lockKeyForPath(filePath);
  setKey(key, owner, fleet);
  return key;
}

/** Release a file lock. */
export function releaseLock(filePath: string, fleet?: string): void {
  deleteKey(lockKeyForPath(filePath), fleet);
}

/** Read all file locks (keys prefixed `PD_LOCK_`). */
export function readLocks(fleet?: string): LockEntry[] {
  const kv = filterByPrefix(readMatrix(fleet), 'PD_LOCK_');
  return Object.keys(kv).map((key) => ({
    key,
    subject: key.replace(/^PD_LOCK_/, ''),
    owner: kv[key],
  }));
}

/** Read all steering alerts (keys prefixed `PD_ALERT_`). */
export function readAlerts(fleet?: string): Record<string, string> {
  return filterByPrefix(readMatrix(fleet), 'PD_ALERT_');
}

/** Set a steering alert / Parley alert that the prompt tentacle will inject. */
export function setAlert(id: string, message: string, fleet?: string): string {
  const key = `PD_ALERT_${keySuffix(id)}`;
  setKey(key, `${message} | ts:${new Date().toISOString()}`, fleet);
  return key;
}

function filterByPrefix(kv: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(kv)) if (k.startsWith(prefix)) out[k] = kv[k];
  return out;
}

// ─── RECONCILE TODO (daemon) ──────────────────────────────────────────────────
// The Ink Cloud is the hot cache; `lib/attention.ts` + `lib/pheromone.ts` are the
// durable truth. A daemon reconcile loop (NOT built in this vertical slice) must:
//   1. Drain PD_PHEROMONE_* appends into the pheromone store, applying decay
//      (lib/pheromone.ts createPheromoneManager) and then pruning faded keys.
//   2. Project active locks / Parley alerts (lib/attention.ts AttentionItem) back
//      OUT to PD_LOCK_* / PD_ALERT_* so the hooks read a fresh cache each turn.
//   3. Garbage-collect PD_PHEROMONE_* entries whose intensity has decayed to ~0.
// Until that loop exists the matrix is append-mostly and the tests below seed it
// directly. This boundary is intentional and called out in the ADR (§1).
