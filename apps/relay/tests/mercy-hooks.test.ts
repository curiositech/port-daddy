/**
 * Tests for the per-feature MERCY hooks (src/mercy-hooks.ts; grand-plan DAG
 * node x7-mercy-hooks; plan §X7 + the §4 hook-index table).
 *
 * THE GATE, applied to itself: every hook this module declares for a SHIPPED
 * feature must emit in a test here — X4 summons-ack SLO + fatigue, X3
 * stale-helm + contention, X2 remote-harbors verdict, X8 exhaustion +
 * shadow-delta, HITL interruptions, run reconciliation, SLO burn. Plus the
 * verdict law pinned hard: `unknown` is a real fourth state that NEVER
 * renders green — including when every table is unreadable.
 *
 * Idiom: a fake D1 that answers each hook's aggregate query with configured
 * rows (routing by SQL substring, like mercy.test.ts), so the tests exercise
 * the VERDICT logic — thresholds, unknown states, detail strings — not a
 * re-implementation of SQLite.
 */

import { describe, it, expect } from 'vitest';
import {
  computeFeatureHooks,
  recordHookEvent,
  recordSloSample,
  worstHookStatus,
  parseHooks,
  pruneHookTables,
  SUMMONS_ACK_SLO_SECONDS,
  SLO_BUCKET_SECONDS,
  type FeatureHook,
} from '../src/mercy-hooks.js';
import { runMercySweep, handleMercyStatus, renderMercyPage } from '../src/mercy.js';
import type { Env } from '../src/types.js';

const NOW = 1_800_000_000;

/** Every hook name the module declares, in emission order. */
const ALL_HOOKS = [
  'x4_summons_ack',
  'x4_parley_fatigue',
  'x3_stale_helm',
  'x3_helm_contention',
  'x2_remote_harbors',
  'x8_quota_exhaustion',
  'x8_shadow_delta',
  'hitl_interruptions',
  'squid_reconciliation',
  'slo_burn',
] as const;

// ── Fake D1 answering each hook query with configured aggregate rows ──────────

interface HookDbConfig {
  summons?: { total: number; responded: number; acked_in_slo: number; overdue: number };
  fatigue?: { party_label: string; n: number } | null;
  vacantHelms?: number;
  deadManEvents?: number;
  harbors?: number;
  quota?: { exhausted: number; shadow_denied: number };
  interruptions?: { open: number; expired: number };
  reconciliation?: { runs: number; gapped: number; lost: number };
  /** Keyed by the bound lower window edge is overkill — the fake serves fast
   *  then slow in call order for the two identical-SQL burn queries. */
  slo?: Array<{ req: number; err: number }>;
}

function makeHookDb(cfg: HookDbConfig) {
  const inserts: Array<{ sql: string; args: unknown[] }> = [];
  const deletes: string[] = [];
  let sloCall = 0;
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const s = {
        bind(...v: unknown[]) {
          args = v;
          return s;
        },
        async first() {
          if (sql.includes('GROUP BY party_kind')) return cfg.fatigue ?? null;
          if (sql.includes('FROM parley_summonses')) {
            const c = cfg.summons;
            if (!c) return { total: 0, responded: 0, acked_in_slo: 0, overdue: 0 };
            return { total: c.total, responded: c.responded, acked_in_slo: c.acked_in_slo, overdue: c.overdue };
          }
          if (sql.includes('FROM harbor_helms')) return { n: cfg.vacantHelms ?? 0 };
          if (sql.includes('FROM helm_events')) return { n: cfg.deadManEvents ?? 0 };
          if (sql.includes('FROM harbors')) return { n: cfg.harbors ?? 0 };
          if (sql.includes('FROM mercy_hook_events')) {
            return { exhausted: cfg.quota?.exhausted ?? 0, shadow_denied: cfg.quota?.shadow_denied ?? 0 };
          }
          if (sql.includes('FROM operator_interruptions')) {
            return { open: cfg.interruptions?.open ?? 0, expired: cfg.interruptions?.expired ?? 0 };
          }
          if (sql.includes('FROM squid_run_reconciliation')) {
            const c = cfg.reconciliation ?? { runs: 0, gapped: 0, lost: 0 };
            return { runs: c.runs, gapped: c.gapped, lost: c.lost };
          }
          if (sql.includes('FROM mercy_slo_windows')) {
            const w = cfg.slo?.[sloCall++] ?? { req: 0, err: 0 };
            return { req: w.req, err: w.err };
          }
          throw new Error(`unexpected first(): ${sql}`);
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (sql.startsWith('INSERT')) {
            inserts.push({ sql, args });
            return { success: true };
          }
          if (sql.startsWith('DELETE')) {
            deletes.push(sql);
            return { success: true };
          }
          throw new Error(`unexpected run(): ${sql}`);
        },
      };
      return s;
    },
  };
  return { db: db as unknown as D1Database, inserts, deletes };
}

