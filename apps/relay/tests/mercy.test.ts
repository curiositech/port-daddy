/**
 * Tests for MERCY v1 — the hospital-ship health system (src/mercy.ts).
 * Coverage, per the v1 acceptance list:
 *   - probe aggregation verdicts (aggregateVerdict + a full healthy sweep),
 *     including the remoteHarborsPossible law (D1 + DO channel not red);
 *   - red-transition paging with dedupe: one delivered page per unresolved
 *     incident, retry only while undelivered, resolve on recovery, page anew
 *     on the next red episode;
 *   - GET /mercy is public, no-secrets JSON (no operator token, no webhook
 *     URL, no probe `detail` internals), honest 'unknown' before first sweep;
 *   - GET /account/mercy is session-gated HTML (302 → /login signed out; real
 *     report card signed in).
 *
 * Injection-style mocks like retention-sweep.test.ts: a stateful fake D1 whose
 * incident store behaves like the real partial-unique-index dedupe row, so
 * consecutive sweeps exercise the true transition logic.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  aggregateVerdict,
  runMercySweep,
  handleMercyStatus,
  handleMercyPage,
  renderMercyPage,
  type SubsystemProbe,
  type MercyIncidentRow,
} from '../src/mercy.js';
import type { Env } from '../src/types.js';

const NOW = 1_800_000_000; // fixed injected clock (sweep time)

const sub = (name: string, status: 'green' | 'yellow' | 'red'): SubsystemProbe => ({
  name,
  status,
  latencyMs: 5,
  detail: `${name} ${status}`,
});

// ── Fake infra ────────────────────────────────────────────────────────────────

interface FakeIncident {
  id: string;
  subsystem: string;
  opened_at: number;
  resolved_at: number | null;
  paged_at: number | null;
  detail: string | null;
}

interface FakeSnapshot {
  at: number;
  overall: string;
  remote: number;
  json: string;
}

const ok = (changes: number) => ({ success: true, meta: { changes } });

/**
 * Stateful fake D1 covering every statement mercy.ts issues. The incidents
 * array enforces the same "at most one open incident per subsystem" rule the
 * real partial unique index does, so INSERT OR IGNORE returns changes=0 on a
 * duplicate open — exactly the dedupe contract.
 */
function makeDb(opts: { lastRunAt?: number | null; total?: number; failures?: number } = {}) {
  const incidents: FakeIncident[] = [];
  const snapshots: FakeSnapshot[] = [];
  const probe = new Map<string, { v: string; at: number }>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const s = {
        bind(...v: unknown[]) {
          args = v;
          return s;
        },
        async first() {
          if (sql.includes('FROM mercy_probe')) {
            const r = probe.get(args[0] as string);
            return r ? { v: r.v } : null;
          }
          if (sql.includes('created_at FROM fleet_runs')) {
            return opts.lastRunAt == null ? null : { created_at: opts.lastRunAt };
          }
          if (sql.includes('COUNT(*)')) {
            return { total: opts.total ?? 0, failures: opts.failures ?? 0 };
          }
          if (sql.includes('FROM mercy_incidents WHERE subsystem')) {
            const open = incidents.find((i) => i.subsystem === args[0] && i.resolved_at === null);
            return open ? { id: open.id, paged_at: open.paged_at } : null;
          }
          if (sql.includes('FROM mercy_health')) {
            const last = snapshots[snapshots.length - 1];
            return last
              ? { at: last.at, overall: last.overall, remote_harbors_possible: last.remote, subsystems_json: last.json }
              : null;
          }
          return null;
        },
        async run() {
          if (sql.includes('INTO mercy_probe')) {
            probe.set(args[0] as string, { v: args[1] as string, at: args[2] as number });
            return ok(1);
          }
          if (sql.includes('INSERT OR IGNORE INTO mercy_incidents')) {
            const [id, subsystem, opened_at, detail] = args as [string, string, number, string];
            if (incidents.some((i) => i.subsystem === subsystem && i.resolved_at === null)) return ok(0);
            incidents.push({ id, subsystem, opened_at, resolved_at: null, paged_at: null, detail });
            return ok(1);
          }
          if (sql.includes('SET paged_at')) {
            const i = incidents.find((x) => x.id === args[1]);
            if (i) i.paged_at = args[0] as number;
            return ok(i ? 1 : 0);
          }
          if (sql.includes('SET resolved_at')) {
            const i = incidents.find((x) => x.id === args[1]);
            if (i) i.resolved_at = args[0] as number;
            return ok(i ? 1 : 0);
          }
          if (sql.includes('INTO mercy_health')) {
            snapshots.push({
              at: args[0] as number,
              overall: args[1] as string,
              remote: args[2] as number,
              json: args[3] as string,
            });
            return ok(1);
          }
          return ok(0); // prune DELETEs etc.
        },
        async all() {
          if (sql.includes('FROM mercy_incidents')) return { results: incidents.slice() };
          return { results: [] };
        },
      };
      return s;
    },
  };
  return { db: db as unknown as D1Database, incidents, snapshots };
}

