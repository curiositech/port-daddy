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
import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import {
  ALLOWED_BINARY_SOURCE,
  TEXT_EXTENSIONS,
  checkTextAttributes,
  declaredExtensions,
  findNulOffenders,
  trackedSourceFiles,
} from '../../scripts/lib/source-is-text.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// These are captured tool bytes, not maintained source. Keep the exceptions
// exact and attach executable probes: merely dropping every path-scoped rule
// from `unparsed` would let a future source declaration evade the NUL guard.
const EVIDENCE_ROOT = 'docs/harbor-research/campaigns/2026-11-06';
const CAPTURED_EVIDENCE_PROBES = new Map([
  [`${EVIDENCE_ROOT}/**/*.stdout`, { name: 'probe.stdout', matches: (name) => name.endsWith('.stdout') }],
  [`${EVIDENCE_ROOT}/**/*.stderr`, { name: 'probe.stderr', matches: (name) => name.endsWith('.stderr') }],
  [`${EVIDENCE_ROOT}/**/*.log`, { name: 'probe.log', matches: (name) => name.endsWith('.log') }],
  [`${EVIDENCE_ROOT}/**/*_TTrace_*.tla`, {
    name: 'AdmissionRevision_TTrace_123.tla',
    matches: (name) => /^.*_TTrace_.*\.tla$/.test(name),
  }],
]);

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
    const { declared, unparsed: pathScoped } = declaredExtensions(REPO_ROOT);
    // Only these four exact rules have the separate, path-aware assertions
    // below. Every other unsupported pattern still fails closed.
    const unparsed = pathScoped.filter((pattern) => !CAPTURED_EVIDENCE_PROBES.has(pattern));

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

  test('captured evidence preserves bytes only within its declared path scope', () => {
    const { unparsed } = declaredExtensions(REPO_ROOT);
    expect(unparsed).toEqual(expect.arrayContaining([...CAPTURED_EVIDENCE_PROBES.keys()]));

    const tracked = execFileSync('git', ['ls-files', '-z', '--', `${EVIDENCE_ROOT}/`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).split('\0').filter(Boolean);
    const attrsToCheck = ['text', 'diff', 'merge', 'whitespace'];
    const outside = [];

    for (const { name, matches } of CAPTURED_EVIDENCE_PROBES.values()) {
      const real = tracked.filter((path) => matches(basename(path)));
      // Exercise real frozen files too; an empty or wrong scope must not pass
      // just because a synthetic spelling happens to match a glob.
      expect(real.length).toBeGreaterThan(0);
      const probes = [...real, ...['', '__attribute_probe__/', '__attribute_probe__/nested/']
        .map((dir) => `${EVIDENCE_ROOT}/${dir}${name}`)];
      const attrs = checkTextAttributes(probes, attrsToCheck, REPO_ROOT);
      for (const path of probes) {
        expect({ path, ...attrs[path] }).toEqual({
          path, text: 'unset', diff: 'unspecified', merge: 'unspecified',
          whitespace: '-blank-at-eol,-blank-at-eof',
        });
      }
      outside.push(
        `__attribute_probe__/${name}`,
        `docs/harbor-research/campaigns/__attribute_probe__/${name}`,
        `${EVIDENCE_ROOT}-other/nested/${name}`,
      );
    }

    // Maintained models and near-miss trace names must not inherit the frozen
    // output rule. Nor may the exceptions become extension-wide elsewhere.
    const unaffected = [...outside,
      `${EVIDENCE_ROOT}/models/AdmissionRevision.tla`,
      `${EVIDENCE_ROOT}/models/AdmissionRevision_TTrace.tla`,
      `${EVIDENCE_ROOT}/models/AdmissionRevision_TTrace_123.tla.bak`,
    ];
    const unaffectedAttrs = checkTextAttributes(unaffected, attrsToCheck, REPO_ROOT);
    for (const path of unaffected) {
      expect({ path, ...unaffectedAttrs[path] }).toEqual({
        path, text: 'unspecified', diff: 'unspecified', merge: 'unspecified',
        whitespace: 'unspecified',
      });
    }

    // Every guarded source extension remains text even alongside captured
    // evidence; this supplements (and does not shrink) the repo-wide NUL scan.
    const source = TEXT_EXTENSIONS.map((ext) => `${EVIDENCE_ROOT}/__attribute_probe__/probe.${ext}`);
    const sourceAttrs = checkTextAttributes(source, attrsToCheck, REPO_ROOT);
    for (const path of source) {
      expect({ path, ...sourceAttrs[path] }).toEqual({
        path, text: 'set', diff: 'set', merge: 'set', whitespace: 'unspecified',
      });
    }
  });

  test('the published facing PDF is binary for text conversion, diff and merge', () => {
    const path = 'website-v2/public/whitepaper/coordination-papers-mega-volume-spreads.pdf';
    const attrs = checkTextAttributes([path], ['text', 'diff', 'merge'], REPO_ROOT);
    expect(attrs[path]).toEqual({ text: 'unset', diff: 'unset', merge: 'unset' });
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

  test('an allowlist entry actually removes a file from the scan', () => {
    // The emptiness assertion above says the escape hatch is UNUSED. This one
    // says it WORKS. Both matter: an allowlist that silently fails to exclude
    // would send someone chasing a file the guard claims to have skipped, and
    // the filter is a single `.has()` that nothing else covers.
    //
    // Mutates the shared Set, so the restore is in a finally — otherwise a
    // failure here would leave the allowlist dirty and make the emptiness test
    // above fail for the wrong reason, depending on execution order.
    const victim = trackedSourceFiles(REPO_ROOT)[0];
    expect(typeof victim).toBe('string');

    ALLOWED_BINARY_SOURCE.add(victim);
    try {
      expect(trackedSourceFiles(REPO_ROOT)).not.toContain(victim);
    } finally {
      ALLOWED_BINARY_SOURCE.delete(victim);
    }

    expect(trackedSourceFiles(REPO_ROOT)).toContain(victim);
    expect([...ALLOWED_BINARY_SOURCE]).toEqual([]);
  });
});