const envWith = (db: D1Database): Env => ({ DB: db } as unknown as Env);

const hook = (hooks: FeatureHook[], name: string): FeatureHook => {
  const h = hooks.find((x) => x.name === name);
  expect(h, `hook ${name} must be emitted`).toBeDefined();
  return h!;
};

// ── The full set, and the unknown-never-green law ─────────────────────────────

describe('computeFeatureHooks — coverage law', () => {
  it('always emits EVERY declared hook, even on a fully healthy quiet system', async () => {
    const { db } = makeHookDb({ slo: [{ req: 100, err: 0 }, { req: 500, err: 0 }] });
    const hooks = await computeFeatureHooks(envWith(db), NOW);
    expect(hooks.map((h) => h.name)).toEqual([...ALL_HOOKS]);
  });

  it('every hook goes `unknown` — never green — when its tables are unreadable', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('no such table');
      },
    } as unknown as D1Database;
    const hooks = await computeFeatureHooks(envWith(throwingDb), NOW);
    expect(hooks.map((h) => h.name)).toEqual([...ALL_HOOKS]);
    for (const h of hooks) {
      expect(h.status).toBe('unknown');
      expect(h.status).not.toBe('green');
      expect(h.detail).toContain('unmeasured');
    }
  });
});

// ── X4: summons-ack SLO (plan §4 gate: ack-rate ≥ 90%) ───────────────────────

describe('x4_summons_ack', () => {
  const summons = (acked: number, refusedOrEscalated: number, overdue: number) => ({
    total: acked + refusedOrEscalated + overdue,
    responded: acked + refusedOrEscalated,
    acked_in_slo: acked,
    overdue,
  });

  it('is unknown (never green) with no decided summonses', async () => {
    const { db } = makeHookDb({ summons: { total: 0, responded: 0, acked_in_slo: 0, overdue: 0 } });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'x4_summons_ack');
    expect(h.status).toBe('unknown');
  });

  it('is green at or above the 90% plan gate', async () => {
    const { db } = makeHookDb({ summons: summons(19, 1, 0) }); // 95%
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'x4_summons_ack');
    expect(h.status).toBe('green');
    expect(h.metric).toBe(95);
  });

  it('is yellow below the 90% gate and red below 50%', async () => {
    const { db: dbY } = makeHookDb({ summons: summons(8, 2, 0) }); // 80%
    expect(hook(await computeFeatureHooks(envWith(dbY), NOW), 'x4_summons_ack').status).toBe('yellow');
    const { db: dbR } = makeHookDb({ summons: summons(4, 6, 0) }); // 40%
    expect(hook(await computeFeatureHooks(envWith(dbR), NOW), 'x4_summons_ack').status).toBe('red');
  });

  it('counts an unacknowledged summons past the ack SLO against the rate', async () => {
    // 9 acked fast + 1 sitting overdue = 90% → still green; 8+2 overdue = 80% → yellow.
    const { db } = makeHookDb({ summons: summons(8, 0, 2) });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'x4_summons_ack');
    expect(h.status).toBe('yellow');
    expect(h.detail).toContain('2 overdue unacked');
    expect(h.detail).toContain(`${SUMMONS_ACK_SLO_SECONDS / 60}min`);
  });
});

