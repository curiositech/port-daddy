/**
 * Regression test for scripts/check-relay-decode-guard.mjs — the guard that
 * stops the relay's malformed-URL 500 defect class (four review bots on PR
 * #10150) from coming back: no raw `decodeURIComponent` reference anywhere
 * in the Relay area's configured files outside `safeDecodeSegment`'s own
 * body. The area is config (see `AREAS` in the script), not a hard-coded
 * single path: it currently expands to every `.ts` file under
 * `apps/relay/src/`, not `index.ts` alone (pd-lookout's follow-up finding on
 * PR #10156 — the router was covered, the rest of Relay's source tree was
 * not), and the same walker is reused per-area so covering another app that
 * decodes URL segments raw is a config entry, not new code (pd-spark's
 * finding on the same PR).
 *
 * Runs against committed fixtures (tests/fixtures/relay-decode-guard/) so the
 * mechanical behaviour is pinned:
 *   - a clean file (helper + routes that all go through it, plus a comment
 *     that merely MENTIONS the banned name) passes;
 *   - a raw `decodeURIComponent(...)` call outside the helper fails, named;
 *   - a raw BARE REFERENCE (`.map(decodeURIComponent)`, no trailing "(") also
 *     fails — proving the guard is AST-based, not a `decodeURIComponent(`
 *     text search, which would miss exactly this shape;
 *   - a file with no `safeDecodeSegment` anchor at all errors out (exit 2),
 *     distinct from a real violation (exit 1), rather than silently passing;
 *   - renaming the helper — consistently, everywhere, zero stray raw
 *     references left — ALSO exits non-zero (2): the anchor is looked up by
 *     name against the area config, so a rename the config isn't updated for
 *     in the same commit fails closed instead of reading as "nothing to flag".
 *
 * It also runs the guard with no override (the real CI invocation) against
 * every real file the Relay area's config expands to. That live contract
 * must pass; known violations belong in code fixes, not in a test that
 * blesses a permanently red required job.
 */
import { describe, expect, test, afterEach } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AREAS, expandEntry, areaFiles } from '../../scripts/check-relay-decode-guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'check-relay-decode-guard.mjs');
const fixtureDir = join(repo, 'tests', 'fixtures', 'relay-decode-guard');
const fixture = (name) => join(fixtureDir, name);

/**
 * The exit code each committed fixture is INTENDED to produce, declared here
 * rather than inferred from whatever the fixture currently happens to do.
 *
 * Why this table exists as its own thing, separate from the per-behavior
 * tests below: a real incident on this exact directory (see the "carries an
 * automated bot regression" note in this PR) had an automated "unused
 * variable" tidy-up strip `safeDecodeSegment` out of dirty-bare-ref.ts. That
 * silently turned its intended exit-1 case into an exit-2 case — the
 * fixture stopped testing what it was written to test, while the suite
 * still ran green everywhere except the one existing assertion that
 * happened to pin the code explicitly. A fixture directory has no compiler
 * to notice this: nothing but an explicit, declared expectation does. This
 * table is that: every fixture's code is asserted against a value written
 * here, not derived from a bespoke describe block, and the directory
 * listing is cross-checked against the table in both directions — a new
 * fixture with no entry, or an entry for a fixture that no longer exists,
 * fails loudly instead of silently doing nothing.
 */
const FIXTURE_EXIT_CODES = {
  'clean.ts': 0,
  'clean-name-shapes.ts': 0,
  'dirty-bare-ref.ts': 1,
  'dirty-destructuring-bind.ts': 1,
  'dirty-qualified-ref.ts': 1,
  'dirty-raw-call.ts': 1,
  'no-helper.ts': 2,
  'renamed-helper.ts': 2,
};

