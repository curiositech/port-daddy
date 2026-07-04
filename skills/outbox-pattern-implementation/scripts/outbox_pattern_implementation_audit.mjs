#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARCHITECTURES = ['outbox-relay', 'dual-write', 'publish-first'];
const RELAY_TYPES = ['polling', 'cdc', 'none'];
const PRUNE_STRATEGIES = ['delete-after-publish', 'scheduled-delete', 'time-partitioning', 'none'];
const DEDUP_MECHANISMS = ['db-unique-constraint', 'redis', 'in-memory', 'none'];
const VOLUMES = ['low', 'high'];
const SCHEMA_FLAGS = ['schemaHasAggregateType', 'schemaHasAggregateId', 'schemaHasEventType', 'schemaHasPayload'];

function assertPlanObject(plan) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
}

/**
 * Audit a transactional-outbox plan against outbox-pattern-implementation's
 * Anti-patterns and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/outbox-pattern-implementation-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditOutboxPatternImplementation(plan) {
  assertPlanObject(plan);
  if (!ARCHITECTURES.includes(plan.architecture)) {
    throw new TypeError(`plan.architecture must be one of: ${ARCHITECTURES.join(', ')}`);
  }
  if (!RELAY_TYPES.includes(plan.relayType)) {
    throw new TypeError(`plan.relayType must be one of: ${RELAY_TYPES.join(', ')}`);
  }
  if (typeof plan.consumerIdempotent !== 'boolean') {
    throw new TypeError('plan.consumerIdempotent must be a boolean');
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

  // --- Gate 1: the dual-write hazard is the whole point ---
  if (plan.architecture === 'dual-write') {
    fail('dual-write-architecture', 'critical',
      'architecture is "dual-write": db.commit() then broker.publish() are two non-transactional commits; the first broker outage leaves the DB and downstream permanently inconsistent.',
      'Write the outbox row in the same transaction as the business row and let a relay publish it.');
  } else if (plan.architecture === 'publish-first') {
    fail('publish-before-commit', 'critical',
      'architecture is "publish-first": events fire for rows whose transaction later rolls back -- downstream sees orders that do not exist.',
      'Never publish before the DB commit; move to the outbox pattern.');
  }

  // --- Gate 2: outbox insert must ride the business transaction ---
  if (plan.architecture === 'outbox-relay' && plan.outboxWriteInBusinessTransaction !== true) {
    fail('outbox-write-outside-transaction', 'critical',
      'outboxWriteInBusinessTransaction is not true: an outbox insert on a separate connection/commit re-creates the dual-write hazard the pattern exists to remove.',
      'Pass the transaction object to the outbox insert; add a CI grep for outbox writes outside db.transaction.');
  }

  // --- Gate 3: an outbox with no relay never publishes ---
  if (plan.architecture === 'outbox-relay' && plan.relayType === 'none') {
    fail('outbox-without-relay', 'critical',
      'relayType is "none": rows accumulate in the outbox table and no event ever reaches the broker.',
      'Add a polling publisher or a Debezium CDC relay -- the outbox table alone delivers nothing.');
  }

  // --- Gate 4: polling relay mechanics ---
  if (plan.relayType === 'polling') {
    if (plan.usesSkipLocked !== true) {
      const many = typeof plan.relayInstances === 'number' && plan.relayInstances > 1;
      fail('polling-without-skip-locked', many ? 'critical' : 'high',
        `usesSkipLocked is not true${many ? ` with relayInstances=${plan.relayInstances}` : ''}: plain FOR UPDATE makes relay instances queue and deadlock under load.`,
        'Claim rows with FOR UPDATE SKIP LOCKED so each relay instance grabs a disjoint chunk.');
    }
    if (plan.partialUnpublishedIndex !== true) {
      fail('missing-partial-unpublished-index', 'high',
        'partialUnpublishedIndex is not true: every poll sequentially scans millions of historical rows.',
        'CREATE INDEX ... ON outbox (created_at) WHERE published_at IS NULL -- the unpublished set stays small.');
    }
  }

  // --- Gate 5: CDC relay slot monitoring ---
  if (plan.relayType === 'cdc' && plan.replicationSlotLagMonitored !== true) {
    fail('unmonitored-replication-slot', 'high',
      'replicationSlotLagMonitored is not true: a stalled Debezium slot pins the WAL, which grows until the disk fills.',
      'Monitor pg_replication_slots.confirmed_flush_lsn and alert on slot lag; if a consumer is dead, drop the slot and re-bootstrap.');
  }

  // --- Gate 6: at-least-once means the consumer MUST dedupe ---
  if (plan.consumerIdempotent !== true) {
    fail('consumer-not-idempotent', 'critical',
      'consumerIdempotent is not true: the relay can publish then crash before marking the row, so duplicates are guaranteed eventually -- double charges, double emails.',
      'Insert into a processed_events table with a unique constraint on (event_id, source) in the same transaction as the side effect.');
  } else if (DEDUP_MECHANISMS.includes(plan.dedupMechanism) && plan.dedupMechanism !== 'db-unique-constraint') {
    fail('dedup-not-db-constraint', 'high',
      `dedupMechanism is "${plan.dedupMechanism}": Redis or in-memory dedup is not transactional with the side effect, so a crash between them re-opens the duplicate window.`,
      'The DB unique constraint IS the idempotency primitive: insert-then-handle inside one transaction.');
  }

  // --- Gate 7: prune or drown ---
  if (!PRUNE_STRATEGIES.includes(plan.pruneStrategy) || plan.pruneStrategy === 'none') {
    fail('no-prune-strategy', 'high',
      'pruneStrategy is "none" (or unset): the outbox grows forever until the tablespace blows up and backups take hours.',
      'Time-partition and drop old partitions, or schedule DELETEs of published rows older than N hours.');
  } else if (VOLUMES.includes(plan.expectedVolume) && plan.expectedVolume === 'high' && plan.pruneStrategy !== 'time-partitioning') {
    fail('high-volume-row-deletes', 'medium',
      `expectedVolume is "high" but pruneStrategy is "${plan.pruneStrategy}": row-by-row deletes at high volume churn vacuum and bloat the table.`,
      'Use time-partitioning (pg_partman) so a whole month drops in O(1) with DROP TABLE.');
  }

  // --- Gate 8: canonical schema shape ---
  for (const flag of SCHEMA_FLAGS) {
    if (plan[flag] === false) {
      fail(`schema-missing-${flag.replace('schemaHas', '').toLowerCase()}`, 'medium',
        `${flag} is false: the canonical shape (aggregate_type, aggregate_id, event_type, payload) is what Debezium's EventRouter and topic/key routing assume.`,
        'Match the canonical outbox schema so routing (topic from aggregate_type, key from aggregate_id) works without custom SMTs.');
    }
  }

  // --- Gate 9: observability across the boundary ---
  if (plan.traceIdInOutboxRow !== true) {
    fail('no-trace-id-in-row', 'low',
      'traceIdInOutboxRow is not true: consumers cannot join their span back to the producing transaction.',
      'Carry trace_id in the outbox row and open a follower span in the consumer (see opentelemetry-instrumentation).');
  }
  if (plan.lagMetricsExported !== true) {
    fail('no-lag-metrics', 'medium',
      'lagMetricsExported is not true: nobody notices a stalled relay until downstream screams.',
      'Export outbox_unpublished_count and outbox_oldest_unpublished_age_seconds; alert on thresholds.');
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still run the chaos tests: kill the relay mid-publish and the producer mid-transaction, and replay events twice against the consumer.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: outbox_pattern_implementation_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditOutboxPatternImplementation(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`outbox_pattern_implementation_audit: ${e.message}\n`);
    process.exit(1);
  }
}
