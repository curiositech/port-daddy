#!/usr/bin/env node
// binder_coverage_audit.mjs — deterministic audit of a multi-document
// product-architecture binder's completeness, contradiction status, and
// ambition-archaeology classification, for the Harbor Architect of Record
// discipline. Pure stdlib, no deps.
//
// Usage:
//   node binder_coverage_audit.mjs --input <binder-coverage-spec>.json
//
// Exports:
//   auditBinderCoverage(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRADICTION_KINDS = ['term', 'authority', 'schema', 'shipped-vs-target'];
const AMBITION_CLASSIFICATIONS = ['absorbed', 'superseded', 'deferred', 'contradicted', 'orphaned', 'rejected'];
const COVERAGE_AXES = ['customerAxisComplete', 'contingencyAxisComplete', 'architectureAxisComplete'];

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function severityWeight(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHT, severity)) {
    throw new Error(`unknown finding severity "${severity}" (expected one of ${Object.keys(SEVERITY_WEIGHT).join(', ')})`);
  }
  return SEVERITY_WEIGHT[severity];
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditBinderCoverage: input must be a JSON object');
  }
  if (!Array.isArray(spec.documents)) {
    throw new Error('auditBinderCoverage: "documents" must be an array (may be empty)');
  }
  for (const [i, doc] of spec.documents.entries()) {
    if (!doc || !isNonEmptyString(doc.name)) {
      throw new Error(`auditBinderCoverage: documents[${i}] must have a non-empty string "name"`);
    }
    if (!Array.isArray(doc.claimedCapabilities)) {
      throw new Error(`auditBinderCoverage: documents[${i}] ("${doc.name}") must have a "claimedCapabilities" array (may be empty)`);
    }
    for (const [j, cap] of doc.claimedCapabilities.entries()) {
      if (!cap || !isNonEmptyString(cap.name)) {
        throw new Error(`auditBinderCoverage: documents[${i}].claimedCapabilities[${j}] must have a non-empty string "name"`);
      }
    }
  }
  if (!Array.isArray(spec.contradictions)) {
    throw new Error('auditBinderCoverage: "contradictions" must be an array (may be empty)');
  }
  for (const [i, c] of spec.contradictions.entries()) {
    if (!c || !CONTRADICTION_KINDS.includes(c.kind)) {
      throw new Error(`auditBinderCoverage: contradictions[${i}] "kind" must be one of ${CONTRADICTION_KINDS.join('|')}`);
    }
    if (typeof c.resolved !== 'boolean') {
      throw new Error(`auditBinderCoverage: contradictions[${i}] must have a boolean "resolved"`);
    }
  }
  if (!Array.isArray(spec.ambitionCorpus)) {
    throw new Error('auditBinderCoverage: "ambitionCorpus" must be an array (may be empty)');
  }
  for (const [i, a] of spec.ambitionCorpus.entries()) {
    if (!a || !isNonEmptyString(a.name)) {
      throw new Error(`auditBinderCoverage: ambitionCorpus[${i}] must have a non-empty string "name"`);
    }
    if (a.classification !== null && a.classification !== undefined && !AMBITION_CLASSIFICATIONS.includes(a.classification)) {
      throw new Error(`auditBinderCoverage: ambitionCorpus[${i}] ("${a.name}") "classification" must be null or one of ${AMBITION_CLASSIFICATIONS.join('|')}`);
    }
  }
  if (!spec.coverageMatrix || typeof spec.coverageMatrix !== 'object') {
    throw new Error('auditBinderCoverage: "coverageMatrix" object is required ({ customerAxisComplete, contingencyAxisComplete, architectureAxisComplete })');
  }
  for (const axis of COVERAGE_AXES) {
    if (typeof spec.coverageMatrix[axis] !== 'boolean') {
      throw new Error(`auditBinderCoverage: "coverageMatrix.${axis}" must be a boolean`);
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a binder-coverage spec against the Harbor Architect of Record bar:
 * every claimed capability proven (owner + gate + evidence), every
 * cross-chapter contradiction resolved, every ambition-corpus entry
 * classified, and all three coverage axes (customer, contingency,
 * architecture) complete.
 *
 * @param {object} spec
 * @param {Array<{name:string, claimedCapabilities:Array<{name:string, owner?:string, gate?:string, evidenceLink?:string}>}>} spec.documents
 * @param {Array<{kind:'term'|'authority'|'schema'|'shipped-vs-target', resolved:boolean}>} spec.contradictions
 * @param {Array<{name:string, classification:'absorbed'|'superseded'|'deferred'|'contradicted'|'orphaned'|'rejected'|null}>} spec.ambitionCorpus
 * @param {{customerAxisComplete:boolean, contingencyAxisComplete:boolean, architectureAxisComplete:boolean}} spec.coverageMatrix
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditBinderCoverage(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Empty corpus: nothing to audit is not the same as safe -------------
  if (spec.documents.length === 0) {
    pushFinding(
      findings, 'critical', 'empty-corpus',
      'Binder spec lists zero documents — there is no corpus to be complete or consistent against.',
      'Add at least the binder README and every numbered chapter as a document before claiming any coverage.',
      recommendations,
    );
  }

  // --- Claimed capabilities: owner + gate + evidence, or it is prose ------
  for (const doc of spec.documents) {
    if (doc.claimedCapabilities.length === 0) {
      pushFinding(
        findings, 'medium', 'document-without-capabilities',
        `Document "${doc.name}" lists zero claimed capabilities — nothing in it is covered or falsifiable yet.`,
        `Enumerate "${doc.name}"'s claimed capabilities explicitly, or note it as narrative-only if it makes no capability claims.`,
        recommendations,
      );
      continue;
    }
    for (const cap of doc.claimedCapabilities) {
      const missing = [];
      if (!isNonEmptyString(cap.owner)) missing.push('owner');
      if (!isNonEmptyString(cap.gate)) missing.push('gate');
      if (!isNonEmptyString(cap.evidenceLink)) missing.push('evidenceLink');
      if (missing.length > 0) {
        pushFinding(
          findings, 'critical', 'capability-without-owner-gate-evidence',
          `Capability "${cap.name}" in "${doc.name}" is missing ${missing.join(', ')} — a claim without a proof.`,
          `Assign an accountable owner, a testable acceptance gate, and a link to real evidence for "${cap.name}" before citing it as covered.`,
          recommendations,
        );
      }
    }
  }

  // --- Cross-chapter contradictions: resolved or it is an open defect -----
  for (const [i, c] of spec.contradictions.entries()) {
    if (c.resolved === false) {
      pushFinding(
        findings, 'critical', 'unresolved-contradiction',
        `Unresolved ${c.kind} contradiction (contradictions[${i}]) — two chapters disagree and no fix has landed.`,
        `Resolve the ${c.kind} contradiction with a source-linked fix, or mark the affected section "blocked pending synthesis" until it is.`,
        recommendations,
      );
    }
  }

  // --- Ambition archaeology: every old promise gets a destination ---------
  if (spec.ambitionCorpus.length === 0) {
    pushFinding(
      findings, 'low', 'ambition-corpus-not-yet-swept',
      'Ambition corpus is empty — the baseline archaeology sweep has not been run or recorded yet.',
      'Run the ambition-archaeology sweep over the older promise corpus (website, V4 plans, examples, ADRs) and record at least one classified entry.',
      recommendations,
    );
  } else {
    for (const a of spec.ambitionCorpus) {
      if (a.classification === null || a.classification === undefined) {
        pushFinding(
          findings, 'critical', 'ambition-unclassified',
          `Ambition "${a.name}" has no classification — accidental amnesia, not a decision.`,
          `Classify "${a.name}" as absorbed, superseded, deferred, contradicted, orphaned, or rejected, with a rationale and a destination.`,
          recommendations,
        );
      }
    }
  }

  // --- Coverage matrix: all three axes, not "nothing flagged as broken" ---
  for (const axis of COVERAGE_AXES) {
    if (spec.coverageMatrix[axis] !== true) {
      pushFinding(
        findings, 'critical', 'coverage-axis-incomplete',
        `Coverage axis "${axis}" is not complete.`,
        `Fill every row of the "${axis}" coverage matrix (owner, status, gate, failure mode, recovery path, source) before calling the binder complete.`,
        recommendations,
      );
    }
  }

  const totalWeight = findings.reduce((sum, f) => sum + (severityWeight(f.severity)), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('Binder meets the completeness bar: every capability proven, every contradiction resolved, every ambition classified, all three coverage axes complete.');
  }

  // --- Mandatory ledger line: every run writes one, including ALL QUIET ---
  const totalCapabilities = spec.documents.reduce((sum, d) => sum + d.claimedCapabilities.length, 0);
  const completeCapabilities = spec.documents.reduce(
    (sum, d) => sum + d.claimedCapabilities.filter(
      (cap) => isNonEmptyString(cap.owner) && isNonEmptyString(cap.gate) && isNonEmptyString(cap.evidenceLink),
    ).length,
    0,
  );
  const resolvedContradictions = spec.contradictions.filter((c) => c.resolved === true).length;
  const classifiedAmbitions = spec.ambitionCorpus.filter(
    (a) => a.classification !== null && a.classification !== undefined,
  ).length;
  const axesComplete = COVERAGE_AXES.filter((axis) => spec.coverageMatrix[axis] === true).length;
  const firstCritical = findings.find((f) => f.severity === 'critical');
  const handover = firstCritical
    ? `start with ${firstCritical.id} (${firstCritical.message})`
    : 'no critical findings; re-verify evidence links still resolve and continue the ambition sweep for newly added corpus sources.';

  recommendations.push(
    `binder-aor-log: <ISO timestamp> | window <last-entry>..now | ` +
    `documents scanned: ${spec.documents.length} | ` +
    `capabilities: ${completeCapabilities}/${totalCapabilities} owner+gate+evidence complete | ` +
    `contradictions: ${resolvedContradictions}/${spec.contradictions.length} resolved | ` +
    `ambitions classified: ${classifiedAmbitions}/${spec.ambitionCorpus.length} | ` +
    `coverage axes: ${axesComplete}/3 complete | ` +
    `confidence: ${score}/100 | ` +
    `handover: ${handover}`,
  );

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: binder_coverage_audit.mjs --input <spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditBinderCoverage(spec), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`binder_coverage_audit: ${error.message}\n`);
    process.exit(1);
  }
}
