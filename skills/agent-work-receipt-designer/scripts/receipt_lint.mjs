#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const CONTAINMENT_THREAT_CLASSES = [
  'ssrf',
  'path-traversal',
  'secret-exfil',
  'resource-exhaustion',
  'side-effect-write',
];

const SECTION_WEIGHTS = {
  identity: 8,
  intent: 8,
  contextUsed: 6,
  actions: 14,
  validation: 24,
  spend: 6,
  risks: 14,
  rollback: 10,
  provenance: 10,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Lint a normalized agent work receipt.
 *
 * Checks structural completeness against the required sections in
 * schemas/work-receipt.schema.json, then applies discipline checks that a
 * schema alone cannot express: validation must be artifact-backed (never a
 * bare "tests passed" claim), risks must be ranked reviewer-first, a diff
 * summary must exist, and a rollback pointer must be present.
 *
 * @param {unknown} receipt - parsed JSON receipt object.
 * @param {{requireContainment?: boolean}} [options] - Dream Rig and other hostile-code runners set requireContainment=true.
 * @returns {{pass: boolean, score: number, missingFields: string[], findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function lintReceipt(receipt, options = {}) {
  if (!isPlainObject(receipt)) {
    throw new Error('receipt must be a JSON object');
  }

  const missingFields = [];
  const findings = [];
  const recommendations = [];
  let score = 0;
  let criticalHit = false;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
  }

  // --- identity ---
  const identity = receipt.identity;
  if (!isPlainObject(identity)) {
    missingFields.push('identity');
    fail(
      'missing-identity',
      'high',
      'No identity block: who/what backend/which session cannot be attributed.',
      'Add identity.agent, identity.backend, identity.sessionId.',
    );
  } else {
    const need = ['agent', 'backend', 'sessionId'].filter(
      (k) => !isNonEmptyString(identity[k]),
    );
    if (need.length === 0) {
      score += SECTION_WEIGHTS.identity;
    } else {
      missingFields.push(...need.map((k) => `identity.${k}`));
      fail(
        'incomplete-identity',
        'medium',
        `identity missing: ${need.join(', ')}`,
        'Fill identity.agent/backend/sessionId so the receipt survives outside its originating tool.',
      );
      score += SECTION_WEIGHTS.identity * (1 - need.length / 3);
    }
  }

  // --- intent ---
  const intent = receipt.intent;
  if (!isPlainObject(intent)) {
    missingFields.push('intent');
    fail(
      'missing-intent',
      'high',
      'No intent block: reviewer cannot tell what the agent was trying to do or when to stop.',
      'Add intent.goal, intent.scope, intent.stopCondition.',
    );
  } else {
    const need = ['goal', 'stopCondition'].filter(
      (k) => !isNonEmptyString(intent[k]),
    );
    if (!Array.isArray(intent.scope) || intent.scope.length === 0)
      need.push('scope');
    if (need.length === 0) {
      score += SECTION_WEIGHTS.intent;
    } else {
      missingFields.push(...need.map((k) => `intent.${k}`));
      fail(
        'incomplete-intent',
        'medium',
        `intent missing: ${need.join(', ')}`,
        'State the stop condition explicitly ("done when X test is green"), not just a task description.',
      );
      score += SECTION_WEIGHTS.intent * (1 - need.length / 3);
    }
  }

  // --- contextUsed ---
  const contextUsed = receipt.contextUsed;
  if (!isPlainObject(contextUsed) || !Array.isArray(contextUsed.filesRead)) {
    missingFields.push('contextUsed.filesRead');
    fail(
      'missing-context',
      'medium',
      'No record of files/rules the agent actually used as context.',
      'Log contextUsed.filesRead and contextUsed.rulesApplied (CLAUDE.md/AGENTS.md/ADRs) so a reviewer can spot stale-context bugs.',
    );
  } else {
    score += SECTION_WEIGHTS.contextUsed;
    if (
      !Array.isArray(contextUsed.rulesApplied) ||
      contextUsed.rulesApplied.length === 0
    ) {
      recommendations.push(
        'Consider recording contextUsed.rulesApplied so a reviewer can see which house rules governed this change.',
      );
    }
  }

  // --- actions ---
  const actions = receipt.actions;
  if (!isPlainObject(actions)) {
    missingFields.push('actions');
    fail(
      'missing-actions',
      'high',
      'No actions block: no commands, tool calls, or diff summary recorded.',
      'Add actions.commands (with exitCode) and actions.filesChanged.diffSummary.',
    );
  } else {
    let actionScore = SECTION_WEIGHTS.actions;
    const commands = Array.isArray(actions.commands) ? actions.commands : null;
    if (!commands || commands.length === 0) {
      missingFields.push('actions.commands');
      fail(
        'no-commands-logged',
        'medium',
        'No commands were logged for this task.',
        'Capture every executed command, even read-only ones, with its exit code.',
      );
      actionScore -= SECTION_WEIGHTS.actions * 0.4;
    } else {
      const missingExitCode = commands.filter(
        (c) => typeof c.exitCode !== 'number',
      );
      if (missingExitCode.length > 0) {
        fail(
          'command-missing-exit-code',
          'high',
          `${missingExitCode.length} of ${commands.length} logged command(s) have no exitCode.`,
          'Every logged command must carry a real process exit code, not a description of what happened.',
        );
        actionScore -=
          SECTION_WEIGHTS.actions *
          0.3 *
          (missingExitCode.length / commands.length);
      }
    }
    const filesChanged = actions.filesChanged;
    if (
      !isPlainObject(filesChanged) ||
      !isNonEmptyString(filesChanged.diffSummary)
    ) {
      missingFields.push('actions.filesChanged.diffSummary');
      fail(
        'no-diff-summary',
        'high',
        'No diff summary: reviewer has to reconstruct what changed by reading the whole diff cold.',
        'Add actions.filesChanged.diffSummary (e.g. "+142 -38 across 5 files") plus added/modified/deleted path lists.',
      );
      actionScore -= SECTION_WEIGHTS.actions * 0.3;
    }
    score += Math.max(0, actionScore);
  }

  // --- validation (the load-bearing section) ---
  const validation = receipt.validation;
  if (!isPlainObject(validation)) {
    missingFields.push('validation');
    fail(
      'missing-validation',
      'critical',
      'No validation block at all: nothing distinguishes this from an unverified claim.',
      'Add validation.tests with real exitCode/artifactPath per test, and validation.artifactBacked.',
    );
  } else {
    const tests = Array.isArray(validation.tests) ? validation.tests : [];
    if (tests.length === 0) {
      fail(
        'no-tests-recorded',
        'critical',
        'validation.tests is empty: no evidence anything was checked.',
        'Record at least one test/command run with its result, even if it is just a smoke check.',
      );
    }
    const passedTests = tests.filter((t) => t && t.passed === true);
    const selfReported = passedTests.filter(
      (t) =>
        typeof t.exitCode !== 'number' && !isNonEmptyString(t.artifactPath),
    );
    if (selfReported.length > 0) {
      fail(
        'self-reported-validation',
        'critical',
        `${selfReported.length} test(s) marked passed=true with no exitCode and no artifactPath: this is a self-reported claim ("agent says tests passed"), not proof.`,
        'Never mark a test passed without a captured exit code or an artifact (stdout/coverage/screenshot). Re-run and capture the evidence, or mark it unverified.',
      );
    }
    if (validation.artifactBacked === false && passedTests.length > 0) {
      fail(
        'artifact-backed-flag-false',
        'high',
        'validation.artifactBacked is explicitly false while tests are marked passed.',
        'Either capture real artifacts and set artifactBacked=true, or stop claiming the tests passed.',
      );
    }
    if (validation.artifactBacked === true && selfReported.length > 0) {
      fail(
        'artifact-backed-flag-lying',
        'critical',
        'validation.artifactBacked=true but at least one passed test has no evidence backing it.',
        'artifactBacked must only be true when every passed test has an exitCode or artifactPath.',
      );
    }

    if (
      tests.length > 0 &&
      selfReported.length === 0 &&
      validation.artifactBacked !== false
    ) {
      score += SECTION_WEIGHTS.validation;
    } else if (tests.length > 0) {
      // Partial credit only for tests that ARE backed; self-reports earn nothing.
      const backedCount = tests.length - selfReported.length;
      score += SECTION_WEIGHTS.validation * (backedCount / tests.length) * 0.5;
    }
  }

  // --- adversarial containment (required by Dream Rig, validated when present) ---
  const containment = receipt.containment;
  if (options.requireContainment === true && !isPlainObject(containment)) {
    missingFields.push('containment');
    fail(
      'missing-containment',
      'critical',
      'This receipt requires adversarial containment evidence, but no containment report is attached.',
      'Run every declared hostile probe and attach a passing pd.agent-harbor.dream-rig-containment-report.v0 report before treating the receipt as strong.',
    );
  }
  if (containment !== undefined && !isPlainObject(containment)) {
    fail(
      'invalid-containment',
      'critical',
      'containment is present but is not a report object.',
      'Attach the normalized containment report object, not prose or a boolean.',
    );
  } else if (isPlainObject(containment)) {
    const containmentProblems = [];
    if (
      containment.schema !== 'pd.agent-harbor.dream-rig-containment-report.v0'
    ) {
      containmentProblems.push('schema discriminator is missing or unknown');
    }
    if (containment.pass !== true)
      containmentProblems.push('report pass is not true');
    if (
      !Array.isArray(containment.findings) ||
      containment.findings.length > 0
    ) {
      containmentProblems.push('report findings are missing or non-empty');
    }

    const probeResults = Array.isArray(containment.probeResults)
      ? containment.probeResults
      : [];
    const seenCaseIds = new Set();
    for (const result of probeResults) {
      if (!isPlainObject(result) || !isNonEmptyString(result.caseId)) {
        containmentProblems.push('a probe result has no caseId');
        continue;
      }
      if (seenCaseIds.has(result.caseId))
        containmentProblems.push(`probe '${result.caseId}' is duplicated`);
      seenCaseIds.add(result.caseId);
      if (result.contained !== true)
        containmentProblems.push(`probe '${result.caseId}' is not contained`);
      if (
        typeof result.exitCode !== 'number' &&
        !isNonEmptyString(result.artifactPath)
      ) {
        containmentProblems.push(
          `probe '${result.caseId}' has no machine evidence`,
        );
      }
    }

    for (const threatClass of CONTAINMENT_THREAT_CLASSES) {
      const coverage = isPlainObject(containment.coverageByThreatClass)
        ? containment.coverageByThreatClass[threatClass]
        : null;
      const scopedResults = probeResults.filter(
        (result) => result?.threatClass === threatClass,
      );
      const evidencedResults = scopedResults.filter(
        (result) =>
          result?.contained === true &&
          (typeof result.exitCode === 'number' ||
            isNonEmptyString(result.artifactPath)),
      );
      if (
        !isPlainObject(coverage) ||
        !Number.isInteger(coverage.total) ||
        coverage.total < 1 ||
        coverage.containedAssertions !== coverage.total ||
        coverage.evidencedContainments !== coverage.total ||
        coverage.containmentRate !== 1 ||
        scopedResults.length !== coverage.total ||
        evidencedResults.length !== coverage.total
      ) {
        containmentProblems.push(
          `threat class '${threatClass}' lacks complete evidence-backed coverage`,
        );
      }
    }

    if (containmentProblems.length > 0) {
      fail(
        'containment-not-proven',
        'critical',
        `Containment cannot authorize this receipt: ${[...new Set(containmentProblems)].join('; ')}.`,
        'Keep the receipt weak/blocked until every declared hostile class has one internally consistent, evidence-backed contained result.',
      );
    }
  }

  // --- spend ---
  const spend = receipt.spend;
  if (!isPlainObject(spend) || Object.keys(spend).length === 0) {
    missingFields.push('spend');
    fail(
      'missing-spend',
      'low',
      'No spend/budget data recorded.',
      'Record at least costUsd or tokensIn/tokensOut so reviewers and operators can see what the task cost.',
    );
  } else {
    const hasSignal = ['tokensIn', 'tokensOut', 'costUsd', 'wallClockMs'].some(
      (k) => typeof spend[k] === 'number',
    );
    score += hasSignal ? SECTION_WEIGHTS.spend : SECTION_WEIGHTS.spend * 0.3;
    if (!hasSignal) {
      recommendations.push(
        'spend block is present but empty of real numbers; record at least wallClockMs or costUsd.',
      );
    }
  }

  // --- risks (ranked, reviewer-first) ---
  const risks = Array.isArray(receipt.risks) ? receipt.risks : null;
  if (risks === null) {
    missingFields.push('risks');
    fail(
      'missing-risks',
      'high',
      'No risks array: cannot tell if the agent found nothing risky or just did not say.',
      'Add risks[] with description + severity, even if the only entry is "none identified, low confidence".',
    );
  } else if (risks.length === 0) {
    fail(
      'empty-risks',
      'medium',
      'risks is an empty array. On any nontrivial change this is suspicious rather than reassuring.',
      'State explicitly why no risks remain, or list the ones that are merely low severity.',
    );
    score += SECTION_WEIGHTS.risks * 0.3;
  } else {
    const ranks = risks.map((r) => SEVERITY_RANK[r.severity] ?? 0);
    const isDescending = ranks.every(
      (rank, i) => i === 0 || rank <= ranks[i - 1],
    );
    if (!isDescending) {
      fail(
        'risks-not-reviewer-first',
        'medium',
        'risks[] is not ordered most-severe-first, forcing the reviewer to scan the whole list to find what matters.',
        'Sort risks descending by severity (critical, high, medium, low) so the first entry is what to check first.',
      );
      score += SECTION_WEIGHTS.risks * 0.6;
    } else {
      score += SECTION_WEIGHTS.risks;
    }
    const hasCheckFirst = risks.some((r) => r.checkFirst === true);
    if (!hasCheckFirst && ranks[0] >= SEVERITY_RANK.high) {
      recommendations.push(
        'Mark the top risk with checkFirst: true so tooling can surface it without re-deriving severity order.',
      );
    }
  }

  // --- rollback ---
  const rollback = receipt.rollback;
  if (!isPlainObject(rollback) || !isNonEmptyString(rollback.checkpoint)) {
    missingFields.push('rollback.checkpoint');
    fail(
      'no-rollback-pointer',
      'high',
      'No rollback/checkpoint pointer: reversing this change requires spelunking git log by hand.',
      'Add rollback.checkpoint (git sha, stash ref, snapshot id) and rollback.method.',
    );
  } else {
    score += SECTION_WEIGHTS.rollback * (rollback.verified === true ? 1 : 0.75);
    if (rollback.verified !== true) {
      recommendations.push(
        'rollback.verified is not true; consider actually exercising the rollback path once, not just naming a checkpoint.',
      );
    }
  }

  // --- provenance ---
  const provenance = receipt.provenance;
  if (!isPlainObject(provenance) || !isNonEmptyString(provenance.contentHash)) {
    missingFields.push('provenance.contentHash');
    fail(
      'no-provenance',
      'medium',
      'No content hash or signature: the receipt cannot be checked for tampering or attributed with confidence after the session ends.',
      'Add provenance.contentHash (hash of the receipt body) and, where identity matters, provenance.signedBy/signature.',
    );
  } else {
    score +=
      SECTION_WEIGHTS.provenance *
      (isNonEmptyString(provenance.signedBy) ? 1 : 0.7);
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && missingFields.length === 0 && clampedScore >= 80;

  if (findings.length === 0) {
    recommendations.push(
      'Receipt is structurally complete. Spot-check that the diff summary and top risk actually match the real change before trusting the score.',
    );
  }

  return {
    pass,
    score: clampedScore,
    missingFields,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1])
    throw new Error('usage: receipt_lint.mjs --input <receipt>.json');
  return {
    input: argv[i + 1],
    requireContainment: argv.includes('--require-containment'),
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const { input, requireContainment } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(
      `${JSON.stringify(lintReceipt(data, { requireContainment }), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`receipt_lint: ${error.message}\n`);
    process.exit(1);
  }
}
