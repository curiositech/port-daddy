#!/usr/bin/env node
// prompt_audit.mjs — deterministic audit of a prompt's structural properties
// against the prompt-engineer skill's own anti-patterns. Pure stdlib, no deps.
//
// This scores STRUCTURED fields (booleans/counts) that an engineer has
// already decided — it never reads prompt prose or does keyword/text-pattern
// matching over the prompt itself.
//
// Usage:
//   node prompt_audit.mjs --input <prompt-spec>.json
//
// Exports:
//   auditPrompt(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

const REQUIRED_BOOLEAN_FIELDS = [
  'hasClearRole',
  'hasExplicitOutputContract',
  'outputFormatSpecified',
  'guardrailsPresent',
  'hasEvalCriteria',
  'delimitsUntrustedInput',
  'avoidsKitchenSink',
  'specifiesRefusalBehavior',
];

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditPrompt: input must be a JSON object');
  }
  for (const field of REQUIRED_BOOLEAN_FIELDS) {
    if (typeof spec[field] !== 'boolean') {
      throw new Error(`auditPrompt: "${field}" is required and must be a boolean`);
    }
  }
  if (
    typeof spec.fewShotExamples !== 'number' ||
    !Number.isInteger(spec.fewShotExamples) ||
    spec.fewShotExamples < 0
  ) {
    throw new Error('auditPrompt: "fewShotExamples" is required and must be a non-negative integer');
  }
}

function pushFinding(findings, recommendations, severity, id, message, recommendation) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a prompt's structural properties against the prompt-engineer skill's
 * anti-patterns: kitchen-sink overload, missing role, missing output
 * contract, undelimited untrusted input (injection risk), no eval criteria,
 * no refusal/edge-case behavior, no guardrails, and too few few-shot
 * examples.
 *
 * Fails CLOSED: every signal below only downgrades a finding when the
 * corresponding field is explicitly `true`. A missing, non-boolean, or
 * `false` field is never treated as "safe" — see assertShape, which throws
 * on missing/malformed fields rather than defaulting them.
 *
 * @param {object} spec - parsed JSON matching schemas/prompt-spec.schema.json.
 * @param {boolean} spec.hasClearRole
 * @param {boolean} spec.hasExplicitOutputContract
 * @param {boolean} spec.outputFormatSpecified
 * @param {number} spec.fewShotExamples
 * @param {boolean} spec.guardrailsPresent
 * @param {boolean} spec.hasEvalCriteria
 * @param {boolean} spec.delimitsUntrustedInput
 * @param {boolean} spec.avoidsKitchenSink
 * @param {boolean} spec.specifiesRefusalBehavior
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditPrompt(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Output contract ------------------------------------------------------
  if (!spec.hasExplicitOutputContract) {
    pushFinding(
      findings, recommendations, 'critical', 'missing-output-contract',
      'Prompt never states the required output shape — the model is free to return inconsistent JSON/prose/markdown across calls.',
      'State the exact output contract (schema, structure, delimiters) in the prompt itself; pair with output-contract-enforcer to validate it at runtime.',
    );
  }
  if (!spec.outputFormatSpecified) {
    pushFinding(
      findings, recommendations, 'high', 'output-format-unspecified',
      'Prompt does not spell out the concrete output FORMAT (e.g. exact JSON schema, markdown structure, delimiters).',
      'Add an explicit "Output Format" section with the exact structure expected, not just a description that structure is required.',
    );
  }

  // --- Injection risk ---------------------------------------------------------
  if (!spec.delimitsUntrustedInput) {
    pushFinding(
      findings, recommendations, 'critical', 'untrusted-input-not-delimited',
      'Untrusted/user-supplied or retrieved input is not confirmed to be delimited from instructions — a crafted input could be read as a new instruction.',
      'Wrap every untrusted/user-supplied span in an explicit delimiter (XML tags, fenced block, named variable) and instruct the model to treat it as data, never as instructions. See references/injection-and-safety.md.',
    );
  }

  // --- Eval criteria ------------------------------------------------------------
  if (!spec.hasEvalCriteria) {
    pushFinding(
      findings, recommendations, 'critical', 'no-eval-criteria',
      'No eval criteria defined — there is no way to tell whether a change to this prompt is an improvement or a regression.',
      'Define a rubric, a set of golden input/output pairs, or an LLM-judge prompt before shipping. See references/eval-criteria-patterns.md.',
    );
  }

  // --- Kitchen-sink overload ------------------------------------------------------
  if (!spec.avoidsKitchenSink) {
    pushFinding(
      findings, recommendations, 'critical', 'kitchen-sink-overload',
      'Prompt is flagged as overloaded — too many topics, rules, or constraints crammed into one prompt.',
      'Prioritize 3-5 essential constraints and move the rest to progressive disclosure (references, follow-up turns, retrieval).',
    );
  }

  // --- Refusal / edge-case behavior --------------------------------------------
  if (!spec.specifiesRefusalBehavior) {
    pushFinding(
      findings, recommendations, 'critical', 'no-refusal-behavior',
      'Prompt does not specify what to do for out-of-scope, adversarial, or ambiguous input — edge behavior is undefined.',
      'Explicitly specify refusal, clarifying-question, or graceful-degradation behavior for edge cases as part of the prompt.',
    );
  }

  // --- Role grounding -------------------------------------------------------------
  if (!spec.hasClearRole) {
    pushFinding(
      findings, recommendations, 'medium', 'no-clear-role',
      'Prompt does not establish a specific role/persona and domain — generic assistant framing produces generic output.',
      'State a specific role with relevant expertise ("You are a senior support engineer...") before the task instruction.',
    );
  }

  // --- Guardrails -------------------------------------------------------------------
  if (!spec.guardrailsPresent) {
    pushFinding(
      findings, recommendations, 'medium', 'no-guardrails-present',
      'No hallucination/scope guardrail present (e.g. "only use information provided; say \'I don\'t know\' if uncertain").',
      'Add an explicit guardrail appropriate to the task\'s risk level.',
    );
  }

  // --- Few-shot examples -----------------------------------------------------------
  if (spec.fewShotExamples < 2) {
    const severity = spec.fewShotExamples === 0 ? 'medium' : 'low';
    pushFinding(
      findings, recommendations, severity, 'insufficient-few-shot-examples',
      `Prompt includes only ${spec.fewShotExamples} few-shot example(s); format-sensitive tasks need 2-3 representative examples.`,
      'Add 2-3 representative input/output example pairs — models infer format far more reliably from examples than prose alone.',
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 0), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('Prompt spec meets the readiness bar: clear role, explicit output contract, delimited input, eval criteria, refusal behavior, guardrails, and sufficient examples.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: prompt_audit.mjs --input <prompt-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditPrompt(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`prompt_audit: ${error.message}\n`);
    process.exit(1);
  }
}
