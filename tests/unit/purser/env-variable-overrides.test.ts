// tests/unit/purser/env-variable-overrides.test.ts
import { jscSafeModeEnv } from '../../../shared/daemon-binary.js';

describe('jscSafeModeEnv', () => {
  test('returns overrides when PORT_DADDY_JSC_SAFE_MODE is not "0"', () => {
    const env = { PORT_DADDY_JSC_SAFE_MODE: '1' };
    expect(jscSafeModeEnv(env)).toEqual({
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
  });

  test('returns empty object when PORT_DADDY_JSC_SAFE_MODE is "0"', () => {
    const env = { PORT_DADDY_JSC_SAFE_MODE: '0' };
    expect(jscSafeModeEnv(env)).toEqual({});
  });

  test('overrides existing BUN_JSC_* values when enabled', () => {
    const env = {
      PORT_DADDY_JSC_SAFE_MODE: '1',
      BUN_JSC_useConcurrentGC: '1',
      BUN_JSC_useConcurrentJIT: '1',
      OTHER: 'value',
    };
    const merged = { ...env, ...jscSafeModeEnv(env) };
    expect(merged.BUN_JSC_useConcurrentGC).toBe('0');
    expect(merged.BUN_JSC_useConcurrentJIT).toBe('0');
    expect(merged.OTHER).toBe('value');
    expect(merged.PORT_DADDY_JSC_SAFE_MODE).toBe('1');
  });

  test('does not override existing BUN_JSC_* values when opt-out', () => {
    const env = {
      PORT_DADDY_JSC_SAFE_MODE: '0',
      BUN_JSC_useConcurrentGC: '1',
      BUN_JSC_useConcurrentJIT: '1',
      OTHER: 'value',
    };
    const merged = { ...env, ...jscSafeModeEnv(env) };
    expect(merged.BUN_JSC_useConcurrentGC).toBe('1');
    expect(merged.BUN_JSC_useConcurrentJIT).toBe('1');
    expect(merged.OTHER).toBe('value');
    expect(merged.PORT_DADDY_JSC_SAFE_MODE).toBe('0');
  });

  test('adds BUN_JSC_* values when absent and enabled', () => {
    const env = { PORT_DADDY_JSC_SAFE_MODE: '1', OTHER: 'value' };
    const merged = { ...env, ...jscSafeModeEnv(env) };
    expect(merged.BUN_JSC_useConcurrentGC).toBe('0');
    expect(merged.BUN_JSC_useConcurrentJIT).toBe('0');
    expect(merged.OTHER).toBe('value');
  });

  test('does not add BUN_JSC_* values when absent and opt-out', () => {
    const env = { PORT_DADDY_JSC_SAFE_MODE: '0', OTHER: 'value' };
    const merged = { ...env, ...jscSafeModeEnv(env) };
    expect(merged.BUN_JSC_useConcurrentGC).toBeUndefined();
    expect(merged.BUN_JSC_useConcurrentJIT).toBeUndefined();
    expect(merged.OTHER).toBe('value');
  });
});

describe('jscSafeModeEnv with process.env', () => {
  const original = process.env.PORT_DADDY_JSC_SAFE_MODE;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.PORT_DADDY_JSC_SAFE_MODE;
    } else {
      process.env.PORT_DADDY_JSC_SAFE_MODE = original;
    }
  });

  test('uses process.env when env not provided', () => {
    process.env.PORT_DADDY_JSC_SAFE_MODE = '0';
    expect(jscSafeModeEnv()).toEqual({});
    process.env.PORT_DADDY_JSC_SAFE_MODE = '1';
    expect(jscSafeModeEnv()).toEqual({
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
  });
});