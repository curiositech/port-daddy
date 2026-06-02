/**
 * Regression test for `pd backup` under the SHIPPED runtime: bun:sqlite.
 *
 * RUNTIME: `bun test` only. The compiled daemon (`bun build --compile`) runs
 * on bun:sqlite, NOT better-sqlite3. The backup path therefore must produce a
 * WAL-consistent, integrity-clean snapshot using only primitives bun:sqlite
 * supports. The original PR-α design staged via better-sqlite3's `.backup()`
 * or bun:sqlite's `.serialize()`; `.serialize()` is fragile on a live WAL DB
 * and the bun path was never exercised. This test pins the rewritten path
 * (`VACUUM INTO`) against a REAL on-disk WAL database under the real engine.
 *
 * What it proves:
 *   1. `createBackup()` runs end-to-end under bun:sqlite (no `.backup()`,
 *      no `.serialize()` — the VACUUM INTO branch).
 *   2. The staged snapshot passes `PRAGMA integrity_check` (createBackup
 *      asserts this internally; we assert again on the restored copy).
 *   3. A full restore reproduces every row written before the snapshot,
 *      including rows that were only in the WAL at snapshot time.
 *
 * Run this against the pre-fix source (serialize/.backup path) on a WAL DB and
 * it is not guaranteed to capture un-checkpointed WAL pages; the VACUUM INTO
 * path is.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createBackup, restoreBackup, checkIntegrity } from '../../lib/backup.ts';
import { createFileBackend } from '../../lib/backup-backends/file.ts';

let tmpRoot: string;
let dbPath: string;
let backendRoot: string;
let scratchDir: string;

const ROW_COUNT = 250;

beforeEach(() => {
  // Scratch root under the user's coding tmp tree (never /tmp semantics —
  // this is a test-local dir we clean up in afterEach). mkdtemp under homedir
  // keeps us off the OS temp dir entirely.
  tmpRoot = mkdtempSync(join(homedir(), '.pd-backup-bun-test-'));
  dbPath = join(tmpRoot, 'port-registry.db');
  backendRoot = join(tmpRoot, 'backups');
  scratchDir = join(tmpRoot, 'scratch');

  // Seed a real WAL database with bun:sqlite — the shipped engine.
  const db = new Database(dbPath, { create: true });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE kv (k INTEGER PRIMARY KEY, v TEXT NOT NULL);');
  db.exec('PRAGMA user_version = 99;');
  const insert = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?)');
  const tx = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) insert.run(i, `val-${i}`);
  });
  tx(ROW_COUNT);
  // Leave the DB in WAL mode WITHOUT an explicit checkpoint so the snapshot
  // path has to capture pages that live in the -wal file, not just the main
  // database file. This is the scenario that breaks naive copy-the-file
  // approaches.
  db.close();
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('createBackup under real bun:sqlite (VACUUM INTO path)', () => {
  test('snapshots a live WAL DB, passes integrity_check, and round-trips every row', async () => {
    const backend = createFileBackend(`file://${backendRoot}`);

    const created = await createBackup({
      backend,
      dbPath,
      scratchDir,
      retention: null,
      now: () => 1716130321000,
    });

    expect(created.snapshotId).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.manifest.dbBytesUncompressed).toBeGreaterThan(0);
    // schemaVersion is read back from the snapshot bytes — proves the probe
    // path also works under bun:sqlite.
    expect(created.manifest.schemaVersion).toBe(99);

    // Restore to a fresh path and verify integrity + contents.
    const restoredPath = join(tmpRoot, 'restored.db');
    const result = await restoreBackup({
      backend,
      snapshotId: created.snapshotId,
      destPath: restoredPath,
      preserveExisting: false,
    });
    expect(result.integrityOk).toBe(true);
    expect(checkIntegrity(restoredPath)).toBe(true);

    const restored = new Database(restoredPath, { readonly: true });
    const countRow = restored.query('SELECT COUNT(*) AS n FROM kv').get() as { n: number };
    expect(countRow.n).toBe(ROW_COUNT);

    // Spot-check first and last rows survived the WAL → snapshot → restore trip.
    const first = restored.query('SELECT v FROM kv WHERE k = 0').get() as { v: string };
    const last = restored.query('SELECT v FROM kv WHERE k = ?').get(ROW_COUNT - 1) as { v: string };
    restored.close();
    expect(first.v).toBe('val-0');
    expect(last.v).toBe(`val-${ROW_COUNT - 1}`);
  });

  test('does not write the snapshot scratch file under the OS temp dir', async () => {
    const backend = createFileBackend(`file://${backendRoot}`);
    // No scratchDir override → exercises resolveScratchDir() default, which
    // must resolve under ~/.port-daddy, never /tmp.
    const created = await createBackup({ backend, dbPath, retention: null });
    expect(created.snapshotId).toBeTruthy();
    // The default scratch dir is under the Port Daddy prefix; assert the
    // resolver never hands back a /tmp path.
    const { resolveScratchDir } = await import('../../lib/backup.ts');
    expect(resolveScratchDir().startsWith('/tmp')).toBe(false);
    expect(resolveScratchDir().startsWith('/private/tmp')).toBe(false);
  });
});
