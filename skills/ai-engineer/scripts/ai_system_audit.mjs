#!/usr/bin/env node
// ai_system_audit.mjs — deterministic audit of an LLM application's BUILD
// quality gates (this skill's Quality Gates) before it ships. Pure stdlib,
// no deps.
//
// Scope: does the AI SYSTEM ITSELF ship with real quality gates — an eval
// harness, measured retrieval, required grounding, hallucination guardrails,
// a low-confidence fallback, streaming UX, injection defense, a cost
// ceiling, and tool-call validation. This is deliberately NOT infra
// selection/observability/adoption (agentic-infrastructure-2026's
// infra_readiness.mjs covers that) and NOT model-routing mechanics
// (llm-router).
//
// Usage:
//   node ai_system_audit.mjs --input <ai-system-plan.json>
//
// Exports:
//   auditAiSystem(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(spec, key, requiredBool) {
  const value = spec[key];
  if (!isPlainObject(value)) {
    throw new Error(`auditAiSystem: "${key}" object is required`);
  }
  if (typeof value[requiredBool] === 'undefined') {
    throw new Error(`auditAiSystem: "${key}.${requiredBool}" boolean is required`);
  }
  if (typeof value[requiredBool] !== 'boolean') {
    throw new Error(`auditAiSystem: "${key}.${requiredBool}" must be a boolean`);
  }
  return value;
}

function assertShape(spec) {
  if (!isPlainObject(spec)) {
    throw new Error('auditAiSystem: input must be a JSON object');
  }
  const validTypes = ['rag', 'agent', 'chatbot', 'multi-agent', 'pipeline', 'hybrid'];
  if (typeof spec.systemType !== 'string' || !validTypes.includes(spec.systemType)) {
    throw new Error(`auditAiSystem: "systemType" must be one of ${validTypes.join(', ')}`);
  }
  requireObject(spec, 'evalHarness', 'exists');
  requireObject(spec, 'retrieval', 'used');
  requireObject(spec, 'grounding', 'citationsRequired');
  requireObject(spec, 'hallucinationGuardrails', 'exists');
  requireObject(spec, 'lowConfidenceFallback', 'exists');
  requireObject(spec, 'streamingUx', 'enabled');
  requireObject(spec, 'promptInjectionDefense', 'exists');
  requireObject(spec, 'costCeiling', 'enforced');
  if (typeof spec.toolUse !== 'undefined') {
    requireObject(spec, 'toolUse', 'used');
  }
  for (const key of ['factualClaimsMade', 'interactive', 'acceptsUntrustedInput']) {
    if (typeof spec[key] !== 'undefined' && typeof spec[key] !== 'boolean') {
      throw new Error(`auditAiSystem: "${key}" must be a boolean when present`);
    }
  }
}

function pushFinding(findings, recommendations, severity, id, message, recommendation) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit an AI system's BUILD-quality plan against this skill's Quality
 * Gates: eval harness, measured retrieval (RAG), required grounding,
 * hallucination guardrails, low-confidence fallback, streaming UX, prompt
 * injection defense, per-request cost ceiling, and tool-call validation.
 *
 * FAILS CLOSED: scoping flags (`factualClaimsMade`, `interactive`,
 * `acceptsUntrustedInput`) default to true when omitted, so an unstated
 * system is always evaluated under the stricter assumption that the gate
 * applies to it. An empty/missing signal is never treated as "safe".
 *
 * @param {object} spec - see schemas/ai-system-plan.schema.json
 * @returns {{pass:boolean, score:number, findings:Array<{severity:string,id:string,message:string}>, recommendations:string[]}}
 */
