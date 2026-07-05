#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_CORS_ORIGIN_POLICIES = ['allowlist', 'wildcard', 'echo-any'];
const VALID_SAMESITE = ['strict', 'lax', 'none'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Hono app plan against hono-patterns' core rules: middleware must
 * await next(), catch-alls register last, every route validates input,
 * onError sanitizes, CORS-with-credentials never uses a wildcard or blind
 * echo, streaming loops check stream.aborted, and redirect-driven logins
 * avoid SameSite=Strict. All rules operate on structured enum/boolean fields
 * -- see schemas/hono-patterns-plan.schema.json.
 *
 * @param {unknown} plan
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditHonoPatterns(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  for (const field of ['middlewareAwaitsNext', 'catchAllRegisteredLast', 'routesValidated', 'onErrorSanitized']) {
    if (typeof plan[field] !== 'boolean') {
      throw new TypeError(`plan.${field} must be a boolean`);
    }
  }
  if (plan.corsOriginPolicy !== undefined && !VALID_CORS_ORIGIN_POLICIES.includes(plan.corsOriginPolicy)) {
    throw new TypeError(`plan.corsOriginPolicy must be one of: ${VALID_CORS_ORIGIN_POLICIES.join(', ')}`);
  }
  if (plan.sessionCookieSameSite !== undefined && !VALID_SAMESITE.includes(plan.sessionCookieSameSite)) {
    throw new TypeError(`plan.sessionCookieSameSite must be one of: ${VALID_SAMESITE.join(', ')}`);
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

  // --- Gate: every continuing middleware awaits next() ---
  if (plan.middlewareAwaitsNext !== true) {
    fail(
      'middleware-missing-await-next',
      'critical',
      'middlewareAwaitsNext is not true: a middleware that neither awaits next() nor returns a short-circuit response leaves the request hanging -- the handler never runs.',
      'Every middleware that intends to continue must await next(); only auth failures and rate limits should return early.'
    );
  }

  // --- Gate: catch-all routes register last ---
  if (plan.catchAllRegisteredLast !== true) {
    fail(
      'catch-all-before-specific-routes',
      'high',
      'catchAllRegisteredLast is not true: Hono matches in registration order, so an early app.all(\'*\') shadows every specific route registered after it.',
      'Register wildcards last; use app.notFound(handler) for 404s instead of a wildcard route.'
    );
  }

  // --- Gate: every route validates its input ---
  if (plan.routesValidated !== true) {
    fail(
      'routes-without-validation',
      'high',
      'routesValidated is not true: routes reading json/form/query/param without a validator accept unchecked shapes straight into handlers and the database.',
      'Add zValidator (or explicit typed parsing) to every route slot the handler reads.'
    );
  }

  // --- Gate: onError returns a sanitized response ---
  if (plan.onErrorSanitized !== true) {
    fail(
      'onerror-leaks-internals',
      'high',
      'onErrorSanitized is not true: an app.onError that echoes err.message or the stack leaks internals to clients on every unhandled throw.',
      'In app.onError, return HTTPException responses as-is and a generic 500 body for everything else; log the details server-side.'
    );
  }

  // --- Gate: CORS with credentials needs a real allowlist ---
  if (plan.corsCredentials === true) {
    if (plan.corsOriginPolicy === 'wildcard') {
      fail(
        'cors-credentials-with-wildcard',
        'critical',
        'corsCredentials is true with corsOriginPolicy "wildcard": browsers reject Access-Control-Allow-Origin: * when credentials are sent, so cookies silently never ride cross-origin.',
        'Echo back a specific origin from a typed allowlist function; never * with credentials: true.'
      );
    } else if (plan.corsOriginPolicy === 'echo-any') {
      fail(
        'cors-credentials-echo-any-origin',
        'critical',
        'corsCredentials is true with corsOriginPolicy "echo-any": reflecting every Origin header back with credentials allowed lets any site make authenticated requests as the user.',
        'Validate the origin against an explicit allowlist before echoing it; return null for everything else.'
      );
    }
  }

  // --- Gate: streaming loops check stream.aborted ---
  if (plan.hasStreamingEndpoints === true && plan.streamChecksAborted !== true) {
    fail(
      'stream-aborted-not-checked',
      'high',
      'hasStreamingEndpoints is true but streamChecksAborted is not: a long SSE/NDJSON loop that never checks stream.aborted keeps writing after the client disconnects and leaks the handler.',
      'Guard every long streaming loop with while (!stream.aborted) so disconnects end the work.'
    );
  }

  // --- Gate: SameSite=Strict breaks redirect-driven logins ---
  if (plan.loginUsesRedirect === true && plan.sessionCookieSameSite === 'strict') {
    fail(
      'samesite-strict-on-redirect-login',
      'high',
      'loginUsesRedirect is true with sessionCookieSameSite "strict": some browsers drop Strict cookies on the auto-followed redirect, so the very next request arrives unauthenticated (403 after a 302).',
      'Use SameSite=Lax for session cookies that must survive a redirect-driven login flow.'
    );
  }

  // --- Gate: declare the Bindings/Variables generics ---
  if (plan.bindingsGenericDeclared === false || plan.variablesGenericDeclared === false) {
    fail(
      'untyped-hono-generics',
      'medium',
      'bindingsGenericDeclared/variablesGenericDeclared is false: without the Hono<{ Bindings, Variables }> generic, c.env is untyped and c.get() returns unknown, pushing casts into every handler.',
      'Declare both generics on the root app so c.env, c.set, and c.get are checked end-to-end.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still exercise the app end-to-end: hit a specific route, the 404 path, and a thrown error, and watch the Set-Cookie header ride the redirect.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: hono_patterns_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditHonoPatterns(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`hono_patterns_audit: ${e.message}\n`);
    process.exit(1);
  }
}
