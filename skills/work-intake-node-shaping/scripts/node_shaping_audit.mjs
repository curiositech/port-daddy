#!/usr/bin/env node
// node_shaping_audit.mjs — deterministic audit that one operator WorkIntent maps
// to exactly one topology archetype, and that legacy launch verbs attached to it
// stay compatibility metadata instead of writing independent Agent Node/session/
// transcript state. Pure stdlib, no deps.
//
// Usage:
//   node node_shaping_audit.mjs --input <work-intake-spec>.json
//
// Exports:
//   auditNodeShaping(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The seven canonical topology archetypes a WorkIntent's signal vector can
// resolve to. See references/seven-archetypes.md for the disambiguation
// heuristics — this list is exhaustive by design, not a starting point.
const CANONICAL_ARCHETYPES = [
  'node',
  'scout',
  'chain',
  'dag-workgroup',
  'tournament',
  'ambient-watcher',
  'human-gate',
];

// The old launch verbs the binder demotes to compatibility source metadata.
// `agent`/`agents` is deliberately excluded: it names the Agent Node registry
// concept, not a launch verb that could smuggle in independent state.
const CANONICAL_LEGACY_VERBS = ['spawn', 'dispatch', 'sortie', 'conjure', 'nightshift'];

const REQUIRED_SIGNALS = [
  'coupling',
  'contextPressure',
  'skillBoundary',
  'reviewIndependence',
  'budget',
  'operatorBurden',
];

const SEVERITY_WEIGHT = { critical: 30, high: 15, medium: 10, low: 5 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditNodeShaping: input must be a JSON object');
  }
  if (!spec.workIntent || typeof spec.workIntent !== 'object' || Array.isArray(spec.workIntent)) {
    throw new Error('auditNodeShaping: "workIntent" object is required ({ id, signals })');
  }
  if (typeof spec.workIntent.id !== 'string' || spec.workIntent.id.trim() === '') {
    throw new Error('auditNodeShaping: "workIntent.id" is required and must be a non-empty string');
  }
  const signals = spec.workIntent.signals;
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) {
    throw new Error(
      `auditNodeShaping: "workIntent.signals" object is required (${REQUIRED_SIGNALS.join(', ')})`,
    );
  }
  for (const key of REQUIRED_SIGNALS) {
    if (typeof signals[key] !== 'string' || signals[key].trim() === '') {
      throw new Error(`auditNodeShaping: "workIntent.signals.${key}" is required and must be a non-empty string`);
    }
  }
  if (!Array.isArray(spec.selectedArchetypes)) {
    throw new Error('auditNodeShaping: "selectedArchetypes" must be an array (may be empty)');
  }
  for (const [i, archetype] of spec.selectedArchetypes.entries()) {
    if (typeof archetype !== 'string' || archetype.trim() === '') {
      throw new Error(`auditNodeShaping: selectedArchetypes[${i}] must be a non-empty string`);
    }
  }
  if (!Array.isArray(spec.legacyRoutes)) {
    throw new Error('auditNodeShaping: "legacyRoutes" must be an array (may be empty)');
  }
  for (const [i, route] of spec.legacyRoutes.entries()) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new Error(`auditNodeShaping: legacyRoutes[${i}] must be an object ({ verb, writesIndependentState })`);
    }
    if (typeof route.verb !== 'string' || route.verb.trim() === '') {
      throw new Error(`auditNodeShaping: legacyRoutes[${i}].verb must be a non-empty string`);
    }
    if (typeof route.writesIndependentState !== 'boolean') {
      throw new Error(`auditNodeShaping: legacyRoutes[${i}] ("${route.verb}") must have a boolean "writesIndependentState"`);
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a WorkIntent-to-topology-archetype decision plus its legacy-verb
 * compatibility routes against the Single Operator Action invariant: exactly
 * one archetype selected from the canonical seven, and no legacy launch verb
 * (spawn/dispatch/sortie/conjure/nightshift) writes independent Agent
 * Node/session/transcript state outside the shared WorkPlan pipeline.
 *
 * @param {object} spec
 * @param {{id:string, signals:{coupling:string, contextPressure:string, skillBoundary:string,
 *   reviewIndependence:string, budget:string, operatorBurden:string}}} spec.workIntent
 * @param {string[]} spec.selectedArchetypes - should contain exactly one of the seven canonical
 *   archetype names.
 * @param {Array<{verb:string, writesIndependentState:boolean}>} spec.legacyRoutes
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditNodeShaping(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Archetype cardinality -------------------------------------------------
  const { selectedArchetypes } = spec;
  if (selectedArchetypes.length === 0) {
    pushFinding(
      findings, 'critical', 'no-archetype-selected',
      `WorkIntent "${spec.workIntent.id}" resolved to zero topology archetypes.`,
      'Score the signal vector (coupling, context pressure, skill boundary, review independence, budget, operator burden) against references/seven-archetypes.md and commit to exactly one archetype before materializing any Agent Node.',
      recommendations,
    );
  }
  if (selectedArchetypes.length > 1) {
    pushFinding(
      findings, 'critical', 'multiple-archetypes-selected',
      `WorkIntent "${spec.workIntent.id}" resolved to ${selectedArchetypes.length} topology archetypes (${selectedArchetypes.join(', ')}) — the Single Operator Action invariant requires exactly one.`,
      'Resolve the ambiguity in the signal vector itself; a WorkIntent that legitimately fits two archetypes means the scoring is under-specified, not that both should be launched.',
      recommendations,
    );
  }
  for (const archetype of selectedArchetypes) {
    if (!CANONICAL_ARCHETYPES.includes(archetype)) {
      pushFinding(
        findings, 'critical', 'unknown-archetype',
        `Selected archetype "${archetype}" is not one of the seven canonical topology archetypes (${CANONICAL_ARCHETYPES.join(', ')}).`,
        `Re-map "${archetype}" onto one of the seven canonical archetypes, or fix the typo — the taxonomy is exhaustive by design and the operator should never see an eighth name.`,
        recommendations,
      );
    }
  }

  // --- Legacy verb compatibility ---------------------------------------------
  for (const route of spec.legacyRoutes) {
    if (route.writesIndependentState === true) {
      pushFinding(
        findings, 'critical', 'legacy-route-writes-independent-state',
        `Legacy launch verb "${route.verb}" writes its own Agent Node/session/transcript state instead of routing through the shared WorkIntent -> WorkPlan -> Agent Node pipeline.`,
        `Rewire "${route.verb}" to be compatibility source metadata only (an annotation on the WorkIntent, e.g. "arrived via ${route.verb}") — it must terminate in the same single-archetype materialization path as every other entrypoint, never open a parallel governed session.`,
        recommendations,
      );
    }
    if (!CANONICAL_LEGACY_VERBS.includes(route.verb)) {
      pushFinding(
        findings, 'medium', 'unknown-legacy-verb',
        `Legacy route verb "${route.verb}" is not one of the documented compatibility verbs (${CANONICAL_LEGACY_VERBS.join(', ')}).`,
        `Confirm "${route.verb}" is an intentional new compatibility alias and document it alongside spawn/dispatch/sortie/conjure/nightshift, or fix a naming drift.`,
        recommendations,
      );
    }
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push(
      'WorkIntent maps to exactly one valid archetype and no legacy verb writes independent state. Safe to materialize the single Agent Node.',
    );
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: node_shaping_audit.mjs --input <work-intake-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditNodeShaping(spec), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`node_shaping_audit: ${error.message}\n`);
    process.exit(1);
  }
}
