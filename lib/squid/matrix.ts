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
  setKey(key, message, fleet);
  return key;
}

function filterByPrefix(kv: Record<string, string>, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(kv)) if (k.startsWith(prefix)) out[k] = kv[k];
  return out;
}

// ─── Actor addressing (W1.1, per-session "FOR YOU" classes) ───────────────────

/**
 * Canonical actor→matrix-key normalizer.
 *
 * Motivation: three independent readers/writers address the same actor —
 * the TS reconcile loop (writer, `lib/squid/reconcile.ts`), the POSIX shell
 * tentacles (`bin/pd-hook-prompt` / `bin/pd-hook-pre-tool` readers), and the
 * hookless ink-cloud reader (`lib/local-citizen/ink-cloud.ts`). One canonical
 * mapping, byte-identical everywhere, is the only thing that makes
 * `PD_INBOX_<actor>_*` addressing work at all.
 *
 * Design: this is DELIBERATELY not a new algorithm — it is {@link keySuffix}
 * verbatim (non-alnum runs → "_", trim leading/trailing "_", UPPERCASE, cap 80,
 * fallback 'X'). The sed mirror already deployed in pd-hook-pre-tool `suffix()`
 * and pd-hook-post-tool `suffix()` implements exactly keySuffix(), so reusing it
 * means the shell mirror is the EXISTING sed snippet — zero new drift surface.
 *
 * Collisions between distinct actor ids that normalize identically are ACCEPTED
 * and documented: this is an advisory addressing surface, not an auth boundary.
 * Never build enforcement on inbox addressing without a hash disambiguator.
 *
 * @param actor raw actor/agent id (e.g. `port-daddy:contrib:slug-1`)
 * @returns the matrix-key-safe UPPERCASE suffix for this actor
 */
export function actorKey(actor: string): string {
  return keySuffix(actor);
}

/**
 * Compute the addressed-inbox matrix key for one actor slot.
 *
 * Purpose: the reconcile loop projects an actor's top attention items into a
 * small fixed set of slots (1..3) so the prompt tentacle can grep
 * `^PD_INBOX_<ACTOR>_[0-9]+=` and render a bounded "[FOR YOU]" block.
 *
 * @param actor raw actor id (normalized via {@link actorKey})
 * @param slot 1-based slot number (the reconcile budget caps this at 3)
 * @returns e.g. `PD_INBOX_MYAGENT_1`
 */
export function inboxKey(actor: string, slot: number): string {
  return `PD_INBOX_${actorKey(actor)}_${slot}`;
}

/**
 * Compute the addressed parley-summons matrix key for an actor + parley id.
 *
 * Why both parts are normalized: the actor segment must match the shell
 * `suffix()` mirror for addressing, and the parley id segment must be
 * matrix-key-safe; both go through the one canonical {@link keySuffix} law.
 *
 * @param actor raw actor id being summoned
 * @param parleyId the parley's id (normalized via keySuffix)
 * @returns e.g. `PD_PARLEY_MYAGENT_PARLEY_42`
 */
export function parleyKey(actor: string, parleyId: string): string {
  return `PD_PARLEY_${actorKey(actor)}_${keySuffix(parleyId)}`;
}

// ─── Reconcile ownership registry (single-owner contract) ─────────────────────

/** Heartbeat key the reconcile loop refreshes every tick (epoch MILLISECONDS).
 *  Readers treat the whole projected surface as stale (and enforcement rungs
 *  fail OPEN) when this is absent or older than PD_RECON_STALE_MS (60s). */
export const RECON_HEARTBEAT_KEY = 'PD_RECON_HEARTBEAT_TS';

/** Repo-wide pause key. Present ⇔ panic is armed; the value carries provenance. */
export const HALT_KEY = 'PD_HALT';

/**
 * Key-class prefixes wholly OWNED by the reconcile loop: any key under one of
 * these prefixes that is not in the current desired projection is a stray and
 * gets garbage-collected (this is the matrix.env grows-forever fix).
 *
 * Deliberately NOT here: `PD_ALERT_` (owned as the EXACT key
 * PD_ALERT_FLEET_APPROVALS only — setAlert() remains a legitimate
 * operator/other-writer surface), `PD_LOCK_` (owned by the locks path), and
 * `PD_PHEROMONE_` (split ownership — see {@link isRawPheromoneKey}).
 */
export const RECON_OWNED_PREFIXES = [
  'PD_INBOX_',
  'PD_PARLEY_',
  'PD_CLAIM_',
  'PD_CI_',
  'PD_ACCOMPLISHMENT_',
] as const;

