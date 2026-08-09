/**
 * Tests for the Shipwright chat daily spend caps (grand-plan §chat-spend-caps).
 * Coverage, per the node's gate:
 *   - ENFORCEMENT AT THE BOUNDARY: a spent budget (messages OR estimated
 *     tokens) refuses the turn with 429 + code SPEND_CAP BEFORE the model is
 *     ever invoked; one-under-the-cap still passes.
 *   - RETRY-AFTER: the 429 carries a `Retry-After` header — a positive number
 *     of seconds, never more than a day (the window is the UTC day).
 *   - NO HALF-SPENT TURNS: a refused user message is NOT persisted and the
 *     spend counter is NOT advanced — refusal stores nothing, spends nothing.
 *   - ROLLOVER RESET: the counter is keyed by UTC-day window_start, so a
 *     budget exhausted yesterday reads as zero today (new key ⇒ no row).
 *   - SERVER-OWNED CAPS: env vars override the committed defaults; garbage or
 *     unset knobs fall back fail-safe (never "unlimited"); nothing in the
 *     request body reaches the caps.
 *   - ACCOUNTING: an accepted turn upserts +1 message / +estimate tokens
 *     under (session user, current window) before the model call.
 *   - SWEEP: the retention sweep prunes aged counter rows and defensively
 *     purges soft-deleted users' rows; eraseUser purges them immediately.
 *   - PAGE: the honesty strip states the budget in force (a refusal is never
 *     the first the operator hears of it).
 *
 * Idioms follow shipwright.test.ts: hand-rolled D1 mock answering exactly the
 * queries these paths issue, recording every SQL + binds for assertions.
 */

import { describe, it, expect } from 'vitest';
import {
  handleShipwrightChat,
  shipwrightDailyCaps,
  spendWindowStart,
  estimateTurnTokens,
  spendCapNotice,
  SHIPWRIGHT_DAILY_MESSAGES_DEFAULT,
  SHIPWRIGHT_DAILY_TOKENS_DEFAULT,
} from '../src/shipwright.js';
import { renderShipwrightPage } from '../src/shipwright-page.js';
import { eraseUser, getShipwrightSpend, addShipwrightSpend, type UserRow } from '../src/db.js';
import {
  runRetentionSweep,
  SHIPWRIGHT_SPEND_RETENTION_DAYS,
} from '../src/retention-sweep.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const COOKIE_VALUE = 'sess-value-abc';
const DAY = 24 * 60 * 60;

const baseUser: UserRow = {
  id: 'u_1',
  github_user_id: 1,
  login: 'octocat',
  display_name: 'Octo Cat',
  avatar_url: null,
  primary_email: null,
  email_verified: 0,
  created_at: 0,
  last_login_at: 0,
  deleted_at: null,
};

interface Call {
  sql: string;
  binds: unknown[];
}

/**
 * D1 mock for the capped-chat paths: session lookup, user lookup, the
 * shipwright_spend SELECT (answered from `opts.spend`, optionally only for
 * one specific bound window — that is how rollover is exercised), and the
 * shipwright_chats SELECT/INSERT plus the spend UPSERT (recorded).
 */
