import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { jest } from '@jest/globals';

const { handleSkillGraft } = await import('../../cli/commands/skill-graft.js');

let root;
let logs;
let errors;
let logSpy;
let errorSpy;
let originalExitCode;

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
  root = mkdtempSync(join(tmpdir(), 'pd-skill-graft-cli-'));
  logs = [];
  errors = [];
  originalExitCode = process.exitCode;
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
  rmSync(root, { recursive: true, force: true });
});

test('pd skill-graft query emits structured JSON for a local skill catalog', async () => {
  await handleSkillGraft(['query', 'write', 'fleet', 'trigger', 'tests'], { root, json: true, 'top-limit': 1 });

  const body = JSON.parse(logs.join('\n'));
  expect(body.scannedCount).toBe(2);
  expect(body.semanticTier).toBe('lexical-only');
  expect(body.shortlist[0].id).toBe('fleet-test-author');
  expect(body.top).toHaveLength(1);
  expect(body.top[0].body).toContain('# fleet-test-author');
});

test('pd skill-graft shorthand query renders guidance and lexical fallback note', async () => {
  await handleSkillGraft(['write fleet trigger tests'], { root });

  const output = logs.join('\n');
  expect(output).toContain('Relevant skills');
  expect(output).toContain('fleet-test-author');
  expect(output).toContain('Semantic Tool2Vec tier is cold or unconfigured');
});

test('pd skill-graft warm scans without requiring an LLM backend', async () => {
  await handleSkillGraft(['warm'], { root, json: true, 'local-only': true, 'db-dir': root });

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

test('pd skill-graft reference reads only files contained by the skill directory', async () => {
  await handleSkillGraft(['reference', 'fleet-test-author', 'reference.txt'], { root });
  expect(logs.join('\n')).toContain('fleet-test-author reference');

  logs.length = 0;
  await handleSkillGraft(['reference', 'fleet-test-author', '../docs-polisher/reference.txt'], { root, json: true });
  const refused = JSON.parse(logs.join('\n'));
  expect(refused.found).toBe(false);
  expect(refused.error).toContain('refused:');
  expect(process.exitCode).toBe(1);
});
