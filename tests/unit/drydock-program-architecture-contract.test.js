import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';

const repo = process.cwd();
const skill = join(repo, 'skills/drydock-program-architecture');
const treePath = join(skill, 'examples/drydock-resurrection-hypertree.json');
const schemaPath = join(skill, 'schemas/drydock-resurrection-hypertree.schema.json');
const semanticValidator = join(skill, 'scripts/validate-drydock-resurrection-hypertree.mjs');
const executionPath = join(skill, 'examples/hypertree-execution.review-loop.json');
const executionSchemaPath = join(skill, 'schemas/hypertree-execution.schema.json');
const executionValidator = join(skill, 'scripts/validate-hypertree-execution.mjs');

function text(path) {
  return readFileSync(path, 'utf8');
}

function validateSemantic(value) {
  return spawnSync(process.execPath, [semanticValidator, '-'], {
    cwd: repo,
    input: JSON.stringify(value),
    encoding: 'utf8',
  });
}

function validateExecution(value) {
  return spawnSync(process.execPath, [executionValidator, '-'], {
    cwd: repo,
    input: JSON.stringify(value),
    encoding: 'utf8',
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function resealExecution(value) {
  const sealed = structuredClone(value);
  delete sealed.executionDigest;
  value.executionDigest = `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(sealed))).digest('hex')}`;
  return value;
}

describe('Drydock program architecture skill', () => {
  test('the integrated bundle audit resolves its corpus, links, routing, and 17 proof views', () => {
    const audit = spawnSync(process.execPath, [
      join(skill, 'scripts/audit-drydock-program-skill.mjs'),
    ], { cwd: repo, encoding: 'utf8' });

    expect(audit.status).toBe(0);
    expect(JSON.parse(audit.stdout)).toMatchObject({
      valid: true,
      errors: [],
      counts: { requiredFiles: 24, diagrams: 17 },
    });
  });

  test('the machine hypertree satisfies its closed structural contract', async () => {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const schema = JSON.parse(text(schemaPath));
    const tree = JSON.parse(text(treePath));
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      formats: { 'date-time': true },
    });
    const validate = ajv.compile(schema);

    expect(validate(tree)).toBe(true);
    const widened = structuredClone(tree);
    widened.guestMayUseCanonicalCheckout = true;
    expect(validate(widened)).toBe(false);
    expect(validate.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'additionalProperties' }),
    ]));
  });

  test('the semantic validator rejects launchers that bypass persistent spawn gates', () => {
    const tree = JSON.parse(text(treePath));
    tree.launcherNodes = ['DD-000'];
    const result = validateSemantic(tree);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors).toContain(
      'launcher DD-000 is not gated by DD-052 spawn breakers',
    );
  });

  test('the semantic validator rejects stale self-reported plan digests', () => {
    const tree = JSON.parse(text(treePath));
    tree.root.intent = `${tree.root.intent} Changed without resealing.`;
    const result = validateSemantic(tree);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/^planDigest mismatch; expected sha256:/),
    ]));
  });

  test('the sealed plan digest changes when launcher membership changes', () => {
    const tree = JSON.parse(text(treePath));
    tree.launcherNodes[0] = 'DD-060';
    const result = validateSemantic(tree);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors).toEqual([
      expect.stringMatching(/^planDigest mismatch; expected sha256:/),
    ]);
  });

  test('the review-loop fixture satisfies its closed execution contract', async () => {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const schema = JSON.parse(text(executionSchemaPath));
    const execution = JSON.parse(text(executionPath));
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      formats: { 'date-time': true },
    });
    const validate = ajv.compile(schema);

    expect(validate(execution)).toBe(true);
    const authorityWidening = structuredClone(execution);
    authorityWidening.clientBindings[0].authority = 'control-and-projection';
    expect(validate(authorityWidening)).toBe(false);
    expect(validate.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'const' }),
    ]));
  });

  test('the execution reducer proves the complete bad-to-good review cycle', () => {
    const execution = JSON.parse(text(executionPath));
    const result = validateExecution(execution);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: true,
      errors: [],
      counts: { scopedNodes: 1, clients: 3, events: 14, reworkRounds: 1 },
      projection: {
        runState: 'COMPLETED',
        truthState: 'FIXTURE',
        nodes: [{
          nodeId: 'DD-070',
          state: 'APPROVED',
          attempt: 2,
          reworkRounds: 1,
          checkStatus: 'PASS',
          reviewVerdict: 'APPROVE',
          managerDecision: 'APPROVE_NODE',
        }],
      },
    });
  });

  test('an author cannot approve their own hypertree output', () => {
    const execution = JSON.parse(text(executionPath));
    execution.events[9].payload.reviewerIdentity = 'agent/ux-worker-1';
    resealExecution(execution);
    const result = validateExecution(execution);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors).toContain(
      'DD-070 producer may not review its own output',
    );
  });

  test('green checks cannot approve an output that omits a required artifact', () => {
    const execution = JSON.parse(text(executionPath));
    execution.events[7].payload.artifacts = execution.events[7].payload.artifacts.filter(
      (artifact) => artifact.kind !== 'responsive rules',
    );
    resealExecution(execution);
    const result = validateExecution(execution);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors).toContain(
      'DD-070 approval requires exactly the declared output artifact kinds',
    );
  });

  test('a node attempt cannot substitute an undeclared input kind', () => {
    const execution = JSON.parse(text(executionPath));
    execution.events[1].payload.input.artifacts[0].kind = 'ambient transcript';
    resealExecution(execution);
    const result = validateExecution(execution);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors).toContain(
      'DD-070 input artifacts do not exactly satisfy its contract',
    );
  });

  test('rework must bind every artifact from the rejected prior attempt', () => {
    const execution = JSON.parse(text(executionPath));
    execution.events[6].payload.input.priorAttemptArtifactIds.pop();
    resealExecution(execution);
    const result = validateExecution(execution);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors).toContain(
      'DD-070 rework input must bind the exact prior-attempt artifacts',
    );
  });

  test('a low-cost reviewer cannot exceed its reserved or policy-capped native units', () => {
    const execution = JSON.parse(text(executionPath));
    execution.events[9].payload.reservedUnits = 21;
    execution.events[9].payload.usedUnits = 22;
    resealExecution(execution);
    const result = validateExecution(execution);
    const errors = JSON.parse(result.stdout).errors;

    expect(result.status).toBe(1);
    expect(errors).toEqual(expect.arrayContaining([
      'DD-070 review exceeds its reserved native units',
      'DD-070 review reservation exceeds low-cost-independent policy',
    ]));
  });

  test('authority-risk work cannot reach the manager without specialist approval', () => {
    const execution = JSON.parse(text(executionPath));
    execution.events[10].payload.reviewerClass = 'low-cost-independent';
    resealExecution(execution);
    const result = validateExecution(execution);
    const errors = JSON.parse(result.stdout).errors;

    expect(result.status).toBe(1);
    expect(errors).toEqual(expect.arrayContaining([
      'DD-070 manager decision requires AWAITING_MANAGER state',
      'DD-070 manager approval requires every declared reviewer class',
    ]));
  });

  test('a manager cannot merge roles or waive a failed gate', () => {
    const execution = JSON.parse(text(executionPath));
    execution.events[11].payload.managerIdentity = 'agent/low-cost-reviewer-2';
    execution.events[11].payload.bypassedGateIds = ['responsive-rules'];
    resealExecution(execution);
    const result = validateExecution(execution);
    const errors = JSON.parse(result.stdout).errors;

    expect(result.status).toBe(1);
    expect(errors).toEqual(expect.arrayContaining([
      'DD-070 manager may not be a reviewer',
      'DD-070 manager may not bypass gates',
    ]));
  });

  test('the event chain rejects duplicate identifiers, backward time, and work after completion', () => {
    const execution = JSON.parse(text(executionPath));
    execution.events[11].eventId = execution.events[10].eventId;
    execution.events[11].occurredAt = '2026-09-11T21:00:00Z';
    execution.events.push({
      ...structuredClone(execution.events[11]),
      sequence: 15,
      eventId: 'evt-015',
      previousEventId: 'evt-014',
    });
    resealExecution(execution);
    const result = validateExecution(execution);
    const errors = JSON.parse(result.stdout).errors;

    expect(result.status).toBe(1);
    expect(errors).toEqual(expect.arrayContaining([
      'duplicate event id evt-011',
      'event evt-011 occurredAt moves backward',
      'event evt-015 occurs after RUN_COMPLETED',
      'RUN_COMPLETED must be the final event',
    ]));
  });

  test('a projection with a stale claimed state is rejected even when the trace is unchanged', () => {
    const execution = JSON.parse(text(executionPath));
    execution.expectedProjection.nodes[0].state = 'RUNNING';
    resealExecution(execution);
    const result = validateExecution(execution);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).errors).toContain(
      'expectedProjection does not match deterministic event reduction',
    );
  });

  test('the public proposal now points into one skill instead of six loose artifacts', () => {
    const landing = text(join(repo, 'docs/proposals/drydock-program-architecture.md'));
    const prose = landing.replace(/\s+/g, ' ');
    expect(landing).toContain('skills/drydock-program-architecture/SKILL.md');
    expect(prose).toContain('machine-readable 30-node implementation hypertree');
    expect(prose).toContain('shared HTML/Swift/Rust operator projections');
    expect(prose).toContain('does not authorize starting Port Daddy');

    for (const oldPath of [
      'docs/proposals/drydock-agent-lifecycle-and-operator-control.md',
      'docs/proposals/drydock-controlled-agent-simulation.md',
      'docs/proposals/drydock-resurrection-capacity-and-context-control.md',
      'docs/proposals/drydock-resurrection-hypertree.json',
      'docs/proposals/drydock-resurrection-hypertree.schema.json',
      'docs/proposals/validate-drydock-resurrection-hypertree.mjs',
    ]) {
      expect(() => readFileSync(join(repo, oldPath))).toThrow();
    }
  });
});
