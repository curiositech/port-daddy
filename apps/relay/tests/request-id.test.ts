/**
 * Tests for requestId threading + SLO sampling at the router boundary
 * (src/index.ts; grand-plan DAG node x7-mercy-hooks, slice 3).
 *
 * THE GATE: "requestId asserted present on error envelopes across threaded
 * modules". The threading is done at the ONE choke point every module's
 * response passes through (index.ts), so the assertion here sweeps the
 * modules by ROUTE: handlers, harbors, presence, parleys, mediator-body,
 * interruptions, fleet-control, billing/quotas, run-report, the router's own
 * NOT_FOUND, and the global INTERNAL_ERROR boundary. Every JSON error
 * envelope must carry `requestId`, every response the `X-Request-Id` header,
 * and success bodies must pass through untouched.
 *
 * Also pinned: one SLO burn sample per request rides ctx.waitUntil (5xx
 * counts as an error, a 4xx does not), and a bare-object ctx (this very test
 * harness) cannot break the response path.
 */

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const RID = /^req_[0-9a-f]{16}$/;

/** Fake D1 that answers every query with empty rows (auth resolves to
 *  "signed out", lists are empty) and captures SLO sample inserts. */
function makeNullDb() {
  const sloInserts: Array<{ args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const s = {
        bind(...v: unknown[]) {
          args = v;
          return s;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO mercy_slo_windows')) sloInserts.push({ args });
          return { success: true };
        },
      };
      return s;
    },
  };
  return { db: db as unknown as D1Database, sloInserts };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    KV: {} as KVNamespace,
    HARBOR_CHANNEL: {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => new Response('{}') }),
    },
    RELAY_OPERATOR_TOKEN: 'operator-token-0123456789abcdef-0123456789abcdef',
    RELAY_ED25519_PRIVATE_KEY_HEX: '42'.repeat(32),
    RELAY_VERSION: '0.0.0-test',
    SESSION_TTL_SECONDS: '3600',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

interface CapturingCtx extends ExecutionContext {
  waited: Promise<unknown>[];
}

function makeCtx(): CapturingCtx {
  const waited: Promise<unknown>[] = [];
  return {
    waited,
    waitUntil(p: Promise<unknown>) {
      waited.push(p);
    },
    passThroughOnException() {},
  } as unknown as CapturingCtx;
}

async function hit(path: string, init: RequestInit, env: Env, ctx?: ExecutionContext): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, init), env, ctx ?? makeCtx());
}

// One error-producing route per threaded module. The exact code varies per
// module's own gate (BAD_JSON, UNAUTHENTICATED, NOT_FOUND, 401…) — what may
// NOT vary is the presence of requestId in the envelope.
const MODULE_ROUTES: Array<{ module: string; path: string; init: RequestInit }> = [
  { module: 'handlers (publish)', path: '/v1/publish', init: { method: 'POST', body: 'not json' } },
  { module: 'handlers (handshake)', path: '/v1/handshake', init: { method: 'POST', body: 'not json' } },
  { module: 'run-report', path: '/v1/fleet/run-report', init: { method: 'POST', body: 'not json' } },
  { module: 'harbors', path: '/v1/harbors', init: { method: 'GET' } },
  { module: 'presence', path: '/v1/harbors/alice/dock/presence', init: { method: 'GET' } },
  { module: 'parleys', path: '/v1/harbors/alice/dock/parleys', init: { method: 'GET' } },
  { module: 'mediator-body', path: '/v1/mediator/convene', init: { method: 'POST', body: 'not json' } },
  { module: 'interruptions', path: '/v1/interruptions', init: { method: 'POST', body: '{}' } },
  { module: 'fleet-control', path: '/v1/fleet/config', init: { method: 'GET' } },
  { module: 'billing (quotas)', path: '/v1/quotas/not-a-fingerprint', init: { method: 'GET' } },
  { module: 'router (404)', path: '/no/such/route', init: { method: 'GET' } },
];

