import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

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

describe('adversarial test cases for database integrity helper', () => {
  test('rejects command in position 3', () => {
    const result = resolveDbIntegrityHelperInvocation([
      'arg0', 'arg1', 'arg2', DB_INTEGRITY_HELPER_COMMAND, '/db/path'
    ]);
    expect(result).toBeNull();
  });

  test('rejects missing db path', () => {
    expect(() => resolveDbIntegrityHelperInvocation([
      'arg0', DB_INTEGRITY_HELPER_COMMAND
    ])).toThrow('database integrity helper requires a DB path');
  });

  test('rejects without environment variable', async () => {
    await expect(runDbIntegrityHelper({
      dbPath: '/db/path',
      commandArgIndex: 1
    }, {})).rejects.toThrow('requires PORT_DADDY_DB_INTEGRITY_CHILD=1');
  });

  test('allows valid compiled binary invocation', () => {
    const result = resolveDbIntegrityHelperInvocation([
      '/path/to/binary', DB_INTEGRITY_HELPER_COMMAND, '/db/path'
    ]);
    expect(result).toEqual({ dbPath: '/db/path', commandArgIndex: 1 });
  });

  test('allows valid source script invocation', () => {
    const result = resolveDbIntegrityHelperInvocation([
      '/path/to/bun', '/path/to/script.ts', DB_INTEGRITY_HELPER_COMMAND, '/db/path'
    ]);
    expect(result).toEqual({ dbPath: '/db/path', commandArgIndex: 2 });
  });

  test('rejects command in position 2 but no db path', () => {
    expect(() => resolveDbIntegrityHelperInvocation([
      'arg0', 'arg1', DB_INTEGRITY_HELPER_COMMAND
    ])).toThrow('database integrity helper requires a DB path');
  });

  test('rejects if command is not in first or second position', () => {
    const result = resolveDbIntegrityHelperInvocation([
      'arg0', 'arg1', DB_INTEGRITY_HELPER_COMMAND, '/db/path'
    ]);
    expect(result).toBeNull();
  });

  test('rejects if command appears in non-first position within arguments', () => {
    const result = resolveDbIntegrityHelperInvocation([
      'arg0', 'spawn', '--task', DB_INTEGRITY_HELPER_COMMAND, '/db/path'
    ]);
    expect(result).toBeNull();
  });

  test('rejects if command is part of a longer argument', () => {
    const result = resolveDbIntegrityHelperInvocation([
      'arg0', 'run --db-integrity-check', '/db/path'
    ]);
    expect(result).toBeNull();
  });

  test('rejects if command is in second position but no db path', () => {
    expect(() => resolveDbIntegrityHelperInvocation([
      'arg0', DB_INTEGRITY_HELPER_COMMAND
    ])).toThrow('database integrity helper requires a DB path');
  });
});