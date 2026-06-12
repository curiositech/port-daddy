/**
 * Integration tests for the Relay HTTP routes (ADR-0049).
 *
 * REGRESSION GUARD: routes/relay.ts was SHIPPED-DEAD — the plugin defined
 * GET/POST /relay/config, GET /relay/status and POST /relay/exchange but was
 * never registered in routes/index.ts, so every `pd relay` CLI call 404'd
 * against a live daemon. The manifest + endpoint-parity static tests passed
 * because they grep route *definitions*, not route *registration*. The only
 * durable guard is booting the daemon and asserting the routes are REACHABLE.
 *
 * These tests boot the ephemeral daemon (real server.ts → registerAllRoutes)
 * and assert:
 *   1. The relay routes are reachable (NOT 404) — the core regression.
 *   2. The SSRF guard rejects private/internal + plaintext-remote relay_url.
 *   3. A valid https relay_url round-trips (set → read → clear).
 *
 * NOTE on the loopback guard: the integration harness talks to the daemon over
 * the Unix socket, where request.ip is empty and counts as loopback (that is
 * the local-CLI path), so the mutating routes are reachable here. The 403
 * non-loopback rejection is covered at unit altitude in
 * tests/unit/relay-routes.test.js (it needs a non-loopback TCP peer, which the
 * loopback-bound daemon does not accept).
 */

import { request } from '../helpers/integration-setup.js';

async function status(method, path, body) {
  const res = await request(path, body ? { method, body } : { method });
  return res;
}

describe('Relay HTTP routes (ADR-0049) — registration + SSRF guard', () => {
  // The core regression: these routes must NOT 404. If the plugin is
  // unregistered (the shipped-dead state) every assertion here fails with 404.
  test('GET /relay/config is reachable (not 404) and returns relay_url shape', async () => {
    const res = await status('GET', '/relay/config');
    expect(res.status).not.toBe(404);
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty('relay_url');
  });

  test('GET /relay/status is reachable (not 404) and returns connection status', async () => {
    const res = await status('GET', '/relay/status');
    expect(res.status).not.toBe(404);
    expect(res.ok).toBe(true);
    expect(res.data).toHaveProperty('connected');
    // The daemon does not start the outbound connection manager yet, so this
    // must honestly report not-connected (no fake "connected: true").
    expect(res.data.connected).toBe(false);
  });

  test('POST /relay/config is reachable (not 404)', async () => {
    // Reachability check: even a 400 (bad body) proves the route is wired.
    const res = await status('POST', '/relay/config', { relay_url: 'https://relay.example.test' });
    expect(res.status).not.toBe(404);
  });

  test('POST /relay/config rejects a private/internal host (SSRF blocked)', async () => {
    const res = await status('POST', '/relay/config', { relay_url: 'http://169.254.169.254/latest/meta-data' });
    expect(res.status).toBe(400);
    // 169.254.169.254 is cloud metadata — must be blocked. http+non-loopback
    // is rejected by the scheme guard first; either rejection code is correct.
    expect(['SSRF_BLOCKED', 'INSECURE_SCHEME']).toContain(res.data?.code);
  });

  test('POST /relay/config rejects https to a private RFC1918 host (SSRF blocked)', async () => {
    const res = await status('POST', '/relay/config', { relay_url: 'https://10.0.0.5:8443' });
    expect(res.status).toBe(400);
    expect(res.data?.code).toBe('SSRF_BLOCKED');
  });

  test('POST /relay/config rejects plaintext http:// to a remote host', async () => {
    const res = await status('POST', '/relay/config', { relay_url: 'http://relay.example.test' });
    expect(res.status).toBe(400);
    expect(res.data?.code).toBe('INSECURE_SCHEME');
  });

  test('POST /relay/config rejects a non-URL value', async () => {
    const res = await status('POST', '/relay/config', { relay_url: 'not a url' });
    expect(res.status).toBe(400);
    expect(res.data?.code).toBe('INVALID_URL');
  });

  test('valid https relay_url round-trips: set -> read -> clear', async () => {
    const url = 'https://relay.portdaddy.dev';
    const set = await status('POST', '/relay/config', { relay_url: url });
    expect(set.ok).toBe(true);
    expect(set.data?.relay_url).toBe(url);

    const read = await status('GET', '/relay/config');
    expect(read.ok).toBe(true);
    expect(read.data?.relay_url).toBe(url);

    const clear = await status('POST', '/relay/config', { relay_url: null });
    expect(clear.ok).toBe(true);
    expect(clear.data?.relay_url).toBeNull();

    const readAfter = await status('GET', '/relay/config');
    expect(readAfter.data?.relay_url).toBeNull();
  });

  test('loopback http:// relay_url is permitted (local relay dev)', async () => {
    const url = 'http://127.0.0.1:8787';
    const set = await status('POST', '/relay/config', { relay_url: url });
    expect(set.ok).toBe(true);
    expect(set.data?.relay_url).toBe(url);
    // cleanup
    await status('POST', '/relay/config', { relay_url: null });
  });

  test('POST /relay/exchange is reachable and 400s without a configured relay_url', async () => {
    // Ensure no relay is configured.
    await status('POST', '/relay/config', { relay_url: null });
    const res = await status('POST', '/relay/exchange', { oidc_token: 'dummy' });
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(400);
    expect(res.data?.code).toBe('NO_RELAY');
  });
});
