// tests/unit/purser/nul-in-middle.test.js
/**
 * The repo's NUL guard must catch a NUL byte ANYWHERE in a file, including
 * past offset 8000 — the point of this file.
 *
 * WHY 8000 MATTERS: git sniffs only the first 8000 bytes of a blob to decide
 * "binary". A NUL at offset 8500 therefore leaves git perfectly happy — it
 * still diffs the file, still merges it, still calls it text — while ripgrep,
 * which is NOT bound by that window, has already stopped printing matching
 * lines and started printing `binary file matches`. That gap is the dangerous
 * one: nothing in git's own behaviour signals the problem, and the only
 * symptom is that search goes quiet, which reads like "this symbol is unused".
 * So the guard is deliberately STRICTER than git's heuristic, and the third
 * test below pins that difference by measuring both sides of it.
 *
 * HISTORY — do not reintroduce this shape. The first version of this file
 * imported nothing from this repo (`@jest/globals`, `node:fs`, `node:path`,
 * `node:os` only), wrote a 9000-byte buffer with a NUL at 8500 to a temp file,
 * read it back and asserted `readBuf.includes(0) === true`. That is a test of
 * a Node built-in: it PASSED with tests/unit/source-is-text.test.js deleted
 * from the tree. It could not have been written any other way at the time,
 * because the scanning logic was module-private to that test file. The fix was
 * structural — scripts/lib/source-is-text.mjs now exports `findNulOffenders`
 * with an arbitrary root — so this file drives the real guard over fixtures.
 * If you ever find yourself re-implementing the check here, stop: that means
 * the seam has gone away again, and the seam is the point.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { findNulOffenders } from '../../../scripts/lib/source-is-text.mjs';

const TEMP_DIR = resolve(tmpdir(), 'purser-nul-test-' + Date.now());

const SIZE = 9000; // comfortably past git's 8000-byte sniff window
const LATE_NUL_OFFSET = 8500; // outside the window: git says text, ripgrep does not
const EARLY_NUL_OFFSET = 100; // inside the window: git says binary

/** Write `size` bytes of filler into TEMP_DIR, optionally with one raw NUL. */
function writeFixture(name, { size = SIZE, nulAt = null } = {}) {
  const buf = Buffer.alloc(size, 'a');
  if (nulAt !== null) buf[nulAt] = 0;
  writeFileSync(join(TEMP_DIR, name), buf);
  return name;
}

/**
 * Ask git whether it considers `name` binary, using its own sniff.
 * `git diff --numstat` prints `-\t-` for a binary blob and real line counts
 * for a text one, so the answer comes from git rather than from our belief
 * about git. Exits non-zero whenever the files differ, which is always here.
 */
function gitCallsItBinary(name) {
  const { stdout, status } = spawnSync(
    'git',
    ['diff', '--no-index', '--numstat', '--', 'clean.txt', name],
    { cwd: TEMP_DIR, encoding: 'utf8' },
  );
  // status 1 == "files differ", which is expected. Anything else is a broken
  // probe, and a broken probe must not read as "not binary".
  if (status !== 1) throw new Error(`git diff probe failed (status ${status}): ${stdout}`);
  return stdout.startsWith('-\t-\t');
}

beforeAll(() => {
  mkdirSync(TEMP_DIR, { recursive: true });
  writeFixture('clean.txt');
});

afterAll(() => {
  // Clean up the temporary directory after all tests
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('NUL detection beyond git 8000-byte threshold', () => {
  test('the guard reports a file whose only NUL is at offset 8500', () => {
    const name = writeFixture('late.txt', { nulAt: LATE_NUL_OFFSET });

    expect(findNulOffenders([name], TEMP_DIR)).toEqual([name]);
  });

  test('the guard does not report a same-sized file with no NUL', () => {
    expect(findNulOffenders(['clean.txt'], TEMP_DIR)).toEqual([]);
  });

  test('the guard catches what git deliberately does not: a NUL past its sniff window', () => {
    const late = writeFixture('late-sharp.txt', { nulAt: LATE_NUL_OFFSET });
    const early = writeFixture('early-sharp.txt', { nulAt: EARLY_NUL_OFFSET });

    // Control: git's sniff does work, and does fire on a NUL inside its window.
    // Without this, "git says text" below could just mean the probe is broken.
    expect(gitCallsItBinary(early)).toBe(true);

    // The sharp point. Same file size, same single NUL, only the offset moved
    // past 8000 — and git now calls it TEXT. Nothing in git's behaviour would
    // ever tell you, but ripgrep still refuses to print the matching lines.
    expect(gitCallsItBinary(late)).toBe(false);

    // The guard is not fooled: it scans the whole buffer, so it catches the
    // file git waved through. Truncating findNulOffenders to the first 8000
    // bytes would make this assertion fail, which is exactly the regression
    // this test exists to catch.
    expect(findNulOffenders([late, early, 'clean.txt'], TEMP_DIR)).toEqual([late, early]);
  });

  test('the boundary is exact: byte 8000 is the first one git never reads', () => {
    // 8500 above proves the guard beats git's window. This pins WHERE the
    // window ends, because "somewhere past 8000" is not a boundary — a byte
    // index is. Measured on git 2.43.0:
    //
    //   NUL at 7999 -> git diff --numstat says BINARY  (last byte git reads)
    //   NUL at 8000 -> git diff --numstat says text    (first byte it skips)
    //
    // So 8000 is the worst case: the earliest possible NUL that git will wave
    // through. A guard that is even one byte short of whole-buffer misses it.
    //
    // Credit where due — this case came from pd-purser on #9757. Its own
    // fixture for it was broken (`Buffer.alloc(8001)` then `buf[8001] = 0`,
    // which Node silently drops as an out-of-bounds write, leaving a file with
    // no NUL at all), but the idea was right and this repo did not have it.
    const lastRead = writeFixture('nul-at-7999.txt', { nulAt: 7999 });
    const firstSkipped = writeFixture('nul-at-8000.txt', { nulAt: 8000 });

    expect(gitCallsItBinary(lastRead)).toBe(true);
    expect(gitCallsItBinary(firstSkipped)).toBe(false);

    // Ours catches both. This is the assertion that matters; the two above are
    // what make this offset the interesting one rather than an arbitrary number.
    expect(findNulOffenders([lastRead, firstSkipped], TEMP_DIR)).toEqual([lastRead, firstSkipped]);
  });
});
