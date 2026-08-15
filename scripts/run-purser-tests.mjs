#!/usr/bin/env node

/**
 * Run the purser's node:test adversarial suite (tests/purser/test-*.js).
 *
 * Why this exists rather than a bare `node --test tests/purser/`:
 *
 *   1. tests/purser holds TWO frameworks. `test-*.js` are node:test; `*.test.js`
 *      are vitest and are collected by apps/relay's config instead (vitest is a
 *      dependency of apps/relay, not of the root package). node:test's default
 *      discovery would sweep up both and crash on the vitest imports, so this
 *      runner selects the node:test half explicitly.
 *
 *   2. Some authored tests are not executable at all — missing fixtures, or
 *      outright unsafe (one appends to tracked files in the checkout; one runs
 *      `git commit --amend`). Those are listed in tests/purser/quarantine.json
 *      and skipped here, but PRINTED on every run so a quarantined test can
 *      never be quietly mistaken for a passing one.
 *
 * A quarantined entry is a debt to pay down, not a verdict. A test that runs and
 * fails must stay in the suite and fail the build — that is the gate doing its
 * job, and the reason the gate was wired up in the first place.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const purserDir = resolve(repoRoot, 'tests/purser');

const manifest = JSON.parse(readFileSync(resolve(purserDir, 'quarantine.json'), 'utf8'));
const quarantined = new Map(manifest.quarantined.map((e) => [e.file, e]));

const all = readdirSync(purserDir)
  .filter((name) => name.startsWith('test-') && name.endsWith('.js'))
  .sort();

const runnable = all.filter((name) => !quarantined.has(name));
const held = all.filter((name) => quarantined.has(name));

// Print the quarantine FIRST and unconditionally. If this list is only visible
// when something fails, it stops being a debt anyone remembers to pay.
if (held.length > 0) {
  console.log(`\n=== QUARANTINED — ${held.length} purser test file(s) NOT run ===`);
  for (const name of held) {
    console.log(`\n  ${name}\n    ${quarantined.get(name).reason}`);
  }
  console.log('\n  These are NOT passing. See tests/purser/quarantine.json.\n');
}

// A manifest naming a file that no longer exists is itself a bug: the entry
// would silently protect nothing, and the next person would read the list and
// believe a test is held when it is simply gone.
const stale = [...quarantined.keys()].filter((name) => !all.includes(name));
if (stale.length > 0) {
  console.error(`quarantine.json lists file(s) that do not exist: ${stale.join(', ')}`);
  process.exit(1);
}

if (runnable.length === 0) {
  console.error('no runnable purser tests — refusing to report success on an empty suite');
  process.exit(1);
}

console.log(`=== Running ${runnable.length} purser test file(s) ===\n`);
const result = spawnSync(
  process.execPath,
  ['--test', ...runnable.map((name) => `tests/purser/${name}`)],
  { cwd: repoRoot, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
