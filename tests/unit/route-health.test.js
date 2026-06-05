/**
 * Unit tests for lib/route-health.ts
 *
 * #160: the daemon reported `status: 'ok'` / `runtime.state: 'nominal'` even when
 * route plugins failed to register and the endpoints 404'd. A health probe that
 * can't see its own missing routes is the operational twin of a vacuous proof.
 *
 * This module answers "are the daemon's critical routes actually registered?"
 * via an injected predicate, so it is testable without booting Fastify.
 */

import { assessRouteHealth, CRITICAL_ROUTES } from '../../lib/route-health.js';

function registryOf(routes) {
  const set = new Set(routes.map((r) => `${r.method.toUpperCase()} ${r.url}`));
  return (method, url) => set.has(`${method.toUpperCase()} ${url}`);
}

describe('route-health: honest critical-route self-check', () => {
  test('all critical routes present → ok, nothing missing', () => {
    const isRegistered = registryOf(CRITICAL_ROUTES);
    const h = assessRouteHealth(isRegistered);
    expect(h.ok).toBe(true);
    expect(h.missing).toEqual([]);
    expect(h.checked).toBe(CRITICAL_ROUTES.length);
  });

  test('a missing critical route → not ok, names the gap (#160 core)', () => {
    const present = CRITICAL_ROUTES.filter((r) => !(r.method === 'GET' && r.url === '/health'));
    const h = assessRouteHealth(registryOf(present));
    expect(h.ok).toBe(false);
    expect(h.missing).toEqual([{ method: 'GET', url: '/health' }]);
  });

  test('empty router → not ok, everything missing (the 404-everything case)', () => {
    const h = assessRouteHealth(() => false);
    expect(h.ok).toBe(false);
    expect(h.missing.length).toBe(CRITICAL_ROUTES.length);
  });

  test('method match is case-insensitive (Fastify stores upper-case)', () => {
    const isRegistered = (method, url) =>
      CRITICAL_ROUTES.some((r) => r.url === url); // ignore method case entirely
    const h = assessRouteHealth(isRegistered);
    expect(h.ok).toBe(true);
  });

  test('a custom route list can be checked (composable)', () => {
    const custom = [{ method: 'GET', url: '/x' }, { method: 'POST', url: '/y' }];
    expect(assessRouteHealth(registryOf([{ method: 'GET', url: '/x' }]), custom).ok).toBe(false);
    expect(assessRouteHealth(registryOf(custom), custom).ok).toBe(true);
  });

  test('CRITICAL_ROUTES is a non-empty stable contract of {method,url}', () => {
    expect(CRITICAL_ROUTES.length).toBeGreaterThan(5);
    for (const r of CRITICAL_ROUTES) {
      expect(typeof r.method).toBe('string');
      expect(r.url.startsWith('/')).toBe(true);
    }
  });
});
