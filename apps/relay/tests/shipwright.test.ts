/**
 * Tests for the Shipwright chat (src/shipwright.ts + src/shipwright-page.ts).
 * Coverage, per the feature's contract:
 *   - SESSION GATE: page 302→/login without a session; every API route 401s.
 *   - HISTORY SCOPING: reads/writes/clears bind the SESSION user's id — one
 *     account can never touch another's conversation.
 *   - ERASURE HOOK (ADR-0101): eraseUser purges shipwright_chats immediately;
 *     the retention sweep age-prunes chats and defensively purges soft-deleted
 *     users' rows at the erasure horizon; /account/export includes the chats.
 *   - FAIL SEMANTICS: cross-origin POST → 403; no [ai] binding → 503; a failed
 *     model call never loses the persisted user message.
 *   - STREAMING: the SSE pass-through forwards bytes verbatim and persists the
 *     assembled assistant text after the stream drains.
 *   - PAGE: nonce-scoped CSP (the ONE inline-script page), honest no-PR copy,
 *     story-linework identity, no-store/noindex transport.
 *
 * Idioms follow runs-page.test.ts: hand-rolled D1 mock answering exactly the
 * queries these paths issue, recording every SQL + binds for assertions.
 */

import { describe, it, expect } from 'vitest';
import {
  handleShipwrightChat,
  handleShipwrightHistory,
  handleShipwrightClear,
  assembleSseText,
  shipwrightModel,
  SHIPWRIGHT_DEFAULT_MODEL,
  SHIPWRIGHT_SYSTEM_PROMPT,
  MAX_MESSAGE_CHARS,
} from '../src/shipwright.js';
import { handleShipwrightPage, renderShipwrightPage } from '../src/shipwright-page.js';
import { handleAccountExport } from '../src/auth-github.js';
import { eraseUser, listShipwrightMessages, type UserRow, type ShipwrightMessageRow } from '../src/db.js';
import { runRetentionSweep, SHIPWRIGHT_RETENTION_DAYS } from '../src/retention-sweep.js';
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
 * D1 mock for the chat paths: session lookup, user lookup, shipwright_chats
 * SELECT/INSERT/DELETE. Records every call's SQL + binds.
 */
