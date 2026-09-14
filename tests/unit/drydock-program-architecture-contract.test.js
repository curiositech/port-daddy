import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';

const repo = process.cwd();
const skill = join(repo, 'skills/drydock-program-architecture');
const treePath = join(skill, 'examples/drydock-resurrection-hypertree.json');
const schemaPath = join(skill, 'schemas/drydock-resurrection-hypertree.schema.json');
const semanticValidator = join(skill, 'scripts/validate-drydock-resurrection-hypertree.mjs');

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

describe('Drydock program architecture skill', () => {
  test('the integrated bundle audit resolves its corpus, links, routing, and 17 proof views', () => {
    const audit = spawnSync(process.execPath, [
      join(skill, 'scripts/audit-drydock-program-skill.mjs'),
    ], { cwd: repo, encoding: 'utf8' });

    expect(audit.status).toBe(0);
    expect(JSON.parse(audit.stdout)).toMatchObject({
      valid: true,
      errors: [],
      counts: { requiredFiles: 20, diagrams: 17 },
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

  test('the public proposal now points into one skill instead of six loose artifacts', () => {
    const landing = text(join(repo, 'docs/proposals/drydock-program-architecture.md'));
    const prose = landing.replace(/\s+/g, ' ');
    expect(landing).toContain('skills/drydock-program-architecture/SKILL.md');
    expect(prose).toContain('machine-readable 30-node implementation hypertree');
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
