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
 * ever execute this file, is it a complete syntactically valid program, and
 * does it load without a missing-module crash?" —
 * from EVIDENCE (the repo's real jest config + its real file tree at the PR's
 * base sha), never from the ship's own testPaths declaration. Unknown or
 * unfetchable evidence is a FAILURE, not a pass: the purser never retargets on a
 * gate it could not actually verify.
 */

import { parse, type ParserPlugin } from '@babel/parser';
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
        | 'unresolved-import'
        | 'incompatible-runner'
        | 'missing-test-registration'
        | 'syntax-error';
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

/** Does the trusted package manifest put JavaScript in ESM mode? */
export function extractPackageTypeModule(source: string): boolean | null {
  let doc: unknown;
  try {
    doc = JSON.parse(source);
  } catch {
    return null;
  }
  const type = (doc as { type?: unknown } | null)?.type;
  return typeof type === 'string' ? type === 'module' : false;
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
 * narrow scope: resolving arbitrary package imports would mean walking
 * node_modules, which this Cloudflare-side gate cannot do. Known runner
 * mismatches are checked separately by `extractBareImports` against the
 * repository's trusted discovery configuration.
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

/** Bare package imports used by an authored test, in first-seen order. */
export function extractBareImports(source: string): string[] {
  const matches: Array<{ index: number; specifier: string }> = [];
  const patterns = [
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const specifier = m[1];
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        matches.push({ index: m.index, specifier });
      }
    }
  }
  matches.sort((a, b) => a.index - b.index);
  return [...new Set(matches.map(match => match.specifier))];
}

function maskJsTriviaAndStringText(source: string): string {
  const out = Array<string>(source.length).fill(' ');
  let mode: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'code';
  const templateExpressionDepth: number[] = [];

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (mode === 'line-comment') {
      if (ch === '\n') {
        out[i] = ch;
        mode = 'code';
      }
      continue;
    }
    if (mode === 'block-comment') {
      if (ch === '*' && next === '/') {
        i += 1;
        mode = 'code';
      }
      continue;
    }
    if (mode === 'single' || mode === 'double') {
      if (ch === '\\') {
        i += 1;
      } else if ((mode === 'single' && ch === "'") || (mode === 'double' && ch === '"')) {
        mode = 'code';
      }
      continue;
    }
    if (mode === 'template') {
      if (ch === '\\') {
        i += 1;
      } else if (ch === '`') {
        mode = 'code';
      } else if (ch === '$' && next === '{') {
        templateExpressionDepth.push(1);
        i += 1;
        mode = 'code';
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 1;
      mode = 'line-comment';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 1;
      mode = 'block-comment';
      continue;
    }
    if (ch === "'") {
      mode = 'single';
      continue;
    }
    if (ch === '"') {
      mode = 'double';
      continue;
    }
    if (ch === '`') {
      mode = 'template';
      continue;
    }
    if (templateExpressionDepth.length > 0 && ch === '{') {
      templateExpressionDepth[templateExpressionDepth.length - 1] += 1;
      out[i] = ch;
      continue;
    }
    if (templateExpressionDepth.length > 0 && ch === '}') {
      const top = templateExpressionDepth.length - 1;
      templateExpressionDepth[top] -= 1;
      if (templateExpressionDepth[top] === 0) {
        templateExpressionDepth.pop();
        mode = 'template';
      } else {
        out[i] = ch;
      }
      continue;
    }
    out[i] = ch;
  }
  return out.join('');
}

function usesUnboundDirname(source: string): boolean {
  const code = maskJsTriviaAndStringText(source);
  if (/\b(?:const|let|var)\s+__dirname\b/.test(code)) return false;
  return /\b__dirname\b/.test(code);
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
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.mts',
  '/index.cts',
  '/index.js',
  '/index.jsx',
];

