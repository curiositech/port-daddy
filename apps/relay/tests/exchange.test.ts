/**
 * Tests for handleExchange — OIDC → harbor card (ADR-0049, S8 attenuation).
 *
 * handleExchange takes a GitHub-Actions OIDC token and mints a relay-signed
 * harbor card. The security keystone is S8: the requested capabilities are
 * ATTENUATED server-side before the card is signed —
 *   - 'admin' (and any non pub/sub op) is forbidden,
 *   - rate_per_min and max_payload_bytes are clamped to relay ceilings,
 *   - every channel must live within the harbor derived from the OIDC claim
 *     (SHA256 of repository_owner). A channel outside that harbor is rejected.
 *
 * To exercise S8 the OIDC token must first verify. We do that for real, but
 * locally: an Ed25519 key signs the token, and its JWK is pre-seeded into the
 * KV "fresh cache" so fetchJwks returns it WITHOUT any network. No real network
 * is performed.
 *
 * Pre-verify gates (missing fields, malformed JWT, unknown/disabled issuer) are
 * also pinned; those fire before OIDC signature verification.
 */

import { describe, it, expect } from 'vitest';
import { handleExchange } from '../src/handlers.js';
import {
  fromHex,
  toHex,
  base64UrlDecode,
  signEd25519,
  pubKeyFromPrivKey,
} from '../src/crypto.js';
import type { Env, CapabilityEntry, HarborCardPayload } from '../src/types.js';

// Wire noble sync hash test-locally (idempotent with crypto.ts).
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

const ISSUER = 'https://token.actions.githubusercontent.com';
const AUDIENCE = 'https://github.com/testorg';
const REPO_OWNER = 'testorg';
// harbor fingerprint the relay derives from repository_owner
const HARBOR_FP = toHex(sha256(new TextEncoder().encode(REPO_OWNER)));

const RELAY_PRIV = '00'.repeat(32);
// The OIDC signing key (GitHub's key, in the test). Ed25519 so we can sign
// without WebCrypto Ed25519 support.
const OIDC_PRIV = '44'.repeat(32);
const OIDC_PUB = pubKeyFromPrivKey(OIDC_PRIV);
const OIDC_KID = 'oidc-test-kid';

// ── b64url helpers ────────────────────────────────────────────────────────────
function b64urlStr(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url');
}
function b64urlBytes(b: Uint8Array): string {
  return Buffer.from(b).toString('base64url');
}

// ── Mint a real EdDSA-signed OIDC token ───────────────────────────────────────
async function mintOidcToken(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    exp: now + 3600,
    iat: now,
    nbf: now - 10,
    jti: 'oidc-jti-' + Math.random().toString(36).slice(2),
    sub: `repo:${REPO_OWNER}/repo:ref:refs/heads/main`,
    repository: `${REPO_OWNER}/repo`,
    repository_owner: REPO_OWNER,
    repository_owner_id: '99',
    workflow: 'CI',
    ref: 'refs/heads/main',
    sha: 'deadbeef',
    run_id: '1', run_number: '1',
    job_workflow_ref: `${REPO_OWNER}/repo/.github/workflows/ci.yml@refs/heads/main`,
    actor: REPO_OWNER, event_name: 'push', runner_environment: 'github-hosted',
    ...overrides,
  };
  const headerB64 = b64urlStr(JSON.stringify({ alg: 'EdDSA', kid: OIDC_KID }));
  const payloadB64 = b64urlStr(JSON.stringify(claims));
  // verifyJwtSignature (EdDSA path) verifies the raw signing-input bytes, NOT a
  // hash — so we sign the UTF-8 bytes of `${headerB64}.${payloadB64}` directly.
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await ed.signAsync(new TextEncoder().encode(signingInput), fromHex(OIDC_PRIV));
  const sigB64 = b64urlBytes(sig);
  return `${signingInput}.${sigB64}`;
}

/** An unsigned JWT (for tests that fail before signature verification). */
function unsignedJwt(claims: Record<string, unknown>): string {
  return `${b64urlStr(JSON.stringify({ alg: 'EdDSA', kid: OIDC_KID }))}.${b64urlStr(JSON.stringify(claims))}.bad`;
}

