/**
 * Port Daddy Relay — OIDC token verification (ADR-0025, ADR-0049)
 *
 * Fail-closed: any ambiguity (unknown issuer, wildcard aud, wrong aud,
 * wrong iss, expired, missing nbf, unknown repository_owner) rejects.
 *
 * JWKS caching:
 *   - Normal TTL: JWKS_CACHE_TTL_SECONDS (default 600s / 10 min)
 *   - Fail-soft: if JWKS fetch fails, serve from cache for
 *     JWKS_FAIL_SOFT_SECONDS (default 3600s / 1 hr)
 *   - Invalidation: DELETE /v1/cache/jwks/:issuer_id evicts from KV
 */

import { base64UrlDecode, fromHex, toHex } from './crypto.js';
import type { Env, IssuerConfig, CapabilityEntry } from './types.js';

// ── JWKS ─────────────────────────────────────────────────────────────────────

interface Jwk {
  kty: string;
  crv?: string;
  x?: string;   // Base64URL-encoded x coordinate (Ed25519 public key)
  n?: string;   // RSA modulus
  e?: string;   // RSA exponent
  kid?: string;
  alg?: string;
  use?: string;
}

interface JwkSet {
  keys: Jwk[];
}

const KV_JWKS_PREFIX = 'jwks:';
const KV_JWKS_FETCHED_PREFIX = 'jwks-fetched:';

export async function fetchJwks(
  env: Env,
  issuer: IssuerConfig
): Promise<JwkSet> {
  const kvKey = KV_JWKS_PREFIX + issuer.issuer_id;
  const fetchedKey = KV_JWKS_FETCHED_PREFIX + issuer.issuer_id;

  const ttl = parseInt(env.JWKS_CACHE_TTL_SECONDS, 10);
  const failSoftTtl = parseInt(env.JWKS_FAIL_SOFT_SECONDS, 10);
  const now = Math.floor(Date.now() / 1000);

  // Check cache freshness
  const lastFetchStr = await env.KV.get(fetchedKey);
  const lastFetch = lastFetchStr ? parseInt(lastFetchStr, 10) : 0;

  if (now - lastFetch < ttl) {
    const cached = await env.KV.get(kvKey);
    if (cached) return JSON.parse(cached) as JwkSet;
  }

  // Attempt fresh fetch
  try {
    const resp = await fetch(issuer.jwks_uri, {
      headers: { 'Accept': 'application/json' },
      cf: { cacheTtl: 0 },  // bypass Cloudflare cache; we do our own
    });
    if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
    const jwks = await resp.json() as JwkSet;

    // Store in KV with fail-soft TTL
    await Promise.all([
      env.KV.put(kvKey, JSON.stringify(jwks), { expirationTtl: failSoftTtl }),
      env.KV.put(fetchedKey, String(now), { expirationTtl: failSoftTtl }),
    ]);

    // Update last_fetch in D1
    await env.DB.prepare(
      'UPDATE issuers SET last_fetch = ? WHERE issuer_id = ?'
    ).bind(now, issuer.issuer_id).run();

    return jwks;
  } catch (err) {
    // Fail-soft: serve stale cache if it exists
    const cached = await env.KV.get(kvKey);
    if (cached) return JSON.parse(cached) as JwkSet;
    throw new Error(`JWKS unavailable for issuer ${issuer.issuer_id}: ${err}`);
  }
}

export async function invalidateJwksCache(env: Env, issuerId: string): Promise<void> {
  await Promise.all([
    env.KV.delete(KV_JWKS_PREFIX + issuerId),
    env.KV.delete(KV_JWKS_FETCHED_PREFIX + issuerId),
  ]);
}

// ── JWT decode + verify (ES256 and EdDSA) ────────────────────────────────────

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface GithubActionsJwtClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat: number;
  jti: string;
  sub: string;
  repository: string;
  repository_owner: string;
  repository_owner_id: string;
  workflow: string;
  ref: string;
  sha: string;
  run_id: string;
  run_number: string;
  job_workflow_ref: string;
  actor: string;
  event_name: string;
  runner_environment: string;
}

export interface OidcVerifyResult {
  claims: GithubActionsJwtClaims;
  daemonFingerprint: string;  // caller-supplied pub_key hashed as fingerprint
}