/**
 * TypeScript ESM source intentionally imports the JavaScript path that will
 * exist after compilation. The trusted GitHub tree contains the source path,
 * though, so an explicit `./module.js` specifier must also be checked against
 * `./module.ts` / `./module.tsx` (and the equivalent NodeNext extensions).
 *
 * Keep this mapping exact. It is evidence that one runtime spelling maps to a
 * small set of source spellings, not permission to ignore an arbitrary file
 * extension or accept a same-basename file of an unrelated type.
 */
const RUNTIME_TO_SOURCE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

const SOURCE_OR_ASSET_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.json',
  '.wasm',
  '.node',
] as const;

function resolveJoinedCandidates(joined: string): string[] {
  for (const [runtimeExtension, sourceExtensions] of Object.entries(
    RUNTIME_TO_SOURCE_EXTENSIONS,
  )) {
    if (!joined.endsWith(runtimeExtension)) continue;
    const stem = joined.slice(0, -runtimeExtension.length);
    return [joined, ...sourceExtensions.map(extension => `${stem}${extension}`)];
  }
  if (SOURCE_OR_ASSET_EXTENSIONS.some(extension => joined.endsWith(extension))) {
    return [joined];
  }
  return RESOLVE_SUFFIXES.map(suffix => `${joined}${suffix}`);
}

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
  return resolveJoinedCandidates(joined);
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
 * the same extension/index variants used by the executability gate). When a
 * monorepo has multiple package-prefixed suffix matches, exactly one may be
 * selected only if it is also an exact path in the reviewed PR's changed-file
 * set. Both evidence sets must agree; ambiguous, absent, or untrusted hints
 * return null and leave the bounded model rewrite as the fallback. The caller
 * re-runs both path safety and executability afterward.
 */
export function repairMisrootedRelativeImport(
  files: StackedFile[],
  failure: ExecutabilityResult,
  repoTreePaths: Set<string> | null,
  prChangedPaths: ReadonlySet<string> = new Set(),
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
  const rootCandidates = resolveJoinedCandidates(rootRelative);
  const rootMatches = [...new Set(
    rootCandidates.filter(candidate => repoTreePaths.has(candidate)),
  )];
  const changedSuffixMatches = [...new Set(
    [...prChangedPaths].filter(changedPath =>
      repoTreePaths.has(changedPath) &&
      rootCandidates.some(candidate =>
        changedPath === candidate || changedPath.endsWith(`/${candidate}`),
      ),
    ),
  )];
  const matches = rootMatches.length === 1
    ? rootMatches
    : changedSuffixMatches.length === 1
      ? changedSuffixMatches
      : [];
  if (matches.length !== 1) return null;

  const toSpecifier = relativeModuleSpecifier(failure.path, matches[0]);
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
  /** Whether the trusted package.json sets `type: module`; null when unavailable. */
  packageTypeModule?: boolean | null;
}

function generatedTestParserPlugins(path: string): ParserPlugin[] {
  const lower = path.toLowerCase();
  const plugins: ParserPlugin[] = [];
  if (/\.(?:ts|tsx|mts|cts)$/.test(lower)) {
    plugins.push([
      'typescript',
      { disallowAmbiguousJSXLike: /\.(?:mts|cts)$/.test(lower) },
    ]);
  }
  if (/\.(?:jsx|tsx)$/.test(lower)) plugins.push('jsx');
  return plugins;
}

function generatedTestSourceType(path: string): 'module' | 'commonjs' | 'unambiguous' {
  const lower = path.toLowerCase();
  if (/\.(?:mjs|mts)$/.test(lower)) return 'module';
  if (/\.(?:cjs|cts)$/.test(lower)) return 'commonjs';
  return 'unambiguous';
}

/**
 * Parse one generated test as a complete program without executing it.
 *
 * This deliberately uses an established JavaScript parser rather than trying
 * to recognize invalid source with substrings. `errorRecovery` remains false,
 * so placeholder bodies, truncated excerpts, and any other syntax error fail
 * closed before sandbox or GitHub mutation code can observe the file.
 */
