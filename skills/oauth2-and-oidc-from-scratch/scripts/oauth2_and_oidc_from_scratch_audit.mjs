#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_TYPES = ['web-confidential', 'spa', 'native-mobile', 'service', 'device'];
const FLOWS = ['authorization-code', 'client-credentials', 'device-authorization', 'implicit', 'ropc'];
const BROWSER_ARCHITECTURES = ['bff', 'token-mediating-backend', 'pure-spa', 'none'];
const TOKEN_STORAGE = ['server-side-session', 'httponly-cookie', 'in-memory', 'service-worker', 'local-storage', 'session-storage', 'indexeddb', 'none'];
const XSS_READABLE_STORAGE = ['local-storage', 'session-storage', 'indexeddb'];
const REDIRECT_MATCHING = ['exact', 'prefix', 'wildcard', 'hostname-only'];
const JWT_LIBRARIES = ['vetted', 'hand-rolled', 'none'];
const JWKS_SOURCES = ['jwks-endpoint', 'hardcoded-key', 'none'];

function assertPlanObject(plan) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit an OAuth 2.0 / OIDC integration plan against oauth2-and-oidc-from-scratch's
 * Anti-patterns and Quality Gates (OAuth 2.1 draft + browser-based-apps BCP).
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/oauth2-and-oidc-from-scratch-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditOauth2AndOidcFromScratch(plan) {
  assertPlanObject(plan);
  if (!CLIENT_TYPES.includes(plan.clientType)) {
    throw new TypeError(`plan.clientType must be one of: ${CLIENT_TYPES.join(', ')}`);
  }
  if (!FLOWS.includes(plan.flow)) {
    throw new TypeError(`plan.flow must be one of: ${FLOWS.join(', ')}`);
  }
  if (typeof plan.oidc !== 'boolean') {
    throw new TypeError('plan.oidc must be a boolean');
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= { critical: 30, high: 15, medium: 8, low: 3 }[severity] ?? 5;
  }

  // --- Gate 1: removed grants (OAuth 2.1 removes implicit and ROPC) ---
  if (plan.flow === 'implicit') {
    fail('removed-grant-implicit', 'critical',
      'flow is "implicit": removed in OAuth 2.1 -- tokens land in URL fragments and browser history.',
      'Migrate to authorization code + PKCE (browser) or a BFF; sequence the migration, do not yank implicit in one deploy.');
  }
  if (plan.flow === 'ropc') {
    fail('removed-grant-ropc', 'critical',
      'flow is "ropc": the resource-owner-password-credentials grant is removed in OAuth 2.1 with no drop-in replacement.',
      'Use a real authentication UI on the IdP (authorization code + PKCE); ROPC has no successor.');
  }

  // --- Gate 2: PKCE is mandatory for every authorization-code client ---
  if (plan.flow === 'authorization-code' && plan.usesPkce !== true) {
    fail('authcode-without-pkce', 'critical',
      'flow is authorization-code but usesPkce is not true: OAuth 2.1 mandates code_challenge/code_verifier for every client, confidential ones included.',
      'Add PKCE (S256 code_challenge) to every authorization request -- no exceptions for confidential clients.');
  }

  // --- Gate 3: browser architecture (BFF > token-mediating > pure SPA) ---
  if (BROWSER_ARCHITECTURES.includes(plan.browserArchitecture) && plan.browserArchitecture === 'pure-spa') {
    fail('pure-spa-oauth-client', 'high',
      'browserArchitecture is "pure-spa": the browser-based-apps BCP calls this vulnerable to all discussed attack scenarios; use it only when no backend exists.',
      'Prefer a BFF (browser holds only an HttpOnly session cookie) or a token-mediating backend over a pure-SPA OAuth client.');
  }

  // --- Gate 4: token storage must not be XSS-readable ---
  if (TOKEN_STORAGE.includes(plan.tokenStorage) && XSS_READABLE_STORAGE.includes(plan.tokenStorage)) {
    fail('xss-readable-token-storage', 'critical',
      `tokenStorage is "${plan.tokenStorage}": readable by any same-origin script, so one XSS exfiltrates every token.`,
      'Move tokens server-side behind a BFF with an HttpOnly + Secure session cookie; at minimum keep tokens in memory only.');
  }

  // --- Gate 5: redirect_uri must be exactly matched ---
  if (REDIRECT_MATCHING.includes(plan.redirectUriMatching) && plan.redirectUriMatching !== 'exact') {
    fail('loose-redirect-uri-matching', 'critical',
      `redirectUriMatching is "${plan.redirectUriMatching}": OAuth 2.1 requires the AS to reject any redirect_uri that does not exactly match a registered URI.`,
      'Register full redirect URIs and match them exactly -- no prefix, wildcard, or hostname-only matching.');
  }

  // --- Gate 6: state (CSRF) and nonce (ID-token replay) are both required ---
  if (plan.flow === 'authorization-code' && plan.statePresent !== true) {
    fail('missing-state-csrf', 'high',
      'statePresent is not true: without a session-bound state check, the redirect is CSRF-able and a user can land authenticated as the attacker.',
      'Generate a random state per login, store it server-side bound to the pre-login session, and reject callbacks that do not match.');
  }
  if (plan.oidc === true && plan.noncePresent !== true) {
    fail('missing-nonce-replay', 'high',
      'oidc is true but noncePresent is not true: without a nonce the ID token can be replayed.',
      'Send a random nonce in the authorization request and reject ID tokens whose nonce claim does not match it.');
  }

  // --- Gate 7: ID-token validation (OIDC only) ---
  if (plan.oidc === true) {
    const v = isPlainObject(plan.idTokenValidation) ? plan.idTokenValidation : {};
    if (JWT_LIBRARIES.includes(v.library) ? v.library !== 'vetted' : true) {
      fail('unvetted-jwt-verification', 'critical',
        `idTokenValidation.library is "${v.library ?? 'unset'}": hand-rolled or absent JWT verification re-opens alg=none / RS256-to-HS256 confusion CVEs.`,
        'Use a vetted JWT library (jose, authlib, go-jose, nimbus-jose-jwt) -- never hand-roll signature verification.');
    }
    if (v.algPinned !== true) {
      fail('alg-not-pinned', 'high',
        'idTokenValidation.algPinned is not true: trusting the token\'s alg header enables algorithm-confusion forgery.',
        'Pin the expected algorithm (RS256 or EdDSA) in the verifier configuration; reject anything else.');
    }
    for (const [field, rule] of [['checksIssuer', 'iss'], ['checksAudience', 'aud'], ['checksExpiry', 'exp'], ['checksNonce', 'nonce']]) {
      if (v[field] !== true) {
        fail(`id-token-claim-unchecked-${rule}`, 'medium',
          `idTokenValidation.${field} is not true: the ${rule} claim must be validated on every ID token.`,
          `Validate the ${rule} claim explicitly; signature verification alone does not scope the token to your client.`);
      }
    }
    if (JWKS_SOURCES.includes(plan.jwksSource) ? plan.jwksSource !== 'jwks-endpoint' : true) {
      fail('hardcoded-idp-key', 'high',
        `jwksSource is "${plan.jwksSource ?? 'unset'}": a hardcoded IdP public key breaks on the IdP's scheduled key rotation.`,
        'Fetch keys from /.well-known/jwks.json with a TTL cache and refetch on kid mismatch.');
    }
  }

  // --- Gate 8: refresh tokens server-side and rotated ---
  if (isPlainObject(plan.refreshTokens) && plan.refreshTokens.issued === true) {
    if (plan.refreshTokens.storage === 'browser') {
      fail('refresh-token-in-browser', 'critical',
        'refreshTokens.storage is "browser": a long-lived credential exposed to XSS; refresh tokens belong in the BFF session store.',
        'Keep refresh tokens server-side (BFF session store); the browser sees only an opaque HttpOnly session cookie.');
    }
    if (plan.refreshTokens.rotationEnabled !== true) {
      fail('refresh-token-not-rotated', 'high',
        'refreshTokens.rotationEnabled is not true: a leaked refresh token works for months with no theft signal.',
        'Rotate on each exchange so reuse-after-rotation revokes the whole chain; if the IdP cannot rotate, apply a sliding session window.');
    }
  }

  // --- Gate 9: clock-skew tolerance <= 60s ---
  if (typeof plan.clockSkewSeconds === 'number' && plan.clockSkewSeconds > 60) {
    fail('clock-skew-too-generous', 'medium',
      `clockSkewSeconds is ${plan.clockSkewSeconds}: tolerance above 60s widens the replay window on exp/iat/nbf.`,
      'Cap clock-skew tolerance at 60 seconds; fix clock drift with NTP, not with a wider validation window.');
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still run the end-to-end login test against a real IdP (or mockoidc) and assert state + nonce checks fire before closing it out.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: oauth2_and_oidc_from_scratch_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditOauth2AndOidcFromScratch(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`oauth2_and_oidc_from_scratch_audit: ${e.message}\n`);
    process.exit(1);
  }
}
