import { mergeJscSafeModeEnv } from '../../../shared/daemon-binary.js';

describe('long-lived Bun child environment composition', () => {
  test('preserves ordinary environment overlays while forcing safe JSC values', () => {
    const result = mergeJscSafeModeEnv(
      {
        PORT_DADDY_RESOURCE_DIR: '/base',
        BUN_JSC_useConcurrentGC: '1',
        BUN_JSC_useConcurrentJIT: '1',
      },
      {
        PORT_DADDY_RESOURCE_DIR: '/profile',
        PROFILE_ONLY: 'present',
      },
      {
        OPTION_ONLY: 'present',
        BUN_JSC_useConcurrentGC: 'still-unsafe',
      },
    );

    expect(result).toMatchObject({
      PORT_DADDY_RESOURCE_DIR: '/profile',
      PROFILE_ONLY: 'present',
      OPTION_ONLY: 'present',
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
  });

  test('reads the exact opt-out from the final merged environment', () => {
    expect(mergeJscSafeModeEnv(
      {
        PORT_DADDY_JSC_SAFE_MODE: '1',
        BUN_JSC_useConcurrentGC: 'base-gc',
      },
      {
        PORT_DADDY_JSC_SAFE_MODE: '0',
        BUN_JSC_useConcurrentJIT: 'profile-jit',
      },
    )).toMatchObject({
      PORT_DADDY_JSC_SAFE_MODE: '0',
      BUN_JSC_useConcurrentGC: 'base-gc',
      BUN_JSC_useConcurrentJIT: 'profile-jit',
    });
  });

  test.each([undefined, '', 'false', '0 ', 'invalid'])(
    'does not treat %p as an opt-out',
    (value) => {
      expect(mergeJscSafeModeEnv({
        PORT_DADDY_JSC_SAFE_MODE: value,
        BUN_JSC_useConcurrentGC: '1',
        BUN_JSC_useConcurrentJIT: '1',
      })).toMatchObject({
        BUN_JSC_useConcurrentGC: '0',
        BUN_JSC_useConcurrentJIT: '0',
      });
    },
  );

  test('accepts missing environment sources without losing later values', () => {
    expect(mergeJscSafeModeEnv(undefined, { OTHER: 'value' })).toMatchObject({
      OTHER: 'value',
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
  });
});
