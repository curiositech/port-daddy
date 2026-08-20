import { describe, it, expect } from 'vitest';
import {
  extractJestTestMatch,
  extractPackageJsonTestMatch,
  globToRegExp,
  matchesAnyTestMatch,
  extractRelativeImports,
  resolveImportCandidates,
  checkGeneratedTestsExecutable,
  JEST_CONFIG_CANDIDATES,
} from '../src/purser-executability.js';

describe('extractJestTestMatch', () => {
  it('extracts a single top-level testMatch array', () => {
    const src = "module.exports = { testMatch: ['<rootDir>/tests/**/*.test.js'] };";
    expect(extractJestTestMatch(src)).toEqual(['<rootDir>/tests/**/*.test.js']);
  });

  it('extracts EVERY testMatch occurrence, including nested inside projects: [...] (this repo\'s real shape)', () => {
    const src = [
      'export default {',
      '  projects: [',
      "    { displayName: 'unit', testMatch: ['<rootDir>/tests/unit/**/*.test.{js,ts}'] },",
      "    { displayName: 'integration', testMatch: ['<rootDir>/tests/integration/**/*.test.{js,ts}'] },",
      '  ],',
      '};',
    ].join('\n');
    expect(extractJestTestMatch(src)).toEqual([
      '<rootDir>/tests/unit/**/*.test.{js,ts}',
      '<rootDir>/tests/integration/**/*.test.{js,ts}',
    ]);
  });

  it('returns null when no testMatch is present', () => {
    expect(extractJestTestMatch('module.exports = { testEnvironment: "node" };')).toBeNull();
  });
});

describe('extractPackageJsonTestMatch', () => {
  it('reads jest.testMatch from a valid package.json', () => {
    const src = JSON.stringify({ name: 'x', jest: { testMatch: ['<rootDir>/t/**/*.test.js'] } });
    expect(extractPackageJsonTestMatch(src)).toEqual(['<rootDir>/t/**/*.test.js']);
  });

  it('returns null on invalid JSON or a missing/malformed jest.testMatch', () => {
    expect(extractPackageJsonTestMatch('{ broken')).toBeNull();
    expect(extractPackageJsonTestMatch('{}')).toBeNull();
    expect(extractPackageJsonTestMatch(JSON.stringify({ jest: {} }))).toBeNull();
    expect(extractPackageJsonTestMatch(JSON.stringify({ jest: { testMatch: 'not-an-array' } }))).toBeNull();
  });
});

describe('globToRegExp / matchesAnyTestMatch', () => {
  it('matches the real port-daddy jest testMatch shape', () => {
    const patterns = [
      '<rootDir>/tests/unit/**/*.test.{js,ts}',
      '<rootDir>/tests/integration/**/*.test.{js,ts}',
    ];
    expect(matchesAnyTestMatch('tests/unit/widget.test.ts', patterns)).toBe(true);
    expect(matchesAnyTestMatch('tests/unit/nested/deep/widget.test.js', patterns)).toBe(true);
    expect(matchesAnyTestMatch('tests/integration/flow.test.ts', patterns)).toBe(true);
  });

  it('rejects the exact #5860 shape: tests/purser/** is not under tests/unit/** or tests/integration/**', () => {
    const patterns = [
      '<rootDir>/tests/unit/**/*.test.{js,ts}',
      '<rootDir>/tests/integration/**/*.test.{js,ts}',
    ];
    expect(matchesAnyTestMatch('tests/purser/test_error-handling.js', patterns)).toBe(false);
    expect(matchesAnyTestMatch('tests/purser/widget.contract.test.ts', patterns)).toBe(false);
  });

  it('a bare "*" only matches within one path segment', () => {
    const re = globToRegExp('tests/*.test.js');
    expect(re.test('tests/a.test.js')).toBe(true);
    expect(re.test('tests/nested/a.test.js')).toBe(false);
  });

  it('brace alternation expands correctly', () => {
    const re = globToRegExp('a.{js,ts}');
    expect(re.test('a.js')).toBe(true);
    expect(re.test('a.ts')).toBe(true);
    expect(re.test('a.jsx')).toBe(false);
  });
});

