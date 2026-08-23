/**
 * CI regiment: every tracked source file stays TEXT to git, repo-wide.
 *
 * WHY: a literal NUL byte in a source file is legal TypeScript/JavaScript and
 * compiles fine, so nothing catches it — but git classifies any blob with a
 * NUL in its first 8000 bytes as BINARY, and every consequence is silent:
 *
 *   - ripgrep prints `binary file matches (found "\0" byte around offset N)`
 *     with no line numbers and no content. To an agent navigating the repo by
 *     search, that is indistinguishable from "this symbol is used nowhere" —
 *     `rg createSuggestions lib/suggestions.ts` hid three real hits this way.
 *   - The three-way merge driver takes one side WHOLESALE instead of merging
 *     hunks. In 47964247a that silently discarded #9352's ADR-0086 planner
 *     columns from lib/roadmap-items.ts: no conflict marker, green build,
 *     work gone. Recovery took a hand-run `git merge-file` (2dcd80f9f).
 *   - Without `.gitattributes` saying otherwise, `git diff` degrades to
 *     `Bin 7463 -> 9147 bytes` and `git blame` has nothing to attribute.
 *
 * `.gitattributes` sets `text diff` and fixes the READING half. Nothing in
 * `.gitattributes` fixes the MERGE half — the binary check sits inside git's
 * built-in merge driver, ahead of the attribute (measured: `text diff`,
 * `text diff merge`, `merge=union`, and a custom driver all still refuse).
 * So NOT WRITING THE NUL is the only real defence, and this test is it.
 *
 * THE FIX when this test fails: replace the raw NUL with the six-character
 * source escape `\u0000`. The runtime string is byte-identical — only the
 * bytes on disk change — so sentinel/join semantics are completely unaffected.
 *
 * SCOPE: driven off `git ls-files` rather than a directory walk, so the
 * guard's notion of "source" is exactly git's. A hand-rolled walk has to
 * enumerate directories, and the previous incarnation of this test (in
 * apps/fleet-executor) only ever looked at two of them — every offender that
 * shipped lived outside its scope. Anything git tracks with an extension
 * `.gitattributes` calls text is covered here, with no directory list to
 * forget to update.
 *
 * Asserted as a test rather than a lint rule because the failure mode is that
 * tooling goes quiet, and a linter is tooling.
 */
import { describe, test, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// Kept in lockstep with the pattern list in .gitattributes. A mismatch is
// caught by the attribute test below, which asserts every extension here is
// actually declared text/diff/merge.
const TEXT_EXTENSIONS = ['ts', 'tsx', 'js', 'mjs', 'cjs', 'rs', 'json'];

/**
 * Tracked files that legitimately contain a raw NUL despite carrying a source
 * extension — a fixture that must hold real binary bytes, say.
 *
 * EMPTY ON PURPOSE. Every tracked source file in this repo is NUL-free, and a
 * genuine exception should be rare enough to argue for in review. If you add
 * one, give the path AND the reason on the same line, and prefer a `.bin`
 * fixture (which these patterns do not cover) over an entry here.
 */
const ALLOWED_BINARY_SOURCE = new Set([]);

function trackedSourceFiles() {
  const patterns = TEXT_EXTENSIONS.map((e) => `*.${e}`);
  const out = execFileSync('git', ['ls-files', '-z', '--', ...patterns], {
    cwd: REPO_ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((f) => !ALLOWED_BINARY_SOURCE.has(f));
}

/** Batch `git check-attr` over many paths; returns { path: { attr: value } }. */
function checkAttrs(paths, attrs) {
  // `input` must be a Buffer: passing a string alongside a 'buffer' encoding
  // makes Node try Buffer.from(str, 'buffer') and throw "Unknown encoding".
  const stdin = Buffer.from(paths.join('\0') + '\0', 'utf8');
  const raw = execFileSync('git', ['check-attr', '-z', '--stdin', ...attrs], {
    cwd: REPO_ROOT,
    input: stdin,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8');

  // -z output is a flat NUL-delimited stream of (path, attr, value) triples.
  const fields = raw.split('\0').filter((s) => s !== '');
  const result = {};
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const [path, attr, value] = [fields[i], fields[i + 1], fields[i + 2]];
    (result[path] ??= {})[attr] = value;
  }
  return result;
}

describe('source stays text, greppable, and mergeable', () => {
  test('no tracked source file contains a raw NUL byte', () => {
    const files = trackedSourceFiles();

    // Sanity: if this ever collapses to a handful, the guard has gone blind
    // (bad pattern list, wrong cwd) and would pass vacuously.
    expect(files.length).toBeGreaterThan(500);

    const offenders = files.filter((f) => {
      let buf;
      try {
        buf = readFileSync(resolve(REPO_ROOT, f));
      } catch {
        return false; // tracked but absent (sparse checkout / mid-rebase)
      }
      return buf.includes(0);
    });

    if (offenders.length > 0) {
      throw new Error(
        `Found ${offenders.length} tracked source file(s) containing a literal NUL byte:\n` +
          offenders.map((f) => `  ${f}`).join('\n') +
          `\n\n` +
          `git classifies these as BINARY. ripgrep will report "binary file\n` +
          `matches" instead of the matching lines — which reads exactly like\n` +
          `"this symbol is unused" — and a 3-way merge will take one side\n` +
          `WHOLESALE and silently drop the other (that cost us #9352's planner\n` +
          `columns in 47964247a).\n\n` +
          `FIX: replace each raw NUL with the six-character source escape\n` +
          `\\u0000. The runtime string is byte-identical; only the bytes on\n` +
          `disk change, so sentinel/join semantics are unaffected.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test('.gitattributes keeps text, diff and merge set for every source extension', () => {
    const files = trackedSourceFiles();

    // Sample one real tracked file per extension, chosen from git's own list
    // so the assertion follows the tree instead of pinning paths that move.
    // Extensions with no tracked files today (.cjs) still get checked via a
    // synthetic path — check-attr is pure pattern matching and does not
    // require the file to exist, so coverage does not lapse when a file type
    // temporarily has zero members.
    const sample = [];
    for (const ext of TEXT_EXTENSIONS) {
      const real = files.find((f) => f.endsWith(`.${ext}`));
      sample.push(real ?? `__attribute_probe__/probe.${ext}`);
    }

    const attrs = checkAttrs(sample, ['text', 'diff', 'merge']);

    const broken = [];
    for (const path of sample) {
      for (const attr of ['text', 'diff', 'merge']) {
        const value = attrs[path]?.[attr];
        if (value !== 'set') broken.push(`${path}: ${attr}=${value ?? '<missing>'}`);
      }
    }

    if (broken.length > 0) {
      throw new Error(
        `.gitattributes no longer declares text/diff/merge for every source\n` +
          `extension. Offending probes:\n` +
          broken.map((b) => `  ${b}`).join('\n') +
          `\n\n` +
          `Every extension in TEXT_EXTENSIONS (${TEXT_EXTENSIONS.map((e) => '.' + e).join(' ')})\n` +
          `must resolve all three as "set".\n` +
          `  text/diff — keep \`git diff\` and \`git blame\` readable rather than\n` +
          `              degrading to "Bin 7463 -> 9147 bytes" if a NUL slips in.\n` +
          `  merge     — pin git's built-in TEXT merge driver, so a local\n` +
          `              \`merge.default\` cannot silently redirect these files to\n` +
          `              the binary driver and drop one side of a merge.\n` +
          `Restore the attribute list in .gitattributes; do not relax it.`,
      );
    }
    expect(broken).toEqual([]);
  });
});
