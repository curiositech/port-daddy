#!/usr/bin/env node
// control_contract_audit.mjs — deterministic audit of an operator control-command
// contract (steer/interrupt/pause/kill/checkpoint/fork over live agent bodies)
// before a control panel is allowed to render those verbs as clickable.
// Pure stdlib, no deps.
//
// Usage:
//   node control_contract_audit.mjs --input <control-contract-spec>.json
//
// Exports:
//   auditControlContract(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The six terminal-state vocabulary a verb's delivery lifecycle can draw from.
// See references/verb-state-machine.md for why each one exists.
const ALLOWED_TERMINAL_STATES = ['queued', 'delivered', 'acknowledged', 'failed', 'expired', 'unsupported'];

// A verb must at minimum distinguish these four outcomes, or "delivered" and
// "it actually happened" collapse into the same claim — see anti-pattern
// "Incomplete Delivery Lifecycle" in SKILL.md.
const REQUIRED_TERMINAL_SUBSET = ['delivered', 'acknowledged', 'failed', 'expired'];

// The four control verbs the binder names as separate claims (redteam packet
// #13). checkpoint/fork are real verbs in this domain too but are not part of
// the specific "collapsed into one stop button" failure mode this constant
// guards against.
const CORE_DISTINCT_VERBS = ['interrupt', 'pause', 'kill', 'steer'];

