import { describe, expect, test, beforeEach } from '@jest/globals';
import {
  resolveDbIntegrityHelperInvocation,
  runDbIntegrityHelper,
} from '../../lib/db-integrity-entrypoint.js';

const mockCreateDbIntegrityProof = jest.fn();

jest.mock('./db-integrity.js', () => ({
  createDbIntegrityProof: mockCreateDbIntegrityProof,
}));

describe('error handling in integrity helper', () => {
  beforeEach(() => {
    mockCreateDbIntegrityProof.mockReset();
  });

  test('handles missing db path', () => {
    expect(() => resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
    ])).toThrow('database integrity helper requires a DB path');
  });

  test('handles invalid db path', async () => {
    mockCreateDbIntegrityProof.mockImplementation(() => {
      throw new Error('DB open failed');
    });

    const invocation = resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
      '/invalid/db.path',
    ]);

    await expect(runDbIntegrityHelper(invocation)).rejects.toThrow('DB open failed');
  });

  test('handles unexpected errors during proof generation', async () => {
    mockCreateDbIntegrityProof.mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    const invocation = resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      DB_INTEGRITY_HELPER_COMMAND,
      '/state/port-daddy.db',
    ]);

    await expect(runDbIntegrityHelper(invocation)).rejects.toThrow('Unexpected error');
  });
});