#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_AUDIENCES = ['public', 'internal'];
const VALID_CHANGE_KINDS = ['additive', 'breaking'];
const VALID_STRATEGIES = ['none-additive', 'uri-segment', 'date-pinned-header', 'media-type', 'query-param'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit an API versioning plan against api-versioning-strategy's decision
 * diagram, anti-patterns, and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON versioning plan, see schemas/api-versioning-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditApiVersioningStrategy(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_AUDIENCES.includes(plan.apiAudience)) {
    throw new TypeError(`plan.apiAudience must be one of: ${VALID_AUDIENCES.join(', ')}`);
  }
  if (!VALID_CHANGE_KINDS.includes(plan.changeKind)) {
    throw new TypeError(`plan.changeKind must be one of: ${VALID_CHANGE_KINDS.join(', ')}`);
  }
  if (!VALID_STRATEGIES.includes(plan.strategy)) {
    throw new TypeError(`plan.strategy must be one of: ${VALID_STRATEGIES.join(', ')}`);
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

  // --- Rule 1: additive changes need no version bump at all ---
  if (plan.changeKind === 'additive' && plan.strategy !== 'none-additive') {
    fail(
      'version-bump-for-additive-change',
      'medium',
      `changeKind is "additive" but strategy is "${plan.strategy}": a new field/endpoint/optional param ships without any versioning ceremony.`,
      'Ship additive changes directly (strategy "none-additive"); reserve version machinery for breaking changes.'
    );
  }

  // --- Rule 2: query-param versioning is prototyping-only ---
  if (plan.changeKind === 'breaking' && plan.apiAudience === 'public' && plan.strategy === 'query-param') {
    fail(
      'query-param-versioning-in-public-api',
      'high',
      'strategy "query-param" on a public breaking change: version is not a resource property; query-param versioning is for rapid prototyping only.',
      'Use a date-pinned header (Stripe model) for frequent small breaks, or a URI segment for a rare big-bang rewrite.'
    );
  }

  // --- Rule 3: date-pinned versions without the transformer pattern ---
  if (plan.strategy === 'date-pinned-header' && plan.usesTransformerPattern !== true) {
    fail(
      'date-pinned-without-transformer',
      'high',
      'strategy is "date-pinned-header" but usesTransformerPattern is not true: without version-change transformer modules, every controller grows if/else branches per version and core code rots.',
      'Adopt the version-transformer pattern: core code targets the latest schema; each breaking change is one transformer module applied in reverse-chronological order.'
    );
  }

  // --- Rule 4: removal without a Deprecation signal (the cardinal sin) ---
  if (plan.changeKind === 'breaking' && plan.removesEndpointOrField === true && plan.deprecationHeaderSet !== true) {
    fail(
      'removal-without-deprecation-header',
      'critical',
      'removesEndpointOrField is true but deprecationHeaderSet is not: clients break with no machine-readable warning. Always announce, always sunset on a date, never just remove.',
      'Send Deprecation: @<unix-ts> (RFC 9745) and Sunset: <HTTP-date> (RFC 8594) at least the full sunset window before removal.'
    );
  }

  // --- Rule 5: Sunset MUST NOT be earlier than Deprecation (RFC 9745) ---
  if (
    typeof plan.deprecationEpochSeconds === 'number' &&
    typeof plan.sunsetEpochSeconds === 'number' &&
    plan.sunsetEpochSeconds < plan.deprecationEpochSeconds
  ) {
    fail(
      'sunset-earlier-than-deprecation',
      'critical',
      `sunsetEpochSeconds (${plan.sunsetEpochSeconds}) is earlier than deprecationEpochSeconds (${plan.deprecationEpochSeconds}): RFC 9745 is explicit that Sunset MUST NOT be earlier than Deprecation.`,
      'Reorder the timeline: deprecate first, sunset later; the Sunset HTTP-date must be at or after the Deprecation timestamp.'
    );
  }

  // --- Rule 6: Deprecation without a migration Link ---
  if (plan.deprecationHeaderSet === true && plan.migrationLinkProvided !== true) {
    fail(
      'deprecation-without-migration-link',
      'medium',
      'deprecationHeaderSet is true but migrationLinkProvided is not: clients know the endpoint is deprecated but not what to do about it.',
      'Include Link: <migration-doc-url>; rel="deprecation" and verify the doc URL exists (HEAD check in CI).'
    );
  }

  // --- Rule 7: semver on a REST API ---
  if (plan.semverVersioning === true) {
    fail(
      'semver-on-rest-api',
      'medium',
      'semverVersioning is true: v1.2.3 implies patch/minor semantics that do not apply to a JSON wire contract.',
      'Use date-based names (2024-04-10) or major-only (v1) version identifiers.'
    );
  }

  // --- Rule 8: public-grade ceremony on an internal API ---
  if (plan.apiAudience === 'internal' && plan.strategy === 'date-pinned-header') {
    fail(
      'heavy-versioning-for-internal-api',
      'medium',
      'apiAudience is "internal" but the plan builds the date-pinned + transformer machinery: process overhead with no payoff when a coordinated atomic deploy is possible.',
      'Use additive evolution plus Deprecation/Sunset headers and a coordinated migration for internal APIs; reserve the heavy ceremony for public ones.'
    );
  }

  // --- Rule 9: deleting a version without usage telemetry ---
  if (plan.removesEndpointOrField === true && plan.usageTelemetryPerVersion !== true) {
    fail(
      'removal-without-usage-telemetry',
      'high',
      'removesEndpointOrField is true but usageTelemetryPerVersion is not: you cannot answer "how many requests hit the old path yesterday?" before deleting it.',
      'Add per-version request telemetry (or transformer fire-counts) and check it is near zero before the sunset date arrives.'
    );
  }

  // --- Rule 10: sunset date with no enforcement ---
  if (plan.sunsetHeaderSet === true && plan.sunsetEnforcementPlanned !== true) {
    fail(
      'sunset-without-enforcement',
      'medium',
      'sunsetHeaderSet is true but sunsetEnforcementPlanned is not: without a calendar reminder, CI check, or automated 410 Gone, the endpoint lives forever and the code rots.',
      'Plan enforcement: a CI test that fails 7 days before sunset, or an automated 410 Gone with a migration link on the date.'
    );
  }

  // --- Rule 11: transformer framework where it is overkill ---
  if (
    plan.usesTransformerPattern === true &&
    typeof plan.consumerCount === 'number' &&
    plan.consumerCount < 50 &&
    plan.apiAudience === 'internal'
  ) {
    fail(
      'transformer-overkill-for-small-internal-api',
      'low',
      `usesTransformerPattern is true for an internal API with only ${plan.consumerCount} consumers: the framework pays off at >3 breaking changes/year and >10k consumers.`,
      'Prefer additive evolution + coordinated deploys for a small internal API; skip the transformer framework.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still verify the Deprecation/Sunset headers and migration Link in an integration test before shipping.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: api_versioning_strategy_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditApiVersioningStrategy(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`api_versioning_strategy_audit: ${e.message}\n`);
    process.exit(1);
  }
}
