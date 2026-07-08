/**
 * Route health — the daemon's honest self-check that its critical endpoints are
 * actually registered.
 *
 * #160: `/health` returned a hard-coded `status: 'ok'` and `runtime.state`
 * derived only from the arbiter. If a route plugin failed to register, the
 * endpoints 404'd while the probe still said "nominal." A health probe that
 * cannot see its own missing routes lies — the operational twin of the vacuous
 * proof this codebase otherwise refuses to ship (ADR-0045 loud-fail invariants).
 *
 * This module takes an injected `isRegistered(method, url)` predicate so it can
 * be unit-tested without booting Fastify, and wired in production to a registry
 * populated by a root-level `onRoute` hook (server.ts).
 */

export interface RouteRef {
  method: string;
  url: string;
}

export interface RouteHealth {
  /** true iff every critical route is registered. */
  ok: boolean;
  /** the critical routes that are NOT registered (would 404). */
  missing: RouteRef[];
  /** how many routes were checked. */
  checked: number;
  /** the full list of critical routes that were checked (method + path), so a
   *  client (pd-console Health pane) can show WHICH routes were verified, not
   *  just a bare count like "11 checked / 0 missing". */
  checkedRoutes: RouteRef[];
}

/**
 * The daemon's core route contract: endpoints that MUST exist for the daemon to
 * be considered healthy. All verified present in the route tree; keep this list
 * conservative (fundamental, stable routes only) so it never false-positives on
 * a healthy daemon.
 */
export const CRITICAL_ROUTES: RouteRef[] = [
  { method: 'GET', url: '/health' },
  { method: 'GET', url: '/status' },
  { method: 'GET', url: '/version' },
  { method: 'GET', url: '/services' },
  { method: 'POST', url: '/claim' },
  { method: 'DELETE', url: '/release' },
  { method: 'GET', url: '/agents' },
  { method: 'POST', url: '/agents' },
  { method: 'GET', url: '/sessions' },
  { method: 'GET', url: '/notes' },
  { method: 'GET', url: '/harbors' },
];

/**
 * Assess whether the daemon's critical routes are registered.
 *
 * @param isRegistered predicate answering "is (method, url) in the router?"
 * @param routes the contract to check (defaults to CRITICAL_ROUTES)
 */
export function assessRouteHealth(
  isRegistered: (method: string, url: string) => boolean,
  routes: RouteRef[] = CRITICAL_ROUTES,
): RouteHealth {
  const missing = routes.filter((r) => !isRegistered(r.method, r.url));
  return { ok: missing.length === 0, missing, checked: routes.length, checkedRoutes: routes };
}

/**
 * Build an `isRegistered` predicate from a set of `"METHOD /url"` keys (the
 * shape a root `onRoute` hook accumulates). Method comparison is
 * case-insensitive; Fastify normalizes methods to upper-case.
 */
export function registeredFromSet(keys: Set<string>): (method: string, url: string) => boolean {
  return (method, url) => keys.has(`${method.toUpperCase()} ${url}`);
}
