// tests/unit/purser/invalid-opt-out-values.test.ts
import { jscSafeModeEnv } from '../../../shared/daemon-binary.js';

const SAFE_ENV = {
  BUN_JSC_useConcurrentGC: '0',
  BUN_JSC_useConcurrentJIT: '0',
};

describe('jscSafeModeEnv: invalid opt-out values', () => {
  const testCases: Array<{ env: NodeJS.ProcessEnv; expected: Record<string, string> }> = [
    // No env key at all
    { env: {}, expected: SAFE_ENV },
    // Undefined value
    { env: { PORT_DADDY_JSC_SAFE_MODE: undefined }, expected: SAFE_ENV },
    // Empty string (not '0')
    { env: { PORT_DADDY_JSC_SAFE_MODE: '' }, expected: SAFE_ENV },
    // Non-numeric string
    { env: { PORT_DADDY_JSC_SAFE_MODE: 'foo' }, expected: SAFE_ENV },
    // String that looks like a number but is not '0'
    { env: { PORT_DADDY_JSC_SAFE_MODE: '123' }, expected: SAFE_ENV },
    // Boolean-like strings
    { env: { PORT_DADDY_JSC_SAFE_MODE: 'true' }, expected: SAFE_ENV },
    { env: { PORT_DADDY_JSC_SAFE_MODE: 'false' }, expected: SAFE_ENV },
    // Leading/trailing whitespace
    { env: { PORT_DADDY_JSC_SAFE_MODE: '0 ' }, expected: SAFE_ENV },
    // Explicit opt-out
    { env: { PORT_DADDY_JSC_SAFE_MODE: '0' }, expected: {} },
  ];

  testCases.forEach(({ env, expected }, idx) => {
    test(`case #${idx + 1}: jscSafeModeEnv(${JSON.stringify(env)})`, () => {
      expect(jscSafeModeEnv(env)).toEqual(expected);
    });
  });

  // Additional sanity checks
  test('safe mode is enabled by default when no env is provided', () => {
    expect(jscSafeModeEnv()).toEqual(SAFE_ENV);
  });

  test('safe mode is not affected by unrelated env keys', () => {
    const env = { PORT_DADDY_JSC_SAFE_MODE: '1', OTHER_KEY: 'value' };
    expect(jscSafeModeEnv(env)).toEqual(SAFE_ENV);
  });
});