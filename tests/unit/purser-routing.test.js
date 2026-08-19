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
// Derived from the manifest, NOT hardcoded. Raised by pd-qa on 2026-08-19: the
// manifest documents its own vocabulary in `runners`, and `helper` had drifted
// out of it — the test knew the disposition, the manifest's documentation did
// not. Two sources of truth for the same vocabulary, already disagreeing, in
// the one file whose whole purpose is preventing exactly that.
const KNOWN_RUNNERS = new Set(Object.keys(routing.runners ?? {}));

describe('every purser test is routed or explicitly quarantined', () => {
  test('the manifest and the directory describe the same set of files', () => {
    // Both directions matter. A file on disk with no entry is the original bug
    // returning — something present, discovered by nothing, looking like
    // coverage. An entry with no file is a manifest that has rotted into
    // fiction.
    expect(Object.keys(routing.files).sort()).toEqual(onDisk);
  });

  test('the manifest documents every runner it uses', () => {
    // Crosses from `files` to `runners` — two different parts of the manifest,
    // so this is not the vocabulary agreeing with itself. A disposition that
    // exists in the data but not in the documentation is how `helper` went
    // undocumented while the test silently knew about it.
    expect(KNOWN_RUNNERS.size).toBeGreaterThan(0);
    const used = new Set(entries.map(([, entry]) => entry.runner));
    const undocumented = [...used].filter((r) => !KNOWN_RUNNERS.has(r));
    expect(undocumented).toEqual([]);
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

  test('the jest set is non-empty and every member is a real file', () => {
    // The node:test set above has a floor and a real-file check; this one had
    // neither, which pd-qa caught on 2026-08-19. The asymmetry mattered: if the
    // jest-routed set ever empties, jest's purser project matches nothing and
    // the suite passes in silence — the same "present, discovered by nothing,
    // looking like coverage" failure this manifest exists to eliminate,
    // surviving on whichever runner nobody guarded.
    const jestTests = entries.filter(([, e]) => e.runner === 'jest').map(([f]) => f);
    expect(jestTests.length).toBeGreaterThan(0);
    for (const file of jestTests) expect(onDisk).toContain(file);
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

  test('a file routed to a runner actually declares tests', () => {
    // Raised by pd-qa, then rewritten after mutation testing showed the obvious
    // version was worthless: comparing the routed set against the quarantined
    // set derives BOTH from the manifest, so mislabelling the helper as
    // `node-test` merely moved it between two lists and the assertion still
    // passed. That is the manifest agreeing with itself.
    //
    // The real invariant crosses from the manifest to the files: anything routed
    // to a runner must actually contain tests. Relabel the shared helper as
    // `node-test` and this fails, because the helper declares none — which is
    // exactly the mistake worth catching, since the runner would then execute a
    // file that asserts nothing and report it as passing coverage.
    const routed = entries
      .filter(([, entry]) => entry.runner === 'jest' || entry.runner === 'node-test')
      .map(([file]) => file);

    const silent = routed.filter((file) => !/^\s*(describe|test|it)\s*\(/m
      .test(readFileSync(join(purserDir, file), 'utf8')));

    expect(silent).toEqual([]);

    // …and DECLARING is not ASSERTING. Raised by pd-qa on 2026-08-19, and it is
    // right: the check above is satisfied by `test('x', () => {})`, which runs,
    // reports green, and proves nothing. That is the same "looks like coverage,
    // isn't" shape this whole manifest exists to eliminate — a routed file that
    // asserts nothing is worse than a quarantined one, because it is counted.
    //
    // Both dialects in this directory count. The jest-style files use `expect(`
    // and the node:test files use `assert.` / `assert(`; a floor of one either
    // way is all this can honestly claim, since no regex can tell a real
    // assertion from a vacuous one (`expect(true).toBe(true)` passes this, and
    // catching THAT is the tautology-sniffer's job, not the manifest's).
    const ASSERTS = /\b(expect|assert)\s*[.(]/;
    const hollow = routed.filter((file) =>
      !ASSERTS.test(readFileSync(join(purserDir, file), 'utf8')));

    expect(hollow).toEqual([]);

    // The three dispositions must also exactly partition the directory: no file
    // counted twice, none unaccounted for.
    const excluded = entries
      .filter(([, e]) => e.runner === 'quarantined' || e.runner === 'helper')
      .map(([file]) => file);
    expect([...routed, ...excluded].sort()).toEqual(onDisk);
  });
});
