import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { auditControlContract, LIFECYCLE_STATES } from '../scripts/control_contract_audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const script = resolve(root, 'scripts/control_contract_audit.mjs');
const sample = JSON.parse(readFileSync(resolve(root, 'examples/research-sample-input.json'), 'utf8'));
const supportedStates = sample.profile.requiredLifecycleStates;
const unsupportedStates = ['requested', 'policy-denied', 'unsupported'];

function cloneSample() {
  return structuredClone(sample);
}

function pass(spec = sample) {
  return auditControlContract(spec).declarationPass;
}

test('complete constructed profile passes as declarations only', () => {
  const result = auditControlContract(sample);
  assert.equal(result.declarationPass, true);
  assert.equal(result.safeToRenderControls, false);
  assert.match(result.scope, /runtime evidence not assessed/);
});

test('one or several missing supported cells fail independently of any score', () => {
  const one = cloneSample();
  one.matrix = one.matrix.filter((cell) => !(cell.verb === 'steer' && cell.backend === 'adapter-example'));
  const oneResult = auditControlContract(one);
  assert.equal(oneResult.declarationPass, false);
  assert(oneResult.findings.some((finding) => finding.code === 'matrix-pair-missing'));

  const three = cloneSample();
  three.matrix = three.matrix.filter((cell) => cell.verb === 'steer' && cell.backend === 'adapter-example');
  const threeResult = auditControlContract(three);
  assert.equal(threeResult.declarationPass, false);
  assert.equal(threeResult.findings.filter((finding) => finding.code === 'matrix-pair-missing').length, 3);
});

test('contradictory duplicate pair cannot select the first passing row', () => {
  const spec = cloneSample();
  spec.matrix.push({ verb: 'steer', backend: 'adapter-example', support: 'unsupported', lifecycleStates: unsupportedStates });
  const result = auditControlContract(spec);
  assert.equal(result.declarationPass, false);
  assert(result.findings.some((finding) => finding.code === 'duplicate-matrix-pair'));
  assert(result.findings.some((finding) => finding.code === 'contradictory-matrix-duplicate'));
});

test('unknown backend or verb cross-reference fails', () => {
  const spec = cloneSample();
  spec.matrix.push({ verb: 'steer', backend: 'backend-100', support: 'supported', lifecycleStates: supportedStates });
  spec.backends[0].supportedVerbs.push('teleport');
  const result = auditControlContract(spec);
  assert.equal(result.declarationPass, false);
  assert(result.findings.some((finding) => finding.code === 'undeclared-matrix-backend'));
  assert(result.findings.some((finding) => finding.code === 'undeclared-supported-verb'));
});

test('numeric supported verb is rejected by type validation', () => {
  const spec = cloneSample();
  spec.backends[0].supportedVerbs[0] = 100;
  assert.throws(() => auditControlContract(spec), /supportedVerbs\[0\] must be a non-empty string/);
});

test('malformed arrays, null rows, and wrong field types fail with a message', () => {
  for (const spec of [null, [], { ...cloneSample(), verbs: null }, { ...cloneSample(), verbs: [null] },
    { ...cloneSample(), backends: [{}] }, { ...cloneSample(), authorization: null },
    { ...cloneSample(), matrix: [null] },
    { ...cloneSample(), profile: { ...sample.profile, requiredVerbs: ['steer', 7] } }]) {
    assert.throws(() => auditControlContract(spec), /must be|duplicates|unknown/);
  }
});

test('required verb profile is variable and a missing declared required verb fails', () => {
  const subset = {
    ...cloneSample(),
    profile: { ...sample.profile, requiredVerbs: ['interrupt'] },
    verbs: [sample.verbs[1]],
    backends: [{ ...sample.backends[0], supportedVerbs: ['interrupt'] }],
    matrix: [{ verb: 'interrupt', backend: 'adapter-example', support: 'supported', lifecycleStates: supportedStates }],
  };
  assert.equal(pass(subset), true);

  subset.profile.requiredVerbs = ['pause'];
  const result = auditControlContract(subset);
  assert.equal(result.declarationPass, false);
  assert(result.findings.some((finding) => finding.code === 'required-verb-missing'));
});

test('a required verb unsupported by every backend fails the profile', () => {
  const spec = cloneSample();
  spec.backends[0].supportedVerbs = [];
  for (const cell of spec.matrix.filter((row) => row.backend === 'adapter-example')) {
    cell.support = 'unsupported';
    cell.lifecycleStates = unsupportedStates;
  }
  const result = auditControlContract(spec);
  assert.equal(result.declarationPass, false);
  assert.equal(result.findings.filter((finding) => finding.code === 'required-verb-no-supporting-backend').length, 2);
});

test('unsupported and denied remain different; unsupported row cannot claim dispatch', () => {
  const good = cloneSample();
  const unsupported = good.matrix.find((cell) => cell.support === 'unsupported');
  assert(unsupported.lifecycleStates.includes('unsupported'));
  assert(unsupported.lifecycleStates.includes('policy-denied'));
  assert.equal(unsupported.lifecycleStates.includes('delivered'), false);
  assert.equal(pass(good), true);

  unsupported.lifecycleStates = ['requested', 'policy-denied', 'unsupported', 'delivered'];
  const bad = auditControlContract(good);
  assert.equal(bad.declarationPass, false);
  assert(bad.findings.some((finding) => finding.code === 'unsupported-pair-has-effect-state'));
});

