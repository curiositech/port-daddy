#!/usr/bin/env node
// proof_manifest_audit.mjs — deterministic audit of a PR's visual-evidence
// proof manifests before the proof-manifest gate lets a control-panel or
// daemon-backed PR land. Pure stdlib, no deps.
//
// Usage:
//   node proof_manifest_audit.mjs --input <proof-manifest-spec>.json
//
// Exports:
//   auditProofManifest(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The six fields that turn a screenshot/GIF/recording from an unverifiable
// claim into evidence bound to a real running daemon at a real commit. See
// docs/architecture/agent-harbor-technical-binder/work-packets/
// redteam-agent-harbor-control-plane.md, "False Proof And Compliance Theater"
// item 5, "Required fix".
const REQUIRED_MANIFEST_FIELDS = [
  'daemonPort',
  'runId',
  'transcriptHeadHash',
  'agentNodeId',
  'commit',
  'sourceLabel',
];

// The canonical state-coverage set a control-panel PR's proof set must span.
// Condensed from operator-control-panel-ux-flow.md's "Proof Artifacts Needed"
// list (first-run/blocked/live/gate/interrupt/stale/receipt families).
const REQUIRED_STATES = ['active', 'historical', 'blocked', 'stale', 'gate', 'interrupt', 'receipt'];

