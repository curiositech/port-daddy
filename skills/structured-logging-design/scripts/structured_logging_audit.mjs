#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_FORMATS = ['json', 'text'];
const VALID_CONVENTIONS = ['snake_case', 'camelCase', 'mixed', 'none'];
const VALID_ERROR_LOG_SITES = ['single-top-level', 'per-layer'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a production logging plan against structured-logging-design's
 * anti-patterns and Quality Gates. All rules operate on structured
 * enum/boolean fields -- no free-text matching.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/logging-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditStructuredLogging(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_FORMATS.includes(plan.format)) {
    throw new TypeError(`plan.format must be one of: ${VALID_FORMATS.join(', ')}`);
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

  // --- Gate: all production log lines are structured JSON ---
  if (plan.format === 'text') {
    fail(
      'unstructured-production-logs',
      'critical',
      'format is text: unstructured strings are grep bait -- unqueryable, unfacetable, and redaction is near-impossible.',
      'Emit JSON from a structured logger (pino / slog / structlog) with a stable field schema.'
    );
  }

  // --- Gate: data lives in fields, not the message string ---
  if (plan.dataInMessageString === true) {
    fail(
      'data-in-message-string',
      'high',
      'dataInMessageString is true: interpolating values into the message body defeats faceted search and lets PII slip past field-name redaction.',
      'Keep the message static ("order placed") and move every value into a named structured field.'
    );
  }

  // --- Gate: logger-level PII redactor exists ---
  if (plan.piiRedactorAtLoggerLevel !== true) {
    fail(
      'no-pii-redactor',
      'critical',
      'piiRedactorAtLoggerLevel is not true: without a redactor running on every line before write, PII reaches the vendor the first time an engineer adds a field without thinking.',
      "Configure logger-level redaction by field name (e.g. pino's redact paths) and update the block list whenever a new PII field is added."
    );
  }

  // --- Gate: trace correlation bound via middleware/context ---
  if (plan.traceIdBound !== true) {
    fail(
      'no-trace-correlation',
      'high',
      'traceIdBound is not true: request-scoped log lines without a trace_id cannot be joined to traces or to each other.',
      'Bind trace_id (W3C traceparent-compatible) via middleware/contextvars; for background jobs, generate it at the producer and pass it in the message body.'
    );
  }

  // --- Gate: one field-name convention, enforced ---
  if (!VALID_CONVENTIONS.includes(plan.fieldNameConvention)) {
    fail(
      'field-name-convention-unspecified',
      'medium',
      `fieldNameConvention is not one of: ${VALID_CONVENTIONS.join(', ')}.`,
      'Declare the convention so schema stability can be audited.'
    );
  } else if (plan.fieldNameConvention === 'mixed') {
    fail(
      'inconsistent-field-names',
      'high',
      'fieldNameConvention is mixed: some logs use userId, some user_id -- dashboards split and queries silently miss.',
      'Pick one convention (snake_case is common for JSON), document it, and enforce it with a lint rule.'
    );
  } else if (plan.fieldNameConvention === 'none') {
    fail(
      'no-field-name-convention',
      'medium',
      'fieldNameConvention is none: field names are stable contracts, and without a standard they will drift.',
      'Pick a convention now, before the first dashboard depends on a field name.'
    );
  }

  // --- Gate: high-cardinality fields normalized before indexing ---
  if (plan.highCardinalityFieldsNormalized !== true) {
    fail(
      'high-cardinality-indexed',
      'medium',
      'highCardinalityFieldsNormalized is not true: raw IDs in indexed fields (request_path with /users/u_42) make index cost dominate the bill.',
      'Index a normalized template field (/users/:id/posts) and keep the raw value in a non-indexed payload field.'
    );
  }

  // --- Gate: single error-log site ---
  if (plan.errorLogSites !== undefined) {
    if (!VALID_ERROR_LOG_SITES.includes(plan.errorLogSites)) {
      fail(
        'invalid-error-log-sites',
        'medium',
        `errorLogSites "${plan.errorLogSites}" is not one of: ${VALID_ERROR_LOG_SITES.join(', ')}.`,
        'Declare where errors are logged so double-logging can be audited.'
      );
    } else if (plan.errorLogSites === 'per-layer') {
      fail(
        'errors-logged-twice',
        'medium',
        'errorLogSites is per-layer: the same exception appears N times and alerts fire N times.',
        'Log at one well-defined layer (the top-level error handler); lower layers re-throw with context.'
      );
    }
  }

  // --- Gate: async logger, so a slow destination never slows a request ---
  if (plan.asyncLogger !== true) {
    fail(
      'synchronous-log-path',
      'medium',
      'asyncLogger is not true: a slow log destination in the synchronous path slows every request.',
      'Use an async logger with a buffer that drops on overflow rather than blocking (pino / slog / structlog defaults).'
    );
  }

  // --- Gate: long fields capped ---
  if (plan.longFieldsCapped !== true) {
    fail(
      'long-fields-uncapped',
      'low',
      'longFieldsCapped is not true: one big request/response body per line can double the ingest bill.',
      'Truncate body fields to ~1KB (or omit unless level=debug).'
    );
  }

  // --- Gate: cold-storage tier separate from hot search ---
  if (plan.coldStorageTier !== true) {
    fail(
      'no-cold-storage-tier',
      'low',
      'coldStorageTier is not true: long-retention compliance queries will run (expensively) against the hot vendor.',
      'Fan out all levels to cheap cold storage (S3 + Athena/DuckDB); keep the hot vendor for the searchable last 7 days.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still verify the log/trace join in the vendor UI on a real request and run the PII fuzz test in CI.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: structured_logging_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditStructuredLogging(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`structured_logging_audit: ${e.message}\n`);
    process.exit(1);
  }
}
