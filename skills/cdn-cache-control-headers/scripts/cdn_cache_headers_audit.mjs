#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_RESPONSE_KINDS = ['hashed-asset', 'anonymous-html', 'public-api-json', 'authenticated', 'personalized-feed', 'login-form'];
const VALID_CACHEABILITY = ['public', 'private', 'no-store', 'no-cache'];
const VALID_VARY = ['accept-encoding', 'accept-language', 'accept', 'user-agent', 'cookie'];
const PERSONAL_KINDS = ['authenticated', 'personalized-feed', 'login-form'];
const YEAR_SECONDS = 31536000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a cache-header plan for one response class against
 * cdn-cache-control-headers' recipes, anti-patterns, and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON header plan, see schemas/cdn-cache-headers-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditCdnCacheHeaders(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_RESPONSE_KINDS.includes(plan.responseKind)) {
    throw new TypeError(`plan.responseKind must be one of: ${VALID_RESPONSE_KINDS.join(', ')}`);
  }
  if (!VALID_CACHEABILITY.includes(plan.cacheability)) {
    throw new TypeError(`plan.cacheability must be one of: ${VALID_CACHEABILITY.join(', ')}`);
  }
  if (plan.varyHeaders !== undefined) {
    if (!Array.isArray(plan.varyHeaders) || plan.varyHeaders.some((v) => !VALID_VARY.includes(v))) {
      throw new TypeError(`plan.varyHeaders must be an array drawn from: ${VALID_VARY.join(', ')}`);
    }
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

  const vary = plan.varyHeaders ?? [];
  const sMaxage = typeof plan.sMaxage === 'number' ? plan.sMaxage : undefined;
  const swr = typeof plan.staleWhileRevalidate === 'number' ? plan.staleWhileRevalidate : 0;
  const sie = typeof plan.staleIfError === 'number' ? plan.staleIfError : 0;

  // --- Rule 1: personalized content must never be publicly cacheable ---
  if (PERSONAL_KINDS.includes(plan.responseKind) && plan.cacheability === 'public') {
    fail(
      'personalized-response-marked-public',
      'critical',
      `responseKind "${plan.responseKind}" with cacheability "public": a shared cache may serve one user's response to another — a security failure, not a performance bug.`,
      'Use private (browser-only) for personalized content, or no-store when the response carries secrets.'
    );
  }

  // --- Rule 2: login forms are no-store ---
  if (plan.responseKind === 'login-form' && plan.cacheability !== 'no-store') {
    fail(
      'login-form-not-no-store',
      'critical',
      `responseKind "login-form" with cacheability "${plan.cacheability}": anything but no-store risks back-button leaks of credentials in form fields.`,
      'Set Cache-Control: no-store on login forms and any response carrying credentials.'
    );
  }

  // --- Rule 3: private + s-maxage describe different audiences ---
  if (plan.cacheability === 'private' && sMaxage !== undefined && sMaxage > 0) {
    fail(
      'private-combined-with-s-maxage',
      'medium',
      `cacheability "private" with sMaxage=${sMaxage}: s-maxage addresses shared caches, which private forbids from storing the response at all.`,
      'Pick one audience: private + max-age for browser-only caching, or public + s-maxage for shared caches.'
    );
  }

  // --- Rule 4: Vary: User-Agent craters the hit rate ---
  if (vary.includes('user-agent')) {
    fail(
      'vary-user-agent',
      'high',
      'varyHeaders includes "user-agent": every browser version gets its own cache entry and the hit rate craters — the canonical Vary disaster.',
      'Drop Vary: User-Agent; normalize feature detection at the application layer instead.'
    );
  }

  // --- Rule 5: Vary: Cookie on a shared-cacheable response ---
  if (vary.includes('cookie') && plan.cacheability === 'public') {
    fail(
      'vary-cookie-on-public-response',
      'high',
      'varyHeaders includes "cookie" on a public response: every session ID becomes a unique cache key.',
      'Use Cache-Control: private for per-user responses instead of Vary: Cookie on a public one.'
    );
  }

  // --- Rule 6: Set-Cookie defeats shared caching ---
  if (plan.setCookiePresent === true && plan.cacheability === 'public') {
    fail(
      'set-cookie-on-cacheable-response',
      'high',
      'setCookiePresent is true on a public response: most CDNs default-decline to cache anything carrying Set-Cookie, so the origin eats every request.',
      'Strip cookies on read endpoints intended for shared caching, or configure the CDN to ignore them deliberately.'
    );
  }

  // --- Rule 7: hashed assets get the immutable year ---
  if (plan.responseKind === 'hashed-asset') {
    if (plan.immutable !== true || typeof plan.maxAge !== 'number' || plan.maxAge < YEAR_SECONDS) {
      fail(
        'hashed-asset-not-immutable-year',
        'medium',
        `responseKind "hashed-asset" without immutable=true and maxAge>=${YEAR_SECONDS}: the filename changes on rebuild, so anything shorter wastes revalidation round-trips.`,
        'Serve hashed assets with Cache-Control: public, max-age=31536000, immutable.'
      );
    }
  }

  // --- Rule 8: naked s-maxage without SWR/SIE resilience ---
  if (plan.cacheability === 'public' && sMaxage !== undefined && sMaxage > 0 && plan.responseKind !== 'hashed-asset') {
    if (swr <= 0 || sie <= 0) {
      fail(
        's-maxage-without-stale-extensions',
        'medium',
        `public response with sMaxage=${sMaxage} but staleWhileRevalidate=${swr} / staleIfError=${sie}: without the RFC 5861 extensions, every expiry eats an origin round-trip and every origin outage reaches users.`,
        'Add stale-while-revalidate (hide origin latency) and stale-if-error (survive origin outages) to every public cacheable response.'
      );
    }
  }

  // --- Rule 9: long-TTL mutable content needs purge-on-edit ---
  if (plan.mutableContent === true && sMaxage !== undefined && sMaxage >= 3600 && plan.purgeOnEdit !== true) {
    fail(
      'long-ttl-mutable-without-purge',
      'high',
      `mutableContent is true with sMaxage=${sMaxage} and purgeOnEdit not true: an edit stays invisible for up to the full TTL (hours).`,
      'Pair long CDN TTLs on mutable content with surrogate-key purge on origin edit events.'
    );
  }

  // --- Rule 10: surrogate-key count within the CDN limit ---
  if (plan.surrogateKeysUsed === true && typeof plan.surrogateKeyCount === 'number' && plan.surrogateKeyCount > 16) {
    fail(
      'surrogate-key-count-over-limit',
      'medium',
      `surrogateKeyCount is ${plan.surrogateKeyCount}: Cloudflare caps cache tags at 16 per response (Fastly ~20); extras are dropped silently.`,
      'Keep tags per response under the CDN limit; use prefix-based namespaces (article-, author-, tag-) to group purges.'
    );
  }

  // --- Rule 11: Expires alongside Cache-Control sends conflicting signals ---
  if (plan.expiresHeaderAlsoSet === true) {
    fail(
      'expires-alongside-cache-control',
      'low',
      'expiresHeaderAlsoSet is true: Expires and Cache-Control together send conflicting signals and behavior varies across caches.',
      'Drop the Expires header; express freshness only through Cache-Control directives.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still verify with three curl -I requests (expect MISS then HIT then HIT) and confirm a surrogate-key purge lands within 5 seconds.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: cdn_cache_headers_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditCdnCacheHeaders(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`cdn_cache_headers_audit: ${e.message}\n`);
    process.exit(1);
  }
}
