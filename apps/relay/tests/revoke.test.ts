/**
 * Tests for handleRevoke + handleRevokeByIssuer (ADR-0049, S1/S4).
 *
 * These paths had ZERO coverage. They cover two security-meaningful surfaces:
 *
 *  1. handleRevoke: a daemon self-revokes a JTI by signing "revoke:<jti>" with
 *     its own key. We pin the pre-signature gates (missing fields, missing card,
 *     malformed card, unknown identity) and the bad-signature rejection, plus a
 *     real Ed25519-signed happy path that reaches insertRevocation.
 *
 *  2. handleRevokeByIssuer: OPERATOR-ONLY bulk revocation. We pin the
 *     timing-safe operator-token gate (S1 — wrong/missing token rejected) and,
 *     most importantly, the TIER-2 BULK-REVOKE PAGINATION fix: revokeByIssuer
 *     (db.ts) pages identities in batches of REVOKE_PAGE_SIZE (1000) via
 *     LIMIT/OFFSET. A naive single-page implementation would silently cap at
 *     1000 identities. The pagination test seeds >1 page worth of matching
 *     identities and asserts the handler revokes identities from BOTH pages —
 *     i.e. it does not silently cap.
 */

import { describe, it, expect } from 'vitest';
import { handleRevoke, handleRevokeByIssuer } from '../src/handlers.js';
import { signEd25519, pubKeyFromPrivKey, hashHex } from '../src/crypto.js';
import type { Env } from '../src/types.js';

// Wire the noble sync hash test-locally (idempotent with crypto.ts; harmless if
// already set). Keeps these tests robust regardless of crypto.ts module init.
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

// ── card builder (decodable 3-part JWT; handleRevoke only decodes sub) ─────────
function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function makeCard(payload: Record<string, unknown>, kid = 'kid-x'): string {
  const header = b64url({ alg: 'EdDSA', kid });
  const body = b64url(payload);
  const sig = Buffer.from('placeholder-sig').toString('base64url');
  return `${header}.${body}.${sig}`;
}

const DAEMON = 'd'.repeat(64);

function baseEnv(db: D1Database, operatorToken = 'super-secret-operator-token'): Env {
  return {
    DB: db,
    HARBOR_CHANNEL: {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => new Response('{}') }),
    } as unknown as DurableObjectNamespace,
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: operatorToken,
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

