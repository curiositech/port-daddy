import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jest } from '@jest/globals';

const { handleJuryRig } = await import('../../cli/commands/skill-graft.js');

let root;
let logs;
let errors;
let logSpy;
let errorSpy;
let originalExitCode;
let originalGeneratorBackend;

function writeSkill(id, description, extra = '') {
  const dir = join(root, 'skills', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---
name: ${id}
description: "${description}"
metadata:
  category: Testing
  tags: [fleet, tests]
---

# ${id}

${extra || description}
`);
  writeFileSync(join(dir, 'reference.txt'), `${id} reference`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pd-jury-rig-cli-'));
  logs = [];
  errors = [];
  originalExitCode = process.exitCode;
  originalGeneratorBackend = process.env.PD_SKILL_GRAFT_BACKEND;
  delete process.env.PD_SKILL_GRAFT_BACKEND;
  process.exitCode = undefined;
  logSpy = jest.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
  errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
  writeSkill('fleet-test-author', 'Writes focused unit tests for fleet triggers and runners');
  writeSkill('docs-polisher', 'Improves operator documentation and release notes');
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  process.exitCode = originalExitCode;
  if (originalGeneratorBackend === undefined) delete process.env.PD_SKILL_GRAFT_BACKEND;
  else process.env.PD_SKILL_GRAFT_BACKEND = originalGeneratorBackend;
  rmSync(root, { recursive: true, force: true });
});

test('pd jury-rig query emits structured JSON for a local skill catalog', async () => {
  await handleJuryRig(['query', 'write', 'fleet', 'trigger', 'tests'], { root, json: true, 'top-limit': 1 });

  const body = JSON.parse(logs.join('\n'));
  expect(body.scannedCount).toBe(2);
  expect(body.semanticTier).toBe('lexical-only');
  expect(body.shortlist[0].id).toBe('fleet-test-author');
  expect(body.top).toHaveLength(1);
  expect(body.top[0].body).toContain('# fleet-test-author');
});

test('pd jury-rig shorthand query renders guidance and lexical fallback note', async () => {
  await handleJuryRig(['write fleet trigger tests'], { root });

  const output = logs.join('\n');
  expect(output).toContain('Relevant skills');
  expect(output).toContain('fleet-test-author');
  expect(output).toContain('Semantic Tool2Vec tier is cold or unconfigured');
});

test('pd jury-rig warm scans without requiring an LLM backend', async () => {
  await handleJuryRig(['warm'], { root, json: true, 'local-only': true, 'db-dir': root });

  const body = JSON.parse(logs.join('\n'));
  expect(body).toEqual(expect.objectContaining({
    total: 2,
    current: 0,
    configured: false,
    acquired: false,
    embedded: 0,
    reused: 0,
    removed: 0,
  }));
});

test('pd jury-rig reference reads only files contained by the skill directory', async () => {
  await handleJuryRig(['reference', 'fleet-test-author', 'reference.txt'], { root });
  expect(logs.join('\n')).toContain('fleet-test-author reference');

  logs.length = 0;
  await handleJuryRig(['reference', 'fleet-test-author', '../docs-polisher/reference.txt'], { root, json: true });
  const refused = JSON.parse(logs.join('\n'));
  expect(refused.found).toBe(false);
  expect(refused.error).toContain('refused:');
  expect(process.exitCode).toBe(1);
});

test('pd jury-rig bootstrap status is read-only and reports an empty transaction ledger', async () => {
  logs.length = 0;
  await handleJuryRig(['bootstrap', 'status'], {
    home: root,
    'pd-home': join(root, '.port-daddy'),
    json: true,
  });
  const body = JSON.parse(logs.join('\n'));
  expect(body.transactionRoot).toBe(join(root, '.port-daddy', 'jury-rig-cutover', 'transactions'));
  expect(body.transactions).toEqual([]);
});

test('pd jury-rig bootstrap plan emits a redacted zero-write plan and fails closed before native proof', async () => {
  logs.length = 0;
  await handleJuryRig(['bootstrap', 'plan'], {
    home: root,
    'pd-home': join(root, '.port-daddy'),
    'expected-head': 'a'.repeat(40),
    json: true,
  });
  const body = JSON.parse(logs.join('\n'));
  expect(body.actions.every((action) => !Object.hasOwn(action, 'content'))).toBe(true);
  expect(body.verdict).toBe('blocked');
  expect(body.blockers.map((blocker) => blocker.code)).toContain('NATIVE_HOOK_REQUIRED');
  expect(body.blockers.map((blocker) => blocker.code)).not.toContain('EXPECTED_NATIVE_HEAD_REQUIRED');
  expect(process.exitCode).toBe(1);
  expect(existsSync(join(root, '.port-daddy', 'jury-rig-cutover'))).toBe(false);
});

test('pd jury-rig bootstrap rollback requires an exact apply receipt', async () => {
  await expect(handleJuryRig(['bootstrap', 'rollback'], { home: root }))
    .rejects.toThrow('Usage: pd jury-rig bootstrap rollback');
});
