#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_GUARANTEES = ['at-most-once', 'at-least-once', 'exactly-once'];
const VALID_STRATEGIES = ['range', 'round-robin', 'sticky', 'cooperative-sticky', 'kip848-server-side'];
const VALID_PROTOCOLS = ['classic', 'consumer'];
const VALID_TXN_ID_STRATEGIES = ['stable-per-instance', 'random', 'shared'];
const VALID_DLQ_PATTERNS = ['stop-on-error', 'dead-letter-queue', 'retry-topic', 'ordered-redirect', 'none'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Kafka consumer-group design plan against this skill's protocol-level
 * rules: commit mode vs delivery guarantee, assignment strategy vs rebalance
 * protocol, the poll-budget math, EOS building blocks, and DLQ-vs-ordering.
 * Rules operate on structured/enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/kafka-consumer-group-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditKafkaConsumerGroupDesign(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_GUARANTEES.includes(plan.deliveryGuarantee)) {
    throw new TypeError(`plan.deliveryGuarantee must be one of: ${VALID_GUARANTEES.join(', ')}`);
  }
  if (typeof plan.autoCommit !== 'boolean') {
    throw new TypeError('plan.autoCommit must be a boolean');
  }
  if (!VALID_STRATEGIES.includes(plan.assignmentStrategy)) {
    throw new TypeError(`plan.assignmentStrategy must be one of: ${VALID_STRATEGIES.join(', ')}`);
  }

  const groupProtocol = plan.groupProtocol ?? 'classic';
  if (!VALID_PROTOCOLS.includes(groupProtocol)) {
    throw new TypeError(`plan.groupProtocol must be one of: ${VALID_PROTOCOLS.join(', ')}`);
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

  // --- Gate 1: auto-commit is never the right default outside at-most-once ---
  if (plan.autoCommit === true && plan.deliveryGuarantee !== 'at-most-once') {
    fail(
      'auto-commit-with-stronger-guarantee',
      'critical',
      `autoCommit is true with deliveryGuarantee "${plan.deliveryGuarantee}": auto-commit is read-then-process-OR-process-then-read depending on poll timing — semantically nondeterministic, so it delivers neither at-least-once nor exactly-once.`,
      'Set enable.auto.commit=false and commit manually after successful processing (or use transactions for exactly-once).'
    );
  }

  // --- Gate 2: at-least-once requires an idempotent sink ---
  if (plan.deliveryGuarantee === 'at-least-once' && plan.processingIdempotent !== true) {
    fail(
      'at-least-once-without-idempotent-sink',
      'high',
      'deliveryGuarantee is at-least-once but processingIdempotent is not true: reprocessing after a crash-before-commit will duplicate side effects.',
      'Make the sink idempotent (pair with the idempotency-key-patterns skill) or move to exactly-once transactions.'
    );
  }

  // --- Gate 3: exactly-once needs all three building blocks, inside Kafka only ---
  if (plan.deliveryGuarantee === 'exactly-once') {
    if (plan.transactionalIdStrategy !== undefined && !VALID_TXN_ID_STRATEGIES.includes(plan.transactionalIdStrategy)) {
      fail(
        'invalid-transactional-id-strategy',
        'medium',
        `transactionalIdStrategy "${plan.transactionalIdStrategy}" is not one of: ${VALID_TXN_ID_STRATEGIES.join(', ')}.`,
        'Declare the transactional.id strategy so fencing behavior can be audited.'
      );
    } else if (plan.transactionalIdStrategy !== 'stable-per-instance') {
      fail(
        'unstable-transactional-id',
        'critical',
        `transactionalIdStrategy is "${plan.transactionalIdStrategy ?? 'undeclared'}": a shared id makes instances fence each other (ProducerFenced aborts); a random id defeats zombie fencing entirely.`,
        'Derive transactional.id deterministically from stable instance identity (hostname + ordinal, or Streams application.id + task-id).'
      );
    }
    if (plan.isolationLevelReadCommitted !== true) {
      fail(
        'missing-read-committed',
        'high',
        'deliveryGuarantee is exactly-once but isolationLevelReadCommitted is not true: downstream consumers will read aborted transactions.',
        'Set isolation.level=read_committed on every consumer of the output topics.'
      );
    }
    if (plan.sendOffsetsToTransaction !== true) {
      fail(
        'offsets-outside-transaction',
        'critical',
        'deliveryGuarantee is exactly-once but sendOffsetsToTransaction is not true: committing offsets outside the producer transaction reopens the duplicate/loss window the transaction exists to close.',
        'Commit offsets via producer.sendOffsetsToTransaction(consumer.groupMetadata()) inside the same transaction as the output records.'
      );
    }
    if (plan.crossSystemSideEffects === true) {
      fail(
        'eos-across-system-boundary',
        'critical',
        'crossSystemSideEffects is true: Kafka transactions do NOT extend to external databases or APIs — the plan claims exactly-once across a boundary the protocol cannot cover.',
        'Use the outbox pattern for Kafka↔database consistency; keep EOS claims to consume-transform-produce inside Kafka.'
      );
    }
  }

  // --- Gate 4: assignment strategy vs protocol ---
  if (groupProtocol === 'classic' && plan.assignmentStrategy === 'kip848-server-side') {
    fail(
      'server-side-assignor-on-classic',
      'high',
      'assignmentStrategy is kip848-server-side but groupProtocol is classic: server-side assignors only exist under group.protocol=consumer (Kafka 4.0+).',
      'Either set group.protocol=consumer on 4.0+ brokers, or pick a classic assignor (CooperativeStickyAssignor).'
    );
  }
  if (groupProtocol === 'classic' && plan.assignmentStrategy === 'round-robin') {
    fail(
      'round-robin-assignor',
      'high',
      'assignmentStrategy is round-robin: it makes no attempt to be sticky, so every membership change reshuffles the entire assignment — cooperative rebalancing degenerates back to eager, with more rebalances.',
      'Use CooperativeStickyAssignor (or RangeAssignor if co-partitioned joins require it).'
    );
  }
  if (groupProtocol === 'consumer') {
    if (plan.usesClientSideAssignor === true) {
      fail(
        'client-assignor-on-next-gen',
        'high',
        'groupProtocol is consumer (KIP-848) but usesClientSideAssignor is true: client-side assignors are not supported as of Kafka 4.0 (KAFKA-18327).',
        'Stay on the classic protocol until client-side assignor support lands, or adopt the server-side uniform/range assignors.'
      );
    }
    if (plan.assignmentStrategy !== 'kip848-server-side') {
      fail(
        'classic-assignor-config-under-kip848',
        'medium',
        `assignmentStrategy is "${plan.assignmentStrategy}" under group.protocol=consumer: partition.assignment.strategy is disabled by the next-gen protocol; the server-side assignor governs.`,
        'Declare assignmentStrategy as kip848-server-side and configure group.consumer.assignors on the broker instead.'
      );
    }
  }

  // --- Gate 5: the poll budget must clear max.poll.interval.ms with 50%+ headroom ---
  if (
    typeof plan.maxPollRecords === 'number' &&
    typeof plan.perRecordProcessingMs === 'number' &&
    typeof plan.maxPollIntervalMs === 'number'
  ) {
    const worstCaseBatchMs = plan.maxPollRecords * plan.perRecordProcessingMs;
    if (worstCaseBatchMs * 2 > plan.maxPollIntervalMs) {
      fail(
        'poll-budget-exceeds-interval',
        'high',
        `maxPollRecords(${plan.maxPollRecords}) × perRecordProcessingMs(${plan.perRecordProcessingMs}) = ${worstCaseBatchMs}ms per batch, which does not clear maxPollIntervalMs(${plan.maxPollIntervalMs}) with 50% headroom — a slow batch triggers a rebalance storm.`,
        'Lower max.poll.records or raise max.poll.interval.ms so the worst-case batch takes less than half the interval.'
      );
    }
  } else {
    fail(
      'poll-budget-undeclared',
      'medium',
      'maxPollRecords, perRecordProcessingMs, and maxPollIntervalMs are not all declared: the poll-budget math (the #1 rebalance-storm cause) cannot be checked.',
      'Measure per-record processing time and declare all three so the budget is auditable.'
    );
  }

  // --- Gate 6: poison messages must not stall the topic ---
  const dlqPattern = plan.dlqPattern ?? 'none';
  if (!VALID_DLQ_PATTERNS.includes(dlqPattern)) {
    fail(
      'invalid-dlq-pattern',
      'medium',
      `dlqPattern "${dlqPattern}" is not one of: ${VALID_DLQ_PATTERNS.join(', ')}.`,
      'Pick one of the four documented error-handling patterns (or stop-on-error, deliberately).'
    );
  } else if (dlqPattern === 'none') {
    fail(
      'no-poison-message-plan',
      'high',
      'dlqPattern is none: a single poison message will block its partition forever, lag climbs, and oncall gets paged at 3am.',
      'Adopt a DLQ, retry-topic, or ordered-redirect pattern; reserve stop-on-error for ledgers where manual intervention is the requirement.'
    );
  }

  // --- Gate 7: ordering requirement vs DLQ pattern ---
  if (plan.perEntityOrderingRequired === true && (dlqPattern === 'dead-letter-queue' || dlqPattern === 'retry-topic')) {
    fail(
      'ordering-broken-by-dlq-pattern',
      'high',
      `perEntityOrderingRequired is true but dlqPattern is "${dlqPattern}": once event #1 for an entity detours to the error path, event #2 processes ahead of it — per-entity order is silently violated.`,
      'Use the ordered-redirect pattern (in-memory map of in-flight retries by key, rebuilt from the redirect topic on restart) or stop-on-error.'
    );
  }

  // --- Gate 8: commit offsets on partition revocation (manual-commit mode) ---
  if (plan.autoCommit === false && plan.commitsInOnPartitionsRevoked !== true) {
    fail(
      'no-commit-on-revocation',
      'medium',
      'autoCommit is false but commitsInOnPartitionsRevoked is not true: offsets processed since the last commit are replayed by the next assignee on every rebalance.',
      'Commit current offsets inside ConsumerRebalanceListener.onPartitionsRevoked.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Design clears every gate this skill checks. Still verify per-partition lag monitoring is wired (single hot partitions hide in aggregate averages) before calling it production-ready.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: kafka_consumer_group_design_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditKafkaConsumerGroupDesign(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`kafka_consumer_group_design_audit: ${e.message}\n`);
    process.exit(1);
  }
}
