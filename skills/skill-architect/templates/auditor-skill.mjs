#!/usr/bin/env node
// Template: deterministic-auditor skill scorer.
// Copy to skills/<your-skill>/scripts/<verb>_<noun>.mjs and fill in the checks.
// See references/deterministic-auditor-archetype.md. Stdlib only; no dependencies.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEVERITY_WEIGHT = { critical: 100, high: 25, medium: 10, low: 3 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a <Thing> spec against its quality gates. Throws on malformed input;
 * returns { pass, score, findings, recommendations }. Fails CLOSED — verify safe
 * conditions positively, never treat a missing failure signal as "safe".
 * @param {object} spec
 */
export function auditThing(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('spec must be a JSON object');
  }
  const findings = [];
  const recommendations = [];

  // --- Example check (delete): every declared gate must map to an enforcement. ---
  // for (const clause of asArray(spec.clauses)) {
  //   if (!clause.enforcementMechanism) {
  //     pushFinding(findings, 'critical', 'clause-not-enforced',
  //       `Clause "${clause.name}" has no enforcement mechanism — it degrades to hope.`,
  //       `Give "${clause.name}" a probe/hook/gate/lease the daemon can observe.`, recommendations);
  //   }
  // }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const pass = !findings.some((f) => f.severity === 'critical') && score >= 75;
  if (pass) recommendations.push('Spec meets the bar on every gate. Proceed.');
  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: <verb>_<noun>.mjs --input <spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditThing(spec), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`auditor: ${error.message}\n`);
    process.exit(1);
  }
}
