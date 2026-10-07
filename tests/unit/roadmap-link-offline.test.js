import { afterEach, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(import.meta.resolve('tsx/cli'));
const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function validate(body, options = {}) {
  const scratchRoot = join(root, '.scratch');
  mkdirSync(scratchRoot, { recursive: true });
  const directory = mkdtempSync(join(scratchRoot, 'roadmap-offline-test-'));
  directories.push(directory);
  writeFileSync(join(directory, 'body.md'), body);
  // No roadmap snapshot is present: current admission validates declarations only.
  // Any attempted external command is observable, not just unavailable.
  for (const name of ['gh', 'pd', 'port-daddy', 'bash']) {
    writeFileSync(join(directory, name), '#!/bin/sh\n/usr/bin/touch "$COMMAND_WITNESS"\nexit 97\n', { mode: 0o755 });
  }
  const args = [cli, join(root, 'scripts/check-roadmap-link.ts'), '--body-file', join(directory, 'body.md')];
  if (options.extraArgs) args.push(...options.extraArgs);
  if (options.omitBodyPath) args.pop();
  const summaryName = options.summaryName ?? 'summary.md';
  const result = spawnSync(process.execPath, args, {
    cwd: directory, encoding: 'utf8', timeout: 15000,
    env: {
      PATH: directory,
      COMMAND_WITNESS: join(directory, 'external-command'),
      GITHUB_STEP_SUMMARY: join(directory, summaryName),
      // A hostile inherited event/PR argument cannot override explicit offline input.
      GITHUB_EVENT_PATH: join(directory, 'does-not-exist.json'),
    },
  });
  expect(result.error).toBeUndefined();
  expect(existsSync(join(directory, 'external-command'))).toBe(false);
  return { ...result, summary: existsSync(join(directory, summaryName)) ? readFileSync(join(directory, summaryName), 'utf8') : '' };
}

test('opt-out is validated locally with no GitHub or daemon commands', () => {
  const result = validate('Roadmap-Item: none — CI-only maintenance');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('declaration=pass(opt-out)');
  expect(result.summary).toContain('Opt-out accepted');
});

test('a declared slug passes without a snapshot or planning-file authority', () => {
  const result = validate('Roadmap-Item: local-new-work');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('declaration=pass(linked)');
});

test.each([
  ['missing trailer', 'A description without a work link'],
  ['unreasoned opt-out', 'Roadmap-Item: none'],
])('%s fails locally without posting comments or labels', (_name, body) => {
  const result = validate(body);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('missing-trailer');
  expect(result.stdout).toContain('Keep an operator-halted daemon stopped');
  expect(result.stdout).not.toContain('daemon required');
});

test('explicit body-file takes precedence over numeric PR arguments and an invalid inherited event', () => {
  const result = validate('Roadmap-Item: existing-work', { extraArgs: ['123'] });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('PR #0');
});

test('a missing body-file path fails closed', () => {
  const result = validate('Roadmap-Item: existing-work', { omitBodyPath: true });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('--body-file requires a file path');
});

test('summary paths containing shell metacharacters remain literal filenames', () => {
  const result = validate('Roadmap-Item: existing-work', { summaryName: 'summary "$(gh)".md' });
  expect(result.status).toBe(0);
  expect(result.summary).toContain('existing-work');
});
