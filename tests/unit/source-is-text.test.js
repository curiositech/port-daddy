/**
 * CI regiment: every tracked source file stays TEXT to git, repo-wide.
 *
 * The invariant itself — why a raw NUL is catastrophic and silent, why
 * `.gitattributes` cannot rescue a NUL'd file, why the scan is driven off
 * `git ls-files`, and what to do when this fails — is documented on
 * scripts/lib/source-is-text.mjs, which holds the primitives these tests
 * drive. Read that header first; this file is only the assertions.
 *
 * Asserted as a test rather than a lint rule because the failure mode is that
 * tooling goes quiet, and a linter is tooling.
 *
 * The failure messages below are the teaching surface: a contributor meets
 * this guard by tripping it, so each one names the consequence and the fix
 * rather than just reporting a boolean. Keep them that way.
 */
import { describe, test, expect } from '@jest/globals';
import { resolve } from 'node:path';
import {
  ALLOWED_BINARY_SOURCE,
  TEXT_EXTENSIONS,
  checkTextAttributes,
  declaredExtensions,
  findNulOffenders,
  trackedSourceFiles,
} from '../../scripts/lib/source-is-text.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

describe('source stays text, greppable, and mergeable', () => {
  test('no tracked source file contains a raw NUL byte', () => {
    const files = trackedSourceFiles(REPO_ROOT);

    // Sanity: if this ever collapses to a handful, the guard has gone blind
    // (bad pattern list, wrong cwd) and would pass vacuously.
    expect(files.length).toBeGreaterThan(500);

    const offenders = findNulOffenders(files, REPO_ROOT);

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
    const files = trackedSourceFiles(REPO_ROOT);

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

    const attrs = checkTextAttributes(sample, ['text', 'diff', 'merge'], REPO_ROOT);

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

  test('.gitattributes declares no source extension the guard does not cover', () => {
    // The other direction of the lockstep. `TEXT_EXTENSIONS` drives which files
    // get scanned for NULs, so an extension declared in .gitattributes but
    // absent here is a file type git is told to treat as text while nothing
    // checks whether it actually is.
    const { declared, unparsed } = declaredExtensions(REPO_ROOT);

    const guarded = new Set(TEXT_EXTENSIONS);
    const declaredNotGuarded = [...declared].filter((e) => !guarded.has(e)).sort();
    const guardedNotDeclared = [...guarded].filter((e) => !declared.has(e)).sort();

    if (declaredNotGuarded.length > 0 || guardedNotDeclared.length > 0 || unparsed.length > 0) {
      throw new Error(
        `.gitattributes and TEXT_EXTENSIONS have drifted apart.\n` +
          (declaredNotGuarded.length
            ? `  Declared in .gitattributes but NOT scanned for NULs: ${declaredNotGuarded.join(', ')}\n` +
              `    -> add them to TEXT_EXTENSIONS, or stop declaring them text.\n`
            : '') +
          (guardedNotDeclared.length
            ? `  In TEXT_EXTENSIONS but NOT declared in .gitattributes: ${guardedNotDeclared.join(', ')}\n` +
              `    -> add the pattern line, or drop them from TEXT_EXTENSIONS.\n`
            : '') +
          (unparsed.length
            ? `  Pattern(s) this test cannot map to an extension: ${unparsed.join(', ')}\n` +
              `    -> the synthetic probe path above assumes bare *.ext patterns; a\n` +
              `       path-scoped rule needs a real file in that path to probe honestly.\n`
            : ''),
      );
    }

    expect({ declaredNotGuarded, guardedNotDeclared, unparsed }).toEqual({
      declaredNotGuarded: [], guardedNotDeclared: [], unparsed: [],
    });
  });

  test('the binary-source allowlist is still empty', () => {
    // Extracting the scan into scripts/lib/source-is-text.mjs turned this
    // allowlist from a module-private const in a test file into an exported
    // Set. That is a hole the refactor opened: anyone can now add a path and
    // silently drop a file from the NUL scan, and every other test here would
    // stay green while doing it.
    //
    // An escape hatch nobody watches is the same shape as the guard this whole
    // change replaced -- correct, and quietly unreachable. So the emptiness is
    // asserted rather than assumed. Adding an entry is not forbidden; it just
    // has to be argued for in review by editing this test too, with the path
    // AND the reason on the line.
    expect([...ALLOWED_BINARY_SOURCE]).toEqual([]);
  });
});
