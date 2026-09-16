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
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const purserRoot = resolve(repoRoot, 'tests/purser');
const realPurserRoot = realpathSync(purserRoot);
const routing = JSON.parse(
  readFileSync(resolve(purserRoot, 'ROUTING.json'), 'utf8'),
);

const files = Object.entries(routing.files)
  .filter(([, entry]) => entry.runner === 'node-test')
  .map(([file]) => {
    if (isAbsolute(file)) {
      throw new Error(`ROUTING.json path escapes tests/purser: ${file}`);
    }
    const candidate = resolve(purserRoot, file);
    const withinPurser = relative(purserRoot, candidate);
    // path.relative() can itself be absolute on Windows when the two paths are
    // on different drives. Treat that as outside too, not as an ordinary child.
    if (
      !withinPurser ||
      isAbsolute(withinPurser) ||
      withinPurser === '..' ||
      withinPurser.startsWith(`..${sep}`)
    ) {
      throw new Error(`ROUTING.json path escapes tests/purser: ${file}`);
    }
    // Lexical confinement is not enough: Git can carry a symlink whose path is
    // inside tests/purser while its target is outside. Resolve the actual file
    // before execution and apply the same boundary to the target.
    const realCandidate = realpathSync(candidate);
    const realWithinPurser = relative(realPurserRoot, realCandidate);
    if (
      !realWithinPurser ||
      isAbsolute(realWithinPurser) ||
      realWithinPurser === '..' ||
      realWithinPurser.startsWith(`..${sep}`)
    ) {
      throw new Error(`ROUTING.json path escapes tests/purser via symlink: ${file}`);
    }
    return relative(repoRoot, candidate);
  })
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
