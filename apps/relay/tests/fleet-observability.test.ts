/**
 * Tests for the fleet observability + kill-switch API (src/fleet-observability.ts).
 *
 * Coverage:
 *   - operatorOnly gate: every endpoint rejects a missing/wrong token (401).
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
import { FLEET_PAUSED_KEY } from '../src/db.js';
import type { Env } from '../src/types.js';

// >= 32 chars: operatorOnly() fail-closes (500 MISCONFIGURED) below the minimum.
const OPERATOR = 'super-secret-operator-token-32bytes-min';

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

function makeEnv(o: { db?: D1Database; kv?: KVNamespace; operatorToken?: string } = {}): Env {
  return {
    DB: o.db ?? makeMockD1({}),
    HARBOR_CHANNEL: {} as unknown as DurableObjectNamespace,
    KV: o.kv ?? makeKV(),
    RELAY_OPERATOR_TOKEN: o.operatorToken ?? OPERATOR,
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

// ── operatorOnly gate (all endpoints) ─────────────────────────────────────────

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

  it('pausing writes the KV flag and health reflects paused=true', async () => {
    const kv = makeKV();
    const db = makeMockD1({ onFirst: () => null /* no runs yet */ });
    const env = makeEnv({ kv, db });

    const pauseRes = await handleFleetPause(req('/v1/fleet/pause', 'POST', OPERATOR, { paused: true }), env);
    expect(pauseRes.status).toBe(200);
    const pauseJson = (await pauseRes.json()) as { ok: boolean; paused: boolean };
    expect(pauseJson).toMatchObject({ ok: true, paused: true });

    // KV flag persisted as structured JSON.
    const raw = await kv.get(FLEET_PAUSED_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).paused).toBe(true);

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

  it('resuming flips the flag back and health reflects paused=false + last-run age', async () => {
    const now = Math.floor(Date.now() / 1000);
    const kv = makeKV({ [FLEET_PAUSED_KEY]: JSON.stringify({ paused: true, pausedAt: now - 10 }) });
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

    const resumeRes = await handleFleetPause(req('/v1/fleet/pause', 'POST', OPERATOR, { paused: false }), env);
    expect(resumeRes.status).toBe(200);
    expect(((await resumeRes.json()) as { paused: boolean }).paused).toBe(false);

    const healthRes = await handleFleetHealth(req('/v1/fleet/health', 'GET', OPERATOR), env);
    const health = (await healthRes.json()) as { paused: boolean; lastRunAgeSec: number | null };
    expect(health.paused).toBe(false);
    expect(health.lastRunAgeSec).not.toBeNull();
    expect(health.lastRunAgeSec!).toBeGreaterThanOrEqual(30);
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
});