// ── KV mock: serves a FRESH cached JWKS so fetchJwks never hits the network ───
function makeKv(opts: { freshJwks?: boolean } = {}): KVNamespace {
  const fresh = opts.freshJwks !== false;
  const now = Math.floor(Date.now() / 1000);
  const jwks = JSON.stringify({
    keys: [{ kty: 'OKP', crv: 'Ed25519', kid: OIDC_KID, alg: 'EdDSA', x: b64urlBytes(fromHex(OIDC_PUB)) }],
  });
  const store: Record<string, string> = {};
  if (fresh) {
    store['jwks:' + ISSUER] = jwks;
    store['jwks-fetched:' + ISSUER] = String(now); // recent → cache is fresh, no fetch
  }
  return {
    get: async (k: string) => store[k] ?? null,
    put: async () => undefined,
    delete: async () => undefined,
  } as unknown as KVNamespace;
}

// ── D1 mock: issuers + oidc_exchanges insert + identity upsert + audit ────────
function makeMockD1(opts: { issuer: Record<string, unknown> | null; jtiReused?: boolean }): {
  db: D1Database;
  exchangesInserted: string[];
} {
  const exchangesInserted: string[] = [];
  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) { bound = vals; return stmt; },
      async first<T>(): Promise<T | null> {
        if (query.includes('FROM issuers')) return opts.issuer as T | null;
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> { return { results: [] as unknown as T[] }; },
      async run() {
        if (query.includes('INTO oidc_exchanges')) {
          if (opts.jtiReused) {
            throw new Error('D1_ERROR: UNIQUE constraint failed: oidc_exchanges.oidc_jti');
          }
          exchangesInserted.push(String(bound[0]));
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
  return { db, exchangesInserted };
}

const ENABLED_ISSUER = {
  issuer_id: ISSUER,
  jwks_uri: `${ISSUER}/.well-known/jwks`,
  audience: AUDIENCE,
  disabled: 0,
};

function makeEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    HARBOR_CHANNEL: {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => new Response('{}') }),
    } as unknown as DurableObjectNamespace,
    KV: kv,
    RELAY_OPERATOR_TOKEN: 'tok',
    RELAY_ED25519_PRIVATE_KEY_HEX: RELAY_PRIV,
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '600',
    JWKS_FAIL_SOFT_SECONDS: '3600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

