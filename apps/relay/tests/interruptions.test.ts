/**
 * Tests for OPERATOR INTERRUPTIONS v1 — the HITL primitive (src/interruptions.ts).
 * Coverage, per the acceptance list:
 *   - state machine: open → acked|answered|expired only; terminal is terminal;
 *   - decay schedule math: urgency-based base, ×2 per stage, 6h cap, FULL
 *     JITTER (injected rand), MAX_NAGS hard stop → expired + one "gave up" page;
 *   - dedupe: next_nag_at / gave_up_paged_at only advance on DELIVERED pages —
 *     never two pages for the same stage; failed deliveries retry next sweep;
 *   - webhook resilience: ≤2 in-call retries with jitter, 4xx never retried,
 *     Retry-After honored, breaker opens after 3 consecutive failures;
 *   - per-operator page budget: overflow collapses into ONE digest per hour;
 *   - kill switch: KV interruptions:paused ⇒ the sweep no-ops;
 *   - creation rate limit: >5/h per source agent collapses into newest open;
 *   - session gating: answer/ack demand a session + ownership; create/list
 *     accept pdu_ bearer OR session; cross-user rows never leak;
 *   - escaping: stored titles/bodies/answers render inert on both HTML pages;
 *   - /mercy JSON gains openInterruptions.
 *
 * Injection-style mocks like mercy.test.ts: a stateful fake D1 whose rows
 * behave like the real table so consecutive sweeps exercise true transitions.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  canTransition,
  nagCeilingSeconds,
  nextNagDelaySeconds,
  runInterruptionNagSweep,
  handleCreateInterruption,
  handleListInterruptions,
  handleAnswerInterruption,
  handleAckInterruption,
  handleInterruptionsPage,
  renderInterruptionsPage,
  countOpenInterruptions,
  URGENCY_BASE_SECONDS,
  NAG_CAP_SECONDS,
  MAX_NAGS,
  PAGE_BUDGET_PER_HOUR,
  CREATE_LIMIT_PER_HOUR,
  INTERRUPTIONS_PAUSED_KEY,
  INTERRUPTIONS_BREAKER_KEY,
  type InterruptionRow,
  type InterruptionState,
  type InterruptionUrgency,
} from '../src/interruptions.js';
import { handleMercyStatus } from '../src/mercy.js';
import { renderAccountPage } from '../src/account-page.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';
import type { UserRow } from '../src/db.js';

const NOW = 1_800_000_000;
const WEBHOOK = 'https://hooks.example.test/hitl-routing-key';

// Deterministic sweep IO: mid-jitter rolls, no real sleeping.
const IO = { rand: () => 0.5, sleep: async () => {} };

// ── Fake infra ────────────────────────────────────────────────────────────────

const ok = (changes: number) => ({ success: true, meta: { changes } });

const URG_RANK: Record<string, number> = { low: 0, normal: 1, high: 2, critical: 3 };

function baseUser(id: string, login: string): UserRow {
  return {
    id,
    github_user_id: 1,
    login,
    display_name: null,
    avatar_url: null,
    primary_email: null,
    email_verified: 0,
    created_at: NOW,
    last_login_at: null,
    deleted_at: null,
  } as UserRow;
}

interface FakePage {
  id: string;
  user_id: string;
  kind: string;
  sent_at: number;
}

/**
 * Stateful fake D1 covering every statement interruptions.ts (plus session /
 * pdu_-token resolution) issues, dispatched on SQL substrings — the same idiom
 * as mercy.test.ts. Sorting mirrors the real ORDER BY clauses.
 */
