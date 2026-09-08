/**
 * PURSER RE-RUN POLICY + FAILURE PARSING.
 *
 * Two behaviours are under test, and both exist to stop the purser lying or
 * churning:
 *
 *  1. `decideRerun` — tests are authored ONCE per contract and re-executed
 *     thereafter. The negative cases matter most: a decision to RE-AUTHOR
 *     rewrites an author's goalposts mid-PR, so it must fire only on real
 *     contract drift, never on an ordinary push.
 *
 *  2. `parseTestFailures` — names shown to an author as "fix these" must be
 *     real. A false positive sends someone hunting a test that does not exist,
 *     which is worse than showing no names at all, so the suite pins the
 *     non-matches as hard as the matches.
 */
import { describe, it, expect } from 'vitest';
import {
  decideRerun,
  decodeFingerprint,
  encodeFingerprint,
  fingerprintDiff,
  withAuthoredTests,
  RE_AUTHOR_FILE_CHURN,
  RE_AUTHOR_SIZE_RATIO,
} from '../src/purser-rerun.js';
import { parseTestFailures, MAX_NAMED_FAILURES } from '../src/sandbox-runner.js';

const diffFor = (paths: string[], pad = 0): string =>
  paths.map(p => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n+x`).join('\n') +
  (pad ? `\n${'y'.repeat(pad)}` : '');

describe('fingerprintDiff', () => {
  it('captures the post-image paths and the diff size', () => {
    const fp = fingerprintDiff(diffFor(['src/a.ts', 'src/b.ts']));
    expect(fp.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(fp.size).toBeGreaterThan(0);
  });

  it('sorts and dedupes so path ORDER can never look like contract drift', () => {
    const one = fingerprintDiff(diffFor(['z.ts', 'a.ts', 'z.ts']));
    const two = fingerprintDiff(diffFor(['a.ts', 'z.ts']));
    expect(one.files).toEqual(two.files);
  });

  it('skips /dev/null (a deletion has no post-image to test)', () => {
    const fp = fingerprintDiff('--- a/gone.ts\n+++ /dev/null\n-x');
    expect(fp.files).toEqual([]);
  });

  it('round-trips through the PR-body marker, authored test paths included', () => {
    const fp = withAuthoredTests(fingerprintDiff(diffFor(['src/a.ts'])), [
      'tests/purser/b.test.ts',
      'tests/purser/a.test.ts',
    ]);
    // Sorted on the way in, so the marker is stable across runs.
    expect(fp.tests).toEqual(['tests/purser/a.test.ts', 'tests/purser/b.test.ts']);
    expect(decodeFingerprint(`prose\n${encodeFingerprint(fp)}\nmore prose`)).toEqual(fp);
  });

  it('decodes a legacy marker with no `tests` to an empty list, not a crash', () => {
    // Written before bounded re-reads existed. An empty list routes the caller
    // to re-author rather than to a repo-wide tree walk.
    const legacy = '<!-- purser-contract-fingerprint: {"files":["a.ts"],"size":10} -->';
    expect(decodeFingerprint(legacy)).toEqual({ files: ['a.ts'], size: 10, tests: [] });
  });

  it('decodes to null on absent or malformed markers — no memory beats false memory', () => {
    expect(decodeFingerprint(undefined)).toBeNull();
    expect(decodeFingerprint('no marker here')).toBeNull();
    expect(decodeFingerprint('<!-- purser-contract-fingerprint: {not json} -->')).toBeNull();
    // Right shape, wrong types.
    expect(decodeFingerprint('<!-- purser-contract-fingerprint: {"files":"x","size":1} -->')).toBeNull();
  });
});

describe('decideRerun — the steady state is REUSE', () => {
  it('reuses when the same files are touched (an ordinary push)', () => {
    const prev = fingerprintDiff(diffFor(['src/a.ts', 'src/b.ts']));
    const cur = fingerprintDiff(diffFor(['src/a.ts', 'src/b.ts'], 50));
    const d = decideRerun(prev, cur, true);
    expect(d.action).toBe('reuse');
  });

  it('reuses when ONE file is added to an existing set', () => {
    const prev = fingerprintDiff(diffFor(['src/a.ts', 'src/b.ts', 'src/c.ts']));
    const cur = fingerprintDiff(diffFor(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']));
    expect(decideRerun(prev, cur, true).action).toBe('reuse');
  });

  it('reuses across a whitespace-only change — the treadmill this prevents', () => {
    const prev = fingerprintDiff(diffFor(['src/a.ts']));
    const cur = fingerprintDiff(diffFor(['src/a.ts']) + '\n ');
    expect(decideRerun(prev, cur, true).action).toBe('reuse');
  });
});

describe('decideRerun — RE-AUTHOR only on real drift', () => {
  it('re-authors when the changed-file set wholly turns over', () => {
    const prev = fingerprintDiff(diffFor(['src/a.ts', 'src/b.ts']));
    const cur = fingerprintDiff(diffFor(['docs/x.md', 'docs/y.md']));
    const d = decideRerun(prev, cur, true);
    expect(d.action).toBe('author');
    expect(d.reason).toMatch(/turned over/);
  });

  it(`re-authors past the ${RE_AUTHOR_SIZE_RATIO}× size threshold even on the same files`, () => {
    const prev = fingerprintDiff(diffFor(['src/a.ts']));
    const cur = fingerprintDiff(diffFor(['src/a.ts'], prev.size * RE_AUTHOR_SIZE_RATIO + 500));
    const d = decideRerun(prev, cur, true);
    expect(d.action).toBe('author');
    expect(d.reason).toMatch(/changed size/);
  });

  it('authors when the prior test files could not be read', () => {
    const fp = fingerprintDiff(diffFor(['src/a.ts']));
    expect(decideRerun(fp, fp, false).action).toBe('author');
  });

  it('authors when the existing test PR predates fingerprinting', () => {
    const d = decideRerun(null, fingerprintDiff(diffFor(['src/a.ts'])), true);
    expect(d.action).toBe('author');
    expect(d.reason).toMatch(/no contract fingerprint/);
  });

  it(`sits exactly at the ${RE_AUTHOR_FILE_CHURN} churn boundary predictably`, () => {
    // 1 shared of 3 union ⇒ distance 0.667 ≥ 0.5 ⇒ author.
    const prev = fingerprintDiff(diffFor(['a.ts', 'b.ts']));
    const cur = fingerprintDiff(diffFor(['a.ts', 'c.ts']));
    expect(decideRerun(prev, cur, true).action).toBe('author');
    // 2 shared of 3 union ⇒ distance 0.333 < 0.5 ⇒ reuse.
    const prev2 = fingerprintDiff(diffFor(['a.ts', 'b.ts']));
    const cur2 = fingerprintDiff(diffFor(['a.ts', 'b.ts', 'c.ts']));
    expect(decideRerun(prev2, cur2, true).action).toBe('reuse');
  });
});

describe('parseTestFailures — names must be real', () => {
  it('extracts vitest/jest per-case failures', () => {
    const out = ['✓ passes fine', '× parley > rejects a non-member', '✕ mediator > cannot sign'].join('\n');
    expect(parseTestFailures(out)).toEqual([
      'parley > rejects a non-member',
      'mediator > cannot sign',
    ]);
  });

  it('extracts TAP (node:test) failures', () => {
    expect(parseTestFailures('ok 1 - fine\nnot ok 2 - guard rejects forged id')).toEqual([
      'guard rejects forged id',
    ]);
  });

  it('extracts pytest and go test failures', () => {
    expect(parseTestFailures('FAILED tests/test_x.py::test_case - AssertionError')).toEqual([
      'tests/test_x.py::test_case',
    ]);
    expect(parseTestFailures('--- FAIL: TestThing (0.00s)')).toEqual(['TestThing']);
  });

  it('sees through ANSI colour', () => {
    expect(parseTestFailures('\u001b[31m×\u001b[0m coloured case name')).toEqual([
      'coloured case name',
    ]);
  });

  it('does NOT match prose that merely mentions failure', () => {
    const prose = [
      'The build failed earlier for unrelated reasons.',
      'Note: 3 tests failed in a previous run.',
      'this test failed once',
    ].join('\n');
    expect(parseTestFailures(prose)).toEqual([]);
  });

  it('does NOT report the runner summary line as a test name', () => {
    expect(parseTestFailures('Tests  3 failed | 12 passed')).toEqual([]);
  });

  it('dedupes repeats (runners print failures twice: inline and in the summary)', () => {
    expect(parseTestFailures('× same case\n× same case')).toEqual(['same case']);
  });

  it(`caps at ${MAX_NAMED_FAILURES} so a catastrophic run cannot flood the PR`, () => {
    const many = Array.from({ length: 200 }, (_, i) => `× case ${i}`).join('\n');
    expect(parseTestFailures(many)).toHaveLength(MAX_NAMED_FAILURES);
  });

  it('returns empty on unrecognised output rather than guessing', () => {
    expect(parseTestFailures('some bespoke runner said: 4 bad')).toEqual([]);
  });
});
