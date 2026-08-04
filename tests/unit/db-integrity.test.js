import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  createAuthorizedDbIntegrityHelperProof,
  createDbIntegrityProof,
  createDbIntegrityProofOutOfProcess,
  DB_INTEGRITY_CHILD_ENV,
  DB_INTEGRITY_HELPER_ARG,
  dbFileFamilyStamp,
  isCurrentDbIntegrityProof,
} from '../../lib/db-integrity.js';

const roots = [];

function makeDb() {
  const root = mkdtempSync(join(homedir(), 'coding', 'tmp', 'pd-integrity-proof-'));
  roots.push(root);
  const path = join(root, 'registry.db');
  process.env.PORT_DADDY_TEST_DB = path;
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE proof_test (id INTEGER PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO proof_test (value) VALUES (?)').run('before');
  db.close();
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete process.env.PORT_DADDY_TEST_DB;
});

describe('database integrity proof', () => {
  test('binds a successful full integrity check to a closed WAL database', () => {
    const path = makeDb();
    const proof = createDbIntegrityProof(path);

    expect(proof).toEqual(expect.objectContaining({
      schema: 'port-daddy.db-integrity-proof.v1',
      dbPath: path,
      result: 'ok',
    }));
    expect(proof.files).toEqual(dbFileFamilyStamp(path));
    expect(isCurrentDbIntegrityProof(path, proof)).toBe(true);
  });

  test('rejects a proof after the database changes', () => {
    const path = makeDb();
    const proof = createDbIntegrityProof(path);
    const db = new Database(path);
    db.prepare('INSERT INTO proof_test (value) VALUES (?)').run('after');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();

    expect(isCurrentDbIntegrityProof(path, proof)).toBe(false);
  });

  test('source-mode runtimes leave the full check to initDatabase', async () => {
    const path = makeDb();
    await expect(createDbIntegrityProofOutOfProcess(path, {
      execPath: process.execPath,
      bunVersion: undefined,
    })).resolves.toBeNull();
  });

  test('authorizes exactly one helper invocation shape', () => {
    const path = makeDb();
    expect(createAuthorizedDbIntegrityHelperProof(
      ['port-daddy-daemon', 'server.ts', DB_INTEGRITY_HELPER_ARG, path],
      { [DB_INTEGRITY_CHILD_ENV]: '1' },
    )).toEqual(expect.objectContaining({ dbPath: path, result: 'ok' }));
    expect(createAuthorizedDbIntegrityHelperProof(
      ['port-daddy-daemon', 'server.ts'],
      {},
    )).toBeNull();
    expect(() => createAuthorizedDbIntegrityHelperProof(
      ['port-daddy-daemon', 'server.ts', DB_INTEGRITY_HELPER_ARG, path],
      {},
    )).toThrow('requires an authorized DB path');
  });

  test('refuses recursive compiled-helper reentry before spawning another process', async () => {
    const path = makeDb();
    await expect(createDbIntegrityProofOutOfProcess(path, {
      execPath: '/opt/port-daddy/port-daddy-daemon',
      bunVersion: '1.2.0',
      env: { [DB_INTEGRITY_CHILD_ENV]: '1' },
    })).rejects.toThrow('attempted recursive daemon boot');
  });

  test('refuses a non-scratch database before the read-only helper opens it in tests', () => {
    const productionLikePath = join(homedir(), '.port-daddy', 'must-not-open-from-jest.db');
    expect(() => createDbIntegrityProof(productionLikePath)).toThrow(
      'Refusing to open the production database from a test context',
    );
  });
});
