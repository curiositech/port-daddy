// tests/unit/purser/escape-path.test.js
import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const runnerPath = join(repoRoot, 'scripts', 'run-purser-tests.mjs');

describe('node:test runner path enforcement', () => {
  test('rejects a manifest path that escapes tests/purser', () => {
    // Create a temporary repository root
    const scratchRoot = mkdtempSync(
      join(homedir(), 'coding', 'tmp', 'purser-escape-'),
    );

    // Create a fake repository structure with a bad ROUTING.json
    const fakePurserRoot = join(scratchRoot, 'tests', 'purser');
    mkdirSync(fakePurserRoot, { recursive: true });

    // Write a ROUTING.json that points outside the purser directory
    const badRouting = {
      files: {
        '../../outside.test.js': { runner: 'node-test' },
      },
    };
    writeFileSync(
      join(fakePurserRoot, 'ROUTING.json'),
      JSON.stringify(badRouting, null, 2),
    );

    // Create the outside test file at the root of the fake repo
    writeFileSync(
      join(scratchRoot, 'outside.test.js'),
      "const test = require('node:test'); test('outside', () => {});\n",
    );

    // Copy the runner script into the fake repo
    const fakeScriptsDir = join(scratchRoot, 'scripts');
    mkdirSync(fakeScriptsDir, { recursive: true });
    copyFileSync(runnerPath, join(fakeScriptsDir, 'run-purser-tests.mjs'));

    // Run the script and capture its output
    const result = spawnSync(process.execPath, ['scripts/run-purser-tests.mjs'], {
      cwd: scratchRoot,
      encoding: 'utf8',
    });

    // Clean up the temporary repository
    rmSync(scratchRoot, { recursive: true, force: true });

    // The runner should exit with a non-zero status and report the path escape
    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('ROUTING.json path escapes tests/purser');
  });
});
