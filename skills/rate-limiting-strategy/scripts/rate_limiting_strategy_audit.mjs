#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_ALGORITHMS = [
  'fixed-window',
  'sliding-window-log',
  'sliding-window-counter',
  'token-bucket',
  'leaky-bucket-policing',
  'leaky-bucket-shaping',
];
const VALID_ENFORCEMENT = ['edge', 'gateway', 'origin-redis', 'in-process'];
const VALID_KEY_TIERS = ['user-id', 'api-key', 'ip-ua-path', 'ip-only', 'global'];
const VALID_FAILURE_MODES = ['fail-open', 'fail-closed', 'local-fallback', 'undecided'];
const VALID_LOGIN_TUPLES = ['ip-username', 'ip', 'username'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a rate-limiter design against rate-limiting-strategy's three
 * decisions (algorithm, placement, key) and its Quality Gates: no boundary
 * burst on customer traffic, aggregate (not per-pod) enforcement, atomic
 * Lua, cluster hash tags, the full 429 contract, a documented Redis failure
 * mode with fail-open telemetry, and layered login-tuple limits.
 *
 * @param {unknown} plan - parsed JSON, see schemas/rate-limiting-strategy-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditRateLimitingStrategy(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_ALGORITHMS.includes(plan.algorithm)) {
    throw new TypeError(`plan.algorithm must be one of: ${VALID_ALGORITHMS.join(', ')}`);
  }
  if (typeof plan.customerFacing !== 'boolean') {
    throw new TypeError('plan.customerFacing must be a boolean');
  }
  if (!Array.isArray(plan.enforcementPoints) || plan.enforcementPoints.length === 0) {
    throw new TypeError('plan.enforcementPoints must be a non-empty array');
  }
  for (const p of plan.enforcementPoints) {
    if (!VALID_ENFORCEMENT.includes(p)) {
      throw new TypeError(`enforcementPoints entry "${p}" must be one of: ${VALID_ENFORCEMENT.join(', ')}`);
    }
  }
  if (!VALID_KEY_TIERS.includes(plan.keyTier)) {
    throw new TypeError(`plan.keyTier must be one of: ${VALID_KEY_TIERS.join(', ')}`);
  }
  if (plan.redisFailureMode !== undefined && !VALID_FAILURE_MODES.includes(plan.redisFailureMode)) {
    throw new TypeError(`plan.redisFailureMode must be one of: ${VALID_FAILURE_MODES.join(', ')}`);
  }
  if (plan.loginKeyTuples !== undefined) {
    if (!Array.isArray(plan.loginKeyTuples)) throw new TypeError('plan.loginKeyTuples must be an array');
    for (const t of plan.loginKeyTuples) {
      if (!VALID_LOGIN_TUPLES.includes(t)) {
        throw new TypeError(`loginKeyTuples entry "${t}" must be one of: ${VALID_LOGIN_TUPLES.join(', ')}`);
      }
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

  const points = plan.enforcementPoints;

  // Gate 1: fixed window has the boundary burst — never customer-facing.
  if (plan.algorithm === 'fixed-window' && plan.customerFacing === true) {
    fail(
      'fixed-window-customer-facing',
      'high',
      'algorithm is fixed-window on a customer-facing API: the boundary burst allows 2x the limit across a window flip.',
      'Use sliding-window-counter (the general default; ~0.003% error at Cloudflare scale) or sliding-window-log where exactness is required.'
    );
  }

  // Gate 2: bursty workloads want a token bucket.
  if (plan.burstsRequired === true && plan.algorithm !== 'token-bucket') {
    fail(
      'bursts-without-token-bucket',
      'medium',
      `burstsRequired is true but algorithm is ${plan.algorithm}: controlled bursts up to capacity are exactly what token bucket provides.`,
      'Use a token bucket with per-request cost so bursty-but-fair workloads (CI runs, batch imports) are not falsely denied.'
    );
  }

  // Gate 3: an in-process limiter multiplied by replicas is not a limit.
  if (points.includes('in-process') && typeof plan.replicaCount === 'number' && plan.replicaCount > 1) {
    fail(
      'per-pod-limiter',
      'critical',
      `enforcementPoints include in-process with replicaCount ${plan.replicaCount}: the effective limit is ${plan.replicaCount}x the configured one, and scaling out silently raises it further.`,
      'Back the limiter with shared state (Redis) so the limit holds in aggregate.'
    );
  }

  // Gate 4: origin Redis limiting must be atomic Lua.
  if (points.includes('origin-redis') && plan.atomicLua !== true) {
    fail(
      'non-atomic-redis-limiter',
      'high',
      'origin-redis enforcement with atomicLua not true: a GET/SET sequence race-allows requests above the limit under contention.',
      'Put all limiter logic in a single EVAL Lua script (EVALSHA after load).'
    );
  }

  // Gate 5: Redis Cluster keys must co-locate.
  if (plan.redisCluster === true && plan.clusterHashTags !== true) {
    fail(
      'cluster-keys-not-colocated',
      'high',
      'redisCluster is true but clusterHashTags is not: multi-key Lua across slots breaks atomicity (MOVED errors).',
      'Use {tag} hash-tag syntax (rl:{user:42}:current / rl:{user:42}:prev) so one principal\'s keys share a slot.'
    );
  }

  // Gate 6: the 429 contract.
  if (plan.retryAfterHeader !== true) {
    fail(
      'missing-retry-after',
      'high',
      'retryAfterHeader is not true: without Retry-After, well-behaved clients hammer in tight loops after a 429.',
      'Always emit Retry-After (integer seconds) alongside the 429.'
    );
  }
  if (plan.rateLimitHeaders !== true) {
    fail(
      'missing-ratelimit-headers',
      'medium',
      'rateLimitHeaders is not true: the RateLimit-Limit/Remaining/Reset trio (IETF draft) is missing from responses.',
      'Emit RateLimit-* on every response (and legacy X-RateLimit-* during transition) so clients can pace themselves.'
    );
  }

  // Gate 7: the Redis failure mode is a decision, not an accident.
  if (plan.redisFailureMode === undefined || plan.redisFailureMode === 'undecided') {
    fail(
      'failure-mode-undecided',
      'high',
      'redisFailureMode is undecided/absent: what happens when Redis is down is currently an accident.',
      'Choose and document fail-open, fail-closed, or local-fallback — and test it with a chaos toggle.'
    );
  } else if (plan.redisFailureMode === 'fail-open' && plan.failOpenTelemetry !== true) {
    fail(
      'fail-open-without-telemetry',
      'high',
      'redisFailureMode is fail-open but failOpenTelemetry is not true: abuse sails through during a Redis blip and nobody notices.',
      'Emit a metric on every fail-open allow and alert when the rate exceeds a threshold.'
    );
  }

  // Gate 8: auth endpoints need their own, layered limits.
  if (plan.authEndpointsCovered !== true) {
    fail(
      'auth-endpoints-uncovered',
      'high',
      'authEndpointsCovered is not true: /login, /register, /forgot-password without dedicated tight limits is an open brute-force surface.',
      'Rate-limit auth endpoints separately (~5-10/min per IP+username), far below read-endpoint limits.'
    );
  } else if (Array.isArray(plan.loginKeyTuples)) {
    const missing = VALID_LOGIN_TUPLES.filter((t) => !plan.loginKeyTuples.includes(t));
    if (missing.length > 0) {
      fail(
        'incomplete-login-tuples',
        'medium',
        `loginKeyTuples is missing: ${missing.join(', ')}. Single-tuple login limiting is evaded by IP rotation (per-user attack) or password spraying (per-IP attack).`,
        'Limit (IP, username), (IP), and (username) simultaneously, each with its own counter.'
      );
    }
  }

  // Gate 9: keying — IP-only for customer traffic collides NATs.
  if (plan.keyTier === 'ip-only' && plan.customerFacing === true) {
    fail(
      'ip-only-key-for-customers',
      'medium',
      'keyTier is ip-only on customer-facing traffic: corporate NAT / CGNAT folds hundreds of users into one bucket — you will DOS your own users.',
      'Key on authenticated user ID (or API key); fall back to IP+UA+path only for unauthenticated routes.'
    );
  }

  // Gate 10: one global limit policy is an anti-pattern.
  if (plan.perEndpointLimits !== true) {
    fail(
      'single-global-limit',
      'medium',
      'perEndpointLimits is not true: one policy is simultaneously too generous for /login and too strict for reads.',
      'Differentiate by endpoint cost/risk: auth tight, reads generous, expensive endpoints via token-bucket cost.'
    );
  }

  // Gate 11: unauthenticated abuse should be dropped at the edge.
  if (plan.unauthenticatedTraffic === true && !points.includes('edge')) {
    fail(
      'no-edge-layer-for-unauth',
      'medium',
      'unauthenticatedTraffic is true but no edge enforcement point exists: every abusive request pays full origin cost.',
      'Add edge rate limiting (Cloudflare WAF rules, Upstash, AWS WAF) in series before the origin limiter.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Design clears every quality gate this skill checks. Still load-test the aggregate limit across all pods and exercise the documented Redis failure mode before launch.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: rate_limiting_strategy_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditRateLimitingStrategy(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`rate_limiting_strategy_audit: ${e.message}\n`);
    process.exit(1);
  }
}
