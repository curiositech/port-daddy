/**
 * Fail-closed executability gate for the purser's authored test files.
 *
 * {@link import('./stacked-pr.js').validateStackedFiles} only checks that a path
 * is SAFE (no traversal, size caps). `ship.testPaths` (fleet.ts) only checks that
 * a path lives under an OPERATOR-DECLARED prefix in pd-fleet.yml. Neither one
 * checks that the target repo's OWN test runner would ever discover the file, or
 * that the file's imports resolve to something real.
 *
 * PR #5860 shipped five files at `tests/purser/test_*.js`: inside
 * `ship.testPaths` (`['tests/purser']`) and inside the path whitelist, but
 * OUTSIDE the repo's actual jest.config.js `testMatch`
 * (`tests/unit/**\/*.test.{js,ts}` and `tests/integration/**\/*.test.{js,ts}`)
 * and importing a nonexistent `../support` module. Jest would never have run
 * them; the purser retargeted the reviewed PR onto them anyway, and the PR body
 * admitted the tests were never executed.
 *
 * This module answers ONE question — "would the repo's configured test runner
 * ever execute this file, and does it load without a missing-module crash?" —
 * from EVIDENCE (the repo's real jest config + its real file tree at the PR's
 * base sha), never from the ship's own testPaths declaration. Unknown or
 * unfetchable evidence is a FAILURE, not a pass: the purser never retargets on a
 * gate it could not actually verify.
 */

import type { StackedFile } from './stacked-pr.js';

export type ExecutabilityResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      kind:
        | 'missing-discovery-evidence'
        | 'undiscoverable-path'
        | 'missing-tree-evidence'
        | 'unresolved-import';
      path?: string;
      specifier?: string;
    };

/** Jest config file names tried, in order, on the PR's BASE sha. */
export const JEST_CONFIG_CANDIDATES: readonly string[] = [
  'jest.config.js',
  'jest.config.cjs',
  'jest.config.mjs',
  'jest.config.ts',
];

/**
 * Extract every `testMatch: [...]` array literal from a jest.config.* source,
 * including ones nested inside a `projects: [...]` multi-project config (this
 * repo's own shape). The purpose is to learn discovery from the repo's own
 * configuration rather than from what a ship claims about itself.
 *
 * Regex, not a JS parser, by deliberate design: the config source is fetched from
 * the TRUSTED base ref, but `import()`/`eval()` of arbitrary repo JS inside the
 * executor would be a code-execution surface this module exists to avoid, not
 * add — a purely textual scan is the safer tool for the job.
 *
 * @param source raw text of a `jest.config.*` file, read from the PR's base ref
 * @returns Every glob string found across all `testMatch` occurrences, or null
 *          when the source contains none (caller must treat null as "cannot
 *          verify", not as "no restriction").
 */
