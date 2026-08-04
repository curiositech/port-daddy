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

/**
 * How a read of the matrix file turned out.
 *
 * **Motivation — the distinction this type exists to force.** `absent` and
 * `unreadable` both yield an empty map, and collapsing them is a
 * *destructive* bug rather than a cosmetic one: a reader that treats "I could
 * not open this file" as "this file is empty" and then rewrites the whole file
 * has just made its own ignorance authoritative, deleting every key every other
 * writer put there. That is exactly how one transient `EACCES` / `EIO` /
 * `EMFILE` — all reachable at the K≥8 parallelism this design targets — erased
 * the `PD_LOCK_*` keys `bin/pd-hook-pre-tool` reads to stop two agents editing
 * the same file. Absence is knowledge; failure is not.
 */
export type MatrixReadState = 'present' | 'absent' | 'unreadable';

/** The outcome of {@link tryReadMatrix}: what we learned, and how much to trust it. */
export interface MatrixReadResult {
  /** Whether the file was read, legitimately did not exist, or could not be opened. */
  readonly state: MatrixReadState;
  /** Parsed contents. Empty for both `absent` and `unreadable` — hence `state`. */
  readonly kv: Record<string, string>;
  /** The underlying failure when `state` is `unreadable`. */
  readonly error?: NodeJS.ErrnoException;
}

/**
 * Read the matrix, reporting whether the answer is knowledge or ignorance.
 *
 * **Purpose.** This is the read every *rewriter* must use. {@link readMatrix}
 * flattens failure into `{}` for the convenience of read-only consumers (a hook
 * that shows nothing is merely quiet), but any caller that is about to serialize
 * a whole new file from what it read needs to know the difference — see
 * {@link MatrixReadState}.
 *
 * **Design.** It opens the file directly rather than asking `existsSync` first.
 * Two reasons: the stat-then-open pair is a TOCTOU race (the file can be
 * renamed into place between the two calls, which is precisely what every
 * atomic writer here does), and `existsSync` answers `false` for a path that
 * exists but cannot be stat'd — folding an unreadable path back into "absent",
 * which is the exact conflation this function exists to end. `ENOENT` from the
 * open is the one and only proof of legitimate absence.
 *
 * @param fleet Optional per-fleet shard name; omit for the global matrix.
 * @returns The parsed matrix plus the state that says how much to trust it.
 */
export function tryReadMatrix(fleet?: string): MatrixReadResult {
  const p = matrixPath(fleet);
  let text: string;
  try {
    text = readFileSync(p, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === 'ENOENT') return { state: 'absent', kv: {} };
    return { state: 'unreadable', kv: {}, error: e };
  }
  return { state: 'present', kv: parseMatrix(text) };
}

/**
 * Read and parse the matrix. Returns `{}` when the file does not exist yet —
 * and, for backward compatibility with every read-only consumer, also when it
 * could not be read at all.
 *
 * **Read this before using it to build a write.** The two empty answers are not
 * the same fact, and this function cannot tell you which one you got. That is
 * safe for a consumer that only *displays* what it found (a quiet hook is the
 * documented fail-open posture) and unsafe for anything that rewrites the file:
 * use {@link tryReadMatrix} there and refuse to write on `unreadable`.
 *
 * @param fleet Optional per-fleet shard name; omit for the global matrix.
 * @returns The parsed key→value map, or `{}` when absent or unreadable.
 */
export function readMatrix(fleet?: string): Record<string, string> {
  return tryReadMatrix(fleet).kv;
}

/**
 * Read the matrix for the purpose of rewriting it, refusing to guess.
 *
 * **Why this throws instead of returning `{}`.** Every writer below serializes
 * the WHOLE file from the map it reads, so an empty map from a failed read is a
 * delete-everything instruction. The design intent is that the failure surfaces
 * as an exception at the moment of the bad read — where the errno is still in
 * hand and the caller can retry — rather than as silent, unattributable data
 * loss discovered by an agent whose lock key vanished.
 *
 * @param fleet Optional per-fleet shard name.
 * @returns The current contents, or `{}` when the file legitimately does not exist.
 * @throws When the file exists but could not be read.
 */
function readForRewrite(fleet?: string): Record<string, string> {
  const snap = tryReadMatrix(fleet);
  if (snap.state === 'unreadable') {
    throw new Error(
      `[squid/matrix] refusing to rewrite ${matrixPath(fleet)}: current contents are unreadable ` +
        `(${snap.error?.code ?? 'unknown error'}) — a whole-file write from an unread file deletes every other writer's keys`,
    );
  }
  return snap.kv;
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
    const kv = readForRewrite(fleet);
    kv[key] = value;
    writeMatrixLocked(kv, fleet);
  });
}

