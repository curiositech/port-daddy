#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_COMMANDS = ['select', 'insert', 'update', 'delete', 'all'];
const VALID_TYPES = ['permissive', 'restrictive'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Postgres RLS policy plan against postgres-row-level-security's
 * Quality Gates: default-deny actually enabled, at least one permissive
 * policy, TO <role> targeting, the (SELECT auth.uid()) subselect wrap,
 * USING/WITH CHECK pairing per command, tenant-column indexing, FORCE for
 * owning connection roles, and bypass-path hygiene.
 *
 * @param {unknown} plan - parsed JSON, see schemas/postgres-row-level-security-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditPostgresRowLevelSecurity(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (typeof plan.rlsEnabled !== 'boolean') {
    throw new TypeError('plan.rlsEnabled must be a boolean');
  }
  if (!Array.isArray(plan.policies)) {
    throw new TypeError('plan.policies must be an array');
  }
  plan.policies.forEach((p, i) => {
    if (!isPlainObject(p)) throw new TypeError(`policies[${i}] must be an object`);
    if (!VALID_COMMANDS.includes(p.command)) {
      throw new TypeError(`policies[${i}].command must be one of: ${VALID_COMMANDS.join(', ')}`);
    }
    if (!VALID_TYPES.includes(p.type)) {
      throw new TypeError(`policies[${i}].type must be one of: ${VALID_TYPES.join(', ')}`);
    }
  });

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

  // Gate 1: RLS must actually be enabled (default-deny).
  if (plan.rlsEnabled !== true) {
    fail(
      'rls-not-enabled',
      'critical',
      'rlsEnabled is not true: policies without ALTER TABLE ... ENABLE ROW LEVEL SECURITY enforce nothing.',
      'Run ALTER TABLE <t> ENABLE ROW LEVEL SECURITY and verify with \\d+ showing "Row security enabled".'
    );
  }

  // Gate 2: restrictive-only policy sets deny everything.
  if (plan.policies.length > 0 && plan.policies.every((p) => p.type === 'restrictive')) {
    fail(
      'restrictive-only-policies',
      'high',
      'Every policy is RESTRICTIVE: with no permissive predicate to OR-in, all rows are denied for all roles.',
      'Add at least one PERMISSIVE policy; restrictive policies only narrow what permissive ones grant.'
    );
  }

  // Gate 3: RLS enabled with zero policies is default-deny for everyone — flag as probably unintended.
  if (plan.rlsEnabled === true && plan.policies.length === 0) {
    fail(
      'no-policies-defined',
      'medium',
      'RLS is enabled but the plan defines zero policies: every non-bypass role sees nothing.',
      'Confirm total lockout is intended, or add the per-command policies this table needs.'
    );
  }

  for (const [i, p] of plan.policies.entries()) {
    const label = `policies[${i}] (${p.type} FOR ${p.command})`;

    // Gate 4: always specify TO <role>.
    if (p.toRoleSpecified !== true) {
      fail(
        'policy-missing-to-role',
        'high',
        `${label}: toRoleSpecified is not true — the policy is evaluated for PUBLIC, including anon, paying evaluation cost on every role.`,
        'Add TO authenticated (or the intended role) so Postgres skips the policy entirely for non-matching roles.'
      );
    }

    // Gate 5: auth functions wrapped in (SELECT ...) for the initPlan cache.
    if (p.usesAuthFunction === true && p.authFnWrappedInSubselect !== true) {
      fail(
        'auth-fn-not-subselect-wrapped',
        'high',
        `${label}: uses auth.uid()/auth.jwt() without the (SELECT ...) wrap — per-row function calls, the 94-99% latency regression.`,
        'Wrap row-independent auth functions as (SELECT auth.uid()) so Postgres builds a once-per-statement initPlan.'
      );
    }

    // Gate 6: USING / WITH CHECK pairing per command.
    if ((p.command === 'update' || p.command === 'all') && p.hasUsing === true && p.hasWithCheck !== true) {
      // Postgres defaults WITH CHECK to USING here, but the plan should be explicit
      // because the reassignment hole is exactly what implicit defaults hide.
      fail(
        'update-without-with-check',
        'medium',
        `${label}: UPDATE/ALL policy has USING but no explicit WITH CHECK — relying on the implicit default hides the row-reassignment question from review.`,
        'State WITH CHECK explicitly on UPDATE/ALL policies so "can the user write THIS value" is a reviewed decision.'
      );
    }
    if (p.command === 'insert' && p.hasWithCheck !== true) {
      fail(
        'insert-without-with-check',
        'high',
        `${label}: INSERT policy without WITH CHECK validates nothing about the new row.`,
        'INSERT policies take WITH CHECK (USING is not allowed for INSERT); add the predicate that pins user_id to (SELECT auth.uid()).'
      );
    }
    if ((p.command === 'select' || p.command === 'delete') && p.hasUsing !== true) {
      fail(
        'select-delete-without-using',
        'high',
        `${label}: SELECT/DELETE policy without USING filters nothing.`,
        'SELECT and DELETE policies require a USING predicate; WITH CHECK is not allowed for them.'
      );
    }
  }

  // Gate 7: RLS adds a WHERE clause, not an index.
  if (plan.tenantColumnIndexed !== true) {
    fail(
      'tenant-column-not-indexed',
      'high',
      'tenantColumnIndexed is not true: the policy column (user_id / tenant_id) has no index, so every read is a sequential scan with a per-row filter (the 171ms -> <0.1ms benchmark).',
      'CREATE INDEX ON <table> (user_id) — RLS does not create indexes for you.'
    );
  }

  // Gate 8: owner bypass-by-accident.
  if (plan.ownerMayConnect === true && plan.forceRls !== true) {
    fail(
      'owner-bypass-without-force',
      'high',
      'ownerMayConnect is true but forceRls is not: the table owner bypasses RLS, so the connection role silently sees everything.',
      'ALTER TABLE <t> FORCE ROW LEVEL SECURITY when the connecting role (e.g. the PostgREST user) might own tables.'
    );
  }

  // Gate 9: SECURITY DEFINER functions must stay out of the API schema.
  if (plan.securityDefinerInApiSchema === true) {
    fail(
      'security-definer-in-api-schema',
      'critical',
      'securityDefinerInApiSchema is true: an API-exposed SECURITY DEFINER function is a one-call RLS bypass.',
      'Move SECURITY DEFINER functions to a private schema, review them line-by-line, and SET search_path = \'\' inside each.'
    );
  }

  // Gate 10: the service_role key must never reach the client.
  if (plan.serviceRoleKeyServerOnly !== true) {
    fail(
      'service-role-key-not-server-only',
      'critical',
      'serviceRoleKeyServerOnly is not true: a BYPASSRLS credential reachable from client code is a full data breach, not a policy bug.',
      'Keep service_role strictly server-side; add a CI bundle scan asserting it never appears in client artifacts.'
    );
  }

  // Gate 11: end-to-end isolation test.
  if (plan.isolationTested !== true) {
    fail(
      'isolation-not-tested',
      'medium',
      'isolationTested is not true: no end-to-end test proves user A cannot see user B\'s rows.',
      'Add a multi-tenant isolation test that authenticates as two users and asserts cross-tenant reads and writes fail.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Configuration clears every quality gate this skill checks. Still run the RLS query under EXPLAIN ANALYZE to confirm the initPlan and index are used.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: postgres_row_level_security_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditPostgresRowLevelSecurity(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`postgres_row_level_security_audit: ${e.message}\n`);
    process.exit(1);
  }
}