// ── D1 mock for handleRevoke: identities lookup + writes are no-ops ───────────
function revokeD1(identity: Record<string, unknown> | null): {
  db: D1Database;
  revocations: Array<{ jti: string; daemon: string; reason: string | null }>;
} {
  const revocations: Array<{ jti: string; daemon: string; reason: string | null }> = [];
  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) { bound = vals; return stmt; },
      async first<T>(): Promise<T | null> {
        if (query.includes('FROM identities')) return identity as T | null;
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        // harbor_members fan-out lookup: no memberships
        return { results: [] as unknown as T[] };
      },
      async run() {
        if (query.includes('INTO revocations')) {
          revocations.push({ jti: String(bound[0]), daemon: String(bound[1]), reason: (bound[2] as string) ?? null });
        }
        return { success: true };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  const db = {
    prepare: stmtFor,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
  return { db, revocations };
}

function revokeRequest(card: string | null, body: Record<string, unknown>): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (card) headers['Authorization'] = `Bearer ${card}`;
  return new Request('https://relay.example.com/v1/revoke', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('handleRevoke — daemon self-revocation gates', () => {
  it('400 MISSING_FIELDS when jti or sig is absent', async () => {
    const { db } = revokeD1(null);
    const res = await handleRevoke(revokeRequest(makeCard({ sub: DAEMON }), { jti: 'j1' }), baseEnv(db));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MISSING_FIELDS');
  });

  it('401 MISSING_CARD when no Authorization bearer card is supplied', async () => {
    const { db } = revokeD1(null);
    const res = await handleRevoke(revokeRequest(null, { jti: 'j1', sig: 'ab' }), baseEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('MISSING_CARD');
  });

  it('400 MALFORMED_CARD when the card cannot be decoded', async () => {
    const { db } = revokeD1(null);
    const res = await handleRevoke(revokeRequest('not-a-jwt', { jti: 'j1', sig: 'ab' }), baseEnv(db));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MALFORMED_CARD');
  });

  it('401 UNKNOWN_IDENTITY when the revoking daemon is not registered', async () => {
    const { db } = revokeD1(null);
    const res = await handleRevoke(revokeRequest(makeCard({ sub: DAEMON }), { jti: 'j1', sig: 'ab' }), baseEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNKNOWN_IDENTITY');
  });

  it('401 BAD_SIG when the revocation signature does not verify under the daemon key', async () => {
    // Real key, but sign the WRONG message so verification fails deterministically.
    const priv = '11'.repeat(32);
    const pub = pubKeyFromPrivKey(priv);
    const { db } = revokeD1({ daemon_fingerprint: DAEMON, pub_key: pub, revoked: 0 });
    const wrongSig = await signEd25519(priv, hashHex('revoke:DIFFERENT-jti'));
    const res = await handleRevoke(revokeRequest(makeCard({ sub: DAEMON }), { jti: 'j1', sig: wrongSig }), baseEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('BAD_SIG');
  });

  it('200 + records the revocation on a valid daemon-signed request', async () => {
    const priv = '22'.repeat(32);
    const pub = pubKeyFromPrivKey(priv);
    const { db, revocations } = revokeD1({ daemon_fingerprint: DAEMON, pub_key: pub, revoked: 0 });
    const jti = 'jti-to-revoke';
    const sig = await signEd25519(priv, hashHex('revoke:' + jti));
    const res = await handleRevoke(
      revokeRequest(makeCard({ sub: DAEMON }), { jti, sig, reason: 'compromised' }),
      baseEnv(db),
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; jti: string };
    expect(json.ok).toBe(true);
    expect(json.jti).toBe(jti);
    // insertRevocation was actually called with the daemon as the revoking party.
    expect(revocations).toEqual([{ jti, daemon: DAEMON, reason: 'compromised' }]);
  });
});

// ── handleRevokeByIssuer ──────────────────────────────────────────────────────

const REVOKE_PAGE_SIZE = 1000; // mirrors db.ts

/**
 * D1 mock for the bulk-revoke path. Two query shapes matter:
 *  - SELECT ... FROM identities WHERE proof_method='oidc' LIMIT ? OFFSET ?
 *      → returns paginated identity rows (drives the pagination loop in db.ts)
 *  - SELECT DISTINCT harbor_fingerprint FROM harbor_members
 *      → returns harbors for DO broadcast (we return none to keep it inert)
 *  - INSERT OR IGNORE INTO revocations ...
 *      → records each revoked jti
 */
function bulkRevokeD1(allIdentities: Array<{ daemon_fingerprint: string; proof_metadata: string }>): {
  db: D1Database;
  revoked: string[];
  pagesRequested: Array<{ limit: number; offset: number }>;
} {
  const revoked: string[] = [];
  const pagesRequested: Array<{ limit: number; offset: number }> = [];

  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) { bound = vals; return stmt; },
      async first<T>(): Promise<T | null> { return null as T | null; },
      async all<T>(): Promise<{ results: T[] }> {
        if (query.includes('FROM identities')) {
          // bound = [LIMIT, OFFSET]
          const limit = Number(bound[0]);
          const offset = Number(bound[1]);
          pagesRequested.push({ limit, offset });
          const page = allIdentities.slice(offset, offset + limit);
          return { results: page as unknown as T[] };
        }
        if (query.includes('FROM harbor_members')) {
          return { results: [] as unknown as T[] };
        }
        return { results: [] as unknown as T[] };
      },
      async run() {
        if (query.includes('INTO revocations')) {
          revoked.push(String(bound[0]));
        }
        return { success: true };
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };

  const db = {
    prepare: stmtFor,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;

  return { db, revoked, pagesRequested };
}

function bulkRequest(token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request('https://relay.example.com/v1/revoke-by-issuer', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const OPERATOR = 'super-secret-operator-token';

describe('handleRevokeByIssuer — operator gate', () => {
  it('401 UNAUTHORIZED when the operator token is missing', async () => {
    const { db } = bulkRevokeD1([]);
    const res = await handleRevokeByIssuer(bulkRequest(null, { issuer: 'i', iat_min: 1, iat_max: 2 }), baseEnv(db, OPERATOR));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNAUTHORIZED');
  });

  it('401 UNAUTHORIZED when the operator token is wrong (timing-safe compare)', async () => {
    const { db } = bulkRevokeD1([]);
    const res = await handleRevokeByIssuer(bulkRequest('wrong-token', { issuer: 'i', iat_min: 1, iat_max: 2 }), baseEnv(db, OPERATOR));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNAUTHORIZED');
  });

  it('400 MISSING_FIELDS when issuer/iat_min/iat_max absent (after auth passes)', async () => {
    const { db } = bulkRevokeD1([]);
    const res = await handleRevokeByIssuer(bulkRequest(OPERATOR, { issuer: 'i' }), baseEnv(db, OPERATOR));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MISSING_FIELDS');
  });

  // Real-behavior quirk worth pinning: the handler validates with
  //   if (!body.issuer || !body.iat_min || !body.iat_max)
  // so iat_min:0 or iat_max:0 are treated as MISSING (0 is falsy). Epoch 0 is
  // unrealistic for these fields, but this locks the edge so a future refactor
  // doesn't silently change it. (Finding noted to operator.)
  it('400 MISSING_FIELDS when iat_min is 0 (falsy-validation edge)', async () => {
    const { db } = bulkRevokeD1([]);
    const res = await handleRevokeByIssuer(
      bulkRequest(OPERATOR, { issuer: 'i', iat_min: 0, iat_max: 100 }),
      baseEnv(db, OPERATOR),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MISSING_FIELDS');
  });
});

describe('handleRevokeByIssuer — TIER-2 bulk-revoke pagination (no silent cap)', () => {
  // Build > one page worth of matching OIDC identities so the loop MUST advance
  // past offset 0. A naive single-query implementation would miss every identity
  // beyond REVOKE_PAGE_SIZE.
  const ISSUER = 'https://token.actions.githubusercontent.com';
  const TOTAL = REVOKE_PAGE_SIZE + 250; // 1250 → 2 pages (1000 + 250)

  function makeIdentities(total: number) {
    return Array.from({ length: total }, (_, i) => ({
      daemon_fingerprint: `df-${i}`,
      proof_metadata: JSON.stringify({ issuer: ISSUER, jti: `jti-${i}`, iat: 1_000 }),
    }));
  }

  it('revokes identities from BOTH pages (does not cap at one page)', async () => {
    const { db, revoked, pagesRequested } = bulkRevokeD1(makeIdentities(TOTAL));
    const res = await handleRevokeByIssuer(
      bulkRequest(OPERATOR, { issuer: ISSUER, iat_min: 1, iat_max: 2_000 }),
      baseEnv(db, OPERATOR),
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; revoked_count: number; revoked_jtis: string[] };

    // All 1250 matching identities were revoked — nothing silently capped at 1000.
    expect(json.revoked_count).toBe(TOTAL);
    expect(json.revoked_jtis.length).toBe(TOTAL);

    // The loop requested at least two pages (offset 0 AND offset 1000).
    expect(pagesRequested.some(p => p.offset === 0)).toBe(true);
    expect(pagesRequested.some(p => p.offset === REVOKE_PAGE_SIZE)).toBe(true);

    // A jti from beyond the first page (e.g. #1100) is present — the cap bug
    // would have dropped it.
    expect(json.revoked_jtis).toContain('jti-1100');
    expect(revoked).toContain('jti-1100');
  });

  it('only revokes identities whose iat falls inside [iat_min, iat_max]', async () => {
    // Mix in-window and out-of-window identities across the page boundary.
    const ids = [
      ...Array.from({ length: REVOKE_PAGE_SIZE }, (_, i) => ({
        daemon_fingerprint: `in-${i}`,
        proof_metadata: JSON.stringify({ issuer: ISSUER, jti: `in-${i}`, iat: 500 }),
      })),
      ...Array.from({ length: 100 }, (_, i) => ({
        daemon_fingerprint: `out-${i}`,
        proof_metadata: JSON.stringify({ issuer: ISSUER, jti: `out-${i}`, iat: 9_999 }),
      })),
    ];
    const { db } = bulkRevokeD1(ids);
    const res = await handleRevokeByIssuer(
      bulkRequest(OPERATOR, { issuer: ISSUER, iat_min: 1, iat_max: 1_000 }),
      baseEnv(db, OPERATOR),
    );
    const json = await res.json() as { revoked_count: number; revoked_jtis: string[] };
    // Only the 1000 in-window identities are revoked; the 100 out-of-window are not.
    expect(json.revoked_count).toBe(REVOKE_PAGE_SIZE);
    expect(json.revoked_jtis.every(j => j.startsWith('in-'))).toBe(true);
  });

  it('ignores identities from a different issuer', async () => {
    const ids = [
      { daemon_fingerprint: 'a', proof_metadata: JSON.stringify({ issuer: ISSUER, jti: 'keep', iat: 100 }) },
      { daemon_fingerprint: 'b', proof_metadata: JSON.stringify({ issuer: 'https://evil.example', jti: 'drop', iat: 100 }) },
    ];
    const { db } = bulkRevokeD1(ids);
    const res = await handleRevokeByIssuer(
      bulkRequest(OPERATOR, { issuer: ISSUER, iat_min: 1, iat_max: 1_000 }),
      baseEnv(db, OPERATOR),
    );
    const json = await res.json() as { revoked_jtis: string[] };
    expect(json.revoked_jtis).toEqual(['keep']);
  });
});