/** Delete a single KEY under the lock. No-op if absent. */
export function deleteKey(key: string, fleet?: string): void {
  withLock(fleet, () => {
    const kv = readForRewrite(fleet);
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

/** Longest key segment this normalizer will emit. Mirrored by `cut -c1-80` in the shell hooks. */
export const KEY_SUFFIX_MAX = 80;

/**
 * Normalize an arbitrary string into a matrix-key-safe suffix.
 *
 * **Purpose.** Env keys are `[A-Za-z_][A-Za-z0-9_]*`; session ids, branch names
 * and file paths are not. This is the single definition of that transformation,
 * shared by `actorKey()` in `reconcile-contract.ts` and mirrored verbatim by the
 * three POSIX hooks in `bin/`. One definition is the design: two normalizers
 * that "should" agree drift silently, and the symptom (an agent never hearing
 * about its own inbox) looks nothing like the cause.
 *
 * **Why the trailing-underscore strip runs TWICE — the bug this shape encodes.**
 * The obvious order (collapse → strip → truncate) is wrong, and wrong in a way
 * that breaks per-actor isolation rather than merely looking untidy. `slice()`
 * can cut in the middle of the string and expose an underscore that was interior
 * before the cut, so a key could end in `_` even though step 2 promised it never
 * would. `PER_ACTOR_SEPARATOR` is `__` precisely *because* this function is
 * supposed to make `__` unforgeable; a trailing `_` abutting the appended
 * separator yields `___`, and then the first `__` in the key sits one character
 * to the left of the real boundary — so actor `a×79 + "-x"` (which truncates to
 * 79 `A`s plus `_`) becomes readable by the anchored prefix of actor `a×79`.
 * That is a live cross-actor mail leak, and it is closed by stripping again
 * *after* the cut. Truncation can only remove characters, never create a `__`,
 * so a second strip is sufficient.
 *
 * **This function is deliberately still LOSSY.** `a-b`, `a.b` and `a_b` all
 * normalize to `A_B`, and every id with no ASCII alphanumerics normalizes to
 * `X`. For the *subject* half of a key (a path, a branch, a message id) that is
 * acceptable and fails in the safe direction: two aliased paths share one
 * `PD_LOCK_*` key, which over-locks rather than under-locks. For the *actor*
 * half it is not acceptable — aliasing there is a mail leak — which is why
 * `actorKey()` in `reconcile-contract.ts` appends a digest of the raw id on top
 * of this normalization instead of using it bare. Do not "fix" the aliasing
 * here; it would change every `PD_LOCK_*` / `PD_PHEROMONE_*` / `PD_CLAIM_*` key
 * shape and the two shell hooks that mirror them, for no isolation gain.
 *
 * @param s Raw string (actor id, file path, branch, message id).
 * @returns A non-empty string matching `/^[A-Za-z0-9][A-Za-z0-9_]*$/` of at most
 *          {@link KEY_SUFFIX_MAX} characters, never beginning or ending with `_`
 *          and never containing `__`.
 */
export function keySuffix(s: string): string {
  const collapsed = s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  // Strip again AFTER the cut — see the docblock. This is the isolation fix.
  return collapsed.slice(0, KEY_SUFFIX_MAX).replace(/_+$/g, '') || 'X';
}

/** Lookup table for the POSIX `cksum` CRC (polynomial 0x04C11DB7, MSB-first). */
const CKSUM_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i << 24;
    for (let k = 0; k < 8; k += 1) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/**
 * The checksum POSIX `cksum(1)` computes, over the UTF-8 bytes of a string.
 *
 * **Motivation — why a digest at all, and why *this* one.** `actorKey()` needs
 * to be injective: two different agent ids must never land on the same matrix
 * address, or one agent reads the other's mail. Normalization alone cannot
 * deliver that (it is lossy by construction — see {@link keySuffix}), so the
 * address carries a digest of the *raw* id alongside the readable form. The
 * digest therefore has to be computable in three places that share no runtime:
 * this module, `bin/pd-hook-prompt`, and any future non-Node reader.
 *
 * **Design.** `cksum` is the only checksum POSIX actually specifies — its
 * algorithm is normative text, not an implementation detail — so a shell hook
 * can produce the identical number with `printf '%s' "$id" | cksum` on macOS,
 * Linux, and BusyBox alike. `md5`/`sha1` were rejected precisely because they
 * are *not* POSIX: the binary is called `md5` on macOS and `md5sum` on GNU, with
 * different output shapes, which is exactly the kind of per-platform drift that
 * makes an agent silently unable to find its own inbox. CRC-32 is not and need
 * not be cryptographic here — an actor id is not a secret, and the property
 * being bought is collision-avoidance between honest ids, not unforgeability.
 * `tests/unit/squid-reconcile-contract.test.ts` executes real `cksum` against
 * this function over the shared corpus, so parity is proven rather than assumed.
 *
 * @param s Raw string; hashed as UTF-8 bytes.
 * @returns The CRC as an unsigned 32-bit integer (`0`–`4294967295`), matching
 *          the first field of `cksum` output byte-for-byte when rendered decimal.
 */
export function posixCksum(s: string): number {
  const buf = Buffer.from(s, 'utf8');
  let crc = 0;
  for (const b of buf) crc = ((crc << 8) ^ CKSUM_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  // POSIX folds the byte length in after the data, low-order octet first.
  for (let len = buf.length; len !== 0; len >>>= 8) {
    crc = ((crc << 8) ^ CKSUM_TABLE[((crc >>> 24) ^ (len & 0xff)) & 0xff]) >>> 0;
  }
  return ~crc >>> 0;
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

// ─── Reconcile (daemon) ───────────────────────────────────────────────────────
// The Ink Cloud is the hot cache; the durable stores are the truth. The daemon
// reconcile loop that projects durable state INTO this file and garbage-collects
// what the sources no longer justify now lives in `lib/squid/reconcile.ts`
// (vocabulary in `lib/squid/reconcile-contract.ts`). It owns all three duties
// this comment used to list as TODO: draining + decaying PD_PHEROMONE_* appends,
// re-projecting the freshest traces, and deleting the faded ones — plus the
// per-class projection and GC of every key class in the reconcile registry.
//
// NOTE for reconcile-loop maintainers: `setKey`/`deleteKey` each take the matrix
// lock, and the mkdir lock is NOT reentrant. A tick must do its whole
// read-modify-write inside ONE `withLock`, never by calling setKey per key.