// ── X4: parley fatigue ────────────────────────────────────────────────────────

describe('x4_parley_fatigue', () => {
  it('is a measured green (metric 0) when no summonses were issued in 24h', async () => {
    const { db } = makeHookDb({ fatigue: null });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'x4_parley_fatigue');
    expect(h.status).toBe('green');
    expect(h.metric).toBe(0);
  });

  it('warns at 6 summonses to one party and goes red at 12', async () => {
    const { db: dbY } = makeHookDb({ fatigue: { party_label: 'daemon-a', n: 7 } });
    const hy = hook(await computeFeatureHooks(envWith(dbY), NOW), 'x4_parley_fatigue');
    expect(hy.status).toBe('yellow');
    expect(hy.metric).toBe(7);
    expect(hy.detail).toContain('daemon-a');
    const { db: dbR } = makeHookDb({ fatigue: { party_label: 'daemon-a', n: 12 } });
    expect(hook(await computeFeatureHooks(envWith(dbR), NOW), 'x4_parley_fatigue').status).toBe('red');
  });
});

// ── X3: stale helm + contention ───────────────────────────────────────────────

describe('x3 hooks', () => {
  it('stale_helm warns when any helm is vacant-flagged', async () => {
    const { db } = makeHookDb({ vacantHelms: 2 });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'x3_stale_helm');
    expect(h.status).toBe('yellow');
    expect(h.metric).toBe(2);
  });

  it('helm_contention warns on dead-man transitions in 24h, green at zero', async () => {
    const { db } = makeHookDb({ deadManEvents: 1 });
    expect(hook(await computeFeatureHooks(envWith(db), NOW), 'x3_helm_contention').status).toBe('yellow');
    const { db: quiet } = makeHookDb({});
    expect(hook(await computeFeatureHooks(envWith(quiet), NOW), 'x3_helm_contention').status).toBe('green');
  });
});

// ── X2: remote-harbors verdict (canary honestly unshipped) ────────────────────

describe('x2_remote_harbors', () => {
  it('is green with zero harbors (nothing to verify) and unknown with harbors registered', async () => {
    const { db: empty } = makeHookDb({ harbors: 0 });
    expect(hook(await computeFeatureHooks(envWith(empty), NOW), 'x2_remote_harbors').status).toBe('green');

    const { db } = makeHookDb({ harbors: 3 });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'x2_remote_harbors');
    // The plan's per-harbor verdict is gated on a canary round-trip that has
    // not shipped: the ONLY honest verdict is unknown — never green.
    expect(h.status).toBe('unknown');
    expect(h.metric).toBe(3);
    expect(h.detail).toContain('liveness unproven');
  });
});

// ── X8: exhaustion + shadow delta (fed by the publish-path ledger) ───────────

describe('x8 hooks', () => {
  it('exhaustion warns when enforced 429s were recorded in 24h', async () => {
    const { db } = makeHookDb({ quota: { exhausted: 2, shadow_denied: 0 } });
    const hooks = await computeFeatureHooks(envWith(db), NOW);
    expect(hook(hooks, 'x8_quota_exhaustion').status).toBe('yellow');
    expect(hook(hooks, 'x8_quota_exhaustion').metric).toBe(2);
    expect(hook(hooks, 'x8_shadow_delta').status).toBe('green');
  });

  it('shadow_delta warns on a nonzero would-have-denied delta (the flip signal)', async () => {
    const { db } = makeHookDb({ quota: { exhausted: 0, shadow_denied: 5 } });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'x8_shadow_delta');
    expect(h.status).toBe('yellow');
    expect(h.metric).toBe(5);
    expect(h.detail).toContain('review before any flip');
  });
});

// ── HITL interruptions ────────────────────────────────────────────────────────

