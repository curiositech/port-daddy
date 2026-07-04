#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SYMPTOMS = [
  'slow-query',
  'plan-regression',
  'index-ignored',
  'dead-tuple-bloat',
  'disk-spill',
  'parameter-sniffing',
];
const VALID_FIXES = [
  'add-index',
  'partial-index',
  'expression-index',
  'covering-index',
  'drop-index',
  'analyze-stats',
  'raise-stats-target',
  'extended-statistics',
  'raise-work-mem',
  'force-custom-plan',
  'autovacuum-tuning',
  'rewrite-query',
  'none',
];
const VALID_ENVIRONMENTS = ['production', 'staging', 'dev'];
const VALID_SCANS = ['seq-scan', 'index-scan', 'index-only-scan', 'bitmap-heap-scan', 'unknown'];
const STATS_FIXES = ['analyze-stats', 'raise-stats-target', 'extended-statistics'];
const INDEX_BUILD_FIXES = ['add-index', 'partial-index', 'expression-index', 'covering-index'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Postgres query-tuning plan against postgres-explain-analyzer's
 * Quality Gates: capture the plan before touching anything, fix statistics
 * before adding indexes, never drop an index without evidence, build
 * CONCURRENTLY in production, and verify with a fresh EXPLAIN afterward.
 *
 * @param {unknown} plan - parsed JSON, see schemas/postgres-explain-analyzer-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditPostgresExplainAnalyzer(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_SYMPTOMS.includes(plan.symptom)) {
    throw new TypeError(`plan.symptom must be one of: ${VALID_SYMPTOMS.join(', ')}`);
  }
  if (!Array.isArray(plan.plannedFixes) || plan.plannedFixes.length === 0) {
    throw new TypeError('plan.plannedFixes must be a non-empty array');
  }
  for (const fix of plan.plannedFixes) {
    if (!VALID_FIXES.includes(fix)) {
      throw new TypeError(`plannedFixes entry "${fix}" must be one of: ${VALID_FIXES.join(', ')}`);
    }
  }
  if (typeof plan.explainCaptured !== 'boolean') {
    throw new TypeError('plan.explainCaptured must be a boolean');
  }
  if (plan.environment !== undefined && !VALID_ENVIRONMENTS.includes(plan.environment)) {
    throw new TypeError(`plan.environment must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
  }
  if (plan.scanType !== undefined && !VALID_SCANS.includes(plan.scanType)) {
    throw new TypeError(`plan.scanType must be one of: ${VALID_SCANS.join(', ')}`);
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

  const fixes = plan.plannedFixes;

  // Gate 1: never tune without a captured plan.
  if (plan.explainCaptured !== true) {
    fail(
      'no-captured-explain',
      'critical',
      'explainCaptured is not true: the plan proposes fixes without a captured EXPLAIN ANALYZE, i.e. guessing.',
      'Run EXPLAIN (ANALYZE, BUFFERS) against a live replica and attach the output before choosing any fix.'
    );
  } else if (plan.buffersIncluded !== true) {
    // Gate 2: "Run with BUFFERS so you see I/O. Always."
    fail(
      'explain-without-buffers',
      'high',
      'buffersIncluded is not true: the captured plan omits BUFFERS, hiding the shared hit/read I/O split.',
      'Re-capture with EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) — read-heavy buffers are the fastest tell for cache eviction.'
    );
  }

  // Gate 3: 10x-off estimates mean stale/insufficient stats; fix those first.
  if (typeof plan.estimateVsActualRatio === 'number' && plan.estimateVsActualRatio >= 10) {
    if (!fixes.some((f) => STATS_FIXES.includes(f))) {
      fail(
        'stale-stats-not-addressed',
        'high',
        `estimateVsActualRatio is ${plan.estimateVsActualRatio} (>= 10x off) but plannedFixes contain no statistics fix (${STATS_FIXES.join(', ')}).`,
        'ANALYZE the table (cheapest first move), raise the per-column statistics target, or add CREATE STATISTICS for correlated columns before adding indexes.'
      );
    }
  }

  // Gate 4: dropping an index requires justification + EXPLAIN evidence.
  if (fixes.includes('drop-index') && plan.indexDropJustified !== true) {
    fail(
      'unjustified-index-drop',
      'critical',
      'plannedFixes include drop-index but indexDropJustified is not true: dropping an index without idx_scan evidence and an EXPLAIN of affected queries is how the worked example\'s p99 cliff happened.',
      'Capture 30 days of pg_stat_user_indexes.idx_scan and an EXPLAIN showing affected queries hit another index before any DROP INDEX.'
    );
  }

  // Gate 5: index builds on production tables must be CONCURRENTLY.
  if (
    plan.environment === 'production' &&
    fixes.some((f) => INDEX_BUILD_FIXES.includes(f)) &&
    plan.usesConcurrently !== true
  ) {
    fail(
      'non-concurrent-index-in-prod',
      'high',
      'An index build is planned in production but usesConcurrently is not true: plain CREATE INDEX takes a lock that blocks writes for the duration.',
      'Use CREATE INDEX CONCURRENTLY for any production index build, as in the worked example.'
    );
  }

  // Gate 6: a disk-spilling sort must be addressed.
  if ((plan.sortSpillsToDisk === true || plan.symptom === 'disk-spill') && !fixes.includes('raise-work-mem') && !fixes.some((f) => INDEX_BUILD_FIXES.includes(f))) {
    fail(
      'disk-spill-unaddressed',
      'medium',
      'A Sort/Hash node spills to disk but plannedFixes neither raise work_mem nor add an ORDER-BY-supporting index.',
      'Raise work_mem for the query, or add an index matching the ORDER BY so the sort disappears; "Disk:" should be absent from p99 plans.'
    );
  }

  // Gate 7: dead-tuple blowup needs autovacuum tuning.
  if (typeof plan.deadTupleRatio === 'number' && plan.deadTupleRatio > 0.2 && !fixes.includes('autovacuum-tuning')) {
    fail(
      'vacuum-lag-unaddressed',
      'medium',
      `deadTupleRatio is ${plan.deadTupleRatio} (> 0.2) but plannedFixes do not include autovacuum-tuning.`,
      'Set per-table autovacuum_vacuum_scale_factor = 0.05, raise autovacuum_vacuum_cost_limit, and consider fillfactor = 80 for HOT updates.'
    );
  }

  // Gate 8: parameter sniffing gets the plan-cache fix, not an index.
  if (plan.symptom === 'parameter-sniffing' && !fixes.includes('force-custom-plan') && !fixes.includes('rewrite-query')) {
    fail(
      'sniffing-without-plan-cache-fix',
      'high',
      'symptom is parameter-sniffing but plannedFixes include neither force-custom-plan nor rewrite-query: a generic plan locked after 5 executions will not be fixed by another index.',
      'SET plan_cache_mode = force_custom_plan for the session, or rewrite the query to be selectivity-stable.'
    );
  }

  // Gate 9: a big-table Seq Scan needs an index-shaped or stats-shaped answer.
  if (
    plan.scanType === 'seq-scan' &&
    typeof plan.tableRowCount === 'number' &&
    plan.tableRowCount > 100000 &&
    !fixes.some((f) => INDEX_BUILD_FIXES.includes(f) || STATS_FIXES.includes(f) || f === 'rewrite-query')
  ) {
    fail(
      'big-table-seq-scan-unaddressed',
      'high',
      `scanType is seq-scan on a ${plan.tableRowCount}-row table but no index, statistics, or query-rewrite fix is planned.`,
      'Either add a selective (possibly partial) index, refresh statistics so the planner can find the existing one, or document why the seq scan is correct.'
    );
  }

  // Gate 10: verify after the fix.
  if (plan.verifiedAfterFix !== true) {
    fail(
      'no-post-fix-verification',
      'medium',
      'verifiedAfterFix is not true: the plan does not commit to re-running EXPLAIN after the fix.',
      'Re-run EXPLAIN (ANALYZE, BUFFERS) after applying the fix and confirm the expected node change before closing the incident.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still snapshot pg_stat_statements before and after so the fix is provable.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: postgres_explain_analyzer_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditPostgresExplainAnalyzer(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`postgres_explain_analyzer_audit: ${e.message}\n`);
    process.exit(1);
  }
}
