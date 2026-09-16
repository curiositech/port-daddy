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
 *   - PAGE: nonce-scoped CSP (the ONE inline-script page), honest PR copy,
 *     story-linework identity, no-store/noindex transport.
 *
 * Idioms follow runs-page.test.ts: hand-rolled D1 mock answering exactly the
 * queries these paths issue, recording every SQL + binds for assertions.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  handleShipwrightChat,
  handleShipwrightHistory,
  handleShipwrightClear,
  handleShipwrightCreateThread,
  handleShipwrightThreads,
  handleShipwrightContext,
  handleShipwrightOnboarding,
  handleShipwrightAiContextConsent,
  handleShipwrightRepoClear,
  buildShipwrightDraftProposal,
  parseShipwrightOnboardingProfile,
  assembleSseText,
  shipwrightModel,
  SHIPWRIGHT_DEFAULT_MODEL,
  SHIPWRIGHT_SYSTEM_PROMPT,
  MAX_MESSAGE_CHARS,
  extractFencedYamlBlocks,
  validateEmittedYaml,
} from '../src/shipwright.js';
import { handleShipwrightPage, renderShipwrightPage, renderModelBoard } from '../src/shipwright-page.js';
import { MODEL_DOSSIER, dossierLine, modelBoardPromptFragment } from '../src/model-dossier.js';
import { handleAccountExport } from '../src/auth-github.js';
import { eraseUser, listShipwrightMessages, type UserRow, type ShipwrightMessageRow } from '../src/db.js';
import { runRetentionSweep, SHIPWRIGHT_RETENTION_DAYS } from '../src/retention-sweep.js';
import { hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
/** Default page view: degraded installation list, no notice. */
const NO_VIEW = { installations: null, notice: null };
const COOKIE_VALUE = 'sess-value-abc';
const DAY = 24 * 60 * 60;
const THREAD_ID = `swt_${'a'.repeat(48)}`;
const INSTALLATION_ID = 42;
const REPO = 'octo/widgets';
const WRAP_KEY = 'cc'.repeat(32);
const SEALED_TOKEN = { enc: 'U4N_M4a3twfj0EeV9zkalIHLEF0iOBia', iv: 'AQEBAQEBAQEBAQEB' };
const TEST_APP_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  .export({ type: 'pkcs8', format: 'pem' }) as string;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/repos/octo/widgets/installation')) return Response.json({ id: INSTALLATION_ID });
    if (url.includes(`/user/installations/${INSTALLATION_ID}/repositories`)) {
      return Response.json({ total_count: 1, repositories: [{ full_name: REPO }] });
    }
    return new Response('not found', { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

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
function makeDb(opts: {
  history?: ShipwrightMessageRow[];
  sessionHash?: string;
  memory?: Array<{ id: string; user_id: string; installation_id: number; repo_full_name: string; kind: string; body_json: string; created_at: number; updated_at: number }>;
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
            ? { user_id: 'u_1', gh_token_enc: SEALED_TOKEN.enc, gh_token_iv: SEALED_TOKEN.iv, expires_at: 2_000_000_000 }
            : null) as T | null;
        }
        if (sql.includes('FROM users WHERE id')) return baseUser as unknown as T;
        if (sql.includes('FROM shipwright_threads')) return {
          id: THREAD_ID, user_id: 'u_1', installation_id: INSTALLATION_ID,
          repo_full_name: REPO, created_at: 1, updated_at: 1,
        } as T;
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        calls.push({ sql, binds: bound });
        if (sql.includes('FROM shipwright_repo_memory')) {
          return { results: (opts.memory ?? []) as unknown as T[] };
        }
        if (sql.includes('FROM shipwright_threads WHERE user_id')) {
          return { results: [{
            id: THREAD_ID, user_id: 'u_1', installation_id: INSTALLATION_ID,
            repo_full_name: REPO, created_at: 1, updated_at: 1,
          }] as unknown as T[] };
        }
        if (sql.includes('FROM shipwright_thread_messages') || sql.includes('FROM shipwright_chats')) {
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
    KV: {
      get: async (key: string) => {
        if (key === `inst_owner:u_1:${hashHex(COOKIE_VALUE)}:${INSTALLATION_ID}`) return '1';
        if (key === 'github_repo_inst_octo_widgets') return String(INSTALLATION_ID);
        return null;
      },
      put: async () => undefined,
    } as unknown as KVNamespace,
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: TEST_APP_KEY,
    PUBLIC_BASE_URL: BASE,
    ...over,
  } as unknown as Env;
}

function sessionEnv(over: Partial<Record<string, unknown>> = {}) {
  const { db, calls } = makeDb({ sessionHash: hashHex(COOKIE_VALUE) });
  return { env: makeEnv(db, over), calls };
}

const onboardingProfile = {
  desiredReviewOutcomes: 'Catch regressions and require actionable evidence',
  riskTolerance: 'conservative' as const,
  budgetCeilingUsdPerDay: 4,
  languagesAndFrameworks: 'Rust, TypeScript, Cloudflare Workers',
  protectedPaths: ['apps/relay/**', '.github/workflows/**'],
  reviewStrictness: 'strict' as const,
};

function req(path: string, init: RequestInit = {}, withCookie = true): Request {
  if (path.startsWith('/v1/shipwright/history') && !path.includes('thread=')) {
    path += (path.includes('?') ? '&' : '?') + `thread=${THREAD_ID}`;
  }
  if (path.startsWith('/v1/shipwright/clear') && !path.includes('thread=')) {
    path += (path.includes('?') ? '&' : '?') + `thread=${THREAD_ID}`;
  }
  const headers = new Headers(init.headers);
  if (withCookie) headers.set('Cookie', `__Host-pd_session=${COOKIE_VALUE}`);
  return new Request(`${BASE}${path}`, { ...init, headers });
}

function chatReq(body: unknown, withCookie = true, origin?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const scoped = body && typeof body === 'object' ? { threadId: THREAD_ID, ...(body as Record<string, unknown>) } : body;
  return req('/v1/shipwright/chat', { method: 'POST', headers, body: JSON.stringify(scoped) }, withCookie);
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
  it('issues an opaque thread bound to the normalized authorized repository', async () => {
    const { env, calls } = sessionEnv();
    const res = await handleShipwrightCreateThread(req('/v1/shipwright/thread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: INSTALLATION_ID, repo: 'Octo/Widgets' }),
    }), env);
    expect(res.status).toBe(201);
    const body = await res.json() as { threadId: string; repo: string };
    expect(body.threadId).toMatch(/^swt_[0-9a-f]{48}$/);
    expect(body.repo).toBe(REPO);
    const inserted = calls.find((c) => c.sql.includes('INSERT INTO shipwright_threads'));
    expect(inserted?.binds[1]).toBe('u_1');
    expect(inserted?.binds[2]).toBe(INSTALLATION_ID);
    expect(inserted?.binds[3]).toBe(REPO);
  });

  it('unscoped legacy requests are refused before history or model access', async () => {
    const { env, calls } = sessionEnv({ AI: mockAi({ response: 'must not run' }).ai });
    const history = await handleShipwrightHistory(req('/v1/shipwright/history?thread=', {}, true), env);
    const chat = await handleShipwrightChat(
      req('/v1/shipwright/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'legacy unscoped turn' }),
      }),
      env,
    );
    expect(history.status).toBe(409);
    expect(chat.status).toBe(409);
    expect((await chat.json() as { code: string }).code).toBe('SHIPWRIGHT_THREAD_REQUIRED');
    expect(calls.some((c) => c.sql.includes('shipwright_thread_messages'))).toBe(false);
    expect(calls.some((c) => c.sql.includes('shipwright_chats'))).toBe(false);
  });

  it('history reads bind the SESSION user id, never a caller-supplied one', async () => {
    const { env, calls } = sessionEnv();
    // A hostile query param must not widen the read.
    const res = await handleShipwrightHistory(req('/v1/shipwright/history?user_id=u_2'), env);
    expect(res.status).toBe(200);
    const payload = await res.clone().json() as { thread: { repo: string; installationId: number } };
    expect(payload.thread).toEqual({ threadId: THREAD_ID, repo: REPO, installationId: INSTALLATION_ID });
    const sel = calls.find((c) => c.sql.includes('FROM shipwright_thread_messages'));
    expect(sel).toBeDefined();
    expect(sel!.sql).toContain('m.user_id = ?');
    expect(sel!.binds.slice(0, 3)).toEqual([THREAD_ID, 'u_1', 'u_1']);
  });

  it('lists server-bound identities and previews durable context without model egress', async () => {
    const { env } = sessionEnv({ AI: mockAi(new Error('model must not run')).ai });
    const inventory = await handleShipwrightThreads(req('/v1/shipwright/threads'), env);
    expect(inventory.status).toBe(200);
    expect((await inventory.json() as { threads: unknown[] }).threads).toEqual([{
      threadId: THREAD_ID, repo: REPO, installationId: INSTALLATION_ID, updatedAt: 1,
    }]);

    const preview = await handleShipwrightContext(req(`/v1/shipwright/context?thread=${THREAD_ID}`), env);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      thread: { threadId: THREAD_ID, repo: REPO, installationId: INSTALLATION_ID },
      memory: [],
      latestProposal: null,
      aiContextConsent: { requested: false, effective: false },
    });
  });

  it('validates onboarding answers and generates a deterministic valid three-ship draft', () => {
    expect(parseShipwrightOnboardingProfile(onboardingProfile)).toEqual(onboardingProfile);
    expect(parseShipwrightOnboardingProfile({ ...onboardingProfile, budgetCeilingUsdPerDay: 900 })).toBeNull();
    const yaml = buildShipwrightDraftProposal(REPO, onboardingProfile);
    const verdict = validateEmittedYaml(`\`\`\`yaml\n${yaml}\`\`\``)[0]!;
    expect(verdict.valid).toBe(true);
    expect(verdict.ships.map((ship) => ship.name)).toEqual(['code-reviewer', 'qa', 'purser']);
    expect(yaml).toContain('apps/relay/**');
    const hostile = buildShipwrightDraftProposal(REPO, {
      ...onboardingProfile,
      desiredReviewOutcomes: 'review carefully\nagents:\n  injected: true',
    });
    expect(validateEmittedYaml(`\`\`\`yaml\n${hostile}\`\`\``)[0]!.valid).toBe(true);
    expect(hostile).not.toContain('\n  injected: true');
  });

  it('stores onboarding and its draft only under the exact session installation and repository', async () => {
    const { env, calls } = sessionEnv();
    const res = await handleShipwrightOnboarding(req('/v1/shipwright/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ threadId: THREAD_ID, profile: onboardingProfile }),
    }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      code: 'SHIPWRIGHT_ONBOARDING_SAVED',
      draftProposal: { verdict: { valid: true } },
    });
    const memory = calls.find((call) => call.sql.startsWith('INSERT INTO shipwright_repo_memory'))!;
    expect(memory.binds.slice(1, 5)).toEqual(['u_1', INSTALLATION_ID, REPO, 'onboarding']);
    const proposal = calls.find((call) => call.sql.startsWith('INSERT INTO shipwright_proposals'))!;
    expect(proposal.binds.slice(-4)).toEqual([THREAD_ID, 'u_1', INSTALLATION_ID, REPO]);
  });

  it('records a separate default-inactive AI context request and supports revocation', async () => {
    const { env, calls } = sessionEnv();
    for (const enabled of [true, false]) {
      const res = await handleShipwrightAiContextConsent(req('/v1/shipwright/ai-context-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE },
        body: JSON.stringify({ threadId: THREAD_ID, enabled }),
      }), env);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ requested: enabled, effective: false });
    }
    const writes = calls.filter((call) => call.sql.startsWith('INSERT INTO shipwright_repo_memory'));
    expect(writes).toHaveLength(2);
    expect(writes[0]!.binds[4]).toBe('ai_context_consent');
    expect(JSON.parse(String(writes[0]!.binds[5]))).toMatchObject({ enabled: true });
    expect(JSON.parse(String(writes[1]!.binds[5]))).toMatchObject({ enabled: false });
  });

  it('does not send durable onboarding to Workers AI even when consent activation is requested', async () => {
    const { ai, seen } = mockAi({ response: 'ok' });
    const memory = [
      { id: 'm1', user_id: 'u_1', installation_id: INSTALLATION_ID, repo_full_name: REPO, kind: 'onboarding', body_json: JSON.stringify(onboardingProfile), created_at: 1, updated_at: 1 },
      { id: 'm2', user_id: 'u_1', installation_id: INSTALLATION_ID, repo_full_name: REPO, kind: 'ai_context_consent', body_json: JSON.stringify({ enabled: true }), created_at: 1, updated_at: 1 },
    ];
    const { db } = makeDb({ sessionHash: hashHex(COOKIE_VALUE), memory });
    await handleShipwrightChat(chatReq({ message: 'continue', stream: false }), makeEnv(db, { AI: ai }));
    const system = (seen[0]!.inputs.messages as Array<{ role: string; content: string }>)[0]!.content;
    expect(system).not.toContain(onboardingProfile.desiredReviewOutcomes);
    expect(system).not.toContain(onboardingProfile.protectedPaths[0]);
  });

  it('a chat turn persists BOTH rows under the session user id', async () => {
    const { env, calls } = sessionEnv({ AI: mockAi({ response: 'Ahoy!' }).ai });
    const res = await handleShipwrightChat(chatReq({ message: 'hello', stream: false }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; reply: string };
    expect(body.code).toBe('OK');
    expect(body.reply).toBe('Ahoy!');
    const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO shipwright_thread_messages'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.binds[0]).toBe('user');
    expect(inserts[0]!.binds[1]).toBe('hello');
    expect(inserts[0]!.binds[3]).toBe(THREAD_ID);
    expect(inserts[0]!.binds[4]).toBe('u_1');
    expect(inserts[1]!.binds[0]).toBe('assistant');
    expect(inserts[1]!.binds[1]).toBe('Ahoy!');
  });

  it('clear deletes ONLY the session user rows', async () => {
    const { env, calls } = sessionEnv();
    const res = await handleShipwrightClear(req('/v1/shipwright/clear', { method: 'POST' }), env);
    expect(res.status).toBe(200);
    const del = calls.find((c) => c.sql.startsWith('DELETE FROM shipwright_thread_messages'));
    expect(del).toBeDefined();
    expect(del!.sql).toContain('thread_id = ? AND user_id = ?');
    expect(del!.binds).toEqual([THREAD_ID, 'u_1', 'u_1', INSTALLATION_ID, REPO]);
  });

  it('repo clear uses the session-owned stored thread even after GitHub access is revoked', async () => {
    const github = vi.fn(async () => new Response('revoked', { status: 404 }));
    vi.stubGlobal('fetch', github);
    const { env, calls } = sessionEnv();
    const res = await handleShipwrightRepoClear(req('/v1/shipwright/repo-clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ threadId: THREAD_ID }),
    }), env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { code: string }).code).toBe('SHIPWRIGHT_REPO_CLEARED');
    expect(github).not.toHaveBeenCalled();
    const memoryDelete = calls.find((c) => c.sql.startsWith('DELETE FROM shipwright_repo_memory'));
    const threadDelete = calls.find((c) => c.sql.startsWith('DELETE FROM shipwright_threads'));
    expect(memoryDelete?.binds).toEqual(['u_1', INSTALLATION_ID, REPO]);
    expect(threadDelete?.binds).toEqual(['u_1', INSTALLATION_ID, REPO]);
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
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain(SHIPWRIGHT_SYSTEM_PROMPT);
    expect(msgs[0]!.content).toContain(`repository: ${REPO}`);
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
    expect(calls.some((c) => c.sql.startsWith('DELETE FROM shipwright_repo_memory'))).toBe(true);
    expect(calls.some((c) => c.sql.startsWith('DELETE FROM shipwright_threads'))).toBe(true);
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
    const scopedAge = calls.find((c) => c.sql === 'DELETE FROM shipwright_thread_messages WHERE created_at < ?');
    expect(scopedAge?.horizon).toBe(NOW - SHIPWRIGHT_RETENTION_DAYS * DAY);
    expect(r.shipwrightThreadMessagesPruned).toBe(4);

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
    expect((body as unknown as { shipwrightScopedContext: unknown }).shipwrightScopedContext).toBeDefined();
  });
});

