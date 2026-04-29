import { afterEach, beforeEach, describe, expect, test, jest } from '@jest/globals';

const mockExecFileSync = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

const { keychain, KEYCHAIN_SERVICE } = await import('../../lib/keychain.js');

function restoreDisableFlag(originalValue) {
  if (originalValue === undefined) delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
  else process.env.PORT_DADDY_DISABLE_KEYCHAIN = originalValue;
}

describe('keychain', () => {
  const originalDisableFlag = process.env.PORT_DADDY_DISABLE_KEYCHAIN;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
  });

  afterEach(() => {
    restoreDisableFlag(originalDisableFlag);
  });

  test('short-circuits when the opt-out env flag is set', () => {
    process.env.PORT_DADDY_DISABLE_KEYCHAIN = '1';

    expect(keychain.available()).toBe(false);
    expect(keychain.loadSecret(KEYCHAIN_SERVICE, 'master-key')).toBeNull();
    expect(keychain.saveSecret(KEYCHAIN_SERVICE, 'master-key', 'value')).toBe(false);
    expect(keychain.deleteSecret(KEYCHAIN_SERVICE, 'master-key')).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  test('loads, stores, and deletes secrets through the security CLI on macOS', () => {
    expect(process.platform).toBe('darwin');
    expect(keychain.available()).toBe(true);

    mockExecFileSync.mockImplementation((command, args) => {
      if (args[0] === 'find-generic-password') return 'c2VjcmV0'; // base64("secret")
      return '';
    });

    expect(keychain.loadSecret('port-daddy', 'master-key')).toBe('secret');
    expect(mockExecFileSync).toHaveBeenCalledWith('/usr/bin/security', [
      'find-generic-password',
      '-s',
      'port-daddy',
      '-a',
      'master-key',
      '-w',
    ], expect.objectContaining({
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }));

    mockExecFileSync.mockClear();
    expect(keychain.saveSecret('port-daddy', 'master-key', 'line 1\nline 2')).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith('/usr/bin/security', [
      'add-generic-password',
      '-s',
      'port-daddy',
      '-a',
      'master-key',
      '-w',
      Buffer.from('line 1\nline 2', 'utf8').toString('base64'),
      '-U',
    ], expect.objectContaining({
      stdio: 'ignore',
      timeout: 5000,
    }));

    mockExecFileSync.mockClear();
    expect(keychain.deleteSecret('port-daddy', 'master-key')).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith('/usr/bin/security', [
      'delete-generic-password',
      '-s',
      'port-daddy',
      '-a',
      'master-key',
    ], expect.objectContaining({
      stdio: 'ignore',
      timeout: 5000,
    }));
  });

  test('normalizes hex-dumped values and returns null on CLI failure', () => {
    mockExecFileSync.mockImplementation((command, args) => {
      if (args[0] === 'find-generic-password') return Buffer.from('c2VjcmV0', 'utf8').toString('hex');
      throw new Error('security failed');
    });

    expect(keychain.loadSecret('port-daddy', 'hex-account')).toBe('secret');
    expect(keychain.saveSecret('port-daddy', 'hex-account', 'value')).toBe(false);
    expect(keychain.deleteSecret('port-daddy', 'hex-account')).toBe(false);
  });
});
