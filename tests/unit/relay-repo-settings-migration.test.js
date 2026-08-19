/**
 * The relay's repo_settings D1 migration, applied for real.
 *
 * Why this lives in the root jest suite: the relay's vitest environment is
 * pure-node with no SQLite engine, while the root suite ships better-sqlite3 —
 * so this is the one place the migration SQL can be EXECUTED rather than
 * merely parsed. D1 is SQLite-dialect, so applying the file here proves the
 * DDL is valid SQLite, that the table shape matches what
 * apps/relay/src/repo-settings-page.ts reads and writes, that the CHECK
 * constraint enforces the closed sitrep enum, and that re-applying is
 * idempotent (CREATE TABLE IF NOT EXISTS — rollback-compatible per the
 * migrations README rule 3).
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const MIGRATION = join(
  process.cwd(),
  'apps',
  'relay',
  'migrations',
  '2026-08-19-repo-settings.sql',
);

let db;

beforeEach(() => {
  db = new Database(':memory:');
  // The migration references users(id); give it the minimal parent table.
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  db.exec(readFileSync(MIGRATION, 'utf8'));
});

afterEach(() => {
  db.close();
});

describe('repo_settings migration', () => {
  test('creates the exact column set the Worker reads and writes', () => {
    const cols = db.prepare('PRAGMA table_info(repo_settings)').all();
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      'user_id',
      'repo_full_name',
      'sitrep_end_of_turn',
      'settings_json',
      'created_at',
      'updated_at',
    ]);
    const sitrep = cols.find((c) => c.name === 'sitrep_end_of_turn');
    expect(sitrep.notnull).toBe(1);
    expect(sitrep.dflt_value).toBe("'off'");
  });

  test('the upsert the Worker issues round-trips, and the PK dedupes per (user, repo)', () => {
    db.prepare('INSERT INTO users (id) VALUES (?)').run('u_1');
    const upsert = db.prepare(
      `INSERT INTO repo_settings (user_id, repo_full_name, sitrep_end_of_turn, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, '{}', ?, ?)
       ON CONFLICT(user_id, repo_full_name)
       DO UPDATE SET sitrep_end_of_turn = excluded.sitrep_end_of_turn, updated_at = excluded.updated_at`,
    );
    upsert.run('u_1', 'curiositech/port-daddy', 'enforce', 100, 100);
    upsert.run('u_1', 'curiositech/port-daddy', 'suggest', 100, 200);
    const rows = db.prepare('SELECT * FROM repo_settings').all();
    expect(rows).toHaveLength(1);
    expect(rows[0].sitrep_end_of_turn).toBe('suggest');
    expect(rows[0].updated_at).toBe(200);
  });

  test('the CHECK constraint rejects a level outside the closed enum', () => {
    db.prepare('INSERT INTO users (id) VALUES (?)').run('u_1');
    expect(() =>
      db
        .prepare(
          `INSERT INTO repo_settings (user_id, repo_full_name, sitrep_end_of_turn, settings_json, created_at, updated_at)
           VALUES ('u_1', 'a/b', 'loudly', '{}', 1, 1)`,
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  test('re-applying the migration is idempotent (rollback-compatible)', () => {
    expect(() => db.exec(readFileSync(MIGRATION, 'utf8'))).not.toThrow();
  });
});