function makeDb() {
  const rows: InterruptionRow[] = [];
  const pages: FakePage[] = [];
  const users = new Map<string, UserRow>();
  const tokens = new Map<string, { user_id: string; expires_at: number | null; revoked_at: number | null }>();
  const sessions = new Map<string, { user_id: string; expires_at: number }>();

  const openSorted = (userId: string) =>
    rows
      .filter((r) => r.user_id === userId && r.state === 'open')
      .sort(
        (a, b) =>
          (URG_RANK[b.urgency] ?? 0) - (URG_RANK[a.urgency] ?? 0) || a.created_at - b.created_at,
      );

  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const s = {
        bind(...v: unknown[]) {
          args = v;
          return s;
        },
        async first() {
          if (sql.includes('FROM web_sessions')) {
            return sessions.get(args[0] as string) ?? null;
          }
          if (sql.includes('FROM users')) {
            const u = users.get(args[0] as string);
            return u && u.deleted_at === null ? u : null;
          }
          if (sql.includes('FROM user_tokens') && sql.startsWith('SELECT')) {
            return tokens.get(args[0] as string) ?? null;
          }
          if (sql.includes('COUNT(*)') && sql.includes('FROM interruption_pages')) {
            const digestOnly = sql.includes("kind = 'digest'");
            const [userId, since] = args as [string, number];
            const n = pages.filter(
              (p) => p.user_id === userId && p.sent_at >= since && (!digestOnly || p.kind === 'digest'),
            ).length;
            return { n };
          }
          if (sql.includes('COUNT(*)') && sql.includes('FROM operator_interruptions')) {
            if (sql.includes('source_agent')) {
              const [userId, agent, since] = args as [string, string, number];
              return {
                n: rows.filter(
                  (r) => r.user_id === userId && r.source_agent === agent && r.created_at >= since,
                ).length,
              };
            }
            if (sql.includes('user_id')) {
              const userId = args[0] as string;
              return { n: rows.filter((r) => r.user_id === userId && r.state === 'open').length };
            }
            return { n: rows.filter((r) => r.state === 'open').length };
          }
          if (sql.includes('FROM operator_interruptions WHERE id')) {
            return rows.find((r) => r.id === args[0]) ?? null;
          }
          if (sql.includes("state = 'open' ORDER BY created_at DESC")) {
            const [userId, agent] = args as [string, string];
            const list = rows
              .filter((r) => r.user_id === userId && r.source_agent === agent && r.state === 'open')
              .sort((a, b) => b.created_at - a.created_at);
            return list[0] ?? null;
          }
          if (sql.includes('ORDER BY CASE urgency')) {
            return openSorted(args[0] as string)[0] ?? null;
          }
          return null;
        },
        async all() {
          if (sql.includes("state = 'open' AND next_nag_at <= ?")) {
            const now = args[0] as number;
            return {
              results: rows
                .filter((r) => r.state === 'open' && r.next_nag_at <= now)
                .sort((a, b) => a.user_id.localeCompare(b.user_id) || a.created_at - b.created_at),
            };
          }
          if (sql.includes("state = 'expired' AND gave_up_paged_at IS NULL")) {
            const since = args[0] as number;
            return {
              results: rows.filter(
                (r) => r.state === 'expired' && r.gave_up_paged_at === null && (r.closed_at ?? 0) >= since,
              ),
            };
          }
          if (sql.includes("state != 'open'")) {
            const userId = args[0] as string;
            return {
              results: rows
                .filter((r) => r.user_id === userId && r.state !== 'open')
                .sort((a, b) => (b.closed_at ?? 0) - (a.closed_at ?? 0)),
            };
          }
          if (sql.includes('user_id = ? AND state = ?')) {
            const [userId, state] = args as [string, string];
            return {
              results: rows
                .filter((r) => r.user_id === userId && r.state === state)
                .sort(
                  (a, b) =>
                    (URG_RANK[b.urgency] ?? 0) - (URG_RANK[a.urgency] ?? 0) || a.created_at - b.created_at,
                ),
            };
          }
          if (sql.includes('ORDER BY CASE urgency')) {
            return { results: openSorted(args[0] as string) };
          }
          if (sql.includes('WHERE user_id = ? ORDER BY created_at DESC')) {
            const userId = args[0] as string;
            return {
              results: rows
                .filter((r) => r.user_id === userId)
                .sort((a, b) => b.created_at - a.created_at),
            };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO operator_interruptions')) {
            const [id, userId, instId, agent, session, title, body, urgency, createdAt, nextNagAt] =
              args as [string, string, number | null, string, string | null, string, string, string, number, number];
            rows.push({
              id,
              user_id: userId,
              installation_id: instId,
              source_agent: agent,
              source_session: session,
              title,
              body,
              urgency: urgency as InterruptionUrgency,
              state: 'open',
              answer: null,
              created_at: createdAt,
              last_nagged_at: null,
              nag_count: 0,
              decay_stage: 0,
              next_nag_at: nextNagAt,
              closed_at: null,
              gave_up_paged_at: null,
            });
            return ok(1);
          }
          if (sql.includes("SET state = 'expired'")) {
            const [closedAt, id] = args as [number, string];
            const r = rows.find((x) => x.id === id);
            if (!r || r.state !== 'open') return ok(0);
            r.state = 'expired';
            r.closed_at = closedAt;
            return ok(1);
          }
          if (sql.includes('nag_count = nag_count + 1')) {
            const [stage, now, nextAt, id] = args as [number, number, number, string];
            const r = rows.find((x) => x.id === id);
            if (!r) return ok(0);
            r.nag_count += 1;
            r.decay_stage = stage;
            r.last_nagged_at = now;
            r.next_nag_at = nextAt;
            return ok(1);
          }
          if (sql.includes('SET gave_up_paged_at')) {
            const id = args[args.length - 1] as string;
            const r = rows.find((x) => x.id === id);
            if (!r) return ok(0);
            r.gave_up_paged_at = args[0] as number;
            if (sql.includes('last_nagged_at')) r.last_nagged_at = args[1] as number;
            return ok(1);
          }
          if (sql.includes('SET state = ?, answer = ?')) {
            const [to, answer, closedAt, id] = args as [InterruptionState, string | null, number, string];
            const r = rows.find((x) => x.id === id);
            if (!r || r.state !== 'open') return ok(0);
            r.state = to;
            r.answer = answer;
            r.closed_at = closedAt;
            return ok(1);
          }
          if (sql.includes('INSERT INTO interruption_pages')) {
            const [id, userId, kind, sentAt] = args as [string, string, string, number];
            pages.push({ id, user_id: userId, kind, sent_at: sentAt });
            return ok(1);
          }
          return ok(0); // prune DELETEs, last_used_at bumps, etc.
        },
      };
      return s;
    },
  };
  return { db: db as unknown as D1Database, rows, pages, users, tokens, sessions };
}

