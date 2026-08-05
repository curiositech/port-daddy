import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const createDbIntegrityProof = jest.fn();

await jest.unstable_mockModule('../../lib/db-integrity.js', () => ({
  createDbIntegrityProof,
}));

const {
  DB_INTEGRITY_HELPER_COMMAND,
  resolveDbIntegrityHelperInvocation,
  runDbIntegrityHelper,
} = await import('../../lib/db-integrity-entrypoint.js');

beforeEach(() => {
  createDbIntegrityProof.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
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

  test('rejects a recognized helper command without a database path', () => {
    expect(() => resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
    ])).toThrow('database integrity helper requires a DB path');
  });

  test('rejects execution without the explicit child authorization marker', async () => {
    await expect(runDbIntegrityHelper({
      dbPath: '/state/port-daddy.db',
      commandArgIndex: 1,
    }, {})).rejects.toThrow('requires PORT_DADDY_DB_INTEGRITY_CHILD=1');
  });

  test('authorized execution emits exactly one current JSON integrity proof', async () => {
    const dbPath = '/state/port-daddy.db';
    createDbIntegrityProof.mockReturnValue({
      schema: 'port-daddy.db-integrity-proof.v1',
      dbPath,
      checkedAt: 123,
      result: 'ok',
      files: [],
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runDbIntegrityHelper({ dbPath, commandArgIndex: 1 }, {
      PORT_DADDY_DB_INTEGRITY_CHILD: '1',
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(createDbIntegrityProof).toHaveBeenCalledTimes(1);
    expect(createDbIntegrityProof).toHaveBeenCalledWith(dbPath);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual(expect.objectContaining({
      schema: 'port-daddy.db-integrity-proof.v1',
      dbPath,
      result: 'ok',
    }));
  });
});
