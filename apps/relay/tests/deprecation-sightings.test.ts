/**
 * X6 sightings + lifecycle-gate tests (src/deprecations.ts, retention-sweep
 * wiring, scripts/check-sunsets.mjs):
 *   - recordDeprecationSighting: ONE fire-and-forget KV put keyed
 *     (deprecation, protocol, fingerprint) - no D1, never throws;
 *   - flushDeprecationSightings: KV drains into deprecation_sightings with
 *     the cardinality cap enforced (overflow folds into __overflow__);
 *   - the zero-identities-in-30-days deletion-policy query;
 *   - runRetentionSweep carries the flush (and skips cleanly without KV);
 *   - the CI pre-sunset gate demonstrated on synthetic sunset fixtures - the
 *     SAME function the ci.yml step runs against the real registry.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  DEPRECATIONS,
  recordDeprecationSighting,
  flushDeprecationSightings,
  countSightingsSince,
  surfaceRemovalAllowed,
  callerProtocol,
  callerFingerprint,
  SIGHTING_KV_PREFIX,
  SIGHTING_KV_TTL_SECONDS,
  OVERFLOW_FINGERPRINT,
  REMOVAL_QUIET_DAYS,
} from '../src/deprecations.js';
import { runRetentionSweep } from '../src/retention-sweep.js';
// @ts-expect-error - plain-node .mjs (the CI step runs it directly; no types)
import { checkSunsetGate, PRE_SUNSET_WINDOW_DAYS } from '../scripts/check-sunsets.mjs';
import type { Env } from '../src/types.js';

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;
const AUTH = DEPRECATIONS.find((d) => d.id === 'auth-unversioned')!;

interface KvPut { key: string; value: string; opts?: { expirationTtl?: number } }

function makeKv(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  const puts: KvPut[] = [];
  const kv = {
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      puts.push({ key, value, opts });
      store.set(key, value);
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix: string }) {
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true as const };
    },
  };
  return { store, puts, kv };
}

/** Stateful fake honouring the WHERE semantics of the sighting upsert (an
 *  SQL-pattern mock would let a broken cap pass silently). Retention DELETEs
 *  answer changes: 0 so the same fake backs the full-sweep integration test. */
