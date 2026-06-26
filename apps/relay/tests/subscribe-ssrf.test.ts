/**
 * SSRF hardening tests for handleSubscribe (PR #340).
 *
 * sessionId is interpolated into the Durable Object fetch URL, so a crafted
 * value could otherwise inject extra path/query segments into the DO request.
 * handleSubscribe must reject any sessionId that does not match
 * /^[a-zA-Z0-9_-]{1,128}$/ with 400 INVALID_SESSION *before* touching the DB
 * or the DO namespace.
 */

import { describe, it, expect } from 'vitest';
import { handleSubscribe } from '../src/handlers.js';
import type { Env } from '../src/types.js';

// A trap Env: every access to DB or HARBOR_CHANNEL throws, proving the
// validation short-circuits before any backend is reached.
function trapEnv(): Env {
  const trap = new Proxy(
    {},
    {
      get() {
        throw new Error('backend reached before sessionId validation');
      },
    }
  );
  return {
    DB: trap as unknown as D1Database,
    HARBOR_CHANNEL: trap as unknown as DurableObjectNamespace,
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: '0'.repeat(32),
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as Env;
}

function req(): Request {
  return new Request('https://relay.example.com/v1/subscribe', {
    headers: { Accept: 'text/event-stream' },
  });
}

const MALICIOUS_IDS = [
  'sess/../admin',
  'sess?action=publish',
  'sess&action=publish',
  'sess id with spaces',
  'sess#frag',
  'http://evil/',
  '',
  'x'.repeat(129),
];

describe('handleSubscribe — SSRF sessionId validation', () => {
  for (const bad of MALICIOUS_IDS) {
    it(`rejects malformed sessionId ${JSON.stringify(bad)} with 400 before any backend call`, async () => {
      const resp = await handleSubscribe(req(), trapEnv(), bad);
      expect(resp.status).toBe(400);
      const body = (await resp.json()) as { code: string };
      expect(body.code).toBe('INVALID_SESSION');
    });
  }

  it('accepts a well-formed sessionId (passes validation, then hits the trap)', async () => {
    // A valid id passes the regex, so the function proceeds and only then
    // touches the trap Env — confirming the gate is shape-based, not a blanket reject.
    await expect(handleSubscribe(req(), trapEnv(), 'sess-abc_123')).rejects.toThrow(
      /backend reached/
    );
  });
});
