#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECTION_WEIGHTS = {
  framework: 10,
  mcp: 10,
  observability: 10,
  evaluation: 8,
  costControls: 14,
  memoryArchitecture: 6,
  pilotScope: 12,
  roiFramework: 6,
  stakeholderComms: 4,
  hitl: 12,
  successCriteria: 4,
  adoptionPlan: 4,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Audit an agentic infrastructure plan against this skill's Quality Gates
 * (Technical Infrastructure / Organizational Readiness / Production Readiness
 * sections of SKILL.md).
 *
 * Deterministic, structured-field checks only -- no keyword/NLP matching over
 * free text. The input is a JSON plan describing framework choice, MCP setup,
 * observability, cost controls, memory architecture, pilot scope, and
 * organizational readiness signals.
 *
 * @param {unknown} plan - parsed JSON infra plan.
 * @returns {{pass: boolean, score: number, findings: Array<{id: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditInfraReadiness(plan) {
  if (!isPlainObject(plan)) {
    throw new Error('plan must be a JSON object');
  }

  const findings = [];
  const recommendations = [];
  let score = 0;
  let criticalHit = false;

  function fail(id, severity, message, recommendation) {
    findings.push({ id, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
  }

  // --- 1. Framework selection criteria ---
  const framework = plan.framework;
  if (!isPlainObject(framework) || !isNonEmptyString(framework.selected)) {
    fail('no-framework-selected', 'high', 'No framework has been named as selected.', 'Name the selected framework (LangGraph, CrewAI, Semantic Kernel, MCP, etc.).');
  } else if (!isNonEmptyArray(framework.decisionCriteria)) {
    fail('no-framework-criteria', 'critical', 'Framework was selected but no decision criteria were documented -- this is Framework-First Thinking (Failure Mode #1).', 'Document the workflow shapes and constraints that drove the choice before adopting the framework.');
    score += SECTION_WEIGHTS.framework * 0.3;
  } else {
    score += SECTION_WEIGHTS.framework;
  }

  // --- 2. MCP context overhead / lazy loading ---
  const mcp = plan.mcp;
  if (isPlainObject(mcp) && mcp.used) {
    const overhead = typeof mcp.contextOverheadPct === 'number' ? mcp.contextOverheadPct : null;
    const lazy = mcp.lazyLoading === true;
    if (overhead !== null && overhead >= 50 && !lazy) {
      fail('mcp-context-overload', 'critical', `MCP tool schemas consume ${overhead}% of context with no lazy loading -- Context Budget Explosion (Failure Mode #2).`, 'Implement lazy tool loading (load schemas on-demand) and/or a tool routing layer.');
      score += SECTION_WEIGHTS.mcp * 0.2;
    } else if (overhead === null) {
      fail('mcp-overhead-unmeasured', 'medium', 'MCP is used but context overhead was never measured.', 'Measure MCP tool schema context consumption and keep it below 50%.');
      score += SECTION_WEIGHTS.mcp * 0.5;
    } else {
      score += SECTION_WEIGHTS.mcp;
    }
  } else {
    score += SECTION_WEIGHTS.mcp; // MCP not in use -- gate does not apply.
  }

  // --- 3. Observability ---
  const observability = plan.observability;
  if (!isPlainObject(observability) || observability.wired !== true) {
    fail('missing-observability', 'critical', 'No observability pipeline is wired -- Observability Debt (Failure Mode #3).', 'Wire LangSmith/Braintrust/Langfuse (or equivalent) before the first production run; instrument request/trace/quality/drift levels.');
  } else {
    score += SECTION_WEIGHTS.observability;
    if (!isNonEmptyArray(observability.instrumentedLevels)) {
      recommendations.push('Record which levels (request/trace/quality/drift) observability actually instruments.');
    }
  }

  // --- 4. Evaluation suite ---
  const evaluation = plan.evaluation;
  if (!isPlainObject(evaluation) || evaluation.suiteExists !== true) {
    fail('missing-evaluation-suite', 'high', 'No evaluation suite exists.', 'Stand up unit/trajectory/end-to-end evaluation in parallel with development, not after.');
  } else {
    const coverage = isNonEmptyArray(evaluation.coverage) ? evaluation.coverage : [];
    const need = ['unit', 'trajectory', 'end-to-end'].filter((k) => !coverage.includes(k));
    if (need.length > 0) {
      fail('incomplete-evaluation-coverage', 'medium', `Evaluation suite is missing coverage: ${need.join(', ')}.`, 'Extend the evaluation suite to cover unit, trajectory, and end-to-end levels.');
      score += SECTION_WEIGHTS.evaluation * (1 - need.length / 3);
    } else {
      score += SECTION_WEIGHTS.evaluation;
    }
  }

  // --- 5. Cost controls / kill switch ---
  const costControls = plan.costControls;
  if (!isPlainObject(costControls)) {
    fail('missing-cost-controls', 'critical', 'No cost controls are documented -- Cost Runaway (Failure Mode #5).', 'Add per-task cost caps, daily/monthly budget alerts, and a kill switch.');
  } else {
    const hasCap = typeof costControls.perTaskCapUsd === 'number' && costControls.perTaskCapUsd > 0;
    const hasKillSwitch = costControls.killSwitch === true;
    if (!hasKillSwitch) {
      fail('missing-kill-switch', 'critical', 'Cost controls exist but there is no kill switch.', 'Add a kill switch that can halt agent spend immediately, independent of budget alerts.');
      score += SECTION_WEIGHTS.costControls * 0.4;
    } else if (!hasCap) {
      fail('missing-per-task-cap', 'high', 'Kill switch exists but no per-task cost cap is set.', 'Set an explicit per-task cost cap (e.g. $5 max) in addition to the kill switch.');
      score += SECTION_WEIGHTS.costControls * 0.6;
    } else {
      score += SECTION_WEIGHTS.costControls;
    }
  }

  // --- 6. Memory architecture ---
  const memory = plan.memoryArchitecture;
  if (!isPlainObject(memory) || memory.documented !== true) {
    fail('memory-architecture-undocumented', 'medium', 'Memory architecture boundaries (working/short-term/long-term) are not documented.', 'Document which memory layers are in play and why.');
  } else {
    score += SECTION_WEIGHTS.memoryArchitecture;
  }

  // --- 7. Pilot scope (enterprise-wide is a red flag) ---
  const pilot = plan.pilot;
  const scope = isPlainObject(pilot) ? pilot.scope : undefined;
  const unscopedScopes = new Set(['enterprise-wide', 'org-wide', 'company-wide', 'unscoped']);
  if (!isPlainObject(pilot) || !isNonEmptyString(scope)) {
    fail('pilot-scope-undefined', 'high', 'Pilot scope is not defined.', 'Scope the pilot to a single team and a single workflow before expanding.');
  } else if (unscopedScopes.has(scope)) {
    fail('pilot-enterprise-wide', 'critical', `Pilot scope is "${scope}" -- Adoption Stall risk (Failure Mode #4). Enterprise-wide pilots rarely ship.`, 'Narrow the pilot to a single team, single workflow before any wider rollout.');
    score += SECTION_WEIGHTS.pilotScope * 0.1;
  } else {
    score += SECTION_WEIGHTS.pilotScope;
  }

  // --- 8. ROI measurement framework ---
  const roi = plan.roiFramework;
  if (!isPlainObject(roi) || roi.defined !== true || !isNonEmptyArray(roi.baselineMetrics)) {
    fail('roi-framework-missing', 'medium', 'No ROI measurement framework with baseline metrics is defined.', 'Define a baseline (time/cost per task before agents) so ROI can be measured, not asserted.');
  } else {
    score += SECTION_WEIGHTS.roiFramework;
  }

  // --- 9. Stakeholder communication ---
  const comms = plan.stakeholderComms;
  const audiences = isPlainObject(comms) ? comms.audiences : undefined;
  if (!isNonEmptyArray(audiences)) {
    fail('stakeholder-comms-missing', 'low', 'No per-audience stakeholder communication plan is documented.', 'Tailor messaging per audience: engineering, product, security/compliance, executive.');
  } else {
    score += SECTION_WEIGHTS.stakeholderComms;
  }

  // --- 10. Human-in-the-loop gate ---
  const hitl = plan.hitl;
  if (!isPlainObject(hitl) || hitl.approvalGatesDocumented !== true) {
    fail('missing-hitl-gate', 'critical', 'No human-in-the-loop approval gate is documented.', 'Add a visible, documented human approval gate before autonomous actions take effect.');
  } else {
    score += SECTION_WEIGHTS.hitl;
    if (!isNonEmptyArray(hitl.gates)) {
      recommendations.push('List the specific approval gates (what requires human sign-off) rather than just flagging that gates exist.');
    }
  }

  // --- 11. Success criteria ---
  const successCriteria = plan.successCriteria;
  if (!isPlainObject(successCriteria) || successCriteria.defined !== true || !isNonEmptyArray(successCriteria.binaryPassFail)) {
    fail('success-criteria-missing', 'medium', 'No binary pass/fail success criteria are defined.', 'Define explicit binary success criteria, not vague aspirations.');
  } else {
    score += SECTION_WEIGHTS.successCriteria;
  }

  // --- 12. Adoption expansion plan ---
  const adoption = plan.adoptionPlan;
  if (!isPlainObject(adoption) || adoption.documented !== true) {
    fail('adoption-plan-missing', 'low', 'No pilot-to-scale adoption pathway is documented.', 'Document the pathway from pilot to team expansion to broader rollout.');
  } else {
    score += SECTION_WEIGHTS.adoptionPlan;
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 70;

  if (findings.length === 0) {
    recommendations.push('Plan is structurally complete against the Quality Gates. Spot-check that documented criteria and gates reflect what is actually running, not just what is planned.');
  }

  return {
    pass,
    score: clampedScore,
    findings,
    recommendations,
  };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: infra_readiness.mjs --input <plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditInfraReadiness(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`infra_readiness: ${error.message}\n`);
    process.exit(1);
  }
}