function makeDb(opts: { history?: ShipwrightMessageRow[]; sessionHash?: string } = {}) {
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
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        calls.push({ sql, binds: bound });
        if (sql.includes('FROM shipwright_chats')) {
          // The DAL SELECTs newest-first; give it newest-first and let it reverse.
          const rows = [...(opts.history ?? [])].sort((a, b) => b.id - a.id);
          return { results: rows as unknown as T[] };
        }
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

function makeEnv(
  db: D1Database,
  over: Partial<Record<string, unknown>> = {},
): Env {
  return {
    DB: db,
    PUBLIC_BASE_URL: BASE,
    ...over,
  } as unknown as Env;
}

function sessionEnv(over: Partial<Record<string, unknown>> = {}) {
  const { db, calls } = makeDb({ sessionHash: hashHex(COOKIE_VALUE) });
  return { env: makeEnv(db, over), calls };
}

function req(path: string, init: RequestInit = {}, withCookie = true): Request {
  const headers = new Headers(init.headers);
  if (withCookie) headers.set('Cookie', `__Host-pd_session=${COOKIE_VALUE}`);
  return new Request(`${BASE}${path}`, { ...init, headers });
}

function chatReq(body: unknown, withCookie = true, origin?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  return req('/v1/shipwright/chat', { method: 'POST', headers, body: JSON.stringify(body) }, withCookie);
}

/** Mock Ai whose run() returns a canned buffered reply or SSE stream. */
function mockAi(result: unknown): { ai: Ai; seen: Array<{ model: string; inputs: Record<string, unknown> }> } {
  const seen: Array<{ model: string; inputs: Record<string, unknown> }> = [];
  const ai = {
    async run(model: string, inputs: Record<string, unknown>) {
      seen.push({ model, inputs });
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as Ai;
  return { ai, seen };
}

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
}

// ── Session gate ─────────────────────────────────────────────────────────────

describe('shipwright — session gate', () => {
  it('page redirects to /login without a session cookie', async () => {
    const { env } = sessionEnv();
    const res = await handleShipwrightPage(req('/account/shipwright', {}, false), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('page redirects to /login on an unknown session cookie', async () => {
    const { env } = sessionEnv();
    const res = await handleShipwrightPage(
      new Request(`${BASE}/account/shipwright`, { headers: { Cookie: '__Host-pd_session=bogus' } }),
      env,
    );
    expect(res.status).toBe(302);
  });

  it('chat, history, and clear all 401 without a session', async () => {
    const { env } = sessionEnv({ AI: mockAi({ response: 'x' }).ai });
    for (const res of [
      await handleShipwrightChat(chatReq({ message: 'hi' }, false), env),
      await handleShipwrightHistory(req('/v1/shipwright/history', {}, false), env),
      await handleShipwrightClear(req('/v1/shipwright/clear', { method: 'POST' }, false), env),
    ]) {
      expect(res.status).toBe(401);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('UNAUTHENTICATED');
    }
  });
});

// ── History scoping ──────────────────────────────────────────────────────────

describe('shipwright — history is scoped to the session user', () => {
  it('history reads bind the SESSION user id, never a caller-supplied one', async () => {
    const { env, calls } = sessionEnv();
    // A hostile query param must not widen the read.
    const res = await handleShipwrightHistory(req('/v1/shipwright/history?user_id=u_2'), env);
    expect(res.status).toBe(200);
    const sel = calls.find((c) => c.sql.includes('FROM shipwright_chats'));
    expect(sel).toBeDefined();
    expect(sel!.sql).toContain('WHERE user_id = ?');
    expect(sel!.binds[0]).toBe('u_1');
  });

  it('a chat turn persists BOTH rows under the session user id', async () => {
    const { env, calls } = sessionEnv({ AI: mockAi({ response: 'Ahoy!' }).ai });
    const res = await handleShipwrightChat(chatReq({ message: 'hello', stream: false }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; reply: string };
    expect(body.code).toBe('OK');
    expect(body.reply).toBe('Ahoy!');
    const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO shipwright_chats'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.binds[0]).toBe('u_1');
    expect(inserts[0]!.binds[1]).toBe('user');
    expect(inserts[0]!.binds[2]).toBe('hello');
    expect(inserts[1]!.binds[0]).toBe('u_1');
    expect(inserts[1]!.binds[1]).toBe('assistant');
    expect(inserts[1]!.binds[2]).toBe('Ahoy!');
  });

  it('clear deletes ONLY the session user rows', async () => {
    const { env, calls } = sessionEnv();
    const res = await handleShipwrightClear(req('/v1/shipwright/clear', { method: 'POST' }), env);
    expect(res.status).toBe(200);
    const del = calls.find((c) => c.sql.startsWith('DELETE FROM shipwright_chats'));
    expect(del).toBeDefined();
    expect(del!.sql).toContain('WHERE user_id = ?');
    expect(del!.binds).toEqual(['u_1']);
  });

  it('listShipwrightMessages returns conversation order (oldest → newest by id)', async () => {
    const { db } = makeDb({
      history: [
        { id: 1, role: 'user', content: 'first', created_at: 100 },
        { id: 2, role: 'assistant', content: 'second', created_at: 100 }, // same second
        { id: 3, role: 'user', content: 'third', created_at: 101 },
      ],
    });
    const rows = await listShipwrightMessages(db, 'u_1');
    expect(rows.map((r) => r.content)).toEqual(['first', 'second', 'third']);
  });

  it('the model sees the system prompt + the user history, in order', async () => {
    const { ai, seen } = mockAi({ response: 'ok' });
    const { db } = makeDb({
      sessionHash: hashHex(COOKIE_VALUE),
      history: [
        { id: 1, role: 'user', content: 'repo is acme/widgets', created_at: 1 },
        { id: 2, role: 'assistant', content: 'noted', created_at: 2 },
      ],
    });
    await handleShipwrightChat(chatReq({ message: 'goals: review PRs', stream: false }), makeEnv(db, { AI: ai }));
    expect(seen).toHaveLength(1);
    const msgs = seen[0]!.inputs.messages as Array<{ role: string; content: string }>;
    expect(msgs[0]).toEqual({ role: 'system', content: SHIPWRIGHT_SYSTEM_PROMPT });
    expect(msgs.slice(1).map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

// ── Erasure hook (ADR-0101) ──────────────────────────────────────────────────

describe('shipwright — ADR-0101 erasure + export', () => {
  it('eraseUser purges shipwright_chats immediately (not in 30 days)', async () => {
    const { db, calls } = makeDb();
    await eraseUser(db, 'u_1', 1_800_000_000);
    const del = calls.find((c) => c.sql.startsWith('DELETE FROM shipwright_chats'));
    expect(del).toBeDefined();
    expect(del!.binds).toEqual(['u_1']);
  });

  it('the retention sweep age-prunes chats and purges soft-deleted users rows', async () => {
    const NOW = 1_800_000_000;
    const calls: Array<{ sql: string; horizon: number }> = [];
    const stmt = (sql: string) => {
      let horizon = 0;
      const s = {
        bind(...v: unknown[]) {
          horizon = v[0] as number;
          return s;
        },
        async run() {
          calls.push({ sql, horizon });
          return { success: true, meta: { changes: 4 } };
        },
      };
      return s as unknown as D1PreparedStatement;
    };
    const env = { DB: { prepare: stmt } as unknown as D1Database, EVENT_RETENTION_DAYS: '7' } as unknown as Env;
    const r = await runRetentionSweep(env, NOW);

    // Age prune at the Shipwright's OWN (stated) horizon, not the 7-day one.
    const age = calls.find((c) => c.sql === 'DELETE FROM shipwright_chats WHERE created_at < ?');
    expect(age).toBeDefined();
    expect(age!.horizon).toBe(NOW - SHIPWRIGHT_RETENTION_DAYS * DAY);
    expect(r.shipwrightChatsPruned).toBe(4);

    // Erasure completion: soft-deleted users' rows die at the erasure horizon.
    const erased = calls.find((c) =>
      c.sql.includes('DELETE FROM shipwright_chats WHERE user_id IN (SELECT id FROM users WHERE deleted_at'),
    );
    expect(erased).toBeDefined();
    expect(erased!.horizon).toBe(NOW - 30 * DAY);
    expect(r.errors).toEqual([]);
  });

  it('/account/export includes the shipwright conversation', async () => {
    const { db } = makeDb({
      sessionHash: hashHex(COOKIE_VALUE),
      history: [{ id: 1, role: 'user', content: 'my repo is acme/widgets', created_at: 42 }],
    });
    const res = await handleAccountExport(req('/account/export'), makeEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shipwrightChats: Array<{ role: string; content: string; createdAt: number }> };
    expect(body.shipwrightChats).toEqual([{ role: 'user', content: 'my repo is acme/widgets', createdAt: 42 }]);
  });
});

// ── Fail semantics ───────────────────────────────────────────────────────────

describe('shipwright — fail semantics', () => {
  it('cross-origin POSTs are refused (defense-in-depth CSRF)', async () => {
    const { env, calls } = sessionEnv({ AI: mockAi({ response: 'x' }).ai });
    const res = await handleShipwrightChat(chatReq({ message: 'hi' }, true, 'https://evil.example'), env);
    expect(res.status).toBe(403);
    // Refused before any row is written.
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO shipwright_chats'))).toBe(false);
  });

  it('same-origin POSTs pass the origin check', async () => {
    const { env } = sessionEnv({ AI: mockAi({ response: 'x' }).ai });
    const res = await handleShipwrightChat(chatReq({ message: 'hi', stream: false }, true, BASE), env);
    expect(res.status).toBe(200);
  });

  it('503 SHIPWRIGHT_UNCONFIGURED when the [ai] binding is absent', async () => {
    const { env } = sessionEnv(); // no AI
    const res = await handleShipwrightChat(chatReq({ message: 'hi' }), env);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe('SHIPWRIGHT_UNCONFIGURED');
  });

  it('rejects empty and oversized messages', async () => {
    const { env } = sessionEnv({ AI: mockAi({ response: 'x' }).ai });
    expect((await handleShipwrightChat(chatReq({ message: '   ' }), env)).status).toBe(400);
    expect(
      (await handleShipwrightChat(chatReq({ message: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }), env)).status,
    ).toBe(400);
  });

  it('a model failure returns AI_ERROR but the user message is already saved', async () => {
    const { env, calls } = sessionEnv({ AI: mockAi(new Error('model exploded')).ai });
    const res = await handleShipwrightChat(chatReq({ message: 'hi', stream: false }), env);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('AI_ERROR');
    const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO shipwright_chats'));
    expect(inserts).toHaveLength(1); // the user row survived; no assistant row
    expect(inserts[0]!.binds[1]).toBe('user');
  });

  it('SHIPWRIGHT_MODEL var overrides the committed default', () => {
    expect(shipwrightModel({} as Env)).toBe(SHIPWRIGHT_DEFAULT_MODEL);
    expect(SHIPWRIGHT_DEFAULT_MODEL).toContain('@cf/deepseek');
    expect(shipwrightModel({ SHIPWRIGHT_MODEL: '@cf/other/model' } as Env)).toBe('@cf/other/model');
  });
});

// ── Streaming ────────────────────────────────────────────────────────────────

describe('shipwright — SSE streaming pass-through', () => {
  const LINES = [
    'data: {"response":"Ahoy, "}\n\n',
    'data: {"response":"operator!"}\n\n',
    'data: [DONE]\n\n',
  ];

  it('forwards the SSE bytes verbatim and persists the assembled reply', async () => {
    const { ai } = mockAi(sseStream(LINES));
    const { db, calls } = makeDb({ sessionHash: hashHex(COOKIE_VALUE) });
    const res = await handleShipwrightChat(chatReq({ message: 'hi' }), makeEnv(db, { AI: ai }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const wire = await res.text(); // drains the stream (and runs flush)
    expect(wire).toBe(LINES.join(''));

    const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO shipwright_chats'));
    expect(inserts).toHaveLength(2);
    expect(inserts[1]!.binds[1]).toBe('assistant');
    expect(inserts[1]!.binds[2]).toBe('Ahoy, operator!');
  });

  it('assembleSseText handles OpenAI-style deltas and garbage lines', () => {
    const raw =
      'data: {"choices":[{"delta":{"content":"A"}}]}\n' +
      ': keepalive comment\n' +
      'data: not-json\n' +
      'data: {"response":"B"}\n' +
      'data: [DONE]\n';
    expect(assembleSseText(raw)).toBe('AB');
  });
});

// ── The page ─────────────────────────────────────────────────────────────────

describe('GET /account/shipwright — page', () => {
  it('serves no-store noindex HTML whose CSP admits ONLY the nonce script', async () => {
    const { env } = sessionEnv();
    const res = await handleShipwrightPage(req('/account/shipwright'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-[0-9a-f]{32}'/);
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self'");
    const html = await res.text();
    const nonce = /script-src 'nonce-([0-9a-f]{32})'/.exec(csp)![1]!;
    expect(html).toContain(`<script nonce="${nonce}">`);
  });

  it('is honest about the MVP: no PR-opening, stated retention, real endpoints', () => {
    const html = renderShipwrightPage(baseUser, 'aa'.repeat(16));
    expect(html).toContain('cannot open a PR');
    expect(html).toContain(`${SHIPWRIGHT_RETENTION_DAYS} days`);
    expect(html).toContain('/v1/shipwright/chat');
    expect(html).toContain('/v1/shipwright/history');
    expect(html).toContain('/v1/shipwright/clear');
  });

  it('keeps the story-linework identity and keyboard UX affordances', () => {
    const html = renderShipwrightPage(baseUser, 'aa'.repeat(16));
    expect(html).toContain('#003fb8'); // cobalt storefront accent (TOKENS)
    expect(html).toContain('IBM Plex Mono');
    expect(html).toContain('Shift+Enter');
    expect(html).toContain('pd-fleet.yml');
  });

  it('escapes the user display name (XSS guard)', () => {
    const html = renderShipwrightPage(
      { ...baseUser, display_name: '<script>alert(1)</script>' },
      'aa'.repeat(16),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('the system prompt covers the contract: greet, ask, roster, YAML, honesty', () => {
    const p = SHIPWRIGHT_SYSTEM_PROMPT;
    expect(p).toContain('GREET');
    expect(p).toContain('repository');
    expect(p).toContain('goals');
    expect(p).toContain('purser');
    expect(p).toContain('graft');
    expect(p).toContain('pd-fleet.yml');
    expect(p).toContain('cannot open PRs');
    expect(p).toContain('yaml');
  });
});