describe('extractRelativeImports', () => {
  it('finds require(), import ... from, and dynamic import() specifiers', () => {
    const src = [
      "const a = require('../support');",
      "import { b } from './helpers.js';",
      "const c = await import('../../lib/x.js');",
      "import 'vitest';", // bare specifier — not relative, must not be captured
    ].join('\n');
    expect(extractRelativeImports(src)).toEqual(
      expect.arrayContaining(['../support', './helpers.js', '../../lib/x.js']),
    );
    expect(extractRelativeImports(src)).not.toContain('vitest');
  });

  it('returns [] for content with no relative imports (the common case)', () => {
    expect(extractRelativeImports('it("frobs empty input", () => {});')).toEqual([]);
  });
});

describe('resolveImportCandidates', () => {
  it('resolves ../support from tests/purser/x.test.js to tests/support(.ext)', () => {
    const candidates = resolveImportCandidates('tests/purser/x.test.js', '../support');
    expect(candidates).toContain('tests/support');
    expect(candidates).toContain('tests/support.js');
    expect(candidates).toContain('tests/support.ts');
  });

  it('resolves ./helpers from tests/unit/x.test.js to tests/unit/helpers(.ext)', () => {
    const candidates = resolveImportCandidates('tests/unit/x.test.js', './helpers');
    expect(candidates).toContain('tests/unit/helpers');
    expect(candidates).toContain('tests/unit/helpers.ts');
  });
});

describe('checkGeneratedTestsExecutable — the gate', () => {
  const files = [
    {
      path: 'tests/purser/test_error-handling.js',
      contents: "const { isRetryable } = require('../support');\nit('x', () => {});",
    },
  ];
  const realJestPatterns = [
    '<rootDir>/tests/unit/**/*.test.{js,ts}',
    '<rootDir>/tests/integration/**/*.test.{js,ts}',
  ];

  it('#5860 reproduction: fails on the discovery-path check before even looking at imports', () => {
    const result = checkGeneratedTestsExecutable(files, {
      testMatchPatterns: realJestPatterns,
      repoTreePaths: new Set(['tests/support.js']), // import WOULD resolve...
    });
    // ...but the path check runs first and rejects regardless.
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("outside the repo's configured test discovery path"),
    });
  });

  it('fails closed when testMatch evidence is unknown (null), even for a plausible path', () => {
    const result = checkGeneratedTestsExecutable(
      [{ path: 'tests/unit/widget.test.js', contents: 'it("x", () => {});' }],
      { testMatchPatterns: null, repoTreePaths: new Set() },
    );
    expect(result.ok).toBe(false);
  });

  it('fails closed when the repo tree is unknown (null), even for a discoverable path with no imports', () => {
    const result = checkGeneratedTestsExecutable(
      [{ path: 'tests/unit/widget.test.js', contents: 'it("x", () => {});' }],
      { testMatchPatterns: realJestPatterns, repoTreePaths: null },
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining('file tree could not be fetched') });
  });

  it('a relative import resolving to ANOTHER generated file (not just the repo tree) is accepted', () => {
    // Both paths individually satisfy testMatch — the gate applies the same
    // discovery-path requirement to every authored file (the purser's contract
    // is "author tests", not "author tests plus untested helper modules"), so
    // this fixture only isolates cross-generated-file IMPORT resolution.
    const twoFiles = [
      { path: 'tests/unit/widget.test.js', contents: "require('./shared.test.js');" },
      { path: 'tests/unit/shared.test.js', contents: 'module.exports = {};' },
    ];
    const result = checkGeneratedTestsExecutable(twoFiles, {
      testMatchPatterns: realJestPatterns,
      repoTreePaths: new Set(), // empty — resolution must come from the authored set itself
    });
    expect(result).toEqual({ ok: true });
  });

  it('a discoverable file with no relative imports and a known (even empty) tree passes', () => {
    const result = checkGeneratedTestsExecutable(
      [{ path: 'tests/unit/widget.test.js', contents: 'it("x", () => {});' }],
      { testMatchPatterns: realJestPatterns, repoTreePaths: new Set() },
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('JEST_CONFIG_CANDIDATES', () => {
  it('is a non-empty list of plausible jest config filenames', () => {
    expect(JEST_CONFIG_CANDIDATES.length).toBeGreaterThan(0);
    expect(JEST_CONFIG_CANDIDATES).toContain('jest.config.js');
  });
});
