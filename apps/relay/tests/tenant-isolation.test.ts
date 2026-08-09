/**
 * Tenant-isolation regression guard (ADR-0101 multi-tenant review, MT1).
 *
 * Port Daddy's relay runs on Cloudflare D1, which has NO row-level security, so
 * there is no database-level isolation backstop: every endpoint that returns
 * user / account / run data MUST pass through an application-layer authorization
 * choke point (resolveSession, userCanReadRepo, hasTokenAuth, or operatorOnly).
 * This test pins that invariant — an unauthenticated caller gets no tenant data
 * from ANY data-returning route, so a future route added without a gate fails
 * here instead of leaking cross-tenant.
 *
 * If you add a relay endpoint that returns user/account/run data, add it to
 * DATA_ENDPOINTS below with the status an unauthenticated call must receive.
 */

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { handleAuthMe, handleAccountExport, handleAccountDelete } from '../src/auth-github.js';
import { handleFleetRunPage } from '../src/fleet-run-page.js';
import {
  handleCreateHarbor,
  handleListMyHarbors,
  handleGetHarbor,
  handleAddHarborMember,
} from '../src/harbors.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';

// D1 that would happily return a run if asked — so a PASS here proves the gate,
// not an empty database.
function permissiveDb(): D1Database {
  const run = {
    id: 'run:x', delivery_id: 'x', repo_full_name: 'acme/secret', pr_number: 1,
    pr_url: 'https://github.com/acme/secret/pull/1', head_sha: 'abcdef1234',
    conclusion: 'success', ships_csv: 'code-reviewer', neurons: 1, ms: 1, created_at: 1,
  };
  const stmt = (sql: string) => ({
    bind() { return this; },
    async first() { return sql.includes('FROM fleet_runs') ? run : null; },
    async all() { return { results: [] }; },
    async run() { return { success: true, meta: { changes: 0 } }; },
  });
  return { prepare: stmt } as unknown as D1Database;
}

function makeEnv(): Env {
  return {
    DB: permissiveDb(),
    KV: { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace,
    RELAY_OPERATOR_TOKEN: 'operator-token-at-least-32-bytes-long!!',
    RUN_PAGE_SECRET: 'run-page-secret-that-is-at-least-32-chars',
    GITHUB_OAUTH_CLIENT_ID: 'x', GITHUB_OAUTH_CLIENT_SECRET: 'y',
    USER_TOKEN_WRAPPING_KEY: 'cc'.repeat(32), PUBLIC_BASE_URL: BASE,
  } as unknown as Env;
}

function noAuth(path: string, method = 'GET'): Request {
  return new Request(`${BASE}${path}`, { method });
}

describe('tenant isolation — no ambient access to tenant data (MT1)', () => {
  it('every user/account data route rejects an unauthenticated caller', async () => {
    const env = makeEnv();
    const cases: Array<[string, Promise<Response>, number]> = [
      ['/auth/me', handleAuthMe(noAuth('/auth/me'), env), 401],
      ['/account/export', handleAccountExport(noAuth('/account/export'), env), 401],
      ['/account/delete', handleAccountDelete(noAuth('/account/delete', 'POST'), env), 401],
      // Run page: no token, no session → the same 404 as a nonexistent run.
      ['/fleet/runs/run:x', handleFleetRunPage(noAuth('/fleet/runs/run:x'), env, 'run:x'), 404],
      // Remote harbors (X2): every route is session/pdu-gated.
      ['/v1/harbors (create)', handleCreateHarbor(noAuth('/v1/harbors', 'POST'), env), 401],
      ['/v1/harbors (mine)', handleListMyHarbors(noAuth('/v1/harbors'), env), 401],
      ['/v1/harbors/a/b', handleGetHarbor(noAuth('/v1/harbors/a/b'), env, 'a', 'b'), 401],
      ['/v1/harbors/a/b/members', handleAddHarborMember(noAuth('/v1/harbors/a/b/members', 'POST'), env, 'a', 'b'), 401],
    ];
    for (const [name, p, want] of cases) {
      const res = await p;
      expect(res.status, `${name} must reject unauthenticated`).toBe(want);
    }
  });

  it('operator-only run mutation is unreachable without the operator token', async () => {
    const env = makeEnv();
    // Route DELETE /v1/fleet/runs/:id through the real worker fetch dispatcher.
    const res = await worker.fetch(new Request(`${BASE}/v1/fleet/runs/run:x`, { method: 'DELETE' }), env, {} as ExecutionContext);
    expect(res.status).toBe(401);
  });

  it('account data endpoints are keyed off the session, never a URL/body id (no ID-guessing surface)', async () => {
    // handleAccountExport/Delete take no id param — they resolve the caller's own
    // session. A cross-tenant read via a guessed id is structurally impossible.
    expect(handleAccountExport.length).toBe(2); // (request, env) — no id arg
    expect(handleAccountDelete.length).toBe(2);
  });
});