export function auditAiSystem(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  const factualClaimsMade = spec.factualClaimsMade !== false; // default true
  const interactive = spec.interactive !== false; // default true
  const acceptsUntrustedInput = spec.acceptsUntrustedInput !== false; // default true

  // --- 1. Eval harness: does this ship on vibes? ---------------------------
  if (spec.evalHarness.exists !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'no-eval-harness',
      'No repeatable evaluation harness exists — the system ships on vibes, not measurement.',
      'Stand up a repeatable eval harness (unit + end-to-end at minimum) before shipping.',
    );
  } else {
    const coverage = Array.isArray(spec.evalHarness.coverage) ? spec.evalHarness.coverage : [];
    const missingCoverage = ['end-to-end', 'adversarial'].filter((k) => !coverage.includes(k));
    if (missingCoverage.length > 0) {
      pushFinding(
        findings, recommendations, 'medium', 'eval-harness-thin',
        `Eval harness exists but is missing coverage: ${missingCoverage.join(', ')}.`,
        'Extend eval coverage to include end-to-end and adversarial cases, not just unit-level checks.',
      );
    }
  }

  // --- 2. Retrieval quality: measured, not assumed -------------------------
  if (spec.retrieval.used !== false) {
    if (spec.retrieval.recallMeasured !== true || spec.retrieval.precisionMeasured !== true) {
      pushFinding(
        findings, recommendations, 'critical', 'retrieval-never-measured',
        'Retrieval is used but recall/precision were never measured against a held-out set — "close but not quite right" ships silently (Semantic Mismatch Cascade).',
        'Measure retrieval@k recall and precision on a held-out evaluation set before shipping; do not judge retrieval by eyeballing answers.',
      );
    }
  }

  // --- 3. Grounding / citations --------------------------------------------
  if (factualClaimsMade) {
    if (spec.grounding.citationsRequired !== true) {
      pushFinding(
        findings, recommendations, 'critical', 'no-grounding-requirement',
        'System makes factual claims but citation/source-attribution is not required — unbounded hallucination risk.',
        'Require every factual claim to cite the retrieved source or tool result it came from.',
      );
    } else if (spec.grounding.sourceAttributionEnforced !== true) {
      pushFinding(
        findings, recommendations, 'medium', 'grounding-not-enforced',
        'Citations are required but attribution is not enforced (documented goal, not a checked property).',
        'Validate output against retrieved sources programmatically (e.g. reject/flag answers with no matching citation) rather than relying on the prompt alone.',
      );
    }
  }

  // --- 4. Hallucination guardrails ------------------------------------------
  if (spec.hallucinationGuardrails.exists !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'no-hallucination-guardrails',
      'No hallucination guardrail mechanism exists (citation-check, confidence-scoring, self-consistency, or output validation).',
      'Add at least one hallucination guardrail mechanism and measure its catch rate.',
    );
  } else {
    const mechanisms = Array.isArray(spec.hallucinationGuardrails.mechanisms) ? spec.hallucinationGuardrails.mechanisms : [];
    if (mechanisms.length === 0) {
      pushFinding(
        findings, recommendations, 'low', 'hallucination-guardrails-undocumented',
        'Hallucination guardrails are marked as existing but no specific mechanism is listed.',
        'Name the specific mechanism(s) in use so the guardrail can be reviewed and tested.',
      );
    }
  }

  // --- 5. Low-confidence fallback --------------------------------------------
  if (spec.lowConfidenceFallback.exists !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'no-low-confidence-fallback',
      'No fallback path exists for low-confidence outputs — the system will confidently answer when it should decline or escalate.',
      'Add a confidence threshold with an explicit fallback action (decline, escalate to human, request clarification).',
    );
  }

  // --- 6. Streaming UX (only when the system is interactive) ----------------
  if (interactive && spec.streamingUx.enabled !== true) {
    pushFinding(
      findings, recommendations, 'high', 'no-streaming-ux',
      'System is interactive but does not stream tokens — perceived latency will read as broken, not just slow.',
      'Stream tokens to the user as they generate; add cancellation if generation can run long.',
    );
  }

  // --- 7. Prompt injection defense (only when input can be untrusted) -------
  if (acceptsUntrustedInput && spec.promptInjectionDefense.exists !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'no-injection-defense',
      'System accepts untrusted input (user text, retrieved documents, or tool output) with no prompt injection defense.',
      'Isolate the system prompt from untrusted content, tag retrieved/tool content as untrusted, and validate tool-call schemas.',
    );
  }

  // --- 8. Cost ceiling per request --------------------------------------------
  if (spec.costCeiling.enforced !== true || typeof spec.costCeiling.perRequestUsd !== 'number') {
    pushFinding(
      findings, recommendations, 'high', 'no-cost-ceiling',
      'No enforced per-request cost ceiling is set — a single request can run away in tokens/tool-calls with no cap.',
      'Set and enforce an explicit per-request cost ceiling in the system design (distinct from operational budget alerts/kill switches, which are an infra concern).',
    );
  }

  // --- 9. Tool-call validation (Tool Hallucination Loop) ----------------------
  if (isPlainObject(spec.toolUse) && spec.toolUse.used === true && spec.toolUse.validationLayer !== true) {
    pushFinding(
      findings, recommendations, 'critical', 'tool-hallucination-risk',
      'Agent uses tools but tool calls are not validated against a real schema before execution — Tool Hallucination Loop risk.',
      'Add a tool-call validation layer and explicit error handling in the agent system prompt before execution.',
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('AI system meets the build-quality bar: eval harness, measured retrieval where used, required grounding, hallucination guardrails, low-confidence fallback, streaming UX where interactive, injection defense, and an enforced cost ceiling.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: ai_system_audit.mjs --input <ai-system-plan>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditAiSystem(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`ai_system_audit: ${error.message}\n`);
    process.exit(1);
  }
}
