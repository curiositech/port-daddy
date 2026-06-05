/**
 * #160 integration: the daemon's /health and /status must verify their own
 * critical routes are mounted, not hard-code "ok"/"nominal".
 *
 * This boots the real ephemeral daemon (server.ts via the Jest globalSetup) so
 * the root onRoute hook + routeRegistry wiring is exercised end to end — a
 * green-in-jest-only unit test would not prove the wiring runs under the real
 * runtime (regression-test-under-real-runtime discipline).
 */

import { request } from '../helpers/integration-setup.js';

describe('#160 — /health reports honest route coverage', () => {
  test('a healthy daemon reports status ok with all critical routes present', async () => {
    const res = await request('/health');
    expect(res.ok).toBe(true);
    expect(res.data.status).toBe('ok');
    // The route self-check ran (registry was wired) and found nothing missing.
    expect(res.data.routes).toBeDefined();
    expect(res.data.routes.ok).toBe(true);
    expect(res.data.routes.missing).toEqual([]);
    expect(res.data.routes.checked).toBeGreaterThan(5);
    // Route-specific honesty: no route_missing reason is present (arbiter/rule
    // degradation is environment-dependent and reported separately in runtime).
    expect((res.data.runtime.reasons || []).some((r) => String(r).startsWith('route_missing:'))).toBe(false);
  });

  test('/health actually saw its own /health route (registry is populated, not empty)', async () => {
    // Guards against the failure where routeRegistry is wired but empty, which
    // would make EVERYTHING report missing — the opposite false reading.
    const res = await request('/health');
    expect(res.data.routes.checked).toBeGreaterThan(0);
    expect(res.data.routes.ok).toBe(true); // empty registry would make this false
  });

  test('/status carries the same honest route signal', async () => {
    const res = await request('/status');
    expect(res.ok).toBe(true);
    expect(res.data.status).toBe('ok');
    expect(res.data.routes.ok).toBe(true);
  });
});