function makeKv() {
  const store = new Map<string, string>();
  return {
    async get(k: string) {
      return store.get(k) ?? null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
}

const healthyDo = {
  idFromName: (n: string) => ({ name: n }),
  get: () => ({
    fetch: async () => Response.json({ allowed: true }),
  }),
} as unknown as DurableObjectNamespace;

const deadDo = {
  idFromName: (n: string) => ({ name: n }),
  get: () => ({
    fetch: async () => {
      throw new Error('DO unreachable');
    },
  }),
} as unknown as DurableObjectNamespace;

function makeEnv(db: D1Database, over: Partial<Record<keyof Env, unknown>> = {}): Env {
  return {
    DB: db,
    KV: makeKv(),
    HARBOR_CHANNEL: healthyDo,
    FLEET_RUNS: {},
    RELAY_VERSION: '0.1.0-test',
    ...over,
  } as unknown as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1. Probe aggregation verdicts ─────────────────────────────────────────────

describe('aggregateVerdict', () => {
  it('all green → green overall, remote harbors possible', () => {
    const v = aggregateVerdict([sub('d1', 'green'), sub('kv', 'green'), sub('do_channel', 'green')]);
    expect(v.overall).toBe('green');
    expect(v.remoteHarborsPossible).toBe(true);
  });

  it('any yellow → yellow overall, but remote harbors still possible', () => {
    const v = aggregateVerdict([sub('d1', 'green'), sub('queue', 'yellow'), sub('do_channel', 'green')]);
    expect(v.overall).toBe('yellow');
    expect(v.remoteHarborsPossible).toBe(true);
  });

  it('red d1 → red overall AND remote harbors impossible', () => {
    const v = aggregateVerdict([sub('d1', 'red'), sub('kv', 'green'), sub('do_channel', 'green')]);
    expect(v.overall).toBe('red');
    expect(v.remoteHarborsPossible).toBe(false);
  });

  it('red do_channel → remote harbors impossible', () => {
    const v = aggregateVerdict([sub('d1', 'green'), sub('do_channel', 'red')]);
    expect(v.remoteHarborsPossible).toBe(false);
  });

  it('red elsewhere (kv) → red overall, but remote harbors STILL possible', () => {
    const v = aggregateVerdict([sub('d1', 'green'), sub('kv', 'red'), sub('do_channel', 'green')]);
    expect(v.overall).toBe('red');
    expect(v.remoteHarborsPossible).toBe(true);
  });

  it('fails closed: a missing d1/do_channel probe means remote harbors NOT possible', () => {
    const v = aggregateVerdict([sub('kv', 'green')]);
    expect(v.remoteHarborsPossible).toBe(false);
  });
});

describe('runMercySweep (healthy fleet)', () => {
  it('probes every subsystem, verdicts green, stores one snapshot', async () => {
    const { db, snapshots, incidents } = makeDb({ lastRunAt: NOW - 60, total: 4, failures: 1 });
    const r = await runMercySweep(makeEnv(db), NOW);

    expect(r.subsystems.map((s) => s.name)).toEqual([
      'd1', 'kv', 'do_channel', 'queue', 'fleet_executor', 'error_rate',
    ]);
    expect(r.overall).toBe('green');
    expect(r.remoteHarborsPossible).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.pagesSent).toBe(0);
    expect(incidents).toHaveLength(0);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.at).toBe(NOW);
    expect(snapshots[0]!.overall).toBe('green');
    expect(snapshots[0]!.remote).toBe(1);
    const stored = JSON.parse(snapshots[0]!.json) as SubsystemProbe[];
    expect(stored.find((s) => s.name === 'd1')!.status).toBe('green');
  });

  it('missing queue binding + no runs ever → honest yellow, never red', async () => {
    const { db } = makeDb({ lastRunAt: null });
    const r = await runMercySweep(makeEnv(db, { FLEET_RUNS: undefined }), NOW);
    expect(r.subsystems.find((s) => s.name === 'queue')!.status).toBe('yellow');
    expect(r.subsystems.find((s) => s.name === 'fleet_executor')!.status).toBe('yellow');
    expect(r.overall).toBe('yellow');
    expect(r.remoteHarborsPossible).toBe(true);
    expect(r.pagesSent).toBe(0); // yellow never pages
  });

  it('high 24h failure share → yellow with an honest BLOCK-verdict caveat', async () => {
    const { db } = makeDb({ lastRunAt: NOW - 60, total: 10, failures: 8 });
    const r = await runMercySweep(makeEnv(db), NOW);
    const er = r.subsystems.find((s) => s.name === 'error_rate')!;
    expect(er.status).toBe('yellow');
    expect(er.detail).toContain('BLOCK');
  });
});

// ── 2. Red-transition paging + dedupe ─────────────────────────────────────────

describe('paging on red transitions (dedupe row)', () => {
  const WEBHOOK = 'https://hooks.example.test/secret-routing-key';

  function stubFetch(status = 202) {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body ?? '') });
        return new Response('ok', { status });
      }),
    );
    return calls;
  }

  it('first red sweep opens an incident and pages exactly once; later red sweeps never re-page', async () => {
    const calls = stubFetch();
    const { db, incidents } = makeDb({ lastRunAt: NOW - 60 });
    const env = makeEnv(db, { HARBOR_CHANNEL: deadDo, MERCY_PAGE_WEBHOOK: WEBHOOK });

    const r1 = await runMercySweep(env, NOW);
    expect(r1.overall).toBe('red');
    expect(r1.remoteHarborsPossible).toBe(false);
    expect(r1.incidentsOpened).toBe(1);
    expect(r1.pagesSent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(WEBHOOK);
    const payload = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(payload.subsystem).toBe('do_channel');
    expect(payload.severity).toBe('red');
    expect(incidents[0]!.paged_at).toBe(NOW);

    // Still red on the next two sweeps: same unresolved incident, NO new page.
    const r2 = await runMercySweep(env, NOW + 300);
    const r3 = await runMercySweep(env, NOW + 600);
    expect(r2.incidentsOpened).toBe(0);
    expect(r3.incidentsOpened).toBe(0);
    expect(r2.pagesSent + r3.pagesSent).toBe(0);
    expect(calls).toHaveLength(1); // the dedupe
    expect(incidents).toHaveLength(1);
  });

  it('recovery resolves the incident; the NEXT red episode pages anew', async () => {
    const calls = stubFetch();
    const { db, incidents } = makeDb({ lastRunAt: NOW - 60 });
    const red = makeEnv(db, { HARBOR_CHANNEL: deadDo, MERCY_PAGE_WEBHOOK: WEBHOOK });
    const healthy = makeEnv(db, { MERCY_PAGE_WEBHOOK: WEBHOOK });

    await runMercySweep(red, NOW); // opens + pages
    const r2 = await runMercySweep(healthy, NOW + 300); // recovers
    expect(r2.incidentsResolved).toBe(1);
    expect(incidents[0]!.resolved_at).toBe(NOW + 300);

    const r3 = await runMercySweep(red, NOW + 600); // new episode
    expect(r3.incidentsOpened).toBe(1);
    expect(r3.pagesSent).toBe(1);
    expect(calls).toHaveLength(2);
    expect(incidents).toHaveLength(2);
  });

  it('a FAILED webhook delivery is retried next sweep — dedupe is on delivery, not attempts', async () => {
    // First sweep: webhook 500s → paged_at stays null.
    const failing = stubFetch(500);
    const { db, incidents } = makeDb({ lastRunAt: NOW - 60 });
    const env = makeEnv(db, { HARBOR_CHANNEL: deadDo, MERCY_PAGE_WEBHOOK: WEBHOOK });
    const r1 = await runMercySweep(env, NOW);
    expect(r1.incidentsOpened).toBe(1);
    expect(r1.pagesSent).toBe(0);
    expect(incidents[0]!.paged_at).toBeNull();
    expect(failing).toHaveLength(1);

    // Second sweep: webhook healthy again → the retry delivers, paged_at set.
    const okCalls = stubFetch(202);
    const r2 = await runMercySweep(env, NOW + 300);
    expect(r2.incidentsOpened).toBe(0);
    expect(r2.pagesSent).toBe(1);
    expect(okCalls).toHaveLength(1);
    expect(incidents[0]!.paged_at).toBe(NOW + 300);

    // Third sweep: delivered → silence.
    const quiet = stubFetch(202);
    await runMercySweep(env, NOW + 600);
    expect(quiet).toHaveLength(0);
  });

  it('no MERCY_PAGE_WEBHOOK configured → incident recorded, nobody paged, no fetch', async () => {
    const calls = stubFetch();
    const { db, incidents } = makeDb({ lastRunAt: NOW - 60 });
    const r = await runMercySweep(makeEnv(db, { HARBOR_CHANNEL: deadDo }), NOW);
    expect(r.incidentsOpened).toBe(1);
    expect(r.pagesSent).toBe(0);
    expect(incidents).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });
});