describe('hitl_interruptions', () => {
  it('warns when asks expired unanswered in 24h; metric is the open count', async () => {
    const { db } = makeHookDb({ interruptions: { open: 3, expired: 1 } });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'hitl_interruptions');
    expect(h.status).toBe('yellow');
    expect(h.metric).toBe(3);
    expect(h.detail).toContain('expired UNANSWERED');
  });
});

// ── Reconciliation summary + SLO burn ─────────────────────────────────────────

describe('squid_reconciliation', () => {
  it('is unknown (loss NOT assumed zero) with no run reports', async () => {
    const { db } = makeHookDb({ reconciliation: { runs: 0, gapped: 0, lost: 0 } });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'squid_reconciliation');
    expect(h.status).toBe('unknown');
    expect(h.detail).toContain('not assumed zero');
  });

  it('warns with the lost-event metric when any run shows a gap', async () => {
    const { db } = makeHookDb({ reconciliation: { runs: 5, gapped: 2, lost: 3 } });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'squid_reconciliation');
    expect(h.status).toBe('yellow');
    expect(h.metric).toBe(3);
  });

  it('is green when reconciled runs show zero gaps', async () => {
    const { db } = makeHookDb({ reconciliation: { runs: 4, gapped: 0, lost: 0 } });
    expect(hook(await computeFeatureHooks(envWith(db), NOW), 'squid_reconciliation').status).toBe('green');
  });
});

describe('slo_burn', () => {
  it('is unknown with no samples in the slow window', async () => {
    const { db } = makeHookDb({ slo: [{ req: 0, err: 0 }, { req: 0, err: 0 }] });
    expect(hook(await computeFeatureHooks(envWith(db), NOW), 'slo_burn').status).toBe('unknown');
  });

  it('is red when both windows burn ≥ 14x the 99.9% budget', async () => {
    // 2% errors = 20x the 0.1% budget in both windows.
    const { db } = makeHookDb({ slo: [{ req: 1000, err: 20 }, { req: 6000, err: 120 }] });
    const h = hook(await computeFeatureHooks(envWith(db), NOW), 'slo_burn');
    expect(h.status).toBe('red');
    expect(h.metric).toBe(20);
  });

  it('is yellow when only the fast window burns, green when neither does', async () => {
    const { db: spiky } = makeHookDb({ slo: [{ req: 1000, err: 20 }, { req: 60000, err: 60 }] });
    expect(hook(await computeFeatureHooks(envWith(spiky), NOW), 'slo_burn').status).toBe('yellow');
    const { db: calm } = makeHookDb({ slo: [{ req: 1000, err: 1 }, { req: 6000, err: 3 }] });
    expect(hook(await computeFeatureHooks(envWith(calm), NOW), 'slo_burn').status).toBe('green');
  });
});

// ── Emission primitives ───────────────────────────────────────────────────────

