import { describe, expect, test } from '@jest/globals';
import {
  DB_INTEGRITY_HELPER_COMMAND,
  resolveDbIntegrityHelperInvocation,
} from '../../lib/db-integrity-entrypoint.js';

describe('argv boundary validation for integrity helper', () => {
  test('accepts helper in first position (compiled binary)', () => {
    expect(resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ])).toEqual({
      dbPath: '/state/port-daddy.db',
      commandArgIndex: 1,
    });
  });

  test('accepts helper in second position (source script)', () => {
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

  test('rejects helper in third position (non-recognized)', () => {
    expect(resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy',
      'spawn',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ])).toBeNull();
  });

  test('rejects helper with no db path', () => {
    expect(() => resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
    ])).toThrow('database integrity helper requires a DB path');
  });
});