test('authorization needs every binding and admission check; stale labels fail', () => {
  const missing = cloneSample();
  delete missing.authorization.bindings.fencingEpoch;
  assert.throws(() => auditControlContract(missing), /authorization\.bindings\.fencingEpoch/);

  const stale = cloneSample();
  stale.authorization.source = 'cached-projection';
  const staleResult = auditControlContract(stale);
  assert.equal(staleResult.declarationPass, false);
  assert(staleResult.findings.some((finding) => finding.code === 'stale-authorization-source'));

  const unchecked = cloneSample();
  unchecked.authorization.checks.fencingEpoch = false;
  const uncheckedResult = auditControlContract(unchecked);
  assert.equal(uncheckedResult.declarationPass, false);
  assert(uncheckedResult.findings.some((finding) => finding.code === 'authorization-binding-gap'));
});

test('duplicate names, supported-list entries, and matrix pairs fail cleanly', () => {
  const duplicateVerb = cloneSample();
  duplicateVerb.verbs.push({ ...duplicateVerb.verbs[0] });
  assert.throws(() => auditControlContract(duplicateVerb), /verbs\[\]\.name\[\d+\] duplicates/);

  const duplicateSupport = cloneSample();
  duplicateSupport.backends[0].supportedVerbs.push('steer');
  assert.throws(() => auditControlContract(duplicateSupport), /supportedVerbs\[2\] duplicates/);

  const duplicatePair = cloneSample();
  duplicatePair.matrix.push(structuredClone(duplicatePair.matrix[0]));
  const pairResult = auditControlContract(duplicatePair);
  assert(pairResult.findings.some((finding) => finding.code === 'duplicate-matrix-pair'));
});

test('lifecycle vocabulary separates acknowledgement, observed effect and uncertain expiry', () => {
  assert(LIFECYCLE_STATES.includes('acknowledged'));
  assert(LIFECYCLE_STATES.includes('effect-observed'));
  assert(LIFECYCLE_STATES.includes('expired-before-delivery'));
  assert(LIFECYCLE_STATES.includes('outcome-unknown'));
  assert(LIFECYCLE_STATES.includes('policy-denied'));
  assert(LIFECYCLE_STATES.includes('unsupported'));
  assert.equal(LIFECYCLE_STATES.includes('terminal'), false);
});

test('CLI returns nonzero for a structurally valid but incomplete audit', () => {
  const fixture = resolve(root, 'tests/fixtures/cli-missing-matrix-cell.json');
  const result = spawnSync(process.execPath, [script, '--input', fixture], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.declarationPass, false);
  assert.equal(output.safeToRenderControls, false);
});

test('CLI returns zero for a complete declaration but keeps UI safety false', () => {
  const result = spawnSync(process.execPath, [script, '--input', resolve(root, 'examples/research-sample-input.json')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.declarationPass, true);
  assert.equal(output.safeToRenderControls, false);
});

test('CLI returns nonzero for malformed invocation', () => {
  const badJson = resolve(root, 'tests/fixtures/cli-missing-matrix-cell.json');
  const malformedInvocation = spawnSync(process.execPath, [script, '--other', badJson], { encoding: 'utf8' });
  assert.equal(malformedInvocation.status, 1);
  assert.match(malformedInvocation.stderr, /usage:/);
});

test('schema exposes required keys and matching lifecycle vocabulary', () => {
  const schema = JSON.parse(readFileSync(resolve(root, 'schemas/control-contract.schema.json'), 'utf8'));
  assert.deepEqual(schema.required, ['profile', 'verbs', 'backends', 'authorization', 'matrix']);
  assert.deepEqual(schema.properties.matrix.items.required, ['verb', 'backend', 'support', 'lifecycleStates']);
  const schemaStates = schema.properties.matrix.items.properties.lifecycleStates.items.enum;
  assert.deepEqual(schemaStates, LIFECYCLE_STATES);
  const profileStates = schema.properties.profile.properties.requiredLifecycleStates.items.enum;
  assert.deepEqual(profileStates, LIFECYCLE_STATES.filter((state) => state !== 'unsupported'));
  assert.equal(schema.properties.matrix.items.properties.hasDistinctTerminalStates, undefined);
  assert.equal(schema.properties.verbs.items.properties.terminalStates, undefined);
});


test('unknown keys and retired terminalStates cannot be silently ignored', () => {
  for (const edit of [
    s => { s.extra = true; },
    s => { s.profile.extra = true; },
    s => { s.verbs[0].terminalStates = []; },
    s => { s.backends[0].extra = true; },
    s => { s.authorization.extra = true; },
    s => { s.authorization.bindings.extra = 'x'; },
    s => { s.authorization.checks.extra = true; },
    s => { s.matrix[0].terminalStates = []; },
  ]) {
    const s = cloneSample(); edit(s);
    assert.throws(() => auditControlContract(s), /unknown property/);
  }
});

test('wrong schema identifier and whitespace-only declarations are rejected', () => {
  const wrong = cloneSample(); wrong.$schema = 'other.json';
  assert.throws(() => auditControlContract(wrong), /input.\$schema/);
  const blank = cloneSample(); blank.verbs[0].intent = '   ';
  assert.throws(() => auditControlContract(blank), /non-empty string/);
});

test('pair identity remains distinct when names contain the former delimiter', () => {
  const s = cloneSample();
  s.profile.requiredVerbs = ['a', 'a\u0000b'];
  s.verbs = s.profile.requiredVerbs.map(name => ({name, intent:'Constructed pair-key collision fixture'}));
  s.backends = ['b\u0000c', 'c'].map(name => ({name, description:'Constructed', supportedVerbs:[...s.profile.requiredVerbs]}));
  s.matrix = s.verbs.flatMap(v => s.backends.map(b => ({verb:v.name, backend:b.name, support:'supported', lifecycleStates:[...supportedStates]})));
  assert.equal(pass(s), true);
  s.matrix.pop();
  assert.equal(pass(s), false);
});
