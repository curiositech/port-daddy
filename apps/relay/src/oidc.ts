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
  issuer: IssuerConfig,
  options: { forceRefresh?: boolean } = {},
): Promise<JwkSet> {
  const kvKey = KV_JWKS_PREFIX + issuer.issuer_id;
  const fetchedKey = KV_JWKS_FETCHED_PREFIX + issuer.issuer_id;

  const ttl = parseInt(env.JWKS_CACHE_TTL_SECONDS, 10);
  const failSoftTtl = parseInt(env.JWKS_FAIL_SOFT_SECONDS, 10);
  const now = Math.floor(Date.now() / 1000);

  // Check cache freshness
  const lastFetchStr = await env.KV.get(fetchedKey);
  const lastFetch = lastFetchStr ? parseInt(lastFetchStr, 10) : 0;

  if (!options.forceRefresh && now - lastFetch < ttl) {
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
  environment?: string;
}

interface GithubActionsTrustPolicy {
  repositoryOwnerIds: string[];
  repositories: string[];
  jobWorkflowRefs: string[];
  refs: string[];
  environments: Array<string | null>;
  runnerEnvironments: string[];
  eventNames?: string[];
}

const MAX_POLICY_ENTRIES = 64;
const MAX_POLICY_VALUE_LENGTH = 512;

function exactPolicyValues(
  value: unknown,
  field: string,
  options: { allowNull?: boolean; numeric?: boolean } = {},
): Array<string | null> {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_POLICY_ENTRIES) {
    throw new OidcError('OIDC_POLICY_INVALID', `${field} must contain 1-${MAX_POLICY_ENTRIES} entries`);
  }
  const result: Array<string | null> = [];
  for (const entry of value) {
    if (entry === null && options.allowNull) {
      result.push(null);
      continue;
    }
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > MAX_POLICY_VALUE_LENGTH) {
      throw new OidcError('OIDC_POLICY_INVALID', `${field} contains an invalid value`);
    }
    if (entry.includes('*')) {
      throw new OidcError('OIDC_POLICY_INVALID', `${field} does not permit wildcards`);
    }
    if (options.numeric && !/^[1-9][0-9]*$/.test(entry)) {
      throw new OidcError('OIDC_POLICY_INVALID', `${field} must contain numeric GitHub ids`);
    }
    result.push(entry);
  }
  return [...new Set(result)];
}

function githubActionsTrustPolicy(env: Env): GithubActionsTrustPolicy {
  const raw = (env as Env & { OIDC_GITHUB_TRUST_POLICY_JSON?: string })
    .OIDC_GITHUB_TRUST_POLICY_JSON;
  if (!raw) {
    throw new OidcError(
      'OIDC_POLICY_UNCONFIGURED',
      'GitHub Actions OIDC trust policy is not configured',
    );
  }

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    parsed = value as Record<string, unknown>;
  } catch {
    throw new OidcError('OIDC_POLICY_INVALID', 'GitHub Actions OIDC trust policy is not valid JSON');
  }

  const allowedKeys = new Set([
    'repositoryOwnerIds', 'repositories', 'jobWorkflowRefs', 'refs',
    'environments', 'runnerEnvironments', 'eventNames',
  ]);
  if (Object.keys(parsed).some((key) => !allowedKeys.has(key))) {
    throw new OidcError('OIDC_POLICY_INVALID', 'GitHub Actions OIDC trust policy has unknown fields');
  }

  return {
    repositoryOwnerIds: exactPolicyValues(parsed.repositoryOwnerIds, 'repositoryOwnerIds', { numeric: true }) as string[],
    repositories: exactPolicyValues(parsed.repositories, 'repositories') as string[],
    jobWorkflowRefs: exactPolicyValues(parsed.jobWorkflowRefs, 'jobWorkflowRefs') as string[],
    refs: exactPolicyValues(parsed.refs, 'refs') as string[],
    environments: exactPolicyValues(parsed.environments, 'environments', { allowNull: true }),
    runnerEnvironments: exactPolicyValues(parsed.runnerEnvironments, 'runnerEnvironments') as string[],
    ...(parsed.eventNames === undefined
      ? {}
      : { eventNames: exactPolicyValues(parsed.eventNames, 'eventNames') as string[] }),
  };
}

