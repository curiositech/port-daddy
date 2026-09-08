/**
 * GET /auth/status + credentialed CORS tests (src/auth-github.ts handleAuthStatus,
 * src/index.ts corsCredentialed). Coverage:
 *   - /auth/status and /auth/whoami answer with the PINNED origin
 *     (https://portdaddy.dev) + Access-Control-Allow-Credentials — never the
 *     wildcard, which browsers reject for credentialed fetches.
 *   - every other route keeps the wildcard, credential-LESS CORS (the
 *     credentialed pair must stay scoped to exactly the two session probes).
 *   - OPTIONS preflight on the credentialed paths carries the same headers.
 *   - /auth/status body is EXACTLY {code, login, avatarUrl} — no email, no ids,
 *     no session/token material (no secrets: the body is cross-origin readable).
 *   - /auth/status is session-cookie only: a pdu_ bearer does not authenticate it.
 */

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { handleAuthStatus } from '../src/auth-github.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.portdaddy.dev';
const WEB_ORIGIN = 'https://portdaddy.dev';
const ctx = {} as ExecutionContext;

/**
 * Minimal D1 stub that answers `prepare().bind().first()` from a queue of rows.
 * getWebSession issues two firsts (session row, then user row).
 */
function stubDb(rows: unknown[]): unknown {
  let i = 0;
  const stmt = {
    bind: () => stmt,
    first: async () => rows[i++] ?? null,
  };
  return { prepare: () => stmt };
}

const now = () => Math.floor(Date.now() / 1000);

function signedInEnv(): Env {
  return {
    DB: stubDb([
      { user_id: 'u_1', gh_token_enc: null, gh_token_iv: null, expires_at: now() + 3600 },
      {
        id: 'u_1',
        github_user_id: 424242,
        login: 'mariner',
        display_name: 'Mariner',
        avatar_url: 'https://avatars.githubusercontent.com/u/999888',
        primary_email: 'secret@example.com',
        email_verified: 1,
        created_at: now() - 100,
        last_login_at: null,
        deleted_at: null,
      },
    ]),
  } as unknown as Env;
}

const withCookie = (url: string) =>
  new Request(url, { headers: { Cookie: '__Host-pd_session=abc123' } });

describe('credentialed CORS scoping (index.ts)', () => {
  it('GET /auth/status answers with the pinned origin + credentials, not the wildcard', async () => {
    const res = await worker.fetch(new Request(`${BASE}/auth/status`), {} as Env, ctx);
    expect(res.status).toBe(401); // no cookie
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('GET /auth/whoami answers with the pinned origin + credentials', async () => {
    const res = await worker.fetch(new Request(`${BASE}/auth/whoami`), {} as Env, ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('OPTIONS preflight on /auth/status carries the credentialed pair', async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/auth/status`, { method: 'OPTIONS' }),
      {} as Env,
      ctx,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('every other route keeps wildcard CORS with NO credentials header', async () => {
    for (const path of ['/health', '/auth/logout-nope', '/v1/audit-nope']) {
      const res = await worker.fetch(new Request(`${BASE}${path}`), {} as Env, ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      // Wildcard + credentials is both invalid and dangerous; assert it never appears.
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    }
  });

  it('OPTIONS preflight elsewhere stays wildcard', async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/v1/publish`, { method: 'OPTIONS' }),
      {} as Env,
      ctx,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
});

describe('handleAuthStatus (auth-github.ts)', () => {
  it('401 with null fields when there is no session cookie', async () => {
    const res = await handleAuthStatus(new Request(`${BASE}/auth/status`), {} as Env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'UNAUTHENTICATED', login: null, avatarUrl: null });
  });

  it('returns exactly {code, login, avatarUrl} for a live session — and nothing else', async () => {
    const res = await handleAuthStatus(withCookie(`${BASE}/auth/status`), signedInEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Exact key set: adding any field here must be a conscious, reviewed act —
    // the response is readable cross-origin from portdaddy.dev.
    expect(Object.keys(body).sort()).toEqual(['avatarUrl', 'code', 'login']);
    expect(body).toEqual({
      code: 'OK',
      login: 'mariner',
      avatarUrl: 'https://avatars.githubusercontent.com/u/999888',
    });
  });

  it('leaks no secrets: email / ids / token material never appear in the body', async () => {
    const res = await handleAuthStatus(withCookie(`${BASE}/auth/status`), signedInEnv());
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('secret@example.com');
    expect(raw).not.toContain('424242'); // github_user_id is NOT part of the probe
    expect(raw).not.toContain('"u_1"'); // nor the internal user id
    expect(raw).not.toContain('gh_token');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('an expired session is signed out', async () => {
    const env = {
      DB: stubDb([
        { user_id: 'u_1', gh_token_enc: null, gh_token_iv: null, expires_at: now() - 10 },
      ]),
    } as unknown as Env;
    const res = await handleAuthStatus(withCookie(`${BASE}/auth/status`), env);
    expect(res.status).toBe(401);
  });

  it('a pdu_ bearer token does NOT authenticate the browser probe', async () => {
    const req = new Request(`${BASE}/auth/status`, {
      headers: { Authorization: `Bearer pdu_${'a'.repeat(64)}` },
    });
    // No DB stub needed: the cookie path bails before any query, proving the
    // bearer was never consulted.
    const res = await handleAuthStatus(req, {} as Env);
    expect(res.status).toBe(401);
  });
});