function makeKv() {
  const store = new Map<string, string>();
  return {
    kv: {
      async get(k: string) {
        return store.get(k) ?? null;
      },
      async put(k: string, v: string) {
        store.set(k, v);
      },
      async delete(k: string) {
        store.delete(k);
      },
    } as unknown as KVNamespace,
    store,
  };
}

function makeEnv(db: D1Database, kv: KVNamespace, over: Partial<Record<keyof Env, unknown>> = {}): Env {
  return { DB: db, KV: kv, RELAY_VERSION: '0.1.0-test', ...over } as unknown as Env;
}

/** Seed one open interruption row directly into the fake store. */
function seed(
  rows: InterruptionRow[],
  over: Partial<InterruptionRow> = {},
): InterruptionRow {
  const row: InterruptionRow = {
    id: `oi_${(rows.length + 1).toString(16).padStart(4, '0')}`,
    user_id: 'u1',
    installation_id: null,
    source_agent: 'fleet-executor/purser',
    source_session: 'run:test',
    title: 'Grant contents:write',
    body: 'The App cannot push the test branch.',
    urgency: 'critical',
    state: 'open',
    answer: null,
    created_at: NOW - 600,
    last_nagged_at: null,
    nag_count: 0,
    decay_stage: 0,
    next_nag_at: NOW - 1,
    closed_at: null,
    gave_up_paged_at: null,
    ...over,
  };
  rows.push(row);
  return row;
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

/** Stub fetch with a per-call status script (last status repeats). */
function stubFetch(statuses: number[] = [202], headers: Record<string, string> = {}) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const status = statuses[Math.min(calls.length, statuses.length - 1)] ?? 202;
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return new Response('x', { status, headers });
    }),
  );
  return calls;
}

const PDU = `pdu_${'ab'.repeat(32)}`;

function bearerReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${PDU}` },
  });
}

function sessionReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Cookie: '__Host-pd_session=sess-1' },
  });
}

/** Wire a live pdu_ token + web session for user u1 into the fake db. */
function authAs(f: ReturnType<typeof makeDb>, userId = 'u1', login = 'skipper') {
  const nowSec = Math.floor(Date.now() / 1000);
  f.users.set(userId, baseUser(userId, login));
  f.tokens.set(hashHex(PDU), { user_id: userId, expires_at: null, revoked_at: null });
  f.sessions.set(hashHex('sess-1'), { user_id: userId, expires_at: nowSec + 3600 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1. State machine ─────────────────────────────────────────────────────────

describe('canTransition (state machine)', () => {
  it('open may close as acked, answered, or expired', () => {
    expect(canTransition('open', 'acked')).toBe(true);
    expect(canTransition('open', 'answered')).toBe(true);
    expect(canTransition('open', 'expired')).toBe(true);
  });

  it('terminal states are terminal, and nothing reopens', () => {
    const terminal: InterruptionState[] = ['acked', 'answered', 'expired'];
    for (const from of terminal) {
      for (const to of ['open', 'acked', 'answered', 'expired'] as InterruptionState[]) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
    expect(canTransition('open', 'open')).toBe(false);
  });
});

// ── 2. Decay schedule math ───────────────────────────────────────────────────

describe('decay schedule math (full jitter)', () => {
  it('stage ceilings double per stage from the urgency base', () => {
    expect(nagCeilingSeconds('critical', 0)).toBe(URGENCY_BASE_SECONDS.critical);
    expect(nagCeilingSeconds('critical', 1)).toBe(URGENCY_BASE_SECONDS.critical * 2);
    expect(nagCeilingSeconds('high', 2)).toBe(URGENCY_BASE_SECONDS.high * 4);
    expect(nagCeilingSeconds('low', 0)).toBe(URGENCY_BASE_SECONDS.low);
  });

  it('the ceiling caps at 6h — even at absurd stages', () => {
    expect(nagCeilingSeconds('low', 5)).toBe(NAG_CAP_SECONDS);
    expect(nagCeilingSeconds('normal', 10)).toBe(NAG_CAP_SECONDS);
    expect(nagCeilingSeconds('critical', 100)).toBe(NAG_CAP_SECONDS); // no overflow
  });

  it('urgency orders the base delays: critical < high < normal < low', () => {
    expect(URGENCY_BASE_SECONDS.critical).toBeLessThan(URGENCY_BASE_SECONDS.high);
    expect(URGENCY_BASE_SECONDS.high).toBeLessThan(URGENCY_BASE_SECONDS.normal);
    expect(URGENCY_BASE_SECONDS.normal).toBeLessThan(URGENCY_BASE_SECONDS.low);
  });

  it('FULL JITTER: delay = random(0, ceiling), never a fixed offset', () => {
    // rand → 0.5 lands mid-window; rand → ~1 lands at the ceiling; rand → 0
    // floors at 1s (never re-nag inside the same sweep).
    expect(nextNagDelaySeconds('critical', 0, () => 0.5)).toBe(150);
    expect(nextNagDelaySeconds('critical', 1, () => 0.999999)).toBe(
      Math.floor(0.999999 * 600),
    );
    expect(nextNagDelaySeconds('low', 0, () => 0)).toBe(1);
    // Two different rolls give two different offsets — no thundering herd.
    expect(nextNagDelaySeconds('normal', 0, () => 0.2)).not.toBe(
      nextNagDelaySeconds('normal', 0, () => 0.9),
    );
  });
});

// ── 3. The nag sweep: delivery, dedupe, hard stop ────────────────────────────

describe('runInterruptionNagSweep', () => {
  it('pages a due ask once, advances its stage, and never re-pages the same stage', async () => {
    const calls = stubFetch([202]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK });
    const row = seed(f.rows);

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.nagsSent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(WEBHOOK);
    expect(calls[0]!.body.kind).toBe('nag');
    expect(calls[0]!.body.interruption_id).toBe(row.id);
    expect(calls[0]!.body.title).toBe(row.title);
    expect(row.nag_count).toBe(1);
    expect(row.decay_stage).toBe(1);
    expect(row.last_nagged_at).toBe(NOW);
    // stage-1 ceiling for critical = 600s; rand 0.5 ⇒ due again at NOW+300.
    expect(row.next_nag_at).toBe(NOW + 300);

    // A sweep before the jittered due time pages NOTHING (the stage dedupe).
    const r2 = await runInterruptionNagSweep(env, NOW + 60, IO);
    expect(r2.nagsSent).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('a FAILED delivery does NOT advance the stage — retried next sweep, same stage', async () => {
    const failing = stubFetch([500]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK });
    const row = seed(f.rows);

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.nagsSent).toBe(0);
    expect(row.nag_count).toBe(0);
    expect(row.next_nag_at).toBe(NOW - 1); // unchanged — same stage stays due
    expect(failing).toHaveLength(3); // 1 attempt + 2 in-call full-jitter retries

    vi.unstubAllGlobals();
    const okCalls = stubFetch([202]);
    const r2 = await runInterruptionNagSweep(env, NOW + 300, IO);
    expect(r2.nagsSent).toBe(1);
    expect(okCalls).toHaveLength(1);
    expect(row.nag_count).toBe(1); // delivered exactly once for stage 0
  });

  it('4xx is NEVER retried in-call', async () => {
    const calls = stubFetch([400]);
    const f = makeDb();
    const { kv } = makeKv();
    seed(f.rows);
    const r = await runInterruptionNagSweep(makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK }), NOW, IO);
    expect(r.nagsSent).toBe(0);
    expect(calls).toHaveLength(1); // one attempt, zero retries
  });

  it('HARD STOP: after MAX_NAGS delivered nags the ask expires with ONE final "gave up" page', async () => {
    const calls = stubFetch([202]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK });
    const row = seed(f.rows, { nag_count: MAX_NAGS, decay_stage: MAX_NAGS });

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.expired).toBe(1);
    expect(r1.gaveUpSent).toBe(1);
    expect(row.state).toBe('expired');
    expect(row.closed_at).toBe(NOW);
    expect(row.gave_up_paged_at).toBe(NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.kind).toBe('gave-up');

    // Expired + already paged ⇒ eternal silence.
    const r2 = await runInterruptionNagSweep(env, NOW + 3600, IO);
    expect(r2.gaveUpSent + r2.nagsSent + r2.digestsSent).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('expiry happens even with NO webhook configured — silence never keeps a dead ask alive', async () => {
    const calls = stubFetch([202]);
    const f = makeDb();
    const { kv } = makeKv();
    const row = seed(f.rows, { nag_count: MAX_NAGS });
    const r = await runInterruptionNagSweep(makeEnv(f.db, kv), NOW, IO);
    expect(r.expired).toBe(1);
    expect(row.state).toBe('expired');
    expect(calls).toHaveLength(0); // nobody paged — honestly
  });

  it('an answered ask is silenced instantly — the sweep never touches non-open rows', async () => {
    const calls = stubFetch([202]);
    const f = makeDb();
    const { kv } = makeKv();
    seed(f.rows, { state: 'answered', answer: 'use the other repo', closed_at: NOW - 10 });
    seed(f.rows, { state: 'acked', closed_at: NOW - 10 });
    const r = await runInterruptionNagSweep(makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK }), NOW, IO);
    expect(r.nagsSent).toBe(0);
    expect(r.expired).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('KILL SWITCH: KV interruptions:paused ⇒ the sweep no-ops entirely', async () => {
    const calls = stubFetch([202]);
    const f = makeDb();
    const { kv, store } = makeKv();
    store.set(INTERRUPTIONS_PAUSED_KEY, '1');
    seed(f.rows);
    const r = await runInterruptionNagSweep(makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK }), NOW, IO);
    expect(r.paused).toBe(true);
    expect(r.nagsSent).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

// ── 4. Breaker + Retry-After ─────────────────────────────────────────────────

describe('webhook circuit breaker', () => {
  it('opens after 3 consecutive delivery failures and skips the next sweep cycle', async () => {
    const failing = stubFetch([500]);
    const f = makeDb();
    const { kv, store } = makeKv();
    const env = makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK });
    seed(f.rows, { id: 'oi_a' });
    seed(f.rows, { id: 'oi_b' });
    seed(f.rows, { id: 'oi_c' });
    seed(f.rows, { id: 'oi_d' }); // never attempted — breaker trips before it

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.nagsSent).toBe(0);
    // 3 deliveries × 3 in-call attempts; the 4th candidate is never attempted.
    expect(failing).toHaveLength(9);
    const breaker = JSON.parse(store.get(INTERRUPTIONS_BREAKER_KEY)!) as { openUntil: number };
    expect(breaker.openUntil).toBe(NOW + 300); // one sweep cycle

    // While open: fail fast, zero fetches.
    const r2 = await runInterruptionNagSweep(env, NOW + 60, IO);
    expect(r2.breakerOpen).toBe(true);
    expect(failing).toHaveLength(9);

    // After openUntil: probes again and delivers.
    vi.unstubAllGlobals();
    const okCalls = stubFetch([202]);
    const r3 = await runInterruptionNagSweep(env, NOW + 301, IO);
    expect(r3.breakerOpen).toBe(false);
    expect(r3.nagsSent).toBe(4);
    expect(okCalls).toHaveLength(4);
  });

  it('honors Retry-After on 429: no in-call retry, breaker parks that long', async () => {
    const calls = stubFetch([429], { 'Retry-After': '900' });
    const f = makeDb();
    const { kv, store } = makeKv();
    seed(f.rows);
    await runInterruptionNagSweep(makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK }), NOW, IO);
    expect(calls).toHaveLength(1); // 429 is 4xx — never retried in-call
    const breaker = JSON.parse(store.get(INTERRUPTIONS_BREAKER_KEY)!) as { openUntil: number };
    expect(breaker.openUntil).toBe(NOW + 900);
  });
});

// ── 5. Per-operator page budget → digest ─────────────────────────────────────

describe('per-operator page budget', () => {
  it('overflow collapses into ONE digest page that advances every collapsed stage', async () => {
    const calls = stubFetch([202]);
    const f = makeDb();
    const { kv } = makeKv();
    const env = makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK });
    // More due asks than the hourly budget allows.
    for (let i = 0; i < PAGE_BUDGET_PER_HOUR + 1; i++) {
      seed(f.rows, { id: `oi_${i}`, title: `ask ${i}`, created_at: NOW - 600 + i });
    }

    const r1 = await runInterruptionNagSweep(env, NOW, IO);
    expect(r1.digestsSent).toBe(1);
    expect(r1.nagsSent).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.kind).toBe('digest');
    expect(calls[0]!.body.open_count).toBe(PAGE_BUDGET_PER_HOUR + 1);
    expect(calls[0]!.body.top_title).toBe('ask 0'); // oldest at equal urgency
    // Every collapsed ask advanced — none re-fires at the same stage.
    for (const row of f.rows) expect(row.nag_count).toBe(1);

    // Force everything due again immediately: at most ONE digest per hour.
    for (const row of f.rows) row.next_nag_at = NOW + 1;
    const r2 = await runInterruptionNagSweep(env, NOW + 2, IO);
    expect(r2.digestsSent).toBe(0);
    expect(calls).toHaveLength(1); // quiet — budget + digest dedupe hold
  });

  it('within budget, each due ask gets its own page', async () => {
    const calls = stubFetch([202]);
    const f = makeDb();
    const { kv } = makeKv();
    seed(f.rows, { id: 'oi_a', title: 'a' });
    seed(f.rows, { id: 'oi_b', title: 'b' });
    const r = await runInterruptionNagSweep(makeEnv(f.db, kv, { MERCY_PAGE_WEBHOOK: WEBHOOK }), NOW, IO);
    expect(r.digestsSent).toBe(0);
    expect(r.nagsSent).toBe(2);
    expect(calls).toHaveLength(2);
  });
});

// ── 6. Create + list (bearer or session) ─────────────────────────────────────

describe('POST /v1/interruptions (create)', () => {
  it('rejects unauthenticated callers', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    const res = await handleCreateInterruption(
      new Request('https://relay.example/v1/interruptions', {
        method: 'POST',
        body: JSON.stringify({ title: 'x' }),
      }),
      makeEnv(f.db, kv),
    );
    expect(res.status).toBe(401);
  });

  it('creates an open ask for a pdu_ bearer with a jittered first nag inside the urgency base', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const res = await handleCreateInterruption(
      bearerReq('https://relay.example/v1/interruptions', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Grant contents:write',
          body: 'Cannot stack tests.',
          urgency: 'critical',
          source_agent: 'fleet-executor/purser',
          source_session: 'run:abc',
        }),
      }),
      makeEnv(f.db, kv),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { collapsed: boolean; interruption: { state: string; urgency: string } };
    expect(body.collapsed).toBe(false);
    expect(body.interruption.state).toBe('open');
    expect(body.interruption.urgency).toBe('critical');
    const row = f.rows[0]!;
    expect(row.next_nag_at).toBeGreaterThan(row.created_at);
    expect(row.next_nag_at).toBeLessThanOrEqual(row.created_at + URGENCY_BASE_SECONDS.critical);
  });

  it('rejects a missing title and defaults unknown urgency to normal', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const bad = await handleCreateInterruption(
      bearerReq('https://relay.example/v1/interruptions', { method: 'POST', body: JSON.stringify({}) }),
      makeEnv(f.db, kv),
    );
    expect(bad.status).toBe(400);
    const okRes = await handleCreateInterruption(
      bearerReq('https://relay.example/v1/interruptions', {
        method: 'POST',
        body: JSON.stringify({ title: 't', urgency: 'apocalyptic' }),
      }),
      makeEnv(f.db, kv),
    );
    expect(okRes.status).toBe(201);
    expect(f.rows[0]!.urgency).toBe('normal');
  });

  it(`rate limit: past ${CREATE_LIMIT_PER_HOUR}/h per source agent, creation collapses into the newest open ask`, async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const env = makeEnv(f.db, kv);
    const nowSec = Math.floor(Date.now() / 1000);
    for (let i = 0; i < CREATE_LIMIT_PER_HOUR; i++) {
      seed(f.rows, {
        id: `oi_seed_${i}`,
        source_agent: 'looper',
        created_at: nowSec - 100 + i,
        state: i === CREATE_LIMIT_PER_HOUR - 1 ? 'open' : 'acked',
        closed_at: i === CREATE_LIMIT_PER_HOUR - 1 ? null : nowSec - 50,
      });
    }
    const res = await handleCreateInterruption(
      bearerReq('https://relay.example/v1/interruptions', {
        method: 'POST',
        body: JSON.stringify({ title: 'again!', source_agent: 'looper' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collapsed: boolean; interruption: { id: string } };
    expect(body.collapsed).toBe(true);
    expect(body.interruption.id).toBe(`oi_seed_${CREATE_LIMIT_PER_HOUR - 1}`);
    expect(f.rows).toHaveLength(CREATE_LIMIT_PER_HOUR); // nothing new inserted

    // Same rate-hit but NO open ask to collapse into ⇒ honest 429.
    f.rows[CREATE_LIMIT_PER_HOUR - 1]!.state = 'acked';
    const res2 = await handleCreateInterruption(
      bearerReq('https://relay.example/v1/interruptions', {
        method: 'POST',
        body: JSON.stringify({ title: 'again!!', source_agent: 'looper' }),
      }),
      env,
    );
    expect(res2.status).toBe(429);
  });
});

describe('GET /v1/interruptions (poll)', () => {
  it('returns only the authenticated operator’s rows, filtered by state', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    seed(f.rows, { id: 'oi_mine', user_id: 'u1' });
    seed(f.rows, { id: 'oi_mine_closed', user_id: 'u1', state: 'answered', closed_at: NOW });
    seed(f.rows, { id: 'oi_theirs', user_id: 'u2', title: 'SECRET OTHER TENANT' });

    const res = await handleListInterruptions(
      bearerReq('https://relay.example/v1/interruptions?state=open'),
      makeEnv(f.db, kv),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openCount: number; interruptions: Array<{ id: string }> };
    expect(body.openCount).toBe(1);
    expect(body.interruptions.map((i) => i.id)).toEqual(['oi_mine']);
    expect(JSON.stringify(body)).not.toContain('SECRET OTHER TENANT');
  });

  it('rejects an invalid state filter and unauthenticated polls', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const bad = await handleListInterruptions(
      bearerReq('https://relay.example/v1/interruptions?state=bogus'),
      makeEnv(f.db, kv),
    );
    expect(bad.status).toBe(400);
    const anon = await handleListInterruptions(
      new Request('https://relay.example/v1/interruptions?state=open'),
      makeEnv(f.db, kv),
    );
    expect(anon.status).toBe(401);
  });
});

// ── 7. Answer / ack — session-gated ──────────────────────────────────────────

describe('answer + ack (session-gated)', () => {
  it('demands a browser session — a pdu_ bearer alone is NOT enough', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const row = seed(f.rows);
    const res = await handleAnswerInterruption(
      bearerReq(`https://relay.example/v1/interruptions/${row.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer: 'do it' }),
      }),
      makeEnv(f.db, kv),
      row.id,
    );
    expect(res.status).toBe(401);
    expect(row.state).toBe('open');
  });

  it('a foreign user’s interruption 404s — ownership never leaks', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f); // session is u1
    const row = seed(f.rows, { user_id: 'u2' });
    const res = await handleAckInterruption(
      sessionReq(`https://relay.example/v1/interruptions/${row.id}/ack`, { method: 'POST' }),
      makeEnv(f.db, kv),
      row.id,
    );
    expect(res.status).toBe(404);
    expect(row.state).toBe('open');
  });

  it('a plain HTML form answer closes the ask and 303s back to the list', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const row = seed(f.rows);
    const res = await handleAnswerInterruption(
      sessionReq(`https://relay.example/v1/interruptions/${row.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'answer=Use+the+staging+repo+instead',
      }),
      makeEnv(f.db, kv),
      row.id,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/interruptions');
    expect(row.state).toBe('answered');
    expect(row.answer).toBe('Use the staging repo instead');
    expect(row.closed_at).not.toBeNull();
  });

  it('an empty answer is rejected; acking needs no body; closing twice conflicts', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const row = seed(f.rows);
    const env = makeEnv(f.db, kv);

    const empty = await handleAnswerInterruption(
      sessionReq(`https://relay.example/v1/interruptions/${row.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'answer=',
      }),
      env,
      row.id,
    );
    expect(empty.status).toBe(400);

    const ack = await handleAckInterruption(
      sessionReq(`https://relay.example/v1/interruptions/${row.id}/ack`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      env,
      row.id,
    );
    expect(ack.status).toBe(200);
    expect(row.state).toBe('acked');

    const again = await handleAnswerInterruption(
      sessionReq(`https://relay.example/v1/interruptions/${row.id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer: 'too late' }),
      }),
      env,
      row.id,
    );
    expect(again.status).toBe(409);
    expect(row.state).toBe('acked'); // unchanged
  });

  it('refuses cross-origin form posts (CSRF guard)', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const row = seed(f.rows);
    const res = await handleAckInterruption(
      sessionReq(`https://relay.example/v1/interruptions/${row.id}/ack`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
      }),
      makeEnv(f.db, kv, { PUBLIC_BASE_URL: 'https://relay.example' }),
      row.id,
    );
    expect(res.status).toBe(403);
    expect(row.state).toBe('open');
  });
});