function exchangeReq(body: unknown): Request {
  return new Request('https://relay.example.com/v1/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const DAEMON_PUB = '55'.repeat(32);

/** Decode a minted card's payload (no verify) for assertions. */
function decodeCardPayload(card: string): HarborCardPayload {
  const payloadB64 = card.split('.')[1]!;
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as HarborCardPayload;
}

describe('handleExchange — pre-verification gates', () => {
  it('400 MISSING_FIELDS when oidc_token/pub_key/cap absent', async () => {
    const { db } = makeMockD1({ issuer: ENABLED_ISSUER });
    const res = await handleExchange(exchangeReq({ pub_key: DAEMON_PUB }), makeEnv(db, makeKv()));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MISSING_FIELDS');
  });

  it('400 MALFORMED_JWT when the OIDC token is not a 3-part JWT', async () => {
    const { db } = makeMockD1({ issuer: ENABLED_ISSUER });
    const res = await handleExchange(
      exchangeReq({ oidc_token: 'a.b', pub_key: DAEMON_PUB, cap: [] }),
      makeEnv(db, makeKv()),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MALFORMED_JWT');
  });

  it('401 UNKNOWN_ISSUER when the issuer is not registered', async () => {
    const { db } = makeMockD1({ issuer: null });
    const token = unsignedJwt({ iss: 'https://nope.example' });
    const res = await handleExchange(
      exchangeReq({ oidc_token: token, pub_key: DAEMON_PUB, cap: [] }),
      makeEnv(db, makeKv()),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNKNOWN_ISSUER');
  });

  it('401 ISSUER_DISABLED when the issuer has been disabled', async () => {
    const { db } = makeMockD1({ issuer: { ...ENABLED_ISSUER, disabled: 1 } });
    const token = unsignedJwt({ iss: ISSUER });
    const res = await handleExchange(
      exchangeReq({ oidc_token: token, pub_key: DAEMON_PUB, cap: [] }),
      makeEnv(db, makeKv()),
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('ISSUER_DISABLED');
  });
});

describe('handleExchange — S8 capability attenuation', () => {
  it('happy path: mints a relay-signed card scoped to the OIDC-derived harbor', async () => {
    const { db, exchangesInserted } = makeMockD1({ issuer: ENABLED_ISSUER });
    const token = await mintOidcToken();
    const cap: CapabilityEntry[] = [{ op: 'pub', channel: `${HARBOR_FP}:ci:events` }];
    const res = await handleExchange(
      exchangeReq({ oidc_token: token, pub_key: DAEMON_PUB, cap }),
      makeEnv(db, makeKv()),
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { card: string; exp: number };
    const payload = decodeCardPayload(json.card);

    // The card is bound to the harbor the relay derived from the OIDC claim,
    // not anything the caller asserted.
    expect(payload.iss).toBe(HARBOR_FP);
    expect(payload.aud).toBe(HARBOR_FP);
    expect(payload.hv).toBe(2);
    // JTI one-time-use gate fired (the exchange was recorded).
    expect(exchangesInserted.length).toBe(1);
  });

  it('rejects an admin capability (FORBIDDEN_OP) — admin is never grantable via OIDC', async () => {
    const { db } = makeMockD1({ issuer: ENABLED_ISSUER });
    const token = await mintOidcToken();
    const cap = [{ op: 'admin', channel: `${HARBOR_FP}:*` }] as unknown as CapabilityEntry[];
    const res = await handleExchange(
      exchangeReq({ oidc_token: token, pub_key: DAEMON_PUB, cap }),
      makeEnv(db, makeKv()),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('FORBIDDEN_OP');
  });

  it('rejects a channel outside the OIDC-derived harbor (HARBOR_MISMATCH)', async () => {
    const { db } = makeMockD1({ issuer: ENABLED_ISSUER });
    const token = await mintOidcToken();
    const foreignHarbor = 'f'.repeat(64);
    const cap: CapabilityEntry[] = [{ op: 'pub', channel: `${foreignHarbor}:steal` }];
    const res = await handleExchange(
      exchangeReq({ oidc_token: token, pub_key: DAEMON_PUB, cap }),
      makeEnv(db, makeKv()),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('HARBOR_MISMATCH');
  });

  it('clamps rate_per_min and max_payload_bytes to the relay ceilings', async () => {
    const { db } = makeMockD1({ issuer: ENABLED_ISSUER });
    const token = await mintOidcToken();
    // Request absurdly high limits; relay must clamp to MAX_OIDC_* (120 / 65536).
    const cap: CapabilityEntry[] = [
      { op: 'pub', channel: `${HARBOR_FP}:ci`, rate_per_min: 100_000, max_payload_bytes: 10_000_000 },
    ];
    const res = await handleExchange(
      exchangeReq({ oidc_token: token, pub_key: DAEMON_PUB, cap }),
      makeEnv(db, makeKv()),
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { card: string };
    const payload = decodeCardPayload(json.card);
    expect(payload.cap[0]!.rate_per_min).toBe(120);
    expect(payload.cap[0]!.max_payload_bytes).toBe(65536);
  });

  it('preserves caller limits that are already below the ceiling', async () => {
    const { db } = makeMockD1({ issuer: ENABLED_ISSUER });
    const token = await mintOidcToken();
    const cap: CapabilityEntry[] = [
      { op: 'sub', channel: `${HARBOR_FP}:ci`, rate_per_min: 30, max_payload_bytes: 1024 },
    ];
    const res = await handleExchange(
      exchangeReq({ oidc_token: token, pub_key: DAEMON_PUB, cap }),
      makeEnv(db, makeKv()),
    );
    const json = await res.json() as { card: string };
    const payload = decodeCardPayload(json.card);
    expect(payload.cap[0]!.rate_per_min).toBe(30);
    expect(payload.cap[0]!.max_payload_bytes).toBe(1024);
  });

  it('rejects a replayed OIDC token (JTI_REUSED) when the exchange row already exists', async () => {
    const { db } = makeMockD1({ issuer: ENABLED_ISSUER, jtiReused: true });
    const token = await mintOidcToken();
    const cap: CapabilityEntry[] = [{ op: 'pub', channel: `${HARBOR_FP}:ci` }];
    const res = await handleExchange(
      exchangeReq({ oidc_token: token, pub_key: DAEMON_PUB, cap }),
      makeEnv(db, makeKv()),
    );
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('JTI_REUSED');
  });
});