// ── Fail semantics ───────────────────────────────────────────────────────────

describe('shipwright — fail semantics', () => {
  it('cross-origin POSTs are refused (defense-in-depth CSRF)', async () => {
    const { env, calls } = sessionEnv({ AI: mockAi({ response: 'x' }).ai });
    const res = await handleShipwrightChat(chatReq({ message: 'hi' }, true, 'https://evil.example'), env);
    expect(res.status).toBe(403);
    // Refused before any row is written.
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO shipwright_thread_messages'))).toBe(false);
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
    const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO shipwright_thread_messages'));
    expect(inserts).toHaveLength(1); // the user row survived; no assistant row
    expect(inserts[0]!.binds[0]).toBe('user');
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

    const inserts = calls.filter((c) => c.sql.startsWith('INSERT INTO shipwright_thread_messages'));
    expect(inserts).toHaveLength(2);
    expect(inserts[1]!.binds[0]).toBe('assistant');
    expect(inserts[1]!.binds[1]).toBe('Ahoy, operator!');
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

// ── YAML validation badge (shipwright-yaml-validate) ─────────────────────────

const VALID_FLEET_YAML = [
  'fleet:',
  '  name: acme-fleet',
  '  agents:',
  '    reviewer:',
  '      trigger: pull_request:opened',
  '      prompt: "Review the diff for correctness."',
].join('\n');

// Missing the required `prompt` field on the one agent — BAD_SCHEMA.
const INVALID_FLEET_YAML = [
  'fleet:',
  '  name: acme-fleet',
  '  agents:',
  '    reviewer:',
  '      trigger: pull_request:opened',
].join('\n');

describe('shipwright — extractFencedYamlBlocks / validateEmittedYaml (pure)', () => {
  it('extracts only yaml/yml fenced blocks, in order, ignoring other languages', () => {
    const content = [
      'Here is some prose.',
      '```js',
      'console.log(1);',
      '```',
      'Then the roster:',
      '```yaml',
      VALID_FLEET_YAML,
      '```',
      'And a second one:',
      '```yml',
      INVALID_FLEET_YAML,
      '```',
    ].join('\n');
    const blocks = extractFencedYamlBlocks(content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('fleet:');
    expect(blocks[1]).toContain('fleet:');
  });

  it('strips <think> blocks before scanning for fences', () => {
    const content = `<think>\n\`\`\`yaml\nfleet: {agents: {}}\n\`\`\`\n</think>\nActual reply, no roster here.`;
    expect(extractFencedYamlBlocks(content)).toEqual([]);
  });

  it('a valid roster validates OK_VALID via the deterministic parser', () => {
    const [result] = validateEmittedYaml('```yaml\n' + VALID_FLEET_YAML + '\n```');
    expect(result!.code).toBe('OK_VALID');
    expect(result!.valid).toBe(true);
    expect(result!.ships).toHaveLength(1);
    expect(result!.ships[0]!.name).toBe('reviewer');
  });

  it('an invalid roster fails BAD_SCHEMA with the specific field error — never silently valid', () => {
    const [result] = validateEmittedYaml('```yaml\n' + INVALID_FLEET_YAML + '\n```');
    expect(result!.code).toBe('BAD_SCHEMA');
    expect(result!.valid).toBe(false);
    expect(result!.errors).toEqual([{ field: 'reviewer.prompt', message: 'required' }]);
  });

  it('malformed YAML fails BAD_YAML with a parser message — fail-closed, not silently dropped', () => {
    const [result] = validateEmittedYaml('```yaml\nfleet: [unterminated\n```');
    expect(result!.code).toBe('BAD_YAML');
    expect(result!.valid).toBe(false);
    expect(result!.errors[0]!.field).toBe('yaml');
  });

  it('a message with no fenced yaml produces zero verdicts', () => {
    expect(validateEmittedYaml('just a normal reply, no code')).toEqual([]);
  });
});

describe('shipwright — chat responses carry the deterministic verdict, not the model\'s say-so', () => {
  it('buffered mode: valid roster badges OK_VALID', async () => {
    const { env } = sessionEnv({
      AI: mockAi({ response: 'Here you go:\n```yaml\n' + VALID_FLEET_YAML + '\n```\n' }).ai,
    });
    const res = await handleShipwrightChat(chatReq({ message: 'design me a fleet', stream: false }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { yaml: Array<{ code: string; valid: boolean }> };
    expect(body.yaml).toHaveLength(1);
    expect(body.yaml[0]!.code).toBe('OK_VALID');
    expect(body.yaml[0]!.valid).toBe(true);
  });

  it('buffered mode: invalid roster badges BAD_SCHEMA with structured errors, not a self-reported pass', async () => {
    const { env } = sessionEnv({
      AI: mockAi({ response: 'Here you go:\n```yaml\n' + INVALID_FLEET_YAML + '\n```\n' }).ai,
    });
    const res = await handleShipwrightChat(chatReq({ message: 'design me a fleet', stream: false }), env);
    expect(res.status).toBe(200); // the CHAT call succeeds; the ROSTER is what's flagged invalid
    const body = (await res.json()) as {
      yaml: Array<{ code: string; valid: boolean; errors: Array<{ field: string; message: string }> }>;
    };
    expect(body.yaml).toHaveLength(1);
    expect(body.yaml[0]!.code).toBe('BAD_SCHEMA');
    expect(body.yaml[0]!.valid).toBe(false);
    expect(body.yaml[0]!.errors.length).toBeGreaterThan(0);
  });

  it('a message with no roster carries an empty yaml verdict list', async () => {
    const { env } = sessionEnv({ AI: mockAi({ response: 'Tell me about your repo first.' }).ai });
    const res = await handleShipwrightChat(chatReq({ message: 'hi', stream: false }), env);
    const body = (await res.json()) as { yaml: unknown[] };
    expect(body.yaml).toEqual([]);
  });

  it('history recomputes the verdict from stored content — never a stored/stale badge', async () => {
    const { db } = makeDb({
      sessionHash: hashHex(COOKIE_VALUE),
      history: [
        {
          id: 1,
          role: 'assistant',
          content: 'Here:\n```yaml\n' + VALID_FLEET_YAML + '\n```\n',
          created_at: 1,
        },
      ],
    });
    const res = await handleShipwrightHistory(req('/v1/shipwright/history'), makeEnv(db));
    const body = (await res.json()) as { messages: Array<{ yaml: Array<{ valid: boolean }> }> };
    expect(body.messages[0]!.yaml).toHaveLength(1);
    expect(body.messages[0]!.yaml[0]!.valid).toBe(true);
  });

  it('user-authored messages never carry a verdict list, even if they contain a yaml fence', async () => {
    const { db } = makeDb({
      sessionHash: hashHex(COOKIE_VALUE),
      history: [
        { id: 1, role: 'user', content: 'my current file:\n```yaml\n' + VALID_FLEET_YAML + '\n```', created_at: 1 },
      ],
    });
    const res = await handleShipwrightHistory(req('/v1/shipwright/history'), makeEnv(db));
    const body = (await res.json()) as { messages: Array<{ yaml: unknown[] }> };
    expect(body.messages[0]!.yaml).toEqual([]);
  });

  it('SSE mode: appends one synthetic verdict line after the real tokens, badging the roster', async () => {
    const lines = [
      'data: {"response":"Roster:\\n```yaml\\n"}\n\n',
      `data: {"response":${JSON.stringify(VALID_FLEET_YAML)}}\n\n`,
      'data: {"response":"\\n```"}\n\n',
      'data: [DONE]\n\n',
    ];
    const { ai } = mockAi(sseStream(lines));
    const { db, calls } = makeDb({ sessionHash: hashHex(COOKIE_VALUE) });
    const res = await handleShipwrightChat(chatReq({ message: 'hi' }), makeEnv(db, { AI: ai }));
    const wire = await res.text();
    expect(wire.startsWith(lines.join(''))).toBe(true); // real bytes forwarded verbatim, untouched
    const verdictLine = wire.slice(lines.join('').length);
    expect(verdictLine).toContain('pdYamlVerdict');
    const parsed = JSON.parse(verdictLine.replace(/^data: /, '').trim()) as {
      pdYamlVerdict: Array<{ valid: boolean; code: string }>;
    };
    expect(parsed.pdYamlVerdict).toHaveLength(1);
    expect(parsed.pdYamlVerdict[0]!.valid).toBe(true);
    // Persisted content is exactly the model's text — the verdict marker
    // never contaminates what's saved (and thus never re-shown as "content").
    const assistantInsert = calls.find(
      (c) => c.sql.startsWith('INSERT INTO shipwright_thread_messages') && c.binds[0] === 'assistant',
    );
    expect(assistantInsert!.binds[1]).not.toContain('pdYamlVerdict');
  });

  it('SSE mode: no synthetic line is appended when the turn emits no roster', async () => {
    const lines = ['data: {"response":"just chatting, no yaml"}\n\n', 'data: [DONE]\n\n'];
    const { ai } = mockAi(sseStream(lines));
    const { db } = makeDb({ sessionHash: hashHex(COOKIE_VALUE) });
    const res = await handleShipwrightChat(chatReq({ message: 'hi' }), makeEnv(db, { AI: ai }));
    const wire = await res.text();
    expect(wire).toBe(lines.join(''));
    expect(wire).not.toContain('pdYamlVerdict');
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
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
  });

  it('is honest about its hands: PR-opening at the user click, stated retention, real endpoints', () => {
    const html = renderShipwrightPage(baseUser, 'aa'.repeat(16), NO_VIEW);
    // The old tied-hands claim is GONE — the page now tells the new truth.
    expect(html).not.toContain('cannot open a PR');
    expect(html).toContain('open the PR in your own repo');
    expect(html).toContain('never merges');
    expect(html).toContain(`${SHIPWRIGHT_RETENTION_DAYS} days`);
    expect(html).toContain('Structured repository memory and proposal provenance remain until');
    expect(html).toContain('/v1/shipwright/chat');
    expect(html).toContain('/v1/shipwright/history');
    expect(html).toContain('/v1/shipwright/clear');
  });

  it('renders resume on the bare page and keeps controls inert until authorized history hydrates', () => {
    const html = renderShipwrightPage(baseUser, 'aa'.repeat(16), NO_VIEW);
    expect(html).toContain('id="resume-thread"');
    expect(html).toContain('id="input"');
    expect(html).toMatch(/id="input"[^>]*disabled/);
    expect(html).toMatch(/id="send"[^>]*disabled/);
    expect(html).toContain("addMsg('error', (e && e.message) || 'Repository authorization failed.");
    expect(html).toContain("label.textContent = 'Unavailable'");
  });

  it('enables only repository erasure when the saved-thread inventory recognizes a revoked thread', () => {
    const html = renderShipwrightPage(baseUser, 'aa'.repeat(16), {
      ...NO_VIEW, threadId: THREAD_ID,
    });
    const inventoryBranch = html.slice(
      html.indexOf('if (rows[i].threadId === threadId)'),
      html.indexOf("}).catch(function () {", html.indexOf('if (rows[i].threadId === threadId)')),
    );
    expect(inventoryBranch).toContain('repoClearBtn.disabled = false');
    expect(inventoryBranch).not.toContain('input.disabled = false');
    expect(inventoryBranch).not.toContain('sendBtn.disabled = false');
    expect(inventoryBranch).not.toMatch(/\n\s*clearBtn\.disabled = false/);
    expect(html).toContain("body: JSON.stringify({ threadId: threadId })");
  });

  it('keeps the story-linework identity and keyboard UX affordances', () => {
    const html = renderShipwrightPage(baseUser, 'aa'.repeat(16), NO_VIEW);
    expect(html).toContain('#003fb8'); // cobalt storefront accent (TOKENS)
    expect(html).toContain('IBM Plex Mono');
    expect(html).toContain('Shift+Enter');
    expect(html).toContain('pd-fleet.yml');
  });

  it('renders the bespoke interview, export controls, and an explicit inactive-by-default AI context request', () => {
    const html = renderShipwrightPage(baseUser, 'aa'.repeat(16), { ...NO_VIEW, threadId: THREAD_ID });
    for (const field of [
      'desiredReviewOutcomes', 'riskTolerance', 'budgetCeilingUsdPerDay',
      'languagesAndFrameworks', 'protectedPaths', 'reviewStrictness',
    ]) expect(html).toContain(`name="${field}"`);
    expect(html).toContain('id="ai-context-consent"');
    expect(html).not.toContain('id="ai-context-consent" type="checkbox" checked');
    expect(html).toContain('does not activate egress');
    expect(html).toContain('Export profile');
    expect(html).toContain('Download draft fleet');
    expect(html).toContain('/v1/shipwright/onboarding');
    expect(html).toContain('/v1/shipwright/ai-context-consent');
  });

  it('escapes the user display name (XSS guard)', () => {
    const html = renderShipwrightPage(
      { ...baseUser, display_name: '<script>alert(1)</script>' },
      'aa'.repeat(16),
      NO_VIEW,
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
    // The tied-hands claim is gone; the prompt states the click-gated truth.
    expect(p).not.toContain('cannot open PRs');
    expect(p).toContain('Open PR');
    expect(p).toContain('never a push, never a merge');
    expect(p).toContain('yaml');
  });
});

describe('shipwright — the model dossier is the single model authority (page, prompt, data)', () => {
  it('the dossier is well-formed: verified date, non-empty note, sane economics on every row', () => {
    expect(MODEL_DOSSIER.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(MODEL_DOSSIER.models.length).toBeGreaterThanOrEqual(20);
    expect(MODEL_DOSSIER.excluded.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const m of MODEL_DOSSIER.models) {
      expect(m.id, m.id).toMatch(/^@cf\//);
      expect(ids.has(m.id), `duplicate dossier id ${m.id}`).toBe(false);
      ids.add(m.id);
      expect(m.inputUsdPerM, m.id).toBeGreaterThan(0);
      expect(m.outputUsdPerM, m.id).toBeGreaterThan(0);
      expect(m.contextTokens, m.id).toBeGreaterThanOrEqual(24_000);
      expect(m.note.length, m.id).toBeGreaterThan(10);
      expect(['adopted', 'bench']).toContain(m.verdict);
      // The board's promise: adopted = carries a live fleet assignment.
      if (m.verdict === 'adopted') expect(m.assignments.length, m.id).toBeGreaterThan(0);
    }
    for (const x of MODEL_DOSSIER.excluded) {
      expect(x.reason.length, x.id).toBeGreaterThan(10);
    }
  });

  it('the system prompt carries the board: every honored id, verbatim, plus the exact-quote law', () => {
    const p = SHIPWRIGHT_SYSTEM_PROMPT;
    expect(p).toContain('THE MODEL BOARD');
    expect(p).toContain(MODEL_DOSSIER.verifiedAt);
    for (const m of MODEL_DOSSIER.models) {
      expect(p, `prompt is missing dossier model ${m.id}`).toContain(`'${m.id}'`);
    }
    // The stale hardcoded folklore this replaced must never come back.
    expect(p).not.toContain("qwen3-30b-a3b-fp8' for general work");
    expect(p).not.toContain('qwen2.5-coder-32b-instruct\' for code review');
  });

  it('dossierLine formats price, context, and fleet duty from the same data the page renders', () => {
    const glm = MODEL_DOSSIER.models.find((m) => m.id === '@cf/zai-org/glm-4.7-flash')!;
    const line = dossierLine(glm);
    expect(line).toContain("'@cf/zai-org/glm-4.7-flash'");
    expect(line).toContain('$0.06/$0.4 per M');
    expect(line).toContain('131k ctx');
    expect(line).toContain('fleet:');
    const ds = MODEL_DOSSIER.models.find((m) => m.id === '@cf/deepseek-ai/deepseek-v4-flash-0731')!;
    expect(dossierLine(ds)).toContain('1M ctx');
  });

  it('the prompt fragment groups adopted before bench and covers both verdicts', () => {
    const frag = modelBoardPromptFragment();
    const provenAt = frag.indexOf('Proven in the Port Daddy fleet:');
    const benchAt = frag.indexOf('Also honored');
    expect(provenAt).toBeGreaterThan(-1);
    expect(benchAt).toBeGreaterThan(provenAt);
  });

  it('the page renders the board: every honored id, both chips, the named exclusions', () => {
    const board = renderModelBoard();
    expect(board).toContain(`Model board — ${MODEL_DOSSIER.models.length} reviewed Workers AI models`);
    expect(board).toContain(MODEL_DOSSIER.verifiedAt);
    for (const m of MODEL_DOSSIER.models) {
      expect(board, `board is missing ${m.id}`).toContain(esc(m.id));
    }
    for (const x of MODEL_DOSSIER.excluded) {
      expect(board, `board is missing exclusion ${x.id}`).toContain(esc(x.id));
    }
    expect(board).toContain('chip adopted');
    expect(board).toContain('chip bench');
    // And the full page actually carries it in the masthead.
    const html = renderShipwrightPage(baseUser, 'aa'.repeat(16), NO_VIEW);
    expect(html).toContain('class="board"');
    expect(html).toContain('@cf/zai-org/glm-4.7-flash');
  });
});

/** Same escapement the page applies — assertions compare escaped-to-escaped. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