export function validateGeneratedTestSyntax(
  file: StackedFile,
): Extract<ExecutabilityResult, { ok: false }> | null {
  try {
    parse(file.contents, {
      sourceFilename: file.path,
      sourceType: generatedTestSourceType(file.path),
      plugins: generatedTestParserPlugins(file.path),
      errorRecovery: false,
      // Validation discards the AST, so do not spend cold-start CPU attaching
      // comments to nodes. Babel documents this as a material parse-speed win.
      attachComment: false,
    });
    return null;
  } catch (error) {
    const parserError = error as {
      reasonCode?: unknown;
      loc?: { line?: unknown; column?: unknown };
    };
    const rawReason = typeof parserError.reasonCode === 'string'
      ? parserError.reasonCode
      : 'parse-error';
    const reasonCode = rawReason.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'parse-error';
    const line = typeof parserError.loc?.line === 'number' ? parserError.loc.line : null;
    const column = typeof parserError.loc?.column === 'number' ? parserError.loc.column + 1 : null;
    const location = line !== null && column !== null ? ` at ${line}:${column}` : '';
    return {
      ok: false,
      kind: 'syntax-error',
      path: file.path,
      reason:
        `${file.path} is not a complete syntactically valid test program ` +
        `(${reasonCode}${location}) — Purser must repair its authored file before ` +
        'any sandbox execution, branch creation, stacked PR, or PR retarget',
    };
  }
}

type AstRecord = Record<string, unknown>;

function astRecord(value: unknown): AstRecord | null {
  return value !== null && typeof value === 'object'
    ? value as AstRecord
    : null;
}

function identifierName(value: unknown): string | null {
  const node = astRecord(value);
  return node?.type === 'Identifier' && typeof node.name === 'string'
    ? node.name
    : null;
}

function stringNodeValue(value: unknown): string | null {
  const node = astRecord(value);
  if (
    (node?.type === 'StringLiteral' || node?.type === 'Literal') &&
    typeof node.value === 'string'
  ) {
    return node.value;
  }
  return null;
}

function memberChain(value: unknown): { root: string; properties: string[] } | null {
  const node = astRecord(value);
  const direct = identifierName(node);
  if (direct) return { root: direct, properties: [] };
  if (node?.type !== 'MemberExpression' && node?.type !== 'OptionalMemberExpression') {
    return null;
  }
  const parent = memberChain(node.object);
  if (!parent) return null;
  const property = node.computed === true
    ? stringNodeValue(node.property)
    : identifierName(node.property);
  if (!property) return null;
  return { root: parent.root, properties: [...parent.properties, property] };
}

function walkAst(value: unknown, visit: (node: AstRecord) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) walkAst(entry, visit);
    return;
  }
  const node = astRecord(value);
  if (!node) return;
  if (typeof node.type === 'string') visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    walkAst(child, visit);
  }
}

function jestTestAliases(ast: unknown): Set<string> {
  const aliases = new Set(['it', 'test']);
  walkAst(ast, node => {
    if (
      node.type !== 'ImportDeclaration' ||
      stringNodeValue(node.source) !== '@jest/globals' ||
      !Array.isArray(node.specifiers)
    ) {
      return;
    }
    for (const value of node.specifiers) {
      const specifier = astRecord(value);
      if (specifier?.type !== 'ImportSpecifier') continue;
      const imported = identifierName(specifier.imported) ?? stringNodeValue(specifier.imported);
      const local = identifierName(specifier.local);
      if ((imported === 'it' || imported === 'test') && local) aliases.add(local);
    }
  });
  return aliases;
}

