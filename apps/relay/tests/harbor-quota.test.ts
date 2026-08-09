/**
 * X8 HARBOR QUOTAS tests (src/harbor-quota.ts + the billing.ts status surface;
 * grand-plan §X8, DAG node x8-quotas-do).
 *
 * Pins the node's acceptance gates:
 *   - BATCHING: the publish hot path performs ZERO storage writes — counters
 *     accumulate in memory and the alarm flushes them in ONE batched put
 *     (publish latency stays flat by construction, asserted by counting puts);
 *   - EVICTION DURABILITY: a fresh instance over the same state.storage
 *     reconstructs the flushed counters and keeps counting (the old in-memory
 *     Map limiter lost everything); the accepted loss — at most one flush
 *     interval of unflushed pending — is asserted too, not hidden;
 *   - BUDGET BOUNDARY: enforce mode refuses the (budget+1)th event with a 429
 *     carrying `Retry-After` (seconds to UTC midnight) and the credit-ledger
 *     pointer — never a silent drop; a refused event consumes no budget;
 *   - SHADOW IS PROVABLY NON-ENFORCING: the same over-budget traffic passes in
 *     shadow mode, and the recorded shadow-denied delta equals exactly what
 *     enforce mode refused on identical traffic;
 *   - the per-sender minute rate limit keeps its pre-X8 semantics, now
 *     harbor-wide and eviction-surviving;
 *   - billing stays OFF the hot path: getCachedBillingStatus serves KV-cached
 *     balances (stale-while-revalidate) and only touches D1 on a miss.
 *
 * Idiom: the REAL HarborQuota DO against a Map-backed fake DurableObjectState
 * (like presence.test.ts), with an instrumented put counter. Time is driven
 * with vi.setSystemTime.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HarborQuota,
  QUOTA_FLUSH_MS,
  DEFAULT_DAILY_EVENT_BUDGET,
  DEFAULT_DAILY_BYTE_BUDGET,
  CREDIT_LEDGER_POINTER,
  resolveQuotaSettings,
  quotaGateResponse,
  secondsToUtcMidnight,
  utcDayKey,
  harborQuotaKey,
  type QuotaVerdict,
  type QuotaStatus,
  type QuotaCheckRequest,
} from '../src/harbor-quota.js';
import {
  getCachedBillingStatus,
  handleQuotaStatus,
  BILLING_STATUS_CACHE_TTL_SECONDS,
} from '../src/billing.js';
import type { Env } from '../src/types.js';

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface FakeStorageHandle {
  storage: DurableObjectStorage;
  map: Map<string, unknown>;
  counters: { puts: number };
  getAlarmValue: () => number | null;
}

/** Map-backed DurableObjectStorage with an instrumented put counter. Supports
 *  both put(key, value) and the batched put(record) form the flush uses. */
