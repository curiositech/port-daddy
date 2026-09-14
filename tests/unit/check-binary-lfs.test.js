/**
 * Regression test for scripts/check-binary-lfs.mjs — the gate that stops a
 * large binary landing outside Git LFS on a path nobody meant to grow.
 *
 * Covers: the threshold and the binary sniff; that LFS-routed and
 * allow-listed paths are let through; that the deployed paths really are
 * allow-listed (the failure mode there is a pointer on the live site); that
 * the carve-out for the sha256-pinned whitepaper figures is present; and that
 * the committed tree itself passes the gate.
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  THRESHOLD_BYTES,
  ALLOWED_NON_LFS,
  isAllowedNonLfs,
  looksBinary,
  findViolations,
  isLfsTracked,
  inspect,
  GRANDFATHERED,
} from '../../scripts/check-binary-lfs.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** A descriptor for the pure core: binary, over threshold, not LFS, not allowed. */
function offender(rel, overrides = {}) {
  return { rel, size: THRESHOLD_BYTES + 1, binary: true, lfs: false, ...overrides };
}

describe('binary sniff', () => {
  test('a buffer containing NUL reads as binary', () => {
    expect(looksBinary(Buffer.from([0x41, 0x00, 0x42]), 3)).toBe(true);
  });

  test('plain text does not', () => {
    const b = Buffer.from('# a markdown heading\nwith prose\n');
    expect(looksBinary(b, b.length)).toBe(false);
  });

  test('the sniff only looks at the length it is given', () => {
    // A NUL past the inspected window must not count — this mirrors git's own
    // first-8000-bytes rule, and a mismatch here would make the gate disagree
    // with what git actually treats as binary.
    expect(looksBinary(Buffer.from([0x41, 0x41, 0x00]), 2)).toBe(false);
  });
});

describe('violation rules', () => {
  test('a big non-LFS binary on an ordinary path is a violation', () => {
    expect(findViolations([offender('docs/notes/huge-capture.png')])).toHaveLength(1);
  });

  test('the same file under the threshold is not', () => {
    expect(findViolations([offender('docs/notes/x.png', { size: THRESHOLD_BYTES - 1 })])).toHaveLength(0);
  });

  test('exactly at the threshold IS a violation (the bound is inclusive)', () => {
    expect(findViolations([offender('docs/notes/x.png', { size: THRESHOLD_BYTES })])).toHaveLength(1);
  });

  test('a big TEXT file is not a violation', () => {
    // Generated JSON corpora and .cast recordings get large and belong in
    // plain git: they diff, they compress, and LFS would only make them
    // harder to review.
    expect(findViolations([offender('docs/data/corpus.json', { binary: false })])).toHaveLength(0);
  });

  test('a file already routed through LFS is not a violation', () => {
    expect(findViolations([offender('docs/pr-assets/pr-1/shot.png', { lfs: true })])).toHaveLength(0);
  });

  test('every allow-listed prefix is let through', () => {
    for (const prefix of ALLOWED_NON_LFS) {
      expect(findViolations([offender(`${prefix}big-asset.png`)])).toHaveLength(0);
    }
  });

  test('a custom allow-list is honoured, and the default is not consulted', () => {
    const files = [offender('website-v2/public/logo.png')];
    expect(findViolations(files, { allowed: ['some/other/'] })).toHaveLength(1);
  });
});

describe('allow-list contents', () => {
  test('the deployed site directory is allow-listed', () => {
    // The reason this matters: Vite copies public/ into dist/ verbatim and
    // Cloudflare Pages uploads it. No workflow does an LFS checkout, so an LFS
    // pointer here would be served to real users as 130 bytes of ASCII.
    expect(isAllowedNonLfs('website-v2/public/whitepaper/some.pdf')).toBe(true);
  });

  test('the sha256-pinned whitepaper figure subtree is allow-listed', () => {
    // tests/unit/spawn-whitepaper-contract.test.js hashes these files and
    // parses the PNG IHDR. Under LFS it would hash a pointer.
    expect(isAllowedNonLfs('docs/artifacts/whitepaper-figure-semantics/all-volumes/x.png')).toBe(true);
  });

  test('an evidence directory is NOT allow-listed — it belongs in LFS', () => {
    expect(isAllowedNonLfs('docs/pr-assets/pr-1/shot.png')).toBe(false);
    expect(isAllowedNonLfs('website-v2/screenshots/home.png')).toBe(false);
  });

  test('a prefix does not match a merely similarly-named sibling', () => {
    // 'demos/' must not swallow 'demos-archive/'.
    expect(isAllowedNonLfs('demos-archive/big.gif')).toBe(false);
  });
});