describe('recordHookEvent / recordSloSample', () => {
  it('recordHookEvent appends one ledger row', async () => {
    const { db, inserts } = makeHookDb({});
    await recordHookEvent(db, 'x8_quota_exhausted', 'warn', 'harbor h: refused', NOW);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.sql).toContain('INSERT INTO mercy_hook_events');
    expect(inserts[0]!.args).toEqual([NOW, 'x8_quota_exhausted', 'warn', 'harbor h: refused']);
  });

  it('recordHookEvent NEVER throws — the observed path must proceed', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('D1 down');
      },
    } as unknown as D1Database;
    await expect(recordHookEvent(throwingDb, 'x', 'info', 'y', NOW)).resolves.toBeUndefined();
  });

  it('recordSloSample buckets into 300s windows and counts 5xx as errors', async () => {
    const { db, inserts } = makeHookDb({});
    const nowMs = NOW * 1000 + 123_456;
    await recordSloSample(db, nowMs, true);
    await recordSloSample(db, nowMs, false);
    expect(inserts).toHaveLength(2);
    const expectedWindow = Math.floor(nowMs / 1000 / SLO_BUCKET_SECONDS) * SLO_BUCKET_SECONDS;
    expect(expectedWindow % SLO_BUCKET_SECONDS).toBe(0);
    expect(inserts[0]!.args[0]).toBe(expectedWindow);
    expect(inserts[1]!.args[0]).toBe(expectedWindow); // same 5-min bucket
    expect(inserts[0]!.args[1]).toBe(1); // error sample
    expect(inserts[1]!.args[1]).toBe(0); // success sample
  });

  it('recordSloSample never throws and tolerates a missing DB', async () => {
    await expect(recordSloSample(undefined, NOW * 1000, true)).resolves.toBeUndefined();
    const throwingDb = {
      prepare() {
        throw new Error('D1 down');
      },
    } as unknown as D1Database;
    await expect(recordSloSample(throwingDb, NOW * 1000, true)).resolves.toBeUndefined();
  });

  it('pruneHookTables deletes from all three tables and tolerates absence silently', async () => {
    const { db, deletes } = makeHookDb({});
    await pruneHookTables(db, NOW);
    expect(deletes.some((d) => d.includes('mercy_hook_events'))).toBe(true);
    expect(deletes.some((d) => d.includes('squid_run_reconciliation'))).toBe(true);
    expect(deletes.some((d) => d.includes('mercy_slo_windows'))).toBe(true);
    const throwingDb = {
      prepare() {
        throw new Error('no such table');
      },
    } as unknown as D1Database;
    await expect(pruneHookTables(throwingDb, NOW)).resolves.toBeUndefined();
  });
});

// ── Verdict law helpers ───────────────────────────────────────────────────────

describe('worstHookStatus / parseHooks', () => {
  const mk = (status: FeatureHook['status']): FeatureHook => ({ name: 'x', status, metric: null, detail: '' });

  it('ranks green < unknown < yellow < red (unknown outranks green, never vice versa)', () => {
    expect(worstHookStatus([mk('green'), mk('green')])).toBe('green');
    expect(worstHookStatus([mk('green'), mk('unknown')])).toBe('unknown');
    expect(worstHookStatus([mk('unknown'), mk('yellow')])).toBe('yellow');
    expect(worstHookStatus([mk('yellow'), mk('red'), mk('unknown')])).toBe('red');
  });

  it('parseHooks round-trips and drops malformed entries / pre-migration rows', () => {
    const hooks: FeatureHook[] = [{ name: 'a', status: 'unknown', metric: 3, detail: 'd' }];
    expect(parseHooks(JSON.stringify(hooks))).toEqual(hooks);
    expect(parseHooks(null)).toEqual([]);
    expect(parseHooks(undefined)).toEqual([]);
    expect(parseHooks('not json')).toEqual([]);
    expect(parseHooks(JSON.stringify([{ name: 'a', status: 'chartreuse' }]))).toEqual([]);
  });
});

// ── Sweep + surfaces integration ──────────────────────────────────────────────

/** Minimal fake D1 for the sweep: v1 statements answered, hook queries throw
 *  (→ every hook honestly unknown), snapshot insert captured. */
function makeSweepDb() {
  const snapshots: Array<{ args: unknown[] }> = [];
  const probe = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const s = {
        bind(...v: unknown[]) {
          args = v;
          return s;
        },
        async first() {
          if (sql.includes('FROM mercy_probe')) return { v: probe.get('d1-probe') ?? null };
          if (sql.includes('FROM fleet_runs') && sql.includes('COUNT')) return { total: 0, failures: 0 };
          if (sql.includes('FROM fleet_runs')) return { created_at: NOW - 60 };
          if (sql.includes('FROM mercy_incidents')) return null;
          throw new Error(`no such table: ${sql}`);
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT OR REPLACE INTO mercy_probe')) {
            probe.set('d1-probe', String(args[1]));
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO mercy_health')) {
            snapshots.push({ args });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE')) return { success: true, meta: { changes: 0 } };
          if (sql.includes('INSERT')) return { success: true, meta: { changes: 1 } };
          throw new Error(`no such table: ${sql}`);
        },
      };
      return s;
    },
  };
  return { db: db as unknown as D1Database, snapshots };
}

