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

export type ExecutabilityResult = { ok: true } | { ok: false; reason: string };

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
 * repo's own shape). Regex, not a JS parser: the config source is fetched from
 * the TRUSTED base ref, but `import()`/`eval()` of arbitrary repo JS inside the
 * executor would be a code-execution surface this module exists to avoid, not
 * add — a purely textual scan is the safer tool for the job.
 *
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

/** Pull `.jest.testMatch` out of a package.json source, if present. */
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
 * Convert one jest `testMatch` glob into a RegExp. Supports the subset jest
 * itself documents and this fleet's targets actually use: a leading
 * `<rootDir>/`, `**`, `*`, `?`, and brace alternation `{a,b}`. Anything this
 * function does not model is treated as a literal character rather than
 * throwing — a glob it cannot fully parse still narrows correctly on the parts
 * it does understand, which is enough for a rejection check (never a silent
 * pass on an unparseable pattern, since every OTHER pattern is still checked).
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

export function matchesAnyTestMatch(path: string, patterns: string[]): boolean {
  return patterns.some(p => globToRegExp(p).test(path));
}

/**
 * Pull every relative (`./` or `../`) import/require specifier out of a test
 * file's source — the ONLY imports this module verifies. Bare specifiers
 * (`from 'vitest'`) are package imports; resolving those would mean walking
 * node_modules, which is not this gate's job and is not what broke #5860.
 */
export function extractRelativeImports(source: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /\brequire\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
    /\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g,
    /\bimport\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) specs.add(m[1]);
  }
  return [...specs];
}

/** POSIX-join a relative specifier against the directory of the importing file. */
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

/** Every path this specifier could plausibly resolve to, from the importer. */
export function resolveImportCandidates(fromPath: string, spec: string): string[] {
  const joined = joinRelative(fromPath, spec);
  return RESOLVE_SUFFIXES.map(suf => `${joined}${suf}`);
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
 * could not fetch/parse is a REJECTION, never a silent pass.
 */
export function checkGeneratedTestsExecutable(
  files: StackedFile[],
  evidence: ExecutabilityEvidence,
): ExecutabilityResult {
  if (!evidence.testMatchPatterns) {
    return {
      ok: false,
      reason:
        "the repo's test-discovery configuration (jest testMatch) could not be found or parsed — " +
        'cannot verify these files would ever be discovered and run',
    };
  }
  for (const f of files) {
    if (!matchesAnyTestMatch(f.path, evidence.testMatchPatterns)) {
      return {
        ok: false,
        reason:
          `${f.path} is outside the repo's configured test discovery path ` +
          `(testMatch: ${evidence.testMatchPatterns.join(', ')}) — the test runner would never find it`,
      };
    }
  }
  if (!evidence.repoTreePaths) {
    return {
      ok: false,
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
          reason: `${f.path} imports '${spec}', which does not resolve to any file in the repository or in this authored set`,
        };
      }
    }
  }
  return { ok: true };
}
