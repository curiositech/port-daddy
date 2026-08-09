/**
 * The Door — one enforced write-boundary (architecture-of-record seam 3).
 *
 * Proves that a killed daemon HALTS a write loudly instead of silently editing
 * shared coordination truth via the CLI's direct-DB path:
 *
 *   (b) a `role:'client'` handle (the "daemon is dead, opened SQLite directly"
 *       shape) refuses EVERY mutation path — .run, .get/.all on a `… RETURNING …`
 *       write (the bypass that guarding only .run would miss), .exec
 *       multi-statement, and CTE writes — while still serving reads, so
 *       projections keep working during an outage. The PD_DIRECT_DB_OK=1 hatch
 *       restores owner semantics for maintenance.
 *
 *   (a) the coordination guard's commit-time rent check fails CLOSED with a
 *       critical `rent-unverifiable` violation when the daemon's coordination
 *       truth could not be read — instead of the old silent "0 rent owed".
 *
 * Hermetic: tmp DBs, no live daemon. tmpdir() is the repo's allowed test-DB
 * root (isAllowedTestDbPath) and is /var/folders on macOS, not /tmp.
 */
import { describe, test, expect, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDatabase, DaemonDoorError, isMutatingSql } from '../../lib/db.js';
import { evaluateGuardFacts } from '../../cli/commands/guard.js';

