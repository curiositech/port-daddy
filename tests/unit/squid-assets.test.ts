import { afterAll, beforeEach, expect, test } from '@jest/globals';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveSquidAsset, squidAssetCandidates } from '../../lib/squid/assets.js';
import { stagePilotSessionStartHook } from '../../lib/pilot-sessionstart-hook.js';

const ROOT = join(homedir(), 'coding', 'tmp', `squid-assets-${process.pid}`);

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

test('prefers the canonical directory-preserving release layout', () => {
  const execDir = join(ROOT, 'release');
  mkdirSync(join(execDir, 'hooks'), { recursive: true });
  writeFileSync(join(execDir, 'hooks', 'sessionstart-pilot.mjs'), 'export {};\n');
  expect(resolveSquidAsset('hooks/sessionstart-pilot.mjs', { execDir, moduleDir: join(ROOT, 'none') }))
    .toBe(join(execDir, 'hooks', 'sessionstart-pilot.mjs'));
});

test('does not accept the retired flat release layout', () => {
  const execDir = join(ROOT, 'legacy');
  mkdirSync(execDir, { recursive: true });
  writeFileSync(join(execDir, 'pd-hook-prompt'), '#!/bin/sh\n');
  expect(resolveSquidAsset('bin/pd-hook-prompt', { execDir, moduleDir: join(ROOT, 'none') }))
    .toBeNull();
});

test('resolves package-share assets declared by the canonical resource root', () => {
  const resourceDir = join(ROOT, 'share', 'port-daddy');
  mkdirSync(join(resourceDir, 'hooks'), { recursive: true });
  writeFileSync(join(resourceDir, 'hooks', 'sessionstart-pilot.mjs'), 'export {};\n');
  expect(resolveSquidAsset('hooks/sessionstart-pilot.mjs', {
    execDir: join(ROOT, 'bin'),
    moduleDir: join(ROOT, 'none'),
    resourceDir,
  })).toBe(join(resourceDir, 'hooks', 'sessionstart-pilot.mjs'));
});

test('explicit source directories keep hermetic installer tests possible', () => {
  const sourceDir = join(ROOT, 'fixture-source');
  mkdirSync(join(sourceDir, 'bin'), { recursive: true });
  writeFileSync(join(sourceDir, 'bin', 'pd-statusline'), '#!/bin/sh\n');
  expect(resolveSquidAsset('bin/pd-statusline', { sourceDir, execDir: join(ROOT, 'none') }))
    .toBe(join(sourceDir, 'bin', 'pd-statusline'));
});

test('missing asset diagnostics enumerate only directory-preserving locations', () => {
  const candidates = squidAssetCandidates('hooks/sessionstart-pilot.mjs', {
    execDir: join(ROOT, 'release'),
    moduleDir: join(ROOT, 'module'),
  });
  expect(candidates[0]).toBe(join(ROOT, 'release', 'hooks', 'sessionstart-pilot.mjs'));
  expect(candidates).not.toContain(join(ROOT, 'release', 'sessionstart-pilot.mjs'));
});

test('stages Pilot steering into a durable PD_HOME-relative location', () => {
  const destination = join(ROOT, 'pd-home', 'hooks', 'sessionstart-pilot.mjs');
  expect(stagePilotSessionStartHook(destination)).toBe(destination);
  expect(resolveSquidAsset(destination)).toBe(destination);
});
