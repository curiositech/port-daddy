import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockExecFileSync = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

const originalPlatform = process.platform;
Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });

const { keychain } = await import('../../lib/keychain.js');

describe('keychain.saveSecretIfAbsent', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
    delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
  });

  test('creates a base64-wrapped item without the destructive update flag', () => {
    mockExecFileSync.mockReturnValue(Buffer.alloc(0));

    expect(keychain.saveSecretIfAbsent('port-daddy', 'porthole-root', 'candidate-root')).toBe(true);

    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    const [command, args, options] = mockExecFileSync.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(command).toBe('/usr/bin/security');
    expect(args).toEqual([
      'add-generic-password',
      '-s', 'port-daddy',
      '-a', 'porthole-root',
      '-w', Buffer.from('candidate-root', 'utf8').toString('base64'),
    ]);
    expect(args).not.toContain('-U');
    expect(options).toEqual({ stdio: 'ignore', timeout: 5000 });
  });

  test.each([
    ['duplicate item', Object.assign(new Error('duplicate item'), { status: 45 })],
    ['locked keychain', Object.assign(new Error('interaction not allowed'), { status: 36 })],
    ['timeout', Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })],
  ])('returns false on %s so the caller must perform tri-state read-back', (_label, error) => {
    mockExecFileSync.mockImplementation(() => {
      throw error;
    });

    expect(keychain.saveSecretIfAbsent('port-daddy', 'porthole-root', 'candidate-root')).toBe(false);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  test('does not invoke the security CLI when keychain access is disabled', () => {
    process.env.PORT_DADDY_DISABLE_KEYCHAIN = '1';

    expect(keychain.saveSecretIfAbsent('port-daddy', 'porthole-root', 'candidate-root')).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