const scratchDirs = [];
function freshDbPath(name) {
  const dir = mkdtempSync(join(tmpdir(), 'pd-door-'));
  scratchDirs.push(dir);
  return join(dir, `${name}.db`);
}
afterEach(() => {
  while (scratchDirs.length) {
    try { rmSync(scratchDirs.pop(), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('The Door — write-boundary interception', () => {
  test('isMutatingSql classifies verbs incl. RETURNING, CTE writes, multi-statement (structured, not NLP)', () => {
    for (const s of [
      'INSERT INTO x VALUES(1)',
      '  update x set a=1',
      '/* c */ DELETE FROM x',
      'CREATE TABLE t(a)',
      'UPDATE x SET a=1 WHERE id=? RETURNING *',
      'WITH d AS (SELECT id FROM x) DELETE FROM x WHERE id IN (SELECT id FROM d)',
      'SELECT 1; DELETE FROM x',
    ]) expect(isMutatingSql(s)).toBe(true);

    for (const s of [
      'SELECT * FROM x',
      '  select 1',
      'PRAGMA journal_mode',
      'EXPLAIN QUERY PLAN SELECT 1',
      "SELECT * FROM x WHERE note = 'please DELETE this later'", // keyword only inside a literal
      'SELECT updated_at, created_at FROM x',                    // reserved words as substrings
      "SELECT * FROM x WHERE note = 'a -- DELETE this too'",     // a literal containing '--' is still just a literal
      '-- DELETE FROM x\nSELECT 1',                              // a REAL leading comment, not a mutation
    ]) expect(isMutatingSql(s)).toBe(false);
  });

  test('a string literal containing "--" cannot smuggle a real mutation past the scanner (order-of-strip regression)', () => {
    // Strip order matters: if comments strip BEFORE string literals, the '--'
    // inside this literal is misread as starting a line comment, and the
    // regex eats everything after it on the line -- including the real
    // `DELETE FROM foo;` that db.exec() would still actually execute. This
    // must be classified as mutating (it is exec()'d as two real statements).
    expect(isMutatingSql("SELECT '--'; DELETE FROM foo;")).toBe(true);
    // Same trick via a block-comment-shaped literal.
    expect(isMutatingSql("SELECT '/*'; DELETE FROM foo; /*' */")).toBe(true);
    // And the guarded handle actually refuses to exec() it, not just isMutatingSql in isolation:
    const dbPath = freshDbPath('reg');
    const owner = initDatabase({ dbPath, role: 'daemon' });
    owner.exec('CREATE TABLE IF NOT EXISTS t(a INTEGER)');
    owner.prepare('INSERT INTO t(a) VALUES (1)').run();
    owner.close();
    const client = initDatabase({ dbPath, role: 'client' });
    expect(() => client.exec("SELECT '--'; DELETE FROM t;")).toThrow(DaemonDoorError);
    expect(client.prepare('SELECT count(*) c FROM t').get().c).toBe(1); // nothing actually deleted
    client.close();
  });

  test('a client open (daemon down) refuses WRITES via run/get/all/exec but allows READS', () => {
    const dbPath = freshDbPath('reg');
    // Seed as the owner (daemon role), then close — the registry now exists.
    const owner = initDatabase({ dbPath, role: 'daemon' });
    owner.exec('CREATE TABLE IF NOT EXISTS t(a INTEGER)');
    owner.prepare('INSERT INTO t(a) VALUES (1)').run();
    owner.close();

    // Open as a CLIENT — the "daemon is dead, CLI reached direct-DB" path.
    const client = initDatabase({ dbPath, role: 'client' });

    // READS still work (projections keep functioning during an outage).
    expect(client.prepare('SELECT count(*) c FROM t').get().c).toBe(1);

    // WRITES halt loudly at the door, no matter which method executes them:
    expect(() => client.prepare('INSERT INTO t(a) VALUES (2)').run()).toThrow(DaemonDoorError);
    expect(() => client.exec('DELETE FROM t')).toThrow(DaemonDoorError);
    // the bypass this lane exists to close — a RETURNING mutation via .get()/.all():
    expect(() => client.prepare('UPDATE t SET a=99 WHERE a=1 RETURNING *').get()).toThrow(DaemonDoorError);
    expect(() => client.prepare('DELETE FROM t WHERE a=1 RETURNING *').all()).toThrow(DaemonDoorError);
    // multi-statement smuggle and CTE write also refused:
    expect(() => client.exec('SELECT 1; DELETE FROM t')).toThrow(DaemonDoorError);
    expect(() => client.prepare('WITH d AS (SELECT a FROM t) DELETE FROM t RETURNING *').get()).toThrow(DaemonDoorError);

    // and nothing actually changed — no write reached SQLite:
    expect(client.prepare('SELECT count(*) c FROM t').get().c).toBe(1);
    expect(client.prepare('SELECT a FROM t').get().a).toBe(1);
    client.close();
  });

  test('a mutating statement inside db.transaction(fn) is refused too — the wrapping targets prepare/exec, not the transaction call site', () => {
    const dbPath = freshDbPath('reg');
    const owner = initDatabase({ dbPath, role: 'daemon' });
    owner.exec('CREATE TABLE IF NOT EXISTS t(a INTEGER)');
    owner.prepare('INSERT INTO t(a) VALUES (1)').run();
    owner.close();

    const client = initDatabase({ dbPath, role: 'client' });
    const insert = client.prepare('INSERT INTO t(a) VALUES (?)'); // prepared on the guarded handle
    const insertMany = client.transaction((rows) => {
      for (const r of rows) insert.run(r);
    });
    // better-sqlite3's transaction() drives BEGIN/COMMIT via this.prepare/this.exec
    // on the SAME instance, so it resolves to our overridden methods too — the
    // statement inside the closure throws before any row is written.
    expect(() => insertMany([1, 2, 3])).toThrow(DaemonDoorError);
    expect(client.prepare('SELECT count(*) c FROM t').get().c).toBe(1); // unchanged
    client.close();
  });

  test('PD_DIRECT_DB_OK=1 escape hatch restores owner (maintenance) write semantics', () => {
    const dbPath = freshDbPath('reg');
    const owner = initDatabase({ dbPath, role: 'daemon' });
    owner.exec('CREATE TABLE IF NOT EXISTS t(a INTEGER)');
    owner.close();

    process.env.PD_DIRECT_DB_OK = '1';
    try {
      const m = initDatabase({ dbPath, role: 'client' });
      m.prepare('INSERT INTO t(a) VALUES (9)').run(); // no throw — owner semantics
      expect(m.prepare('UPDATE t SET a=10 WHERE a=9 RETURNING *').get().a).toBe(10); // RETURNING ok
      m.close();
    } finally {
      delete process.env.PD_DIRECT_DB_OK;
    }
  });

  test('the daemon (default role) keeps raw write access — zero regression', () => {
    const dbPath = freshDbPath('reg');
    const daemon = initDatabase({ dbPath }); // default role === 'daemon'
    daemon.exec('CREATE TABLE IF NOT EXISTS t(a INTEGER)');
    expect(() => daemon.prepare('INSERT INTO t(a) VALUES (7)').run()).not.toThrow();
    expect(daemon.prepare('SELECT a FROM t').get().a).toBe(7);
    daemon.close();
  });
});

describe('The Door — guard rent fails CLOSED on unreadable daemon truth', () => {
  const baseConfig = {
    name: 'Coordination Guard',
    enabled: true,
    mode: 'enforce',
    requireSession: true,
    requireClaims: false,
    requireNotePerCommit: true,
    requireRoadmapForCoordinationChanges: false,
  };

  test('rent-unverifiable blocks the commit as a critical violation', () => {
    const r = evaluateGuardFacts({
      config: baseConfig,
      mode: 'enforce',
      files: ['lib/x.ts'],
      active: true,
      sessionId: 's1',
      atCommitTime: true,
      rentUnverifiable: true, // daemon coordination read failed at commit time
    });
    expect(r.shouldBlock).toBe(true);
    expect(r.violations.some((v) => v.code === 'rent-unverifiable' && v.severity === 'critical')).toBe(true);
  });

  test('a verifiable read (rentUnverifiable=false) does NOT add the violation', () => {
    const r = evaluateGuardFacts({
      config: baseConfig,
      mode: 'enforce',
      files: ['lib/x.ts'],
      active: true,
      sessionId: 's1',
      atCommitTime: true,
      rentUnverifiable: false,
      commitsSinceLastNote: 0,
    });
    expect(r.violations.some((v) => v.code === 'rent-unverifiable')).toBe(false);
  });
});
