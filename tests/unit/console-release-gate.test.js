// Producer test for scripts/console-release-gate.mjs — the release.yml gate
// that decides whether a release must rebuild pd-console or may skip the cut.
// Regression guard for the class pd-qa flagged on #9249: the gate's
// `git diff -I'^version = '` mechanic is load-bearing (postversion stamps a
// new version into core/pd-console/Cargo.toml on EVERY release, so a naive
// path diff would rebuild the console every time), and before this test
// nothing proved that a version-only release actually skips, that a real
// change still builds, or that force_console overrides the skip.
import { describe, test, expect, afterAll } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const SCRIPT = resolve('scripts/console-release-gate.mjs');

const cleanups = [];
afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const res = spawnSync(
    'git',
    ['-c', 'user.email=gate@test', '-c', 'user.name=gate-test', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

/**
 * Build a scratch repo shaped like the real one: a pd-console crate whose
 * Cargo.toml version is stamped on every "release", tagged v3.0.0 at the
 * baseline. Callers mutate + tag from there.
 */
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'console-gate-'));
  cleanups.push(dir);
  git(dir, 'init', '-q');
  mkdirSync(join(dir, 'core', 'pd-console', 'src'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'core', 'pd-console', 'Cargo.toml'),
    '[package]\nname = "pd-console"\nversion = "3.0.0"\nedition = "2021"\n',
  );
  writeFileSync(
    join(dir, 'core', 'pd-console', 'Cargo.lock'),
    '[[package]]\nname = "pd-console"\nversion = "3.0.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.100"\nchecksum = "aaaa"\n',
  );
  writeFileSync(join(dir, 'core', 'pd-console', 'src', 'main.rs'), 'fn main() {}\n');
  writeFileSync(join(dir, 'scripts', 'package-pd-console.sh'), '#!/bin/sh\necho package\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'baseline');
  git(dir, 'tag', 'v3.0.0');
  return dir;
}

/** Stamp a new version into Cargo.toml + Cargo.lock the way postversion does. */
function stampVersion(dir, version) {
  const toml = join(dir, 'core', 'pd-console', 'Cargo.toml');
  writeFileSync(toml, readFileSync(toml, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`));
  const lock = join(dir, 'core', 'pd-console', 'Cargo.lock');
  writeFileSync(
    lock,
    readFileSync(lock, 'utf8').replace(
      /name = "pd-console"\nversion = ".*"/,
      `name = "pd-console"\nversion = "${version}"`,
    ),
  );
}

/** Run the gate CLI as release.yml does; return {build, summary, stdout}. */
function runGate(dir, currTag, { force = false } = {}) {
  const outputFile = join(dir, 'gh-output.txt');
  const summaryFile = join(dir, 'gh-summary.md');
  writeFileSync(outputFile, '');
  writeFileSync(summaryFile, '');
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      CURR_TAG: currTag,
      FORCE: force ? 'true' : 'false',
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    },
  });
  expect(res.status).toBe(0);
  const output = readFileSync(outputFile, 'utf8');
  const match = /build=(true|false)/.exec(output);
  expect(match).not.toBeNull();
  return { build: match[1] === 'true', summary: readFileSync(summaryFile, 'utf8'), stdout: res.stdout };
}

describe('console-release-gate', () => {
  test('a version-only release (the postversion stamp) skips the console build', () => {
    const dir = scratchRepo();
    stampVersion(dir, '3.0.1');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'chore(release): bump to 3.0.1');
    git(dir, 'tag', 'v3.0.1');

    const { build, summary } = runGate(dir, 'v3.0.1');
    expect(build).toBe(false);
    expect(summary).toContain('pd-console NOT re-cut');
    expect(summary).toContain('v3.0.0');
    expect(summary).toContain('force_console: true');
  });

  test('a real source change builds, even alongside the version stamp', () => {
    const dir = scratchRepo();
    stampVersion(dir, '3.0.1');
    writeFileSync(join(dir, 'core', 'pd-console', 'src', 'main.rs'), 'fn main() { println!("x"); }\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'feat + bump');
    git(dir, 'tag', 'v3.0.1');

    expect(runGate(dir, 'v3.0.1').build).toBe(true);
  });

  test('a packaging-script change builds — the .app shape is watched too', () => {
    const dir = scratchRepo();
    stampVersion(dir, '3.0.1');
    writeFileSync(join(dir, 'scripts', 'package-pd-console.sh'), '#!/bin/sh\necho packaged differently\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'packaging + bump');
    git(dir, 'tag', 'v3.0.1');

    expect(runGate(dir, 'v3.0.1').build).toBe(true);
  });

  test('a Cargo.lock dependency change builds — -I cannot be masked, the checksum line still shows', () => {
    const dir = scratchRepo();
    stampVersion(dir, '3.0.1');
    const lock = join(dir, 'core', 'pd-console', 'Cargo.lock');
    writeFileSync(
      lock,
      readFileSync(lock, 'utf8')
        .replace('version = "1.0.100"', 'version = "1.0.200"')
        .replace('checksum = "aaaa"', 'checksum = "bbbb"'),
    );
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'dep bump + version bump');
    git(dir, 'tag', 'v3.0.1');

    expect(runGate(dir, 'v3.0.1').build).toBe(true);
  });

  test('force_console overrides an otherwise-skippable release', () => {
    const dir = scratchRepo();
    stampVersion(dir, '3.0.1');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'chore(release): bump to 3.0.1');
    git(dir, 'tag', 'v3.0.1');

    const { build, summary } = runGate(dir, 'v3.0.1', { force: true });
    expect(build).toBe(true);
    expect(summary).toContain('force_console=true');
  });

  test('the first release (no previous tag) always builds', () => {
    const dir = scratchRepo();
    expect(runGate(dir, 'v3.0.0').build).toBe(true);
  });

  test('several consecutive skips stay correct — each interval is judged on its own', () => {
    const dir = scratchRepo();
    stampVersion(dir, '3.0.1');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'bump 3.0.1');
    git(dir, 'tag', 'v3.0.1');
    stampVersion(dir, '3.0.2');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'bump 3.0.2');
    git(dir, 'tag', 'v3.0.2');

    expect(runGate(dir, 'v3.0.2').build).toBe(false);

    // Now a real change lands for the next release: the streak must end.
    stampVersion(dir, '3.0.3');
    writeFileSync(join(dir, 'core', 'pd-console', 'src', 'main.rs'), 'fn main() { /* new */ }\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'feat + bump 3.0.3');
    git(dir, 'tag', 'v3.0.3');
    expect(runGate(dir, 'v3.0.3').build).toBe(true);
  });
});
