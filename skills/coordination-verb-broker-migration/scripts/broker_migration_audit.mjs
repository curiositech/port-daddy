#!/usr/bin/env node
// broker_migration_audit.mjs — deterministic audit of a coordination MCP's
// legacy-etiquette-verb-to-broker-tool migration. Pure stdlib, no deps.
//
// Usage:
//   node broker_migration_audit.mjs --input <broker-migration-spec>.json
//
// Exports:
//   auditBrokerMigration(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The enforced broker MUST shrink to exactly these 5 tools — see
// references/verb-collapse-migration-paths.md. Never add to this list to
// "make a spec pass"; growing it IS the failure this script exists to catch.
const CANONICAL_TOOLS = ['work', 'act', 'ask', 'recall', 'status'];

// The only three retirement paths that count as a real migration. Anything
// else — including but not limited to the literal string "parallel-runtime"
// — is a second live code path answering the same question as the new tool,
// which is forbidden regardless of what it's called.
const VALID_MIGRATION_PATHS = new Set(['intake-metadata', 'alias', 'doc-history']);

// How many legacy etiquette verbs the collapse is expected to account for.
// This is a documented expectation (see references/verb-collapse-migration-
// paths.md), not a hard schema constraint — a mismatch is a real signal that
// the inventory is incomplete, so it is scored (high) rather than silently
// ignored, but it does not by itself fail closed the way an unmapped verb does.
const EXPECTED_LEGACY_VERB_COUNT = 19;

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditBrokerMigration: input must be a JSON object');
  }
  if (!Array.isArray(spec.brokerTools)) {
    throw new Error('auditBrokerMigration: "brokerTools" must be an array (may be empty)');
  }
  for (const [i, tool] of spec.brokerTools.entries()) {
    if (!tool || typeof tool.name !== 'string' || tool.name.trim() === '') {
      throw new Error(`auditBrokerMigration: brokerTools[${i}] must have a non-empty string "name"`);
    }
    if (typeof tool.denialShape !== 'boolean' || typeof tool.transcriptEvent !== 'boolean') {
      throw new Error(`auditBrokerMigration: brokerTools[${i}] ("${tool.name}") must have boolean "denialShape" and "transcriptEvent"`);
    }
  }
  if (!Array.isArray(spec.legacyVerbs)) {
    throw new Error('auditBrokerMigration: "legacyVerbs" must be an array (may be empty)');
  }
  for (const [i, verb] of spec.legacyVerbs.entries()) {
    if (!verb || typeof verb.name !== 'string' || verb.name.trim() === '') {
      throw new Error(`auditBrokerMigration: legacyVerbs[${i}] must have a non-empty string "name"`);
    }
    if (verb.mappedTo !== null && typeof verb.mappedTo !== 'string') {
      throw new Error(`auditBrokerMigration: legacyVerbs[${i}] ("${verb.name}") "mappedTo" must be a string or null`);
    }
    if (typeof verb.migrationPath !== 'string' || verb.migrationPath.trim() === '') {
      throw new Error(`auditBrokerMigration: legacyVerbs[${i}] ("${verb.name}") must have a non-empty string "migrationPath"`);
    }
  }
  if (typeof spec.complianceMode !== 'string' || !/^C[0-6]$/.test(spec.complianceMode)) {
    throw new Error('auditBrokerMigration: "complianceMode" must be one of "C0".."C6"');
  }
  if (typeof spec.emitsLegacyVerbCalls !== 'boolean') {
    throw new Error('auditBrokerMigration: "emitsLegacyVerbCalls" must be a boolean');
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a coordination MCP's broker-collapse migration: whether its ~19
 * legacy etiquette verbs have actually shrunk into the 5 enforced tools
 * (work/act/ask/recall/status), each carrying a denial shape and a
 * transcript event, migrated through a real retirement path (never a
 * parallel runtime), with zero legacy-verb calls once a body is at
 * compliance mode C4+ (the IT-018 Broker Collapse gate).
 *
 * @param {object} spec
 * @param {Array<{name:string, denialShape:boolean, transcriptEvent:boolean}>} spec.brokerTools
 * @param {Array<{name:string, mappedTo:('work'|'act'|'ask'|'recall'|'status'|null), migrationPath:string}>} spec.legacyVerbs
 * @param {string} spec.complianceMode - "C0".."C6"
 * @param {boolean} spec.emitsLegacyVerbCalls
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditBrokerMigration(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Legacy verb → canonical tool mapping ---------------------------------
  // Fail closed: a verb only counts as mapped if its target is null-free AND
  // is one of the 5 canonical tools. A garbage/unknown mappedTo string is
  // exactly as unsafe as an explicit null — neither proves the verb actually
  // routes to an enforced tool.
  for (const verb of spec.legacyVerbs) {
    const mappedCleanly = verb.mappedTo !== null && CANONICAL_TOOLS.includes(verb.mappedTo);
    if (!mappedCleanly) {
      pushFinding(
        findings, 'critical', 'verb-unmapped',
        `Legacy verb "${verb.name}" has mappedTo=${JSON.stringify(verb.mappedTo)}, which is not one of the 5 enforced tools (work/act/ask/recall/status).`,
        `Map "${verb.name}" to exactly one of work/act/ask/recall/status before this migration can be considered complete.`,
        recommendations,
      );
    }
  }

  // --- Migration path: real retirement, never a parallel runtime -----------
  for (const verb of spec.legacyVerbs) {
    if (!VALID_MIGRATION_PATHS.has(verb.migrationPath)) {
      pushFinding(
        findings, 'critical', 'parallel-runtime-migration',
        `Legacy verb "${verb.name}" has migrationPath=${JSON.stringify(verb.migrationPath)}, which is not one of the recognized retirement paths (intake-metadata, alias, doc-history) — treated as a forbidden parallel runtime.`,
        `Retire "${verb.name}" through intake-metadata, an alias, or documented history — never keep it live as a second code path answering the same question as the new tool.`,
        recommendations,
      );
    }
  }

  // --- Legacy verb inventory completeness -----------------------------------
  if (spec.legacyVerbs.length !== EXPECTED_LEGACY_VERB_COUNT) {
    pushFinding(
      findings, 'high', 'legacy-inventory-incomplete',
      `Spec accounts for ${spec.legacyVerbs.length} legacy verb(s); the documented collapse inventory expects ${EXPECTED_LEGACY_VERB_COUNT}.`,
      `Reconcile the legacyVerbs list against the full etiquette-verb inventory before treating the migration as complete — a verb left off the list can still be called by old clients unnoticed.`,
      recommendations,
    );
  }

  // --- Broker tool surface: exactly the 5, never more, never fewer ---------
  const brokerToolNames = new Set(spec.brokerTools.map((t) => t.name));
  const extraTools = [...brokerToolNames].filter((name) => !CANONICAL_TOOLS.includes(name));
  for (const name of extraTools) {
    pushFinding(
      findings, 'critical', 'broker-grew',
      `Broker tool surface includes "${name}", which is not one of the 5 enforced tools (work/act/ask/recall/status) — the broker is growing, not shrinking.`,
      `Remove "${name}" from the broker tool surface; route whatever it does through one of the 5 enforced tools instead.`,
      recommendations,
    );
  }
  const missingTools = CANONICAL_TOOLS.filter((name) => !brokerToolNames.has(name));
  for (const name of missingTools) {
    pushFinding(
      findings, 'critical', 'broker-tool-missing',
      `Enforced tool "${name}" is missing from the broker tool surface — any legacy verb mapped to it points at a tool that does not exist.`,
      `Add "${name}" to the broker tool surface with a denial shape and a transcript event before mapping any legacy verb to it.`,
      recommendations,
    );
  }

  // --- Each of the 5 tools carries one denial shape + one transcript event -
  for (const tool of spec.brokerTools) {
    if (!CANONICAL_TOOLS.includes(tool.name)) continue; // already flagged as broker-grew
    if (!tool.denialShape || !tool.transcriptEvent) {
      const missingParts = [
        !tool.denialShape ? 'a denial shape' : null,
        !tool.transcriptEvent ? 'a transcript event' : null,
      ].filter(Boolean).join(' and ');
      pushFinding(
        findings, 'critical', 'broker-tool-no-denial-or-transcript',
        `Enforced tool "${tool.name}" is missing ${missingParts} — every enforced tool must declare both.`,
        `Give "${tool.name}" both a denial shape and a transcript event before this migration can be considered enforced.`,
        recommendations,
      );
    }
  }

  // --- Compliance mode gate: C4+ must emit zero legacy-verb calls -----------
  // (IT-018 Broker Collapse gate.) Advisory bodies (C0-C3) may still call the
  // legacy surface without penalty — this gate only bites once a body claims
  // enforced coordination.
  const complianceLevel = Number(spec.complianceMode.slice(1));
  if (complianceLevel >= 4 && spec.emitsLegacyVerbCalls === true) {
    pushFinding(
      findings, 'critical', 'c4plus-emits-legacy-verbs',
      `Body is declared at compliance mode ${spec.complianceMode} (C4+) but emitsLegacyVerbCalls is true — the IT-018 Broker Collapse gate requires zero legacy-verb calls at C4 and above.`,
      `Either stop emitting legacy-verb calls entirely before claiming ${spec.complianceMode}, or move the body back to an advisory mode (C0-C3) until the migration is finished.`,
      recommendations,
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 0), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('Migration meets the broker-collapse bar: all legacy verbs map to the 5 enforced tools through a real retirement path, every tool declares denial + transcript, and the compliance-mode gate is satisfied.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: broker_migration_audit.mjs --input <broker-migration-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditBrokerMigration(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`broker_migration_audit: ${error.message}\n`);
    process.exit(1);
  }
}
