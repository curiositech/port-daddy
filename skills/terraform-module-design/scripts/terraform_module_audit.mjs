#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_SOURCE_PINS = ['tag', 'sha', 'branch', 'local'];
const VALID_ITERATORS = ['for_each', 'count', 'none'];
const VALID_IGNORE_SCOPES = ['targeted', 'all', 'none'];
const VALID_BACKENDS = ['remote-locked-encrypted', 'remote', 'local'];
const VALID_CI_AUTH = ['oidc', 'long-lived-keys', 'none'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a Terraform module design plan against terraform-module-design's
 * anti-patterns and Quality Gates. All rules operate on structured
 * enum/boolean fields -- no free-text matching.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/terraform-module-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditTerraformModule(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_SOURCE_PINS.includes(plan.moduleSourcePin)) {
    throw new TypeError(`plan.moduleSourcePin must be one of: ${VALID_SOURCE_PINS.join(', ')}`);
  }
  if (!VALID_BACKENDS.includes(plan.stateBackend)) {
    throw new TypeError(`plan.stateBackend must be one of: ${VALID_BACKENDS.join(', ')}`);
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

  // --- Gate: module source pinned to a tag or SHA, never a branch ---
  if (plan.moduleSourcePin === 'branch') {
    fail(
      'module-sourced-from-branch',
      'critical',
      'moduleSourcePin is branch: a floating reference means plan output changes mysteriously between runs whenever upstream moves.',
      'Pin the module source to a release tag or commit SHA; update intentionally.'
    );
  }

  // --- Gate: for_each over count for resources with identity ---
  if (plan.dynamicResourceIterator !== undefined) {
    if (!VALID_ITERATORS.includes(plan.dynamicResourceIterator)) {
      fail(
        'invalid-iterator',
        'medium',
        `dynamicResourceIterator "${plan.dynamicResourceIterator}" is not one of: ${VALID_ITERATORS.join(', ')}.`,
        'Declare for_each, count, or none.'
      );
    } else if (plan.dynamicResourceIterator === 'count' && plan.resourcesHaveIdentity === true) {
      fail(
        'count-for-identity-resources',
        'high',
        'dynamicResourceIterator is count for resources with identity: removing one item from the middle of the list recreates everything after it.',
        'Use for_each = toset(...) so keys are stable and additions/removals do not disturb siblings.'
      );
    }
  }

  // --- Gate: ignore_changes is targeted, never all ---
  if (plan.ignoreChangesScope !== undefined) {
    if (!VALID_IGNORE_SCOPES.includes(plan.ignoreChangesScope)) {
      fail(
        'invalid-ignore-changes-scope',
        'medium',
        `ignoreChangesScope "${plan.ignoreChangesScope}" is not one of: ${VALID_IGNORE_SCOPES.join(', ')}.`,
        'Declare targeted, all, or none.'
      );
    } else if (plan.ignoreChangesScope === 'all') {
      fail(
        'blanket-ignore-changes',
        'critical',
        'ignoreChangesScope is all: drift goes undetected and security misconfigurations persist on a resource Terraform should own.',
        'List specific attribute paths only (e.g. ignore_changes = [task_definition]). Never all.'
      );
    }
  }

  // --- Gate: remote, encrypted, locked state ---
  if (plan.stateBackend === 'local') {
    fail(
      'local-state-backend',
      'critical',
      'stateBackend is local: no locking, no encryption at rest, no team access, and a laptop loss loses the state.',
      'Use a remote backend (e.g. S3 + lock table) with encryption and locking enabled.'
    );
  } else if (plan.stateBackend === 'remote') {
    fail(
      'remote-state-unlocked-or-unencrypted',
      'high',
      'stateBackend is remote without locking + encryption: concurrent applies corrupt state, and state files contain secrets in plain text.',
      'Enable state locking (DynamoDB table or native backend locking) and encrypt = true.'
    );
  }

  // --- Gate: state split by blast radius ---
  if (plan.stateSplitByBlastRadius !== true) {
    fail(
      'monolithic-state',
      'medium',
      'stateSplitByBlastRadius is not true: one state file for everything means a small change requires an apply on the whole world.',
      'Split state by (environment x stack): networking, data, services; cross-reference via outputs / terraform_remote_state.'
    );
  }

  // --- Gate: no secrets in tfvars ---
  if (plan.secretsInTfvars === true) {
    fail(
      'secrets-in-tfvars',
      'critical',
      'secretsInTfvars is true: committed tfvars put credentials in the repo history forever.',
      'Feed sensitive variables from the environment (TF_VAR_*), Vault, or a secrets manager, and mark them sensitive = true.'
    );
  }

  // --- Gate: variables carry validation ---
  if (plan.variablesValidated !== true) {
    fail(
      'unvalidated-variables',
      'medium',
      'variablesValidated is not true: constraint violations surface as opaque apply-time provider errors instead of clear plan-time messages.',
      'Add a validation block (and description) to every variable with constraints.'
    );
  }

  // --- Gate: apply bound to a saved plan file ---
  if (plan.planFileBoundApply !== true) {
    fail(
      'plan-apply-pray',
      'high',
      'planFileBoundApply is not true: an apply not bound to a saved plan can run against state another engineer changed since review.',
      'Use terraform plan -out=plan.tfplan && terraform apply plan.tfplan so the apply is pinned to the reviewed plan and state version.'
    );
  }

  // --- Gate: scheduled drift detection ---
  if (plan.driftCheckScheduled !== true) {
    fail(
      'no-drift-detection',
      'medium',
      'driftCheckScheduled is not true: out-of-band edits accumulate silently until they cause an incident.',
      'Schedule a daily read-only `terraform plan -detailed-exitcode -lock=false`; investigate every non-zero exit.'
    );
  }

  // --- Gate: provider + terraform versions pinned ---
  if (plan.providerVersionsPinned !== true) {
    fail(
      'unpinned-provider-versions',
      'high',
      'providerVersionsPinned is not true: an unpinned provider upgrade can change resource behavior under you on the next init.',
      'Pin required_version and each provider to major.minor (~> pessimistic constraint) in versions.tf.'
    );
  }

  // --- Gate: CI authenticates via OIDC, not long-lived keys ---
  if (plan.ciAuthMethod !== undefined) {
    if (!VALID_CI_AUTH.includes(plan.ciAuthMethod)) {
      fail(
        'invalid-ci-auth-method',
        'medium',
        `ciAuthMethod "${plan.ciAuthMethod}" is not one of: ${VALID_CI_AUTH.join(', ')}.`,
        'Declare oidc, long-lived-keys, or none.'
      );
    } else if (plan.ciAuthMethod === 'long-lived-keys') {
      fail(
        'long-lived-ci-credentials',
        'high',
        'ciAuthMethod is long-lived-keys: static cloud credentials in CI are a standing breach waiting for one leaked log.',
        'Use the CI provider\'s OIDC token to assume a scoped role (assume_role_with_web_identity) -- no stored credentials.'
      );
    }
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still dry-run a refactor with moved blocks in a non-prod state before touching production.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: terraform_module_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditTerraformModule(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`terraform_module_audit: ${e.message}\n`);
    process.exit(1);
  }
}
