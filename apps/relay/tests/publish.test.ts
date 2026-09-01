/**
 * Tests for handlePublish — the multi-tenant publish gate (ADR-0049 S6).
 *
 * This path had ZERO coverage. handlePublish is the security keystone of the
 * relay: it decides whether a card may publish an event into a channel, and it
 * is where cross-tenant isolation is enforced. These tests pin the gates that
 * fire BEFORE the (crypto-heavy) signature verification — identity lookup,
 * revocation, and harbor (tenant) binding — using a decodable card + D1 mocks.
 * The signature happy-path is exercised by chain/crypto suites; here we lock the
 * authorization gates, especially: a publisher bound to tenant A can never
 * publish into tenant B's namespace (HARBOR_MISMATCH), the runtime complement to
 * apps/relay/formal/proverif/github-ingress/github_ingress_tenant_isolation.pv.
 */

import { describe, it, expect } from 'vitest';
import { handlePublish } from '../src/handlers.js';
import type { Env } from '../src/types.js';

// ── card builder (decodable 3-part EdDSA JWT; signature is a placeholder, since
//    these gates all fire before verifyCard) ──────────────────────────────────
function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function makeCard(
  payload: { sub: string; iss: string; aud: string; jti: string; cap: unknown[] },
  kid: string
): string {
  const header = b64url({ alg: 'EdDSA', kid });
  const body = b64url(payload);
  const sig = Buffer.from('placeholder-sig').toString('base64url');
  return `${header}.${body}.${sig}`;
}

// ── configurable D1 mock: routes by table named in the query ──────────────────
interface MockRows {
  identity: Record<string, unknown> | null; // identities row (or null = unknown)
  member: boolean;                            // harbor_members membership present?
}
function makeMockD1(rows: MockRows): D1Database {
  const stmtFor = (query: string) => {
    const stmt = {
      _q: query,
      bind() { return stmt; },
      async first<T>(): Promise<T | null> {
        if (query.includes('FROM identities')) return rows.identity as T | null;
        if (query.includes('FROM harbor_members')) return (rows.member ? ({ 1: 1 } as unknown as T) : null);
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> { return { results: [] }; },
      async run() { return { success: true }; },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return {
    prepare: stmtFor,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function makeEnv(rows: MockRows): Env {
  return {
    DB: makeMockD1(rows),
    HARBOR_CHANNEL: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response('{}') }) } as unknown as DurableObjectNamespace,
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: 'tok',
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

const DAEMON = 'd'.repeat(64);
const HARBOR_A = 'a'.repeat(64);
const HARBOR_B = 'b'.repeat(64);
// A daemon-issued card kid that is NOT the relay fingerprint (so the membership
// branch — not the iss branch — is taken).
const DAEMON_KID = 'f'.repeat(64);

function publishReq(card: string | null, event: unknown): Request {
  const body: Record<string, unknown> = { event };
  if (card) body.card = card;
  return new Request('https://relay.example.com/v1/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const cardFor = (harbor: string) =>
  makeCard({ sub: DAEMON, iss: harbor, aud: harbor, jti: 'jti-1', cap: [{ op: 'pub', channel: `${harbor}:*` }] }, DAEMON_KID);

describe('handlePublish — authorization gates', () => {
  it('401 MISSING_CARD when no card is supplied', async () => {
    const res = await handlePublish(publishReq(null, { channel: `${HARBOR_A}:github:webhook:push` }), makeEnv({ identity: null, member: false }));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('MISSING_CARD');
  });

  it('400 MISSING_EVENT when no event is supplied', async () => {
    const res = await handlePublish(publishReq(cardFor(HARBOR_A), undefined), makeEnv({ identity: null, member: false }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MISSING_EVENT');
  });

  it('401 UNKNOWN_IDENTITY when the daemon is not registered', async () => {
    const env = makeEnv({ identity: null, member: false });
    const res = await handlePublish(publishReq(cardFor(HARBOR_A), { channel: `${HARBOR_A}:github:webhook:push` }), env);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNKNOWN_IDENTITY');
  });

  it('401 REVOKED when the daemon identity is revoked', async () => {
    const env = makeEnv({ identity: { daemon_fingerprint: DAEMON, pub_key: '11'.repeat(32), revoked: 1 }, member: false });
    const res = await handlePublish(publishReq(cardFor(HARBOR_A), { channel: `${HARBOR_A}:github:webhook:push` }), env);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('REVOKED');
  });

  it('SECURITY: cross-tenant publish is rejected — member of A cannot publish into B (HARBOR_MISMATCH)', async () => {
    // Identity exists and is NOT revoked, but is not a member of harbor B.
    const env = makeEnv({ identity: { daemon_fingerprint: DAEMON, pub_key: '11'.repeat(32), revoked: 0 }, member: false });
    // Card claims harbor B, channel is in harbor B — but D1 membership says no.
    const res = await handlePublish(publishReq(cardFor(HARBOR_B), { channel: `${HARBOR_B}:github:webhook:push`, sender: DAEMON }), env);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('HARBOR_MISMATCH');
  });

  it('a genuine member passes the harbor-binding gate (reaches signature verification, not HARBOR_MISMATCH)', async () => {
    // Member of harbor A: binding must pass, so the request proceeds to issuer/sig
    // checks and fails THERE (placeholder signature), never at harbor binding.
    const env = makeEnv({ identity: { daemon_fingerprint: DAEMON, pub_key: '11'.repeat(32), revoked: 0 }, member: true });
    const res = await handlePublish(publishReq(cardFor(HARBOR_A), { channel: `${HARBOR_A}:github:webhook:push`, sender: DAEMON }), env);
    const body = await res.text();
    expect(body).not.toContain('HARBOR_MISMATCH');   // binding gate let the member through
    expect(res.status).not.toBe(403);
  });
});
