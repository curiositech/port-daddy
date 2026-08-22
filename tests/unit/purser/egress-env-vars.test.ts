// tests/unit/purser/egress-env-vars.test.ts
import { describe, test, expect } from '@jest/globals';

/**
 * List of all env variables that must be cleared in a local‑only test
 * environment.  These are the same keys that the integration test
 * explicitly blanks out before starting the daemon.
 */
const CLOUD_ENV_KEYS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_API_TOKEN',
  'CF_ACCOUNT_ID',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'PD_RELAY_URL',
  'RELAY_URL',
  'PORT_DADDY_RELAY_URL',
  'PD_TELEMETRY_URL',
  'PORT_DADDY_TELEMETRY_URL',
];

describe('cloud/relay/telemetry environment variables', () => {
  test('all cloud/relay/telemetry env vars are explicitly cleared', () => {
    for (const key of CLOUD_ENV_KEYS) {
      const val = process.env[key];
      // In a clean test environment these should be either undefined or an empty string.
      // Any non-empty value would mean a leak path is still configured.
      if (val !== undefined) {
        expect(val).toBe('');
      } else {
        expect(val).toBeUndefined();
      }
    }
  });
});