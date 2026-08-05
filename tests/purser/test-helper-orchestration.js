import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import {
  resolveDbIntegrityHelperInvocation,
  runDbIntegrityHelper,
} from '../../lib/db-integrity-entrypoint.js';

const originalFork = process.fork;
const originalExec = require('child_process').exec;

beforeEach(() => {
  process.fork = jest.fn(() => ({ on: jest.fn() }));
  require('child_process').exec = jest.fn();
});

afterEach(() => {
  process.fork = originalFork;
  require('child_process').exec = originalExec;
});

describe('process orchestration for integrity helper', () => {
  test('no orphaned child processes after helper execution', () => {
    process.env.PORT_DADDY_DB_INTEGRITY_CHILD = '1';
    const invocation = resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      '__db_integrity_check',
      '/state/port-daddy.db',
    ]);

    return runDbIntegrityHelper(invocation).then(() => {
      expect(process.fork).not.toHaveBeenCalled();
      expect(require('child_process').exec).not.toHaveBeenCalled();
    });
  });

  test('helper does not spawn new processes', () => {
    process.env.PORT_DADDY_DB_INTEGRITY_CHILD = '1';
    const invocation = resolveDbIntegrityHelperInvocation([
      '/opt/port-daddy-daemon',
      '__db_integrity_check',
      '/state/port-daddy.db',
    ]);

    return runDbIntegrityHelper(invocation).then(() => {
      expect(process.fork).not.toHaveBeenCalled();
      expect(require('child_process').exec).not.toHaveBeenCalled();
    });
  });
});