#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INTERNAL_DEP_PROTOCOLS = ['workspace', 'semver-range', 'file'];
const VERSION_SOURCES = ['catalog', 'per-package', 'overrides'];
const PEER_FIXES = ['declared-peer', 'package-extensions', 'auto-install-peers', 'shamefully-hoist', 'none'];
const PUBLISH_COMMANDS = ['pnpm-publish', 'npm-publish', 'none'];
const TASK_RUNNERS = ['turbo', 'nx', 'plain-pnpm', 'none'];

function assertPlanObject(plan) {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
}

/**
 * Audit a pnpm workspace/monorepo plan against pnpm-workspace-monorepo's
 * Anti-patterns and Quality Gates.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/pnpm-workspace-monorepo-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditPnpmWorkspaceMonorepo(plan) {
  assertPlanObject(plan);
  if (!INTERNAL_DEP_PROTOCOLS.includes(plan.internalDepProtocol)) {
    throw new TypeError(`plan.internalDepProtocol must be one of: ${INTERNAL_DEP_PROTOCOLS.join(', ')}`);
  }
  if (!VERSION_SOURCES.includes(plan.sharedVersionSource)) {
    throw new TypeError(`plan.sharedVersionSource must be one of: ${VERSION_SOURCES.join(', ')}`);
  }
  if (typeof plan.lockfileCommitted !== 'boolean') {
    throw new TypeError('plan.lockfileCommitted must be a boolean');
  }
  if (typeof plan.ciFrozenLockfile !== 'boolean') {
    throw new TypeError('plan.ciFrozenLockfile must be a boolean');
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

  // --- Gate 1: shamefully-hoist defeats pnpm's strictness ---
  if (plan.shamefullyHoist === true) {
    fail('shamefully-hoist-enabled', 'critical',
      'shamefullyHoist is true: it reintroduces npm-style implicit deps, hiding the exact class of bug pnpm exists to catch, and CI breaks the moment hoisting differs.',
      'Remove shamefully-hoist; declare the missing peer/dep, or patch it non-disruptively via packageExtensions.');
  }
  if (PEER_FIXES.includes(plan.missingPeerFix) && plan.missingPeerFix === 'shamefully-hoist') {
    fail('peer-fixed-by-hoisting', 'critical',
      'missingPeerFix is "shamefully-hoist": the missing peer is a real bug being hidden under hoisting.',
      'Add the peer to peerDependencies or extend the broken package via packageExtensions (with the upstream issue link as a comment).');
  }

  // --- Gate 2: publishing must go through pnpm ---
  if (PUBLISH_COMMANDS.includes(plan.publishCommand) && plan.publishCommand === 'npm-publish') {
    fail('npm-publish-in-pnpm-workspace', 'critical',
      'publishCommand is "npm-publish": raw npm publish ships literal workspace:* ranges, which choke every consumer.',
      'Use pnpm publish (it rewrites workspace:* to real semver) and pnpm pack to inspect the tarball first.');
  }

  // --- Gate 3: lockfile discipline ---
  if (plan.lockfileCommitted !== true) {
    fail('lockfile-not-committed', 'critical',
      'lockfileCommitted is not true: without pnpm-lock.yaml in the repo, every install resolves differently and CI is non-reproducible.',
      'Commit pnpm-lock.yaml and treat lockfile diffs as reviewable changes.');
  }
  if (plan.ciFrozenLockfile !== true) {
    fail('ci-not-frozen-lockfile', 'critical',
      'ciFrozenLockfile is not true: CI installs that silently rewrite the lockfile mask drift and produce untested dependency trees.',
      'Run pnpm install --frozen-lockfile in CI so any lockfile change fails the build.');
  }

  // --- Gate 4: internal deps on the workspace protocol ---
  if (plan.internalDepProtocol !== 'workspace') {
    fail('internal-deps-not-workspace-protocol', 'high',
      `internalDepProtocol is "${plan.internalDepProtocol}": semver/file references to sibling packages resolve to the registry or stale paths instead of the local source.`,
      'Reference sibling packages as workspace:* so installs link locally and publishes rewrite to real ranges.');
  }

  // --- Gate 5: shared versions live in the catalog ---
  if (plan.sharedVersionSource === 'per-package') {
    fail('shared-versions-per-package', 'high',
      'sharedVersionSource is "per-package": one bump in one package.json and half the workspace is on react@^19 while the other half is on ^18.',
      'Adopt the catalog protocol (catalog: in pnpm-workspace.yaml) as the single source of truth; add pnpm.overrides for transitive single-version enforcement.');
  }

  // --- Gate 6: turbo cache must reflect real inputs ---
  if (TASK_RUNNERS.includes(plan.taskRunner) && plan.taskRunner === 'turbo' && plan.turboInputsDeclared !== true) {
    fail('turbo-inputs-undeclared', 'high',
      'taskRunner is turbo but turboInputsDeclared is not true: turbo defaults to hashing everything in the package, so any unrelated file change busts the cache.',
      'Declare inputs per task (e.g. ["src/**/*.{ts,tsx}", "package.json", "tsconfig.json"]) so cache hits reflect real dependencies.');
  }

  // --- Gate 7: CI builds only what changed ---
  if (plan.ciAffectedOnlyFilter !== true) {
    fail('ci-builds-everything', 'medium',
      'ciAffectedOnlyFilter is not true: every PR rebuilds and retests the whole workspace.',
      'Use --filter "...[origin/main]" so CI touches only affected packages and their dependents.');
  }

  // --- Gate 8: TS project references mirror the graph ---
  if (plan.usesTypescript === true && plan.tsProjectReferencesMirrorGraph !== true) {
    fail('ts-references-drift', 'medium',
      'usesTypescript is true but tsProjectReferencesMirrorGraph is not: tsc -b builds in the wrong order or misses incremental rebuilds when references drift from actual deps.',
      'Keep tsconfig references in lockstep with workspace dependencies (composite: true in the shared base).');
  }

  // --- Gate 9: postinstall scripts are an attack surface ---
  if (plan.postinstallAllowlist !== true) {
    fail('open-postinstall-surface', 'medium',
      'postinstallAllowlist is not true: any transitive dep\'s lifecycle script runs with your env (and your secrets) at install time.',
      'Allowlist build scripts via pnpm.onlyBuiltDependencies and use --ignore-scripts on sensitive CI paths.');
  }

  // --- Gate 10: engines pinned ---
  if (plan.enginesNodeSet !== true) {
    fail('engines-node-unset', 'low',
      'enginesNodeSet is not true: packages do not declare the Node version the repo actually targets.',
      'Set engines.node in every package to match the repo Node version.');
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Plan clears every gate this skill checks. Still verify with a clean clone: pnpm install --frozen-lockfile, then turbo build twice and confirm the second run is fully cached.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: pnpm_workspace_monorepo_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditPnpmWorkspaceMonorepo(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`pnpm_workspace_monorepo_audit: ${e.message}\n`);
    process.exit(1);
  }
}
