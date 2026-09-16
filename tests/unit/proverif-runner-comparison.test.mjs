// Exercises scripts/proofs/run-proverif.py's comparison logic on fixture
// strings, offline -- no ProVerif installation required (or used). Run with:
//   node --test tests/unit/proverif-runner-comparison.test.mjs
//
// Two fixture trees are built under a temp directory and pointed at via
// --root, mirroring the real analyses/ + proofs/ layout closely enough to
// exercise discovery, baseline resolution, and both --check code paths:
//   - the "structural" path (no --proverif-bin given), which validates the
//     committed baseline files themselves without running anything;
//   - the "executed" path, using a tiny fake `proverif` stand-in (a Python
//     script passed via --proverif-bin) that prints canned RESULT lines, so
//     the real drift-comparison code runs against a real subprocess without
//     needing the actual ProVerif binary.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const runnerPath = join(repoRoot, 'scripts', 'proofs', 'run-proverif.py');

function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'proverif-runner-test-'));
  mkdirSync(join(root, 'analyses'), { recursive: true });
  mkdirSync(join(root, 'proofs', 'widget'), { recursive: true });
  mkdirSync(join(root, 'docs', 'adr', 'models'), { recursive: true });
  return root;
}

function writeFile(path, content) {
  writeFileSync(path, content, 'utf8');
}

// A minimal, syntactically-inert stand-in .pv body. The runner never parses
// ProVerif syntax itself -- it only shells out to a `proverif` binary and
// reads its stdout -- so these bodies just need to exist as files.
const PV_BODY = '(* fixture model *)\nfree c: channel.\nprocess out(c, 0).\n';

function runChecker(root, { proverifBin } = {}) {
  const args = [runnerPath, '--check', '--root', root];
  if (proverifBin) args.push('--proverif-bin', proverifBin);
  try {
    const stdout = execFileSync('python3', args, { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '' };
  }
}

test('structural mode (no proverif binary): matching baseline passes', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(join(root, 'analyses', 'ok_model.pv'), PV_BODY);
    writeFile(
      join(root, 'analyses', 'ok_model_results.txt'),
      'Some ProVerif preamble noise\nRESULT not attacker(secret[]) is true.\n',
    );

    const { code, stdout } = runChecker(root);
    assert.equal(code, 0);
    assert.match(stdout, /1 model\(s\) scanned, 0 without a committed baseline, 0 failing/);
    assert.match(stdout, /`analyses\/ok_model\.pv`.*OK/s);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('structural mode: a negative control whose committed baseline lacks a false RESULT fails (vacuity guard)', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(join(root, 'analyses', 'something_vuln.pv'), PV_BODY);
    // Wrong on purpose: a real negative control's committed evidence should
    // contain an "is false." line. This one doesn't, so the checker must
    // flag it rather than silently accept a checker that has gone vacuous.
    writeFile(
      join(root, 'analyses', 'something_vuln_results.txt'),
      'RESULT not attacker(secret[]) is true.\n',
    );

    const { code, stdout } = runChecker(root);
    assert.equal(code, 1);
    assert.match(stdout, /vacuous/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('structural mode: a negative control whose committed baseline does contain a false RESULT passes', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(join(root, 'analyses', 'discharge_naive_unsound.pv'), PV_BODY);
    writeFile(
      join(root, 'analyses', 'discharge_naive_unsound_results.txt'),
      'RESULT event(A(x)) ==> event(B(x)) is false.\n',
    );

    const { code, stdout } = runChecker(root);
    assert.equal(code, 0);
    assert.match(stdout, /0 failing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('structural mode: a model with no committed baseline is reported but does not fail the build', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(join(root, 'proofs', 'widget', 'unbaselined.pv'), PV_BODY);

    const { code, stdout } = runChecker(root);
    assert.equal(code, 0);
    assert.match(stdout, /1 without a committed baseline/);
    assert.match(stdout, /Models without a committed baseline/);
    assert.match(stdout, /`proofs\/widget\/unbaselined\.pv`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('executed mode: a fresh run matching the committed baseline passes', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(join(root, 'analyses', 'ok_model.pv'), PV_BODY);
    writeFile(
      join(root, 'analyses', 'ok_model_results.txt'),
      'RESULT not attacker(secret[]) is true.\n',
    );

    const fakeProverif = join(root, 'fake-proverif.py');
    writeFile(
      fakeProverif,
      '#!/usr/bin/env python3\nprint("RESULT not attacker(secret[]) is true.")\n',
    );
    chmodSync(fakeProverif, 0o755);

    const { code, stdout } = runChecker(root, { proverifBin: fakeProverif });
    assert.equal(code, 0);
    assert.match(stdout, /found -- every model re-run and compared/);
    assert.match(stdout, /0 failing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('executed mode: a fresh run that drifts from the committed baseline fails with a clear diff', () => {
  const root = makeFixtureRoot();
  try {
    writeFile(join(root, 'analyses', 'drifted_model.pv'), PV_BODY);
    writeFile(
      join(root, 'analyses', 'drifted_model_results.txt'),
      'RESULT not attacker(secret[]) is true.\n',
    );

    const fakeProverif = join(root, 'fake-proverif.py');
    // The model "changed" and now reports the query as false -- the
    // committed evidence was never regenerated to match.
    writeFile(
      fakeProverif,
      '#!/usr/bin/env python3\nprint("RESULT not attacker(secret[]) is false.")\n',
    );
    chmodSync(fakeProverif, 0o755);

    const { code, stdout } = runChecker(root, { proverifBin: fakeProverif });
    assert.equal(code, 1);
    assert.match(stdout, /RESULT lines drifted/);
    assert.match(stdout, /expected:.*is true/);
    assert.match(stdout, /actual:.*is false/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('executed mode: a negative control that the fresh run reports as true (not false) fails the vacuity guard even with a matching baseline', () => {
  const root = makeFixtureRoot();
  try {
    // Pathological case: the committed baseline was hand-edited to make a
    // negative control look like it passes (an "is true." line), and the
    // fresh run agrees with that wrong baseline. The RESULT-line comparison
    // alone would pass; the separate vacuity assertion must still catch it.
    writeFile(join(root, 'analyses', 'quiet_vuln.pv'), PV_BODY);
    writeFile(
      join(root, 'analyses', 'quiet_vuln_results.txt'),
      'RESULT not attacker(secret[]) is true.\n',
    );

    const fakeProverif = join(root, 'fake-proverif.py');
    writeFile(
      fakeProverif,
      '#!/usr/bin/env python3\nprint("RESULT not attacker(secret[]) is true.")\n',
    );
    chmodSync(fakeProverif, 0o755);

    const { code, stdout } = runChecker(root, { proverifBin: fakeProverif });
    assert.equal(code, 1);
    assert.match(stdout, /vacuous/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real repository tree passes --check offline (no ProVerif installed here)', () => {
  // Not a fixture: exercises the actual checker against the actual repo, in
  // the same structural mode CI falls back to if the tool install step
  // were ever skipped. This is the "runs end-to-end without ProVerif
  // installed" guarantee from the repo's own estate, not a synthetic one.
  const stdout = execFileSync('python3', [runnerPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.match(stdout, /\d+ model\(s\) scanned/);
  assert.doesNotMatch(stdout, /## Failures/);
});
