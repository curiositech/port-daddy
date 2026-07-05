#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_RSS_PATTERNS = ['monotonic', 'plateau', 'sawtooth', 'flat-rss-heap-climbing', 'periodic-spike'];
const VALID_TECHNIQUES = ['two-snapshot-diff', 'allocation-sampling', 'clinic-doctor', 'raise-max-old-space', 'scheduled-restart'];
const VALID_SNAPSHOT_TARGETS = ['busy-primary', 'canary', 'drained-replica', 'local-repro'];
const REQUIRED_METRICS = ['heap_used', 'heap_total', 'rss', 'external'];
const VALID_METRICS = [...REQUIRED_METRICS, 'arrayBuffers'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Node.js leak-hunt plan against this skill's playbook: confirm the
 * leak shape before chasing it, never mask with restarts or a raised heap
 * ceiling, drive load between the two snapshots, don't pause the busy primary,
 * and track all four memory metrics. Rules operate on structured/enum/boolean
 * fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/leak-hunt-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditNodeMemoryLeakHunting(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (typeof plan.leakConfirmed !== 'boolean') {
    throw new TypeError('plan.leakConfirmed must be a boolean');
  }
  if (!VALID_RSS_PATTERNS.includes(plan.rssPattern)) {
    throw new TypeError(`plan.rssPattern must be one of: ${VALID_RSS_PATTERNS.join(', ')}`);
  }
  if (!VALID_TECHNIQUES.includes(plan.plannedTechnique)) {
    throw new TypeError(`plan.plannedTechnique must be one of: ${VALID_TECHNIQUES.join(', ')}`);
  }
  if (plan.metricsTracked !== undefined && !Array.isArray(plan.metricsTracked)) {
    throw new TypeError('plan.metricsTracked must be an array of metric names when present');
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

  const { rssPattern, plannedTechnique } = plan;

  // --- Gate 1: never mask the leak ---
  if (plannedTechnique === 'scheduled-restart') {
    fail(
      'restart-as-fix',
      'critical',
      'plannedTechnique is scheduled-restart: a cron restart hides the leak, mutes alerting, and cold-starts every cache — it is the anti-pattern this skill opens with.',
      'Take a two-snapshot diff during the day and find the actual retainer instead.'
    );
  }
  if (plannedTechnique === 'raise-max-old-space' && rssPattern === 'monotonic') {
    fail(
      'ceiling-raise-on-monotonic-growth',
      'critical',
      'plannedTechnique is raise-max-old-space while rssPattern is monotonic: raising the ceiling on unbounded growth just pushes the OOM out by a few hours.',
      'Confirm growth is bounded with a two-snapshot diff first; raise --max-old-space-size only for a legitimate larger working set (plateau shape).'
    );
  }
  if (plan.scheduledRestartMasking === true) {
    fail(
      'existing-restart-cron-unexplained',
      'high',
      'scheduledRestartMasking is true: an existing scheduled restart is hiding the leak; any diagnosis made without removing or explaining it is built on masked data.',
      'Investigate the leak the restart papers over; either confirm it fixed or document why the restart stays.'
    );
  }

  // --- Gate 2: confirm the leak shape before chasing it ---
  if (rssPattern === 'plateau' && plan.leakConfirmed === true) {
    fail(
      'plateau-misread-as-leak',
      'high',
      'rssPattern is plateau but leakConfirmed is true: RSS climbing to a ceiling and flattening is V8 reaching --max-old-space-size, not a leak.',
      'Re-read the confirm-before-chasing table; only monotonic or flat-rss-heap-climbing shapes justify a snapshot hunt.'
    );
  }
  if (rssPattern === 'periodic-spike' && plannedTechnique === 'two-snapshot-diff') {
    fail(
      'periodic-spike-snapshot-hunt',
      'medium',
      'rssPattern is periodic-spike with a two-snapshot-diff plan: recurring spikes point at a batch/cron job allocating transiently, not long-lived retained state.',
      'Look at the periodic job first; snapshot-diff the long-lived process only if growth persists between runs.'
    );
  }

  // --- Gate 3: the two-snapshot diff is meaningless without load between snapshots ---
  if (plannedTechnique === 'two-snapshot-diff' && plan.loadDrivenBetweenSnapshots !== true) {
    fail(
      'no-load-between-snapshots',
      'critical',
      'plannedTechnique is two-snapshot-diff but loadDrivenBetweenSnapshots is not true: without exercising the suspect path between snapshots the diff is just GC variance noise.',
      'Drive the suspect path (k6, curl loop, real traffic) for several minutes between snapshot 1 and snapshot 2.'
    );
  }

  // --- Gate 4: don't pause the busy primary ---
  if (plan.snapshotTarget !== undefined && !VALID_SNAPSHOT_TARGETS.includes(plan.snapshotTarget)) {
    fail(
      'invalid-snapshot-target',
      'medium',
      `snapshotTarget "${plan.snapshotTarget}" is not one of: ${VALID_SNAPSHOT_TARGETS.join(', ')}.`,
      'Declare where the snapshot will be taken so the pause blast-radius can be audited.'
    );
  } else if (plannedTechnique === 'two-snapshot-diff' && plan.snapshotTarget === 'busy-primary') {
    fail(
      'snapshot-on-busy-primary',
      'high',
      'snapshotTarget is busy-primary: writeHeapSnapshot() is synchronous and walks the whole heap — a multi-GB heap pauses the event loop for seconds and 503s live traffic.',
      'Snapshot a canary or a pod drained from rotation; use allocation sampling if only the primary reproduces.'
    );
  }

  // --- Gate 5: all four memory metrics must be tracked ---
  if (Array.isArray(plan.metricsTracked)) {
    const unknown = plan.metricsTracked.filter((m) => !VALID_METRICS.includes(m));
    if (unknown.length > 0) {
      fail(
        'unknown-metric-names',
        'medium',
        `metricsTracked contains unrecognized entries: ${unknown.join(', ')}. Valid: ${VALID_METRICS.join(', ')}.`,
        'Use the process.memoryUsage() field names verbatim.'
      );
    }
    const missing = REQUIRED_METRICS.filter((m) => !plan.metricsTracked.includes(m));
    if (missing.length > 0) {
      fail(
        'incomplete-memory-metrics',
        'high',
        `metricsTracked is missing: ${missing.join(', ')}. A flat heap_used with climbing external (Buffers) — or a capped heap_total — is invisible without all four.`,
        'Export heap_used, heap_total, rss, and external (plus arrayBuffers on Node 13+) to the metrics backend.'
      );
    }
  } else {
    fail(
      'metrics-undeclared',
      'medium',
      'metricsTracked is not declared: without the four memoryUsage() series the leak shape cannot be confirmed or the fix verified.',
      'Wire process.memoryUsage() to the metrics exporter before starting the hunt.'
    );
  }

  // --- Gate 6: retainer chains must point at real source ---
  if (plan.sourceMapsEnabled !== true) {
    fail(
      'no-source-maps',
      'low',
      'sourceMapsEnabled is not true: retainer chains will terminate at bundled/minified positions like dist/index.cjs:1.',
      'Run with --enable-source-maps so the diff points at real source lines.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan follows the playbook: confirmed shape, load-driven diff, safe snapshot target, full metric coverage. After the fix, hold the ≥30-minute load test from the Quality Gates and confirm the RSS curve is flat before closing.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: node_memory_leak_hunting_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditNodeMemoryLeakHunting(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`node_memory_leak_hunting_audit: ${e.message}\n`);
    process.exit(1);
  }
}