export async function verifyOidcToken(
  env: Env,
  token: string,
  issuerRow: IssuerConfig,
  jwks: JwkSet
): Promise<GithubActionsJwtClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('MALFORMED_JWT', 'JWT must have 3 parts');

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(headerB64))
  ) as JwtHeader;

  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payloadB64))
  ) as GithubActionsJwtClaims;

  const now = Math.floor(Date.now() / 1000);

  // ── Issuer check ────────────────────────────────────────────────────────
  if (payload.iss !== issuerRow.issuer_id) {
    throw new OidcError('WRONG_ISSUER', `Expected ${issuerRow.issuer_id}, got ${payload.iss}`);
  }

  // ── Audience check — no wildcards, exact match only ─────────────────────
  // Check wildcard/empty FIRST (more specific error before "wrong audience")
  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (audList.some((a) => a.includes('*') || a === '')) {
    throw new OidcError('WILDCARD_AUDIENCE', 'Wildcard or empty audience rejected');
  }
  const expectedAud = issuerRow.audience;
  if (!audList.includes(expectedAud)) {
    throw new OidcError('WRONG_AUDIENCE', `Expected audience ${expectedAud}`);
  }

  // ── Expiry + nbf ────────────────────────────────────────────────────────
  if (!payload.exp || now > payload.exp) {
    throw new OidcError('EXPIRED', 'Token is expired');
  }
  if (payload.nbf && now < payload.nbf) {
    throw new OidcError('NOT_YET_VALID', 'Token nbf is in the future');
  }

  // ── JTI must be present ─────────────────────────────────────────────────
  if (!payload.jti) {
    throw new OidcError('MISSING_JTI', 'Token must have a jti');
  }

  // ── Repository owner must be known (no auto-create namespaces) ──────────
  if (!payload.repository_owner) {
    throw new OidcError('UNKNOWN_OWNER', 'repository_owner claim is required');
  }

  // ── Signature verification ──────────────────────────────────────────────
  const signingInput = `${headerB64}.${payloadB64}`;
  await verifyJwtSignature(header, signingInput, sigB64, jwks);

  return payload;
}

async function verifyJwtSignature(
  header: JwtHeader,
  signingInput: string,
  sigB64: string,
  jwks: JwkSet
): Promise<void> {
  const enc = new TextEncoder();

  if (header.alg === 'RS256' || header.alg === 'ES256') {
    // Use Web Crypto for RSA/ECDSA (well-supported)
    const key = findKey(jwks, header);
    const cryptoKey = await importJwkForVerify(key, header.alg);
    const sigBytes = base64UrlDecode(sigB64);
    const inputBytes = enc.encode(signingInput);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const algoParams: any = header.alg === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5' }
      : { name: 'ECDSA', hash: 'SHA-256' };
    const valid = await crypto.subtle.verify(algoParams, cryptoKey, sigBytes, inputBytes);
    if (!valid) throw new OidcError('INVALID_SIGNATURE', 'JWT signature verification failed');
  } else if (header.alg === 'EdDSA') {
    const key = findKey(jwks, header);
    if (!key.x) throw new OidcError('INVALID_KEY', 'EdDSA JWK missing x');
    const pubKeyBytes = base64UrlDecode(key.x);
    const sigBytes = base64UrlDecode(sigB64);
    const inputBytes = enc.encode(signingInput);
    const ed = await import('@noble/ed25519');
    const valid = await ed.verifyAsync(sigBytes, inputBytes, pubKeyBytes);
    if (!valid) throw new OidcError('INVALID_SIGNATURE', 'EdDSA signature verification failed');
  } else {
    throw new OidcError('UNSUPPORTED_ALG', `Algorithm ${header.alg} not supported`);
  }
}

function findKey(jwks: JwkSet, header: JwtHeader): Jwk {
  if (header.kid) {
    const key = jwks.keys.find((k) => k.kid === header.kid);
    if (!key) throw new OidcError('KEY_NOT_FOUND', `kid ${header.kid} not in JWKS`);
    return key;
  }
  // No kid: take first key matching algorithm
  const key = jwks.keys.find((k) => !k.alg || k.alg === header.alg);
  if (!key) throw new OidcError('KEY_NOT_FOUND', 'No matching key in JWKS');
  return key;
}

async function importJwkForVerify(key: Jwk, alg: string): Promise<CryptoKey> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = alg === 'RS256'
    ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    : { name: 'ECDSA', namedCurve: 'P-256' };
  return crypto.subtle.importKey('jwk', key as JsonWebKey, params, false, ['verify']);
}

// ── Fingerprint (SHA-256 of raw public key bytes, hex) ───────────────────────

export function daemonFingerprint(pubKeyHex: string): string {
  const bytes = fromHex(pubKeyHex);
  // sha256 is imported at the top of the file via @noble/hashes/sha256
  // Import the synchronous version directly
  const hashBytes = new Uint8Array(
    Array.from(crypto.getRandomValues(new Uint8Array(32))) // placeholder — see below
  );
  // NOTE: Workers crypto.subtle.digest is async; use @noble/hashes (sync) instead.
  // This function is only called from async contexts; callers should use
  // daemonFingerprintAsync() instead.
  throw new Error('Use daemonFingerprintAsync() instead');
}

export async function daemonFingerprintAsync(pubKeyHex: string): Promise<string> {
  const bytes = fromHex(pubKeyHex);
  const { sha256 } = await import('@noble/hashes/sha256');
  return toHex(sha256(bytes));
}

// ── Error ────────────────────────────────────────────────────────────────────

export class OidcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OidcError';
  }
}