function assertGithubActionsClaims(env: Env, claims: GithubActionsJwtClaims): void {
  const policy = githubActionsTrustPolicy(env);
  if (!/^[1-9][0-9]*$/.test(claims.repository_owner_id ?? '')) {
    throw new OidcError('INVALID_OWNER_ID', 'repository_owner_id must be a numeric GitHub id');
  }
  if (!policy.repositoryOwnerIds.includes(claims.repository_owner_id)) {
    throw new OidcError('UNTRUSTED_OWNER_ID', 'repository_owner_id is not trusted');
  }
  if (!policy.repositories.includes(claims.repository)) {
    throw new OidcError('UNTRUSTED_REPOSITORY', 'repository is not trusted');
  }

  const [repositoryOwner] = claims.repository.split('/');
  if (!repositoryOwner || repositoryOwner !== claims.repository_owner) {
    throw new OidcError('REPOSITORY_OWNER_MISMATCH', 'repository and repository_owner claims disagree');
  }
  if (!policy.jobWorkflowRefs.includes(claims.job_workflow_ref)) {
    throw new OidcError('UNTRUSTED_WORKFLOW', 'job_workflow_ref is not trusted');
  }
  if (!claims.job_workflow_ref.startsWith(`${claims.repository}/.github/workflows/`)) {
    throw new OidcError('WORKFLOW_REPOSITORY_MISMATCH', 'job_workflow_ref belongs to another repository');
  }
  if (!policy.refs.includes(claims.ref)) {
    throw new OidcError('UNTRUSTED_REF', 'ref is not trusted');
  }
  if (!policy.environments.includes(claims.environment ?? null)) {
    throw new OidcError('UNTRUSTED_ENVIRONMENT', 'environment is not trusted');
  }
  if (!policy.runnerEnvironments.includes(claims.runner_environment)) {
    throw new OidcError('UNTRUSTED_RUNNER_ENVIRONMENT', 'runner_environment is not trusted');
  }
  if (policy.eventNames && !policy.eventNames.includes(claims.event_name)) {
    throw new OidcError('UNTRUSTED_EVENT', 'event_name is not trusted');
  }

  const expectedSubjects = [
    `repo:${claims.repository}:ref:${claims.ref}`,
    ...(claims.environment ? [`repo:${claims.repository}:environment:${claims.environment}`] : []),
  ];
  if (!expectedSubjects.includes(claims.sub)) {
    throw new OidcError('SUBJECT_MISMATCH', 'sub is not bound to the trusted repository context');
  }
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
  if (audList.length !== 1 || audList[0] !== expectedAud) {
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

  // A custom audience identifies Relay, not the repository/job that may enroll.
  // Bind GitHub's immutable owner id and exact workflow context to an explicit,
  // bounded server-side policy before accepting the workload identity.
  assertGithubActionsClaims(env, payload);

  // ── Signature verification ──────────────────────────────────────────────
  const signingInput = `${headerB64}.${payloadB64}`;
  try {
    await verifyJwtSignature(header, signingInput, sigB64, jwks);
  } catch (error) {
    if (!(error instanceof OidcError) || error.code !== 'KEY_NOT_FOUND') throw error;
    // Key rotation may make an otherwise-fresh cache stale. Refresh exactly
    // once for an unknown kid, then verify against that fetched set.
    const refreshedJwks = await fetchJwks(env, issuerRow, { forceRefresh: true });
    await verifyJwtSignature(header, signingInput, sigB64, refreshedJwks);
  }

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
