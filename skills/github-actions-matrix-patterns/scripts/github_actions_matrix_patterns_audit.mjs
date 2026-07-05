#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_WORKFLOW_KINDS = ['pr-ci', 'release-ci', 'deploy'];
const VALID_PINNING = ['sha', 'major-tag', 'floating'];
const VALID_PERMISSIONS = ['read-all', 'write-all', 'unset'];
const VALID_CLOUD_AUTH = ['oidc', 'long-lived-secrets', 'none'];
const VALID_SUB_SCOPES = ['environment', 'branch-ref', 'repo-wildcard'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit a GitHub Actions workflow plan against github-actions-matrix-patterns'
 * Quality Gates: pinning, least-privilege permissions, OIDC over long-lived
 * secrets, matrix polarity, cache-key invalidation, concurrency, and
 * environment protection. All rules operate on structured enum/boolean/number
 * fields -- see schemas/github-actions-matrix-patterns-plan.schema.json.
 *
 * @param {unknown} plan
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditGithubActionsMatrixPatterns(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_WORKFLOW_KINDS.includes(plan.workflowKind)) {
    throw new TypeError(`plan.workflowKind must be one of: ${VALID_WORKFLOW_KINDS.join(', ')}`);
  }
  if (!VALID_PINNING.includes(plan.thirdPartyActionPinning)) {
    throw new TypeError(`plan.thirdPartyActionPinning must be one of: ${VALID_PINNING.join(', ')}`);
  }
  if (!VALID_PERMISSIONS.includes(plan.topLevelPermissions)) {
    throw new TypeError(`plan.topLevelPermissions must be one of: ${VALID_PERMISSIONS.join(', ')}`);
  }
  if (!VALID_CLOUD_AUTH.includes(plan.cloudAuth)) {
    throw new TypeError(`plan.cloudAuth must be one of: ${VALID_CLOUD_AUTH.join(', ')}`);
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

  // --- Gate: every third-party action pinned to a SHA or audited major tag ---
  if (plan.thirdPartyActionPinning === 'floating') {
    fail(
      'action-pinned-to-floating-ref',
      'high',
      'thirdPartyActionPinning is "floating": an upstream push to @main/@latest changes your CI without any commit to your repo.',
      'Pin third-party actions to a full commit SHA (or at minimum a security-reviewed major tag).'
    );
  }

  // --- Gate: top-level permissions read-all; per-job grants minimal ---
  if (plan.topLevelPermissions === 'write-all') {
    fail(
      'permissions-write-all',
      'critical',
      'topLevelPermissions is "write-all": a compromised action can exfiltrate a token with full repo write.',
      'Set top-level permissions: read-all and grant per-job (e.g. contents: read, id-token: write).'
    );
  } else if (plan.topLevelPermissions === 'unset') {
    fail(
      'permissions-implicit-default',
      'medium',
      'topLevelPermissions is "unset": the workflow inherits the repo default, which historically was write-all.',
      'Declare top-level permissions: read-all explicitly instead of relying on the inherited default.'
    );
  }

  // --- Gate: OIDC over long-lived cloud secrets; sub claim is the boundary ---
  if (plan.cloudAuth === 'long-lived-secrets') {
    fail(
      'long-lived-cloud-secrets',
      'high',
      'cloudAuth is "long-lived-secrets": static AWS/GCP/Cloudflare keys stored in repo secrets never expire and leak whole-account access.',
      'Switch to OIDC (permissions: id-token: write + a cloud trust policy) so tokens are short-lived and scoped.'
    );
  } else if (plan.cloudAuth === 'oidc') {
    if (plan.oidcSubClaimScope === undefined) {
      fail(
        'oidc-sub-claim-unspecified',
        'medium',
        'cloudAuth is "oidc" but oidcSubClaimScope is not declared; the sub condition is the actual security boundary of the trust policy.',
        'Declare oidcSubClaimScope: "environment" (repo:org/repo:environment:production) or "branch-ref" in the plan.'
      );
    } else if (!VALID_SUB_SCOPES.includes(plan.oidcSubClaimScope)) {
      throw new TypeError(`plan.oidcSubClaimScope must be one of: ${VALID_SUB_SCOPES.join(', ')}`);
    } else if (plan.oidcSubClaimScope === 'repo-wildcard') {
      fail(
        'oidc-sub-claim-too-permissive',
        'critical',
        'oidcSubClaimScope is "repo-wildcard" (sub: repo:org/repo:*): a fork PR ref can assume the deploy role.',
        'Tighten the trust policy sub condition to a specific ref (ref:refs/heads/main) or an environment claim.'
      );
    }
  }

  // --- Gate: fail-fast: false on release CI matrices ---
  if (plan.workflowKind === 'release-ci' && plan.failFast === true) {
    fail(
      'fail-fast-on-release-ci',
      'medium',
      'failFast is true on a release-ci matrix: the first failure cancels the rest, hiding every other broken cell.',
      'Set strategy.fail-fast: false for release CI so the matrix reports everything that is broken.'
    );
  }

  // --- Gate: exclude polarity -- excluding most of the matrix is inverted ---
  if (
    typeof plan.matrixCellCount === 'number' &&
    typeof plan.excludeCount === 'number' &&
    plan.matrixCellCount > 0 &&
    plan.excludeCount > plan.matrixCellCount / 2
  ) {
    fail(
      'matrix-exclude-inverted-polarity',
      'medium',
      `excludeCount (${plan.excludeCount}) removes more than half of the ${plan.matrixCellCount}-cell matrix: the polarity is inverted.`,
      'Build the small cell list explicitly with include: only, instead of expanding a big matrix and excluding most of it.'
    );
  }

  // --- Gate: concurrency cancellation on PR workflows ---
  if (plan.workflowKind === 'pr-ci' && plan.concurrencyCancelInProgress !== true) {
    fail(
      'no-concurrency-cancellation-on-pr',
      'medium',
      'workflowKind is pr-ci but concurrencyCancelInProgress is not true: outdated runs pile up on every push to the same branch.',
      'Add concurrency: { group: workflow-ref, cancel-in-progress: true } scoped to pull_request events.'
    );
  }

  // --- Gate: cache keys include a hash of the lockfile they cover ---
  if (plan.cacheKeyIncludesLockfileHash === false) {
    fail(
      'cache-key-never-invalidates',
      'high',
      'cacheKeyIncludesLockfileHash is false: the cache key never invalidates when dependencies change, serving stale installs forever.',
      "Include hashFiles('<lockfile>') in the primary cache key; keep restore-keys as the partial-hit fallback only."
    );
  }

  // --- Gate: production deploys behind an environment with protection rules ---
  if (plan.workflowKind === 'deploy' && plan.deployBehindEnvironment !== true) {
    fail(
      'deploy-without-environment-protection',
      'high',
      'workflowKind is deploy but deployBehindEnvironment is not true: no required reviewers, branch policy, or environment-scoped secrets gate the deploy.',
      'Set environment: production on the deploy job so GitHub protection rules apply, instead of baking approvals into workflow logic.'
    );
  }

  // --- Gate: never inherit secrets to fork PRs ---
  if (plan.secretsInheritToForkPRs === true) {
    fail(
      'secrets-inherited-by-fork-prs',
      'critical',
      'secretsInheritToForkPRs is true: a malicious fork PR can read repository secrets through the called workflow.',
      'Never pass secrets: inherit to workflows triggered by fork PRs; gate secret-bearing jobs on pull_request_target with explicit checks or require the environment claim.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push(
      'Plan clears every quality gate this skill checks. Still dry-run the workflow on a branch and confirm the OIDC role assumption succeeds before trusting the first production deploy.'
    );
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: github_actions_matrix_patterns_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditGithubActionsMatrixPatterns(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`github_actions_matrix_patterns_audit: ${e.message}\n`);
    process.exit(1);
  }
}
