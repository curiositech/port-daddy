import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
  runDbIntegrityHelper,
  DB_INTEGRITY_HELPER_COMMAND,
  resolveDbIntegrityHelperInvocation,
} from '../../lib/db-integrity-entrypoint.js';

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('environment validation for integrity helper', () => {
  test('allows authorized invocation', async () => {
    process.env.PORT_DADDY_DB_INTEGRITY_CHILD = '1';
    const invocation = resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ]);
    await expect(runDbIntegrityHelper(invocation)).resolves.not.toThrow();
  });

  test('rejects unauthorized invocation', async () => {
    process.env.PORT_DADDY_DB_INTEGRITY_CHILD = '0';
    const invocation = resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ]);
    await expect(runDbIntegrityHelper(invocation)).rejects.toThrow('database integrity helper requires an authorized DB path');
  });

  test('rejects missing environment variable', async () => {
    delete process.env.PORT_DADDY_DB_INTEGRITY_CHILD;
    const invocation = resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ]);
    await expect(runDbIntegrityHelper(invocation)).rejects.toThrow('database integrity helper requires an authorized DB path');
  });
});