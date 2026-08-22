/**
 * X6 deprecation machinery tests (src/deprecations.ts + src/index.ts wiring):
 *   - header emission per deprecated route (RFC 9745 `Deprecation: @unix`,
 *     RFC 8594 `Sunset: HTTP-date`, Link successor-version + deprecation);
 *   - alias equivalence: /v1/auth/* and /v1/billing/* answer BYTE-IDENTICAL
 *     bodies to the bare forms - success and error paths - with no
 *     deprecation headers on the canonical form;
 *   - the structured 410 tombstone end-to-end through the router (test seam),
 *     pinned to the shared golden fixture the client renderer also asserts
 *     (tests/fixtures/relay-tombstone-golden.json at the repo root).
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach } from 'vitest';
import worker from '../src/index.js';
import {
  DEPRECATIONS,
  matchDeprecation,
  canonicalizeDeprecatedPath,
  setDeprecationsForTesting,
  renderTombstone,
} from '../src/deprecations.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.portdaddy.dev';
const WEB_ORIGIN = 'https://portdaddy.dev';
const ctx = {} as ExecutionContext;

const golden = JSON.parse(
  readFileSync(
    new URL('../../../tests/fixtures/relay-tombstone-golden.json', import.meta.url),
    'utf8',
  ),
) as { status: number; body: Record<string, unknown> };

const AUTH = DEPRECATIONS.find((d) => d.id === 'auth-unversioned')!;
const BILLING = DEPRECATIONS.find((d) => d.id === 'billing-unversioned')!;

/** Minimal D1 stub answering prepare().bind().first() from a row queue
 *  (resolveSession issues two firsts: session row, then user row). */
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
        primary_email: null,
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

