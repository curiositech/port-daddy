/**
 * Regression test for scripts/lint/check-banned-phrases.mjs — the mechanized
 * half of the author's standing rule: "held to account" and "load-bearing"
 * (also "load bearing") are never written anywhere in this repository's prose.
 *
 * Covers: a hit in an in-scope file fails the gate; a hit in an excluded path
 * (CHANGELOG history, tests/, formal-model files, etc.) is ignored; matching
 * is case-insensitive; and the committed tree itself passes.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadConfig,
  globToRegExp,
  matchesAny,
  resolveTargets,
  findHits,
} from '../../scripts/lint/check-banned-phrases.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'lint', 'check-banned-phrases.mjs');
const fixture = (name) => join(repo, 'tests', 'fixtures', 'banned-phrases', name);

/** Run the guard; return { code, stdout, stderr }. */
function run(...args) {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('check-banned-phrases config and glob matching', () => {
  const config = loadConfig();

  test('config carries the exact two-phrase (three-string) banned list', () => {
    expect(config.phrases.map((p) => p.toLowerCase()).sort()).toEqual(
      ['held to account', 'load bearing', 'load-bearing'].sort(),
    );
  });

  test('globToRegExp handles **, *, and {a,b,c} the config actually uses', () => {
    expect(globToRegExp('skills/**').test('skills/foo/bar/SKILL.md')).toBe(true);
    expect(globToRegExp('docs/**/*.md').test('docs/adr/0001-x.md')).toBe(true);
    expect(globToRegExp('docs/**/*.md').test('docs/adr/0001-x.tex')).toBe(false);
    expect(globToRegExp('*.md').test('AGENTS.md')).toBe(true);
    expect(globToRegExp('*.md').test('docs/AGENTS.md')).toBe(false);
    expect(globToRegExp('website-v2/src/**/*.{ts,tsx,md,mdx}').test('website-v2/src/data/examples.ts')).toBe(true);
    expect(globToRegExp('website-v2/src/**/*.{ts,tsx,md,mdx}').test('website-v2/src/data/examples.json')).toBe(false);
  });

  test('in-scope paths from the task spec match the configured include globs', () => {
    const inScope = [
      'skills/some-skill/SKILL.md',
      'skills/some-skill/scripts/audit.mjs',
      'docs/adr/0100-example.md',
      'AGENTS.md',
      '.github/PULL_REQUEST_TEMPLATE.md',
      '.github/workflows/foo.md',
      'website-v2/src/pages/Foo.tsx',
      'website-v2/public/llms.txt',
      'whitepaper/single-writer-kernel.tex',
      'website-v2/public/whitepaper/single-writer-kernel.tex',
      'docs/harbor-research/tex/paper1.tex',
      // JSON whose string values render into prose a reader sees.
      'docs/harbor-research/library-index.json',
      'whitepaper/textbook.json',
      'whitepaper/figures/figure-register.json',
      'docs/harbor-research/exposition/figures/figcheck/fig-anchor-card-lifecycle.json',
      'docs/harbor-research/exposition/marginalia-candidates.json',
    ];
    for (const p of inScope) {
      expect(matchesAny(p, config.paths)).toBe(true);
    }
  });

  test('excluded paths from the task spec are matched by the exclude globs', () => {
    const excluded = [
      'CHANGELOG.md',
      'skills/some-skill/CHANGELOG.md',
      'docs/adr/CHANGELOG.md',
      'proofs/economics/claim_signaling.tla',
      'proofs/protocol.pv',
      'model.z3',
      'model.ec',
      'model.cfg',
      'apps/foo/bar.ts',
      'lib/foo.ts',
      'src/foo.ts',
      'core/foo.rs',
      'tests/unit/foo.test.js',
      'scripts/foo.test.mjs',
      '.scratch/notes.md',
    ];
    for (const p of excluded) {
      expect(matchesAny(p, config.exclude)).toBe(true);
    }
  });
});

describe('check-banned-phrases findHits (case-insensitivity)', () => {
  test('catches every casing variant in the dirty fixture, with correct line numbers', () => {
    const config = loadConfig();
    const text = readFileSync(fixture('dirty-doc.md'), 'utf8');
    const hits = findHits(text, config.phrases);
    const summary = hits.map((h) => `${h.line}:${h.phrase.toLowerCase()}`).sort();
    expect(summary).toEqual(
      ['3:load-bearing', '5:held to account', '7:load bearing'].sort(),
    );
  });

  test('a doc that never writes either phrase produces zero hits', () => {
    const config = loadConfig();
    const text = readFileSync(fixture('clean-doc.md'), 'utf8');
    expect(findHits(text, config.phrases)).toEqual([]);
  });

  test('a banned phrase inside a JSON string value is caught (the file is scanned as text)', () => {
    const config = loadConfig();
    const text = readFileSync(fixture('dirty-data.json'), 'utf8');
    const hits = findHits(text, config.phrases);
    expect(hits).toEqual([{ line: 2, phrase: 'load-bearing' }]);
  });
});

describe('check-banned-phrases resolveTargets (exclusion behaviour)', () => {
  test('an explicit excluded path (CHANGELOG.md) is dropped even when named directly', () => {
    const config = loadConfig();
    const targets = resolveTargets(config, ['CHANGELOG.md', 'AGENTS.md']);
    expect(targets).toEqual(['AGENTS.md']);
  });
});

describe('check-banned-phrases CLI (end-to-end)', () => {
  let tmpDir;

  test('a hit in an in-scope file fails the gate and names file:line:phrase', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'banned-phrases-test-'));
    const target = join(tmpDir, 'dirty.md');
    writeFileSync(target, 'Line one is fine.\nThis one is LOAD-BEARING and someone was held To Account.\n');
    const { code, stderr } = run(target);
    expect(code).toBe(1);
    expect(stderr).toMatch(/dirty\.md:2:load-bearing/i);
    expect(stderr).toMatch(/dirty\.md:2:held to account/i);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a JSON file with the phrase in a string value fails the gate', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'banned-phrases-test-'));
    const target = join(tmpDir, 'library-index.json');
    writeFileSync(
      target,
      JSON.stringify({ one_breath: 'The whole argument is load-bearing here.' }, null, 2),
    );
    const { code, stderr } = run(target);
    expect(code).toBe(1);
    expect(stderr).toMatch(/library-index\.json:\d+:load-bearing/i);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a hit in an excluded path (the real, untouched CHANGELOG.md) is ignored', () => {
    // CHANGELOG.md carries a pre-existing "load-bearing" mention by design —
    // PR #10077 deliberately left CHANGELOG history alone. Passed explicitly,
    // the exclude list must still drop it: this is not a "file has zero
    // hits" assertion, it is an "the gate never even looks" assertion.
    const raw = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
    expect(raw.toLowerCase()).toMatch(/load-bearing|load bearing|held to account/);
    const { code, stdout } = run('CHANGELOG.md');
    expect(code).toBe(0);
    expect(stdout).toMatch(/0 hits across 0 scanned file/);
  });

  test('the committed tree passes the full scoped sweep', () => {
    const { code, stdout } = run();
    expect(code).toBe(0);
    expect(stdout).toMatch(/0 hits/);
  });
});
