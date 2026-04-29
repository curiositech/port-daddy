import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

const originalNodeEnv = process.env.NODE_ENV;
const originalPortDaddyDisableKeychain = process.env.PORT_DADDY_DISABLE_KEYCHAIN;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalGoogleKey = process.env.GOOGLE_API_KEY;
const originalNgrokToken = process.env.NGROK_AUTHTOKEN;

const secretEnv = await import('../../lib/secret-env.js');

function restoreEnvironment() {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalPortDaddyDisableKeychain === undefined) delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
  else process.env.PORT_DADDY_DISABLE_KEYCHAIN = originalPortDaddyDisableKeychain;

  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;

  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;

  if (originalGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = originalGoogleKey;

  if (originalNgrokToken === undefined) delete process.env.NGROK_AUTHTOKEN;
  else process.env.NGROK_AUTHTOKEN = originalNgrokToken;
}

describe('secret-env', () => {
  beforeEach(() => {
    secretEnv._resetForTests();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.NGROK_AUTHTOKEN;
    delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    restoreEnvironment();
  });

  test('snapshots sensitive env vars, scrubs process.env, and preserves cached reads', () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-secret';
    process.env.GEMINI_API_KEY = 'gemini-secret';
    process.env.GOOGLE_API_KEY = 'google-secret';

    secretEnv.snapshotSensitiveEnv();

    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(process.env.GOOGLE_API_KEY).toBeUndefined();
    expect(secretEnv.getSecret('ANTHROPIC_API_KEY')).toBe('anthropic-secret');
    expect(secretEnv.getSecret('GEMINI_API_KEY')).toBe('gemini-secret');
    expect(secretEnv.hasSecret('ANTHROPIC_API_KEY')).toBe(true);
    expect(secretEnv.hasSecret('GOOGLE_API_KEY')).toBe(true);
    expect(secretEnv.listSnapshottedKeys()).toEqual([
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
    ]);
  });

  test('keeps the first snapshot and leaves later env changes out of the cache', () => {
    process.env.NGROK_AUTHTOKEN = 'initial-token';

    secretEnv.snapshotSensitiveEnv();
    process.env.NGROK_AUTHTOKEN = 'later-token';
    secretEnv.snapshotSensitiveEnv();

    expect(secretEnv.getSecret('NGROK_AUTHTOKEN')).toBe('initial-token');
    expect(process.env.NGROK_AUTHTOKEN).toBe('later-token');
    expect(secretEnv.listSnapshottedKeys()).toEqual(['NGROK_AUTHTOKEN']);
  });

  test('falls back to live env before snapshot and merges cached secrets into child env', () => {
    process.env.GEMINI_API_KEY = 'gemini-live';

    expect(secretEnv.getSecret('GEMINI_API_KEY')).toBe('gemini-live');

    secretEnv.snapshotSensitiveEnv();
    const childEnv = secretEnv.withSecretsInChildEnv({ PATH: '/usr/bin', OTHER: 'value' });

    expect(childEnv).toEqual({
      PATH: '/usr/bin',
      OTHER: 'value',
      GEMINI_API_KEY: 'gemini-live',
    });
  });

  test('rejects reset outside the test environment guard', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PORT_DADDY_DISABLE_KEYCHAIN;

    expect(() => secretEnv._resetForTests()).toThrow('secret-env._resetForTests called outside test environment');
  });
});