// ── 8. HTML surfaces + escaping ──────────────────────────────────────────────

describe('/account/interruptions page', () => {
  it('redirects to /login without a session', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    const res = await handleInterruptionsPage(
      new Request('https://relay.example/account/interruptions'),
      makeEnv(f.db, kv),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('renders open asks with plain no-JS answer/ack forms under a script-free CSP', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    authAs(f);
    const row = seed(f.rows);
    const res = await handleInterruptionsPage(
      sessionReq('https://relay.example/account/interruptions'),
      makeEnv(f.db, kv),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain(`action="/v1/interruptions/${row.id}/answer"`);
    expect(html).toContain(`action="/v1/interruptions/${row.id}/ack"`);
    expect(html).toContain('method="post"');
    expect(html).not.toContain('<script'); // no JS anywhere
    expect(html).toContain('Open asks (1)');
  });

  it('escapes hostile titles, bodies and answers (XSS guard)', () => {
    const open = [
      {
        ...seed([], {
          title: '<script>alert(1)</script>',
          body: '"><img src=x onerror=alert(2)>',
        }),
      },
    ];
    const closed = [
      {
        ...seed([], {
          state: 'answered' as const,
          answer: "'};alert(3);//",
          closed_at: NOW,
        }),
      },
    ];
    const html = renderInterruptionsPage(open, closed);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&quot;&gt;&lt;img');
    expect(html).toContain('&#39;};alert(3);//');
  });

  it('teaches with an empty state when no agent is waiting (no Potemkin asks)', () => {
    const html = renderInterruptionsPage([], []);
    expect(html).toContain('No agent is waiting on you');
    expect(html).toContain('Open asks (0)');
  });
});

describe('/account banner', () => {
  const user = baseUser('u1', 'skipper');

  it('shows a red interruptions banner with count + top item when asks are open', () => {
    const html = renderAccountPage(user, { interruptions: { count: 3, topTitle: 'Grant contents:write' } });
    expect(html).toContain('class="interrupt-banner"');
    expect(html).toContain('3 open asks awaiting a human');
    expect(html).toContain('Grant contents:write');
    expect(html).toContain('href="/account/interruptions"');
  });

  it('escapes the top title and renders NO banner when nothing is open', () => {
    const hostile = renderAccountPage(user, { interruptions: { count: 1, topTitle: '<script>x</script>' } });
    expect(hostile).not.toContain('<script>x</script>');
    expect(hostile).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(renderAccountPage(user, { interruptions: { count: 0, topTitle: null } })).not.toContain('class="interrupt-banner"');
    expect(renderAccountPage(user)).not.toContain('class="interrupt-banner"');
  });
});

// ── 9. /mercy JSON surface ───────────────────────────────────────────────────

describe('/mercy openInterruptions', () => {
  it('counts open asks (and only open asks) on the public status JSON', async () => {
    const f = makeDb();
    const { kv } = makeKv();
    seed(f.rows, { id: 'oi_1' });
    seed(f.rows, { id: 'oi_2', user_id: 'u2' });
    seed(f.rows, { id: 'oi_3', state: 'answered', closed_at: NOW });
    expect(await countOpenInterruptions(f.db)).toBe(2);

    const res = await handleMercyStatus(makeEnv(f.db, kv));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openInterruptions: number | null };
    expect(body.openInterruptions).toBe(2);
  });
});