describe('X6 header emission on deprecated routes', () => {
  it('GET /auth/whoami carries Deprecation, Sunset, and Link', async () => {
    const res = await worker.fetch(new Request(`${BASE}/auth/whoami`), {} as Env, ctx);
    expect(res.headers.get('Deprecation')).toBe(`@${AUTH.deprecatedAt}`);
    expect(res.headers.get('Sunset')).toBe(new Date(AUTH.sunsetAt! * 1000).toUTCString());
    const link = res.headers.get('Link')!;
    expect(link).toContain('</v1/auth/whoami>; rel="successor-version"');
    expect(link).toContain(`<${AUTH.docsUrl}>; rel="deprecation"`);
  });

  it('GET /billing/balance/abc (error path) still carries the headers', async () => {
    const res = await worker.fetch(new Request(`${BASE}/billing/balance/abc`), {} as Env, ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Deprecation')).toBe(`@${BILLING.deprecatedAt}`);
    expect(res.headers.get('Sunset')).toBe(new Date(BILLING.sunsetAt! * 1000).toUTCString());
    expect(res.headers.get('Link')).toContain('</v1/billing/balance/abc>; rel="successor-version"');
  });

  it('the canonical /v1/ twins carry NO deprecation headers', async () => {
    for (const path of ['/v1/auth/whoami', '/v1/billing/balance/abc']) {
      const res = await worker.fetch(new Request(`${BASE}${path}`), {} as Env, ctx);
      expect(res.headers.get('Deprecation')).toBeNull();
      expect(res.headers.get('Sunset')).toBeNull();
      expect(res.headers.get('Link')).toBeNull();
    }
  });

  it('non-deprecated routes carry NO deprecation headers', async () => {
    const res = await worker.fetch(new Request(`${BASE}/health`), { RELAY_ED25519_PRIVATE_KEY_HEX: 'ab'.repeat(32) } as unknown as Env, ctx);
    expect(res.headers.get('Deprecation')).toBeNull();
  });
});

describe('X6 pure aliasing (canonicalizeDeprecatedPath)', () => {
  it('maps only the deprecated namespaces', () => {
    expect(canonicalizeDeprecatedPath('/v1/auth/status')).toBe('/auth/status');
    expect(canonicalizeDeprecatedPath('/v1/billing/portal')).toBe('/billing/portal');
    expect(canonicalizeDeprecatedPath('/v1/harbors')).toBe('/v1/harbors');
    expect(canonicalizeDeprecatedPath('/auth/status')).toBe('/auth/status');
    expect(canonicalizeDeprecatedPath('/health')).toBe('/health');
  });

  it('matchDeprecation hits the bare forms only', () => {
    expect(matchDeprecation('/auth/status')?.id).toBe('auth-unversioned');
    expect(matchDeprecation('/billing/webhook')?.id).toBe('billing-unversioned');
    expect(matchDeprecation('/v1/auth/status')).toBeNull();
    expect(matchDeprecation('/v1/billing/portal')).toBeNull();
    expect(matchDeprecation('/authx')).toBeNull();
  });
});

/** Fetch the same logical route via the deprecated and canonical forms with
 *  FRESH envs (stubs are consumed per request), and return both responses. */
async function aliasPair(
  path: string,
  init: RequestInit | undefined,
  envFactory: () => Env,
): Promise<{ oldRes: Response; newRes: Response }> {
  const oldRes = await worker.fetch(new Request(`${BASE}${path}`, init), envFactory(), ctx);
  const newRes = await worker.fetch(new Request(`${BASE}/v1${path}`, init), envFactory(), ctx);
  return { oldRes, newRes };
}

/**
 * x7 (requestId-on-every-response, landed after this suite was written) stamps
 * a fresh `req_<hex>` into every JSON error envelope, so two separate requests
 * can never be literally byte-identical. The equivalence this suite pins is
 * ROUTE equivalence — same handler, same body modulo the request-scoped id —
 * so the id is normalized to a fixed placeholder before comparing.
 */
function normalizeRequestId(text: string): string {
  return text.replace(/req_[0-9a-f]{16}/g, 'req_NORMALIZED');
}

async function expectByteIdentical(oldRes: Response, newRes: Response): Promise<void> {
  expect(newRes.status).toBe(oldRes.status);
  expect(normalizeRequestId(await newRes.text())).toBe(normalizeRequestId(await oldRes.text()));
  expect(newRes.headers.get('Content-Type')).toBe(oldRes.headers.get('Content-Type'));
  // The ONLY divergence is the deprecation trio on the bare form.
  expect(oldRes.headers.get('Deprecation')).not.toBeNull();
  expect(newRes.headers.get('Deprecation')).toBeNull();
  expect(newRes.headers.get('Sunset')).toBeNull();
  expect(newRes.headers.get('Link')).toBeNull();
}

describe('X6 alias equivalence - old and new paths byte-identical', () => {
  it('signed-in GET /auth/status === /v1/auth/status (success path)', async () => {
    const { oldRes, newRes } = await aliasPair(
      '/auth/status',
      { headers: { Cookie: '__Host-pd_session=abc123' } },
      signedInEnv,
    );
    expect(oldRes.status).toBe(200);
    // Both forms are session probes - both keep the credentialed CORS pin.
    expect(oldRes.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(newRes.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    await expectByteIdentical(oldRes, newRes);
  });

  it('unauthenticated GET /auth/whoami === /v1/auth/whoami (401 error path)', async () => {
    const { oldRes, newRes } = await aliasPair('/auth/whoami', undefined, () => ({} as Env));
    expect(oldRes.status).toBe(401);
    await expectByteIdentical(oldRes, newRes);
  });

  it('POST /billing/checkout unconfigured === /v1 twin (503 error path)', async () => {
    const { oldRes, newRes } = await aliasPair(
      '/billing/checkout',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      () => ({} as Env),
    );
    expect(oldRes.status).toBe(503);
    await expectByteIdentical(oldRes, newRes);
  });

  it('GET /billing/balance/abc === /v1 twin (400 error path)', async () => {
    const { oldRes, newRes } = await aliasPair('/billing/balance/abc', undefined, () => ({} as Env));
    expect(oldRes.status).toBe(400);
    await expectByteIdentical(oldRes, newRes);
  });

  it('unknown route under the prefix: /auth/nope 404 === /v1/auth/nope', async () => {
    const { oldRes, newRes } = await aliasPair('/auth/nope', undefined, () => ({} as Env));
    expect(oldRes.status).toBe(404);
    await expectByteIdentical(oldRes, newRes);
  });
});

describe('X6 structured 410 tombstone', () => {
  afterEach(() => setDeprecationsForTesting(null));

  it('renderTombstone matches the shared golden fixture exactly', async () => {
    const res = renderTombstone(AUTH, '/auth/status');
    expect(res.status).toBe(golden.status);
    expect(await res.json()).toEqual(golden.body);
  });

  it('a tombstoned surface answers the golden 410 through the router, decorated', async () => {
    setDeprecationsForTesting([{ ...AUTH, tombstoned: true }]);
    const res = await worker.fetch(new Request(`${BASE}/auth/status`), {} as Env, ctx);
    expect(res.status).toBe(410);
    // x7 adds a request-scoped requestId to every JSON envelope; the golden
    // fixture pins the tombstone shape, not the per-request id.
    const { requestId, ...body } = (await res.json()) as Record<string, unknown>;
    expect(requestId).toMatch(/^req_[0-9a-f]{16}$/);
    expect(body).toEqual(golden.body);
    // Tombstones keep the deprecation trio so clients see the full lifecycle.
    expect(res.headers.get('Deprecation')).toBe(`@${AUTH.deprecatedAt}`);
    expect(res.headers.get('Sunset')).toBe(new Date(AUTH.sunsetAt! * 1000).toUTCString());
  });

  it('the canonical /v1/ twin keeps working while the bare form is tombstoned', async () => {
    setDeprecationsForTesting([{ ...AUTH, tombstoned: true }]);
    const res = await worker.fetch(withCookie(`${BASE}/v1/auth/status`), signedInEnv(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Deprecation')).toBeNull();
  });

  it('the real registry ships with NOTHING tombstoned (aliases stay live)', () => {
    for (const d of DEPRECATIONS) expect(d.tombstoned).toBe(false);
  });
});
