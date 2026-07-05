#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_ENGINES = ['postgres', 'mysql'];
const VALID_CHANGE_TYPES = ['add-column', 'rename-column', 'add-index', 'add-foreign-key', 'type-change', 'drop-column', 'split-table', 'not-null'];
const BREAKING_CHANGE_TYPES = ['rename-column', 'type-change', 'drop-column', 'split-table', 'not-null'];
const CONTRACTING_CHANGE_TYPES = ['rename-column', 'drop-column', 'split-table', 'type-change'];
const VALID_MYSQL_TOOLS = ['gh-ost', 'pt-online-schema-change', 'native-alter'];
const SEVERITY_WEIGHTS = { critical: 30, high: 15, medium: 8, low: 3 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a live-database migration plan against zero-downtime-database-migration's
 * expand/migrate/contract sequence and Quality Gates. Structured fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/zero-downtime-database-migration-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditZeroDowntimeDatabaseMigration(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_ENGINES.includes(plan.engine)) {
    throw new TypeError(`plan.engine must be one of: ${VALID_ENGINES.join(', ')}`);
  }
  if (!VALID_CHANGE_TYPES.includes(plan.changeType)) {
    throw new TypeError(`plan.changeType must be one of: ${VALID_CHANGE_TYPES.join(', ')}`);
  }
  if (typeof plan.deployPhases !== 'number' || !Number.isFinite(plan.deployPhases)) {
    throw new TypeError('plan.deployPhases must be a number');
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

  // --- Gate: breaking changes need >= 3 deploys (expand -> migrate -> contract) ---
  if (BREAKING_CHANGE_TYPES.includes(plan.changeType) && plan.deployPhases < 3) {
    fail(
      'breaking-change-in-single-deploy',
      'critical',
      `changeType ${plan.changeType} with deployPhases ${plan.deployPhases}: during a rolling deploy, old and new pods disagree on the schema and flap with "column does not exist".`,
      'Split into expand -> migrate/backfill -> contract: three deploys minimum. There is no shortcut that is safe under traffic.'
    );
  }

  // --- Gate: lock_timeout on every migration session ---
  if (typeof plan.lockTimeoutSeconds !== 'number' || plan.lockTimeoutSeconds <= 0) {
    fail(
      'no-lock-timeout',
      'critical',
      'lockTimeoutSeconds is unset or 0 (wait forever): if the DDL queues behind a long transaction, every subsequent SELECT and UPDATE queues behind the DDL — the table goes dark.',
      "SET lock_timeout = '2s' (or less) at the top of every migration; have the runner retry with backoff."
    );
  } else if (plan.lockTimeoutSeconds > 5) {
    fail(
      'lock-timeout-too-long',
      'medium',
      `lockTimeoutSeconds is ${plan.lockTimeoutSeconds}: the lock-queue blackout window is bounded by this value; anything past a few seconds is a visible stall.`,
      'Use a lock_timeout under ~2 seconds and retry with backoff instead of waiting longer.'
    );
  }

  // --- Gate: Postgres index builds must be CONCURRENTLY ---
  if (plan.engine === 'postgres' && plan.changeType === 'add-index' && plan.indexCreatedConcurrently !== true) {
    fail(
      'create-index-without-concurrently',
      'critical',
      'add-index on postgres with indexCreatedConcurrently not true: plain CREATE INDEX takes ACCESS EXCLUSIVE and blocks every read and write for the whole build.',
      'Use CREATE INDEX CONCURRENTLY (outside a transaction block); on an aborted build, DROP INDEX CONCURRENTLY and retry.'
    );
  }

  // --- Gate: Postgres FK adds use NOT VALID then VALIDATE ---
  if (plan.engine === 'postgres' && plan.changeType === 'add-foreign-key' && plan.fkUsesNotValidThenValidate !== true) {
    fail(
      'fk-add-without-not-valid',
      'high',
      'add-foreign-key with fkUsesNotValidThenValidate not true: default FK validation scans the whole table under lock — the scan is the outage.',
      'Two steps: ADD CONSTRAINT ... NOT VALID (brief lock, no scan), then VALIDATE CONSTRAINT (SHARE UPDATE EXCLUSIVE only).'
    );
  }

  // --- Gates: backfill discipline ---
  if (plan.backfillRequired === true) {
    if (typeof plan.backfillBatchSize !== 'number' || plan.backfillBatchSize <= 0) {
      fail(
        'single-statement-backfill',
        'critical',
        'backfillRequired is true but backfillBatchSize is not a positive number: a single UPDATE over the table locks rows for hours and drives replication lag past the SLO.',
        'Batch in 1k-10k rows with pg_sleep between batches, run in a separate session from the migration tool.'
      );
    } else {
      if (plan.backfillBatchSize > 10000) {
        fail(
          'backfill-batches-too-large',
          'medium',
          `backfillBatchSize is ${plan.backfillBatchSize}: batches past ~10k rows hold row locks long enough to contend with live writes and lag replicas.`,
          'Keep batches at 1k-10k rows.'
        );
      }
      if (plan.backfillUsesSkipLocked !== true) {
        fail(
          'backfill-without-skip-locked',
          'medium',
          'backfillUsesSkipLocked is not true: parallel backfills (or backfill + live writes) will deadlock or contend on the same rows.',
          'Select batch rows FOR UPDATE SKIP LOCKED.'
        );
      }
      if (plan.backfillSleepBetweenBatches !== true) {
        fail(
          'backfill-without-throttle',
          'high',
          'backfillSleepBetweenBatches is not true: without a sleep between batches, replication lag climbs until read replicas fall behind the SLO.',
          'Add pg_sleep(0.1) (or engine equivalent) between batches; the throttle is non-negotiable on a high-write table.'
        );
      }
    }
    if (plan.replicaLagMonitored !== true) {
      fail(
        'replica-lag-not-monitored',
        'medium',
        'backfillRequired is true but replicaLagMonitored is not: nothing pauses the backfill when replicas start falling behind.',
        'Watch replica lag during the whole backfill and pause when the SLO is threatened.'
      );
    }
  }

  // --- Gate: dual writes behind a feature flag ---
  if (plan.dualWritesPlanned === true && plan.dualWriteFeatureFlagged !== true) {
    fail(
      'dual-write-not-flagged',
      'high',
      'dualWritesPlanned is true but dualWriteFeatureFlagged is not: when the migration goes wrong mid-flight, turning dual-write off requires a redeploy.',
      'Gate the dual-write behind a feature flag so it can be toggled off without deploying.'
    );
  }

  // --- Gates: verification + rollback before the irreversible step ---
  if (CONTRACTING_CHANGE_TYPES.includes(plan.changeType) && plan.verificationBeforeContract !== true) {
    fail(
      'contract-without-verification',
      'high',
      `changeType ${plan.changeType} with verificationBeforeContract not true: dropping the old column/table is irreversible, and nothing proved OLD and NEW agree.`,
      'Before contracting: row counts match, sampled IS DISTINCT FROM diff returns nothing, error rate flat, replica lag normal.'
    );
  }
  if (plan.rollbackPlanDocumented !== true) {
    fail(
      'no-rollback-plan',
      'medium',
      'rollbackPlanDocumented is not true: mid-migration failures then get improvised at 2am.',
      'Document per-phase rollback before deploying; for dual-writes it is "stop reading from new, keep dual-writing" — no data loss.'
    );
  }

  // --- Gates: MySQL tool selection reality check ---
  if (plan.engine === 'mysql') {
    if (plan.mysqlTool !== undefined && !VALID_MYSQL_TOOLS.includes(plan.mysqlTool)) {
      fail(
        'invalid-mysql-tool',
        'medium',
        `mysqlTool "${plan.mysqlTool}" is not one of: ${VALID_MYSQL_TOOLS.join(', ')}.`,
        'Pick gh-ost or pt-online-schema-change based on FK and binlog-format reality.'
      );
    }
    if (plan.mysqlTool === 'gh-ost') {
      if (plan.tableHasForeignKeys === true) {
        fail(
          'ghost-on-fk-table',
          'critical',
          'mysqlTool is gh-ost but tableHasForeignKeys is true: gh-ost does not support foreign keys.',
          'Use pt-online-schema-change for tables with foreign keys.'
        );
      }
      if (plan.binlogFormatRow !== true) {
        fail(
          'ghost-without-row-binlog',
          'high',
          'mysqlTool is gh-ost but binlogFormatRow is not true: gh-ost requires ROW-based binary logging to capture changes.',
          'Switch to ROW binlog format or use pt-online-schema-change.'
        );
      }
    }
    if (plan.mysqlTool === 'native-alter' && typeof plan.tableRowCount === 'number' && plan.tableRowCount > 1_000_000) {
      fail(
        'native-alter-on-big-table',
        'high',
        `mysqlTool is native-alter on a table of ${plan.tableRowCount} rows: MySQL ALTER TABLE historically copies the table under a write lock.`,
        'Use gh-ost or pt-online-schema-change for million-plus-row MySQL tables.'
      );
    }
  }

  // --- Gate: rehearsal on a production snapshot ---
  if (plan.rehearsedOnSnapshot !== true) {
    fail(
      'not-rehearsed-on-snapshot',
      'medium',
      'rehearsedOnSnapshot is not true: the longest lock hold time is unknown until it happens in production.',
      'Rehearse on a production snapshot and time every step; if anything holds ACCESS EXCLUSIVE > 5 seconds, redesign.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still dry-run the rolling deploy in staging with two app versions live and watch replica lag through the whole backfill.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: zero_downtime_database_migration_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditZeroDowntimeDatabaseMigration(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`zero_downtime_database_migration_audit: ${e.message}\n`);
    process.exit(1);
  }
}
