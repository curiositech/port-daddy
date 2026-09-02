import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockExecFileSync = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

const originalPlatform = process.platform;
const originalDisabled = process.env.PORT_DADDY_DISABLE_KEYCHAIN;
Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });

const { keychain } = await import('../../lib/keychain.js');

describe('keychain.saveSecretIfAbsent', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
    if (originalDisabled === undefined) delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
    else process.env.PORT_DADDY_DISABLE_KEYCHAIN = originalDisabled;
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

  test.each([
    ['item not found', { status: 44 }, 'missing'],
    ['locked', { status: 36 }, 'error'],
    ['timeout', { code: 'ETIMEDOUT' }, 'error'],
    ['string status is not authority', { status: '44' }, 'error'],
    ['absent exception shape', null, 'error'],
    ['undefined exception shape', undefined, 'error'],
  ])('distinguishes %s from proven key absence', (_label, error, status) => {
    mockExecFileSync.mockImplementation(() => { throw error; });
    expect(keychain.loadSecretResult('port-daddy', 'synthetic-root')).toEqual({ status });
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    expect(mockExecFileSync.mock.calls[0]).toEqual(['/usr/bin/security',
      ['find-generic-password', '-s', 'port-daddy', '-a', 'synthetic-root', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }]);
  });

  test.each(['', '  \n'])('fails closed for empty successful Keychain output %j', (output) => {
    mockExecFileSync.mockReturnValue(output);
    expect(keychain.loadSecretResult('port-daddy', 'synthetic-root')).toEqual({ status: 'error' });
  });

  test('decodes only synthetic Keychain outputs and preserves multiline values', () => {
    const value = 'synthetic-key\nsecond-line';
    const encoded = Buffer.from(value).toString('base64');
    for (const output of [encoded, `${encoded}\n`, Buffer.from(encoded).toString('hex')]) {
      mockExecFileSync.mockReturnValue(output);
      expect(keychain.loadSecretResult('port-daddy', 'synthetic-root')).toEqual({ status: 'found', value });
      expect(keychain.loadSecret('port-daddy', 'synthetic-root')).toBe(value);
    }
  });

  test.each(['linux', 'win32'])('never touches the OS keystore on %s', (platform) => {
    Object.defineProperty(process, 'platform', { configurable: true, value: platform });
    expect(keychain.loadSecretResult('port-daddy', 'synthetic-root')).toEqual({ status: 'unavailable' });
    expect(keychain.loadSecret('port-daddy', 'synthetic-root')).toBeNull();
    expect(keychain.saveSecretIfAbsent('port-daddy', 'synthetic-root', 'synthetic')).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
