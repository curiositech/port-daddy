#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_KINDS = new Set(['unit', 'integration', 'doc', 'bench']);

const PER_TEST_WEIGHT = 40;
const PLAN_FLAG_WEIGHT = 60;
const PLAN_FLAGS = [
  'coverageTheaterRisk',
  'testDepsInDevDeps',
  'mockEcho',
  'fakesDeterminismWithSleeps',
  'parityAssertsKernelLoaded',
  'writesToTmp',
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a planned Rust test suite (JSON) against this skill's shibboleths,
 * BEFORE the tests are written. This is deliberately not a code linter — it
 * checks the declared shape of the plan (schemas/test-plan.schema.json)
 * against the anti-patterns in SKILL.md: coverage theater (asserting types
 * not values), #[test] on an async fn, a parity test that doesn't assert the
 * kernel loaded, test-only crates in [dependencies], mock echo, faking
 * determinism with sleeps, and writing test scratch to /tmp.
 *
 * @param {unknown} plan - parsed JSON test plan.
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditTestPlan(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('test plan must be a JSON object');
  }

  const findings = [];
  const recommendations = [];
  let criticalHit = false;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
  }

  // --- tests[] ---
  const tests = Array.isArray(plan.tests) ? plan.tests : null;
  let perTestScore = 0;

  if (!tests || tests.length === 0) {
    fail(
      'no-tests-planned',
      'critical',
      'tests[] is missing or empty: there is nothing here to audit.',
      'Add at least one planned test with kind/assertsValueNotType/isAsync/usesTokioTestNotTest.'
    );
  } else {
    let perTestDeduction = 0;
    const perTestBudget = PER_TEST_WEIGHT / tests.length;

    tests.forEach((t, i) => {
      const label = isPlainObject(t) && typeof t.name === 'string' && t.name.trim() ? t.name : `tests[${i}]`;

      if (!isPlainObject(t)) {
        fail('malformed-test-entry', 'critical', `${label} is not an object.`, 'Every tests[] entry must be an object with kind/assertsValueNotType/isAsync/usesTokioTestNotTest.');
        perTestDeduction += perTestBudget;
        return;
      }

      if (!VALID_KINDS.has(t.kind)) {
        fail('invalid-test-kind', 'critical', `${label} has kind=${JSON.stringify(t.kind)}, expected one of unit/integration/doc/bench.`, 'Set kind to unit, integration, doc, or bench.');
        perTestDeduction += perTestBudget * 0.5;
      }

      if (t.assertsValueNotType === false) {
        fail(
          'coverage-theater',
          'high',
          `${label} only asserts a type/shape (is_ok/is_some/len()>0-style), not a specific value — coverage theater.`,
          `Assert the specific value, error variant, or shape in ${label}. Run cargo-mutants on this module: a surviving mutant is an unasserted behavior.`
        );
        perTestDeduction += perTestBudget * 0.6;
      }

      if (t.isAsync === true && t.usesTokioTestNotTest !== true) {
        fail(
          'test-attr-on-async-fn',
          'critical',
          `${label} is async but is not marked usesTokioTestNotTest — a bare #[test] on an async fn either fails to compile or never runs the body.`,
          `Attribute ${label} with #[tokio::test] (or #[async_std::test]), not #[test], and wrap blocking work in a timeout.`
        );
        perTestDeduction += perTestBudget * 0.6;
      }

      if (t.kind === 'bench') {
        recommendations.push(`${label} is kind=bench — benches/ (criterion) is not part of the test gate; keep it out of \`cargo test\`/CI's required-tests run.`);
      }
    });

    perTestScore = Math.max(0, PER_TEST_WEIGHT - perTestDeduction);
  }

  // --- plan-wide flags ---
  const missingFlags = PLAN_FLAGS.filter((k) => typeof plan[k] !== 'boolean');
  if (missingFlags.length > 0) {
    fail(
      'missing-plan-flags',
      'high',
      `Plan is missing boolean flag(s): ${missingFlags.join(', ')}.`,
      'Every plan-wide flag (coverageTheaterRisk, testDepsInDevDeps, mockEcho, fakesDeterminismWithSleeps, parityAssertsKernelLoaded, writesToTmp) must be set explicitly — an absent flag cannot be audited.'
    );
  }

  const flagBudget = PLAN_FLAG_WEIGHT / PLAN_FLAGS.length;
  let planFlagScore = 0;

  if (plan.coverageTheaterRisk === true) {
    fail(
      'coverage-theater-risk',
      'high',
      'coverageTheaterRisk is true: the plan, taken as a whole, risks measuring execution rather than verification.',
      'Replace is_ok()/is_some()/len()>0-only assertions with assertions on the actual returned value or error variant.'
    );
  } else if (typeof plan.coverageTheaterRisk === 'boolean') {
    planFlagScore += flagBudget;
  }

  if (plan.testDepsInDevDeps === false) {
    fail(
      'test-deps-in-dependencies',
      'medium',
      'testDepsInDevDeps is false: test-only crates (proptest/criterion/mockall/insta/rstest/tempfile) appear to be declared under [dependencies], bloating or breaking the release binary.',
      'Move test-only crates to [dev-dependencies] and #[cfg(test)]-gate mock derives (#[cfg_attr(test, automock)]).'
    );
  } else if (plan.testDepsInDevDeps === true) {
    planFlagScore += flagBudget;
  }

  if (plan.mockEcho === true) {
    fail(
      'mock-echo',
      'medium',
      'mockEcho is true: a planned test asserts a mock returns exactly what it was told to return — that tests the mock framework, not the code.',
      'Prefer a real trivial impl (in-memory repo, fixed clock) and assert on what the code does with the value, not the value itself.'
    );
  } else if (plan.mockEcho === false) {
    planFlagScore += flagBudget;
  }

  if (plan.fakesDeterminismWithSleeps === true) {
    fail(
      'sleep-faked-determinism',
      'medium',
      'fakesDeterminismWithSleeps is true: flakiness is planned to be papered over with a sleep or retry instead of root-caused.',
      'Await a real readiness signal (channel recv), pause the clock (#[tokio::test(start_paused=true)]), or isolate the shared resource instead.'
    );
  } else if (plan.fakesDeterminismWithSleeps === false) {
    planFlagScore += flagBudget;
  }

  if (plan.parityAssertsKernelLoaded === false) {
    fail(
      'parity-test-tests-nothing',
      'high',
      'parityAssertsKernelLoaded is false: a cross-language/FFI parity check does not assert the native kernel actually loaded before comparing outputs, so a silent fallback on both sides would pass trivially.',
      'Assert the kernel/dylib is loaded before asserting parity; make "not loaded" a loud skip; verify real parity under the real runtime, not just the unit harness.'
    );
  } else if (plan.parityAssertsKernelLoaded === true) {
    planFlagScore += flagBudget;
  }

  if (plan.writesToTmp === true) {
    fail(
      'writes-to-tmp',
      'high',
      'writesToTmp is true: a planned test writes scratch data to a hardcoded /tmp path, which is purged out from under parallel test runs.',
      'Use tempfile::tempdir() (auto-cleaned) or a repo-local scratch dir; honor a $TMPDIR/env override instead of hardcoding a path.'
    );
  } else if (plan.writesToTmp === false) {
    planFlagScore += flagBudget;
  }

  const score = Math.max(0, Math.min(100, Math.round(perTestScore + planFlagScore)));
  const pass = !criticalHit && missingFlags.length === 0 && score >= 80;

  if (findings.length === 0) {
    recommendations.push('Plan is structurally clean of known shibboleths. Spot-check that each assertsValueNotType:true test really pins a value, not just a shape, once written.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: test_plan_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditTestPlan(data), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`test_plan_audit: ${e.message}\n`);
    process.exit(1);
  }
}
