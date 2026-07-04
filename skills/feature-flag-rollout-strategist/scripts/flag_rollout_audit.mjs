#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_FLAG_TYPES = ['release', 'experiment', 'operational', 'kill-switch', 'circuit-breaker', 'permission'];
const VALID_BUCKETING_KEYS = ['user-id', 'stable-cookie', 'session-id', 'request-id', 'none'];
const TEMPORARY_TYPES = ['release', 'experiment', 'kill-switch'];
const MAX_TTL_DAYS = 90;
const MAX_TARGETING_CONDITIONS = 3;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a feature-flag rollout plan against feature-flag-rollout-strategist's
 * three deciders — the right flag type, hard cleanup discipline, fail-safe
 * defaults when the provider is down — and its Quality Gates. Rules operate on
 * structured enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/flag-rollout-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditFlagRollout(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_FLAG_TYPES.includes(plan.flagType)) {
    throw new TypeError(`plan.flagType must be one of: ${VALID_FLAG_TYPES.join(', ')}`);
  }
  if (typeof plan.defaultValue !== 'boolean') {
    throw new TypeError('plan.defaultValue must be a boolean');
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

  // --- Gate: type prefix encoded in the flag name ---
  if (plan.namePrefixMatchesType !== true) {
    fail(
      'name-missing-type-prefix',
      'medium',
      'namePrefixMatchesType is not true: during an incident, "wait, which flag is the kill switch?" costs minutes.',
      'Encode the type in the key (release-, kill-, ops-, experiment-, permission- prefix), per the LaunchDarkly naming convention.'
    );
  }

  // --- Gate: every flag has a maintainer ---
  if (plan.hasMaintainer !== true) {
    fail(
      'no-maintainer',
      'high',
      'hasMaintainer is not true: unowned flags are the ones still in the codebase two years later that nobody dares remove.',
      'Assign a maintainer in flag metadata at creation time; quarterly review is the owner\'s responsibility.'
    );
  }

  // --- Gate: temporary flags carry a TTL (<= 90 days) ---
  if (TEMPORARY_TYPES.includes(plan.flagType)) {
    if (typeof plan.ttlDays !== 'number') {
      fail(
        'temporary-flag-without-ttl',
        'high',
        `flagType is '${plan.flagType}' (a temporary type) but ttlDays is not set: flags without a removal date become flag debt.`,
        'Set a TTL at creation: default 30 days, max 90, with cleanup on the release checklist.'
      );
    } else if (plan.ttlDays > MAX_TTL_DAYS) {
      fail(
        'ttl-exceeds-max',
        'medium',
        `ttlDays is ${plan.ttlDays} for a '${plan.flagType}' flag; the maximum for temporary flags is ${MAX_TTL_DAYS} days.`,
        'Shorten the TTL or reclassify the flag as operational/permanent with an owner and justification.'
      );
    }
  }

  // --- Gate: kill switches default true (provider blip must not equal outage) ---
  if (plan.flagType === 'kill-switch' && plan.defaultValue !== true) {
    fail(
      'kill-switch-defaults-off',
      'critical',
      'flagType is kill-switch with defaultValue false: a 30-second provider blip turns the guarded feature off for every user — the default becomes the outage.',
      'Kill switches default true (feature available); they are flipped to false by a human during an incident.'
    );
  }

  // --- Gate: release flags mid-ramp default false; at 100% the default flips ---
  if (plan.flagType === 'release' && typeof plan.rolloutStagePercent === 'number') {
    if (plan.rolloutStagePercent < 100 && plan.defaultValue === true) {
      fail(
        'release-flag-defaults-on-mid-ramp',
        'high',
        `flagType is release at ${plan.rolloutStagePercent}% with defaultValue true: a provider failure exposes the unfinished feature to 100% of users.`,
        'Release flags default false (feature hidden) until the ramp completes.'
      );
    }
    if (plan.rolloutStagePercent >= 100 && plan.defaultValue === false) {
      fail(
        'stale-default-after-full-ramp',
        'high',
        'rolloutStagePercent is 100 with defaultValue false: a provider blip now turns the fully-shipped feature dark — the classic default-becomes-the-outage anti-pattern.',
        'Flip the default to true once the feature is at 100%; better, delete the flag and its dead branch in the same PR.'
      );
    }
  }

  // --- Gate: bucket on a stable identity, never session/request ---
  if (plan.usesPercentageRollout === true) {
    if (!VALID_BUCKETING_KEYS.includes(plan.bucketingKey)) {
      fail(
        'bucketing-key-unspecified',
        'high',
        `usesPercentageRollout is true but bucketingKey is not one of: ${VALID_BUCKETING_KEYS.join(', ')}.`,
        'Name the targetingKey source so the sticky-bucketing rule can be checked.'
      );
    } else if (plan.bucketingKey === 'session-id' || plan.bucketingKey === 'request-id') {
      fail(
        'unstable-bucketing-key',
        'critical',
        `bucketingKey is '${plan.bucketingKey}': users will see the feature one request and lose it the next — the flicker bug.`,
        'Bucket on user.id, or a stable cookie for unauthenticated traffic; never a session/request ID.'
      );
    } else if (plan.bucketingKey === 'none') {
      fail(
        'no-bucketing-key',
        'high',
        "bucketingKey is 'none' while usesPercentageRollout is true: without a targetingKey there is no sticky bucketing at all.",
        'Pass a stable targetingKey in the evaluation context.'
      );
    }

    // --- Gate: no big-bang flips; ramp starts small ---
    const steps = Array.isArray(plan.rampStepsPercent) ? plan.rampStepsPercent : [];
    if (steps.length === 0) {
      fail(
        'no-ramp-schedule',
        'high',
        'usesPercentageRollout is true but rampStepsPercent is empty: an unplanned ramp becomes a big-bang 0-to-100 flip under deadline pressure.',
        'Plan the standard ramp (1 -> 5 -> 25 -> 50 -> 100) with at least one traffic cycle between steps.'
      );
    } else {
      if (steps.length === 1 && steps[0] >= 100) {
        fail(
          'big-bang-flip',
          'high',
          'rampStepsPercent is a single 100% step: a bug invisible at 1% takes down production at scale.',
          'Use the standard ramp (1 -> 5 -> 25 -> 50 -> 100) and watch error rate, p99, and the business metric at each step.'
        );
      } else if (typeof steps[0] === 'number' && steps[0] > 5) {
        fail(
          'first-ramp-step-too-large',
          'medium',
          `The first ramp step is ${steps[0]}%: starting above 5% skips the cheap blast-radius check.`,
          'Start the ramp at 1% (or 5% at most), ideally after an internal-users dogfood stage.'
        );
      }
    }
  }

  // --- Gate: both flag paths are tested ---
  if (plan.testsBothPaths !== true) {
    fail(
      'untested-flag-path',
      'high',
      'testsBothPaths is not true: the untested branch (usually "off") is the one that runs during the incident rollback.',
      'Add on and off test paths per flag using the InMemoryProvider (or equivalent); remove the second path when the flag is removed.'
    );
  }

  // --- Gate: provider-failure behavior documented ---
  if (plan.providerFailureBehaviorDocumented !== true) {
    fail(
      'provider-failure-undocumented',
      'high',
      'providerFailureBehaviorDocumented is not true: nobody has decided what the app does when the flag service is unreachable, slow, or returns garbage.',
      'Document the default value AND the provider-unreachable behavior per flag; load-test the provider-down scenario.'
    );
  }

  // --- Gate: vendor-neutral call sites via OpenFeature ---
  if (plan.openFeatureApi !== true) {
    fail(
      'vendor-locked-call-sites',
      'medium',
      'openFeatureApi is not true: call sites written against a vendor SDK make switching vendors a full re-instrumentation.',
      'Code against the OpenFeature API; the vendor becomes a provider config choice, not a call-site rewrite.'
    );
  }

  // --- Gate: targeting rules stay simple ---
  if (typeof plan.targetingConditionCount === 'number' && plan.targetingConditionCount > MAX_TARGETING_CONDITIONS) {
    fail(
      'targeting-rule-too-complex',
      'medium',
      `targetingConditionCount is ${plan.targetingConditionCount}: beyond ${MAX_TARGETING_CONDITIONS} conditions the flag rule is a rules engine nobody will understand in six months.`,
      "Compute the cohort in code and pass it in the evaluation context (e.g. cohort: 'eu-pro-may'); the flag rule reads one key."
    );
  }

  // --- Gate: circuit breakers are wired to alerting ---
  if (plan.flagType === 'circuit-breaker' && plan.alertWebhookWired !== true) {
    fail(
      'circuit-breaker-not-wired',
      'high',
      'flagType is circuit-breaker but alertWebhookWired is not true: a circuit breaker no alert can flip is just an unused flag.',
      'Wire the alert (PagerDuty/Grafana) webhook to the flag API so the breaker opens automatically, and document it in the runbook.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still schedule the cleanup: when the flag holds at 100% for 30 days, delete the flag and its dead branch in the same PR.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: flag_rollout_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditFlagRollout(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`flag_rollout_audit: ${e.message}\n`);
    process.exit(1);
  }
}
