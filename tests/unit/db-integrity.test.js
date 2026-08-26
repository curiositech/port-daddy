import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  createDbIntegrityProof,
  createDbIntegrityProofOutOfProcess,
  dbFileFamilyStamp,
  isCurrentDbIntegrityProof,
} from '../../lib/db-integrity.js';
import { shouldRunInProcessIntegrityCheck } from '../../lib/db.js';

const roots = [];

function makeDb() {
  const root = mkdtempSync(join(tmpdir(), 'pd-integrity-proof-'));
  roots.push(root);
  const path = join(root, 'registry.db');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE proof_test (id INTEGER PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO proof_test (value) VALUES (?)').run('before');
  db.close();
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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

  test('skips the in-process scan only for a current out-of-process proof', () => {
    const path = makeDb();
    const proof = createDbIntegrityProof(path);

    expect(shouldRunInProcessIntegrityCheck(path, { integrityProof: proof })).toBe(false);
    expect(shouldRunInProcessIntegrityCheck(path, {})).toBe(true);

    const db = new Database(path);
    db.prepare('INSERT INTO proof_test (value) VALUES (?)').run('proof-is-now-stale');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();

    expect(shouldRunInProcessIntegrityCheck(path, { integrityProof: proof })).toBe(true);
    expect(shouldRunInProcessIntegrityCheck(':memory:', { inMemory: true })).toBe(false);
  });

  test('source-mode runtimes leave the full check to initDatabase', async () => {
    const path = makeDb();
    await expect(createDbIntegrityProofOutOfProcess(path, {
      execPath: process.execPath,
      bunVersion: undefined,
    })).resolves.toBeNull();
  });

  test('refuses a non-scratch database before the read-only helper opens it in tests', () => {
    const productionLikePath = join(homedir(), '.port-daddy', 'must-not-open-from-jest.db');
    expect(() => createDbIntegrityProof(productionLikePath)).toThrow(
      'Refusing to open the production database from a test context',
    );
  });
});