/**
 * Disambiguate the two writers that share the `PD_PHEROMONE_` prefix.
 *
 * Motivation: shell agents APPEND raw pheromone traces (pd-hook-post-tool,
 * key = `PD_PHEROMONE_<subject>_${TS_EPOCH}${n}` with TS_EPOCH = epoch ms) and
 * TS {@link appendPheromone} appends `_${Date.now()}` — both carry a trailing
 * epoch-ms (≥13-digit) run. The daemon's reconcile loop DRAINS those appends
 * into the durable store, then re-projects the decayed top-N under
 * deterministic keys WITHOUT a timestamp suffix. This predicate is the
 * disambiguator that lets appenders and the GC share one prefix without eating
 * each other's writes: raw (timestamped) keys are drained; non-raw keys are
 * daemon projections that reconcile owns and diffs.
 *
 * @param key a full matrix key
 * @returns true when the key is a raw shell/TS pheromone APPEND
 */
export function isRawPheromoneKey(key: string): boolean {
  return /^PD_PHEROMONE_.*_\d{13,}$/.test(key);
}

/** The full desired state of every reconcile-owned key, for one apply pass. */
export interface ReconcileProjection {
  /** Exact keys the loop owns (e.g. PD_HALT, PD_RECON_HEARTBEAT_TS, PD_ALERT_FLEET_APPROVALS). */
  ownedExactKeys: string[];
  /** Owned key-class prefixes (RECON_OWNED_PREFIXES + projected-pheromone ownership). */
  ownedPrefixes: string[];
  /** Full desired key→value state for owned keys. Absence ⇒ deletion. */
  desired: Record<string, string>;
}

/** Result of one {@link applyProjection} pass. */
export interface ApplyProjectionResult {
  /** Raw pheromone appends harvested (and removed) under the same lock. */
  drainedPheromones: Array<{ key: string; value: string }>;
  /** Number of desired keys written (changed or new). */
  set: number;
  /** Number of stray owned keys garbage-collected. */
  deleted: number;
}

/**
 * THE batched write primitive of the reconcile loop.
 *
 * Motivation: {@link setKey}/{@link deleteKey} are per-key (one lock + one
 * atomic rename each); a reconcile pass touching dozens of keys must instead be
 * ONE lock acquisition, ONE read, ONE atomic rename — the flock discipline that
 * keeps the matrix lock-held window microscopic while K≥8 agents append.
 *
 * Design (all under one lock):
 *   1. Harvest every {@link isRawPheromoneKey} key into `drainedPheromones` and
 *      DELETE it from the map — the drain happens under the SAME lock as the
 *      rewrite so no concurrent shell append is lost between read and write.
 *   2. Garbage-collect strays: any remaining key that is owned (exact key, or
 *      under an owned prefix) and not present in `desired` is deleted. This is
 *      the fix for "matrix.env grows forever".
 *   3. Merge `desired` over the survivors and write once, atomically.
 *
 * Pure with respect to everything except the matrix file itself: the caller
 * (lib/squid/reconcile.ts) ingests the returned drains into the durable store
 * AFTER the lock is released (no DB work under the matrix lock).
 *
 * @param p the ownership registry + full desired state for this pass
 * @param fleet optional per-fleet matrix shard
 * @returns drained raw pheromone appends + set/deleted counters
 */
export function applyProjection(p: ReconcileProjection, fleet?: string): ApplyProjectionResult {
  return withLock(fleet, () => {
    const kv = readMatrix(fleet);
    const drainedPheromones: Array<{ key: string; value: string }> = [];
    let deleted = 0;
    let set = 0;

    // (1) Drain raw pheromone appends (shell/TS timestamped keys).
    for (const k of Object.keys(kv)) {
      if (isRawPheromoneKey(k)) {
        drainedPheromones.push({ key: k, value: kv[k] });
        delete kv[k];
      }
    }

    // (2) Stray-GC over owned classes. Raw pheromones are already gone, so a
    // surviving PD_PHEROMONE_ key here is a daemon projection and is diffable.
    const exact = new Set(p.ownedExactKeys);
    for (const k of Object.keys(kv)) {
      const owned = exact.has(k) || p.ownedPrefixes.some((pref) => k.startsWith(pref));
      if (owned && !(k in p.desired)) {
        delete kv[k];
        deleted += 1;
      }
    }

    // (3) Merge desired state and write once.
    for (const [k, v] of Object.entries(p.desired)) {
      if (kv[k] !== v) set += 1;
      kv[k] = v;
    }
    writeMatrixLocked(kv, fleet);

    return { drainedPheromones, set, deleted };
  });
}

// ─── RECONCILE (daemon) — RESOLVED ────────────────────────────────────────────
// The reconcile loop described by ADR-0108/ADR-0051 phase 0 (formerly a TODO
// block here) is IMPLEMENTED in `lib/squid/reconcile.ts`: it drains raw
// PD_PHEROMONE_* appends into the durable ink_pheromones store with decay,
// projects durable state (halt, approvals, inbox, parley summons, claim
// overlaps, CI) into the owned key classes above, garbage-collects strays via
// {@link applyProjection}, and refreshes {@link RECON_HEARTBEAT_KEY} every tick
// so every reader can fail OPEN on staleness.