function makeSightingsDb() {
  const rows = new Map<string, { last_seen: number; last_path: string | null }>();
  const sqls: string[] = [];
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...v: unknown[]) {
          binds = v;
          return stmt;
        },
        async first() {
          sqls.push(sql);
          if (sql.includes('WHERE deprecation_id')) {
            const depId = binds[0] as string;
            const horizon = binds[1] as number;
            let n = 0;
            for (const [k, v] of rows) {
              if (k.startsWith(depId + '|') && v.last_seen >= horizon) n++;
            }
            return { n };
          }
          return { n: rows.size };
        },
        async run() {
          sqls.push(sql);
          if (sql.startsWith('UPDATE deprecation_sightings')) {
            const lastSeen = binds[0] as number;
            const lastPath = binds[1] as string | null;
            const key = `${binds[2]}|${binds[3]}|${binds[4]}`;
            const existing = rows.get(key);
            if (!existing) return { meta: { changes: 0 } };
            rows.set(key, {
              last_seen: Math.max(existing.last_seen, lastSeen),
              last_path: lastPath,
            });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO deprecation_sightings')) {
            rows.set(`${binds[0]}|${binds[1]}|${binds[2]}`, {
              last_seen: binds[3] as number,
              last_path: binds[4] as string | null,
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  return { rows, sqls, db };
}

function envWith(db: unknown, kv?: unknown): Env {
  return { DB: db, KV: kv, EVENT_RETENTION_DAYS: '7' } as unknown as Env;
}

function sightingKey(proto: string, fp: string): string {
  return `${SIGHTING_KV_PREFIX}${AUTH.id}:${proto}:${fp}`;
}

const sightingValue = (lastSeen: number, path = '/auth/status') =>
  JSON.stringify({ last_seen: lastSeen, path });

describe('recordDeprecationSighting - cheap by construction', () => {
  const req = (headers?: Record<string, string>) =>
    new Request('https://relay.example/auth/status', { headers });

  it('writes ONE KV put keyed (deprecation, protocol, fingerprint) with a TTL', async () => {
    const { kv, puts } = makeKv();
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) } as unknown as ExecutionContext;
    const r = req({ Authorization: 'Bearer pdu_abc' });
    recordDeprecationSighting(envWith({}, kv), ctx, AUTH, r, NOW);
    await Promise.all(waited);
    expect(puts).toHaveLength(1);
    const put = puts[0]!;
    expect(put.key).toBe(sightingKey('unversioned', callerFingerprint(r)));
    expect(put.key.startsWith(SIGHTING_KV_PREFIX)).toBe(true);
    expect(JSON.parse(put.value)).toEqual({ last_seen: NOW, path: '/auth/status' });
    expect(put.opts?.expirationTtl).toBe(SIGHTING_KV_TTL_SECONDS);
  });

  it('fingerprints are pseudonymous, per-credential, and never the credential', () => {
    const a = callerFingerprint(req({ Authorization: 'Bearer pdu_aaa' }));
    const b = callerFingerprint(req({ Authorization: 'Bearer pdu_bbb' }));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('pdu_aaa');
    expect(callerFingerprint(req())).toBe('anon');
  });

  it('protocol comes from x-pd-protocol, sanitized into the key alphabet', () => {
    expect(callerProtocol(req())).toBe('unversioned');
    expect(callerProtocol(req({ 'x-pd-protocol': 'squid/1' }))).toBe('squid_1');
    expect(callerProtocol(req({ 'x-pd-protocol': 'hv:2 evil key' }))).toBe('hv_2_evil_key');
  });

  it('never throws: missing KV, rejecting put, bare test ctx', () => {
    expect(() =>
      recordDeprecationSighting(envWith({}, undefined), {} as ExecutionContext, AUTH, req(), NOW),
    ).not.toThrow();
    const rejectingKv = { put: () => Promise.reject(new Error('kv 429')) };
    expect(() =>
      recordDeprecationSighting(envWith({}, rejectingKv), {} as ExecutionContext, AUTH, req(), NOW),
    ).not.toThrow();
  });
});

describe('flushDeprecationSightings - KV drains to D1, cardinality-capped', () => {
  it('flushes buffered sightings into D1 and empties the KV buffer', async () => {
    const { store, kv } = makeKv({
      [sightingKey('unversioned', 'aaaa000000000000')]: sightingValue(NOW - 10),
      [sightingKey('squid_1', 'bbbb000000000000')]: sightingValue(NOW - 5, '/auth/whoami'),
    });
    const { rows, db } = makeSightingsDb();
    const r = await flushDeprecationSightings(envWith(db, kv));
    expect(r.errors).toEqual([]);
    expect(r.flushed).toBe(2);
    expect(r.inserted).toBe(2);
    expect(r.updated).toBe(0);
    expect(r.overflowed).toBe(0);
    expect(rows.get(`${AUTH.id}|unversioned|aaaa000000000000`)).toEqual({
      last_seen: NOW - 10,
      last_path: '/auth/status',
    });
    expect(rows.get(`${AUTH.id}|squid_1|bbbb000000000000`)?.last_path).toBe('/auth/whoami');
    expect(store.size).toBe(0); // buffer drained
  });

  it('an already-known identity UPDATEs last-seen (monotonic via MAX)', async () => {
    const { kv } = makeKv({
      [sightingKey('unversioned', 'aaaa000000000000')]: sightingValue(NOW - 100),
    });
    const { rows, db } = makeSightingsDb();
    rows.set(`${AUTH.id}|unversioned|aaaa000000000000`, { last_seen: NOW - 50, last_path: null });
    const r = await flushDeprecationSightings(envWith(db, kv));
    expect(r.updated).toBe(1);
    expect(r.inserted).toBe(0);
    // Fake honours MAX(last_seen, ?): the newer stored value wins.
    expect(rows.get(`${AUTH.id}|unversioned|aaaa000000000000`)?.last_seen).toBe(NOW - 50);
  });

  it('ENFORCES the cardinality cap: new identities beyond cap fold into __overflow__', async () => {
    const { kv } = makeKv({
      [sightingKey('unversioned', 'cccc000000000000')]: sightingValue(NOW - 3),
      [sightingKey('unversioned', 'dddd000000000000')]: sightingValue(NOW - 2),
      [sightingKey('unversioned', 'eeee000000000000')]: sightingValue(NOW - 1),
    });
    const { rows, db } = makeSightingsDb();
    const r = await flushDeprecationSightings(envWith(db, kv), { cap: 1 });
    expect(r.errors).toEqual([]);
    expect(r.flushed).toBe(3);
    expect(r.inserted).toBe(1);   // first new identity fills the cap
    expect(r.overflowed).toBe(2); // the rest fold into the overflow row
    const overflow = rows.get(`${AUTH.id}|unversioned|${OVERFLOW_FINGERPRINT}`);
    expect(overflow).toBeDefined();
    expect(overflow?.last_seen).toBe(NOW - 1); // MAX of the folded sightings
    // Cap held: exactly one real row + one overflow row, never three.
    expect(rows.size).toBe(2);
  });

  it('malformed KV entries are dropped, not fatal', async () => {
    const { store, kv } = makeKv({
      [sightingKey('unversioned', 'ffff000000000000')]: 'not json',
      [`${SIGHTING_KV_PREFIX}mangled`]: sightingValue(NOW),
    });
    const { rows, db } = makeSightingsDb();
    const r = await flushDeprecationSightings(envWith(db, kv));
    expect(r.flushed).toBe(0);
    expect(rows.size).toBe(0);
    expect(store.size).toBe(0); // junk deleted so it cannot wedge every sweep
  });

  it('returns zeros without a KV binding (unit-test envs)', async () => {
    const { db } = makeSightingsDb();
    const r = await flushDeprecationSightings(envWith(db, undefined));
    expect(r).toEqual({ listed: 0, flushed: 0, inserted: 0, updated: 0, overflowed: 0, errors: [] });
  });
});

describe('X6 deletion policy as a query (zero identities in 30 days)', () => {
  it('quiet surface: removal allowed', async () => {
    const { rows, db } = makeSightingsDb();
    rows.set(`${AUTH.id}|unversioned|old0000000000000`, {
      last_seen: NOW - (REMOVAL_QUIET_DAYS + 5) * DAY,
      last_path: null,
    });
    const verdict = await surfaceRemovalAllowed(db as never, AUTH.id, NOW);
    expect(verdict.allowed).toBe(true);
    expect(verdict.recentIdentities).toBe(0);
    expect(verdict.horizon).toBe(NOW - REMOVAL_QUIET_DAYS * DAY);
  });

  it('ANY identity inside the window blocks removal - overflow rows too', async () => {
    const { rows, db } = makeSightingsDb();
    rows.set(`${AUTH.id}|unversioned|${OVERFLOW_FINGERPRINT}`, {
      last_seen: NOW - 2 * DAY,
      last_path: null,
    });
    const verdict = await surfaceRemovalAllowed(db as never, AUTH.id, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict.recentIdentities).toBe(1);
  });

  it('counts are per-surface, not global', async () => {
    const { rows, db } = makeSightingsDb();
    rows.set(`billing-unversioned|unversioned|aaaa000000000000`, {
      last_seen: NOW - DAY,
      last_path: null,
    });
    expect(await countSightingsSince(db as never, AUTH.id, NOW - 30 * DAY)).toBe(0);
    expect(await countSightingsSince(db as never, 'billing-unversioned', NOW - 30 * DAY)).toBe(1);
  });
});

describe('retention sweep carries the sightings flush', () => {
  it('flushes buffered sightings during the sweep', async () => {
    const { kv } = makeKv({
      [sightingKey('unversioned', 'aaaa000000000000')]: sightingValue(NOW - 1),
    });
    const { rows, db } = makeSightingsDb();
    const r = await runRetentionSweep(envWith(db, kv), NOW);
    expect(r.errors).toEqual([]);
    expect(r.sightingsFlushed).toBe(1);
    expect(rows.size).toBe(1);
  });

  it('skips cleanly when the env has no KV binding', async () => {
    const { db } = makeSightingsDb();
    const r = await runRetentionSweep(envWith(db, undefined), NOW);
    expect(r.sightingsFlushed).toBe(0);
    expect(r.errors).toEqual([]);
  });
});

describe('CI pre-sunset gate (scripts/check-sunsets.mjs) on synthetic sunsets', () => {
  // 2026-08-09T00:00:00Z - the same injected-clock discipline as the sweep.
  const GATE_NOW = Math.floor(Date.parse('2026-08-09T00:00:00Z') / 1000);
  const entry = (over: Record<string, unknown>) => ({
    id: 'synthetic-surface',
    sunsetAt: '2026-08-12', // 3 days out - inside the 7-day window
    tombstoned: false,
    ...over,
  });

  it('FAILS inside the 7-day window without a tombstone', () => {
    const failures = checkSunsetGate([entry({})], GATE_NOW);
    expect(failures).toHaveLength(1);
    expect(failures[0].id).toBe('synthetic-surface');
    expect(failures[0].daysLeft).toBe(3);
    expect(failures[0].reason).toContain('tombstone');
  });

  it('FAILS after a sunset has passed without a tombstone', () => {
    const failures = checkSunsetGate([entry({ sunsetAt: '2026-08-01' })], GATE_NOW);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain('PAST');
  });

  it('passes outside the window (8 days out)', () => {
    expect(checkSunsetGate([entry({ sunsetAt: '2026-08-17' })], GATE_NOW)).toEqual([]);
  });

  it('a 410 tombstone satisfies the gate', () => {
    expect(checkSunsetGate([entry({ tombstoned: true })], GATE_NOW)).toEqual([]);
  });

  it('an extension commit (sunsetAt moved later) satisfies the gate', () => {
    expect(checkSunsetGate([entry({ sunsetAt: '2026-10-11' })], GATE_NOW)).toEqual([]);
  });

  it('surfaces with no scheduled sunset never trip the gate', () => {
    expect(checkSunsetGate([entry({ sunsetAt: null })], GATE_NOW)).toEqual([]);
  });

  it('the REAL registry passes today (exactly what the ci.yml step runs)', () => {
    const registry = JSON.parse(
      readFileSync(new URL('../src/deprecations.json', import.meta.url), 'utf8'),
    ) as { deprecations: Array<Record<string, unknown>> };
    expect(registry.deprecations.length).toBeGreaterThan(0);
    expect(checkSunsetGate(registry.deprecations, Math.floor(Date.now() / 1000))).toEqual([]);
    expect(PRE_SUNSET_WINDOW_DAYS).toBe(7);
  });
});
