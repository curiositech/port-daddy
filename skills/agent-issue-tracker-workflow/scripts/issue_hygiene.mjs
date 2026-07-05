#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const VALID_STATUSES = ['todo', 'in-progress', 'done'];

const DEFAULT_POLICY = {
  requireAcceptanceCriteria: true,
  requireDedupeSearch: true,
  requireLinkedArtifactForActiveWork: true,
  requireEvidenceForDone: true,
  minLegibilityScore: 0.75,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Audit a plan describing a set of tracker items (Jira/Linear/GitHub Issues)
 * and how an agent handled each one.
 *
 * This does NOT do textual duplicate detection (no keyword matching over
 * titles/bodies — that has catastrophic recall). It audits the agent's
 * reported DISCIPLINE: did it search before creating, is the item actionable,
 * does status match observable linked work, is "done" backed by evidence, and
 * was newly-discovered work captured as new items instead of scope-creeping
 * the current one.
 *
 * @param {unknown} plan - { policy?: object, items: Array<Item> }
 *   Item: { id, title, status, hasAcceptanceCriteria, dedupeSearched,
 *           linkedArtifacts: string[], evidenceOnDone: null | {ref, validated},
 *           spawnedItemsCaptured: null | boolean }
 * @returns {{pass: boolean, legibilityScore: number, findings: Array<{id: string, itemId: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditIssueWorkflow(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }
  if (!Array.isArray(plan.items)) {
    throw new Error('plan.items must be an array');
  }

  const policy = { ...DEFAULT_POLICY, ...(isPlainObject(plan.policy) ? plan.policy : {}) };
  const findings = [];
  const recommendations = [];
  const seenIds = new Set();

  function flag(itemId, id, severity, message, recommendation) {
    findings.push({ id, itemId, severity, message });
    if (recommendation) recommendations.push(recommendation);
  }

  if (plan.items.length === 0) {
    return {
      pass: true,
      legibilityScore: 1,
      findings: [],
      recommendations: ['No items to audit; nothing filed, nothing to trace.'],
    };
  }

  let activeCount = 0;
  let activeLinkedCount = 0;

  for (const item of plan.items) {
    if (!isPlainObject(item)) {
      throw new Error('every plan.items entry must be an object');
    }
    if (!isNonEmptyString(item.id)) {
      throw new Error('every item requires a non-empty string id');
    }
    if (!isNonEmptyString(item.title)) {
      throw new Error(`item ${item.id} requires a non-empty string title`);
    }
    if (seenIds.has(item.id)) {
      throw new Error(`duplicate item id in plan: ${item.id}`);
    }
    seenIds.add(item.id);
    if (!VALID_STATUSES.includes(item.status)) {
      throw new Error(`item ${item.id} has invalid status "${item.status}"; expected one of ${VALID_STATUSES.join(', ')}`);
    }

    const linkedArtifacts = Array.isArray(item.linkedArtifacts) ? item.linkedArtifacts : [];
    const isActive = item.status !== 'todo';

    // --- 1. Duplicate-issue spray: was a search done before filing/starting? ---
    if (policy.requireDedupeSearch && item.dedupeSearched !== true) {
      const severity = isActive ? 'high' : 'medium';
      flag(
        item.id,
        'no-dedupe-search',
        severity,
        `"${item.title}" (${item.id}) was not confirmed searched against the existing tracker before filing/starting; a duplicate may already exist.`,
        `Search the tracker for "${item.title}" before continuing ${item.id}; if a match exists, close this one as a duplicate and link it instead.`
      );
    }

    // --- 2. Actionability: does the item have acceptance criteria a reviewer can check? ---
    if (policy.requireAcceptanceCriteria && item.hasAcceptanceCriteria !== true) {
      const severity = item.status === 'done' ? 'critical' : item.status === 'in-progress' ? 'high' : 'medium';
      flag(
        item.id,
        'missing-acceptance-criteria',
        severity,
        `${item.id} has no acceptance criteria; there is nothing explicit a reviewer can check the work against.`,
        `Add explicit, checkable acceptance criteria to ${item.id} before marking it further along than todo.`
      );
    }

    // --- 3. Orphan work: active status with nothing linking it to a diff. ---
    if (policy.requireLinkedArtifactForActiveWork && isActive) {
      activeCount += 1;
      if (linkedArtifacts.length > 0) {
        activeLinkedCount += 1;
      } else {
        const severity = item.status === 'done' ? 'critical' : 'high';
        flag(
          item.id,
          'orphan-work',
          severity,
          `${item.id} is "${item.status}" but has no linked branch, PR, or commit; the work is not traceable item -> diff.`,
          `Link ${item.id} to its branch/PR/commit (e.g. a Roadmap-Item/issue-key trailer or PR reference) so the item traces to its diff.`
        );
      }
    }

    // --- 4. Status theater: "done" with no validated evidence. ---
    if (item.status === 'done' && policy.requireEvidenceForDone) {
      const evidence = item.evidenceOnDone;
      const validated = isPlainObject(evidence) && evidence.validated === true && isNonEmptyString(evidence.ref);
      if (!validated) {
        flag(
          item.id,
          'status-theater',
          'critical',
          `${item.id} is marked "done" but evidenceOnDone is missing or unvalidated; a status transition to done must reflect observed, checked work, not optimism.`,
          `Do not move ${item.id} to done until you have a validated evidence.ref (PR/commit/artifact) that a reviewer can open and check.`
        );
      }
    }

    // --- 5. Scope creep: discovered work not captured as new items. ---
    if (item.spawnedItemsCaptured === false) {
      flag(
        item.id,
        'uncaptured-spawned-work',
        'medium',
        `${item.id} surfaced new work mid-task that was not captured as new tracker items; this risks silent scope creep on the current item.`,
        `File the newly-discovered work under ${item.id} as its own item(s) instead of folding it into this one's scope.`
      );
    }
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const legibilityScore = activeCount === 0 ? 1 : Math.round((activeLinkedCount / activeCount) * 1000) / 1000;

  const pass = criticalCount === 0 && legibilityScore >= policy.minLegibilityScore;

  if (findings.length === 0) {
    recommendations.push('Plan is legible: every active item is searched, actionable, linked, and (if done) evidenced. Spot-check that a linked artifact actually matches the item before trusting the score.');
  }

  // Sort findings worst-first so tooling and humans see the sharpest issue first.
  findings.sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));

  return { pass, legibilityScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: issue_hygiene.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditIssueWorkflow(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`issue_hygiene: ${error.message}\n`);
    process.exit(1);
  }
}