function makeDb(opts: {
  sessionHash?: string;
  /** Spend row the SELECT returns; `forWindow` restricts it to one window key. */
  spend?: { messages: number; est_tokens: number; forWindow?: number };
} = {}) {
  const calls: Call[] = [];
  const stmt = (sql: string) => {
    let bound: unknown[] = [];
    const s = {
      bind(...v: unknown[]) {
        bound = v;
        return s;
      },
      async first<T>(): Promise<T | null> {
        calls.push({ sql, binds: bound });
        if (sql.startsWith('SELECT user_id, gh_token_enc')) {
          return (opts.sessionHash && bound[0] === opts.sessionHash
            ? { user_id: 'u_1', gh_token_enc: null, gh_token_iv: null, expires_at: 2_000_000_000 }
            : null) as T | null;
        }
        if (sql.includes('FROM users WHERE id')) return baseUser as unknown as T;
        if (sql.includes('FROM shipwright_spend')) {
          const sp = opts.spend;
          if (!sp) return null;
          if (sp.forWindow !== undefined && bound[1] !== sp.forWindow) return null;
          return { messages: sp.messages, est_tokens: sp.est_tokens } as unknown as T;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        calls.push({ sql, binds: bound });
        return { results: [] };
      },
      async run() {
        calls.push({ sql, binds: bound });
        return { success: true, meta: { changes: 1 } } as unknown as D1Result;
      },
    };
    return s as unknown as D1PreparedStatement;
  };
  return { db: { prepare: stmt } as unknown as D1Database, calls };
}

function makeEnv(db: D1Database, over: Partial<Record<string, unknown>> = {}): Env {
  return { DB: db, PUBLIC_BASE_URL: BASE, ...over } as unknown as Env;
}

function chatReq(body: unknown): Request {
  return new Request(`${BASE}/v1/shipwright/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `__Host-pd_session=${COOKIE_VALUE}`,
    },
    body: JSON.stringify(body),
  });
}

/** Mock Ai recording every run() call — the cap must fire BEFORE any of them. */
function mockAi(result: unknown): { ai: Ai; seen: Array<{ model: string }> } {
  const seen: Array<{ model: string }> = [];
  const ai = {
    async run(model: string) {
      seen.push({ model });
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as Ai;
  return { ai, seen };
}

/** An env whose session resolves, with spend + cap knobs as given. */
function cappedEnv(opts: {
  spend?: { messages: number; est_tokens: number; forWindow?: number };
  vars?: Partial<Record<string, string>>;
  ai?: Ai;
}) {
  const { db, calls } = makeDb({ sessionHash: hashHex(COOKIE_VALUE), spend: opts.spend });
  const { ai, seen } = mockAi({ response: 'Ahoy!' });
  const env = makeEnv(db, { AI: opts.ai ?? ai, ...(opts.vars ?? {}) });
  return { env, calls, aiSeen: seen };
}

// ── Pure window + estimate arithmetic ────────────────────────────────────────

describe('spend caps — window and estimate arithmetic', () => {
  it('spendWindowStart is the UTC midnight of its day, and rolls exactly at midnight', () => {
    const t = 1_754_700_000; // some mid-day instant
    const w = spendWindowStart(t);
    expect(w % DAY).toBe(0);
    expect(w).toBeLessThanOrEqual(t);
    expect(t - w).toBeLessThan(DAY);
    // Every instant of one day shares a window; the next second starts a new one.
    expect(spendWindowStart(w)).toBe(w);
    expect(spendWindowStart(w + DAY - 1)).toBe(w);
    expect(spendWindowStart(w + DAY)).toBe(w + DAY);
  });

  it('estimateTurnTokens charges the message input plus the FULL output allowance', () => {
    // 2048 = CHAT_MAX_TOKENS — the floor even for an empty prompt: output is
    // the expensive side and cannot be known before the model runs.
    expect(estimateTurnTokens(0)).toBe(2048);
    expect(estimateTurnTokens(4)).toBe(1 + 2048);
    expect(estimateTurnTokens(4000)).toBe(1000 + 2048);
    expect(estimateTurnTokens(5)).toBe(2 + 2048); // ceil, never floor
  });

  it('caps come from env overrides only when they parse as positive integers', () => {
    const env = (vars: Record<string, string | undefined>) => vars as unknown as Env;
    // Unset / garbage / zero / negative ⇒ committed defaults (never unlimited).
    for (const bad of [undefined, '', 'abc', '0', '-5']) {
      const caps = shipwrightDailyCaps(env({ SHIPWRIGHT_DAILY_MESSAGES: bad, SHIPWRIGHT_DAILY_TOKENS: bad }));
      expect(caps.messages).toBe(SHIPWRIGHT_DAILY_MESSAGES_DEFAULT);
      expect(caps.tokens).toBe(SHIPWRIGHT_DAILY_TOKENS_DEFAULT);
    }
    const caps = shipwrightDailyCaps(env({ SHIPWRIGHT_DAILY_MESSAGES: '3', SHIPWRIGHT_DAILY_TOKENS: '9000' }));
    expect(caps).toEqual({ messages: 3, tokens: 9000 });
  });
});

// ── Enforcement at the boundary ──────────────────────────────────────────────

describe('spend caps — enforcement before the model call', () => {
  it('refuses with 429 + SPEND_CAP when the message cap is spent — model never invoked', async () => {
    const { env, calls, aiSeen } = cappedEnv({
      spend: { messages: 2, est_tokens: 0 },
      vars: { SHIPWRIGHT_DAILY_MESSAGES: '2' },
    });
    const res = await handleShipwrightChat(chatReq({ message: 'one more?' }), env);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; error: string; retryAfterSeconds: number };
    expect(body.code).toBe('SPEND_CAP');
    expect(body.error).toBe(spendCapNotice(body.retryAfterSeconds));
    expect(aiSeen).toHaveLength(0); // the whole point: no model spend
    // The spend SELECT bound the SESSION user and a real UTC-day window key.
    const sel = calls.find((c) => c.sql.includes('FROM shipwright_spend'));
    expect(sel!.binds[0]).toBe('u_1');
    expect((sel!.binds[1] as number) % DAY).toBe(0);
  });

  it('one under the message cap still passes', async () => {
    const { env, aiSeen } = cappedEnv({
      spend: { messages: 1, est_tokens: 0 },
      vars: { SHIPWRIGHT_DAILY_MESSAGES: '2' },
    });
    const res = await handleShipwrightChat(chatReq({ message: 'hi', stream: false }), env);
    expect(res.status).toBe(200);
    expect(aiSeen).toHaveLength(1);
  });

  it('refuses when the TOKEN cap would be exceeded, even with messages to spare', async () => {
    // Cap 3000 tokens; 900 spent; the cheapest turn costs 2048 ⇒ 2948 ≤ 3000
    // passes, but 1000 spent ⇒ 3048 > 3000 refuses.
    const ok = cappedEnv({ spend: { messages: 1, est_tokens: 900 }, vars: { SHIPWRIGHT_DAILY_TOKENS: '3000' } });
    expect((await handleShipwrightChat(chatReq({ message: 'hi', stream: false }), ok.env)).status).toBe(200);
    const over = cappedEnv({ spend: { messages: 1, est_tokens: 1000 }, vars: { SHIPWRIGHT_DAILY_TOKENS: '3000' } });
    const res = await handleShipwrightChat(chatReq({ message: 'hi' }), over.env);
    expect(res.status).toBe(429);
    expect(over.aiSeen).toHaveLength(0);
  });

  it('the 429 carries Retry-After: a positive integer of seconds, at most one day', async () => {
    const { env } = cappedEnv({ spend: { messages: 60, est_tokens: 0 } });
    const res = await handleShipwrightChat(chatReq({ message: 'again' }), env);
    expect(res.status).toBe(429);
    const header = res.headers.get('Retry-After');
    expect(header).toMatch(/^\d+$/);
    const seconds = Number(header);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(DAY);
    // And the JSON body agrees with the header — one truth, two encodings.
    const body = (await res.json()) as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBe(seconds);
  });

  it('caps bind the STREAMING dialect too — the check sits before the branch', async () => {
    const { env, aiSeen } = cappedEnv({ spend: { messages: 60, est_tokens: 0 } });
    const res = await handleShipwrightChat(chatReq({ message: 'stream me' }), env); // stream default
    expect(res.status).toBe(429);
    expect(res.headers.get('Content-Type')).not.toContain('text/event-stream');
    expect(aiSeen).toHaveLength(0);
  });

  it('the caps are server-owned: a request body cannot smuggle its own budget', async () => {
    const { env, aiSeen } = cappedEnv({ spend: { messages: 60, est_tokens: 0 } });
    const res = await handleShipwrightChat(
      chatReq({ message: 'hi', dailyMessages: 9999, caps: { messages: 9999 } }),
      env,
    );
    expect(res.status).toBe(429); // extra fields are ignored, not honored
    expect(aiSeen).toHaveLength(0);
  });
});

// ── No half-spent turns ──────────────────────────────────────────────────────

describe('spend caps — a refused turn stores nothing, spends nothing', () => {
  it('the refused user message is NOT persisted and the counter is NOT advanced', async () => {
    const { env, calls } = cappedEnv({ spend: { messages: 60, est_tokens: 0 } });
    const res = await handleShipwrightChat(chatReq({ message: 'refused' }), env);
    expect(res.status).toBe(429);
    expect(calls.filter((c) => c.sql.startsWith('INSERT INTO shipwright_chats'))).toHaveLength(0);
    expect(calls.filter((c) => c.sql.startsWith('INSERT INTO shipwright_spend'))).toHaveLength(0);
  });

  it('an ACCEPTED turn persists the message and charges the window before the model call', async () => {
    const { env, calls } = cappedEnv({ spend: { messages: 0, est_tokens: 0 } });
    const message = 'design me a fleet';
    const res = await handleShipwrightChat(chatReq({ message, stream: false }), env);
    expect(res.status).toBe(200);
    const inserted = calls.find((c) => c.sql.startsWith('INSERT INTO shipwright_chats'));
    expect(inserted!.binds[0]).toBe('u_1');
    const spend = calls.find((c) => c.sql.startsWith('INSERT INTO shipwright_spend'));
    expect(spend).toBeDefined();
    expect(spend!.sql).toContain('ON CONFLICT');
    expect(spend!.binds[0]).toBe('u_1');
    expect((spend!.binds[1] as number) % DAY).toBe(0); // the UTC-day key
    expect(spend!.binds[2]).toBe(estimateTurnTokens(message.length));
    // Ordering: the charge lands BEFORE the model sees the conversation.
    expect(calls.indexOf(spend!)).toBeGreaterThan(calls.indexOf(inserted!));
  });
});

// ── Rollover reset ───────────────────────────────────────────────────────────

describe('spend caps — reset at window rollover', () => {
  it("a budget exhausted YESTERDAY does not bind today — the new day's key reads zero", async () => {
    const yesterdayWindow = spendWindowStart(Math.floor(Date.now() / 1000)) - DAY;
    // The mock only answers the exhausted row for yesterday's window key; the
    // handler queries the CURRENT window, finds no row, and lets the turn pass.
    const { env, aiSeen } = cappedEnv({
      spend: { messages: 999, est_tokens: 999_999, forWindow: yesterdayWindow },
    });
    const res = await handleShipwrightChat(chatReq({ message: 'new day', stream: false }), env);
    expect(res.status).toBe(200);
    expect(aiSeen).toHaveLength(1);
  });

  it('...and the SAME exhausted row bound to the CURRENT window does refuse (the pair proves the key)', async () => {
    const todayWindow = spendWindowStart(Math.floor(Date.now() / 1000));
    const { env, aiSeen } = cappedEnv({
      spend: { messages: 999, est_tokens: 999_999, forWindow: todayWindow },
    });
    const res = await handleShipwrightChat(chatReq({ message: 'same day' }), env);
    expect(res.status).toBe(429);
    expect(aiSeen).toHaveLength(0);
  });
});

// ── DAL semantics ────────────────────────────────────────────────────────────

describe('spend caps — counter DAL', () => {
  it('getShipwrightSpend reads a missing row as zero (nothing spent)', async () => {
    const { db } = makeDb({}); // no spend row configured
    expect(await getShipwrightSpend(db, 'u_1', 1_754_697_600)).toEqual({ messages: 0, est_tokens: 0 });
  });

  it('addShipwrightSpend is one UPSERT: +1 message, +estTokens, keyed (user, window)', async () => {
    const { db, calls } = makeDb({});
    await addShipwrightSpend(db, { userId: 'u_1', windowStart: 1_754_697_600, estTokens: 2148 });
    const up = calls.find((c) => c.sql.startsWith('INSERT INTO shipwright_spend'));
    expect(up!.sql).toContain('ON CONFLICT (user_id, window_start)');
    expect(up!.sql).toContain('messages = messages + 1');
    expect(up!.sql).toContain('est_tokens = est_tokens + excluded.est_tokens');
    expect(up!.binds).toEqual(['u_1', 1_754_697_600, 2148]);
  });
});

// ── Lifecycle: sweep pruning + erasure ───────────────────────────────────────

/** Sweep-shaped D1 mock (the retention-sweep.test.ts idiom): records horizons. */
function makeSweepDb() {
  const calls: Array<{ sql: string; horizon: number }> = [];
  const stmt = (sql: string) => {
    let horizon = 0;
    const s = {
      bind(...v: unknown[]) { horizon = v[0] as number; return s; },
      async run() {
        calls.push({ sql, horizon });
        return { success: true, meta: { changes: sql.includes('shipwright_spend') ? 4 : 0 } };
      },
    };
    return s as unknown as D1PreparedStatement;
  };
  return { db: { prepare: stmt } as unknown as D1Database, calls };
}

describe('spend caps — lifecycle', () => {
  const NOW = 1_800_000_000;

  it('the retention sweep prunes counter rows past the spend horizon', async () => {
    const { db, calls } = makeSweepDb();
    const r = await runRetentionSweep({ DB: db, EVENT_RETENTION_DAYS: '7' } as unknown as Env, NOW);
    const del = calls.find((c) => c.sql === 'DELETE FROM shipwright_spend WHERE window_start < ?');
    expect(del).toBeDefined();
    expect(del!.horizon).toBe(NOW - SHIPWRIGHT_SPEND_RETENTION_DAYS * DAY);
    expect(del!.horizon).toBeLessThan(NOW); // strictly in the past — never "delete today"
    expect(r.shipwrightSpendPruned).toBe(4);
    expect(r.errors).toEqual([]);
  });

  it('the sweep defensively purges soft-deleted users’ counter rows at the erasure horizon', async () => {
    const { db, calls } = makeSweepDb();
    await runRetentionSweep({ DB: db, EVENT_RETENTION_DAYS: '7' } as unknown as Env, NOW);
    const del = calls.find(
      (c) => c.sql.startsWith('DELETE FROM shipwright_spend WHERE user_id IN'),
    );
    expect(del).toBeDefined();
    expect(del!.horizon).toBe(NOW - 30 * DAY);
  });

  it('eraseUser purges the account’s counter rows immediately', async () => {
    const { db, calls } = makeDb({});
    await eraseUser(db, 'u_1', NOW);
    const del = calls.find((c) => c.sql === 'DELETE FROM shipwright_spend WHERE user_id = ?');
    expect(del).toBeDefined();
    expect(del!.binds).toEqual(['u_1']);
  });
});

// ── The honest on-page notice ────────────────────────────────────────────────

describe('spend caps — the page states the budget (degrade with reasons)', () => {
  const NONCE = 'ab'.repeat(16);

  it('the honesty strip states the daily budget in force', () => {
    const html = renderShipwrightPage(baseUser, NONCE, {
      installations: null,
      notice: null,
      dailyMessages: 12,
    });
    expect(html).toContain('A daily budget of');
    expect(html).toContain('12 chat turns per account');
    expect(html).toContain('a refused message is never stored');
  });

  it('an existing call site without the cap field still renders — with the committed default', () => {
    const html = renderShipwrightPage(baseUser, NONCE, { installations: null, notice: null });
    expect(html).toContain(`${SHIPWRIGHT_DAILY_MESSAGES_DEFAULT} chat turns per account`);
  });

  it('the refusal copy is honest: what ran out, that nothing was stored, when it resets', () => {
    const text = spendCapNotice(3 * 3600);
    expect(text).toContain('budget is spent');
    expect(text).toContain('NOT stored');
    expect(text).toContain('UTC midnight');
    expect(text).toContain('about 3h');
    // Sub-hour remainders round UP — never promise an earlier reset than real.
    expect(spendCapNotice(30)).toContain('about 1h');
  });
});
