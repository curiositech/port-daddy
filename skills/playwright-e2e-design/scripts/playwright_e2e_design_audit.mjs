#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCATOR_STRATEGIES = ['user-facing', 'test-id', 'css', 'xpath'];
const ASSERTION_STYLES = ['web-first', 'snapshot-read'];
const AUTH_STRATEGIES = ['storage-state-setup', 'login-per-test', 'none'];
const THIRD_PARTY_MODES = ['mocked', 'test-mode-endpoints', 'live', 'none'];
const TRACE_MODES = ['on-first-retry', 'retain-on-failure', 'on', 'off'];

function assertPlanObject(plan) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
}

/**
 * Audit a Playwright E2E suite plan against playwright-e2e-design's
 * Anti-patterns and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/playwright-e2e-design-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditPlaywrightE2eDesign(plan) {
  assertPlanObject(plan);
  if (!LOCATOR_STRATEGIES.includes(plan.locatorStrategy)) {
    throw new TypeError(`plan.locatorStrategy must be one of: ${LOCATOR_STRATEGIES.join(', ')}`);
  }
  if (!ASSERTION_STYLES.includes(plan.assertionStyle)) {
    throw new TypeError(`plan.assertionStyle must be one of: ${ASSERTION_STYLES.join(', ')}`);
  }
  if (!AUTH_STRATEGIES.includes(plan.authStrategy)) {
    throw new TypeError(`plan.authStrategy must be one of: ${AUTH_STRATEGIES.join(', ')}`);
  }
  if (!THIRD_PARTY_MODES.includes(plan.thirdPartyCalls)) {
    throw new TypeError(`plan.thirdPartyCalls must be one of: ${THIRD_PARTY_MODES.join(', ')}`);
  }
  if (!TRACE_MODES.includes(plan.traceMode)) {
    throw new TypeError(`plan.traceMode must be one of: ${TRACE_MODES.join(', ')}`);
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

  // --- Gate 1: assertions must be web-first (the #1 flake eliminator) ---
  if (plan.assertionStyle === 'snapshot-read') {
    fail('snapshot-read-assertions', 'critical',
      'assertionStyle is "snapshot-read": expect(await locator.isVisible()) reads once and does not retry -- a race condition is guaranteed.',
      'Use web-first assertions (await expect(locator).toBeVisible()/toHaveText()/toHaveCount()) which auto-retry until the condition holds or times out.');
  }

  // --- Gate 2: no manual sleeps ---
  if (typeof plan.waitForTimeoutCount === 'number' && plan.waitForTimeoutCount > 0) {
    fail('wait-for-timeout-present', 'high',
      `waitForTimeoutCount is ${plan.waitForTimeoutCount}: sleeps mask race conditions sometimes and let them through other times, making the suite slow AND flaky.`,
      'Replace each waitForTimeout with the actual condition you were waiting for (a web-first assertion or page.waitForResponse), and add a CI grep to keep them out.');
  }

  // --- Gate 3: locator tiers ---
  if (plan.locatorStrategy === 'css' || plan.locatorStrategy === 'xpath') {
    fail('brittle-primary-locators', 'high',
      `locatorStrategy is "${plan.locatorStrategy}": designer CSS changes break brittle selectors; user-facing attributes survive refactors.`,
      'Make getByRole/getByLabel/getByText the default, getByTestId where those are not unique, and CSS/XPath only as a commented last resort.');
  }

  // --- Gate 4: auth-state reuse ---
  if (plan.authStrategy === 'login-per-test') {
    fail('login-per-test', 'high',
      'authStrategy is "login-per-test": the suite is dominated by login latency and the auth provider rate-limits CI.',
      'Log in once in a setup project, save storageState to disk, and start every test from that state (test.use({ storageState })) per role.');
  }

  // --- Gate 5: test isolation ---
  if (plan.testIsolation !== true) {
    fail('tests-share-state', 'high',
      'testIsolation is not true: tests that share data pass alone and fail depending on execution order or worker assignment.',
      'Give each test uniquely-named data (suffix with test.info().testId) and reset state via API in beforeEach -- never rely on ordering.');
  }

  // --- Gate 6: third parties out of the loop ---
  if (plan.thirdPartyCalls === 'live') {
    fail('live-third-party-calls', 'high',
      'thirdPartyCalls is "live": a Stripe/Auth0 outage or quota limit takes the whole suite red.',
      'Pin third-party responses with page.route() fulfill mocks, or use the provider\'s test-mode endpoints; deny egress to unrelated hosts in CI.');
  }

  // --- Gate 7: trace artifacts ---
  if (plan.traceMode === 'off') {
    fail('tracing-disabled', 'high',
      'traceMode is "off": a CI flake leaves no trace, screenshot, or video to debug with.',
      'Set trace: "on-first-retry" so failures produce a trace.zip without taxing happy-path runs.');
  } else if (plan.traceMode === 'on') {
    fail('tracing-always-on', 'medium',
      'traceMode is "on": tracing every run makes happy-path runs slow and artifact storage expensive.',
      'Use "on-first-retry" -- traces only when a failure actually needs debugging.');
  }
  if (plan.traceMode !== 'off' && plan.artifactsUploadedOnCi !== true) {
    fail('artifacts-not-uploaded', 'medium',
      'artifactsUploadedOnCi is not true: traces are recorded but unreachable after the CI runner is recycled.',
      'Upload test-results/ as a CI artifact so trace.zip is downloadable (npx playwright show-trace trace.zip).');
  }

  // --- Gate 8: retry policy -- retries on CI, none locally ---
  if (typeof plan.ciRetries === 'number' && plan.ciRetries === 0) {
    fail('no-ci-retries', 'medium',
      'ciRetries is 0: trace-on-first-retry never fires, and one transient hiccup fails the pipeline.',
      'Set retries: 2 on CI so first-retry tracing works and transient infra noise does not block merges.');
  }
  if (typeof plan.localRetries === 'number' && plan.localRetries > 0) {
    fail('local-retries-hide-flake', 'medium',
      `localRetries is ${plan.localRetries}: retrying locally hides flake from the person best positioned to fix it.`,
      'Keep retries: 0 locally so authors see the flake they are about to ship.');
  }

  // --- Gate 9: parallelism and test latency budget ---
  if (plan.parallelEnabled !== true) {
    fail('serial-only-suite', 'medium',
      'parallelEnabled is not true: a serial suite grows toward 45 minutes and engineers stop running it pre-PR.',
      'Enable parallel mode within files (test.describe.configure({ mode: "parallel" })) and shard across CI workers with --shard=N/M.');
  }
  if (typeof plan.p95TestSeconds === 'number' && plan.p95TestSeconds > 30) {
    fail('slow-tests-bottleneck-shards', 'medium',
      `p95TestSeconds is ${plan.p95TestSeconds}: tests past ~30s bottleneck whichever shard they land on.`,
      'Break long tests into smaller journeys; keep individual test p95 under 30 seconds.');
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still measure the flake rate on nightly runs and alert if it exceeds 1% over a week.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: playwright_e2e_design_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditPlaywrightE2eDesign(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`playwright_e2e_design_audit: ${e.message}\n`);
    process.exit(1);
  }
}
