import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const fixtures = join(root, '.cache', 'tex-convergence-tests');
mkdirSync(fixtures, { recursive: true });
const originalPdf = 'previous publication\n';
const candidatePdf = 'new candidate\n';

// Both fake drivers produce actual fixture files. build_one must refuse to
// replace the existing destination unless its final gate and copy succeed.
const fakeDriver = `#!/bin/sh
n=0
[ ! -f "$FIXTURE/count" ] || n=$(cat "$FIXTURE/count")
n=$((n+1))
echo "$n" > "$FIXTURE/count"
printf 'new candidate\\n' > "$FIXTURE_OUTPUT/book.pdf"
case "$MODE" in
  engine-error) exit 17;;
  late-error) [ "$n" -lt 3 ] || exit 17;;
  missing-log) rm -f "$FIXTURE_OUTPUT/book.log"; exit 0;;
  missing-pdf) rm -f "$FIXTURE_OUTPUT/book.pdf";;
esac
case "$MODE" in
  margin|late-error)
    if [ "$n" -lt "$READY" ]; then echo 'PD-MARGIN-CONVERGENCE: pending';
    else echo 'PD-MARGIN-CONVERGENCE: complete'; fi;;
  labels)
    if [ "$n" -lt "$READY" ]; then echo 'LaTeX Warning: Label(s) may have changed.';
    else echo 'stable'; fi;;
  outlines)
    if [ "$n" -lt "$READY" ]; then
      echo 'Package rerunfilecheck Warning: File book.out has changed.'
      echo '(rerunfilecheck) Rerun to get outlines right'
    else echo 'stable'; fi;;
  undefined) echo 'LaTeX Warning: There were undefined references.';;
  *) echo 'stable';;
esac > "$FIXTURE_OUTPUT/book.log"
`;

function withFixture(mode, ready, callback) {
  const dir = mkdtempSync(join(fixtures, 'case-'));
  const bin = join(dir, 'bin');
  const output = join(dir, 'build', 'book');
  mkdirSync(bin);
  mkdirSync(output, { recursive: true });
  mkdirSync(join(dir, 'source'));
  writeFileSync(join(dir, 'source', 'book.tex'), 'fixture source\n');
  writeFileSync(join(dir, 'published.pdf'), originalPdf);
  // An isolated PATH makes the manual-path test independent of installed TeX.
  for (const name of ['dirname', 'mkdir', 'grep', 'cat', 'rm', 'cp', 'wc', 'tail']) {
    const found = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
    assert.equal(found.status, 0, `${name} fixture prerequisite`);
    symlinkSync(found.stdout.trim(), join(bin, name));
  }
  const engine = join(bin, 'pdflatex');
  writeFileSync(engine, fakeDriver, { mode: 0o700 });
  const env = {
    ...process.env, FIXTURE: dir, FIXTURE_OUTPUT: output,
    MODE: mode, READY: String(ready), PATH: bin,
  };
  try {
    return callback({ dir, bin, output, engine, env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runPasses(mode, ready = 2) {
  return withFixture(mode, ready, ({ dir, output, engine, env }) => {
    const result = spawnSync('/bin/bash', [
      '-c', 'source "$1"; run_tex_passes "$2" book.tex "$3" book',
      'test', join(root, 'scripts/build-whitepapers.sh'), engine, output,
    ], { cwd: root, env, encoding: 'utf8' });
    return { ...result, passes: Number(readFileSync(join(dir, 'count'), 'utf8')) };
  });
}

function runBuild(driver, mode, ready = 2) {
  return withFixture(mode, ready, ({ dir, bin, env }) => {
    if (driver === 'latexmk') {
      writeFileSync(join(bin, 'latexmk'), fakeDriver, { mode: 0o700 });
    }
    const result = spawnSync('/bin/bash', [
      '-c', `source "$1"
BUILD_DIR="$2/build"
paper_epoch() { printf '0\\n'; }
if [ "$MODE" = copy-error ]; then cp() { return 19; }; fi
build_one "$2/source" book.tex "$2/published.pdf"`,
      'test', join(root, 'scripts/build-whitepapers.sh'), dir,
    ], { cwd: root, env, encoding: 'utf8' });
    return {
      ...result,
      passes: Number(readFileSync(join(dir, 'count'), 'utf8')),
      publication: readFileSync(join(dir, 'published.pdf'), 'utf8'),
    };
  });
}

test('waits for margin convergence beyond the former fourth pass', () => {
  const r = runPasses('margin', 6);
  assert.equal(r.status, 0);
  assert.equal(r.passes, 6);
});
test('requires two passes even if the first reports stability', () => {
  const r = runPasses('stable');
  assert.equal(r.status, 0);
  assert.equal(r.passes, 2);
});
for (const mode of ['labels', 'outlines']) {
  test(`waits for ${mode} convergence`, () => {
    const r = runPasses(mode, 5);
    assert.equal(r.status, 0);
    assert.equal(r.passes, 5);
  });
}
for (const mode of ['margin', 'outlines', 'undefined', 'missing-log']) {
  test(`rejects ${mode} after exactly eight unsettled passes`, () => {
    const r = runPasses(mode, 99);
    assert.equal(r.status, 1);
    assert.equal(r.passes, 8);
    assert.match(r.stderr, /refusing publication/);
  });
}
for (const [mode, passes] of [['engine-error', 1], ['late-error', 3]]) {
  test(`propagates ${mode} without retrying the failed engine`, () => {
    const r = runPasses(mode, 99);
    assert.equal(r.status, 17);
    assert.equal(r.passes, passes);
  });
}
for (const driver of ['manual', 'latexmk']) {
  test(`${driver}: publishes a converged candidate`, () => {
    const r = runBuild(driver, 'stable');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.publication, candidatePdf);
  });
  for (const mode of ['margin', 'outlines', 'undefined', 'missing-log', 'missing-pdf', 'engine-error']) {
    test(`${driver}: ${mode} cannot replace the publication`, () => {
      const r = runBuild(driver, mode, 99);
      assert.notEqual(r.status, 0);
      assert.equal(r.publication, originalPdf);
      if (driver === 'latexmk') assert.equal(r.passes, 1);
    });
  }
  test(`${driver}: copy failure is an error, not a successful publication`, () => {
    const r = runBuild(driver, 'copy-error');
    assert.notEqual(r.status, 0);
    assert.equal(r.publication, originalPdf);
    assert.match(r.stderr, /publication failed/);
    assert.doesNotMatch(r.stdout, /wrote .*published\.pdf/);
  });
}
test('manual: later engine failure preserves the existing publication', () => {
  const r = runBuild('manual', 'late-error', 99);
  assert.notEqual(r.status, 0);
  assert.equal(r.passes, 3);
  assert.equal(r.publication, originalPdf);
});
