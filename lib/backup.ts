/**
 * Backup orchestrator — ADR-0037.
 *
 * Creates and restores point-in-time snapshots of port-registry.db using
 * SQLite's online Backup API. Snapshots are gzipped, sha256-hashed, and
 * persisted via a `BackupBackend`. PR-α writes unencrypted snapshots and
 * warns on stdout; PR-β layers age-encryption-at-rest on top.
 *
 * Read-only orchestration: `createBackup`, `restoreBackup`, `listBackups`,
 * `showBackup`, `pruneBackups`. None of these touch the running daemon's
 * DB handle directly — they open their own handle in read mode.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

import Database from './sqlite-runtime.js';
import { resolveDbPath } from './db.js';
import type { BackupBackend, Manifest, RetentionSpec, SnapshotSummary } from './backup-backends/types.js';
import { DEFAULT_RETENTION } from './backup-backends/types.js';

const PD_VERSION = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', 'package.json'), 'utf8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

export interface CreateBackupOptions {
  backend: BackupBackend;
  dbPath?: string;
  agentId?: string | null;
  sessionId?: string | null;
  /** When set, retention prune runs after the new snapshot lands. */
  retention?: RetentionSpec | null;
  /** Override for tests — by default uses Date.now(). */
  now?: () => number;
  /** Scratch dir for the online-backup tmp file. Defaults to `tmpdir()`. */
  scratchDir?: string;
}

export interface CreateBackupResult {
  snapshotId: string;
  manifest: Manifest;
  pruned: string[];
}

