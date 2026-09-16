// the complete contents of tests/unit/purser/test-remote-opt-in-validation.test.ts
import { describe, expect, test } from '@jest/globals';
import {
  isRemoteModelDownloadAllowed,
  ALLOW_MODEL_DOWNLOAD_ENV,
} from '../../../lib/semantic-resolver.js';

describe('isRemoteModelDownloadAllowed – strict “1” parsing & TRANSFORMERS_OFFLINE override', () => {
  // Helper to build env objects
  const env = (overrides: Record<string, string | undefined> = {}) =>
    overrides as Record<string, string | undefined>;

  test('defaults to false when no opt‑in is present', () => {
    expect(isRemoteModelDownloadAllowed({})).toBe(false);
    expect(isRemoteModelDownloadAllowed(process.env)).toBe(false);
  });

  test('opt‑in only enabled by the literal "1" (whitespace tolerated)', () => {
    expect(isRemoteModelDownloadAllowed(env({ [ALLOW_MODEL_DOWNLOAD_ENV]: '1' }))).toBe(true);
    expect(isRemoteModelDownloadAllowed(env({ [ALLOW_MODEL_DOWNLOAD_ENV]: ' 1 ' }))).toBe(true);
    expect(isRemoteModelDownloadAllowed(env({ [ALLOW_MODEL_DOWNLOAD_ENV]: '01' }))).toBe(false);
    expect(isRemoteModelDownloadAllowed(env({ [ALLOW_MODEL_DOWNLOAD_ENV]: '1a' }))).toBe(false);
    expect(isRemoteModelDownloadAllowed(env({ [ALLOW_MODEL_DOWNLOAD_ENV]: 'a1' }))).toBe(false);
  });

  test('non‑literal values such as "true", "yes", "on" do not enable remote download', () => {
    for (const val of ['true', 'True', 'TRUE', 'yes', 'YES', 'on', 'ON']) {
      expect(isRemoteModelDownloadAllowed(env({ [ALLOW_MODEL_DOWNLOAD_ENV]: val }))).toBe(false);
    }
  });

  test('TRANSFORMERS_OFFLINE=1 vetoes even an explicit opt‑in', () => {
    expect(
      isRemoteModelDownloadAllowed(
        env({
          [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
          TRANSFORMERS_OFFLINE: '1',
        }),
      ),
    ).toBe(false);
  });

  test('TRANSFORMERS_OFFLINE=TRUE/YES/ON vetoes even an explicit opt‑in', () => {
    for (const val of ['TRUE', 'true', 'True', 'YES', 'yes', 'Yes', 'ON', 'on', 'On']) {
      expect(
        isRemoteModelDownloadAllowed(
          env({
            [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
            TRANSFORMERS_OFFLINE: val,
          }),
        ),
      ).toBe(false);
    }
  });

  test('TRANSFORMERS_OFFLINE=0 does not veto an explicit opt‑in', () => {
    expect(
      isRemoteModelDownloadAllowed(
        env({
          [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
          TRANSFORMERS_OFFLINE: '0',
        }),
      ),
    ).toBe(true);
  });

  test('TRANSFORMERS_OFFLINE=maybe (or any other non‑truthy string) does not veto', () => {
    expect(
      isRemoteModelDownloadAllowed(
        env({
          [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
          TRANSFORMERS_OFFLINE: 'maybe',
        }),
      ),
    ).toBe(true);
  });

  test('opt‑in absent and TRANSFORMERS_OFFLINE=1 still yields false', () => {
    expect(
      isRemoteModelDownloadAllowed(
        env({
          TRANSFORMERS_OFFLINE: '1',
        }),
      ),
    ).toBe(false);
  });

  test('opt‑in absent and TRANSFORMERS_OFFLINE=0 yields false', () => {
    expect(
      isRemoteModelDownloadAllowed(
        env({
          TRANSFORMERS_OFFLINE: '0',
        }),
      ),
    ).toBe(false);
  });

  test('process.env is respected when no env argument is provided', () => {
    const original = process.env[ALLOW_MODEL_DOWNLOAD_ENV];
    try {
      delete process.env[ALLOW_MODEL_DOWNLOAD_ENV];
      expect(isRemoteModelDownloadAllowed()).toBe(false);

      process.env[ALLOW_MODEL_DOWNLOAD_ENV] = '1';
      expect(isRemoteModelDownloadAllowed()).toBe(true);

      process.env[ALLOW_MODEL_DOWNLOAD_ENV] = 'true';
      expect(isRemoteModelDownloadAllowed()).toBe(false);
    } finally {
      if (original === undefined) delete process.env[ALLOW_MODEL_DOWNLOAD_ENV];
      else process.env[ALLOW_MODEL_DOWNLOAD_ENV] = original;
    }
  });
});