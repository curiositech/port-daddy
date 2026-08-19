#!/usr/bin/env node
// run-purser-tests.mjs -- execute the purser tests that target node:test.
//
// tests/purser/ is routed per-file by tests/purser/ROUTING.json, because the
// purser has authored tests for three different runners (node:test, vitest,
// jest) and no single glob can run them. This script owns the node:test set;
// the jest `purser` project owns the jest set; everything else is quarantined
// in the manifest with a stated reason.
//
// Exits non-zero if any test fails, so CI can gate on it.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routing = JSON.parse(
  readFileSync(resolve(repoRoot, 'tests/purser/ROUTING.json'), 'utf8'),
);

const files = Object.entries(routing.files)
  .filter(([, entry]) => entry.runner === 'node-test')
  .map(([file]) => `tests/purser/${file}`)
  .sort();

if (files.length === 0) {
  console.error('run-purser-tests: ROUTING.json routes no files to node-test.');
  console.error('That is almost certainly a mistake — the manifest should not be empty.');
  process.exit(1);
}

console.log(`run-purser-tests: ${files.length} file(s) routed to node:test`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: repoRoot,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
