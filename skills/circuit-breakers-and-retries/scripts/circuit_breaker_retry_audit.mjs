#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_BACKOFF = ['none', 'constant', 'exponential', 'exponential-equal-jitter', 'exponential-full-jitter', 'decorrelated-jitter'];
const VALID_DEADLINE = ['propagated', 'fresh-per-hop', 'none'];
const VALID_LIBRARIES = ['resilience4j', 'polly', 'hystrix', 'custom', 'none'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a retry + circuit-breaker resilience plan against
 * circuit-breakers-and-retries' amplification math and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON resilience plan, see schemas/circuit-breaker-retry-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditCircuitBreakerRetry(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (typeof plan.retryEnabled !== 'boolean') {
    throw new TypeError('plan.retryEnabled must be a boolean');
  }
  if (typeof plan.circuitBreakerEnabled !== 'boolean') {
    throw new TypeError('plan.circuitBreakerEnabled must be a boolean');
  }
  if (plan.backoffStrategy !== undefined && !VALID_BACKOFF.includes(plan.backoffStrategy)) {
    throw new TypeError(`plan.backoffStrategy must be one of: ${VALID_BACKOFF.join(', ')}`);
  }
  if (plan.deadlinePropagation !== undefined && !VALID_DEADLINE.includes(plan.deadlinePropagation)) {
    throw new TypeError(`plan.deadlinePropagation must be one of: ${VALID_DEADLINE.join(', ')}`);
  }
  if (plan.library !== undefined && !VALID_LIBRARIES.includes(plan.library)) {
    throw new TypeError(`plan.library must be one of: ${VALID_LIBRARIES.join(', ')}`);
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

  // --- Rule 1: retry without a circuit breaker ---
  if (plan.retryEnabled && !plan.circuitBreakerEnabled) {
    fail(
      'retry-without-circuit-breaker',
      'critical',
      'retryEnabled is true but circuitBreakerEnabled is false: when the upstream is persistently down, retries hammer it. Retry handles transient failures; the breaker handles persistent ones.',
      'Wrap the retry loop in a circuit breaker and respect its OPEN state.'
    );
  }

  // --- Rule 2: the 64x amplification product ---
  if (plan.retryEnabled && typeof plan.layersThatRetry === 'number' && plan.layersThatRetry > 1) {
    const attempts = typeof plan.maxAttemptsPerRequest === 'number' ? plan.maxAttemptsPerRequest : 3;
    fail(
      'retries-at-multiple-layers',
      'critical',
      `layersThatRetry is ${plan.layersThatRetry}: attempts multiply as the PRODUCT across layers (${attempts + 1}^${plan.layersThatRetry} worst-case per user action, per Google SRE Ch. 22).`,
      'Retry only at the layer immediately above the failing dependency; lower layers return "overloaded; do not retry" (503 + Retry-After).'
    );
  }

  // --- Rule 3: per-request attempt cap ---
  if (typeof plan.maxAttemptsPerRequest === 'number') {
    if (plan.maxAttemptsPerRequest > 5) {
      fail(
        'attempt-cap-far-too-high',
        'high',
        `maxAttemptsPerRequest is ${plan.maxAttemptsPerRequest}: by attempt 10 the upstream is gone; extra attempts only extend the outage.`,
        'Cap per-request attempts at 3 (5 max for highly transient infrastructure).'
      );
    } else if (plan.maxAttemptsPerRequest > 3) {
      fail(
        'attempt-cap-above-sre-budget',
        'medium',
        `maxAttemptsPerRequest is ${plan.maxAttemptsPerRequest}: the Google SRE per-request budget is 3 attempts before letting the failure bubble up.`,
        'Reduce to 3 attempts unless the dependency is documented as highly transient.'
      );
    }
  }

  // --- Rule 4: backoff must be jittered, and full jitter wins ---
  if (plan.retryEnabled) {
    if (plan.backoffStrategy === 'none' || plan.backoffStrategy === 'constant') {
      fail(
        'no-exponential-backoff',
        'high',
        `backoffStrategy is "${plan.backoffStrategy}": retries neither back off nor decorrelate, keeping the dependency overloaded.`,
        'Use full-jitter exponential backoff: sleep = random(0, min(cap, base * 2^attempt)).'
      );
    } else if (plan.backoffStrategy === 'exponential') {
      fail(
        'exponential-backoff-without-jitter',
        'high',
        'backoffStrategy is "exponential" with no jitter: every client retries at the same wallclock instant — backoff without jitter synchronizes retry storms rather than spreading them.',
        'Add full jitter (Brooker: "the no-jitter exponential backoff approach is the clear loser").'
      );
    } else if (plan.backoffStrategy === 'exponential-equal-jitter') {
      fail(
        'equal-jitter-suboptimal',
        'low',
        'backoffStrategy is "exponential-equal-jitter": per Brooker\'s simulation it does more work and takes longer than full jitter.',
        'Prefer full jitter (or decorrelated jitter); the choice between those two is the only close call.'
      );
    }
  }

  // --- Rule 5: per-client retry-ratio budget (the 10% rule) ---
  if (plan.retryEnabled) {
    if (typeof plan.perClientRetryBudgetRatio !== 'number' || plan.perClientRetryBudgetRatio <= 0) {
      fail(
        'no-per-client-retry-budget',
        'high',
        'perClientRetryBudgetRatio is missing or zero: without the per-client budget, the per-request cap alone still allows a 3x request amplification under overload.',
        'Track the retry ratio per client and only retry while it is below 10% — this reduces amplification to ~1.1x in the general case.'
      );
    } else if (plan.perClientRetryBudgetRatio > 0.1) {
      fail(
        'retry-budget-above-ten-percent',
        'medium',
        `perClientRetryBudgetRatio is ${plan.perClientRetryBudgetRatio}: the Google SRE recommendation is a 10% ceiling on the retry ratio.`,
        'Lower the per-client retry budget to 0.10.'
      );
    }
  }

  // --- Rule 6: retry loop must respect the OPEN breaker ---
  if (plan.retryEnabled && plan.circuitBreakerEnabled && plan.retryShortCircuitsOnOpenBreaker !== true) {
    fail(
      'retry-tunnels-through-open-breaker',
      'critical',
      'retryShortCircuitsOnOpenBreaker is not true: retrying through CallNotPermittedException defeats the breaker entirely.',
      'Make the retry loop treat breaker rejection as non-retriable and fail fast.'
    );
  }

  // --- Rule 7: slow-call detection (Resilience4j default is OFF) ---
  if (plan.circuitBreakerEnabled && plan.slowCallRateThresholdConfigured !== true) {
    fail(
      'no-slow-call-detection',
      'medium',
      'slowCallRateThresholdConfigured is not true: a breaker that trips only on errors trips too late — by then the dependency is over the cliff. Resilience4j ships this DISABLED (default 100%).',
      'Configure slowCallRateThreshold + slowCallDurationThreshold for a leading latency indicator.'
    );
  }

  // --- Rule 8: half-open probes must be limited ---
  if (plan.circuitBreakerEnabled && plan.halfOpenProbeLimited !== true) {
    fail(
      'half-open-unbounded',
      'medium',
      'halfOpenProbeLimited is not true: an unbounded HALF_OPEN floods a recovering service with the full backlog.',
      'Permit a fixed probe count in HALF_OPEN (Resilience4j default: 10 calls).'
    );
  }

  // --- Rule 9: never retry non-retriable client errors ---
  if (plan.retriesOnClientErrors === true) {
    fail(
      'retries-on-4xx',
      'high',
      'retriesOnClientErrors is true: 400/401/403/404/422 will never succeed on retry; retrying them wastes budget and masks bugs.',
      'Whitelist retriable statuses only: 5xx (cautiously for 500/504) plus 429 with Retry-After honored.'
    );
  }

  // --- Rule 10: honor Retry-After ---
  if (plan.retryEnabled && plan.honorsRetryAfter !== true) {
    fail(
      'retry-after-ignored',
      'medium',
      'honorsRetryAfter is not true: 429/503 responses carry the server\'s own back-off request; ignoring it retries into a wall.',
      'Parse Retry-After and back off at minimum the suggested duration.'
    );
  }

  // --- Rule 11: deadlines propagate; they are not re-minted per hop ---
  if (plan.deadlinePropagation === 'fresh-per-hop') {
    fail(
      'fresh-timeout-per-hop',
      'high',
      'deadlinePropagation is "fresh-per-hop": total wallclock balloons and servers burn resources on requests already dead at the caller — "you don\'t get credit for late assignments with RPCs".',
      'Set an absolute deadline at the edge and pass min(local_budget, remaining_deadline) downstream.'
    );
  } else if (plan.deadlinePropagation === 'none' || plan.deadlinePropagation === undefined) {
    fail(
      'no-deadline-at-edge',
      'medium',
      'deadlinePropagation is "none": without an edge deadline, retries and downstream calls have no time bound at all.',
      'Set an absolute deadline high in the stack and propagate the remaining budget on every hop.'
    );
  }

  // --- Rule 12: non-idempotent retries need an idempotency key ---
  if (plan.retryEnabled && plan.retriesNonIdempotentCalls === true && plan.nonIdempotentRetriesHaveIdempotencyKey !== true) {
    fail(
      'non-idempotent-retry-without-key',
      'high',
      'retriesNonIdempotentCalls is true without idempotency keys: a read-timeout retry on a POST risks duplicate side effects (double charge, double email).',
      'Attach an idempotency key to retried non-idempotent requests, or do not retry them.'
    );
  }

  // --- Rule 13: Hystrix has been EOL since 2018 ---
  if (plan.library === 'hystrix') {
    fail(
      'hystrix-is-dead',
      'high',
      'library is "hystrix": Netflix EOL\'d Hystrix in 2018; no slow-call detection, no maintenance.',
      'Use Resilience4j (JVM), Polly (.NET), or a per-language hand-rolled equivalent.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still run a game day with a fault-injected dependency and watch the recovery curve before trusting the config.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: circuit_breaker_retry_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditCircuitBreakerRetry(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`circuit_breaker_retry_audit: ${e.message}\n`);
    process.exit(1);
  }
}