function isEachBuilder(value: unknown, aliases: ReadonlySet<string>): boolean {
  const node = astRecord(value);
  const target = node?.type === 'CallExpression' || node?.type === 'OptionalCallExpression'
    ? node.callee
    : node?.type === 'TaggedTemplateExpression'
      ? node.tag
      : null;
  const chain = memberChain(target);
  return chain !== null &&
    aliases.has(chain.root) &&
    chain.properties.length > 0 &&
    chain.properties.at(-1) === 'each' &&
    chain.properties.slice(0, -1).every(part =>
      part === 'concurrent' || part === 'only' || part === 'skip'
    );
}

function isJestTestRegistrationCallee(
  value: unknown,
  aliases: ReadonlySet<string>,
): boolean {
  const direct = identifierName(value);
  if (direct) return aliases.has(direct);
  if (isEachBuilder(value, aliases)) return true;

  const chain = memberChain(value);
  return chain !== null &&
    aliases.has(chain.root) &&
    chain.properties.length > 0 &&
    chain.properties.every(part =>
      part === 'concurrent' ||
      part === 'failing' ||
      part === 'only' ||
      part === 'skip' ||
      part === 'todo'
    );
}

/**
 * Prove that a generated Jest file registers at least one test case.
 *
 * A syntactically valid file is not necessarily a test. PR #9778 contained a
 * valid exported function declaration under Jest's testMatch path; Jest then
 * stopped with "Your test suite must contain at least one test" after Fleet
 * had already classified the sandbox exit as a product failure and retargeted
 * the reviewed PR. Parse the program and inspect call expressions so comments,
 * strings, and helper names cannot satisfy the gate by accident.
 */
export function hasJestTestRegistration(file: StackedFile): boolean {
  const ast = parse(file.contents, {
    sourceFilename: file.path,
    sourceType: generatedTestSourceType(file.path),
    plugins: generatedTestParserPlugins(file.path),
    errorRecovery: false,
    attachComment: false,
  });
  const aliases = jestTestAliases(ast);
  let found = false;
  walkAst(ast, node => {
    if (found) return;
    if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') return;
    if (isJestTestRegistrationCallee(node.callee, aliases)) found = true;
  });
  return found;
}

/**
 * The gate itself: do these authored files live where the real test runner
 * would discover them, parse as complete programs, and have relative imports
 * that resolve to something real? FAILS CLOSED on missing evidence — a jest config or tree the executor
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
  for (const f of files) {
    const syntaxFailure = validateGeneratedTestSyntax(f);
    if (syntaxFailure) return syntaxFailure;
  }
  const foreignRunnerImports = new Set(['bun:test', 'node:test', 'vitest']);
  for (const f of files) {
    const incompatible = extractBareImports(f.contents).find(specifier =>
      foreignRunnerImports.has(specifier),
    );
    if (incompatible) {
      return {
        ok: false,
        kind: 'incompatible-runner',
        path: f.path,
        specifier: incompatible,
        reason:
          `${f.path} imports '${incompatible}', but the trusted discovery configuration routes ` +
          `this file through Jest — the authored contract would fail in the runner before a test case executes`,
      };
    }
    if (evidence.packageTypeModule === true && usesUnboundDirname(f.contents)) {
      return {
        ok: false,
        kind: 'incompatible-runner',
        path: f.path,
        reason:
          `${f.path} uses __dirname without declaring it in a package with type=module — ` +
          `Jest would fail to load the authored contract before a test case executes`,
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
  // Preserve the more actionable import/runner diagnostics above: a file can
  // be both empty theater and unable to load, and the bounded repair loop
  // already knows how to heal those concrete loader failures. Once loading is
  // proven, require every authored testMatch file to register a real case.
  for (const f of files) {
    if (!hasJestTestRegistration(f)) {
      return {
        ok: false,
        kind: 'missing-test-registration',
        path: f.path,
        reason:
          `${f.path} is discoverable JavaScript but registers no Jest test or it case — ` +
          'the generated harness would fail before exercising the reviewed code, so Purser ' +
          'must repair its authored file before sandbox execution, branch creation, stacked PR, or PR retarget',
      };
    }
  }
  return { ok: true };
}
