#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_PLATFORMS = ['supabase', 'd1'];
const VALID_ENVIRONMENTS = ['production', 'staging', 'local'];
const VALID_CONNECTIONS = ['direct-5432', 'pooler-6543', 'sql-editor', 'cli'];
const VALID_D1_TARGETS = ['remote', 'local'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a D1/Supabase migration plan against d1-and-supabase-migrations' core
 * rule — "the history says applied but the SQL never ran" is the most expensive
 * bug — and its Quality Gates. Rules operate on structured enum/boolean fields
 * only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/migration-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditMigrationPlan(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_PLATFORMS.includes(plan.platform)) {
    throw new TypeError(`plan.platform must be one of: ${VALID_PLATFORMS.join(', ')}`);
  }
  if (!VALID_ENVIRONMENTS.includes(plan.environment)) {
    throw new TypeError(`plan.environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
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

  // --- Gate: repair never runs before the SQL has actually executed ---
  if (plan.platform === 'supabase' && plan.repairPlanned === true && plan.sqlExecutedBeforeRepair !== true) {
    fail(
      'repair-before-sql-execution',
      'critical',
      'repairPlanned is true but sqlExecutedBeforeRepair is not: `supabase migration repair --status applied` only updates the history table — it does NOT run the SQL, so the history will claim "applied" while the table/column is missing.',
      'Run the migration SQL first (direct psql on port 5432 or the SQL editor), verify the schema with a real query, and only then mark the history with repair.'
    );
  }

  // --- Gate: verify against the schema, never the history ---
  if (plan.verificationQueryPlanned !== true) {
    fail(
      'no-schema-verification-query',
      'high',
      'verificationQueryPlanned is not true: without a SELECT against information_schema.columns / pragma_table_info, "applied" status is the only evidence the migration ran — and history rows lie.',
      "After applying, assert presence with a real query (e.g. SELECT count(*) FROM pragma_table_info('t') WHERE name = 'col'). Trust the schema, not the history."
    );
  }

  // --- Gate: Supabase migrations go over the direct connection, not the pooler ---
  if (plan.platform === 'supabase' && plan.connection !== undefined) {
    if (!VALID_CONNECTIONS.includes(plan.connection)) {
      fail(
        'invalid-connection-kind',
        'medium',
        `connection "${plan.connection}" is not one of: ${VALID_CONNECTIONS.join(', ')}.`,
        'Name the connection the migration will use so the pooler trap can be checked.'
      );
    } else if (plan.connection === 'pooler-6543') {
      fail(
        'pooler-connection-for-migration',
        'critical',
        "connection is 'pooler-6543': pgbouncer's transaction-pooling mode returns 'Tenant or user not found' or hangs, because migrations need advisory locks and prepared statements the pooler does not support.",
        'Use the direct connection on port 5432 (db.<ref>.supabase.co:5432) for migration scripts.'
      );
    }
  }

  // --- Gate: production D1 migrations must target --remote ---
  if (plan.platform === 'd1') {
    if (!VALID_D1_TARGETS.includes(plan.d1Target)) {
      fail(
        'd1-target-unspecified',
        'high',
        `d1Target must be one of: ${VALID_D1_TARGETS.join(', ')} — --local and --remote are different databases, and the default is local.`,
        'State the target explicitly; wrangler defaults to the local .wrangler/state database.'
      );
    } else if (plan.environment === 'production' && plan.d1Target === 'local') {
      fail(
        'local-apply-for-production',
        'critical',
        "environment is 'production' but d1Target is 'local': the migration will land in .wrangler/state/v3/d1/ and production will throw \"no such column\" on the first request.",
        'Apply production migrations with --remote, and add a CI check that the remote schema matches local before deploy.'
      );
    }
  }

  // --- Gate: no NOT NULL without default/backfill on a populated table ---
  if (plan.addsNotNullColumn === true && plan.tableHasRows === true && plan.hasDefaultOrBackfill !== true) {
    fail(
      'not-null-without-backfill',
      'critical',
      'addsNotNullColumn and tableHasRows are true but hasDefaultOrBackfill is not: the migration will fail with "column contains null values".',
      'Use the three-step pattern (add nullable -> backfill -> SET NOT NULL) or a single ADD COLUMN ... NOT NULL DEFAULT for small tables.'
    );
  }

  // --- Gate: migration files are immutable once applied anywhere ---
  if (plan.migrationFileEditedAfterApply === true) {
    fail(
      'migration-file-edited-after-apply',
      'high',
      'migrationFileEditedAfterApply is true: editing an already-applied migration guarantees drift between environments that ran the old text and ones that will run the new text.',
      'Never edit an applied migration; put the change in a new migration file.'
    );
  }

  // --- Gate: long migrations on hot tables must be batched ---
  if (plan.hotTableLongMigration === true && plan.batchedApproach !== true) {
    fail(
      'unbatched-hot-table-migration',
      'high',
      'hotTableLongMigration is true but batchedApproach is not: a single transaction rewriting a large hot table locks production for minutes.',
      'Postgres: CREATE INDEX CONCURRENTLY and batched UPDATEs in chunks of <= 10k rows; SQLite/D1: shadow table + atomic rename.'
    );
  }

  // --- Gate: forward-only, or a tested down-script ---
  if (plan.forwardOnly === false && plan.downScriptTested !== true) {
    fail(
      'untested-down-script',
      'medium',
      'forwardOnly is false but downScriptTested is not true: an untested down-script is a rollback that fails during the incident it exists for.',
      'Either declare the migration forward-only or actually run the down-script against a copy of the schema.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still confirm the post-apply verification query returns the expected shape before marking the migration done.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: migration_plan_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditMigrationPlan(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`migration_plan_audit: ${e.message}\n`);
    process.exit(1);
  }
}
