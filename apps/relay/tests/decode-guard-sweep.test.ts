/**
 * Router-boundary sweep: EVERY route in src/index.ts that pulled a path
 * segment through a raw `decodeURIComponent` call, other than the two
 * routes that already guard their own decode (the transcript-family routes
 * via `safeDecodeSegment`, and `/account/harbors/` via an inline try/catch).
 *
 * `decodeURIComponent` throws `URIError` on a malformed percent-escape
 * (`%ZZ`). Unguarded, that throw escapes routing entirely and lands on the
 * worker's global fail-closed boundary, which answers 500 INTERNAL_ERROR —
 * for what is only ever a bad URL, never an infra failure. Every route below
 * now decodes through `safeDecodeSegment` (returns '' on a bad escape)
 * instead, and this file proves two things per route:
 *
 *   1. A malformed escape no longer 500s (the bug).
 *   2. The '' that `safeDecodeSegment` produces is REJECTED by the same
 *      check the route already runs against a well-formed but unknown/
 *      invalid value — so the malformed-encoding case lands in an existing
 *      answer bucket (a 404, a 400, or an unconditional-idempotent 200),
 *      never a new distinguishable one.
 *
 * `/account/parleys/` is deliberately NOT covered here — it is still a raw,
 * unguarded `decodeURIComponent` on `main` as of this sweep, but it is the
 * exact route PR #10147 (branch `claude/rescue-9730-parley-404`) fixes; fixing
 * it here too would just race that PR's own routing change.
 */

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import {
  makeParleyDb,
  makeParleyEnv,
  req,
  ALICE_TOKEN,
  ALICE_SESSION,
} from './support/parley-fixture.js';

// >= 32 chars: operatorOnly()/fleetOperatorOnly() fail-closed (500
// MISCONFIGURED) below the minimum length, so this must clear it.
const OPERATOR_TOKEN = 'sweep-operator-token-0123456789-0123456789';

function operatorEnv() {
  const fx = makeParleyDb();
  return makeParleyEnv(fx.db, { RELAY_OPERATOR_TOKEN: OPERATOR_TOKEN });
}

const OPERATOR_AUTH = { Authorization: `Bearer ${OPERATOR_TOKEN}` };