const SOURCE_LABELS = ['real', 'fixture', 'mock'];

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditProofManifest: input must be a JSON object');
  }
  if (!isNonEmptyString(spec.branchCommit)) {
    throw new Error('auditProofManifest: "branchCommit" is required and must be a non-empty string');
  }
  if (typeof spec.isControlPanelPr !== 'boolean') {
    throw new Error('auditProofManifest: "isControlPanelPr" is required and must be a boolean');
  }
  if (!Array.isArray(spec.statesCovered)) {
    throw new Error('auditProofManifest: "statesCovered" must be an array (may be empty)');
  }
  for (const [i, state] of spec.statesCovered.entries()) {
    if (!REQUIRED_STATES.includes(state)) {
      throw new Error(
        `auditProofManifest: statesCovered[${i}] ("${state}") is not one of: ${REQUIRED_STATES.join(', ')}`,
      );
    }
  }
  if (!Array.isArray(spec.artifacts)) {
    throw new Error('auditProofManifest: "artifacts" must be an array (may be empty)');
  }
  for (const [i, artifact] of spec.artifacts.entries()) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error(`auditProofManifest: artifacts[${i}] must be an object`);
    }
    if (!isNonEmptyString(artifact.file)) {
      throw new Error(`auditProofManifest: artifacts[${i}].file is required and must be a non-empty string`);
    }
    if (!artifact.manifest || typeof artifact.manifest !== 'object' || Array.isArray(artifact.manifest)) {
      throw new Error(
        `auditProofManifest: artifacts[${i}] ("${artifact.file}") must have a "manifest" object ` +
          '(pass {} if the artifact truly carries no provenance yet)',
      );
    }
    const m = artifact.manifest;
    if (m.daemonPort !== undefined && m.daemonPort !== null && typeof m.daemonPort !== 'number') {
      throw new Error(`auditProofManifest: artifacts[${i}].manifest.daemonPort must be a number if present`);
    }
    for (const field of ['runId', 'transcriptHeadHash', 'agentNodeId', 'commit']) {
      if (m[field] !== undefined && m[field] !== null && typeof m[field] !== 'string') {
        throw new Error(`auditProofManifest: artifacts[${i}].manifest.${field} must be a string if present`);
      }
    }
    if (m.sourceLabel !== undefined && m.sourceLabel !== null && !SOURCE_LABELS.includes(m.sourceLabel)) {
      throw new Error(
        `auditProofManifest: artifacts[${i}].manifest.sourceLabel ("${m.sourceLabel}") must be one of: ${SOURCE_LABELS.join(', ')}`,
      );
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

/**
 * Audit a PR's visual-evidence proof manifests against the proof-manifest
 * gate: every artifact must be bound to a real daemon port, run id,
 * transcript head hash, agent node id, and the PR's own branch commit, with
 * an honestly-declared real/fixture/mock source label. Control-panel PRs
 * must additionally cover the full required state set.
 *
 * This audits PROVENANCE STRUCTURE ONLY — it cannot itself prove a
 * "real"-labeled artifact wasn't staged; it can only prove the manifest is
 * complete, internally consistent, and bound to the branch under review.
 *
 * @param {object} spec
 * @param {string} spec.branchCommit - the PR branch's current commit SHA.
 * @param {boolean} spec.isControlPanelPr - true if this PR touches the
 *   operator control-panel surface and must clear full state coverage.
 * @param {string[]} spec.statesCovered - subset of REQUIRED_STATES this PR's
 *   artifact set demonstrates.
 * @param {Array<{file:string, manifest:{daemonPort?:number, runId?:string,
 *   transcriptHeadHash?:string, agentNodeId?:string, commit?:string,
 *   sourceLabel?:'real'|'fixture'|'mock'}}>} spec.artifacts
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditProofManifest(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Baseline: is there any evidence at all? -----------------------------
  // Fail closed: zero artifacts is never a safe default, even for a PR that
  // "obviously" has no visual surface — the gate exists precisely so an
  // agent cannot skip proof by omission.
  if (spec.artifacts.length === 0) {
    pushFinding(
      findings, 'critical', 'no-artifacts',
      'No proof artifacts supplied — a visual-evidence gate cannot pass on zero evidence.',
      'Attach at least one screenshot/GIF/recording artifact with a full provenance manifest before requesting review.',
      recommendations,
    );
  }

  // --- Per-artifact provenance ------------------------------------------------
  for (const artifact of spec.artifacts) {
    const m = artifact.manifest;
    const missingFields = REQUIRED_MANIFEST_FIELDS.filter((field) => isMissing(m[field]));
    if (missingFields.length > 0) {
      pushFinding(
        findings, 'critical', 'manifest-missing-provenance-field',
        `Artifact "${artifact.file}" manifest is missing required provenance field(s): ${missingFields.join(', ')}.`,
        `Fill in ${missingFields.join(', ')} on "${artifact.file}"'s manifest before it can count as daemon-backed proof.`,
        recommendations,
      );
    }

    // sourceLabel gets its own named finding on top of the generic one above
    // because it is the single field that distinguishes real evidence from a
    // disguised mock — the exact failure mode named in redteam item 5 ("a
    // mock or visual artifact can fake the hardest part"). An artifact with
    // every other field filled in but no sourceLabel is not a smaller
    // problem than a fully empty manifest; it is the specific problem.
    if (isMissing(m.sourceLabel)) {
      pushFinding(
        findings, 'critical', 'undeclared-source-label',
        `Artifact "${artifact.file}" does not declare whether its data is real, fixture, or mock.`,
        'Label every artifact manifest sourceLabel as "real", "fixture", or "mock" — an undeclared label is indistinguishable from a disguised mock.',
        recommendations,
      );
    }

    if (!isMissing(m.commit) && m.commit !== spec.branchCommit) {
      pushFinding(
        findings, 'critical', 'commit-mismatch',
        `Artifact "${artifact.file}" manifest.commit ("${m.commit}") does not match the PR's branch commit ("${spec.branchCommit}").`,
        `Regenerate "${artifact.file}" against the current branch commit — a stale-commit artifact is reused proof, not fresh evidence.`,
        recommendations,
      );
    }
  }

  // --- Control-panel state coverage -------------------------------------------
  if (spec.isControlPanelPr === true) {
    const missingStates = REQUIRED_STATES.filter((state) => !spec.statesCovered.includes(state));
    if (missingStates.length > 0) {
      pushFinding(
        findings, 'critical', 'control-panel-state-coverage-incomplete',
        `Control-panel PR is missing proof-artifact coverage for required state(s): ${missingStates.join(', ')}.`,
        `Capture and manifest at least one artifact for each of: ${missingStates.join(', ')}.`,
        recommendations,
      );
    }
  }

  const totalWeight = findings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 0), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push(
      'Proof-manifest gate satisfied: every artifact carries a full, branch-bound provenance manifest with an honest source label, and required state coverage is complete.',
    );
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: proof_manifest_audit.mjs --input <proof-manifest-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const spec = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditProofManifest(spec), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`proof_manifest_audit: ${e.message}\n`);
    process.exit(1);
  }
}
