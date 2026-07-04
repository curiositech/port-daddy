#!/usr/bin/env node
// articles_audit.mjs — deterministic audit of an Articles of Agreement contract
// against the enforcement-beats-hope bar. Pure stdlib, no deps.
//
// Usage:
//   node articles_audit.mjs --input <articles-spec>.json
//
// Exports:
//   auditArticles(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A clause's enforcementMechanism must be one of these. "none" is a legal
// enum value precisely so a draft contract can name an unenforced obligation
// honestly — it is then caught by the clause-not-enforced finding below,
// never silently treated as safe.
const GATE_MECHANISMS = ['pre-tool-gate', 'hook', 'capability-lease', 'mcp-gateway'];
const PASSIVE_MECHANISMS = ['probe', 'transcript-event'];
const ALL_MECHANISMS = [...GATE_MECHANISMS, ...PASSIVE_MECHANISMS, 'none'];

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditArticles: input must be a JSON object');
  }
  if (!spec.identity || typeof spec.identity !== 'object') {
    throw new Error('auditArticles: "identity" object is required ({ daemonIssued, signed })');
  }
  if (typeof spec.identity.daemonIssued !== 'boolean') {
    throw new Error('auditArticles: "identity.daemonIssued" must be a boolean');
  }
  if (typeof spec.identity.signed !== 'boolean') {
    throw new Error('auditArticles: "identity.signed" must be a boolean');
  }
  if (!Array.isArray(spec.clauses)) {
    throw new Error('auditArticles: "clauses" must be an array (may be empty)');
  }
  for (const [i, clause] of spec.clauses.entries()) {
    if (!clause || typeof clause !== 'object') {
      throw new Error(`auditArticles: clauses[${i}] must be an object`);
    }
    if (typeof clause.name !== 'string' || clause.name.trim() === '') {
      throw new Error(`auditArticles: clauses[${i}] must have a non-empty string "name"`);
    }
    if (typeof clause.obligation !== 'string' || clause.obligation.trim() === '') {
      throw new Error(`auditArticles: clauses[${i}] ("${clause.name}") must have a non-empty string "obligation"`);
    }
    if (typeof clause.enforcementMechanism !== 'string' || !ALL_MECHANISMS.includes(clause.enforcementMechanism)) {
      throw new Error(
        `auditArticles: clauses[${i}] ("${clause.name}") "enforcementMechanism" must be one of ${ALL_MECHANISMS.join(', ')}`,
      );
    }
    if (typeof clause.daemonObservable !== 'boolean') {
      throw new Error(`auditArticles: clauses[${i}] ("${clause.name}") "daemonObservable" must be a boolean`);
    }
    if (clause.denialShape !== undefined && typeof clause.denialShape !== 'string') {
      throw new Error(`auditArticles: clauses[${i}] ("${clause.name}") "denialShape", if present, must be a string`);
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

function hasDenialShape(clause) {
  return typeof clause.denialShape === 'string' && clause.denialShape.trim() !== '';
}

/**
 * Audit an Articles of Agreement contract against the enforcement-beats-hope
 * bar: every clause must resolve to a concrete, daemon-observable mechanism
 * (never a promise the agent might honor), gate-style mechanisms must define
 * what a denial actually looks like, and the signing identity itself must be
 * daemon-issued and signed, not self-asserted by the body.
 *
 * FAIL CLOSED: an empty clause list, a missing mechanism, or an unproven
 * identity is never treated as safe by default.
 *
 * @param {object} spec
 * @param {{daemonIssued:boolean, signed:boolean}} spec.identity
 * @param {Array<{
 *   name: string,
 *   obligation: string,
 *   enforcementMechanism: 'pre-tool-gate'|'hook'|'capability-lease'|'mcp-gateway'|'probe'|'transcript-event'|'none',
 *   daemonObservable: boolean,
 *   denialShape?: string,
 * }>} spec.clauses
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditArticles(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Identity: daemon-issued and signed, never self-attested --------------
  if (spec.identity.daemonIssued !== true) {
    pushFinding(
      findings, 'critical', 'identity-not-daemon-issued',
      'Agent identity is not marked daemon-issued — a body that can self-assert its own identity can also self-assert compliance.',
      'Issue the Agent Node id from the daemon at registration (agent.register with a daemon-issued registrationNonce); never accept a body-supplied identity as-is.',
      recommendations,
    );
  }
  if (spec.identity.signed !== true) {
    pushFinding(
      findings, 'critical', 'identity-unsigned',
      'Articles are not marked signed — an unsigned contract cannot be proven to bind this specific Agent Node.',
      'Require an articlesSignature over the daemon-issued identity before the agent is treated as compliant at any level.',
      recommendations,
    );
  }

  // --- Clauses: fail closed on an empty contract -----------------------------
  if (spec.clauses.length === 0) {
    pushFinding(
      findings, 'critical', 'no-clauses',
      'Articles define zero clauses. An empty contract has nothing to enforce and cannot be judged safe.',
      'Add at least one clause covering registration, transcript reporting, tool-use gating, file claims, budget, or operator control.',
      recommendations,
    );
  }

  // --- Per-clause enforcement checks ------------------------------------------
  const seenNames = new Map();
  for (const clause of spec.clauses) {
    const priorCount = seenNames.get(clause.name) ?? 0;
    seenNames.set(clause.name, priorCount + 1);
    if (priorCount === 1) {
      // Only fire once per duplicated name, on the second occurrence.
      pushFinding(
        findings, 'medium', 'duplicate-clause-name',
        `Clause name "${clause.name}" appears more than once — duplicate names make it ambiguous which mechanism actually governs the obligation.`,
        `Rename or merge the duplicate "${clause.name}" clauses so each obligation maps to exactly one mechanism.`,
        recommendations,
      );
    }

    const unenforced = clause.enforcementMechanism === 'none' || clause.daemonObservable !== true;
    if (unenforced) {
      pushFinding(
        findings, 'critical', 'clause-not-enforced',
        `Clause "${clause.name}" has no daemon-observable enforcement mechanism (enforcementMechanism="${clause.enforcementMechanism}", daemonObservable=${clause.daemonObservable}) — the obligation degrades to hope.`,
        `Wire "${clause.name}" through a concrete mechanism the daemon can observe: a pre-tool gate, hook, capability lease, MCP gateway, probe, or transcript event — never "none".`,
        recommendations,
      );
    }

    const isGate = GATE_MECHANISMS.includes(clause.enforcementMechanism);
    if (isGate && !unenforced && !hasDenialShape(clause)) {
      pushFinding(
        findings, 'critical', 'enforced-clause-no-denial-shape',
        `Clause "${clause.name}" uses a gate-style mechanism ("${clause.enforcementMechanism}") but defines no denialShape — nothing describes what actually happens when the gate fires.`,
        `Define denialShape for "${clause.name}": the concrete rejection an agent receives (error code, refused tool call, revoked lease) when it violates the clause.`,
        recommendations,
      );
    }

    const isPassive = PASSIVE_MECHANISMS.includes(clause.enforcementMechanism);
    if (isPassive && hasDenialShape(clause)) {
      pushFinding(
        findings, 'medium', 'denial-shape-on-non-gate-mechanism',
        `Clause "${clause.name}" defines a denialShape but its mechanism ("${clause.enforcementMechanism}") only observes/records — it cannot itself deny an action.`,
        `Either upgrade "${clause.name}" to a gate-style mechanism (pre-tool-gate, hook, capability-lease, mcp-gateway) if it must block a violation, or drop denialShape since a probe/transcript-event has nothing to deny.`,
        recommendations,
      );
    }
  }

  const totalWeight = findings.reduce((sum, f) => sum + ((SEVERITY_WEIGHT[f.severity] ?? (() => { throw new Error(`unknown finding severity: ${f.severity}`); })())), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('Articles meet the enforcement-beats-hope bar: every clause has a concrete, daemon-observable mechanism, gates define their denial shape, and identity is daemon-issued and signed.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: articles_audit.mjs --input <articles-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditArticles(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`articles_audit: ${error.message}\n`);
    process.exit(1);
  }
}
