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

/**
 * Reconciliation with PR #724 (lib/fleet/url-guard.ts mappedIpv4() fix).
 *
 * #724 closed an SSRF bypass where an IPv4-mapped IPv6 literal
 * (::ffff:169.254.169.254, which Node normalizes to ::ffff:a9fe:a9fe) reached
 * cloud metadata through the FLEET *outbound-host* guard. That guard classifies
 * a real network destination.
 *
 * handleSubscribe is a DIFFERENT surface: sessionId is never a network host. It
 * is a DB key and a URL-encoded query param on a fetch to a FIXED Durable Object
 * binding (`http://do/...` — a synthetic hostname Cloudflare ignores; there is no
 * DNS and no IP resolution). So the mapped-IPv4 class cannot cause egress here.
 *
 * Nonetheless, every host/IP literal that carries a URL-control or host character
 * (`:`, `.`, `/`, `[`, `]`) is refused by the sessionId allowlist BEFORE any
 * backend call — including the exact literals #724 had to special-case. This
 * proves the relay's subscribe path has no mapped-IPv4-style hole to close.
 */
const SSRF_HOST_LITERALS = [
  '::ffff:169.254.169.254', // IPv4-mapped IPv6, dotted tail (the #724 payload)
  '::ffff:a9fe:a9fe',        // IPv4-mapped IPv6, hex-hextet form (Node's normalization)
  '::ffff:7f00:1',           // IPv4-mapped loopback, hex-hextet
  '169.254.169.254',         // dotted metadata IP
  '0177.0.0.1',              // octal-encoded 127.0.0.1
  '[::1]',                   // bracketed IPv6 loopback
  '2130706433.nip.io',       // decimal-IP DNS-rebind style host (dot-bearing)
  'metadata.google.internal',// metadata DNS name
];

describe('handleSubscribe — mapped-IPv4 / host-literal SSRF forms (reconciliation with #724)', () => {
  for (const host of SSRF_HOST_LITERALS) {
    it(`refuses host literal ${JSON.stringify(host)} with 400 before any backend call`, async () => {
      const resp = await handleSubscribe(req(), trapEnv(), host);
      expect(resp.status).toBe(400);
      expect(((await resp.json()) as { code: string }).code).toBe('INVALID_SESSION');
    });
  }

  it('an inert all-alphanumeric IP encoding (decimal 2130706433) is ACCEPTED as a session-id shape — safe because it is never resolved as a host', async () => {
    // Bare digits/hex like 2130706433 or 0x7f000001 match [a-zA-Z0-9_-] and so
    // pass the allowlist. That is correct here: the value is used only as a DB
    // lookup key and a URL-encoded query param routed to a fixed Durable Object,
    // never as a network destination — so it cannot cause SSRF. Documented so a
    // future maintainer does not "harden" the regex against inert numeric ids and
    // mistake this relay guard for an outbound-host guard (that is #724's job).
    await expect(handleSubscribe(req(), trapEnv(), '2130706433')).rejects.toThrow(
      /backend reached/
    );
    await expect(handleSubscribe(req(), trapEnv(), '0x7f000001')).rejects.toThrow(
      /backend reached/
    );
  });
});