function sweepEnv(db: D1Database): Env {
  return {
    DB: db,
    KV: {
      store: new Map<string, string>(),
      async put(k: string, v: string) {
        (this as unknown as { store: Map<string, string> }).store.set(k, v);
      },
      async get(k: string) {
        return (this as unknown as { store: Map<string, string> }).store.get(k) ?? null;
      },
    },
    HARBOR_CHANNEL: {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => Response.json({ allowed: true }) }),
    },
    FLEET_RUNS: {},
    RELAY_VERSION: '0.0.0-test',
  } as unknown as Env;
}

describe('sweep + status surfaces', () => {
  it('runMercySweep stores hooks_json in the snapshot and returns the full hook set', async () => {
    const { db, snapshots } = makeSweepDb();
    const result = await runMercySweep(sweepEnv(db), NOW);
    expect(result.hooks.map((h) => h.name)).toEqual([...ALL_HOOKS]);
    expect(snapshots).toHaveLength(1);
    // (at, overall, remote, subsystems_json, hooks_json)
    const stored = parseHooks(snapshots[0]!.args[4] as string);
    expect(stored.map((h) => h.name)).toEqual([...ALL_HOOKS]);
  });

  it('GET /mercy serves hooks (name/status/metric only — no detail) + hooksWorst', async () => {
    const hooks: FeatureHook[] = [
      { name: 'x4_summons_ack', status: 'green', metric: 95, detail: 'SECRET-ish operator detail' },
      { name: 'x2_remote_harbors', status: 'unknown', metric: 2, detail: 'canary unshipped' },
    ];
    const db = {
      prepare(sql: string) {
        const s = {
          bind: () => s,
          async first() {
            if (sql.includes('FROM mercy_health')) {
              return {
                at: NOW - 10,
                overall: 'green',
                remote_harbors_possible: 1,
                subsystems_json: '[]',
                hooks_json: JSON.stringify(hooks),
              };
            }
            return { n: 0 };
          },
          async all() {
            return { results: [] };
          },
          async run() {
            return { success: true };
          },
        };
        return s;
      },
    } as unknown as D1Database;
    const res = await handleMercyStatus({ DB: db, RELAY_VERSION: 'v' } as unknown as Env);
    const body = (await res.json()) as {
      hooks: Array<Record<string, unknown>>;
      hooksWorst: string;
    };
    expect(body.hooks).toEqual([
      { name: 'x4_summons_ack', status: 'green', metric: 95 },
      { name: 'x2_remote_harbors', status: 'unknown', metric: 2 },
    ]);
    for (const h of body.hooks) expect(h).not.toHaveProperty('detail');
    // worst of {green, unknown} is unknown — and unknown never reads green.
    expect(body.hooksWorst).toBe('unknown');
  });

  it('renderMercyPage renders the hooks table; unknown renders st-unknown, never st-green', () => {
    const hooks: FeatureHook[] = [
      { name: 'slo_burn', status: 'unknown', metric: null, detail: 'no request samples in 6h — burn unmeasured' },
      { name: 'x3_stale_helm', status: 'yellow', metric: 1, detail: '1 helm(s) vacant-flagged' },
    ];
    const html = renderMercyPage(
      {
        at: NOW - 10,
        overall: 'green',
        remote_harbors_possible: 1,
        subsystems_json: '[]',
        hooks_json: JSON.stringify(hooks),
      } as never,
      [],
      NOW,
    );
    expect(html).toContain('Feature hooks');
    expect(html).toContain('slo_burn');
    expect(html).toContain('st-unknown">unknown</span>');
    expect(html).toContain('burn unmeasured');
    expect(html).toContain('st-yellow">yellow</span>');
    // The unknown row must not borrow a green cell.
    const rowStart = html.indexOf('slo_burn');
    const rowEnd = html.indexOf('</tr>', rowStart);
    expect(html.slice(rowStart, rowEnd)).not.toContain('st-green');
  });
});
