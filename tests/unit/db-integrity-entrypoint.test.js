import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { isCurrentDbIntegrityProof } from '../../lib/db-integrity.js';

const {
  DB_INTEGRITY_HELPER_COMMAND,
  resolveDbIntegrityHelperInvocation,
  runDbIntegrityHelper,
} = await import('../../lib/db-integrity-entrypoint.js');

const roots = [];

function makeDb() {
  const root = mkdtempSync(join(tmpdir(), 'pd-integrity-entrypoint-'));
  roots.push(root);
  const dbPath = join(root, 'registry.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE proof_test (id INTEGER PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO proof_test (value) VALUES (?)').run('real fixture');
  db.close();
  return dbPath;
}

afterEach(() => {
  jest.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('database integrity helper entrypoint', () => {
  test('recognizes the compiled Bun argv shape', () => {
    expect(resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ])).toEqual({
      dbPath: '/state/port-daddy.db',
      commandArgIndex: 1,
    });
  });

  test('recognizes the source-script argv shape', () => {
    expect(resolveDbIntegrityHelperInvocation([
      '/opt/bun',
      '/repo/bin/port-daddy-daemon.ts',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ])).toEqual({
      dbPath: '/state/port-daddy.db',
      commandArgIndex: 2,
    });
  });

  test('does not treat a later task argument as a hidden command', () => {
    expect(resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy',
      'spawn',
      '--task',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ])).toBeNull();
  });

  test('does not treat the second compiled-binary argument as a source helper command', () => {
    expect(resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      'spawn',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ])).toBeNull();
  });

  test('rejects a recognized helper command without a database path', () => {
    expect(() => resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
    ])).toThrow('database integrity helper requires a DB path');
  });

  test('rejects the source-script helper shape without a database path', () => {
    expect(() => resolveDbIntegrityHelperInvocation([
      '/opt/bun',
      '/repo/bin/port-daddy-daemon.ts',
      DB_INTEGRITY_HELPER_COMMAND,
    ])).toThrow('database integrity helper requires a DB path');
  });

  test('rejects execution without the explicit child authorization marker', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(runDbIntegrityHelper({
      dbPath: '/state/port-daddy.db',
      commandArgIndex: 1,
    }, {})).rejects.toThrow(
      'database integrity helper requires PORT_DADDY_DB_INTEGRITY_CHILD=1',
    );
    expect(log).not.toHaveBeenCalled();
  });

  test('authorized execution rejects a nonexistent database path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-integrity-entrypoint-missing-'));
    roots.push(root);
    const dbPath = join(root, 'missing.db');

    await expect(runDbIntegrityHelper({ dbPath, commandArgIndex: 1 }, {
      PORT_DADDY_DB_INTEGRITY_CHILD: '1',
    })).rejects.toThrow(`database does not exist: ${dbPath}`);
  });

  test('authorized execution emits exactly one current proof from a real database', async () => {
    const dbPath = makeDb();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runDbIntegrityHelper({ dbPath, commandArgIndex: 1 }, {
      PORT_DADDY_DB_INTEGRITY_CHILD: '1',
    });

    expect(log).toHaveBeenCalledTimes(1);
    const proof = JSON.parse(log.mock.calls[0][0]);
    expect(proof).toEqual(expect.objectContaining({
      schema: 'port-daddy.db-integrity-proof.v1',
      dbPath,
      result: 'ok',
      checkedAt: expect.any(Number),
      files: expect.arrayContaining([
        expect.objectContaining({ path: dbPath, exists: true, size: expect.any(Number) }),
      ]),
    }));
    expect(isCurrentDbIntegrityProof(dbPath, proof)).toBe(true);
  });
});
