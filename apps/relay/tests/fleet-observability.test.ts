/**
 * Tests for the fleet observability + kill-switch API (src/fleet-observability.ts).
 *
 * Coverage:
 *   - fleet operator gate: every endpoint rejects a missing/wrong token (401).
 *   - activity: returns rows newest-first, each carrying pr_url, short headSha,
 *     and a ships array; honours + clamps the ?limit param.
 *   - runs/:id: returns the run + its ordered transcript steps (detail JSON
 *     re-hydrated); 404 for an unknown id.
 *   - pause: rejects a non-boolean body (BAD_JSON); writes the KV flag; and
 *     health reflects the toggle (paused true/false) + last-run age.
 */

import { describe, it, expect } from 'vitest';
import {
  handleFleetActivity,
  handleFleetRun,
  handleFleetHealth,
  handleFleetPause,
  handleDeleteFleetRun,
} from '../src/fleet-observability.js';
import { fleetControlRequest } from '../src/fleet-pause-control.js';
import { setFleetPaused } from '../src/db.js';
import { memoryFleetControl } from './fleet-control-fixture.js';
import type { Env } from '../src/types.js';

// >= 32 chars: operatorOnly() fail-closes (500 MISCONFIGURED) below the minimum.
const OPERATOR = 'super-secret-operator-token-32bytes-min';
const ACCOUNT_TOKEN = `pdu_${'a'.repeat(64)}`;
const ACCOUNT_USER_ID = 'u_owner';
const ACCOUNT_GITHUB_USER_ID = 2_093_678;

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeKV(seed: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

// D1 mock driven by callbacks keyed on the SQL text.
function makeMockD1(handlers: {
  onFirst?: (query: string, bound: unknown[]) => unknown;
  onAll?: (query: string, bound: unknown[]) => unknown[];
  onRun?: (query: string, bound: unknown[]) => void | number;
}): D1Database {
  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) { bound = vals; return stmt; },
      async first<T>(): Promise<T | null> {
        return (handlers.onFirst?.(query, bound) ?? null) as T | null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: (handlers.onAll?.(query, bound) ?? []) as T[] };
      },
      async run() { const changes = handlers.onRun?.(query, bound); return { success: true, meta: { changes: typeof changes === 'number' ? changes : 0 } }; },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return {
    prepare: stmtFor,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function makeEnv(o: {
  db?: D1Database;
  kv?: KVNamespace;
  operatorToken?: string;
  operatorGithubUserId?: string;
} = {}): Env {
  const kv = o.kv ?? makeKV();
  return {
    DB: o.db ?? makeMockD1({}),
    HARBOR_CHANNEL: {} as unknown as DurableObjectNamespace,
    FLEET_CONTROL: memoryFleetControl(undefined, kv).namespace,
    KV: kv,
    RELAY_OPERATOR_TOKEN: o.operatorToken ?? OPERATOR,
    RELAY_OPERATOR_GITHUB_USER_ID: o.operatorGithubUserId,
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

function req(path: string, method: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request(`https://relay.example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function accountAuthFirst(query: string): unknown {
  if (query.includes('FROM user_tokens')) {
    return { user_id: ACCOUNT_USER_ID, expires_at: null, revoked_at: null };
  }
  if (query.includes('FROM users WHERE id')) {
    return {
      id: ACCOUNT_USER_ID,
      github_user_id: ACCOUNT_GITHUB_USER_ID,
      login: 'erichowens',
      display_name: null,
      avatar_url: null,
      primary_email: null,
      email_verified: 0,
      created_at: 1,
      last_login_at: 1,
      deleted_at: null,
    };
  }
  if (query.includes('FROM user_roles')) return { allowed: 1 };
  return null;
}

// Two runs as the DB would store them (newest first — listFleetRuns ORDER BY).
const RUN_NEW = {
  id: 'run-new',
  delivery_id: 'delivery-new',
  repo_full_name: 'curiositech/port-daddy',
  pr_number: 202,
  pr_url: 'https://github.com/curiositech/port-daddy/pull/202',
  head_sha: 'abcdef1234567890',
  conclusion: 'success',
  ships_csv: 'linter,qa',
  neurons: null,
  ms: 45000,
  created_at: 1719432100,
};
const RUN_OLD = {
  id: 'run-old',
  delivery_id: 'delivery-old',
  repo_full_name: 'curiositech/port-daddy',
  pr_number: 101,
  pr_url: 'https://github.com/curiositech/port-daddy/pull/101',
  head_sha: '0123456789abcdef',
  conclusion: 'failure',
  ships_csv: 'linter',
  neurons: null,
  ms: 12000,
  created_at: 1719431000,
};

// ── break-glass operator gate (all endpoints) ────────────────────────────────

describe('fleet observability — operator gate', () => {
  it('every endpoint returns 401 without an operator token', async () => {
    const env = makeEnv();
    const calls: Array<Promise<Response>> = [
      handleFleetActivity(req('/v1/fleet/activity', 'GET', null), env),
      handleFleetRun(req('/v1/fleet/runs/run-new', 'GET', null), env, 'run-new'),
      handleFleetHealth(req('/v1/fleet/health', 'GET', null), env),
      handleFleetPause(req('/v1/fleet/pause', 'POST', null, { paused: true }), env),
    ];
    for (const p of calls) {
      const res = await p;
      expect(res.status).toBe(401);
      expect(await res.text()).toContain('UNAUTHORIZED');
    }
  });

  it('every endpoint returns 401 with a wrong operator token', async () => {
    const env = makeEnv();
    const res = await handleFleetActivity(req('/v1/fleet/activity', 'GET', 'nope'), env);
    expect(res.status).toBe(401);
  });

  it('lets the configured signed-in owner read activity with an existing pdu token', async () => {
    let roleGranted = false;
    const db = makeMockD1({
      onFirst: (q) => {
        if (q.includes('FROM user_tokens')) {
          return { user_id: 'u_owner', expires_at: null, revoked_at: null };
        }
        if (q.includes('FROM users WHERE id')) {
          return {
            id: 'u_owner',
            github_user_id: 2_093_678,
            login: 'erichowens',
            display_name: null,
            avatar_url: null,
            primary_email: null,
            email_verified: 0,
            created_at: 1,
            last_login_at: 1,
            deleted_at: null,
          };
        }
        if (q.includes('FROM user_roles')) return roleGranted ? { allowed: 1 } : null;
        return null;
      },
      onAll: () => [],
      onRun: (q) => {
        if (q.includes('INSERT INTO user_roles')) roleGranted = true;
      },
    });
    const response = await handleFleetActivity(
      req('/v1/fleet/activity', 'GET', ACCOUNT_TOKEN),
      makeEnv({ db, operatorGithubUserId: '2093678' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: 'OK', runs: [] });
    expect(roleGranted).toBe(true);
  });

  it('does not rewrite token usage metadata during repeated account-backed polls', async () => {
    const writes: string[] = [];
    const db = makeMockD1({
      onFirst: (q) => accountAuthFirst(q),
      onAll: () => [],
      onRun: (q) => { writes.push(q); },
    });
    const env = makeEnv({ db });

    expect((await handleFleetActivity(req('/v1/fleet/activity', 'GET', ACCOUNT_TOKEN), env)).status).toBe(200);
    expect((await handleFleetHealth(req('/v1/fleet/health', 'GET', ACCOUNT_TOKEN), env)).status).toBe(200);
    expect((await handleFleetActivity(req('/v1/fleet/activity', 'GET', ACCOUNT_TOKEN), env)).status).toBe(200);
    expect((await handleFleetHealth(req('/v1/fleet/health', 'GET', ACCOUNT_TOKEN), env)).status).toBe(200);

    expect(writes.some((query) => query.includes('UPDATE user_tokens'))).toBe(false);
  });
});

// ── GET /v1/fleet/activity ──────────────────────────────────────────────────

describe('handleFleetActivity', () => {
  it('returns runs newest-first with pr_url, short headSha, and ships array', async () => {
    const db = makeMockD1({
      onAll: (q, bound) => {
        if (q.includes('FROM fleet_run_intents')) return [];
        expect(q).toContain('FROM fleet_runs');
        expect(q).toContain('ORDER BY created_at DESC');
        expect(bound[0]).toBe(50); // default limit
        return [RUN_NEW, RUN_OLD]; // DB already returns newest-first
      },
    });
    const res = await handleFleetActivity(req('/v1/fleet/activity', 'GET', OPERATOR), makeEnv({ db }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      code: string;
      runs: Array<{ id: string; prUrl: string; headSha: string; ships: string[]; prNumber: number }>;
    };
    expect(json.code).toBe('OK');
    expect(json.runs).toHaveLength(2);
    expect(json.runs[0]!.id).toBe('run-new');
    expect(json.runs[1]!.id).toBe('run-old');
    expect(json.runs[0]!.prUrl).toBe('https://github.com/curiositech/port-daddy/pull/202');
    expect(json.runs[0]!.headSha).toBe('abcdef1'); // short SHA (7)
    expect(json.runs[0]!.ships).toEqual(['linter', 'qa']);
    expect(json.runs[0]!.prNumber).toBe(202);
  });

  it('clamps the ?limit param to 500', async () => {
    const db = makeMockD1({
      onAll: (_q, bound) => {
        if (_q.includes('FROM fleet_run_intents')) {
          expect(bound[0]).toBe(500);
          return [];
        }
        expect(bound[0]).toBe(500);
        return [];
      },
    });
    const res = await handleFleetActivity(
      req('/v1/fleet/activity?limit=99999', 'GET', OPERATOR),
      makeEnv({ db }),
    );
    expect(res.status).toBe(200);
  });

  it('honours a valid ?limit param', async () => {
    const db = makeMockD1({
      onAll: (_q, bound) => {
        if (_q.includes('FROM fleet_run_intents')) {
          expect(bound[0]).toBe(500);
          return [];
        }
        expect(bound[0]).toBe(5);
        return [];
      },
    });
    const res = await handleFleetActivity(
      req('/v1/fleet/activity?limit=5', 'GET', OPERATOR),
      makeEnv({ db }),
    );
    expect(res.status).toBe(200);
  });
});

// ── GET /v1/fleet/runs/:id ──────────────────────────────────────────────────

describe('handleFleetRun', () => {
  const STEPS = [
    { run_id: 'run-new', seq: 0, kind: 'map-chunk', ship: 'linter', title: 'MAP chunk 1/2', detail: '{"chunkIndex":0,"chunkCount":2}', created_at: 1719432101 },
    { run_id: 'run-new', seq: 1, kind: 'reduce', ship: 'linter', title: 'REDUCE pd-linter', detail: '{"chunkCount":2}', created_at: 1719432102 },
    { run_id: 'run-new', seq: 2, kind: 'ship-verdict', ship: 'linter', title: 'pd-linter: PASS', detail: '[{"path":"main.ts","line":10,"severity":"HIGH","body":"x"}]', created_at: 1719432103 },
    { run_id: 'run-new', seq: 3, kind: 'check-completed', ship: null, title: 'Check concluded: success', detail: '{"conclusion":"success"}', created_at: 1719432104 },
  ];

  it('returns the run + ordered transcript with re-hydrated detail JSON', async () => {
    const db = makeMockD1({
      onFirst: (q, bound) => {
        if (q.includes('FROM fleet_run_intents')) return null;
        expect(q).toContain('FROM fleet_runs WHERE id = ?');
        expect(bound[0]).toBe('run-new');
        return RUN_NEW;
      },
      onAll: (q, bound) => {
        expect(q).toContain('FROM fleet_run_steps');
        expect(q).toContain('ORDER BY seq ASC');
        expect(bound[0]).toBe('run-new');
        return STEPS;
      },
    });
    const res = await handleFleetRun(req('/v1/fleet/runs/run-new', 'GET', OPERATOR), makeEnv({ db }), 'run-new');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      code: string;
      run: { id: string; prUrl: string; headSha: string; ships: string[] };
      steps: Array<{ seq: number; kind: string; ship: string | null; detail: unknown }>;
    };
    expect(json.code).toBe('OK');
    expect(json.run.id).toBe('run-new');
    expect(json.run.headSha).toBe('abcdef1234567890'); // full SHA on detail view
    expect(json.run.ships).toEqual(['linter', 'qa']);
    expect(json.steps.map((s) => s.seq)).toEqual([0, 1, 2, 3]);
    expect(json.steps[0]!.detail).toEqual({ chunkIndex: 0, chunkCount: 2 });
    expect(json.steps[2]!.detail).toEqual([{ path: 'main.ts', line: 10, severity: 'HIGH', body: 'x' }]);
    expect(json.steps[3]!.ship).toBeNull();
  });

  it('returns 404 for an unknown run id', async () => {
    const db = makeMockD1({ onFirst: () => null });
    const res = await handleFleetRun(req('/v1/fleet/runs/ghost', 'GET', OPERATOR), makeEnv({ db }), 'ghost');
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('NOT_FOUND');
  });

  it('rejects malformed run ids before reading D1', async () => {
    let dbTouched = false;
    const db = makeMockD1({
      onFirst: () => {
        dbTouched = true;
        return RUN_NEW;
      },
      onAll: () => {
        dbTouched = true;
        return STEPS;
      },
    });

    const res = await handleFleetRun(req('/v1/fleet/runs/..%2Frun-new', 'GET', OPERATOR), makeEnv({ db }), '../run-new');

    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('BAD_REQUEST');
    expect(dbTouched).toBe(false);
  });
});

// ── POST /v1/fleet/pause + GET /v1/fleet/health ──────────────────────────────

describe('handleFleetPause + handleFleetHealth', () => {
  it('rejects a non-boolean body with BAD_JSON', async () => {
    const res = await handleFleetPause(req('/v1/fleet/pause', 'POST', OPERATOR, { paused: 'yes' }), makeEnv());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('BAD_JSON');
  });

  it('pausing commits control and health reflects its durable revision', async () => {
    const kv = makeKV();
    const db = makeMockD1({ onFirst: () => null /* no runs yet */ });
    const env = makeEnv({ kv, db });

    const pauseRes = await handleFleetPause(req('/v1/fleet/pause', 'POST', OPERATOR, { paused: true }), env);
    expect(pauseRes.status).toBe(200);
    const pauseJson = (await pauseRes.json()) as { ok: boolean; paused: boolean };
    expect(pauseJson).toMatchObject({ ok: true, paused: true });

    // The eventually consistent cache is a deny-only rollback projection for
    // old executors. The Durable Object revision remains admission authority.
    const raw = await kv.get('fleet:paused');
    expect(JSON.parse(raw!)).toMatchObject({ paused: true, revision: 1 });
    expect(pauseJson).toMatchObject({ pauseStatus: 'paused', pauseRevision: 1 });

    const healthRes = await handleFleetHealth(req('/v1/fleet/health', 'GET', OPERATOR), env);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      code: string; paused: boolean; lastRunAgeSec: number | null; queueDepthEstimate: null;
    };
    expect(health.code).toBe('OK');
    expect(health.paused).toBe(true);
    expect(health.lastRunAgeSec).toBeNull(); // no runs
    expect(health.queueDepthEstimate).toBeNull();
  });

  it('orders rollback projection around canonical pause and resume authority', async () => {
    const events: string[] = [];
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        const projection = JSON.parse(value) as { paused: boolean; revision?: number };
        events.push(`kv:${projection.paused}:${projection.revision ?? 'pending'}`);
        store.set(key, value);
      },
      delete: async (key: string) => void store.delete(key),
    } as unknown as KVNamespace;
    const durable = memoryFleetControl(undefined, kv);
    const control = {
      idFromName: (name: string) => durable.namespace.idFromName(name),
      get: (id: DurableObjectId) => {
        const stub = durable.namespace.get(id);
        return {
          fetch: async (request: Request) => {
            events.push('do');
            return stub.fetch(request);
          },
        };
      },
    } as unknown as DurableObjectNamespace;
    const env = makeEnv({ kv });
    env.FLEET_CONTROL = control;

    expect((await handleFleetPause(
      req('/v1/fleet/pause', 'POST', OPERATOR, { paused: true }),
      env,
    )).status).toBe(200);
    expect(events).toEqual(['do', 'kv:true:1']);

    events.length = 0;
    expect((await handleFleetPause(
      req('/v1/fleet/pause', 'POST', OPERATOR, {
        paused: false,
        expectedRevision: 1,
        requestId: 'ordered-resume',
      }),
      env,
    )).status).toBe(200);
    expect(events).toEqual(['do', 'kv:false:2']);
  });

  it('keeps concurrent resume callers and the rollback projection on one ON revision', async () => {
    const store = new Map([['fleet:paused', JSON.stringify({ paused: true, pausedAt: 1, revision: 1 })]]);
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => void store.set(key, value),
    } as unknown as KVNamespace;
    const control = memoryFleetControl({ paused: true, revision: 1, pausedAt: 1 }, kv);
    const env = { FLEET_CONTROL: control.namespace, KV: kv };

    const [first, second] = await Promise.all([
      setFleetPaused(env, false, { expectedRevision: 1, requestId: 'concurrent-a' }),
      setFleetPaused(env, false, { expectedRevision: 1, requestId: 'concurrent-b' }),
    ]);

    expect(first).toMatchObject({ status: 'unpaused', revision: 2 });
    expect(second).toMatchObject({ status: 'unpaused', revision: 2 });
    expect(JSON.parse(store.get('fleet:paused')!))
      .toMatchObject({ paused: false, revision: 2 });
  });

  it('serializes a newer control write behind the in-flight projection mutation', async () => {
    const store = new Map([['fleet:paused', JSON.stringify({ paused: true, pausedAt: 1, revision: 1 })]]);
    let releaseProjection!: () => void;
    let projectionReached!: () => void;
    const projectionGate = new Promise<void>((resolve) => { releaseProjection = resolve; });
    const reachedGate = new Promise<void>((resolve) => { projectionReached = resolve; });
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        const projection = JSON.parse(value) as { paused: boolean; revision: number };
        if (!projection.paused && projection.revision === 2) {
          projectionReached();
          await projectionGate;
        }
        store.set(key, value);
      },
    } as unknown as KVNamespace;
    const control = memoryFleetControl({ paused: true, revision: 1, pausedAt: 1 }, kv);
    const env = { FLEET_CONTROL: control.namespace, KV: kv };

    const firstResume = setFleetPaused(env, false, {
      expectedRevision: 1,
      requestId: 'blocked-projection-resume',
    });
    await reachedGate;
    let pauseSettled = false;
    const newerPause = setFleetPaused(env, true).finally(() => { pauseSettled = true; });
    await Promise.resolve();
    expect(pauseSettled).toBe(false);

    releaseProjection();
    expect(await firstResume).toMatchObject({ status: 'unpaused', revision: 2 });
    expect(await newerPause).toMatchObject({ status: 'paused', revision: 3 });
    expect(await setFleetPaused(env, false, {
      expectedRevision: 3,
      requestId: 'newer-serialized-resume',
    })).toMatchObject({ status: 'unpaused', revision: 4 });
    expect(JSON.parse(store.get('fleet:paused')!))
      .toMatchObject({ paused: false, revision: 4 });
  });

  it('does not let a delayed stale resume overwrite a newer acknowledged ON projection', async () => {
    const store = new Map([['fleet:paused', JSON.stringify({ paused: true, pausedAt: 1, revision: 1 })]]);
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => void store.set(key, value),
    } as unknown as KVNamespace;
    const durable = memoryFleetControl({ paused: true, revision: 1, pausedAt: 1 }, kv);
    let releaseStale!: () => void;
    let staleCommitReached!: () => void;
    const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
    const reachedGate = new Promise<void>((resolve) => { staleCommitReached = resolve; });
    const namespace = {
      idFromName: (name: string) => durable.namespace.idFromName(name),
      get: (id: DurableObjectId) => {
        const stub = durable.namespace.get(id);
        return {
          fetch: async (request: Request) => {
            if (new URL(request.url).pathname === '/mutate') {
              const body = await request.clone().json() as { requestId?: string };
              if (body.requestId === 'stale-resume') {
                staleCommitReached();
                await staleGate;
              }
            }
            return stub.fetch(request);
          },
        };
      },
    } as unknown as DurableObjectNamespace;
    const env = { FLEET_CONTROL: namespace, KV: kv };

    const stale = setFleetPaused(env, false, {
      expectedRevision: 1,
      requestId: 'stale-resume',
    });
    await reachedGate;
    expect(await setFleetPaused(env, true)).toMatchObject({ status: 'paused', revision: 2 });
    expect(await setFleetPaused(env, false, {
      expectedRevision: 2,
      requestId: 'newer-resume',
    })).toMatchObject({ status: 'unpaused', revision: 3 });
    releaseStale();

    await expect(stale).rejects.toThrow('revision-changed');
    expect(await fleetControlRequest(namespace, '/read'))
      .toMatchObject({ status: 'unpaused', revision: 3 });
    expect(JSON.parse(store.get('fleet:paused')!))
      .toMatchObject({ paused: false, revision: 3 });
  });

  it('does not mutate canonical control when the legacy pause denial cannot be written', async () => {
    const kv = {
      get: async () => null,
      put: async () => { throw new Error('KV unavailable'); },
    } as unknown as KVNamespace;
    const control = memoryFleetControl(undefined, kv);
    const env = makeEnv({ kv });
    env.FLEET_CONTROL = control.namespace;

    const response = await handleFleetPause(
      req('/v1/fleet/pause', 'POST', OPERATOR, { paused: true }),
      env,
    );
    expect(response.status).toBe(500);
    expect(await fleetControlRequest(control.namespace, '/read'))
      .toMatchObject({ status: 'unknown' });
  });

  it('preserves the local deny projection when canonical pause mutation fails afterward', async () => {
    const store = new Map<string, string>();
    let writes = 0;
    const env = makeEnv({
      kv: {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => {
          writes += 1;
          store.set(key, value);
        },
      } as unknown as KVNamespace,
    });
    const control = memoryFleetControl(undefined, env.KV);
    control.faults.failControlPut = true;
    env.FLEET_CONTROL = control.namespace;

    const response = await handleFleetPause(
      req('/v1/fleet/pause', 'POST', OPERATOR, { paused: true }),
      env,
    );
    expect(response.status).toBe(500);
    expect(writes).toBe(1);
    expect(JSON.parse(store.get('fleet:paused')!)).toMatchObject({ paused: true });
  });

  it('keeps execution blocked and makes the same resume repairable when its projection write fails', async () => {
    const store = new Map([['fleet:paused', JSON.stringify({ paused: true, pausedAt: 1, revision: 1 })]]);
    let failedResumeWrites = 0;
    let rejectResumeProjection = true;
    const env = makeEnv({
      kv: {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => {
          const projection = JSON.parse(value) as { paused?: unknown };
          if (projection.paused === false && rejectResumeProjection) {
            failedResumeWrites += 1;
            throw new Error('legacy projection unavailable');
          }
          store.set(key, value);
        },
      } as unknown as KVNamespace,
    });
    const control = memoryFleetControl({ paused: true, revision: 1, pausedAt: 1 }, env.KV);
    env.FLEET_CONTROL = control.namespace;

    const resume = await handleFleetPause(req('/v1/fleet/pause', 'POST', OPERATOR, {
      paused: false,
      expectedRevision: 1,
      requestId: 'failed-resume-readback',
    }), env);
    expect(resume.status).toBe(409);
    expect(failedResumeWrites).toBe(1);

    const health = await handleFleetHealth(req('/v1/fleet/health', 'GET', OPERATOR), env);
    expect(await health.json()).toMatchObject({
      paused: null,
      pauseStatus: 'unknown',
      pauseRevision: null,
      automationBlocked: true,
    });
    expect(await fleetControlRequest(control.namespace, '/read')).toMatchObject({
      status: 'unpaused',
      revision: 2,
    });

    const blockedProjection = JSON.parse(store.get('fleet:paused')!) as {
      paused: boolean; revision: number;
    };
    expect(blockedProjection).toMatchObject({ paused: true, revision: 1 });

    rejectResumeProjection = false;
    expect(await setFleetPaused(env, false, {
      expectedRevision: 1,
      requestId: 'failed-resume-readback',
    })).toMatchObject({ status: 'unpaused', revision: 2 });
    expect(JSON.parse(store.get('fleet:paused')!)).toMatchObject({ paused: false, revision: 2 });
  });

  it('health reports unknown for absent authority despite an old KV unpaused value', async () => {
    const env = makeEnv({ kv: makeKV({ 'fleet:paused': 'false' }) });
    env.FLEET_CONTROL = undefined;
    const response = await handleFleetHealth(req('/v1/fleet/health', 'GET', OPERATOR), env);
    expect(await response.json()).toMatchObject({ paused: null, pauseStatus: 'unknown', automationBlocked: true });
  });

  it('health reports unknown when canonical ON lacks a readable rollout projection', async () => {
    const env = makeEnv({ kv: makeKV() });
    env.FLEET_CONTROL = memoryFleetControl({
      paused: false,
      revision: 7,
      pausedAt: 1,
    }).namespace;
    const response = await handleFleetHealth(req('/v1/fleet/health', 'GET', OPERATOR), env);
    expect(await response.json()).toMatchObject({
      paused: null,
      pauseStatus: 'unknown',
      pauseRevision: null,
      automationBlocked: true,
    });
  });

  it('health reports unknown when canonical OFF disagrees with an unpaused projection', async () => {
    const kv = makeKV({
      'fleet:paused': JSON.stringify({ paused: false, revision: 6, pausedAt: 1 }),
    });
    const env = makeEnv({ kv });
    env.FLEET_CONTROL = memoryFleetControl({
      paused: true,
      revision: 7,
      pausedAt: 2,
    }, kv).namespace;

    const response = await handleFleetHealth(req('/v1/fleet/health', 'GET', OPERATOR), env);
    expect(await response.json()).toMatchObject({
      paused: null,
      pauseStatus: 'unknown',
      pauseRevision: null,
      automationBlocked: true,
    });
  });

  it('health reports unknown when projection value matches but its revision is stale', async () => {
    const kv = makeKV({
      'fleet:paused': JSON.stringify({ paused: true, revision: 6, pausedAt: 1 }),
    });
    const env = makeEnv({ kv });
    env.FLEET_CONTROL = memoryFleetControl({
      paused: true,
      revision: 7,
      pausedAt: 2,
    }, kv).namespace;

    const response = await handleFleetHealth(req('/v1/fleet/health', 'GET', OPERATOR), env);
    expect(await response.json()).toMatchObject({
      paused: null,
      pauseStatus: 'unknown',
      pauseRevision: null,
      automationBlocked: true,
    });
  });

  it('resuming flips the flag back and health reflects paused=false + last-run age', async () => {
    const now = Math.floor(Date.now() / 1000);
    const kv = makeKV({ 'fleet:paused': JSON.stringify({ paused: true, pausedAt: now - 10 }) });
    const db = makeMockD1({
      onFirst: (q) => {
        if (q.includes('FROM fleet_run_intents')) {
          return {
            known: 0,
            queued: 0,
            running: 0,
            retrying: 0,
            superseded: 0,
            failed_admission: 0,
            oldest_queued_at: null,
          };
        }
        expect(q).toContain('ORDER BY created_at DESC LIMIT 1');
        return { created_at: now - 30 };
      },
    });
    const env = makeEnv({ kv, db });

    await handleFleetPause(req('/v1/fleet/pause', 'POST', OPERATOR, { paused: true }), env);
    const resumeRes = await handleFleetPause(req('/v1/fleet/pause', 'POST', OPERATOR, { paused: false, expectedRevision: 1, requestId: 'resume-test' }), env);
    expect(resumeRes.status).toBe(200);
    expect(((await resumeRes.json()) as { paused: boolean }).paused).toBe(false);
    expect(JSON.parse((await kv.get('fleet:paused'))!)).toMatchObject({ paused: false, revision: 2 });

    const healthRes = await handleFleetHealth(req('/v1/fleet/health', 'GET', OPERATOR), env);
    const health = (await healthRes.json()) as { paused: boolean; lastRunAgeSec: number | null };
    expect(health.paused).toBe(false);
    expect(health.lastRunAgeSec).not.toBeNull();
    expect(health.lastRunAgeSec!).toBeGreaterThanOrEqual(30);
  });

  it('attributes account-backed pause and resume audits without recording token material', async () => {
    const kv = makeKV();
    const auditDetails: string[] = [];
    const db = makeMockD1({
      onFirst: (q) => accountAuthFirst(q),
      onRun: (q, bound) => {
        if (q.includes('INSERT INTO audit_log')) auditDetails.push(String(bound[4]));
      },
    });
    const env = makeEnv({ kv, db });

    expect((await handleFleetPause(
      req('/v1/fleet/pause', 'POST', ACCOUNT_TOKEN, { paused: true }),
      env,
    )).status).toBe(200);
    expect((await handleFleetPause(
      req('/v1/fleet/pause', 'POST', ACCOUNT_TOKEN, { paused: false, expectedRevision: 1, requestId: 'account-resume' }),
      env,
    )).status).toBe(200);

    expect(auditDetails.map((detail) => JSON.parse(detail))).toEqual([
      {
        source: 'account',
        operation: 'pause',
        actor: { userId: ACCOUNT_USER_ID, githubUserId: ACCOUNT_GITHUB_USER_ID },
      },
      {
        source: 'account',
        operation: 'resume',
        actor: { userId: ACCOUNT_USER_ID, githubUserId: ACCOUNT_GITHUB_USER_ID },
      },
    ]);
    expect(auditDetails.join('\n')).not.toContain(ACCOUNT_TOKEN);
  });
});

// ── DELETE /v1/fleet/runs/:id (ADR-0101 export/delete per-tier) ────────────────

describe('handleDeleteFleetRun', () => {
  it('rejects without the operator token (401)', async () => {
    const res = await handleDeleteFleetRun(req('/v1/fleet/runs/run-new', 'DELETE', null), makeEnv(), 'run-new');
    expect(res.status).toBe(401);
  });

  it('deletes steps + run and reports the count', async () => {
    const seen: string[] = [];
    const db = makeMockD1({
      onRun: (q) => {
        if (q.includes('DELETE FROM fleet_run_steps')) { seen.push('steps'); return 1; }
        if (q.includes('DELETE FROM fleet_runs')) { seen.push('run'); return 1; }
        return 0;
      },
    });
    const res = await handleDeleteFleetRun(req('/v1/fleet/runs/run-new', 'DELETE', OPERATOR), makeEnv({ db }), 'run-new');
    expect(res.status).toBe(200);
    expect((await res.json() as { deleted: number }).deleted).toBe(1);
    expect(seen).toEqual(['steps', 'run']); // transcript rows removed before the header
  });

  it('404s an unknown run id', async () => {
    const db = makeMockD1({ onRun: () => 0 }); // no rows changed
    const res = await handleDeleteFleetRun(req('/v1/fleet/runs/nope', 'DELETE', OPERATOR), makeEnv({ db }), 'nope');
    expect(res.status).toBe(404);
  });

  it('deletes an intent-only receipt without requiring a transcript row', async () => {
    const seen: string[] = [];
    const db = makeMockD1({
      onFirst: (q) => q.includes('SELECT * FROM fleet_run_intents')
        ? { delivery_id: 'delivery-queued', state: 'queued' }
        : null,
      onRun: (q) => {
        if (q.includes('DELETE FROM fleet_run_intents')) { seen.push('intent'); return 1; }
        return 0;
      },
    });
    const res = await handleDeleteFleetRun(
      req('/v1/fleet/runs/intent:delivery-queued', 'DELETE', OPERATOR),
      makeEnv({ db }),
      'intent:delivery-queued',
    );
    expect(res.status).toBe(200);
    expect((await res.json() as { deleted: number }).deleted).toBe(1);
    expect(seen).toEqual(['intent']);
  });

  it('attributes an account-backed transcript deletion without recording token material', async () => {
    let auditDetail = '';
    const db = makeMockD1({
      onFirst: (q) => accountAuthFirst(q),
      onRun: (q, bound) => {
        if (q.includes('DELETE FROM fleet_runs')) return 1;
        if (q.includes('INSERT INTO audit_log')) auditDetail = String(bound[4]);
        return 0;
      },
    });

    const res = await handleDeleteFleetRun(
      req('/v1/fleet/runs/run-new', 'DELETE', ACCOUNT_TOKEN),
      makeEnv({ db }),
      'run-new',
    );

    expect(res.status).toBe(200);
    expect(JSON.parse(auditDetail)).toEqual({
      source: 'account',
      operation: 'delete-run',
      actor: { userId: ACCOUNT_USER_ID, githubUserId: ACCOUNT_GITHUB_USER_ID },
    });
    expect(auditDetail).not.toContain(ACCOUNT_TOKEN);
  });
});
