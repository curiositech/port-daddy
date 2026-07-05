#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_GOALS = ['sum-type-modeling', 'id-disambiguation', 'type-guard', 'conditional-type', 'narrowing-repair'];
const SEVERITY_WEIGHTS = { critical: 30, high: 15, medium: 8, low: 3 };

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a TypeScript narrowing design plan against typescript-narrowing-expert's
 * anti-patterns and Quality Gates. Structured/enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/typescript-narrowing-expert-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditTypescriptNarrowingExpert(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a JSON object (not null, not an array)');
  }
  if (!VALID_GOALS.includes(plan.goal)) {
    throw new TypeError(`plan.goal must be one of: ${VALID_GOALS.join(', ')}`);
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= SEVERITY_WEIGHTS[severity] ?? 5;
  }

  // --- Gate: discriminated unions need literal discriminants ---
  if (plan.usesDiscriminatedUnion === true) {
    if (plan.discriminantIsLiteral !== true) {
      fail(
        'discriminant-not-literal',
        'critical',
        'usesDiscriminatedUnion is true but discriminantIsLiteral is not: with kind: string instead of kind: "a" | "b", switch cases do not narrow at all.',
        'Give every variant a literal discriminant (string/number/boolean literal); mark values pulled from data with as const.'
      );
    }
    if (plan.hasExhaustivenessCheck !== true) {
      fail(
        'no-exhaustiveness-check',
        'high',
        'usesDiscriminatedUnion is true but hasExhaustivenessCheck is not: adding a new variant will compile silently while a switch quietly falls through.',
        'Add a default branch assigning to never (const _exhaustive: never = x) so a missing case is a compile error.'
      );
    }
  } else if (plan.goal === 'sum-type-modeling') {
    fail(
      'sum-type-without-discriminated-union',
      'high',
      'goal is sum-type-modeling but usesDiscriminatedUnion is not true: structural checks on overlapping shapes do not narrow reliably.',
      'Model the sum type as a discriminated union with a literal kind field in every variant.'
    );
  }

  // --- Gate: type guards must return a type predicate, not boolean ---
  if (plan.goal === 'type-guard' && plan.typeGuardReturnsPredicate !== true) {
    fail(
      'guard-returns-boolean',
      'critical',
      'goal is type-guard but typeGuardReturnsPredicate is not true: a guard declared to return boolean gives the caller no narrowing at all.',
      'Declare the return type as a predicate: function isFoo(x: unknown): x is Foo.'
    );
  }

  // --- Gate: bare `as` casts must be documented ---
  if (typeof plan.bareAsCastCount === 'number' && plan.bareAsCastCount > 0 && plan.asCastsDocumented !== true) {
    fail(
      'undocumented-as-casts',
      'high',
      `bareAsCastCount is ${plan.bareAsCastCount} with asCastsDocumented not true: as coercions lie to the compiler and are where "cannot read property of undefined" ships from.`,
      'Replace each as with a type guard or satisfies, or add a same-line // reason: comment and a CI grep that fails on bare as.'
    );
  }

  // --- Gate: branded IDs need a validating factory + negative type-tests ---
  if (plan.goal === 'id-disambiguation') {
    if (plan.brandedTypesHaveFactory !== true) {
      fail(
        'brand-without-factory',
        'critical',
        'goal is id-disambiguation but brandedTypesHaveFactory is not true: without a validating factory, engineers cast raw strings to the brand everywhere and it provides no safety.',
        'Add a factory that validates the ID format and casts inside; lint-ban `as Brand` outside the factory file.'
      );
    }
    if (plan.brandNegativeTypeTests !== true) {
      fail(
        'brand-missing-negative-type-tests',
        'medium',
        'brandNegativeTypeTests is not true: nothing locks the invariant that two different brands are not mutually assignable.',
        'Add expectTypeOf<UserID>().not.toMatchTypeOf<OrderID>() (expect-type/tsd) tests for each brand pair.'
      );
    }
  }

  // --- Gate: narrowing across a closure boundary needs a const capture ---
  if (plan.narrowingCrossesCallback === true && plan.narrowedValueCapturedAsConst !== true) {
    fail(
      'narrowing-lost-in-closure',
      'high',
      'narrowingCrossesCallback is true but narrowedValueCapturedAsConst is not: narrowing does not survive closure boundaries, so the callback sees the wide union again.',
      'Capture the narrowed value into a const before the callback, or re-narrow inside the closure.'
    );
  }

  // --- Gate: conditional types stay shallow ---
  if (typeof plan.conditionalTypeAliasMaxLines === 'number' && plan.conditionalTypeAliasMaxLines > 50) {
    fail(
      'conditional-type-too-deep',
      'medium',
      `conditionalTypeAliasMaxLines is ${plan.conditionalTypeAliasMaxLines}: conditional types past ~50 lines risk "Type instantiation is excessively deep" and are unreadable.`,
      'Break the conditional type into named intermediate aliases, or iterate via mapped types instead of recursion.'
    );
  }

  // --- Gate: CI type-checking discipline ---
  if (plan.tscNoEmitInCI !== true) {
    fail(
      'no-tsc-in-ci',
      'medium',
      'tscNoEmitInCI is not true: type errors only surface in whichever editor happens to open the file.',
      'Run tsc --noEmit in CI on every PR; fail the build on type errors.'
    );
  }
  if (plan.noImplicitAnyClean !== true) {
    fail(
      'implicit-any-in-domain-code',
      'medium',
      'noImplicitAnyClean is not true: any in domain code disables narrowing exactly where it matters.',
      'Get tsc --noImplicitAny clean in domain code; confine any to vendor/ and framework-boundary files.'
    );
  }

  // --- Gate: prefer satisfies over widening annotations ---
  if (plan.satisfiesPreferredOverAnnotation !== true) {
    fail(
      'annotation-widens-inference',
      'low',
      'satisfiesPreferredOverAnnotation is not true: explicit annotations widen values that satisfies would validate while keeping the narrow inferred type.',
      'Default to `as const satisfies T` where you want validation without losing literal inference.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still confirm with tsc --noEmit and a negative type-test run before declaring the design done.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: typescript_narrowing_expert_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditTypescriptNarrowingExpert(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`typescript_narrowing_expert_audit: ${e.message}\n`);
    process.exit(1);
  }
}
