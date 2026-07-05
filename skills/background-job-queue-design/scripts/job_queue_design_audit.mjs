#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_BROKERS = ['bullmq', 'sidekiq-oss', 'sidekiq-pro', 'sqs', 'temporal', 'rq', 'celery', 'asynq'];
const REDIS_BROKERS = ['bullmq', 'sidekiq-oss', 'sidekiq-pro', 'rq', 'celery', 'asynq'];
const VALID_WORK_SHAPES = ['single-side-effect', 'multi-step-seconds', 'multi-step-hours', 'human-in-loop'];
const VALID_BACKOFF = ['none', 'fixed', 'exponential', 'exponential-full-jitter'];
const VALID_MAXMEMORY = ['noeviction', 'allkeys-lru', 'volatile-lru', 'allkeys-lfu', 'volatile-lfu', 'allkeys-random', 'volatile-random', 'volatile-ttl'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a background-job system design against background-job-queue-design's
 * three failure modes (lost jobs, duplicate execution, runaway retries) and
 * its Quality Gates.
 *
 * @param {unknown} plan - parsed JSON design plan, see schemas/background-job-queue-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditJobQueueDesign(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_BROKERS.includes(plan.broker)) {
    throw new TypeError(`plan.broker must be one of: ${VALID_BROKERS.join(', ')}`);
  }
  if (!VALID_WORK_SHAPES.includes(plan.workShape)) {
    throw new TypeError(`plan.workShape must be one of: ${VALID_WORK_SHAPES.join(', ')}`);
  }
  if (typeof plan.handlersIdempotent !== 'boolean') {
    throw new TypeError('plan.handlersIdempotent must be a boolean');
  }
  if (plan.backoffStrategy !== undefined && !VALID_BACKOFF.includes(plan.backoffStrategy)) {
    throw new TypeError(`plan.backoffStrategy must be one of: ${VALID_BACKOFF.join(', ')}`);
  }
  if (plan.redisMaxmemoryPolicy !== undefined && !VALID_MAXMEMORY.includes(plan.redisMaxmemoryPolicy)) {
    throw new TypeError(`plan.redisMaxmemoryPolicy must be one of: ${VALID_MAXMEMORY.join(', ')}`);
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

  const isRedisBroker = REDIS_BROKERS.includes(plan.broker);

  // --- Rule 1: exactly-once is a myth across systems ---
  if (plan.expectsExactlyOnce === true) {
    fail(
      'exactly-once-expected',
      'critical',
      'expectsExactlyOnce is true: no broker extends exactly-once across your DB, email vendor, and payment provider. At-least-once is the only honest delivery semantic.',
      'Design for at-least-once delivery with idempotent handlers; stop chasing exactly-once.'
    );
  }

  // --- Rule 2: idempotency is the mandatory property ---
  if (plan.handlersIdempotent !== true) {
    fail(
      'handlers-not-idempotent',
      'critical',
      'handlersIdempotent is false: any retry, stalled-job re-queue, or DLQ replay will duplicate side effects (double charge, double email).',
      'Make every handler idempotent with a stable idempotency key derived from the business event.'
    );
  }

  // --- Rule 3: Redis-only dedup evaporates; back it with a DB constraint ---
  if (plan.handlersIdempotent === true && plan.dedupBackedByDbConstraint !== true) {
    fail(
      'dedup-not-backed-by-db-constraint',
      'high',
      'dedupBackedByDbConstraint is not true: jobId / SET-NX dedup lives only in Redis, which can be evicted, restarted, or partitioned; the dedup window evaporates.',
      'Add a DB unique constraint on the side-effect record (e.g. email_sends.idempotency_key); the transaction that creates the side effect IS the dedup primitive.'
    );
  }

  // --- Rule 4: lock/visibility timeout vs handler p99 ---
  if (typeof plan.lockDurationMs === 'number' && typeof plan.handlerP99Ms === 'number') {
    if (plan.lockDurationMs < 3 * plan.handlerP99Ms && plan.handlerExtendsLock !== true) {
      fail(
        'lock-duration-below-3x-p99',
        'critical',
        `lockDurationMs (${plan.lockDurationMs}) is under 3x handlerP99Ms (${plan.handlerP99Ms}) and handlerExtendsLock is not true: a slow-but-healthy handler will lose its lock and the job runs twice.`,
        'Set lockDuration / visibility timeout to ~3x measured p99, and extend the lock (job.extendLock / ChangeMessageVisibility) inside genuinely long handlers.'
      );
    }
  }

  // --- Rule 5: backoff must be exponential with full jitter ---
  if (plan.backoffStrategy === 'none' || plan.backoffStrategy === 'fixed') {
    fail(
      'no-exponential-backoff',
      'high',
      `backoffStrategy is "${plan.backoffStrategy}": failed jobs hammer the downstream at a constant rate instead of backing off.`,
      'Use exponential backoff with full jitter: delay = random(0, min(cap, base * 2^attempt)).'
    );
  } else if (plan.backoffStrategy === 'exponential') {
    fail(
      'backoff-without-jitter',
      'high',
      'backoffStrategy is "exponential" (no jitter): after a downstream blip, every failed job retries at the same instant — a thundering herd that keeps the service down.',
      'Add full jitter: delay = random(0, exponential_backoff), capped to bound DLQ time-to-failure.'
    );
  }

  // --- Rule 6: permanent errors must not retry ---
  if (plan.permanentErrorsBypassRetry !== true) {
    fail(
      'permanent-errors-retry',
      'high',
      'permanentErrorsBypassRetry is not true: user-not-found / malformed-input errors will retry through the full attempts policy before dead-lettering, wasting capacity and delaying alerts.',
      'Classify errors (PermanentError vs TransientError); permanent errors discard/DLQ on first attempt.'
    );
  }

  // --- Rule 7 + 8: a DLQ needs a replay tool and a growth-rate alert ---
  if (plan.dlqConfigured === true && plan.dlqReplayToolExists !== true) {
    fail(
      'dlq-without-replay-tool',
      'high',
      'dlqConfigured is true but dlqReplayToolExists is not: the DLQ becomes an unmonitored graveyard nobody can drain after the upstream bug is fixed.',
      'Build and test a replay tool: replay-by-id, replay-by-time-range, drain-with-confirmation.'
    );
  }
  if (plan.dlqConfigured === true && plan.dlqAlertOnGrowthRate !== true) {
    fail(
      'dlq-alert-not-rate-based',
      'medium',
      'dlqAlertOnGrowthRate is not true: "DLQ has 3 things forever" is fine; "DLQ grew 100/min" is a fire — alert on growth rate, not nonzero count.',
      'Alert when DLQ growth rate exceeds N per minute rather than on count > 0.'
    );
  }

  // --- Rule 9 + 10: Redis memory hygiene ---
  if (isRedisBroker && plan.redisMaxmemoryPolicy !== undefined && plan.redisMaxmemoryPolicy !== 'noeviction') {
    fail(
      'redis-eviction-policy-loses-jobs',
      'critical',
      `redisMaxmemoryPolicy is "${plan.redisMaxmemoryPolicy}": anything other than noeviction silently evicts queued jobs under memory pressure. No errors — jobs just vanish.`,
      'CONFIG SET maxmemory-policy noeviction, and assert it at worker startup (refuse to start otherwise).'
    );
  }
  if (isRedisBroker && plan.redisAofEnabled !== true) {
    fail(
      'redis-aof-disabled',
      'medium',
      'redisAofEnabled is not true: without AOF persistence (appendfsync everysec), a Redis restart loses every queued job.',
      'Enable Redis AOF with appendfsync everysec — the documented sweet spot for BullMQ-class queues.'
    );
  }

  // --- Rule 11: hours-long / human-in-loop work belongs in a workflow engine ---
  if ((plan.workShape === 'multi-step-hours' || plan.workShape === 'human-in-loop') && plan.broker !== 'temporal') {
    fail(
      'workflow-shaped-work-on-plain-queue',
      'high',
      `workShape is "${plan.workShape}" but broker is "${plan.broker}": a multi-step process that pauses for hours or waits on a human is a durable workflow, not N chained queue jobs.`,
      'Use Temporal (or an equivalent durable-execution engine) so state, retries, and resume-after-crash come from replayable history.'
    );
  }

  // --- Rule 12: Sidekiq OSS loses jobs on worker crash ---
  if (plan.broker === 'sidekiq-oss') {
    fail(
      'sidekiq-oss-lossy-fetch',
      'medium',
      'broker is "sidekiq-oss": the pop is non-atomic, so a worker that dies between pop and process loses the job entirely.',
      'Upgrade to Sidekiq Pro super_fetch (LMOVE to a private working queue with orphan sweep) if lost jobs are unacceptable.'
    );
  }

  // --- Rule 13: graceful shutdown ---
  if (plan.gracefulShutdownHandled !== true) {
    fail(
      'no-graceful-shutdown',
      'medium',
      'gracefulShutdownHandled is not true: without worker.close() on SIGTERM/SIGINT, every deploy strands in-flight jobs until the stall checker re-queues them.',
      'Handle SIGTERM/SIGINT: stop accepting, finish in-flight jobs via worker.close(), then quit the connection.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Design clears every quality gate this skill checks. Still run the chaos test (kill a worker mid-job) and the retry-storm test before calling it production-ready.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: job_queue_design_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditJobQueueDesign(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`job_queue_design_audit: ${e.message}\n`);
    process.exit(1);
  }
}
