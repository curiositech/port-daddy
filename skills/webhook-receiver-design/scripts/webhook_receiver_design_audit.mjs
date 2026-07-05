#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_PROVIDERS = ['stripe', 'github', 'slack', 'twilio', 'shopify', 'internal', 'other'];
const VALID_IDEMPOTENCY = ['db-unique-constraint', 'redis', 'in-memory', 'none'];
const VALID_PROCESSING = ['sync', 'async-queue'];
const VALID_STATE_SOURCES = ['provider-api', 'event-payload', 'event-sourced'];
const SEVERITY_WEIGHTS = { critical: 30, high: 15, medium: 8, low: 3 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a webhook receiver design plan against webhook-receiver-design's three
 * failure axes (signatures, idempotency, latency) and its Quality Gates.
 * Structured/enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/webhook-receiver-design-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditWebhookReceiverDesign(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_PROVIDERS.includes(plan.provider)) {
    throw new TypeError(`plan.provider must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }
  if (!VALID_PROCESSING.includes(plan.processingModel)) {
    throw new TypeError(`plan.processingModel must be one of: ${VALID_PROCESSING.join(', ')}`);
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= SEVERITY_WEIGHTS[severity] ?? 5;
  }

  // --- Axis 1: signatures ---
  if (plan.verifiesSignature !== true) {
    fail(
      'no-signature-verification',
      'critical',
      'verifiesSignature is not true: anyone who learns the endpoint URL can forge events into your system.',
      "Verify the provider's HMAC signature (Stripe-Signature, X-Hub-Signature-256, X-Slack-Signature) before doing anything else."
    );
  } else {
    if (plan.signatureOverRawBody !== true) {
      fail(
        'hmac-over-parsed-body',
        'critical',
        'signatureOverRawBody is not true: JSON middleware re-serializes whitespace, so HMAC over the parsed body randomly mismatches the digest computed over the wire bytes.',
        'Apply raw-body middleware to webhook routes and verify against the exact bytes that arrived (req.rawBody / c.req.text()).'
      );
    }
    if (plan.timingSafeCompare !== true) {
      fail(
        'signature-compared-with-equals',
        'high',
        'timingSafeCompare is not true: === short-circuits on the first mismatched byte and leaks timing information to an attacker.',
        'Compare with crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) after a length check.'
      );
    }
  }
  if (typeof plan.replayWindowSeconds !== 'number') {
    fail(
      'no-replay-window',
      'high',
      'replayWindowSeconds is not set: a captured webhook can be replayed days later.',
      'Reject events whose signed timestamp is older than ~300 seconds.'
    );
  } else if (plan.replayWindowSeconds > 600) {
    fail(
      'replay-window-too-wide',
      'medium',
      `replayWindowSeconds is ${plan.replayWindowSeconds}: anything much past ~5 minutes widens the replay surface for no delivery benefit.`,
      'Tighten the tolerance to ~300 seconds; providers retry within it.'
    );
  }

  // --- Axis 2: idempotency ---
  if (plan.idempotencyPrimitive === 'none' || plan.idempotencyPrimitive === undefined) {
    fail(
      'no-idempotency-key',
      'critical',
      'idempotencyPrimitive is none/absent: providers retry, so the handler will run duplicate side effects.',
      "Insert the provider's event ID into a table with a UNIQUE constraint; only proceed when the insert succeeds."
    );
  } else if (plan.idempotencyPrimitive === 'redis' || plan.idempotencyPrimitive === 'in-memory') {
    fail(
      'dedup-not-transactional',
      'high',
      `idempotencyPrimitive is ${plan.idempotencyPrimitive}: when it is down or evicted, dedup silently skips and duplicates ship — and it cannot commit atomically with the side effect.`,
      'Move dedup to a DB UNIQUE constraint on (provider, event_id) in the same database that records the side effect.'
    );
  } else if (!VALID_IDEMPOTENCY.includes(plan.idempotencyPrimitive)) {
    fail(
      'invalid-idempotency-primitive',
      'medium',
      `idempotencyPrimitive "${plan.idempotencyPrimitive}" is not one of: ${VALID_IDEMPOTENCY.join(', ')}.`,
      'Declare the dedup primitive; db-unique-constraint is the correct answer.'
    );
  }

  // --- Axis 3: latency budget ---
  if (plan.processingModel === 'sync') {
    if (typeof plan.ackLatencyBudgetMs !== 'number' || plan.ackLatencyBudgetMs > 500) {
      fail(
        'sync-handler-over-budget',
        'high',
        `processingModel is sync with ackLatencyBudgetMs ${plan.ackLatencyBudgetMs ?? 'unset'}: providers time out in 5-10s and retry, so slow synchronous work causes retry storms.`,
        'Verify + persist + ack in <500ms, then enqueue the heavy work for an async worker (processingModel: async-queue).'
      );
    }
  }

  // --- Gate: dead-letter escape hatch + replay tooling ---
  if (typeof plan.deadLetterAfterRetries !== 'number' || plan.deadLetterAfterRetries < 1) {
    fail(
      'no-dead-letter',
      'high',
      'deadLetterAfterRetries is not a positive number: one poison event retries forever and blocks the queue.',
      'After N (e.g. 5) failed attempts, write the event to a dead-letter table with the failure reason.'
    );
  } else if (plan.replayToolingExists !== true) {
    fail(
      'no-replay-tooling',
      'medium',
      'replayToolingExists is not true: dead-lettered events can be seen but not re-driven, so recovery is manual surgery.',
      'Build a UI or CLI that lists dead-lettered events and replays one by ID or a range by timestamp.'
    );
  }

  // --- Gate: reconcile from the source of truth ---
  if (plan.stateSource === 'event-payload') {
    fail(
      'state-from-event-payload',
      'high',
      'stateSource is event-payload: webhooks arrive out of order, so applying payloads directly leaves state inconsistent (cancel can precede create).',
      "Treat the webhook as a notification: fetch current state from the provider's API on each processing pass, or move to a real event-sourced model."
    );
  } else if (plan.stateSource !== undefined && !VALID_STATE_SOURCES.includes(plan.stateSource)) {
    fail(
      'invalid-state-source',
      'medium',
      `stateSource "${plan.stateSource}" is not one of: ${VALID_STATE_SOURCES.join(', ')}.`,
      'Declare where derived state comes from; provider-api is the safe default.'
    );
  }

  // --- Gate: per-environment secrets ---
  if (plan.perEnvironmentSecrets !== true) {
    fail(
      'shared-webhook-secrets',
      'medium',
      'perEnvironmentSecrets is not true: test and live endpoints sharing a secret means a test-mode leak forges production events.',
      'Use one secret per endpoint/environment (STRIPE_WEBHOOK_SECRET_TEST vs _LIVE) and fail CI if they match.'
    );
  }

  // --- Gate: idempotency proven by replay in CI ---
  if (plan.replayTestInCI !== true) {
    fail(
      'no-replay-test',
      'low',
      'replayTestInCI is not true: nothing proves the handler is idempotent under real retry traffic.',
      'Replay a captured event set twice in CI and assert the resulting DB state is identical.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still exercise it end-to-end: send a provider test event, retry it, and confirm exactly one side effect landed.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: webhook_receiver_design_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditWebhookReceiverDesign(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`webhook_receiver_design_audit: ${e.message}\n`);
    process.exit(1);
  }
}
