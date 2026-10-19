import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { auditInfraReadiness, PLAN_SCHEMA, REQUIRED_GATES } from './infra_readiness.mjs';

const sample = JSON.parse(readFileSync(new URL('../examples/sample-input.json', import.meta.url), 'utf8'));
const cli = new URL('./infra_readiness.mjs', import.meta.url);
const bundleDir = new URL('../', import.meta.url);
const clone = () => structuredClone(sample);

test('constructed complete plan passes declaration contract without a readiness score', () => {
  const result = auditInfraReadiness(sample);
  assert.equal(result.pass, true);
  assert.equal(result.status, 'PLAN_DECLARATIONS_COMPLETE');
  assert.equal(Object.hasOwn(result, 'score'), false);
  assert.match(result.evidenceBoundary, /does not verify/);
});

test('schema and API agree on mandatory gates; unknown local properties remain allowed', () => {
  assert.deepEqual(PLAN_SCHEMA.required, REQUIRED_GATES);
  const plan = clone();
  plan.localPlanningNote = { reviewer: 'local', field: 4 };
  assert.equal(auditInfraReadiness(plan).pass, true);
});

test('non-object public inputs throw; malformed object declarations return findings', () => {
  for (const malformed of [null, [], 'plan', 4]) {
    assert.throws(() => auditInfraReadiness(malformed), TypeError);
  }
  for (const malformed of [{ ...clone(), security: null }, { ...clone(), framework: [] }, { ...clone(), evaluation: { ...clone().evaluation, taskSet: null } }, { ...clone(), security: { ...clone().security, controls: {} } }]) {
    assert.doesNotThrow(() => auditInfraReadiness(malformed));
    assert.equal(auditInfraReadiness(malformed).pass, false);
  }
});

test('undefined, non-finite, callable, symbolic, sparse, accessor, custom and cyclic values fail without throwing', () => {
  const cyclic = clone(); cyclic.localPlanningNote = cyclic;
  const cases = [
    (p) => { p.localPlanningNote = undefined; },
    (p) => { p.localPlanningNote = NaN; },
    (p) => { p.localPlanningNote = Infinity; },
    (p) => { p.localPlanningNote = () => {}; },
    (p) => { p.localPlanningNote = Symbol('private'); },
    (p) => { p.localPlanningNote = 1n; },
    (p) => { p.localPlanningNote = new Array(2); },
    (p) => { p.localPlanningNote = { toJSON() { return {}; } }; },
    (p) => { Object.defineProperty(p, 'localPlanningNote', { enumerable: true, get() { return 'hidden'; } }); },
    (p) => { p.localPlanningNote = p; },
    (p) => { p.localPlanningNote = new Date(); },
    (p) => { p[Symbol('hidden')] = 'not JSON'; },
  ];
  for (const mutate of cases) {
    const plan = clone(); mutate(plan);
    assert.doesNotThrow(() => auditInfraReadiness(plan));
    assert.equal(auditInfraReadiness(plan).pass, false);
    assert.ok(auditInfraReadiness(plan).findings.some((f) => f.id.startsWith('schema-json-')));
  }
});

test('non-empty schema strings reject whitespace-only semantic fields', () => {
  const cases = [
    (p) => { p.security.owner = '   '; },
    (p) => { p.security.threats = ['   ']; },
    (p) => { p.effectPolicy.effects[2].authority = '   '; },
  ];
  for (const mutate of cases) { const plan = clone(); mutate(plan); assert.equal(auditInfraReadiness(plan).pass, false); }
});

test('workload effect classes and policy records must match exactly once', () => {
  const missing = clone(); missing.effectPolicy.effects = missing.effectPolicy.effects.filter((e) => e.effectClass === 'read-only');
  assert.ok(auditInfraReadiness(missing).findings.filter((f) => f.id === 'effect-policy-missing').length === 2);
  const duplicate = clone(); duplicate.effectPolicy.effects.push(structuredClone(duplicate.effectPolicy.effects[2]));
  assert.ok(auditInfraReadiness(duplicate).findings.some((f) => f.id === 'effect-policy-duplicate'));
  const undeclared = clone(); undeclared.effectPolicy.effects.push({ ...structuredClone(undeclared.effectPolicy.effects[0]), effectClass: 'irreversible-effect' });
  assert.ok(auditInfraReadiness(undeclared).findings.some((f) => f.id === 'effect-policy-undeclared'));
  const duplicatedDeclaration = clone(); duplicatedDeclaration.workload.effectClasses.push('read-only');
  assert.equal(auditInfraReadiness(duplicatedDeclaration).pass, false);
});

test('security, incident response, framework, evaluation and cost cap are required', () => {
  const cases = [
    ['security', (p) => { delete p.security; }],
    ['incidentResponse', (p) => { delete p.incidentResponse; }],
    ['framework', (p) => { delete p.framework; }],
    ['evaluation', (p) => { delete p.evaluation; }],
    ['per-task cap', (p) => { delete p.cost.perTaskCapUsd; }],
  ];
  for (const [label, mutate] of cases) {
    const plan = clone(); mutate(plan);
    const result = auditInfraReadiness(plan);
    assert.equal(result.pass, false, label);
  }
});

