import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import Database from './sqlite-runtime.js';
import { assertNotProdInTest, isTestContext } from './db-open-guard.js';

export interface DbFileStamp {
  path: string;
  exists: boolean;
  size: number | null;
  mtimeMs: number | null;
}

export interface DbIntegrityProof {
  schema: 'port-daddy.db-integrity-proof.v1';
  dbPath: string;
  checkedAt: number;
  result: 'ok';
  files: DbFileStamp[];
}

function stamp(path: string): DbFileStamp {
  try {
    const info = statSync(path);
    return { path, exists: true, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return { path, exists: false, size: null, mtimeMs: null };
  }
}

/** Fingerprint the SQLite main file and its WAL/SHM sidecars as one unit. */
export function dbFileFamilyStamp(dbPath: string): DbFileStamp[] {
  const canonical = resolve(dbPath);
  return [canonical, `${canonical}-wal`, `${canonical}-shm`].map(stamp);
}

function sameStamp(entry: DbFileStamp | undefined, candidate: DbFileStamp | undefined): boolean {
  return entry != null
    && candidate != null
    && entry.path === candidate.path
    && entry.exists === candidate.exists
    && entry.size === candidate.size
    && entry.mtimeMs === candidate.mtimeMs;
}

// The main database and WAL contain durable database state. The SHM sidecar is
// SQLite's mutable coordination area: a read-only connection updates reader
// marks and lock bookkeeping there, so requiring its mtime to remain stable
// makes every real WAL-mode integrity scan reject its own proof.
function sameDurableFamily(left: DbFileStamp[], right: DbFileStamp[]): boolean {
  if (!sameStamp(left[0], right[0])) return false;
  if (sameStamp(left[1], right[1])) return true;

  // SQLite can create a zero-byte WAL when a read-only connection first
  // inspects a closed WAL database. Missing and zero-byte WALs both contain no
  // durable frames, so this housekeeping transition does not invalidate the
  // full scan. Any non-empty WAL change still fails closed.
  const logicallyEmptyWal = (stamp: DbFileStamp | undefined) =>
    stamp != null && (!stamp.exists || stamp.size === 0);
  return logicallyEmptyWal(left[1]) && logicallyEmptyWal(right[1]);
}

/**
 * Run SQLite's FULL integrity check and prove the durable DB/WAL pair did not
 * change underneath the read-only scan. The SHM stamp is retained as
 * diagnostic evidence, but is not a content-freshness condition because
 * SQLite readers legitimately mutate its lock bookkeeping.
 */
export function createDbIntegrityProof(dbPath: string): DbIntegrityProof {
  const canonical = resolve(dbPath);
  assertNotProdInTest(canonical, { isTest: isTestContext() });
  const before = dbFileFamilyStamp(canonical);
  if (!before[0]?.exists) {
    throw new Error(`database does not exist: ${canonical}`);
  }

  const db = new Database(canonical, { readonly: true, fileMustExist: true });
  let result: unknown;
  try {
    result = db.pragma('integrity_check', { simple: true });
  } finally {
    db.close();
  }
  if (result !== 'ok') {
    throw new Error(`PRAGMA integrity_check returned ${String(result)}`);
  }

  const after = dbFileFamilyStamp(canonical);
  if (!sameDurableFamily(before, after)) {
    throw new Error('durable database files changed during PRAGMA integrity_check');
  }

  return {
    schema: 'port-daddy.db-integrity-proof.v1',
    dbPath: canonical,
    checkedAt: Date.now(),
    result: 'ok',
    files: after,
  };
}

/** Accept a proof only while the durable DB/WAL artifacts it covered remain. */
export function isCurrentDbIntegrityProof(dbPath: string, proof: DbIntegrityProof | null | undefined): boolean {
  if (!proof || proof.schema !== 'port-daddy.db-integrity-proof.v1' || proof.result !== 'ok') return false;
  const canonical = resolve(dbPath);
  return proof.dbPath === canonical && sameDurableFamily(proof.files, dbFileFamilyStamp(canonical));
}

function isCompiledBun(execPath: string, bunVersion: string | undefined): boolean {
  if (!bunVersion) return false;
  return !/^bun(?:-[\w.+-]+)?$/i.test(basename(execPath).replace(/\.exe$/i, ''));
}

/**
 * Keep the daemon event loop responsive while a production-sized registry is
 * scanned. Source-mode Node falls back to initDatabase's in-process check;
 * packaged Bun re-execs the same signed binary through a hidden, read-only
 * integrity entrypoint and returns a content-bound proof.
 */
export async function createDbIntegrityProofOutOfProcess(
  dbPath: string,
  options: { execPath?: string; bunVersion?: string } = {},
): Promise<DbIntegrityProof | null> {
  const canonical = resolve(dbPath);
  if (!existsSync(canonical)) return null;
  const execPath = options.execPath ?? process.execPath;
  const bunVersion = options.bunVersion ?? process.versions.bun;
  if (!isCompiledBun(execPath, bunVersion)) return null;

  return await new Promise<DbIntegrityProof>((resolveProof, reject) => {
    const child = spawn(execPath, ['__db_integrity_check', canonical], {
      env: { ...process.env, PORT_DADDY_DB_INTEGRITY_CHILD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('exit', code => {
      const errorText = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(`database integrity helper exited ${code ?? 'unknown'}${errorText ? `: ${errorText}` : ''}`));
        return;
      }
      try {
        const raw = Buffer.concat(stdout).toString('utf8').trim();
        const proof = JSON.parse(raw) as DbIntegrityProof;
        if (!isCurrentDbIntegrityProof(canonical, proof)) {
          reject(new Error('database integrity helper returned a stale or invalid proof'));
          return;
        }
        resolveProof(proof);
      } catch (error) {
        reject(new Error(`database integrity helper returned invalid JSON: ${(error as Error).message}`));
      }
    });
  });
}
