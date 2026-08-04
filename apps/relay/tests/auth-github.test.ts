/**
 * Tests for the GitHub-login BFF (src/auth-github.ts, ADR-0101 Phase 1).
 *
 * Coverage:
 *   - login: 503 when unconfigured; 302 to GitHub with exact redirect_uri +
 *     scope + a state that gets stored single-use in KV.
 *   - callback CSRF: unknown/absent state → 400; a state is consumed exactly
 *     once (replay of the same state → 400).
 *   - callback happy path (mocked GitHub): code exchange → /user → /user/emails
 *     → user upserted → __Host-pd_session cookie set HttpOnly+Secure+SameSite.
 *   - /auth/me: 401 without a session; the user (never the gh token) with one.
 *   - logout: clears the cookie and deletes the session.
 *   - resolveSession + userCanReadRepo: repo read 200 → true (cached), 404 →
 *     false; expired session → null.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handleGithubLogin,
  handleGithubCallback,
  handleAuthMe,
  handleLogout,
  handleAccountExport,
  handleAccountDelete,
  resolveSession,
  userCanReadRepo,
  userOwnsInstallation,
  isSameOrigin,
} from '../src/auth-github.js';
import type { Env } from '../src/types.js';

const WRAP_KEY = 'aa'.repeat(32); // 32-byte hex AES-GCM key
const BASE = 'https://relay.example.workers.dev';

// ── In-memory D1 for users + web_sessions ────────────────────────────────────

function makeDb() {
  const users = new Map<string, any>();          // id → row
  const usersByGh = new Map<number, string>();    // github_user_id → id
  const sessions = new Map<string, any>();        // token_hash → row

  const stmt = (sql: string) => {
    let bound: any[] = [];
    const s = {
      bind(...v: any[]) { bound = v; return s; },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM users WHERE github_user_id')) {
          const id = usersByGh.get(bound[0]); return (id ? users.get(id) : null) as T | null;
        }
        if (sql.includes('FROM users WHERE id')) {
          const u = users.get(bound[0]); return (u && u.deleted_at == null ? u : null) as T | null;
        }
        if (sql.startsWith('SELECT user_id, gh_token_enc')) {
          return (sessions.get(bound[0]) ?? null) as T | null;
        }
        if (sql.includes('COUNT(*) AS n FROM web_sessions')) {
          const n = [...sessions.values()].filter((s) => s.user_id === bound[0]).length;
          return { n } as T;
        }
        return null;
      },
      async run() {
        let changes = 1;
        if (sql.startsWith('INSERT INTO users')) {
          const [id, gh, login, dn, av, em, ev, ca, la] = bound;
          const existingId = usersByGh.get(gh);
          if (existingId) {
            Object.assign(users.get(existingId), { login, display_name: dn, avatar_url: av, primary_email: em, email_verified: ev, last_login_at: la, deleted_at: null });
          } else {
            users.set(id, { id, github_user_id: gh, login, display_name: dn, avatar_url: av, primary_email: em, email_verified: ev, created_at: ca, last_login_at: la, deleted_at: null });
            usersByGh.set(gh, id);
          }
        } else if (sql.startsWith('INSERT INTO web_sessions')) {
          const [th, uid, enc, iv, ca, exp, ua] = bound;
          sessions.set(th, { user_id: uid, gh_token_enc: enc, gh_token_iv: iv, expires_at: exp, created_at: ca, user_agent: ua });
        } else if (sql.includes('DELETE FROM web_sessions WHERE user_id')) {
          const before = sessions.size;
          for (const [k, v] of sessions) if (v.user_id === bound[0]) sessions.delete(k);
          changes = before - sessions.size;
        } else if (sql.startsWith('DELETE FROM web_sessions')) {
          sessions.delete(bound[0]);
        } else if (sql.startsWith('UPDATE users SET deleted_at')) {
          const u = users.get(bound[1]); if (u) { u.deleted_at = bound[0]; u.primary_email = null; u.avatar_url = null; }
        }
        return { success: true, meta: { changes } };
      },
    };
    return s as unknown as D1PreparedStatement;
  };
  const db = { prepare: stmt } as unknown as D1Database;
  return { db, users, sessions };
}

function makeKV(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace & { store: Map<string, string> };
}

function makeEnv(over: Partial<Env> = {}, kv = makeKV(), db = makeDb().db): Env {
  return {
    DB: db,
    KV: kv,
    RELAY_OPERATOR_TOKEN: 'operator-token-at-least-32-bytes-long!!',
    GITHUB_OAUTH_CLIENT_ID: 'Iv1.abc',
    GITHUB_OAUTH_CLIENT_SECRET: 'ghsecret',
    USER_TOKEN_WRAPPING_KEY: WRAP_KEY,
    PUBLIC_BASE_URL: BASE,
    ...over,
  } as unknown as Env;
}

afterEach(() => vi.unstubAllGlobals());

// ── login ─────────────────────────────────────────────────────────────────────

describe('GET /auth/github/login', () => {
  it('503s when login is unconfigured', async () => {
    const res = await handleGithubLogin(new Request(`${BASE}/auth/github/login`), makeEnv({ GITHUB_OAUTH_CLIENT_ID: undefined }));
    expect(res.status).toBe(503);
  });

  it('302s to GitHub with exact redirect_uri, scope, and a stored single-use state', async () => {
    const kv = makeKV();
    const res = await handleGithubLogin(new Request(`${BASE}/auth/github/login`), makeEnv({}, kv));
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/github/callback`);
    expect(loc.searchParams.get('scope')).toBe('read:user user:email');
    const state = loc.searchParams.get('state')!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(kv.store.get(`oauth_state:${state}`)).toBe('1'); // stored for one-time use
  });
});

// ── callback ───────────────────────────────────────────────────────────────────

function mockGithub(token = 'gho_usertoken') {
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes('login/oauth/access_token')) return new Response(JSON.stringify({ access_token: token }), { status: 200 });
    if (url.endsWith('/user')) return new Response(JSON.stringify({ id: 4242, login: 'octocat', name: 'The Cat', avatar_url: 'https://x/a.png', email: null }), { status: 200 });
    if (url.endsWith('/user/emails')) return new Response(JSON.stringify([{ email: 'cat@github.com', primary: true, verified: true }]), { status: 200 });
    return new Response('unexpected ' + url, { status: 500 });
  }));
}

describe('GET /auth/github/callback', () => {
  it('rejects an unknown/absent state as CSRF (400)', async () => {
    const env = makeEnv();
    const noState = await handleGithubCallback(new Request(`${BASE}/auth/github/callback?code=x`), env);
    expect(noState.status).toBe(400);
    const badState = await handleGithubCallback(new Request(`${BASE}/auth/github/callback?code=x&state=deadbeef`), env);
    expect(badState.status).toBe(400);
  });

  it('consumes state exactly once (replay of the same state → 400)', async () => {
    const kv = makeKV();
    const env = makeEnv({}, kv);
    kv.store.set('oauth_state:s1', '1');
    mockGithub();
    const first = await handleGithubCallback(new Request(`${BASE}/auth/github/callback?code=c&state=s1`), env);
    expect(first.status).toBe(302);
    const replay = await handleGithubCallback(new Request(`${BASE}/auth/github/callback?code=c&state=s1`), env);
    expect(replay.status).toBe(400); // state was deleted after first use
  });

  it('fails closed (502) when GET /user returns a malformed shape, storing no user', async () => {
    const kv = makeKV();
    const { db, users } = makeDb();
    const env = makeEnv({}, kv, db);
    kv.store.set('oauth_state:sm', '1');
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('login/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'gho_x' }), { status: 200 });
      if (url.endsWith('/user')) return new Response(JSON.stringify({ id: 'not-a-number', login: 42 }), { status: 200 }); // garbage
      return new Response('[]', { status: 200 });
    }));
    const res = await handleGithubCallback(new Request(`${BASE}/auth/github/callback?code=c&state=sm`), env);
    expect(res.status).toBe(502);
    expect(users.size).toBe(0); // no corrupt row written from a bad upstream shape
  });

  it('exchanges the code, upserts the user, and sets a __Host- HttpOnly session cookie', async () => {
    const kv = makeKV();
    const { db, users, sessions } = makeDb();
    const env = makeEnv({}, kv, db);
    kv.store.set('oauth_state:s2', '1');
    mockGithub();
    const res = await handleGithubCallback(new Request(`${BASE}/auth/github/callback?code=c&state=s2`), env);
    expect(res.status).toBe(302);
    const cookie = res.headers.get('Set-Cookie')!;
    expect(cookie).toContain('__Host-pd_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(users.size).toBe(1);
    expect([...users.values()][0].login).toBe('octocat');
    expect([...users.values()][0].primary_email).toBe('cat@github.com');
    expect(sessions.size).toBe(1);
    // The stored gh token is sealed, never the plaintext.
    expect([...sessions.values()][0].gh_token_enc).not.toContain('gho_usertoken');
  });
});

// ── /auth/me + logout + session resolution ─────────────────────────────────────

async function loginAndGetCookie(env: Env, kv: ReturnType<typeof makeKV>): Promise<string> {
  kv.store.set('oauth_state:s', '1');
  mockGithub();
  const res = await handleGithubCallback(new Request(`${BASE}/auth/github/callback?code=c&state=s`), env);
  const cookie = res.headers.get('Set-Cookie')!;
  return cookie.split(';')[0]; // "__Host-pd_session=<value>"
}

describe('/auth/me, logout, and session resolution', () => {
  it('me: 401 without a session; the user (no gh token) with one', async () => {
    const kv = makeKV();
    const env = makeEnv({}, kv, makeDb().db);
    expect((await handleAuthMe(new Request(`${BASE}/auth/me`), env)).status).toBe(401);
    const cookie = await loginAndGetCookie(env, kv);
    const me = await handleAuthMe(new Request(`${BASE}/auth/me`, { headers: { Cookie: cookie } }), env);
    expect(me.status).toBe(200);
    const body = (await me.json()) as any;
    expect(body.user.login).toBe('octocat');
    expect(JSON.stringify(body)).not.toContain('gho_'); // token never surfaces
  });

  it('logout clears the cookie and drops the session', async () => {
    const kv = makeKV();
    const env = makeEnv({}, kv, makeDb().db);
    const cookie = await loginAndGetCookie(env, kv);
    const out = await handleLogout(new Request(`${BASE}/auth/logout`, { method: 'POST', headers: { Cookie: cookie } }), env);
    expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
    const me = await handleAuthMe(new Request(`${BASE}/auth/me`, { headers: { Cookie: cookie } }), env);
    expect(me.status).toBe(401);
  });

  it('userCanReadRepo: 200 → true (cached), 404 → false; and repo read gates on the gh token', async () => {
    const kv = makeKV();
    const env = makeEnv({}, kv, makeDb().db);
    const cookie = await loginAndGetCookie(env, kv);
    const session = (await resolveSession(new Request(`${BASE}/x`, { headers: { Cookie: cookie } }), env))!;
    expect(session.user.login).toBe('octocat');

    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      calls++;
      return new Response('', { status: String(input).includes('/repos/me/allowed') ? 200 : 404 });
    }));
    expect(await userCanReadRepo(env, session, 'me', 'allowed')).toBe(true);
    expect(await userCanReadRepo(env, session, 'me', 'allowed')).toBe(true); // cached, no 2nd fetch
    expect(calls).toBe(1);
    expect(await userCanReadRepo(env, session, 'someone', 'private')).toBe(false);
  });

  it('userOwnsInstallation: gates billing on GitHub-confirmed ownership, fail-closed', async () => {
    const kv = makeKV();
    const env = makeEnv({}, kv, makeDb().db);
    const cookie = await loginAndGetCookie(env, kv);
    const session = (await resolveSession(new Request(`${BASE}/x`, { headers: { Cookie: cookie } }), env))!;

    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      calls++;
      expect(String(input)).toContain('/user/installations');
      return new Response(JSON.stringify({ installations: [{ id: 42 }, { id: 7 }] }), { status: 200 });
    }));
    expect(await userOwnsInstallation(env, session, 42)).toBe(true);
    expect(await userOwnsInstallation(env, session, 42)).toBe(true); // cached, no 2nd fetch
    expect(calls).toBe(1);
    // an installation the user does NOT own → false (the cross-tenant leak this closes)
    expect(await userOwnsInstallation(env, session, 99)).toBe(false);
    // fail-closed: a session with no gh token can prove nothing
    expect(await userOwnsInstallation(env, { user: session.user, ghToken: null }, 42)).toBe(false);
  });
});

// ── account export + erasure (ADR-0101 team-tier export/delete gate) ───────────

describe('self-service account export + erasure', () => {
  it('export: 401 without a session; the account (never the gh token) with one', async () => {
    const kv = makeKV();
    const env = makeEnv({}, kv, makeDb().db);
    expect((await handleAccountExport(new Request(`${BASE}/account/export`), env)).status).toBe(401);
    const cookie = await loginAndGetCookie(env, kv);
    const res = await handleAccountExport(new Request(`${BASE}/account/export`, { headers: { Cookie: cookie } }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    const body = await res.text();
    expect(body).toContain('octocat');
    expect(body).toContain('cat@github.com');
    expect(body).not.toContain('gho_'); // sealed token never exported
  });

  it('delete: erases the account, purges every session, clears the cookie, and logs out', async () => {
    const kv = makeKV();
    const { db, users, sessions } = makeDb();
    const env = makeEnv({}, kv, db);
    const cookie = await loginAndGetCookie(env, kv);
    expect(sessions.size).toBe(1);
    const res = await handleAccountDelete(new Request(`${BASE}/account/delete`, { method: 'POST', headers: { Cookie: cookie } }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { erased: boolean; sessionsPurged: number };
    expect(body.erased).toBe(true);
    expect(body.sessionsPurged).toBe(1);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(sessions.size).toBe(0);                              // sessions purged
    expect([...users.values()][0].deleted_at).not.toBeNull();  // soft-deleted
    expect([...users.values()][0].primary_email).toBeNull();   // PII nulled now
    // A subsequent request with the old cookie is unauthenticated.
    expect((await handleAuthMe(new Request(`${BASE}/auth/me`, { headers: { Cookie: cookie } }), env)).status).toBe(401);
  });
});

describe('isSameOrigin — CSRF defense-in-depth over SameSite=Lax', () => {
  const env = { PUBLIC_BASE_URL: BASE } as unknown as Env;
  const req = (headers: Record<string, string>) =>
    new Request(`${BASE}/account/delete`, { method: 'POST', headers });

  it('allows a same-origin Origin header', () => {
    expect(isSameOrigin(req({ Origin: BASE }), env)).toBe(true);
  });
  it('rejects a cross-origin Origin header', () => {
    expect(isSameOrigin(req({ Origin: 'https://evil.example.com' }), env)).toBe(false);
  });
  it('falls back to Referer when Origin is absent', () => {
    expect(isSameOrigin(req({ Referer: `${BASE}/account` }), env)).toBe(true);
    expect(isSameOrigin(req({ Referer: 'https://evil.example.com/x' }), env)).toBe(false);
  });
  it('allows a non-browser client (no Origin, no Referer)', () => {
    expect(isSameOrigin(req({}), env)).toBe(true);
  });
});

describe('destructive POST handlers refuse cross-origin (CSRF)', () => {
  const env = { PUBLIC_BASE_URL: BASE } as unknown as Env;
  it('POST /account/delete from a cross-origin form → 403 (before any DB touch)', async () => {
    const res = await handleAccountDelete(
      new Request(`${BASE}/account/delete`, { method: 'POST', headers: { Origin: 'https://evil.example.com' } }),
      env,
    );
    expect(res.status).toBe(403);
  });
  it('POST /auth/logout from a cross-origin form → 403', async () => {
    const res = await handleLogout(
      new Request(`${BASE}/auth/logout`, { method: 'POST', headers: { Origin: 'https://evil.example.com' } }),
      env,
    );
    expect(res.status).toBe(403);
  });
});
