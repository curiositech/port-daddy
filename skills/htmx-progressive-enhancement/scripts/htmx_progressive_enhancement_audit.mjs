#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_RESPONSE_FORMATS = ['html-fragment', 'json'];
const VALID_CROSS_REGION = ['oob-swap', 'multiple-requests', 'none'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit an htmx UI plan against htmx-progressive-enhancement's core rules:
 * the server returns HTML fragments (never JSON), CSRF rides every
 * state-changing request, the page degrades without JS, partial swaps stay
 * accessible (aria-live, focus), the server stays the source of truth,
 * type-ahead inputs debounce, and cross-region updates use OOB swaps. All
 * rules operate on structured enum/boolean fields -- see
 * schemas/htmx-progressive-enhancement-plan.schema.json.
 *
 * @param {unknown} plan
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditHtmxProgressiveEnhancement(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_RESPONSE_FORMATS.includes(plan.endpointResponseFormat)) {
    throw new TypeError(`plan.endpointResponseFormat must be one of: ${VALID_RESPONSE_FORMATS.join(', ')}`);
  }
  if (typeof plan.hasStateChangingRequests !== 'boolean') {
    throw new TypeError('plan.hasStateChangingRequests must be a boolean');
  }
  if (typeof plan.worksWithoutJs !== 'boolean') {
    throw new TypeError('plan.worksWithoutJs must be a boolean');
  }
  if (typeof plan.dynamicRegionsAriaLive !== 'boolean') {
    throw new TypeError('plan.dynamicRegionsAriaLive must be a boolean');
  }
  if (plan.crossRegionUpdateStrategy !== undefined && !VALID_CROSS_REGION.includes(plan.crossRegionUpdateStrategy)) {
    throw new TypeError(`plan.crossRegionUpdateStrategy must be one of: ${VALID_CROSS_REGION.join(', ')}`);
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

  // --- Gate: htmx endpoints return HTML, not JSON ---
  if (plan.endpointResponseFormat === 'json') {
    fail(
      'json-response-to-htmx',
      'critical',
      'endpointResponseFormat is "json": htmx swaps response bodies as HTML, so a JSON payload renders as literal text (or nothing visibly changes).',
      'Return HTML fragments for htmx requests -- branch on the HX-Request header -- and keep JSON endpoints separate.'
    );
  }

  // --- Gate: CSRF on every state-changing request ---
  if (plan.hasStateChangingRequests === true && plan.csrfTokenIncluded !== true) {
    fail(
      'missing-csrf-token',
      'critical',
      'hasStateChangingRequests is true but csrfTokenIncluded is not: framework form helpers inject CSRF automatically; raw hx-post/hx-put/hx-delete requests do not, so the framework 403s them (or worse, the protection is off).',
      "Send the token via hx-headers='{\"X-CSRF-Token\": ...}' or hx-vals, or use the framework's htmx-aware CSRF middleware."
    );
  }

  // --- Gate: progressive enhancement, not JS-required ---
  if (plan.worksWithoutJs !== true) {
    fail(
      'js-required-not-progressive',
      'high',
      'worksWithoutJs is not true: forms and links that only function through hx-* attributes make the site unusable with JS disabled, defeating the point of progressive enhancement.',
      'Pair action="/path" with hx-post="/path" and use hx-boost so plain HTML works and htmx upgrades it.'
    );
  }

  // --- Gate: partial swaps must stay accessible ---
  if (plan.dynamicRegionsAriaLive !== true) {
    fail(
      'no-aria-live-on-dynamic-regions',
      'high',
      'dynamicRegionsAriaLive is not true: partial swaps do not announce themselves, so screen-reader users never learn the content changed.',
      'Mark dynamic regions with aria-live="polite" and add visually-hidden announcements for important changes.'
    );
  }
  if (plan.focusManagedAfterSwap === false) {
    fail(
      'focus-not-managed-after-swap',
      'medium',
      'focusManagedAfterSwap is false: a swap that replaces the focused element drops keyboard users at the top of the document.',
      'Manage focus in an hx-on::after-swap handler when the swap replaces or removes the active element.'
    );
  }

  // --- Gate: the server is the source of truth ---
  if (plan.clientSideStateStore === true) {
    fail(
      'client-side-state-store',
      'high',
      'clientSideStateStore is true: maintaining app state in JS variables alongside htmx invites races and stale views; the hypermedia model keeps state on the server.',
      'Let each response carry the new state as HTML. If client state is genuinely necessary, that is a signal you want a SPA, not htmx.'
    );
  }

  // --- Gate: debounce type-as-you-search inputs ---
  if (plan.hasTypeAheadSearch === true && plan.searchDebounced !== true) {
    fail(
      'search-not-debounced',
      'medium',
      'hasTypeAheadSearch is true but searchDebounced is not: every keystroke fires a request, hammering the server and racing responses out of order.',
      'Use hx-trigger="keyup changed delay:300ms, search" to debounce and skip value-preserving keys.'
    );
  }

  // --- Gate: OOB swaps over multiple requests for cross-region updates ---
  if (plan.crossRegionUpdateStrategy === 'multiple-requests') {
    fail(
      'multiple-requests-for-cross-region-update',
      'medium',
      'crossRegionUpdateStrategy is "multiple-requests": issuing extra requests to refresh regions outside the target doubles latency and can interleave inconsistently.',
      'Return the extra region in the same response with hx-swap-oob="true" so one round trip updates both.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still test the two degraded paths by hand: JS disabled (plain HTML must work) and a screen reader over a swap (the update must be announced).'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: htmx_progressive_enhancement_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditHtmxProgressiveEnhancement(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`htmx_progressive_enhancement_audit: ${e.message}\n`);
    process.exit(1);
  }
}