async function fetchWith(path: string, opts: { headers?: Record<string, string>; method?: string; body?: string } = {}) {
  const request = new Request(`https://relay.example${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.headers,
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  });
  return worker.fetch(request, operatorEnv(), {} as ExecutionContext);
}

async function assertNo500(res: Response, expectedStatus: number): Promise<string> {
  const body = await res.text();
  expect(body).not.toMatch(/INTERNAL_ERROR/);
  expect(res.status).toBe(expectedStatus);
  return body;
}

describe('decode-guard sweep: malformed percent-escapes never reach the 500 boundary', () => {
  it('GET /v1/fleet/runs/%ZZ — 400, same bucket as any badly-shaped run id (isSafeRunId)', async () => {
    const res = await fetchWith('/v1/fleet/runs/%ZZ', { headers: OPERATOR_AUTH });
    await assertNo500(res, 400);
  });

  it('DELETE /v1/fleet/runs/%ZZ — 400, same bucket as any badly-shaped run id (isSafeRunId)', async () => {
    const res = await fetchWith('/v1/fleet/runs/%ZZ', { method: 'DELETE', headers: OPERATOR_AUTH });
    await assertNo500(res, 400);
  });

  it('POST /v1/interruptions/%ZZ/answer — 404, same as an unknown interruption id (DB miss)', async () => {
    const res = await fetchWith('/v1/interruptions/%ZZ/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `__Host-pd_session=${ALICE_SESSION}` },
      body: JSON.stringify({ answer: 'ok' }),
    });
    const body = await assertNo500(res, 404);
    expect(body).toContain('no such interruption');
  });

  it('POST /v1/interruptions/%ZZ/ack — 404, same as an unknown interruption id (DB miss)', async () => {
    const res = await fetchWith('/v1/interruptions/%ZZ/ack', {
      method: 'POST',
      headers: { Cookie: `__Host-pd_session=${ALICE_SESSION}` },
    });
    const body = await assertNo500(res, 404);
    expect(body).toContain('no such interruption');
  });

  it('DELETE /v1/push/apns/devices/%ZZ — 200 removed:*, idempotent-delete route treats it like any unregistered device', async () => {
    const res = await fetchWith('/v1/push/apns/devices/%ZZ', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ALICE_TOKEN}` },
    });
    await assertNo500(res, 200);
  });

  it('GET /fleet/runs/%ZZ (HTML page) — 404, the page\'s own "unauthorized and unknown are the same 404"', async () => {
    const res = await fetchWith('/fleet/runs/%ZZ');
    await assertNo500(res, 404);
  });

  it('GET /skills/%ZZ (HTML page) — 404, same as any id that fails parseQualifiedSkillId', async () => {
    const res = await fetchWith('/skills/%ZZ');
    await assertNo500(res, 404);
  });

  it('GET /v1/skills/%ZZ (JSON body API) — 404 NOT_FOUND, same as any id that fails parseQualifiedSkillId', async () => {
    const res = await fetchWith('/v1/skills/%ZZ');
    const body = await assertNo500(res, 404);
    expect(body).toContain('NOT_FOUND');
  });

  it('GET /billing/balance/%ZZ — 400, same bucket as any non-numeric installation id', async () => {
    // No operator/session credential needed: the positive-integer format
    // check runs before any auth check in handleBillingBalance.
    const res = await fetchWith('/billing/balance/%ZZ');
    const body = await assertNo500(res, 400);
    expect(body).toContain('BAD_REQUEST');
  });

  it('GET /v1/quotas/%ZZ — 400, same bucket as any harbor fingerprint that is not 64 lowercase hex chars', async () => {
    const res = await fetchWith('/v1/quotas/%ZZ', { headers: OPERATOR_AUTH });
    const body = await assertNo500(res, 400);
    expect(body).toContain('BAD_REQUEST');
  });

  it('GET /v1/harbors/%ZZ/dock — 404, the router\'s own generic notFound() for any unrecognized shape under /v1/harbors/', async () => {
    // No credential needed: an empty decoded segment fails every `ns && name`
    // truthy branch in the dispatcher itself, so it never reaches a handler.
    const res = await fetchWith('/v1/harbors/%ZZ/dock');
    const body = await assertNo500(res, 404);
    expect(body).toContain('NOT_FOUND');

    // Same generic 404 a syntactically-valid but otherwise-unrecognized
    // sub-route shape already gets — confirms this isn't a NEW answer.
    // (requestId is per-request, so compare everything else byte-for-byte.)
    const unrecognized = await fetchWith('/v1/harbors/alice/dock/not-a-real-sub-resource/x/y');
    expect(unrecognized.status).toBe(404);
    const strip = (s: string) => s.replace(/"requestId":"[^"]*"/, '"requestId":"X"');
    expect(strip(await unrecognized.text())).toBe(strip(body));
  });

  it('PUT /v1/config/issuers/%ZZ — 404, same as any registered-issuer lookup miss', async () => {
    const res = await fetchWith('/v1/config/issuers/%ZZ', {
      method: 'PUT',
      headers: { ...OPERATOR_AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: true }),
    });
    const body = await assertNo500(res, 404);
    expect(body).toContain('NOT_FOUND');
  });

  it('DELETE /v1/cache/jwks/%ZZ — 200 ok:true, the route never distinguishes any issuer id (unconditional cache-bust)', async () => {
    const res = await fetchWith('/v1/cache/jwks/%ZZ', { method: 'DELETE', headers: OPERATOR_AUTH });
    await assertNo500(res, 200);
  });
});
