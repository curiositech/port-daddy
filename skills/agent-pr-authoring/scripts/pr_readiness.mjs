#!/usr/bin/env node
// pr_readiness.mjs — deterministic audit of an agent-authored pull request
// before it is enqueued to merge. Pure stdlib, no deps.
//
// Usage:
//   node pr_readiness.mjs --input <pr-plan.json>
//
// Exports:
//   auditPullRequest(pr) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bounded, documented thresholds for "is this diff reviewable" — see
// references/gate-taxonomy.md for the rationale. These are deliberately
// generous (a real refactor PR can legitimately hit ~20 files); the point
// is to catch the "40 files, three unrelated concerns" PR, not to punish
// a large-but-coherent change.
const MAX_FILES_CHANGED = 25;
const MAX_LINES_CHANGED = 600;

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function assertShape(pr) {
  if (!pr || typeof pr !== 'object') {
    throw new Error('auditPullRequest: input must be a JSON object');
  }
  if (typeof pr.title !== 'string' || pr.title.trim() === '') {
    throw new Error('auditPullRequest: "title" is required and must be a non-empty string');
  }
  if (!pr.body || typeof pr.body !== 'object') {
    throw new Error('auditPullRequest: "body" object is required ({ hasSummary, hasTestPlan, testPlanHasEvidence })');
  }
  if (!pr.diff || typeof pr.diff !== 'object') {
    throw new Error('auditPullRequest: "diff" object is required ({ filesChanged, linesChanged, mixedConcerns })');
  }
  if (typeof pr.diff.filesChanged !== 'number' || typeof pr.diff.linesChanged !== 'number') {
    throw new Error('auditPullRequest: "diff.filesChanged" and "diff.linesChanged" must be numbers');
  }
  if (!Array.isArray(pr.checks)) {
    throw new Error('auditPullRequest: "checks" must be an array (may be empty)');
  }
  if (!Array.isArray(pr.reviewThreads)) {
    throw new Error('auditPullRequest: "reviewThreads" must be an array (may be empty)');
  }
  for (const [i, check] of pr.checks.entries()) {
    if (!check || typeof check.name !== 'string') {
      throw new Error(`auditPullRequest: checks[${i}] must have a string "name"`);
    }
    if (typeof check.required !== 'boolean' || typeof check.external !== 'boolean') {
      throw new Error(`auditPullRequest: checks[${i}] ("${check.name}") must have boolean "required" and "external"`);
    }
    if (typeof check.status !== 'string') {
      throw new Error(`auditPullRequest: checks[${i}] ("${check.name}") must have a string "status"`);
    }
  }
  for (const [i, thread] of pr.reviewThreads.entries()) {
    if (!thread || typeof thread.severity !== 'string' || typeof thread.resolved !== 'boolean') {
      throw new Error(`auditPullRequest: reviewThreads[${i}] must have a string "severity" and boolean "resolved"`);
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a pull request description + CI/review state against the
 * agent-pr-authoring bar: scoped diff, evidence-backed narrative, correct
 * gate triage, resolved review, and a clean landing path.
 *
 * @param {object} pr
 * @param {string} pr.title
 * @param {{hasSummary:boolean, hasTestPlan:boolean, testPlanHasEvidence:boolean}} pr.body
 * @param {{filesChanged:number, linesChanged:number, mixedConcerns?:boolean}} pr.diff
 * @param {Array<{name:string, required:boolean, status:string, external:boolean}>} pr.checks
 *   status is one of "success" | "failure" | "pending" | "neutral" | "skipped"
 * @param {Array<{severity:string, resolved:boolean}>} pr.reviewThreads
 *   severity is one of "critical" | "high" | "medium" | "low"
 * @param {string} [pr.mergeMethod] - "queue" | "squash" | "merge" | "rebase" | null
 * @param {boolean} [pr.usedAdminBypass]
 * @param {boolean} [pr.forcePushed]
 * @param {boolean} [pr.rebasedOnLatestBase]
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditPullRequest(pr) {
  assertShape(pr);

  const findings = [];
  const recommendations = [];

  // --- Narrative: Summary + Test Plan -------------------------------------
  if (!pr.body.hasSummary) {
    pushFinding(
      findings, 'critical', 'missing-summary',
      'PR body has no ## Summary section describing what changed and why.',
      'Add a ## Summary section: what changed, why, and what it does NOT do.',
      recommendations,
    );
  }
  if (!pr.body.hasTestPlan) {
    pushFinding(
      findings, 'critical', 'missing-test-plan',
      'PR body has no ## Test Plan section.',
      'Add a ## Test Plan section listing the exact commands run and observed results.',
      recommendations,
    );
  } else if (pr.body.testPlanHasEvidence === false) {
    pushFinding(
      findings, 'critical', 'test-plan-not-evidence-backed',
      'Test Plan exists but carries no command output, exit code, or artifact — a claim, not proof.',
      'Rewrite the Test Plan to paste real command output (or link a captured artifact) for every claim.',
      recommendations,
    );
  }

  // --- Diff shape ----------------------------------------------------------
  const { filesChanged, linesChanged, mixedConcerns } = pr.diff;
  if (filesChanged > MAX_FILES_CHANGED || linesChanged > MAX_LINES_CHANGED) {
    pushFinding(
      findings, 'high', 'oversized-diff',
      `Diff touches ${filesChanged} files / ${linesChanged} lines, over the reviewable thresholds (${MAX_FILES_CHANGED} files / ${MAX_LINES_CHANGED} lines).`,
      'Split the change into separate PRs by concern, or justify the size explicitly in the Summary.',
      recommendations,
    );
  }
  if (mixedConcerns === true) {
    pushFinding(
      findings, 'high', 'mixed-concerns',
      'Diff is flagged as mixing unrelated concerns (e.g. refactor + feature + dependency bump).',
      'Split into one PR per concern so each is independently reviewable and revertable.',
      recommendations,
    );
  }

  // --- Gate triage: required vs external -----------------------------------
  for (const check of pr.checks) {
    if (check.required && check.external) {
      pushFinding(
        findings, 'medium', 'external-check-marked-required',
        `Check "${check.name}" is marked both required and external — that's a contradiction that invites gate confusion.`,
        `Confirm branch protection's actual required-context list for "${check.name}"; external checks (e.g. Cloudflare Pages preview builds) should never be required contexts.`,
        recommendations,
      );
    }
    if (check.required && !check.external && check.status === 'failure') {
      pushFinding(
        findings, 'critical', 'required-check-failing',
        `Required, repo-owned check "${check.name}" is failing.`,
        `Fix the root cause of "${check.name}" — do not merge past a real required gate.`,
        recommendations,
      );
    }
    if (check.external && check.status === 'failure' && check.required) {
      // Already caught by external-check-marked-required, but call out the
      // specific "waiting on it" failure mode too.
      pushFinding(
        findings, 'medium', 'external-gate-treated-as-blocker',
        `External check "${check.name}" is failing and is (mis)configured as required — do not block the merge on it.`,
        `Reclassify "${check.name}" as non-blocking (it is an external deploy preview, not repo CI) and proceed once real required checks are green.`,
        recommendations,
      );
    }
  }

  // --- Review threads --------------------------------------------------------
  const unresolvedHigh = pr.reviewThreads.filter(
    (t) => !t.resolved && (t.severity === 'high' || t.severity === 'critical'),
  );
  if (unresolvedHigh.length > 0) {
    pushFinding(
      findings, 'critical', 'unresolved-high-review-threads',
      `${unresolvedHigh.length} unresolved high/critical review thread(s) remain.`,
      'Address every high/critical finding as a named fixup commit, or reply with a contested-because rationale, before landing.',
      recommendations,
    );
  }

  // --- Landing mechanics -----------------------------------------------------
  if (pr.usedAdminBypass === true) {
    // Distinguish the two very different uses of `--admin`: skipping a real
    // required repo gate (never OK) vs skipping only the BEHIND gate or an
    // external non-blocking check like a Cloudflare Pages preview — which some
    // repos (e.g. port-daddy, see port-daddy-internal-dev) document as correct.
    // Fail CLOSED: only downgrade to a non-blocking finding when we can PROVE
    // every required repo-owned check is green. An empty checks list, or any
    // required check that is pending/neutral/skipped/failing, means the bypass
    // may have skipped a real gate — treat that as critical, not safe.
    const requiredRepoChecks = pr.checks.filter((check) => check.required && !check.external);
    const allRequiredGreen =
      requiredRepoChecks.length > 0 && requiredRepoChecks.every((check) => check.status === 'success');
    if (!allRequiredGreen) {
      pushFinding(
        findings, 'critical', 'admin-bypass-skips-required-gate',
        'PR used an admin override without every required repo-owned check verified green (a required check is failing/pending/skipped, or none were reported) — the bypass may have skipped a real gate.',
        'Never use --admin to merge past a required gate that is not green; wait for/ fix the gate, or escalate to a human.',
        recommendations,
      );
    } else {
      pushFinding(
        findings, 'medium', 'admin-bypass-used',
        'PR used an admin override with no failing required gate — acceptable only to skip the BEHIND gate or an external non-blocking check (e.g. Cloudflare Pages), per the repo landing procedure.',
        'Prefer enqueuing and letting the merge queue handle a BEHIND branch; reserve --admin for external/non-blocking checks the repo documents as skippable, never a failing required gate.',
        recommendations,
      );
    }
  }
  if (pr.forcePushed === true) {
    pushFinding(
      findings, 'critical', 'force-pushed',
      'Branch was force-pushed after review or CI ran against it.',
      'Never force-push a PR branch; push additional named commits instead so review history stays intact.',
      recommendations,
    );
  }
  if (pr.rebasedOnLatestBase === false) {
    pushFinding(
      findings, 'high', 'stale-base',
      'Branch has not been rebased onto the latest base branch; mergeability can flip once another PR lands.',
      'Fetch and rebase onto the latest base branch, then re-check mergeability before enqueueing.',
      recommendations,
    );
  }
  if (typeof pr.mergeMethod === 'string' && pr.mergeMethod !== 'queue' && pr.mergeMethod !== '') {
    pushFinding(
      findings, 'medium', 'bypassed-merge-queue',
      `Merge method was explicitly set to "${pr.mergeMethod}" instead of letting the merge queue choose its configured strategy.`,
      'Enqueue the PR (e.g. gh pr merge <n> --auto) and let the merge queue apply its configured strategy rather than forcing --squash/--merge/--delete-branch by hand.',
      recommendations,
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 0), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('PR meets the readiness bar: scoped diff, evidence-backed narrative, real gates green, no bypasses. Enqueue it.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: pr_readiness.mjs --input <pr-plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditPullRequest(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`pr_readiness: ${error.message}\n`);
    process.exit(1);
  }
}