function makeStorage(): FakeStorageHandle {
  const map = new Map<string, unknown>();
  const counters = { puts: 0 };
  let alarm: number | null = null;
  const storage = {
    async get(k: string) {
      return map.get(k);
    },
    async put(a: string | Record<string, unknown>, b?: unknown) {
      counters.puts++;
      if (typeof a === 'string') {
        map.set(a, b);
      } else {
        for (const [k, v] of Object.entries(a)) map.set(k, v);
      }
    },
    async delete(keys: string | string[]) {
      const arr = Array.isArray(keys) ? keys : [keys];
      let n = 0;
      for (const k of arr) if (map.delete(k)) n++;
      return n;
    },
    async list(opts?: { prefix?: string }) {
      const out = new Map<string, unknown>();
      for (const [k, v] of map) {
        if (!opts?.prefix || k.startsWith(opts.prefix)) out.set(k, v);
      }
      return out;
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(at: number) {
      alarm = at;
    },
  } as unknown as DurableObjectStorage;
  return { storage, map, counters, getAlarmValue: () => alarm };
}

function makeDoEnv(): Env {
  return { RATE_LIMIT_WINDOW_MS: '60000' } as unknown as Env;
}

/** A real HarborQuota over the given (possibly shared) storage — creating a
 *  SECOND instance over the same handle is the eviction simulation. */
function makeQuota(handle?: FakeStorageHandle): { inst: HarborQuota } & FakeStorageHandle {
  const h = handle ?? makeStorage();
  const state = { storage: h.storage } as unknown as DurableObjectState;
  // `inst` LAST: a passed-in handle may itself carry an inst property (the
  // pre-eviction instance) which must not shadow the fresh one.
  return { storage: h.storage, map: h.map, counters: h.counters, getAlarmValue: h.getAlarmValue, inst: new HarborQuota(state, makeDoEnv()) };
}

const baseCheck: QuotaCheckRequest = {
  sender: 'daemon-a',
  ratePerMin: 10_000,
  eventBytes: 100,
  eventBudget: DEFAULT_DAILY_EVENT_BUDGET,
  byteBudget: DEFAULT_DAILY_BYTE_BUDGET,
  enforce: false,
};

async function check(inst: HarborQuota, over: Partial<QuotaCheckRequest> = {}): Promise<QuotaVerdict> {
  const res = await inst.fetch(
    new Request('http://do/?action=check', {
      method: 'POST',
      body: JSON.stringify({ ...baseCheck, ...over }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as QuotaVerdict;
}

async function status(inst: HarborQuota): Promise<QuotaStatus> {
  const res = await inst.fetch(new Request('http://do/?action=status'));
  expect(res.status).toBe(200);
  return (await res.json()) as QuotaStatus;
}

// ── Time control ──────────────────────────────────────────────────────────────

const T0_MS = Date.UTC(2026, 7, 9, 12, 0, 0); // 2026-08-09T12:00:00Z
const at = (ms: number) => vi.setSystemTime(new Date(ms));

beforeEach(() => {
  vi.useFakeTimers();
  at(T0_MS);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Batching: the hot path writes nothing ─────────────────────────────────────

describe('HarborQuota — batched, alarm-flushed writes (publish latency stays flat)', () => {
  it('N checks perform ZERO storage puts; the alarm flush performs exactly ONE batched put', async () => {
    const q = makeQuota();
    for (let i = 0; i < 50; i++) {
      expect((await check(q.inst)).allowed).toBe(true);
    }
    expect(q.counters.puts).toBe(0); // the gate: no storage write per publish

    await q.inst.alarm();
    expect(q.counters.puts).toBe(1); // one batched put for counters + senders

    const s = await status(q.inst);
    expect(s.counters.events).toBe(50);
    expect(s.counters.bytes).toBe(50 * 100);
  });

  it('the first dirtying check arms the flush alarm; a clean alarm pass writes nothing more', async () => {
    const q = makeQuota();
    expect(q.getAlarmValue()).toBeNull();
    await check(q.inst);
    expect(q.getAlarmValue()).toBe(T0_MS + QUOTA_FLUSH_MS);

    await q.inst.alarm();
    const putsAfterFlush = q.counters.puts;
    await q.inst.alarm(); // nothing pending now
    expect(q.counters.puts).toBe(putsAfterFlush);
  });
});

// ── Eviction durability ───────────────────────────────────────────────────────

describe('HarborQuota — counters survive simulated eviction', () => {
  it('a fresh instance over the same state.storage reconstructs flushed counters and keeps counting', async () => {
    const first = makeQuota();
    for (let i = 0; i < 30; i++) await check(first.inst);
    await first.inst.alarm(); // flush

    // EVICTION: a brand-new instance, same storage.
    const second = makeQuota(first);
    expect((await status(second.inst)).counters.events).toBe(30);

    for (let i = 0; i < 5; i++) await check(second.inst);
    expect((await status(second.inst)).counters.events).toBe(35);
  });

  it('unflushed pending is the stated bounded loss: the durable baseline survives, the tail does not', async () => {
    const first = makeQuota();
    for (let i = 0; i < 30; i++) await check(first.inst);
    await first.inst.alarm();
    for (let i = 0; i < 7; i++) await check(first.inst); // never flushed

    const second = makeQuota(first);
    // 30 flushed events survive; the 7 unflushed ones are the accepted
    // (at most one flush interval) loss — this is deliberate, not a bug.
    expect((await status(second.inst)).counters.events).toBe(30);
  });

  it('per-sender rate windows survive eviction (the old Map limiter forgot them)', async () => {
    const first = makeQuota();
    expect((await check(first.inst, { ratePerMin: 2 })).allowed).toBe(true);
    expect((await check(first.inst, { ratePerMin: 2 })).allowed).toBe(true);
    expect((await check(first.inst, { ratePerMin: 2 })).code).toBe('RATE_LIMITED');
    await first.inst.alarm(); // snapshot the windows

    at(T0_MS + 10_000); // still inside the same minute window
    const second = makeQuota(first);
    const verdict = await check(second.inst, { ratePerMin: 2 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.code).toBe('RATE_LIMITED');
  });
});

// ── Budget boundary: enforce mode ─────────────────────────────────────────────

describe('HarborQuota — budget exhaustion refuses loudly (enforce mode)', () => {
  it('the (budget+1)th event is refused with QUOTA_EXHAUSTED + Retry-After to UTC midnight; refused events consume no budget', async () => {
    const q = makeQuota();
    for (let i = 0; i < 3; i++) {
      const v = await check(q.inst, { eventBudget: 3, enforce: true });
      expect(v.allowed).toBe(true);
      expect(v.shadow).toBeUndefined();
    }
    const denied = await check(q.inst, { eventBudget: 3, enforce: true });
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe('QUOTA_EXHAUSTED');
    expect(denied.retryAfterSeconds).toBe(secondsToUtcMidnight(T0_MS));
    expect(denied.retryAfterSeconds).toBe(12 * 3600); // T0 is exactly UTC noon

    const s = await status(q.inst);
    expect(s.counters.events).toBe(3); // the refusal consumed nothing
    expect(s.counters.enforcedDeniedEvents).toBe(1);
    expect(s.counters.enforcedDeniedBytes).toBe(100);
  });

  it('the BYTE budget refuses too, independently of the event budget', async () => {
    const q = makeQuota();
    expect((await check(q.inst, { byteBudget: 250, enforce: true })).allowed).toBe(true);
    expect((await check(q.inst, { byteBudget: 250, enforce: true })).allowed).toBe(true);
    const denied = await check(q.inst, { byteBudget: 250, enforce: true });
    expect(denied.code).toBe('QUOTA_EXHAUSTED');
  });

  it('quotaGateResponse turns the verdict into 429 + Retry-After + the credit-ledger pointer', async () => {
    const resp = quotaGateResponse(
      { allowed: false, code: 'QUOTA_EXHAUSTED', retryAfterSeconds: 43_200 },
      60,
    );
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(429);
    expect(resp!.headers.get('Retry-After')).toBe('43200');
    const body = (await resp!.json()) as { code: string; credit_ledger: string };
    expect(body.code).toBe('QUOTA_EXHAUSTED');
    expect(body.credit_ledger).toBe(CREDIT_LEDGER_POINTER); // never a silent drop
  });

  it('quotaGateResponse: rate refusal is 429 + Retry-After; an allowing verdict is null', async () => {
    const resp = quotaGateResponse({ allowed: false, code: 'RATE_LIMITED', retryAfterSeconds: 17 }, 60);
    expect(resp!.status).toBe(429);
    expect(resp!.headers.get('Retry-After')).toBe('17');
    expect(((await resp!.json()) as { code: string }).code).toBe('RATE_LIMITED');

    expect(quotaGateResponse({ allowed: true }, 60)).toBeNull();
    expect(quotaGateResponse({ allowed: true, shadow: true }, 60)).toBeNull();
  });
});

// ── Shadow mode: provably non-enforcing ───────────────────────────────────────

describe('HarborQuota — shadow mode counts, refuses nothing, records the delta', () => {
  it('the SAME over-budget traffic passes in shadow mode; the delta equals what enforce refused', async () => {
    // Identical traffic: 10 events against a 3-event budget.
    const shadow = makeQuota();
    const shadowVerdicts: QuotaVerdict[] = [];
    for (let i = 0; i < 10; i++) {
      shadowVerdicts.push(await check(shadow.inst, { eventBudget: 3, enforce: false }));
    }
    // PROVABLY NON-ENFORCING: every single event passed.
    expect(shadowVerdicts.every((v) => v.allowed)).toBe(true);
    expect(shadowVerdicts.filter((v) => v.shadow).length).toBe(7);

    const enforced = makeQuota();
    const enforcedVerdicts: QuotaVerdict[] = [];
    for (let i = 0; i < 10; i++) {
      enforcedVerdicts.push(await check(enforced.inst, { eventBudget: 3, enforce: true }));
    }
    expect(enforcedVerdicts.filter((v) => !v.allowed).length).toBe(7);

    // The recorded shadow delta IS the enforce outcome — the flip decision's data.
    const shadowStatus = await status(shadow.inst);
    const enforcedStatus = await status(enforced.inst);
    expect(shadowStatus.counters.shadowDeniedEvents).toBe(enforcedStatus.counters.enforcedDeniedEvents);
    expect(shadowStatus.counters.shadowDeniedEvents).toBe(7);
    expect(shadowStatus.counters.shadowDeniedBytes).toBe(700);
    // Shadow-passed events consumed budget (they really published)…
    expect(shadowStatus.counters.events).toBe(10);
    // …while enforce-mode refusals did not.
    expect(enforcedStatus.counters.events).toBe(3);
  });

  it('the shadow delta survives the flush + eviction cycle (the soak is durable)', async () => {
    const first = makeQuota();
    for (let i = 0; i < 5; i++) await check(first.inst, { eventBudget: 2, enforce: false });
    await first.inst.alarm();

    const second = makeQuota(first);
    const s = await status(second.inst);
    expect(s.counters.shadowDeniedEvents).toBe(3);
  });
});

// ── Per-sender rate limit (pre-X8 semantics, now durable + harbor-wide) ───────

describe('HarborQuota — per-sender minute rate limit', () => {
  it('caps each sender independently and frees the window after RATE_LIMIT_WINDOW_MS', async () => {
    const q = makeQuota();
    expect((await check(q.inst, { sender: 'a', ratePerMin: 2 })).allowed).toBe(true);
    expect((await check(q.inst, { sender: 'a', ratePerMin: 2 })).allowed).toBe(true);

    const denied = await check(q.inst, { sender: 'a', ratePerMin: 2 });
    expect(denied.code).toBe('RATE_LIMITED');
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);

    // Sender b is untouched by a's window.
    expect((await check(q.inst, { sender: 'b', ratePerMin: 2 })).allowed).toBe(true);

    // A rate refusal consumed no daily budget.
    expect((await status(q.inst)).counters.events).toBe(3);

    at(T0_MS + 60_001); // a's window has ended
    expect((await check(q.inst, { sender: 'a', ratePerMin: 2 })).allowed).toBe(true);
  });
});

// ── UTC day rollover ──────────────────────────────────────────────────────────

describe('HarborQuota — daily budgets reset at UTC midnight', () => {
  it('a new UTC day starts fresh; the finished day\'s record stays in storage', async () => {
    const q = makeQuota();
    for (let i = 0; i < 4; i++) await check(q.inst);
    expect((await status(q.inst)).day).toBe('2026-08-09');

    at(T0_MS + 13 * 3600 * 1000); // 01:00 UTC next day
    const v = await check(q.inst);
    expect(v.allowed).toBe(true);
    const s = await status(q.inst);
    expect(s.day).toBe('2026-08-10');
    expect(s.counters.events).toBe(1); // fresh budget

    // The finished day was flushed durably on rollover.
    const oldDay = q.map.get('day:2026-08-09') as { events: number };
    expect(oldDay.events).toBe(4);
  });
});

// ── Worker-side settings + status surface ─────────────────────────────────────

describe('resolveQuotaSettings — env-gated, shadow by default', () => {
  it('defaults are the committed budgets, shadow mode', () => {
    const s = resolveQuotaSettings({} as Env);
    expect(s).toEqual({
      eventBudget: DEFAULT_DAILY_EVENT_BUDGET,
      byteBudget: DEFAULT_DAILY_BYTE_BUDGET,
      enforce: false,
    });
  });

  it('ONLY the exact string "enforce" enforces; budgets parse from env, garbage falls back', () => {
    expect(resolveQuotaSettings({ QUOTA_ENFORCE: 'enforce' } as unknown as Env).enforce).toBe(true);
    for (const v of ['shadow', 'on', 'true', 'ENFORCE', 'enforce ', '']) {
      expect(resolveQuotaSettings({ QUOTA_ENFORCE: v } as unknown as Env).enforce, JSON.stringify(v)).toBe(false);
    }
    const s = resolveQuotaSettings({
      HARBOR_DAILY_EVENT_BUDGET: '5000',
      HARBOR_DAILY_BYTE_BUDGET: 'not-a-number',
    } as unknown as Env);
    expect(s.eventBudget).toBe(5000);
    expect(s.byteBudget).toBe(DEFAULT_DAILY_BYTE_BUDGET); // never "unlimited"
  });
});

// ── Status surface + cached billing (billing.ts) ──────────────────────────────

const OPERATOR_TOKEN = 'op-token-'.padEnd(48, 'x');
const HARBOR_FP = 'ab'.repeat(32);

/** Fake KV: string store with the ('json') read shape getCachedBillingStatus uses. */
function makeKv() {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string, type?: string) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

/** Fake D1 that only answers the credit_ledger balance query, counting reads. */
function makeBillingDb(balance: { n: number; bal: number }) {
  const counters = { reads: 0 };
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM credit_ledger')) {
            counters.reads++;
            return balance as unknown as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, counters };
}

/** Fake HARBOR_QUOTA namespace running REAL HarborQuota instances. */
function makeQuotaNamespace(): DurableObjectNamespace {
  const instances = new Map<string, HarborQuota>();
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: (id: DurableObjectId) => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const key = String(id);
        let inst = instances.get(key);
        if (!inst) {
          const h = makeStorage();
          inst = new HarborQuota({ storage: h.storage } as unknown as DurableObjectState, makeDoEnv());
          instances.set(key, inst);
        }
        return inst.fetch(new Request(input as string | URL, init as RequestInit));
      },
    }),
  } as unknown as DurableObjectNamespace;
}

function makeStatusEnv(over: Partial<Record<string, unknown>> = {}): Env {
  const { kv } = makeKv();
  const { db } = makeBillingDb({ n: 0, bal: 0 });
  return {
    DB: db,
    KV: kv,
    HARBOR_QUOTA: makeQuotaNamespace(),
    RELAY_OPERATOR_TOKEN: OPERATOR_TOKEN,
    RATE_LIMIT_WINDOW_MS: '60000',
    ...over,
  } as unknown as Env;
}

const statusReq = (fp: string, opts: { token?: string; query?: string } = {}) =>
  new Request(`https://relay.example/v1/quotas/${fp}${opts.query ?? ''}`, {
    headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
  });

describe('GET /v1/quotas/:harborFp — the flip-decision surface', () => {
  it('is operator-only (401 without the token) and fails closed on bad input / missing binding', async () => {
    const env = makeStatusEnv();
    expect((await handleQuotaStatus(statusReq(HARBOR_FP), env, HARBOR_FP)).status).toBe(401);
    expect(
      (await handleQuotaStatus(statusReq(HARBOR_FP, { token: 'wrong-token'.padEnd(48, 'x') }), env, HARBOR_FP)).status,
    ).toBe(401);

    const bad = await handleQuotaStatus(statusReq('nope', { token: OPERATOR_TOKEN }), env, 'nope');
    expect(bad.status).toBe(400);

    const unbound = makeStatusEnv({ HARBOR_QUOTA: undefined });
    const res = await handleQuotaStatus(statusReq(HARBOR_FP, { token: OPERATOR_TOKEN }), unbound, HARBOR_FP);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('QUOTA_UNCONFIGURED');
  });

  it('reports mode, budgets, counters (incl. the shadow delta) and the credit-ledger pointer', async () => {
    const env = makeStatusEnv({ QUOTA_ENFORCE: 'shadow', HARBOR_DAILY_EVENT_BUDGET: '2' });
    // Drive real over-budget traffic through the namespace the handler reads.
    const stub = env.HARBOR_QUOTA!.get(env.HARBOR_QUOTA!.idFromName(harborQuotaKey(HARBOR_FP)));
    for (let i = 0; i < 5; i++) {
      await stub.fetch('http://do/?action=check', {
        method: 'POST',
        body: JSON.stringify({ ...baseCheck, eventBudget: 2 }),
      });
    }

    const res = await handleQuotaStatus(statusReq(HARBOR_FP, { token: OPERATOR_TOKEN }), env, HARBOR_FP);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      harbor: string;
      mode: string;
      budgets: { dailyEvents: number; dailyBytes: number };
      counters: { events: number; shadowDeniedEvents: number };
      credit_ledger: string;
      billing: unknown;
    };
    expect(body.harbor).toBe(HARBOR_FP);
    expect(body.mode).toBe('shadow');
    expect(body.budgets.dailyEvents).toBe(2);
    expect(body.counters.events).toBe(5);
    expect(body.counters.shadowDeniedEvents).toBe(3);
    expect(body.credit_ledger).toBe(CREDIT_LEDGER_POINTER);
    expect(body.billing).toBeNull(); // no ?installation= → no billing read at all
  });

  it('?installation= pairs the counters with the CACHED balance (D1 read once, then cache)', async () => {
    const { kv } = makeKv();
    const billing = makeBillingDb({ n: 3, bal: 17.5 });
    const env = makeStatusEnv({ KV: kv, DB: billing.db });

    const first = await handleQuotaStatus(
      statusReq(HARBOR_FP, { token: OPERATOR_TOKEN, query: '?installation=42' }),
      env,
      HARBOR_FP,
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { billing: { balanceUsd: number; enrolled: boolean; stale: boolean } };
    expect(firstBody.billing).toMatchObject({ balanceUsd: 17.5, enrolled: true, stale: false });
    expect(billing.counters.reads).toBe(1);

    // Second read is served from KV — the ledger stays untouched.
    await handleQuotaStatus(statusReq(HARBOR_FP, { token: OPERATOR_TOKEN, query: '?installation=42' }), env, HARBOR_FP);
    expect(billing.counters.reads).toBe(1);

    const badInst = await handleQuotaStatus(
      statusReq(HARBOR_FP, { token: OPERATOR_TOKEN, query: '?installation=-1' }),
      env,
      HARBOR_FP,
    );
    expect(badInst.status).toBe(400);
  });
});

describe('getCachedBillingStatus — the ledger read stays off the hot path', () => {
  it('miss: ONE D1 read, then cached; fresh hit: zero D1 reads', async () => {
    const { kv } = makeKv();
    const billing = makeBillingDb({ n: 2, bal: 40 });
    const env = { KV: kv, DB: billing.db } as unknown as Env;

    const missRead = await getCachedBillingStatus(env, 7, { now: 1_000_000 });
    expect(missRead).toEqual({ balanceUsd: 40, enrolled: true, cachedAt: 1_000_000, stale: false });
    expect(billing.counters.reads).toBe(1);

    const hit = await getCachedBillingStatus(env, 7, { now: 1_000_000 + BILLING_STATUS_CACHE_TTL_SECONDS });
    expect(hit.balanceUsd).toBe(40);
    expect(hit.stale).toBe(false);
    expect(billing.counters.reads).toBe(1); // served from KV
  });

  it('stale hit: answers from cache IMMEDIATELY and refreshes via waitUntil in the background', async () => {
    const { kv, store } = makeKv();
    const billing = makeBillingDb({ n: 2, bal: 40 });
    const env = { KV: kv, DB: billing.db } as unknown as Env;
    await getCachedBillingStatus(env, 7, { now: 1_000_000 });

    const scheduled: Promise<unknown>[] = [];
    const staleNow = 1_000_000 + BILLING_STATUS_CACHE_TTL_SECONDS + 1;
    const staleRead = await getCachedBillingStatus(env, 7, {
      now: staleNow,
      waitUntil: (p) => scheduled.push(p),
    });
    // The stale answer came back without waiting on D1…
    expect(staleRead).toMatchObject({ balanceUsd: 40, cachedAt: 1_000_000, stale: true });
    expect(scheduled).toHaveLength(1);

    // …and the background refresh re-read the ledger and re-stamped the cache.
    await Promise.all(scheduled);
    expect(billing.counters.reads).toBe(2);
    const cached = JSON.parse(store.get('billing:status:7')!) as { fetchedAt: number };
    expect(cached.fetchedAt).toBe(staleNow);
  });
});