/** Run the guard; return { code, stdout, stderr }. */
function run(...args) {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('relay decode guard (scripts/check-relay-decode-guard.mjs)', () => {
  test('every committed fixture is registered in FIXTURE_EXIT_CODES, and vice versa', () => {
    const onDisk = readdirSync(fixtureDir).filter((name) => name.endsWith('.ts')).sort();
    const registered = Object.keys(FIXTURE_EXIT_CODES).sort();
    // Symmetric: a fixture added without an entry, or an entry for a fixture
    // that no longer exists, is exactly the drift this table exists to catch.
    expect(onDisk).toEqual(registered);
  });

  test('every fixture in FIXTURE_EXIT_CODES actually produces its declared exit code', () => {
    const mismatches = [];
    for (const [name, expected] of Object.entries(FIXTURE_EXIT_CODES)) {
      const { code } = run(fixture(name));
      if (code !== expected) mismatches.push(`${name}: expected ${expected}, got ${code}`);
    }
    // One assertion with every mismatch named, not the first thrown one --
    // a single tidy-up that touches several fixtures should not have to be
    // re-run per fixture to see the full damage.
    expect(mismatches).toEqual([]);
  });

  test('a clean file (helper-only call, comment mention) passes', () => {
    const { code, stdout } = run(fixture('clean.ts'));
    expect(code).toBe(0);
    expect(stdout).toMatch(/no raw decodeURIComponent outside safeDecodeSegment/);
  });

  test('a raw decodeURIComponent(...) call outside the helper fails, named', () => {
    const { code, stderr } = run(fixture('dirty-raw-call.ts'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/1 raw `decodeURIComponent` reference/);
    expect(stderr).toMatch(/:26\s+const id = decodeURIComponent/);
    expect(stderr).toMatch(/Use safeDecodeSegment\(segment\)/);
    // Actionable: names the throw + the 500 it causes.
    expect(stderr).toMatch(/URIError/);
    expect(stderr).toMatch(/500 INTERNAL_ERROR/);
  });

  test('a raw BARE REFERENCE (.map(decodeURIComponent), no trailing "(") also fails', () => {
    const { code, stderr } = run(fixture('dirty-bare-ref.ts'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/1 raw `decodeURIComponent` reference/);
    expect(stderr).toMatch(/\.map\(decodeURIComponent\)/);
  });

  test('property-qualified and computed references cannot bypass the guard', () => {
    const { code, stderr } = run(fixture('dirty-qualified-ref.ts'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/4 raw `decodeURIComponent` reference\(s\)/);
    expect(stderr).toMatch(/namespaceLike\.decodeURIComponent/);
    expect(stderr).toMatch(/globalThis\.decodeURIComponent/);
    expect(stderr).toMatch(/maybeNamespace\?\.decodeURIComponent/);
    expect(stderr).toMatch(/globalThis\['decodeURIComponent'\]/);
  });

  test('safeDecodeSegment\'s own body is exempt: only the injected site is flagged, never the helper\'s own call', () => {
    const { stderr } = run(fixture('dirty-raw-call.ts'));
    // Exactly one violation reported even though the helper (present in the
    // same file) also contains the literal text "decodeURIComponent".
    const offenderLines = stderr.split('\n').filter((l) => /^\s+tests\/fixtures.*:\d+\s/.test(l));
    expect(offenderLines).toHaveLength(1);
  });

  test('a file with no safeDecodeSegment anchor errors (exit 2), not a silent pass', () => {
    const { code, stderr } = run(fixture('no-helper.ts'));
    expect(code).toBe(2);
    expect(stderr).toMatch(/could not find `safeDecodeSegment`/);
  });

  test(
    'FAIL-CLOSED REGRESSION: renaming the sanctioned helper -- consistently, at its ' +
      'declaration and every call site, with zero stray raw references left anywhere -- ' +
      'still exits non-zero (2), not a silent 0. The guard must never read "no raw ' +
      'decodeURIComponent found outside a function I cannot locate" as "clean": a rename ' +
      'the guard config was not updated for is exactly the failure mode that would let a ' +
      'genuine violation slip through elsewhere in the same commit.',
    () => {
      const { code, stdout, stderr } = run(fixture('renamed-helper.ts'));
      expect(code).toBe(2);
      expect(code).not.toBe(0);
      expect(stdout).not.toMatch(/no raw decodeURIComponent/);
      expect(stderr).toMatch(/could not find `safeDecodeSegment`/);
      expect(stderr).toMatch(/renamed-helper\.ts/);
    },
  );

  test('an unreadable target errors (exit 2), not a silent pass', () => {
    const missing = fixture('does-not-exist.ts');
    const { code, stderr } = run(missing);
    expect(code).toBe(2);
    expect(stderr).toMatch(/cannot read .*does-not-exist\.ts/);
  });

  test(
    'pure-NAME shapes (object-literal key, import/export specifier name, ' +
      'type-member and class-member names, plain parameter/variable ' +
      'declaration names) are never a value-read of the global builtin, and all pass ' +
      'clean -- PR #10156 review-finding fix',
    () => {
      const { code, stdout } = run(fixture('clean-name-shapes.ts'));
      expect(code).toBe(0);
      expect(stdout).toMatch(/no raw decodeURIComponent outside safeDecodeSegment/);
    },
  );

  test(
    'destructuring BINDS `decodeURIComponent` stays flagged on purpose, both ' +
      'shorthand and renamed -- `const { decodeURIComponent } = globalThis` ' +
      '(or any object) is a genuine way to smuggle the actual banned global ' +
      'function into scope under any alias, which is exactly the defect ' +
      'class this guard exists to stop; a review bot on PR #10156 argued to ' +
      'exclude this shape as a false positive, and this guard deliberately ' +
      'disagrees',
    () => {
      const { code, stderr } = run(fixture('dirty-destructuring-bind.ts'));
      expect(code).toBe(1);
      expect(stderr).toMatch(/2 raw `decodeURIComponent` reference\(s\)/);
      expect(stderr).toMatch(/:25\s+const \{ decodeURIComponent \} = anything;/);
      expect(stderr).toMatch(/:29\s+const \{ decodeURIComponent: aliased \} = anything;/);
    },
  );

  test('the live router passes with no raw decode references', () => {
    const { code, stdout, stderr } = run();
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toMatch(/apps\/relay\/src\/index\.ts has no raw decodeURIComponent/);
  });

  test(
    'the scan is the whole Relay source tree, not index.ts alone -- pd-lookout\'s ' +
      'widened-scope finding: a file that hand-rolls its own decode try/catch instead of ' +
      'importing the shared helper (apps/relay/src/coordination.ts, fixed to import ' +
      'safeDecodeSegment rather than reimplement it) is scanned and reported clean, and ' +
      'the run covers dozens of files, not one',
    () => {
      const { code, stdout, stderr } = run();
      expect(code).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toMatch(/apps\/relay\/src\/coordination\.ts has no raw decodeURIComponent/);
      expect(stdout).toMatch(/apps\/relay\/src\/handlers\.ts has no raw decodeURIComponent/);
      const scannedFiles = stdout.trim().split('\n').length;
      expect(scannedFiles).toBeGreaterThan(20);
    },
  );
});

/**
 * Unit tests for expandEntry/areaFiles (the glob expansion the widened scan
 * runs on) — separate from the CLI-level tests above and deliberately
 * against a synthetic fixture tree this file builds, not the real Relay
 * source (which changes independently of this test).
 *
 * pd-qa's finding on this PR: the walker (findRawReferences / isPureNameNode
 * / findHelperRange) was well covered by fixtures, but the thing that
 * decides WHAT the walker ever sees — expandEntry's glob expansion — had no
 * test of its own. A guard whose expansion silently under-matches (a
 * directory it fails to recurse into, an extension check that misses, an
 * off-by-one in the glob-shape validation) reports green while scanning
 * fewer files than its config claims — worse than the single-file guard
 * this PR widened, because that one was at least honest about its scope.
 *
 * Each expected file count below is declared here, not read off whatever
 * expandEntry currently returns — the same discipline as
 * FIXTURE_EXIT_CODES above: a future change that narrows the expansion must
 * fail a test, not just quietly ship a smaller green.
 */
describe('expandEntry / areaFiles (the glob expansion behind the widened scan)', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  /**
   * Builds:
   *   root/a.ts                                  <- matches
   *   root/b.md                                   different extension
   *   root/notes.ts.bak                            contains ".ts" but does not END in ".ts"
   *   root/.hidden.ts                              dot-file, skipped
   *   root/node_modules/ignored.ts                 node_modules, skipped regardless of extension
   *   root/sub/c.ts                                <- matches
   *   root/sub/d.txt                               different extension
   *   root/sub/empty/                              empty dir: no throw, contributes nothing
   *   root/sub/onlymd/e.md                         dir with only non-matching files: no throw
   *   root/sub/deep/deeper/deepest/z.ts            <- matches, several levels down ("**" doing its job)
   * Three matches total: a.ts, sub/c.ts, sub/deep/deeper/deepest/z.ts.
   */
  function buildTree() {
    const r = mkdtempSync(join(tmpdir(), 'relay-decode-guard-glob-'));
    writeFileSync(join(r, 'a.ts'), '// a\n');
    writeFileSync(join(r, 'b.md'), '# b\n');
    writeFileSync(join(r, 'notes.ts.bak'), '// not a .ts file\n');
    writeFileSync(join(r, '.hidden.ts'), '// dotfile\n');
    mkdirSync(join(r, 'node_modules'), { recursive: true });
    writeFileSync(join(r, 'node_modules', 'ignored.ts'), '// vendored\n');
    mkdirSync(join(r, 'sub'), { recursive: true });
    writeFileSync(join(r, 'sub', 'c.ts'), '// c\n');
    writeFileSync(join(r, 'sub', 'd.txt'), 'not typescript\n');
    mkdirSync(join(r, 'sub', 'empty'), { recursive: true });
    mkdirSync(join(r, 'sub', 'onlymd'), { recursive: true });
    writeFileSync(join(r, 'sub', 'onlymd', 'e.md'), '# e\n');
    mkdirSync(join(r, 'sub', 'deep', 'deeper', 'deepest'), { recursive: true });
    writeFileSync(join(r, 'sub', 'deep', 'deeper', 'deepest', 'z.ts'), '// z\n');
    return r;
  }

  test('finds a file several directories deep -- the "**" recursing, not just scanning the top level', () => {
    root = buildTree();
    const found = expandEntry(`${root}/**/*.ts`);
    expect(found).toContain(join(root, 'sub', 'deep', 'deeper', 'deepest', 'z.ts'));
  });

  test('excludes a file with a different extension in the same tree', () => {
    root = buildTree();
    const found = expandEntry(`${root}/**/*.ts`);
    expect(found).not.toContain(join(root, 'b.md'));
    expect(found).not.toContain(join(root, 'sub', 'd.txt'));
  });

  test('excludes a file whose name merely CONTAINS the extension string rather than ending in it', () => {
    root = buildTree();
    const found = expandEntry(`${root}/**/*.ts`);
    expect(found).not.toContain(join(root, 'notes.ts.bak'));
  });

  test('an empty directory and a directory with only non-matching files: no throw, no matches, entry not silently dropped', () => {
    root = buildTree();
    // sub/empty and sub/onlymd contribute nothing, but must not throw and
    // must not stop the walk from reaching sub/deep below them.
    expect(() => expandEntry(`${root}/**/*.ts`)).not.toThrow();
    const found = expandEntry(`${root}/**/*.ts`);
    expect(found).toContain(join(root, 'sub', 'deep', 'deeper', 'deepest', 'z.ts'));
  });

  test('skips dot-files and node_modules regardless of extension', () => {
    root = buildTree();
    const found = expandEntry(`${root}/**/*.ts`);
    expect(found).not.toContain(join(root, '.hidden.ts'));
    expect(found).not.toContain(join(root, 'node_modules', 'ignored.ts'));
  });

  test(
    'EXACT COUNT for a known tree is 3, declared here rather than read off the ' +
      'current return value -- an expansion that quietly stops early (a directory it ' +
      'fails to recurse into, an off-by-one) must fail this test, not silently report ' +
      'a smaller green',
    () => {
      root = buildTree();
      const found = expandEntry(`${root}/**/*.ts`);
      expect(found.sort()).toEqual(
        [
          join(root, 'a.ts'),
          join(root, 'sub', 'c.ts'),
          join(root, 'sub', 'deep', 'deeper', 'deepest', 'z.ts'),
        ].sort(),
      );
    },
  );

  test('a literal (non-glob) entry resolves to exactly that one file, not expanded', () => {
    root = buildTree();
    const found = expandEntry(join(root, 'a.ts'));
    expect(found).toEqual([join(root, 'a.ts')]);
  });

  test('areaFiles de-duplicates across overlapping entries and sorts the result', () => {
    root = buildTree();
    const files = areaFiles({ files: [`${root}/**/*.ts`, join(root, 'a.ts')] });
    expect(files).toEqual(
      [
        join(root, 'a.ts'),
        join(root, 'sub', 'c.ts'),
        join(root, 'sub', 'deep', 'deeper', 'deepest', 'z.ts'),
      ].sort(),
    );
  });

  describe('unsupported glob shapes reject exactly the shapes they claim to, and nothing else', () => {
    test('rejects "<dir>/**/*." -- no extension after the dot', () => {
      root = buildTree();
      expect(() => expandEntry(`${root}/**/*.`)).toThrow(/unsupported glob shape/);
    });

    test('rejects "<dir>/**/*.<ext>/<more>" -- a path segment after the extension', () => {
      root = buildTree();
      expect(() => expandEntry(`${root}/**/*.ts/sub`)).toThrow(/unsupported glob shape/);
    });

    test('accepts the ordinary "<dir>/**/*.<ext>" shape', () => {
      root = buildTree();
      expect(() => expandEntry(`${root}/**/*.ts`)).not.toThrow();
    });

    test(
      'every entry in the REAL AREAS config parses without throwing -- written from the ' +
        "config's actual entries so this and AREAS cannot drift apart",
      () => {
        for (const area of AREAS) {
          for (const entry of area.files) {
            expect(() => expandEntry(entry)).not.toThrow();
          }
        }
      },
    );
  });
});
