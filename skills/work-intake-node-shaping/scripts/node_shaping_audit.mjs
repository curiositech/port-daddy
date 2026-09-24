#!/usr/bin/env node
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;
const schema = JSON.parse(readFileSync(new URL('../schemas/work-intake-spec.schema.json', import.meta.url), 'utf8'));
const validateShape = new Ajv2020({allErrors: true, strict: true}).compile(schema);
const issue = (id, message) => ({severity: 'critical', id, message});
const schemaIssues = () => (validateShape.errors || []).map(error => issue('schema-' + error.keyword, (error.instancePath || '/') + ' ' + error.message));
const validRouteVerbs = new Set(['spawn', 'dispatch', 'sortie', 'conjure', 'nightshift']);

export function auditNodeShaping(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input must be an object');
  if (!validateShape(input)) {
    return {pass: false, declarationValid: false, eligibleToAdmit: false, structuralBlocked: false, findings: schemaIssues(), scope: 'supplied-declaration-consistency-only'};
  }
  const findings = []; const fail = (id, message) => findings.push(issue(id, message));
  if (input.runnerUp.archetype === input.selectedArchetypes[0]) fail('runner-up-equals-selected', 'The runner-up must be a distinct local archetype.');
  for (const route of input.legacyRoutes) {
    if (!validRouteVerbs.has(route.verb)) fail('unknown-legacy-route', 'The imported local audit policy does not recognize this route verb.');
    if (route.writesIndependentState) fail('route-independent-write', 'A route declaring an independent persisted write cannot serve as a canonical target.');
  }
  const declarationValid = findings.length === 0;
  const approvalBlocked = input.approval.required && !input.approval.present;
  const assignmentBlocked = !input.assignment.authority || !input.assignment.resources;
  const eligibleToAdmit = declarationValid && !approvalBlocked && !assignmentBlocked;
  if (declarationValid && approvalBlocked) findings.push(issue('approval-required', 'The declaration is valid, but required approval is absent; do not admit this intake.'));
  if (declarationValid && assignmentBlocked) findings.push(issue('assignment-gate-unsatisfied', 'The declaration is valid, but authority or resources are unavailable; do not admit this intake.'));
  return {pass: declarationValid, declarationValid, eligibleToAdmit, structuralBlocked: declarationValid && !eligibleToAdmit, findings, scope: 'supplied-declaration-consistency-only'};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const index = process.argv.indexOf('--input');
    if (index < 0 || !process.argv[index + 1]) throw Error('usage: node_shaping_audit.mjs --input file.json');
    const result = auditNodeShaping(JSON.parse(readFileSync(process.argv[index + 1], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    if (!result.eligibleToAdmit) process.exitCode = 1;
  } catch (error) { console.error('node_shaping_audit: ' + error.message); process.exitCode = 1; }
}