describe('requestId on error envelopes — across threaded modules', () => {
  for (const r of MODULE_ROUTES) {
    it(`${r.module}: ${r.init.method} ${r.path} carries requestId + X-Request-Id`, async () => {
      const { db } = makeNullDb();
      const res = await hit(r.path, r.init, makeEnv(db));
      expect(res.status).toBeGreaterThanOrEqual(400);
      const headerId = res.headers.get('X-Request-Id');
      expect(headerId).toMatch(RID);
      const body = (await res.json()) as { code?: string; error?: unknown; requestId?: string };
      expect(typeof body.code).toBe('string');
      expect(body.requestId).toBe(headerId);
    });
  }

  it('the global INTERNAL_ERROR boundary carries requestId too', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('D1 exploded');
      },
    } as unknown as D1Database;
    const res = await hit('/v1/chain-head/some-sender/some-channel', { method: 'GET' }, makeEnv(throwingDb));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; requestId: string };
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.requestId).toMatch(RID);
    expect(body.requestId).toBe(res.headers.get('X-Request-Id'));
  });

  it('mints a FRESH id per request', async () => {
    const { db } = makeNullDb();
    const env = makeEnv(db);
    const a = await hit('/no/such/route', { method: 'GET' }, env);
    const b = await hit('/no/such/route', { method: 'GET' }, env);
    expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'));
  });

  it('success responses get the header but the body passes through untouched', async () => {
    const { db } = makeNullDb();
    const res = await hit('/health', { method: 'GET' }, makeEnv(db));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toMatch(RID);
    expect(await res.json()).toEqual({ status: 'ok', version: '0.0.0-test' });
  });

  it('CORS preflight receives a request id and one SLO sample too', async () => {
    const { db, sloInserts } = makeNullDb();
    const ctx = makeCtx();
    const res = await hit('/v1/publish', { method: 'OPTIONS' }, makeEnv(db), ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get('X-Request-Id')).toMatch(RID);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
    expect(ctx.waited).toHaveLength(1);
    await Promise.all(ctx.waited);
    expect(sloInserts).toHaveLength(1);
    expect(sloInserts[0]!.args[1]).toBe(0);
  });
});

describe('SLO burn sampling at the boundary', () => {
  it('records one sample per request via ctx.waitUntil; a 4xx is NOT an error sample', async () => {
    const { db, sloInserts } = makeNullDb();
    const ctx = makeCtx();
    await hit('/no/such/route', { method: 'GET' }, makeEnv(db), ctx);
    await Promise.all(ctx.waited);
    expect(sloInserts).toHaveLength(1);
    // (window_start, isError) — 404 is availability-neutral.
    expect(sloInserts[0]!.args[1]).toBe(0);
  });

  it('counts a 5xx as an error sample', async () => {
    const { sloInserts, db: captureDb } = makeNullDb();
    // Throw on everything EXCEPT the SLO insert, so the request 500s but the
    // sample still lands in the capture.
    const db = {
      prepare(sql: string) {
        if (sql.includes('INSERT INTO mercy_slo_windows')) return (captureDb as unknown as { prepare(s: string): unknown }).prepare(sql);
        throw new Error('D1 exploded');
      },
    } as unknown as D1Database;
    const ctx = makeCtx();
    const res = await hit('/v1/chain-head/s/c', { method: 'GET' }, makeEnv(db), ctx);
    expect(res.status).toBe(500);
    await Promise.all(ctx.waited);
    expect(sloInserts).toHaveLength(1);
    expect(sloInserts[0]!.args[1]).toBe(1);
  });

  it('a bare-object ctx without waitUntil cannot break the response', async () => {
    const { db } = makeNullDb();
    const res = await worker.fetch(
      new Request(`${BASE}/health`, { method: 'GET' }),
      makeEnv(db),
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
  });
});
