#!/usr/bin/env node
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const schema = JSON.parse(readFileSync(new URL('../schemas/parley-checkpoint.schema.json', import.meta.url), 'utf8'));
const validateShape = new Ajv2020({allErrors: true, strict: true}).compile(schema);
const text = value => typeof value === 'string' && value.trim().length > 0;
const issue = (id, message) => ({severity: 'critical', id, message});
const schemaIssues = () => (validateShape.errors || []).map(error => issue('schema-' + error.keyword, (error.instancePath || '/') + ' ' + error.message));

export function auditParleyCheckpoint(input) {
  if (!validateShape(input)) {
    return {pass: false, declarationValid: false, eligibleToAdmit: false, structuralBlocked: false, findings: schemaIssues(), scope: 'supplied-declaration-consistency-only'};
  }
  const findings = [];
  const fail = (id, message) => findings.push(issue(id, message));
  const nodeById = new Map();
  for (const node of input.nodes) {
    if (nodeById.has(node.id)) fail('duplicate-node-id', 'Each node ID must occur once in a graph revision.');
    else nodeById.set(node.id, node);
  }
  for (const node of input.nodes) for (const dependency of node.dependsOn) {
    if (!nodeById.has(dependency)) fail('unknown-dependency', 'Each dependency must name a node in this graph revision.');
  }
  const visiting = new Set(); const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) { fail('cycle', 'Graph contains a dependency cycle.'); return; }
    if (visited.has(id) || !nodeById.has(id)) return;
    visiting.add(id);
    for (const dependency of nodeById.get(id).dependsOn) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const id of nodeById.keys()) visit(id);

  const outcomeByNode = new Map();
  for (const outcome of input.outcomes) {
    if (!nodeById.has(outcome.nodeId)) fail('outcome-unknown-node', 'An outcome must name a current node.');
    if (outcome.revision !== input.graphRevision) fail('outcome-revision-mismatch', 'An outcome must bind this graph revision.');
    if (outcomeByNode.has(outcome.nodeId)) fail('duplicate-outcome', 'A checkpoint has one outcome per node.');
    else outcomeByNode.set(outcome.nodeId, outcome);
  }
  const prerequisiteClosure = (id, seen = new Set()) => {
    if (seen.has(id) || !nodeById.has(id)) return seen;
    seen.add(id);
    for (const dependency of nodeById.get(id).dependsOn) prerequisiteClosure(dependency, seen);
    return seen;
  };
  // A successful descendant is only coherent when every declared producer in
  // its transitive prerequisite closure has current successful evidence.
  for (const outcome of input.outcomes) {
    if (outcome.status !== 'success' || !nodeById.has(outcome.nodeId)) continue;
    for (const dependency of prerequisiteClosure(outcome.nodeId)) {
      if (dependency === outcome.nodeId) continue;
      const producer = outcomeByNode.get(dependency);
      if (!producer || producer.status !== 'success' || producer.revision !== input.graphRevision) {
        fail('success-missing-prerequisite-evidence', 'A successful outcome cannot be accepted while a declared transitive producer is absent, non-successful, or bound to another revision.');
      }
    }
  }
  const justFinished = new Set(input.justFinished);
  let waveNeedsRecovery = false;
  for (const id of justFinished) {
    if (!nodeById.has(id)) fail('finished-unknown-node', 'justFinished must name current nodes.');
    const outcome = outcomeByNode.get(id);
    if (!outcome || outcome.revision !== input.graphRevision) fail('incomplete-wave-evidence', 'Each just-finished node needs an outcome record bound to this revision.');
    else if (outcome.status !== 'success') waveNeedsRecovery = true;
  }
  for (const id of justFinished) {
    for (const dependency of prerequisiteClosure(id)) {
      if (dependency !== id && justFinished.has(dependency)) fail('causal-same-wave', 'A wave cannot record both a node and any declared transitive prerequisite as newly finished together.');
    }
  }

  const riskIds = new Set(); let unresolvedRisk = false;
  for (const risk of input.risks) {
    if (riskIds.has(risk.id)) fail('duplicate-risk-id', 'Each risk ID must occur once.');
    riskIds.add(risk.id);
    if (risk.revision !== input.graphRevision) fail('risk-revision-mismatch', 'A risk must bind this graph revision.');
    for (const id of risk.affectedNodes) if (!nodeById.has(id)) fail('risk-unknown-node', 'A risk may affect only current nodes.');
    if (risk.severity === 'high' || risk.severity === 'unknown') unresolvedRisk = true;
  }
  for (const id of input.nextWave) {
    const node = nodeById.get(id);
    if (!node) { fail('unknown-next-node', 'nextWave names an absent node.'); continue; }
    if (justFinished.has(id) || outcomeByNode.has(id)) fail('already-completed-launch', 'nextWave cannot launch a node already represented by a completion outcome. A rerun needs a new execution identity outside this contract.');
    for (const dependency of prerequisiteClosure(id)) {
      if (dependency === id) continue;
      const outcome = outcomeByNode.get(dependency);
      if (!outcome || outcome.status !== 'success' || outcome.revision !== input.graphRevision) fail('next-wave-dependency-not-success', 'Each declared transitive next-wave prerequisite needs successful evidence for this revision.');
    }
  }
  const declarationValid = findings.length === 0;
  const approvalBlocked = input.approval.required && !input.approval.present;
  const assignmentBlocked = !input.assignment.authority || !input.assignment.resources;
  const eligibleToAdmit = declarationValid && !approvalBlocked && !assignmentBlocked && !unresolvedRisk && !waveNeedsRecovery;
  if (declarationValid && approvalBlocked) findings.push(issue('approval-required', 'The declaration is structurally valid but required approval is absent; do not admit this wave.'));
  if (declarationValid && assignmentBlocked) findings.push(issue('assignment-gate-unsatisfied', 'The declaration is structurally valid but authority or resources are unavailable; do not admit this wave.'));
  if (declarationValid && unresolvedRisk) findings.push(issue('unresolved-risk', 'The declaration is structurally valid but high or unknown risk blocks admission.'));
  if (declarationValid && waveNeedsRecovery) findings.push(issue('wave-recovery-required', 'The completed wave contains a reported non-success outcome; local policy holds admission pending recovery review.'));
  return {pass: declarationValid, declarationValid, eligibleToAdmit, structuralBlocked: declarationValid && !eligibleToAdmit, findings, scope: 'supplied-declaration-consistency-only'};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const index = process.argv.indexOf('--input');
    if (index < 0 || !process.argv[index + 1]) throw Error('usage: parley_checkpoint_audit.mjs --input file.json');
    const result = auditParleyCheckpoint(JSON.parse(readFileSync(process.argv[index + 1], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    if (!result.eligibleToAdmit) process.exitCode = 1;
  } catch (error) { console.error('parley_checkpoint_audit: ' + error.message); process.exitCode = 1; }
}