// Authorization sources that read authoritative daemon state (a lease record
// or an appended event) versus sources that can be stale by construction.
const AUTHORITATIVE_SOURCES = ['authoritative-lease', 'authoritative-event'];
const STALE_SOURCES = ['cached-projection', 'ui-state'];
const ALLOWED_AUTHORIZATION_SOURCES = [...AUTHORITATIVE_SOURCES, ...STALE_SOURCES];

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditControlContract: input must be a JSON object');
  }
  if (!Array.isArray(spec.verbs) || spec.verbs.length === 0) {
    throw new Error('auditControlContract: "verbs" must be a non-empty array');
  }
  for (const [i, verb] of spec.verbs.entries()) {
    if (!verb || typeof verb.name !== 'string' || verb.name.trim() === '') {
      throw new Error(`auditControlContract: verbs[${i}] must have a non-empty string "name"`);
    }
    if (!Array.isArray(verb.terminalStates) || verb.terminalStates.length === 0) {
      throw new Error(`auditControlContract: verbs[${i}] ("${verb.name}") must have a non-empty "terminalStates" array`);
    }
    for (const state of verb.terminalStates) {
      if (!ALLOWED_TERMINAL_STATES.includes(state)) {
        throw new Error(
          `auditControlContract: verbs[${i}] ("${verb.name}") has unknown terminal state "${state}"; must be one of ${ALLOWED_TERMINAL_STATES.join(', ')}`,
        );
      }
    }
  }
  if (!Array.isArray(spec.backends) || spec.backends.length === 0) {
    throw new Error('auditControlContract: "backends" must be a non-empty array');
  }
  for (const [i, backend] of spec.backends.entries()) {
    if (!backend || typeof backend.name !== 'string' || backend.name.trim() === '') {
      throw new Error(`auditControlContract: backends[${i}] must have a non-empty string "name"`);
    }
    if (!Array.isArray(backend.supportedVerbs)) {
      throw new Error(`auditControlContract: backends[${i}] ("${backend.name}") must have a "supportedVerbs" array (may be empty)`);
    }
  }
  if (typeof spec.authorizationSource !== 'string' || !ALLOWED_AUTHORIZATION_SOURCES.includes(spec.authorizationSource)) {
    throw new Error(
      `auditControlContract: "authorizationSource" must be one of ${ALLOWED_AUTHORIZATION_SOURCES.join(', ')}`,
    );
  }
  if (!Array.isArray(spec.matrix)) {
    throw new Error('auditControlContract: "matrix" must be an array (may be empty)');
  }
  for (const [i, cell] of spec.matrix.entries()) {
    if (!cell || typeof cell.verb !== 'string' || typeof cell.backend !== 'string') {
      throw new Error(`auditControlContract: matrix[${i}] must have string "verb" and "backend"`);
    }
    if (typeof cell.hasDistinctTerminalStates !== 'boolean') {
      throw new Error(`auditControlContract: matrix[${i}] ("${cell.verb}"/"${cell.backend}") must have boolean "hasDistinctTerminalStates"`);
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

function findMatrixCell(matrix, verbName, backendName) {
  return matrix.find((cell) => cell.verb === verbName && cell.backend === backendName) ?? null;
}

/**
 * Audit an operator control-command contract: does every verb (steer,
 * interrupt, pause, kill, checkpoint, fork, ...) get modeled as a distinct
 * claim with a real delivery lifecycle, does every backend that can't
 * perform a verb say so honestly, and does authorization read authoritative
 * state instead of a stale projection.
 *
 * FAILS CLOSED: an empty matrix, a missing cell, or an unproven combination
 * is never treated as safe — it is scored as though the gap were unsafe.
 *
 * @param {object} spec
 * @param {Array<{name:string, terminalStates:string[]}>} spec.verbs
 * @param {Array<{name:string, supportedVerbs:string[]}>} spec.backends
 * @param {'authoritative-lease'|'authoritative-event'|'cached-projection'|'ui-state'} spec.authorizationSource
 * @param {Array<{verb:string, backend:string, hasDistinctTerminalStates:boolean}>} spec.matrix
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditControlContract(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  const verbByName = new Map(spec.verbs.map((v) => [v.name, v]));
  const verbNames = spec.verbs.map((v) => v.name);

  // --- 1. Authorization source: authoritative or stale? ---------------------
  if (STALE_SOURCES.includes(spec.authorizationSource)) {
    pushFinding(
      findings, 'critical', 'authorizes-from-stale-projection',
      `authorizationSource is "${spec.authorizationSource}" — a control command would be authorized from a projection or UI state that can be stale, corrupted, or frozen, not authoritative daemon truth.`,
      'Re-check authoritative lease/event state (an appended control_commands event or an active lease record) at the moment of authorization; a pane may display stale data, but a command must never be authorized from it.',
      recommendations,
    );
  }

  // --- 2. Collapsed verbs: are interrupt/pause/kill/steer distinct claims? --
  const missingCoreVerbs = CORE_DISTINCT_VERBS.filter((name) => !verbNames.includes(name));
  if (missingCoreVerbs.length > 0) {
    pushFinding(
      findings, 'critical', 'collapsed-verbs',
      `Verb set is missing distinct claim(s) for: ${missingCoreVerbs.join(', ')}. interrupt, pause, kill, and steer each have different runtime truth and must not be merged into a single generic "stop" or "control" claim.`,
      `Add a separate verb entry (with its own terminalStates) for each of: ${missingCoreVerbs.join(', ')}.`,
      recommendations,
    );
  }

  // A matrix cell among the core four verbs that reports no distinct terminal
  // states is the same failure mode surfacing at the backend level: the verb
  // exists on paper but a specific backend can't actually tell it apart from
  // another verb's outcome.
  const collapsedCoreCells = spec.matrix.filter(
    (cell) => CORE_DISTINCT_VERBS.includes(cell.verb) && cell.hasDistinctTerminalStates === false,
  );
  if (collapsedCoreCells.length > 0) {
    const pairs = collapsedCoreCells.map((c) => `${c.verb}/${c.backend}`).join(', ');
    pushFinding(
      findings, 'critical', 'collapsed-verbs',
      `Matrix reports non-distinct terminal states for core verb/backend pair(s): ${pairs}. A backend that cannot tell interrupt, pause, kill, or steer apart is not honoring them as separate claims.`,
      'Give each core verb its own tracked terminal-state sequence per backend, or mark the backend as not supporting that verb (with an "unsupported" terminal) instead of silently merging outcomes.',
      recommendations,
    );
  }

  // --- 3. Verb-level terminal state completeness -----------------------------
  for (const verb of spec.verbs) {
    const missing = REQUIRED_TERMINAL_SUBSET.filter((s) => !verb.terminalStates.includes(s));
    if (missing.length > 0) {
      pushFinding(
        findings, 'critical', 'verb-missing-terminal-states',
        `Verb "${verb.name}" is missing required terminal state(s): ${missing.join(', ')}. A verb without the full delivered/acknowledged/failed/expired set cannot distinguish "sent" from "actually happened" from "gave up."`,
        `Add ${missing.join(', ')} to verb "${verb.name}"'s terminalStates.`,
        recommendations,
      );
    }
  }

  // --- 4. Backend honesty: unsupported verbs need an unsupported terminal ---
  for (const backend of spec.backends) {
    for (const verbName of verbNames) {
      const backendSupportsVerb = backend.supportedVerbs.includes(verbName);
      if (backendSupportsVerb) continue;

      const verb = verbByName.get(verbName);
      const cell = findMatrixCell(spec.matrix, verbName, backend.name);
      const verbDeclaresUnsupported = verb?.terminalStates.includes('unsupported') === true;
      const cellProvesIt = cell !== null && cell.hasDistinctTerminalStates === true && verbDeclaresUnsupported;

      if (!cellProvesIt) {
        pushFinding(
          findings, 'critical', 'backend-verb-no-unsupported-state',
          `Backend "${backend.name}" does not support verb "${verbName}" but has no proven "unsupported" terminal for that pair (matrix cell ${cell ? 'exists but is not distinct or verb lacks "unsupported"' : 'is missing'}).`,
          `Add "unsupported" to verb "${verbName}"'s terminalStates and a matrix cell for ("${verbName}", "${backend.name}") with hasDistinctTerminalStates:true, so the control panel disables that combination honestly instead of hiding it.`,
          recommendations,
        );
      }
    }
  }

  // --- 5. Matrix completeness for supported combinations (fail closed) ------
  // An unproven verb×backend combination is not evidence of safety — it is a
  // gap. Every combination the contract claims to support needs a matrix cell
  // that actually proves distinct terminal states.
  for (const backend of spec.backends) {
    for (const verbName of verbNames) {
      const backendSupportsVerb = backend.supportedVerbs.includes(verbName);
      if (!backendSupportsVerb) continue; // covered by the unsupported check above

      const cell = findMatrixCell(spec.matrix, verbName, backend.name);
      if (!cell) {
        pushFinding(
          findings, 'high', 'missing-matrix-cell',
          `No matrix cell proves the ("${verbName}", "${backend.name}") combination — backend claims support but the contract has no evidence of a real delivery lifecycle for it.`,
          `Add a matrix cell for ("${verbName}", "${backend.name}") with hasDistinctTerminalStates set from real probe evidence, not assumed.`,
          recommendations,
        );
      } else if (cell.hasDistinctTerminalStates !== true) {
        pushFinding(
          findings, 'high', 'supported-verb-not-distinct',
          `Backend "${backend.name}" claims to support "${verbName}" but the matrix cell reports hasDistinctTerminalStates:false — the claim is not backed by a distinct delivery lifecycle.`,
          `Either prove distinct terminal states for ("${verbName}", "${backend.name}") or remove "${verbName}" from that backend's supportedVerbs.`,
          recommendations,
        );
      }
    }
  }

  const totalWeight = findings.reduce((sum, f) => sum + ((SEVERITY_WEIGHT[f.severity] ?? (() => { throw new Error(`unknown finding severity: ${f.severity}`); })())), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push(
      'Contract meets the control-command bar: authorization reads authoritative state, every verb is a distinct claim with a full terminal-state lifecycle, and every backend is honest about what it cannot do. Safe to render these controls as clickable.',
    );
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: control_contract_audit.mjs --input <spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditControlContract(spec), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`control_contract_audit: ${error.message}\n`);
    process.exit(1);
  }
}
