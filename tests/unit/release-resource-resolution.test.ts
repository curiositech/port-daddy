import { afterAll, beforeEach, expect, test } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveSkillSource } from '../../cli/commands/setup.js';
import { resolvePilotSourceDir } from '../../lib/pilot-agent-render.js';

const ROOT = join(homedir(), 'coding', 'tmp', `release-resource-resolution-${process.pid}`);

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

test('setup resolves the public skill from an explicit packaged resource root', () => {
  const resourceDir = join(ROOT, 'share', 'port-daddy');
  const sourceDir = join(resourceDir, 'skills', 'port-daddy-agent-skill');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'SKILL.md'), 'name: port-daddy-agent-skill\n');

  expect(resolveSkillSource({
    resourceDir,
    execDir: join(ROOT, 'missing-bin'),
    moduleDir: join(ROOT, 'missing-module'),
  })).toBe(sourceDir);
});

test('Pilot rendering resolves its canonical source from the same packaged resource root', () => {
  const resourceDir = join(ROOT, 'share', 'port-daddy');
  const sourceDir = join(resourceDir, 'agents', 'port-daddy-pilot');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'AGENT.md'), '# Port Daddy Pilot\n');

  expect(resolvePilotSourceDir(join(ROOT, 'missing-project'), {
    resourceDir,
    execDir: join(ROOT, 'missing-bin'),
    moduleDir: join(ROOT, 'missing-module'),
  })).toBe(sourceDir);
});
