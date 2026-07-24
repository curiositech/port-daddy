import {
  NATIVE_SESSION_ADAPTER_FAMILIES,
  nativeHarnessSessionIdError,
  normalizeNativeHarnessSessionId,
} from '../../lib/harness-session-id.js';

describe('native harness session identifiers', () => {
  const sessionId = 'A1111111-1111-4111-8111-111111111111';

  test.each(NATIVE_SESSION_ADAPTER_FAMILIES)('%s accepts only UUID-shaped native identities', (family) => {
    expect(normalizeNativeHarnessSessionId(family, sessionId))
      .toBe(sessionId.toLowerCase());
    expect(nativeHarnessSessionIdError(family, '--last')).toMatch(/canonical UUID/);
    expect(nativeHarnessSessionIdError(family, 'session-1')).toMatch(/canonical UUID/);
    expect(nativeHarnessSessionIdError(family, ` ${sessionId}`)).toMatch(/canonical UUID/);
  });

  test('leaves non-native adapter families to their adapter contract', () => {
    expect(nativeHarnessSessionIdError('openai-api', 'provider-call-1')).toBeNull();
  });
});