export function extractJestTestMatch(source: string): string[] | null {
  const patterns: string[] = [];
  const re = /testMatch\s*:\s*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const inner = m[1];
    const strRe = /['"`]([^'"`]+)['"`]/g;
    let s: RegExpExecArray | null;
    while ((s = strRe.exec(inner))) patterns.push(s[1]);
  }
  return patterns.length > 0 ? patterns : null;
}

/**
 * Pull `.jest.testMatch` out of a package.json source, if present.
 *
 * The purpose is coverage of the second place a repo can declare test
 * discovery: plenty of projects carry no `jest.config.*` at all and configure
 * jest inline under the `jest` key of package.json. Reading only the config
 * file would make those repos look like "discovery configuration unknown",
 * which this gate treats as a rejection — correct as a fail-closed default, but
 * needlessly so when the answer is sitting in package.json. Parsing is strict
 * JSON (never `eval`) for the same reason the config scan is textual: the
 * executor must never execute repo-authored code.
 *
 * @param source raw text of a `package.json` from the PR's base ref
 * @returns the declared `jest.testMatch` globs, or null when the source is not
 *          valid JSON, has no `jest.testMatch` array, or that array holds no
 *          strings — all of which the caller must read as "unknown", never as
 *          "unrestricted"
 */
export function extractPackageJsonTestMatch(source: string): string[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch {
    return null;
  }
  const testMatch = (doc as { jest?: { testMatch?: unknown } } | null)?.jest?.testMatch;
  if (!Array.isArray(testMatch)) return null;
  const out = testMatch.filter((v): v is string => typeof v === 'string');
  return out.length > 0 ? out : null;
}

/**
 * Convert one jest `testMatch` glob into a RegExp.
 *
 * The design goal is a deliberately partial glob engine. It supports the subset jest
 * itself documents and this fleet's targets actually use: a leading
 * `<rootDir>/`, `**`, `*`, `?`, and brace alternation `{a,b}`. Anything this
 * function does not model is treated as a literal character rather than
 * throwing — a glob it cannot fully parse still narrows correctly on the parts
 * it does understand, which is enough for a rejection check (never a silent
 * pass on an unparseable pattern, since every OTHER pattern is still checked).
 *
 * @param glob one jest `testMatch` entry, optionally `<rootDir>/`-prefixed
 * @returns an anchored RegExp that a repo-relative POSIX path can be tested
 *          against
 */
export function globToRegExp(glob: string): RegExp {
  const stripped = glob.replace(/^<rootDir>\/?/, '');
  let out = '^';
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '*' && stripped[i + 1] === '*') {
      out += '.*';
      i++;
      if (stripped[i + 1] === '/') i++; // fold **/ into .* so it can match zero directories too
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{') {
      const close = stripped.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
      } else {
        const alts = stripped
          .slice(i + 1, close)
          .split(',')
          .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        out += `(?:${alts.join('|')})`;
        i = close;
      }
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  out += '$';
  return new RegExp(out);
}

/**
 * Would ANY of the repo's declared `testMatch` globs discover this path?
 *
 * The design intent is that discovery is a disjunction, not a conjunction: jest
 * runs a file if it matches at least one pattern, so a gate that demanded every
 * pattern match would reject files the runner would happily execute. Multi-
 * project configs (this repo's own shape) make that concrete — one project
 * claims `tests/unit/**`, another `tests/integration/**`, and a legitimate file
 * matches exactly one of them.
 *
 * @param path repo-relative POSIX path of an authored test file
 * @param patterns every `testMatch` glob gathered from the repo's real config
 * @returns true when at least one pattern matches, i.e. the real runner would
 *          find the file
 */
export function matchesAnyTestMatch(path: string, patterns: string[]): boolean {
  return patterns.some(p => globToRegExp(p).test(path));
}

/**
 * Pull every relative (`./` or `../`) import/require specifier out of a test
 * file's source — the ONLY imports this module verifies. The rationale for that
 * narrow scope: bare specifiers
 * (`from 'vitest'`) are package imports; resolving those would mean walking
 * node_modules, which is not this gate's job and is not what broke #5860.
 *
 * @param source the authored test file's contents
 * @returns the de-duplicated relative specifiers exactly as written (e.g.
 *          `'../support'`), in first-seen order
 */
export function extractRelativeImports(source: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /\brequire\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
    /\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g,
    /\bimport\s+['"](\.\.?\/[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) specs.add(m[1]);
  }
  return [...specs];
}

/**
 * POSIX-join a relative specifier against the directory of the importing file.
 *
 * Hand-rolled rather than `node:path` on purpose: this module runs inside a
 * Cloudflare Worker, where the repo tree is a set of forward-slash strings from
 * the GitHub trees API and never a real filesystem. Normalising `.`/`..` here
 * keeps the resolver platform-agnostic and keeps the comparison against those
 * API strings exact.
 *
 * @param fromPath repo-relative POSIX path of the importing file
 * @param spec a relative specifier from that file, e.g. `../support`
 * @returns the normalised repo-relative path the specifier points at, with no
 *          extension appended
 */
function joinRelative(fromPath: string, spec: string): string {
  const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const segments = `${fromDir}/${spec}`.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
];

/**
 * Every path this specifier could plausibly resolve to, from the importer.
 *
 * The rationale for enumerating candidates instead of resolving precisely is
 * that the executor has no module resolver — only a flat set of repo paths. So
 * the gate asks the weaker, safer question: does ANY plausible resolution of
 * this specifier exist in the tree? That biases toward accepting an import that
 * really is there under some extension, and only rejects when nothing by any
 * spelling exists, which is the #5860 failure (`../support` matched nothing at
 * all).
 *
 * @param fromPath repo-relative POSIX path of the importing file
 * @param spec the relative specifier written in that file
 * @returns candidate repo-relative paths — the bare join plus each supported
 *          extension and `index.*` form — to be tested for existence
 */
export function resolveImportCandidates(fromPath: string, spec: string): string[] {
  const joined = joinRelative(fromPath, spec);
  return RESOLVE_SUFFIXES.map(suf => `${joined}${suf}`);
}

export interface TrustedTreeImportRepair {
  files: StackedFile[];
  path: string;
  fromSpecifier: string;
  toSpecifier: string;
  matchedTreePath: string;
}

function relativeModuleSpecifier(fromPath: string, targetPath: string): string {
  const from = fromPath.split('/').slice(0, -1).filter(Boolean);
  const target = targetPath.split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) {
    common++;
  }
  const segments = [
    ...Array.from({ length: from.length - common }, () => '..'),
    ...target.slice(common),
  ];
  const relative = segments.join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function replaceImportSpecifier(source: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`(\\brequire\\(\\s*)(['"])${escaped}\\2(\\s*\\))`, 'g'),
    new RegExp(`(\\bfrom\\s+)(['"])${escaped}\\2()`, 'g'),
    new RegExp(`(\\bimport\\s+)(['"])${escaped}\\2()`, 'g'),
    new RegExp(`(\\bimport\\(\\s*)(['"])${escaped}\\2(\\s*\\))`, 'g'),
  ];
  return patterns.reduce(
    (text, pattern) => text.replace(
      pattern,
      (_match, prefix: string, quote: string, suffix: string) =>
        `${prefix}${quote}${to}${quote}${suffix}`,
    ),
    source,
  );
}

