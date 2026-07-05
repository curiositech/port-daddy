#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const POOL_MODES = ['session', 'transaction', 'statement'];
const POOLERS = ['pgbouncer', 'supavisor', 'rds-proxy', 'none'];
const MIGRATION_FLUSHES = ['rolling-restart', 'discard-all', 'none'];
const SUPABASE_WORKLOADS = ['serverless', 'persistent'];
const SUPABASE_PORTS = [5432, 6543];
// The pgbouncer.org features table: session-only ("Never" in transaction mode) features.
const SESSION_ONLY_FEATURES = [
  ['usesListen', 'LISTEN'],
  ['usesSessionAdvisoryLocks', 'session-level advisory locks (pg_advisory_lock)'],
  ['usesWithHoldCursors', 'WITH HOLD cursors'],
  ['usesSessionSet', 'session-scoped SET/RESET'],
  ['usesSqlPrepare', 'SQL-level PREPARE/DEALLOCATE'],
];

function assertPlanObject(plan) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
}

/**
 * Audit a Postgres connection-pooling plan against postgres-connection-pooling's
 * decision rule (pool mode follows session-state usage) and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/postgres-connection-pooling-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditPostgresConnectionPooling(plan) {
  assertPlanObject(plan);
  if (!POOL_MODES.includes(plan.poolMode)) {
    throw new TypeError(`plan.poolMode must be one of: ${POOL_MODES.join(', ')}`);
  }
  if (!POOLERS.includes(plan.pooler)) {
    throw new TypeError(`plan.pooler must be one of: ${POOLERS.join(', ')}`);
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

  // --- Gate 1: transaction mode vs the "Never" features (pgBouncer/Supavisor) ---
  if (plan.poolMode === 'transaction' && (plan.pooler === 'pgbouncer' || plan.pooler === 'supavisor')) {
    const broken = SESSION_ONLY_FEATURES.filter(([field]) => plan[field] === true).map(([, label]) => label);
    if (broken.length > 0) {
      fail('session-feature-in-transaction-mode', 'critical',
        `poolMode is transaction but the app uses session-only features: ${broken.join('; ')}. These break silently -- the pgBouncer feature table marks them "Never" in transaction mode.`,
        'Move to session mode, or refactor the dependency away (SET LOCAL inside transactions, transaction-level advisory locks, polling instead of LISTEN).');
    }
  }

  // --- Gate 2: statement mode disallows multi-statement transactions ---
  if (plan.poolMode === 'statement' && plan.usesMultiStatementTransactions === true) {
    fail('multi-statement-txn-in-statement-mode', 'critical',
      'poolMode is statement but usesMultiStatementTransactions is true: statement mode enforces autocommit; multi-statement transactions are disallowed.',
      'Use transaction mode (or session mode); statement mode is meant for PL/Proxy-style autocommit workloads only.');
  }

  // --- Gate 3: prepared statements vs the pooler's ability to track them ---
  if (plan.usesProtocolPreparedStatements === true && plan.poolMode === 'transaction') {
    if (plan.pooler === 'pgbouncer') {
      if (plan.poolerTracksPreparedStatements !== true) {
        fail('prepared-statements-untracked-pooler', 'high',
          'usesProtocolPreparedStatements is true but poolerTracksPreparedStatements is not: pre-1.21 pgBouncer cannot replay prepared statements across server connections.',
          'Upgrade to pgBouncer >= 1.21 (1.22+ defaults max_prepared_statements=200), or disable client-side named prepared statements (prepare:false / statement_cache_size=0).');
      } else if (!(typeof plan.maxPreparedStatements === 'number' && plan.maxPreparedStatements >= 1)) {
        fail('max-prepared-statements-zero', 'high',
          'poolerTracksPreparedStatements is true but maxPreparedStatements is not >= 1: with the knob at 0 the support is off and prepared statements break in transaction mode.',
          'Set max_prepared_statements to a non-zero value (>= 200 recommended).');
      }
    }
    if (plan.pooler === 'rds-proxy') {
      fail('prepared-statements-pin-rds-proxy', 'high',
        'usesProtocolPreparedStatements is true behind RDS Proxy: PREPARE/EXECUTE/DEALLOCATE pin the session, silently reverting to session-mode concurrency.',
        'Disable client-side named prepared statements for RDS Proxy (prepare:false, statement_cache_size=0, ?pgbouncer=true for Prisma).');
    }
  }

  // --- Gate 4: idle-in-transaction timeout is the leak stopper ---
  if (!(typeof plan.idleInTransactionTimeoutSeconds === 'number' && plan.idleInTransactionTimeoutSeconds > 0)) {
    fail('idle-in-transaction-timeout-disabled', 'high',
      'idleInTransactionTimeoutSeconds is not > 0: the Postgres default (0) lets leaked open transactions hold locks and block vacuum, causing unbounded bloat.',
      "Set idle_in_transaction_session_timeout = '60s' cluster-wide and alert on the pg_stat_activity leak query.");
  }

  // --- Gate 5: idle_session_timeout fights the pooler ---
  if (plan.idleSessionTimeoutEnabled === true && plan.pooler !== 'none') {
    fail('idle-session-timeout-behind-pooler', 'medium',
      'idleSessionTimeoutEnabled is true with a pooler in front: the pool holds idle server connections by design, and the disconnect storms mask real problems.',
      'Disable idle_session_timeout when pgBouncer/Supavisor/RDS Proxy fronts the database; rely on pool-side server_idle_timeout instead.');
  }

  // --- Gate 6: RDS Proxy pinning mitigations ---
  if (plan.pooler === 'rds-proxy') {
    if (plan.usesSessionSet === true && plan.initQueryForSessionState !== true) {
      fail('rds-proxy-set-without-initquery', 'high',
        'usesSessionSet is true behind RDS Proxy without initQueryForSessionState: every SET pins the session (Postgres has no pinning filters), capping effective concurrency.',
        "Move identical per-connection SET statements (search_path, timezone, application_name) into the proxy's InitQuery.");
    }
    if (plan.usesTempTables === true) {
      fail('rds-proxy-temp-objects-pin', 'high',
        'usesTempTables is true behind RDS Proxy: temporary sequences/tables/views pin the session for its lifetime.',
        'Replace CREATE TEMP TABLE patterns with CTEs or transient real tables with a random suffix.');
    }
    if (plan.pinnedSessionAlarm !== true) {
      fail('no-pinned-session-alarm', 'medium',
        'pinnedSessionAlarm is not true: heavy pinning silently reverts the proxy to session-mode concurrency with nobody watching.',
        'Alarm on the CloudWatch metric DatabaseConnectionsCurrentlySessionPinned before it approaches max_connections.');
    }
  }

  // --- Gate 7: migration runbook must flush cached plans ---
  if (plan.usesProtocolPreparedStatements === true && plan.poolMode === 'transaction') {
    if (!(MIGRATION_FLUSHES.includes(plan.migrationPlanFlush) && plan.migrationPlanFlush !== 'none')) {
      fail('no-cached-plan-flush-in-migrations', 'medium',
        'migrationPlanFlush is "none" (or unset): after a column-altering migration, long-lived pooled backends throw "cached plan must not change result type" until restarted.',
        'Add a rolling restart or a DISCARD ALL step (pgBouncer forwards it) to the migration runbook.');
    }
  }

  // --- Gate 8: Supabase port must match the workload class ---
  if (SUPABASE_WORKLOADS.includes(plan.supabaseWorkload) && SUPABASE_PORTS.includes(plan.supabasePort)) {
    if (plan.supabaseWorkload === 'serverless' && plan.supabasePort === 5432) {
      fail('serverless-on-session-port', 'high',
        'supabaseWorkload is serverless on port 5432: every cold-started function holds a full session-mode backend and the shared max_connections budget exhausts under burst.',
        'Point serverless/edge workloads at Supavisor transaction mode on port 6543 (with prepare:false where the client needs it); reserve 5432 for persistent backends.');
    }
  }

  // --- Gate 9: no pooler at high concurrency ---
  if (plan.pooler === 'none' && typeof plan.expectedConcurrentClients === 'number' && plan.expectedConcurrentClients > 100) {
    fail('no-pooler-at-high-concurrency', 'high',
      `pooler is "none" with expectedConcurrentClients=${plan.expectedConcurrentClients}: each client holds a full Postgres backend, and raising max_connections just moves the cliff.`,
      'Put pgBouncer/Supavisor in front and pick the pool mode from the session-state decision diagram, not from raw concurrency.');
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still run the app\'s full smoke suite against the pooler in the chosen mode -- it is the only reliable way to catch a stray LISTEN or advisory lock.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: postgres_connection_pooling_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditPostgresConnectionPooling(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`postgres_connection_pooling_audit: ${e.message}\n`);
    process.exit(1);
  }
}
