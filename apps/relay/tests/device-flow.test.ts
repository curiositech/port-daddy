/**
 * Device-flow login tests (src/device-flow.ts, ADR-0101 Phase 1). Covers the
 * protocol logic with a mocked GitHub `fetch`: start (+ device-flow-disabled and
 * unconfigured), the poll's pending/error branches, bad requests, pdu_ bearer
 * parsing, and whoami's unauthenticated path. The token-minting path (DB writes)
 * is exercised end-to-end against the deployed relay.
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
const env = (over: Partial<Env> = {}) =>
  ({ GITHUB_OAUTH_CLIENT_ID: 'Iv1.test', DB: {} as unknown, ...over }) as unknown as Env;

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
  // Non-tautology: the handler TRANSFORMS GitHub's payload — it supplies its own
  // defaults for interval/expires_in when GitHub omits them. A pass-through of
  // the mock would return undefined for these, so this pins real logic.
  it('supplies default interval/expires_in that GitHub did not send', async () => {
    stubFetch(() => ({ body: { device_code: 'dc', user_code: 'AB-12', verification_uri: 'https://github.com/login/device' } }));
    const b = await (await handleDeviceStart(new Request(`${BASE}/auth/device/start`, { method: 'POST' }), env())).json();
    expect(b.interval).toBe(5); // handler default, not from the mock
    expect(b.expires_in).toBe(900); // handler default, not from the mock
  });
  // Non-tautology: the request that reaches GitHub carries OUR client_id + scope,
  // not something echoed from the response.
  it('sends the configured client_id + device scope to GitHub', async () => {
    let sentBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ device_code: 'dc', user_code: 'AB-12', verification_uri: 'https://x' }));
    }));
    await handleDeviceStart(new Request(`${BASE}/auth/device/start`, { method: 'POST' }), env({ GITHUB_OAUTH_CLIENT_ID: 'Iv1.abc' }));
    expect(sentBody).toMatchObject({ client_id: 'Iv1.abc', scope: 'read:user user:email' });
  });
});

describe('handleDeviceToken', () => {
  const post = (body: unknown) =>
    new Request(`${BASE}/auth/device/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('400 without a device_code', async () => {
    expect((await handleDeviceToken(post({}), env())).status).toBe(400);
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
});

describe('handleWhoami', () => {
  it('401 with no session and no bearer', async () => {
    const res = await handleWhoami(new Request(`${BASE}/auth/whoami`), env());
    expect(res.status).toBe(401);
  });
});