test('invalid enums, array items and duplicate task IDs fail', () => {
  const badEnum = clone(); badEnum.workload.deploymentStage = 'always-ready';
  assert.equal(auditInfraReadiness(badEnum).pass, false);
  const badItem = clone(); badItem.security.threats = [null];
  assert.equal(auditInfraReadiness(badItem).pass, false);
  const dupTask = clone(); dupTask.evaluation.taskSet[1].taskId = dupTask.evaluation.taskSet[0].taskId;
  assert.equal(auditInfraReadiness(dupTask).findings.some((f) => f.id === 'duplicate-task-id'), true);
});

test('negative and non-finite numeric values fail at the public API boundary', () => {
  for (const value of [-1, NaN, Infinity, -Infinity]) {
    const plan = clone(); plan.cost.perTaskCapUsd = value;
    assert.equal(auditInfraReadiness(plan).pass, false, String(value));
  }
  const mcp = clone(); mcp.mcp = { used: true, rationale: 'Protocol required.', protocolVersion: '2025-11-25', contextOverheadPct: -0.1, measurementRef: 'local-run' };
  assert.equal(auditInfraReadiness(mcp).pass, false);
  const mcpString = clone(); mcpString.mcp = { used: true, rationale: 'Protocol required.', protocolVersion: '2025-11-25', contextOverheadPct: '12', measurementRef: 'local-run' };
  assert.equal(auditInfraReadiness(mcpString).pass, false);
});

test('optional ISO date accepts absence and valid dates, rejects impossible calendar dates', () => {
  const absent = clone(); delete absent.reviewedAt;
  assert.equal(auditInfraReadiness(absent).pass, true);
  const validLeap = clone(); validLeap.reviewedAt = '2024-02-29';
  assert.equal(auditInfraReadiness(validLeap).pass, true);
  for (const date of ['2026-02-29', '2026-13-01', '2026-9-01', 'September 24, 2026', null]) {
    const plan = clone(); plan.reviewedAt = date;
    assert.equal(auditInfraReadiness(plan).pass, false, String(date));
  }
});

test('optional memory and MCP remain optional; declared use needs boundaries', () => {
  const plan = clone(); delete plan.memory; delete plan.mcp;
  assert.equal(auditInfraReadiness(plan).pass, true);
  const memory = clone(); memory.memory = { used: true, rationale: 'Persist user-specific context.', layers: ['user-memory'] };
  assert.equal(auditInfraReadiness(memory).findings.some((f) => f.id === 'memory-lifecycle-missing'), true);
  const mcp = clone(); mcp.mcp = { used: true, rationale: 'Interoperability required.' };
  assert.equal(auditInfraReadiness(mcp).findings.some((f) => f.id === 'mcp-version-missing'), true);
});

test('externally visible effects need an authorization and replay policy', () => {
  const plan = clone();
  plan.effectPolicy.effects[2].approval = 'none';
  plan.effectPolicy.effects[2].idempotency = 'not-applicable';
  const findings = auditInfraReadiness(plan).findings.map((f) => f.id);
  assert.ok(findings.includes('unbounded-effect-policy'));
  assert.ok(findings.includes('effect-replay-unaddressed'));
});

test('not-applicable controls require a reason instead of silently disappearing', () => {
  const plan = clone();
  plan.incidentResponse.applicability = 'not-applicable';
  plan.incidentResponse.rationale = 'No deployed process or external effect exists in the scoped local prototype.';
  plan.incidentResponse.failureScenarios = [];
  plan.incidentResponse.containment = [];
  plan.incidentResponse.recovery = [];
  assert.equal(auditInfraReadiness(plan).pass, true);
  plan.incidentResponse.rationale = 'N/A';
  assert.equal(auditInfraReadiness(plan).findings.some((f) => f.id === 'incidentResponse-inapplicability-unjustified'), true);
});

test('CLI exits nonzero for missing effect-policy coverage instead of passing the declaration audit', () => {
  const bad = spawnSync(process.execPath, [cli.pathname, '--input', 'tests/fixtures/invalid-effect-policy.json'], { cwd: bundleDir.pathname, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  const result = JSON.parse(bad.stdout);
  assert.equal(result.pass, false);
  assert.ok(result.findings.some((finding) => finding.id === 'effect-policy-missing'));
});

test('CLI exits zero for a complete plan and nonzero for a missing mandatory gate', () => {
  const good = spawnSync(process.execPath, [cli.pathname, '--input', 'examples/sample-input.json'], { cwd: bundleDir.pathname, encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).pass, true);
  const bad = spawnSync(process.execPath, [cli.pathname, '--input', 'tests/fixtures/invalid-missing-security.json'], { cwd: bundleDir.pathname, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.equal(JSON.parse(bad.stdout).pass, false);
});
