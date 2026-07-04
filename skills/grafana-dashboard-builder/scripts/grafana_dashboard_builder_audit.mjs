#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_METRIC_TYPES = ['counter', 'gauge', 'histogram'];
const VALID_RANGE_FUNCTIONS = ['rate', 'irate', 'increase', 'delta', 'none'];
const VALID_ALERT_KINDS = ['slo', 'hard-failure'];

// rate/irate/increase only make sense on monotonically-increasing counters
// (histogram _bucket/_count series are counters too); delta is the gauge tool.
const COUNTER_ONLY_FUNCTIONS = ['rate', 'irate', 'increase'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Grafana dashboard/alert plan against grafana-dashboard-builder's
 * core rules: rate() on counters only, histogram_quantile aggregated by le,
 * no irate in alerts, dwell time on SLO alerts, recording rules for shared
 * queries, panel budget, dashboards as code, and template-variable
 * cardinality. All rules operate on structured enum/boolean/number fields --
 * see schemas/grafana-dashboard-builder-plan.schema.json.
 *
 * @param {unknown} plan
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditGrafanaDashboardBuilder(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (typeof plan.panelCount !== 'number' || plan.panelCount < 0) {
    throw new TypeError('plan.panelCount must be a non-negative number');
  }
  if (!VALID_METRIC_TYPES.includes(plan.metricType)) {
    throw new TypeError(`plan.metricType must be one of: ${VALID_METRIC_TYPES.join(', ')}`);
  }
  if (!VALID_RANGE_FUNCTIONS.includes(plan.rangeFunction)) {
    throw new TypeError(`plan.rangeFunction must be one of: ${VALID_RANGE_FUNCTIONS.join(', ')}`);
  }
  if (typeof plan.hasAlerts !== 'boolean') {
    throw new TypeError('plan.hasAlerts must be a boolean');
  }
  if (plan.alertKind !== undefined && !VALID_ALERT_KINDS.includes(plan.alertKind)) {
    throw new TypeError(`plan.alertKind must be one of: ${VALID_ALERT_KINDS.join(', ')}`);
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

  // --- Gate: rate/irate/increase on counters only ---
  if (plan.metricType === 'gauge' && COUNTER_ONLY_FUNCTIONS.includes(plan.rangeFunction)) {
    fail(
      'range-function-on-gauge',
      'critical',
      `rangeFunction "${plan.rangeFunction}" applied to a gauge: counter functions assume monotonic increase and produce negative rates and step-change garbage on gauges.`,
      'Use delta() (or avg_over_time) for gauges; reserve rate/irate/increase for counters.'
    );
  }

  // --- Gate: histogram quantiles always aggregate by le ---
  if (plan.usesHistogramQuantile === true && plan.aggregatesByLe !== true) {
    fail(
      'histogram-quantile-without-le',
      'critical',
      'usesHistogramQuantile is true but aggregatesByLe is not: histogram_quantile needs the le label preserved through aggregation, otherwise the panel renders NaN.',
      'Aggregate with sum by (le, <kept dims>) (rate(..._bucket[5m])) inside histogram_quantile.'
    );
  }

  if (plan.hasAlerts === true) {
    // --- Gate: no irate in alert expressions ---
    if (plan.alertUsesIrate === true) {
      fail(
        'irate-in-alert',
        'high',
        'alertUsesIrate is true: irate reflects only the last two samples, so a single noisy sample pages the on-call.',
        'Use rate(...[5m]) smoothed over minutes in alert expressions, combined with a for: dwell.'
      );
    }

    // --- Gate: SLO-tier alerts have a real dwell time ---
    if (plan.alertKind === 'slo' && typeof plan.alertForSeconds === 'number' && plan.alertForSeconds < 300) {
      fail(
        'alert-dwell-too-short',
        'high',
        `alertForSeconds is ${plan.alertForSeconds} on an SLO-tier alert: transient blips fire the pager. SLO alerts need >= 300s of contiguous violation.`,
        'Set for: 5m or for: 10m on SLO-tier alerts; reserve for: 0 for hard-failure signals like "service down".'
      );
    }

    // --- Gate: every alert has a runbook URL ---
    if (plan.alertHasRunbookUrl !== true) {
      fail(
        'alert-without-runbook',
        'medium',
        'alertHasRunbookUrl is not true: the page arrives at 3am with no link to what to do about it.',
        'Add a runbook annotation URL to every alert rule.'
      );
    }
  }

  // --- Gate: recording rules for queries shared across panels ---
  if (
    typeof plan.panelsSharingExpensiveQuery === 'number' &&
    plan.panelsSharingExpensiveQuery > 2 &&
    plan.usesRecordingRules !== true
  ) {
    fail(
      'shared-query-not-recorded',
      'medium',
      `panelsSharingExpensiveQuery is ${plan.panelsSharingExpensiveQuery} but usesRecordingRules is not true: the same expensive expression is recomputed per panel, per refresh.`,
      'Pre-compute the expression as a recording rule (e.g. job:http_request_duration:p99) and query that from every panel.'
    );
  }

  // --- Gate: panel budget -- one question per panel, one big question per dashboard ---
  if (plan.panelCount > 30) {
    fail(
      'dashboard-panel-sprawl',
      'high',
      `panelCount is ${plan.panelCount}: past ~30 panels the dashboard loads slowly and nobody reads past the top row.`,
      'Split into focused, cross-linked dashboards: SLO, saturation, dependencies, debugging.'
    );
  }

  // --- Gate: dashboards as code ---
  if (plan.dashboardsInVersionControl === false) {
    fail(
      'dashboard-not-in-version-control',
      'medium',
      'dashboardsInVersionControl is false: live-edited dashboards are unreviewable, un-diffable, and unrecoverable.',
      'Store the dashboard JSON in git and provision via Terraform or grafonnet; disable live editing as the source of truth.'
    );
  }

  // --- Gate: Include All on a high-cardinality variable ---
  if (
    plan.variableIncludeAllEnabled === true &&
    typeof plan.variableCardinality === 'number' &&
    plan.variableCardinality > 100
  ) {
    fail(
      'include-all-cardinality-explosion',
      'high',
      `variableIncludeAllEnabled is true with variableCardinality ${plan.variableCardinality}: "Include All" returns every series and melts both Prometheus and the browser.`,
      'Scope the variable by another variable, cap its values with a regex, or aggregate before display.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still eyeball the rendered dashboard: the top row must answer "is the system healthy" at a glance.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: grafana_dashboard_builder_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditGrafanaDashboardBuilder(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`grafana_dashboard_builder_audit: ${e.message}\n`);
    process.exit(1);
  }
}
