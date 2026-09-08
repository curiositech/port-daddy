import { afterEach, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = fileURLToPath(import.meta.resolve('tsx/cli'));
const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function validate(body, files, options = {}) {
  const scratchRoot = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratchRoot, { recursive: true });
  const directory = mkdtempSync(join(scratchRoot, 'roadmap-offline-test-'));
  directories.push(directory);
  writeFileSync(join(directory, 'body.md'), body);
  writeFileSync(join(directory, 'files.txt'), files);
  mkdirSync(join(directory, 'docs', 'roadmap'), { recursive: true });
  writeFileSync(join(directory, 'docs', 'roadmap', 'roadmap.snapshot.json'), JSON.stringify({
    generatedAt: Date.now(), items: [{ slug: 'fixture-existing-work', status: 'now' }],
  }));
  // Any attempted external command is observable, not just unavailable.
  for (const name of ['gh', 'pd', 'port-daddy']) {
    writeFileSync(join(directory, name), '#!/bin/sh\n/usr/bin/touch "$COMMAND_WITNESS"\nexit 97\n', { mode: 0o755 });
  }
  const args = [cli, join(root, 'scripts/check-roadmap-link.ts'), '--body-file', join(directory, 'body.md')];
  if (!options.omitFiles) args.push('--files-from', join(directory, 'files.txt'));
  const result = spawnSync(process.execPath, args, {
    cwd: directory, encoding: 'utf8', timeout: 15000,
    env: {
      PATH: directory,
      COMMAND_WITNESS: join(directory, 'external-command'),
      GITHUB_STEP_SUMMARY: join(directory, 'summary.md'),
      // A hostile inherited event/PR argument cannot override explicit offline input.
      GITHUB_EVENT_PATH: join(directory, 'does-not-exist.json'),
    },
  });
  expect(result.error).toBeUndefined();
  expect(existsSync(join(directory, 'external-command'))).toBe(false);
  return { ...result, summary: existsSync(join(directory, 'summary.md')) ? readFileSync(join(directory, 'summary.md'), 'utf8') : '' };
}

test('opt-out is validated locally with no GitHub, PD, or credential access', () => {
  const result = validate('Roadmap-Item: none — CI-only maintenance', '.github/workflows/ci.yml\n');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('link=pass(opt-out)');
  expect(result.summary).toContain('Opt-out accepted');
});

test('new work declarations pass locally without creating daemon items', () => {
  const result = validate('Roadmap-Item: local-new-work\nRoadmap-Spawns: local-new-work', 'docs/adr/0130-offline-work.md\n');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('self-spawned');
});

test.each([
  ['missing trailer', 'A description without a work link', 'lib/a.ts\n', 'missing-trailer'],
  ['unknown slug', 'Roadmap-Item: no-such-offline-fixture-item', 'lib/a.ts\n', 'unknown-slug'],
  ['missing planning spawns', 'Roadmap-Item: none — planning update', 'docs/adr/0130-offline-work.md\n', 'missing-spawns'],
])('%s fails without trying to post comments or labels', (_name, body, files, reason) => {
  const result = validate(body, files);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(reason);
});

test('missing changed-file input cannot silently skip planning checks', () => {
  const result = validate('Roadmap-Item: none — CI maintenance', '', { omitFiles: true });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('requires --files-from');
});
