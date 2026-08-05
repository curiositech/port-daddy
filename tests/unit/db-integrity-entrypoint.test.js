import { describe, expect, test } from '@jest/globals';
import {
  DB_INTEGRITY_HELPER_COMMAND,
  resolveDbIntegrityHelperInvocation,
} from '../../lib/db-integrity-entrypoint.js';

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
});
