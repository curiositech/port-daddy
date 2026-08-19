/**
 * Every purser test must be routed to a runner, or explicitly quarantined with
 * a reason. Nothing may sit in tests/purser/ doing nothing.
 *
 * This guard exists because that is exactly what happened: 31 files accumulated
 * in tests/purser/ while jest's testMatch covered only tests/unit and
 * tests/integration, so `npx jest` discovered ZERO of them. The adversarial gate
 * the purser is supposed to provide was answering with dead files, and nothing
 * said so — a merged purser branch and an inert one looked identical.
 *
 * The failure was not a single missing glob. The purser had emitted tests for
 * three different runners (node:test, vitest, jest), so per-file routing is the
 * only honest description. ROUTING.json is that description, and these tests
 * make it impossible for it to quietly stop matching reality.
 */
import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const purserDir = join(repoRoot, 'tests', 'purser');
const MANIFEST = 'ROUTING.json';

const routing = JSON.parse(readFileSync(join(purserDir, MANIFEST), 'utf8'));
const onDisk = readdirSync(purserDir).filter((f) => f !== MANIFEST).sort();
const entries = Object.entries(routing.files);
const KNOWN_RUNNERS = new Set(['node-test', 'jest', 'quarantined', 'helper']);

describe('every purser test is routed or explicitly quarantined', () => {
  test('the manifest and the directory describe the same set of files', () => {
    // Both directions matter. A file on disk with no entry is the original bug
    // returning — something present, discovered by nothing, looking like
    // coverage. An entry with no file is a manifest that has rotted into
    // fiction.
    expect(Object.keys(routing.files).sort()).toEqual(onDisk);
  });

  test('every entry names a known runner', () => {
    const unknown = entries
      .filter(([, entry]) => !KNOWN_RUNNERS.has(entry.runner))
      .map(([file, entry]) => `${file} -> ${entry.runner}`);

    expect(unknown).toEqual([]);
  });

  test('nothing is quarantined without a real reason', () => {
    // A bare "quarantined" would recreate the problem with extra steps: still
    // not running, but now with a manifest implying someone decided that.
    const quarantined = entries.filter(([, e]) => e.runner === 'quarantined');
    expect(quarantined.length).toBeGreaterThan(0);

    // Named rather than counted, so a failure says which file went vague.
    const thin = quarantined
      .filter(([, entry]) => (entry.reason ?? '').trim().length < 40)
      .map(([file]) => file);

    expect(thin).toEqual([]);
  });

  test('the node:test set is non-empty and every member is a real file', () => {
    // If this ever empties out, the whitepaper generator contracts have gone
    // dark again and the suite would otherwise pass in silence.
    const nodeTests = entries.filter(([, e]) => e.runner === 'node-test').map(([f]) => f);
    expect(nodeTests.length).toBeGreaterThanOrEqual(10);
    for (const file of nodeTests) expect(onDisk).toContain(file);
  });

  test('the runner scripts derive their file lists from this manifest', () => {
    // Deriving rather than duplicating is what keeps the two in step. If either
    // grows its own hard-coded list, this fails and the drift is visible.
    const runner = readFileSync(join(repoRoot, 'scripts', 'run-purser-tests.mjs'), 'utf8');
    expect(runner).toContain('tests/purser/ROUTING.json');
    expect(runner).toContain("entry.runner === 'node-test'");

    const jestConfig = readFileSync(join(repoRoot, 'jest.config.js'), 'utf8');
    expect(jestConfig).toContain('tests/purser/ROUTING.json');
    expect(jestConfig).toContain("entry.runner === 'jest'");
    expect(jestConfig).toContain('testMatch: purserJestTests');
  });

  test('a helper entry is not a test file in disguise', () => {
    // `helper` is the one runner that legitimately never executes, so it is the
    // one an inert test could hide behind.
    const declaresTests = entries
      .filter(([, entry]) => entry.runner === 'helper')
      .filter(([file]) => /^\s*(describe|test|it)\s*\(/m
        .test(readFileSync(join(purserDir, file), 'utf8')))
      .map(([file]) => file);

    expect(declaresTests).toEqual([]);
  });

  test('CI actually runs both purser runners', () => {
    // The manifest can be perfect and the tests still never execute. jest's
    // --selectProjects is an allowlist, so `purser` has to be named there, and
    // the node:test set needs its own step. Without this, wiring the projects
    // locally would look like a fix while CI stayed exactly as blind as before.
    const ci = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

    expect(ci).toMatch(/--selectProjects[^\n]*\bpurser\b/);
    expect(ci).toContain('npm run test:purser');
  });

  test('the node:test runner refuses an empty routing set instead of passing', () => {
    // Raised by pd-qa: the runner has a guard for "the manifest routes nothing",
    // and an unexercised guard is indistinguishable from a missing one. An empty
    // set must be loud — silently exiting 0 would report success while running no
    // adversarial tests at all, which is the failure this whole PR is about.
    const runner = join(repoRoot, 'scripts', 'run-purser-tests.mjs');
    const emptyManifest = mkdtempSync(join(tmpdir(), 'purser-empty-'));
    try {
      mkdirSync(join(emptyManifest, 'tests', 'purser'), { recursive: true });
      writeFileSync(
        join(emptyManifest, 'tests', 'purser', 'ROUTING.json'),
        JSON.stringify({ files: { 'x.test.js': { runner: 'quarantined', reason: 'none' } } }),
      );
      copyFileSync(runner, join(emptyManifest, 'run-purser-tests.mjs'));
      mkdirSync(join(emptyManifest, 'scripts'), { recursive: true });
      copyFileSync(runner, join(emptyManifest, 'scripts', 'run-purser-tests.mjs'));

      const result = spawnSync(process.execPath, ['scripts/run-purser-tests.mjs'], {
        cwd: emptyManifest, encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stderr}${result.stdout}`).toContain('routes no files to node-test');
    } finally {
      rmSync(emptyManifest, { recursive: true, force: true });
    }
  });
});