describe('attribute wiring (reads the real .gitattributes)', () => {
  test.each([
    ['docs/pr-assets/pr-1/shot.png'],
    ['docs/artifacts/some-run/capture.gif'],
    ['docs/pr-media/x/clip.webm'],
    ['website-v2/screenshots/home-dark.png'],
    ['website-v2/docs/artifacts/login-state/scroll.webm'],
    ['core/pd-console/docs/artifacts/pane-default.png'],
  ])('%s is routed to LFS', (rel) => {
    expect(isLfsTracked(rel, REPO)).toBe(true);
  });

  test.each([
    ['website-v2/public/whitepaper/coordination-papers-mega-volume.pdf'],
    ['website-v2/public/img/og/card.png'],
    ['docs/artifacts/whitepaper-figure-semantics/all-volumes/contact.png'],
    ['demos/blog/fleet-live.gif'],
  ])('%s is deliberately NOT routed to LFS', (rel) => {
    expect(isLfsTracked(rel, REPO)).toBe(false);
  });
});

describe('the grandfathered debt list', () => {
  // The list is only useful if it cannot grow and cannot go stale. These two
  // tests are what make it self-maintaining: adding a new large binary outside
  // LFS fails the first, and converting a listed file fails the second until
  // its entry is deleted.

  test('the committed tree introduces nothing beyond the grandfathered set', () => {
    const out = execFileSync('node', ['scripts/check-binary-lfs.mjs', '--all'], {
      cwd: REPO, encoding: 'utf8',
    });
    expect(out).toMatch(/check-binary-lfs: OK/);
  });

  test('every grandfathered path is still a tracked file', () => {
    // Works even in a sparse checkout: ls-files reads the index, not the disk.
    const tracked = new Set(
      execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\n').filter(Boolean),
    );
    const gone = GRANDFATHERED.filter((p) => !tracked.has(p));
    expect(gone).toEqual([]);
  });

  test('no grandfathered path has since been moved into LFS', () => {
    // A converted file must lose its entry here, or the list quietly becomes a
    // list of lies. Paths absent from a sparse checkout are skipped; CI runs a
    // full checkout, so there the whole list is checked.
    const present = GRANDFATHERED.filter((p) => existsSync(join(REPO, p)));
    const stale = present.filter((p) => inspect(p, REPO).lfs);
    expect(stale).toEqual([]);
  });

  test('the list is sorted and free of duplicates', () => {
    expect(GRANDFATHERED).toEqual([...new Set(GRANDFATHERED)]);
    expect(GRANDFATHERED).toEqual([...GRANDFATHERED].sort());
  });

  test('a grandfathered path is excluded from violations, and only by the list', () => {
    const f = offender(GRANDFATHERED[0]);
    expect(findViolations([f])).toHaveLength(0);
    // With an empty grandfather list it is a violation again — proving the
    // pass above comes from the list and not from an allow-list prefix.
    expect(findViolations([f], { grandfathered: [] })).toHaveLength(1);
  });
});

describe('end to end against a scratch repository', () => {
  // Builds a throwaway repo with its own .gitattributes so the whole chain —
  // stat, NUL sniff, and `git check-attr` against real rules — runs for
  // real, not against hand-written descriptors.
  let dir;

  const BIG = 2 * 1024 * 1024;
  function writeBinary(rel, bytes = BIG) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const buf = Buffer.alloc(bytes, 0x41);
    buf[3] = 0; // NUL inside the first 8000 bytes -> binary, same sniff as git
    writeFileSync(abs, buf);
    return rel;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'binlfs-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(
      join(dir, '.gitattributes'),
      'docs/pr-assets/**/*.png filter=lfs diff=lfs merge=lfs -text\n',
    );
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  test('a big binary on an unroutered path is caught', () => {
    const rel = writeBinary('docs/rogue/huge.png');
    const f = inspect(rel, dir);
    expect(f).toMatchObject({ binary: true, lfs: false });
    expect(f.size).toBe(BIG);
    expect(findViolations([f])).toHaveLength(1);
  });

  test('the identical file under an LFS-routed path is not', () => {
    const rel = writeBinary('docs/pr-assets/pr-9/huge.png');
    const f = inspect(rel, dir);
    expect(f.lfs).toBe(true);
    expect(findViolations([f])).toHaveLength(0);
  });

  test('a big text file on an unroutered path is not', () => {
    const abs = join(dir, 'docs/rogue/corpus.json');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, 'x'.repeat(BIG));
    const f = inspect('docs/rogue/corpus.json', dir);
    expect(f.binary).toBe(false);
    expect(findViolations([f])).toHaveLength(0);
  });

  test('a small binary on an unroutered path is not', () => {
    const rel = writeBinary('docs/rogue/small.png', 4096);
    expect(findViolations([inspect(rel, dir)])).toHaveLength(0);
  });

  test('an LFS pointer already on disk reads as small text and passes', () => {
    // What a fresh non-LFS checkout of a converted file actually looks like.
    const abs = join(dir, 'docs/pr-assets/pr-9/pointer.png');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs,
      'version https://git-lfs.github.com/spec/v1\n'
      + 'oid sha256:5d2444b89e8cc612bb851931f9d79ce089505411a55262fb368177467891e2fa\n'
      + 'size 707569\n');
    const f = inspect('docs/pr-assets/pr-9/pointer.png', dir);
    expect(f.binary).toBe(false);
    expect(findViolations([f])).toHaveLength(0);
  });
});