export function generateSnapshotId(at: number, sha256Prefix: string): string {
  const iso = new Date(at).toISOString();
  // 2026-05-19T14:32:01.123Z → 2026-05-19T14-32-01
  const stamp = iso.replace(/\.\d+Z$/, '').replace(/:/g, '-');
  return `${stamp}-${sha256Prefix.slice(0, 8)}`;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function detectSchemaVersion(dbBytes: Buffer): number | null {
  // Open the snapshot bytes read-only to read user_version pragma.
  // Done from bytes (not the live DB) so we record what's *in the snapshot*.
  const scratch = join(tmpdir(), `pd-backup-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  writeFileSync(scratch, dbBytes);
  try {
    const db = new Database(scratch, { readonly: true, fileMustExist: true });
    try {
      const row = db.pragma('user_version', { simple: true });
      return typeof row === 'number' ? row : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  } finally {
    try { rmSync(scratch, { force: true }); } catch { /* ignore */ }
  }
}

export async function createBackup(options: CreateBackupOptions): Promise<CreateBackupResult> {
  const now = (options.now ?? Date.now)();
  const dbPath = options.dbPath ?? resolveDbPath();
  if (!existsSync(dbPath)) {
    throw new Error(`cannot back up: db does not exist at ${dbPath}`);
  }

  const scratchDir = options.scratchDir ?? tmpdir();
  if (!existsSync(scratchDir)) mkdirSync(scratchDir, { recursive: true });
  const scratchPath = join(scratchDir, `pd-backup-${now}-${Math.random().toString(36).slice(2)}.db`);

  // Cross-runtime atomic snapshot:
  //   - Node (better-sqlite3): .backup(destPath) is the online Backup API.
  //   - Bun (bun:sqlite):      .serialize() returns the whole DB as bytes,
  //                            also taken under a read lock — atomic at the
  //                            page level. We just write those bytes to the
  //                            scratch path so the rest of the pipeline is
  //                            engine-agnostic.
  const src = new Database(dbPath, { readonly: false, fileMustExist: true });
  try {
    const dbAny = src as unknown as {
      backup?: (dest: string) => Promise<unknown>;
      serialize?: () => Uint8Array;
    };
    if (typeof dbAny.backup === 'function') {
      await dbAny.backup(scratchPath);
    } else if (typeof dbAny.serialize === 'function') {
      writeFileSync(scratchPath, Buffer.from(dbAny.serialize()));
    } else {
      throw new Error('SQLite runtime has neither backup() nor serialize() — cannot snapshot');
    }
  } finally {
    src.close();
  }

  const uncompressed = readFileSync(scratchPath);
  const sha256Uncompressed = sha256Hex(uncompressed);
  const compressed = gzipSync(uncompressed, { level: 6 });
  const sha256Compressed = sha256Hex(compressed);

  const snapshotId = generateSnapshotId(now, sha256Uncompressed);
  const manifest: Manifest = {
    snapshotId,
    createdAt: now,
    pdVersion: PD_VERSION,
    schemaVersion: detectSchemaVersion(uncompressed),
    dbBytesUncompressed: uncompressed.length,
    dbBytesCompressed: compressed.length,
    sha256Uncompressed,
    sha256Compressed,
    encryption: { scheme: 'none' },
    sourceHost: hostname(),
    sourcePath: dbPath,
    agentId: options.agentId ?? null,
    sessionId: options.sessionId ?? null,
  };

  await options.backend.put(snapshotId, manifest, compressed);

  // Best-effort scratch cleanup.
  try { rmSync(scratchPath, { force: true }); } catch { /* ignore */ }

  let pruned: string[] = [];
  if (options.retention !== null) {
    pruned = await pruneBackups({
      backend: options.backend,
      retention: options.retention ?? DEFAULT_RETENTION,
      now: () => now,
    });
  }

  return { snapshotId, manifest, pruned };
}

export interface RestoreBackupOptions {
  backend: BackupBackend;
  snapshotId: string;
  /** Destination path. Defaults to `resolveDbPath()`. */
  destPath?: string;
  /**
   * If true (default), the current DB is renamed to
   * `<destPath>.pre-restore-<timestamp>` so the restore is reversible.
   * Set to false in tests where there's no current DB to preserve.
   */
  preserveExisting?: boolean;
  now?: () => number;
}

export interface RestoreBackupResult {
  snapshotId: string;
  destPath: string;
  preRestorePath: string | null;
  integrityOk: boolean;
}

export async function restoreBackup(options: RestoreBackupOptions): Promise<RestoreBackupResult> {
  const now = (options.now ?? Date.now)();
  const destPath = options.destPath ?? resolveDbPath();
  const preserveExisting = options.preserveExisting ?? true;

  const { manifest, dbBytes: compressed } = await options.backend.get(options.snapshotId);

  // Verify compressed hash before doing anything destructive.
  if (sha256Hex(compressed) !== manifest.sha256Compressed) {
    throw new Error(`snapshot ${options.snapshotId}: sha256 mismatch on compressed bytes`);
  }
  const uncompressed = gunzipSync(compressed);
  if (sha256Hex(uncompressed) !== manifest.sha256Uncompressed) {
    throw new Error(`snapshot ${options.snapshotId}: sha256 mismatch on uncompressed bytes`);
  }
  if (uncompressed.length !== manifest.dbBytesUncompressed) {
    throw new Error(
      `snapshot ${options.snapshotId}: byte-length mismatch (manifest=${manifest.dbBytesUncompressed} actual=${uncompressed.length})`,
    );
  }

  let preRestorePath: string | null = null;
  if (preserveExisting && existsSync(destPath)) {
    preRestorePath = `${destPath}.pre-restore-${now}`;
    renameSync(destPath, preRestorePath);
  }

  // Ensure dest parent dir exists.
  if (!existsSync(dirname(destPath))) mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, uncompressed, { mode: 0o600 });

  // PRAGMA integrity_check on the restored DB. If it fails, roll back.
  let integrityOk = false;
  try {
    const db = new Database(destPath, { readonly: true, fileMustExist: true });
    try {
      const row = db.pragma('integrity_check', { simple: true });
      integrityOk = typeof row === 'string' && row === 'ok';
    } finally {
      db.close();
    }
  } catch {
    integrityOk = false;
  }

  if (!integrityOk && preRestorePath && existsSync(preRestorePath)) {
    rmSync(destPath, { force: true });
    renameSync(preRestorePath, destPath);
    throw new Error(
      `snapshot ${options.snapshotId}: restored DB failed integrity_check; rolled back to ${destPath}`,
    );
  }

  return { snapshotId: manifest.snapshotId, destPath, preRestorePath, integrityOk };
}

export async function listBackups(backend: BackupBackend): Promise<SnapshotSummary[]> {
  return backend.list();
}

export async function showBackup(backend: BackupBackend, snapshotId: string): Promise<Manifest> {
  const { manifest } = await backend.get(snapshotId);
  return manifest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide which snapshots to keep given a list of summaries and a retention
 * spec. Pure function: no I/O. Returns the *set of snapshotIds to keep* —
 * the caller deletes the complement.
 *
 * GFS semantics:
 *   - daily=N keeps the newest snapshot per day, for N distinct days
 *   - weekly=N keeps the newest snapshot per ISO week, for N distinct weeks
 *   - monthly=N keeps the newest snapshot per (year, month), for N distinct months
 *   - keep=N keeps the N most recent snapshots regardless of bucket
 * Union of all four sets is what survives.
 */
export function decideKeepSet(
  snapshots: SnapshotSummary[],
  spec: RetentionSpec = DEFAULT_RETENTION,
): Set<string> {
  const merged: Required<RetentionSpec> = {
    daily: spec.daily ?? DEFAULT_RETENTION.daily,
    weekly: spec.weekly ?? DEFAULT_RETENTION.weekly,
    monthly: spec.monthly ?? DEFAULT_RETENTION.monthly,
    keep: spec.keep ?? DEFAULT_RETENTION.keep,
  };
  const sorted = [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set<string>();

  // keep=N most recent
  for (let i = 0; i < Math.min(merged.keep, sorted.length); i++) keep.add(sorted[i].snapshotId);

  // daily: newest per UTC YYYY-MM-DD, take first N distinct days
  const seenDay = new Map<string, string>();
  for (const s of sorted) {
    const d = new Date(s.createdAt).toISOString().slice(0, 10);
    if (!seenDay.has(d)) seenDay.set(d, s.snapshotId);
  }
  let count = 0;
  for (const id of seenDay.values()) {
    if (count >= merged.daily) break;
    keep.add(id);
    count++;
  }

  // weekly: newest per ISO week (YYYY-Www), first N distinct weeks
  const seenWeek = new Map<string, string>();
  for (const s of sorted) {
    const wk = isoWeekKey(new Date(s.createdAt));
    if (!seenWeek.has(wk)) seenWeek.set(wk, s.snapshotId);
  }
  count = 0;
  for (const id of seenWeek.values()) {
    if (count >= merged.weekly) break;
    keep.add(id);
    count++;
  }

  // monthly: newest per YYYY-MM, first N distinct months
  const seenMonth = new Map<string, string>();
  for (const s of sorted) {
    const m = new Date(s.createdAt).toISOString().slice(0, 7);
    if (!seenMonth.has(m)) seenMonth.set(m, s.snapshotId);
  }
  count = 0;
  for (const id of seenMonth.values()) {
    if (count >= merged.monthly) break;
    keep.add(id);
    count++;
  }

  return keep;
}

function isoWeekKey(d: Date): string {
  // ISO-8601 week computation. Copy to avoid mutating caller's Date.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export interface PruneOptions {
  backend: BackupBackend;
  retention?: RetentionSpec;
  now?: () => number;
}

export async function pruneBackups(options: PruneOptions): Promise<string[]> {
  const snapshots = await options.backend.list();
  const keep = decideKeepSet(snapshots, options.retention ?? DEFAULT_RETENTION);
  const deleted: string[] = [];
  for (const s of snapshots) {
    if (!keep.has(s.snapshotId)) {
      await options.backend.delete(s.snapshotId);
      deleted.push(s.snapshotId);
    }
  }
  return deleted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retention spec parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a CLI retention spec like `"daily=14,weekly=8,monthly=6,keep=5"`.
 * Empty / undefined input returns the defaults. Unknown keys are rejected so
 * typos surface fast.
 */
export function parseRetentionSpec(spec: string | undefined | null): RetentionSpec {
  if (!spec || !spec.trim()) return { ...DEFAULT_RETENTION };
  const out: RetentionSpec = {};
  for (const part of spec.split(',')) {
    const [rawKey, rawVal] = part.split('=').map((s) => s?.trim());
    if (!rawKey) continue;
    const n = Number(rawVal);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`invalid retention value for ${rawKey}: ${rawVal}`);
    }
    if (rawKey === 'daily') out.daily = n;
    else if (rawKey === 'weekly') out.weekly = n;
    else if (rawKey === 'monthly') out.monthly = n;
    else if (rawKey === 'keep') out.keep = n;
    else throw new Error(`unknown retention key: ${rawKey} (allowed: daily, weekly, monthly, keep)`);
  }
  return out;
}
