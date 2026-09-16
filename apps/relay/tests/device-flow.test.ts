/**
 * Device-flow login tests (src/device-flow.ts, ADR-0101 Phase 1). Covers the
 * protocol logic with mocked GitHub and D1 boundaries: start
 * (+ device-flow-disabled and unconfigured), the poll's pending/error branches,
 * the complete expiring GitHub App credential exchange, pdu_ bearer parsing,
 * and whoami's unauthenticated path.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handleDeviceStart,
  handleDeviceToken,
  handleWhoami,
  readBearerToken,
} from '../src/device-flow.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example.workers.dev';
const WRAP_KEY = 'aa'.repeat(32);
const env = (over: Partial<Env> = {}) =>
  ({ GITHUB_OAUTH_CLIENT_ID: 'Iv23.test', USER_TOKEN_WRAPPING_KEY: WRAP_KEY, DB: {} as unknown, ...over }) as unknown as Env;

afterEach(() => vi.unstubAllGlobals());

function stubFetch(fn: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body } = fn(String(url), init);
    return new Response(JSON.stringify(body), { status });
  }));
}

describe('readBearerToken', () => {
  const req = (auth?: string) => new Request(`${BASE}/x`, auth ? { headers: { Authorization: auth } } : {});
  it('extracts a well-formed pdu_ token', () => {
    const tok = `pdu_${'a'.repeat(64)}`;
    expect(readBearerToken(req(`Bearer ${tok}`))).toBe(tok);
  });
  it('rejects a non-pdu / malformed token', () => {
    expect(readBearerToken(req('Bearer ghp_whatever'))).toBeNull();
    expect(readBearerToken(req(`Bearer pdu_short`))).toBeNull();
    expect(readBearerToken(req())).toBeNull();
  });
});

describe('handleDeviceStart', () => {
  it('503 when the client id is unconfigured', async () => {
    const res = await handleDeviceStart(new Request(`${BASE}/auth/device/start`, { method: 'POST' }), env({ GITHUB_OAUTH_CLIENT_ID: undefined }));
    expect(res.status).toBe(503);
  });
  it('returns the user code + verification uri on success', async () => {
    stubFetch(() => ({ body: { device_code: 'dc', user_code: 'WXYZ-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 } }));
    const res = await handleDeviceStart(new Request(`${BASE}/auth/device/start`, { method: 'POST' }), env());
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toMatchObject({ user_code: 'WXYZ-1234', verification_uri: 'https://github.com/login/device', device_code: 'dc' });
  });
  it('502 with a helpful error when device flow is disabled on the App', async () => {
    stubFetch(() => ({ body: { error: 'device_flow_disabled' } }));
    const res = await handleDeviceStart(new Request(`${BASE}/auth/device/start`, { method: 'POST' }), env());
    expect(res.status).toBe(502);
  });
  it('returns a bounded 502 when GitHub transport rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    const res = await handleDeviceStart(new Request(`${BASE}/auth/device/start`, { method: 'POST' }), env());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'DEVICE_START_FAILED' });
  });
  // Non-tautology: the handler TRANSFORMS GitHub's payload — it supplies its own
  // defaults for interval/expires_in when GitHub omits them. A pass-through of
  // the mock would return undefined for these, so this pins real logic.
  it('supplies default interval/expires_in that GitHub did not send', async () => {
    stubFetch(() => ({ body: { device_code: 'dc', user_code: 'AB-12', verification_uri: 'https://github.com/login/device' } }));
    const b = await (await handleDeviceStart(new Request(`${BASE}/auth/device/start`, { method: 'POST' }), env())).json();
    expect(b.interval).toBe(5); // handler default, not from the mock
    expect(b.expires_in).toBe(900); // handler default, not from the mock
  });
  // GitHub App user access tokens use App permissions, not OAuth scopes.
  it('sends only the configured App client_id with bounded no-redirect I/O', async () => {
    let sentBody: unknown;
    let sentInit: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sentInit = init;
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ device_code: 'dc', user_code: 'AB-12', verification_uri: 'https://x' }));
    }));
    await handleDeviceStart(new Request(`${BASE}/auth/device/start`, { method: 'POST' }), env({ GITHUB_OAUTH_CLIENT_ID: 'Iv23.abc' }));
    expect(sentBody).toEqual({ client_id: 'Iv23.abc' });
    expect(sentInit?.redirect).toBe('error');
    expect(sentInit?.signal).toBeInstanceOf(AbortSignal);
  });
});

function makeDeviceDb() {
  const users = new Map<number, Record<string, unknown>>();
  const tokenRows: unknown[][] = [];
  const prepare = (sql: string) => {
    let bound: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { bound = values; return statement; },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM users WHERE github_user_id')) {
          return (users.get(Number(bound[0])) ?? null) as T | null;
        }
        return null;
      },
      async run() {
        if (sql.includes('INSERT INTO users')) {
          const [id, githubUserId, login, displayName, avatarUrl, primaryEmail, emailVerified, createdAt, lastLoginAt] = bound;
          users.set(Number(githubUserId), {
            id,
            github_user_id: githubUserId,
            login,
            display_name: displayName,
            avatar_url: avatarUrl,
            primary_email: primaryEmail,
            email_verified: emailVerified,
            created_at: createdAt,
            last_login_at: lastLoginAt,
            deleted_at: null,
          });
        } else if (sql.includes('INSERT INTO user_tokens')) {
          tokenRows.push(bound);
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return statement as unknown as D1PreparedStatement;
  };
  return { db: { prepare } as unknown as D1Database, users, tokenRows };
}

describe('handleDeviceToken', () => {
  const post = (body: unknown) =>
    new Request(`${BASE}/auth/device/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('400 without a device_code', async () => {
    expect((await handleDeviceToken(post({}), env())).status).toBe(400);
  });
  it('returns a bounded 502 when the token poll transport rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    const res = await handleDeviceToken(post({ device_code: 'dc' }), env());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'TOKEN_POLL_FAILED' });
  });
  it('returns pending while the user has not authorized yet', async () => {
    stubFetch(() => ({ body: { error: 'authorization_pending' } }));
    const res = await handleDeviceToken(post({ device_code: 'dc' }), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pending: true, error: 'authorization_pending' });
  });
  it('slow_down is also pending', async () => {
    stubFetch(() => ({ body: { error: 'slow_down' } }));
    expect(await (await handleDeviceToken(post({ device_code: 'dc' }), env())).json()).toMatchObject({ pending: true });
  });
  it('a terminal error (access_denied) is not pending → 400', async () => {
    stubFetch(() => ({ body: { error: 'access_denied' } }));
    const res = await handleDeviceToken(post({ device_code: 'dc' }), env());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ pending: false });
  });

  it('stores one row-bound encrypted expiring App credential and returns only a pdu token', async () => {
    const database = makeDeviceDb();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/login/oauth/access_token')) {
        return Response.json({
          access_token: 'ghu_device_access',
          expires_in: 28_800,
          refresh_token: 'ghr_device_refresh',
          refresh_token_expires_in: 15_897_600,
          scope: '',
          token_type: 'bearer',
        });
      }
      if (url.endsWith('/user')) {
        return Response.json({ id: 42, login: 'operator', name: 'Operator', avatar_url: 'https://example.test/a.png', email: null });
      }
      if (url.endsWith('/user/emails')) {
        return Response.json([{ email: 'operator@example.test', primary: true, verified: true }]);
      }
      return new Response('', { status: 404 });
    }));

    const response = await handleDeviceToken(
      post({ device_code: 'dc', label: 'FleetBar' }),
      env({ DB: database.db }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { token: string; login: string };
    expect(body.token).toMatch(/^pdu_[0-9a-f]{64}$/);
    expect(body.login).toBe('operator');
    expect(JSON.stringify(body)).not.toContain('ghu_');
    expect(JSON.stringify(body)).not.toContain('ghr_');
    expect(database.tokenRows).toHaveLength(1);
    const stored = database.tokenRows[0]!;
    expect(stored[2]).toBe('FleetBar');
    expect(stored[5]).not.toContain('ghu_device_access');
    expect(stored[5]).not.toContain('ghr_device_refresh');
    expect(stored[6]).toEqual(expect.any(String));
    expect(stored[7]).toBe(1);
    expect(calls.every(({ init }) => init.redirect === 'error' && init.signal instanceof AbortSignal)).toBe(true);
  });
});

describe('handleWhoami', () => {
  it('401 with no session and no bearer', async () => {
    const res = await handleWhoami(new Request(`${BASE}/auth/whoami`), env());
    expect(res.status).toBe(401);
  });
});