// ── 3. GET /mercy — public, no secrets ────────────────────────────────────────

describe('GET /mercy (public status JSON)', () => {
  const SECRETS = {
    RELAY_OPERATOR_TOKEN: 'operator-token-secret-0123456789abcdef',
    MERCY_PAGE_WEBHOOK: 'https://hooks.example.test/secret-routing-key',
    RELAY_ED25519_PRIVATE_KEY_HEX: 'deadbeef'.repeat(8),
    GITHUB_WEBHOOK_SECRET: 'gh-webhook-secret-value',
  };

  it('serves the stored snapshot with statuses + latencies but NO secrets and NO probe details', async () => {
    const { db } = makeDb({ lastRunAt: NOW - 60 });
    const env = makeEnv(db, SECRETS);
    // Store one sweep (its details include an error string a probe could emit).
    vi.stubGlobal('fetch', vi.fn());
    await runMercySweep(makeEnv(db, { HARBOR_CHANNEL: deadDo, ...SECRETS }), NOW);

    const res = await handleMercyStatus(env);
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());

    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('"detail"'); // operator internals stay off the public page
    expect(text).not.toContain('DO unreachable');

    const body = JSON.parse(text) as {
      overall: string;
      remoteHarborsPossible: boolean;
      subsystems: Array<{ name: string; status: string; latencyMs: number | null }>;
      snapshotAt: number;
      stale: boolean;
    };
    expect(body.overall).toBe('red');
    expect(body.remoteHarborsPossible).toBe(false);
    expect(body.snapshotAt).toBe(NOW);
    expect(body.subsystems.map((s) => s.name)).toContain('do_channel');
    expect(body.subsystems.find((s) => s.name === 'do_channel')!.status).toBe('red');
  });

  it('is honest before the first sweep: overall unknown, stale, remoteHarborsPossible null', async () => {
    const { db } = makeDb();
    const res = await handleMercyStatus(makeEnv(db, SECRETS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { overall: string; stale: boolean; remoteHarborsPossible: null };
    expect(body.overall).toBe('unknown');
    expect(body.stale).toBe(true);
    expect(body.remoteHarborsPossible).toBeNull();
  });

  it('requires no Authorization and sets no cookie (public, cacheable)', async () => {
    const { db } = makeDb();
    const res = await handleMercyStatus(makeEnv(db));
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Cache-Control')).toContain('max-age');
  });
});

// ── 4. GET /account/mercy — session-gated HTML ────────────────────────────────

describe('GET /account/mercy (report card)', () => {
  it('redirects to /login when there is no session cookie', async () => {
    const req = new Request('https://relay.example/account/mercy');
    const res = await handleMercyPage(req, {} as Env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('renders the report card for a live session', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const { db } = makeDb({ lastRunAt: nowSec - 60 });
    // Seed one sweep so the page has vitals.
    await runMercySweep(makeEnv(db), nowSec);
    // Splice session resolution onto the fake D1: web_sessions + users.
    const base = db as unknown as { prepare: (sql: string) => unknown };
    const origPrepare = base.prepare.bind(base);
    base.prepare = (sql: string) => {
      if (sql.includes('FROM web_sessions')) {
        return {
          bind: () => ({
            first: async () => ({ user_id: 'u1', gh_token_enc: null, gh_token_iv: null, expires_at: nowSec + 3600 }),
          }),
        };
      }
      if (sql.includes('FROM users')) {
        return {
          bind: () => ({
            first: async () => ({
              id: 'u1', github_user_id: 1, login: 'skipper', display_name: null, avatar_url: null,
              primary_email: null, email_verified: 0, created_at: nowSec, last_login_at: null, deleted_at: null,
            }),
          }),
        };
      }
      return origPrepare(sql);
    };

    const req = new Request('https://relay.example/account/mercy', {
      headers: { Cookie: '__Host-pd_session=abc' },
    });
    const res = await handleMercyPage(req, makeEnv(db));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('MERCY');
    expect(html).toContain('Remote harbors possible');
    expect(html).toContain('do_channel');
    expect(html).toContain('href="/account"'); // way back home
  });

  it('renderMercyPage escapes stored detail strings (XSS guard) and shows incidents honestly', () => {
    const snapshot = {
      at: NOW,
      overall: 'red',
      remote_harbors_possible: 0,
      subsystems_json: JSON.stringify([
        { name: 'd1', status: 'red', latencyMs: null, detail: '<script>alert(1)</script>' },
      ]),
    };
    const incidents: MercyIncidentRow[] = [
      { id: 'mi_1', subsystem: 'd1', opened_at: NOW, resolved_at: null, paged_at: null, detail: '"quoted"' },
    ];
    const html = renderMercyPage(snapshot, incidents, NOW + 60);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;quoted&quot;');
    expect(html).toContain('OPEN'); // unresolved incident is shown as open
    expect(html).toContain('not paged'); // honest about undelivered paging
  });

  it('teaches with empty states before the first sweep (no Potemkin vitals)', () => {
    const html = renderMercyPage(null, [], NOW);
    expect(html).toContain('No vitals recorded yet');
    expect(html).toContain('No incidents on record');
    expect(html).not.toContain('st-green">green'); // no fabricated healthy rows
  });
});