/**
 * Correct the common generated-test mistake where a relative import climbs the
 * wrong number of directories but otherwise names one exact root-relative file
 * in the trusted base tree.
 *
 * This is deliberately narrower than module resolution: stripping the leading
 * `./` and `../` segments must identify exactly one existing path (including
 * the same extension/index variants used by the executability gate). Ambiguous
 * or absent targets return null and leave the bounded model rewrite as the
 * fallback. The caller re-runs both path safety and executability afterward.
 */
export function repairMisrootedRelativeImport(
  files: StackedFile[],
  failure: ExecutabilityResult,
  repoTreePaths: Set<string> | null,
): TrustedTreeImportRepair | null {
  if (
    failure.ok ||
    failure.kind !== 'unresolved-import' ||
    !failure.path ||
    !failure.specifier ||
    !(repoTreePaths instanceof Set)
  ) {
    return null;
  }

  // Only repair the observed wrong-depth shape. A missing `./local` import may
  // be an omitted generated sibling, not an attempt to reach the repo root.
  if (!failure.specifier.startsWith('../')) return null;
  const rootRelative = failure.specifier.replace(/^(?:\.\.\/)+/, '');
  if (!rootRelative || rootRelative.split('/').some(segment => segment === '.' || segment === '..')) {
    return null;
  }
  const matches = [...new Set(
    RESOLVE_SUFFIXES
      .map(suffix => `${rootRelative}${suffix}`)
      .filter(candidate => repoTreePaths.has(candidate)),
  )];
  if (matches.length !== 1) return null;

  const toSpecifier = relativeModuleSpecifier(failure.path, rootRelative);
  if (toSpecifier === failure.specifier) return null;
  const filesAfter = files.map(file => {
    if (file.path !== failure.path) return file;
    return {
      ...file,
      contents: replaceImportSpecifier(file.contents, failure.specifier!, toSpecifier),
    };
  });
  const repaired = filesAfter.find(file => file.path === failure.path);
  const original = files.find(file => file.path === failure.path);
  if (!repaired || !original || repaired.contents === original.contents) return null;

  return {
    files: filesAfter,
    path: failure.path,
    fromSpecifier: failure.specifier,
    toSpecifier,
    matchedTreePath: matches[0],
  };
}

export interface ExecutabilityEvidence {
  /** testMatch glob patterns from the repo's real jest config, or null if unknown/unparseable. */
  testMatchPatterns: string[] | null;
  /** Every path in the repo tree at the PR's base sha, or null if unknown (fetch failed/truncated). */
  repoTreePaths: Set<string> | null;
}

/**
 * The gate itself: do these authored files live where the real test runner
 * would discover them, and do their relative imports resolve to something
 * real? FAILS CLOSED on missing evidence — a jest config or tree the executor
 * could not fetch/parse is a REJECTION, never a silent pass. The rationale for
 * that asymmetry: a gate whose evidence is missing has proven nothing, and the
 * purser must never spend a PR's base ref on a claim it did not verify.
 *
 * @param files the authored test files, path + contents, as they would be
 *              committed
 * @param evidence the target repo's OWN discovery config and file tree at the
 *                 PR's base sha; either field being null means "unverifiable"
 * @returns `{ ok: true }` only when every file is discoverable AND every
 *          relative import resolves; otherwise `{ ok: false, reason }` with an
 *          operator-readable reason naming the offending path
 */
export function checkGeneratedTestsExecutable(
  files: StackedFile[],
  evidence: ExecutabilityEvidence,
): ExecutabilityResult {
  if (!evidence.testMatchPatterns) {
    return {
      ok: false,
      kind: 'missing-discovery-evidence',
      reason:
        "the repo's test-discovery configuration (jest testMatch) could not be found or parsed — " +
        'cannot verify these files would ever be discovered and run',
    };
  }
  for (const f of files) {
    if (!matchesAnyTestMatch(f.path, evidence.testMatchPatterns)) {
      return {
        ok: false,
        kind: 'undiscoverable-path',
        path: f.path,
        reason:
          `${f.path} is outside the repo's configured test discovery path ` +
          `(testMatch: ${evidence.testMatchPatterns.join(', ')}) — the test runner would never find it`,
      };
    }
  }
  if (!evidence.repoTreePaths) {
    return {
      ok: false,
      kind: 'missing-tree-evidence',
      reason: "the repository file tree could not be fetched — cannot verify these files' imports resolve",
    };
  }
  const generatedPaths = new Set(files.map(f => f.path));
  for (const f of files) {
    for (const spec of extractRelativeImports(f.contents)) {
      const candidates = resolveImportCandidates(f.path, spec);
      const resolves = candidates.some(c => generatedPaths.has(c) || evidence.repoTreePaths!.has(c));
      if (!resolves) {
        return {
          ok: false,
          kind: 'unresolved-import',
          path: f.path,
          specifier: spec,
          reason: `${f.path} imports '${spec}', which does not resolve to any file in the repository or in this authored set`,
        };
      }
    }
  }
  return { ok: true };
}
