// tests/unit/purser/lfs-attribute-virality.test.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the repository root from the location of this test file.
 * The test lives in <repo>/tests/unit/purser/, so we need to go up three levels.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Read a file from the repository root as UTF‑8 text.
 */
function readRepoFile(relativePath: string): string {
  const absPath = path.join(REPO_ROOT, relativePath);
  return fs.readFileSync(absPath, 'utf8');
}

/**
 * Parse .gitattributes into an array of non‑comment, non‑empty lines.
 */
function getEffectiveLines(): string[] {
  const raw = readRepoFile('.gitattributes');
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

/**
 * Return true if there exists a line that:
 *   • begins with the exact glob pattern supplied (no extra prefix)
 *   • contains the LFS filter attribute (`filter=lfs`) and does NOT contain a negation (`-filter`)
 */
function hasLfsFor(globPattern: string): boolean {
  const escapedGlob = globPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRegex = new RegExp(`^${escapedGlob}(?:\\s+.*)?\\bfilter=lfs\\b`);
  return getEffectiveLines().some((line) => lineRegex.test(line));
}

/* -------------------------------------------------------------------------- */
/*  Test suite: LFS attribute virality                                           */
/* -------------------------------------------------------------------------- */

describe('LFS attribute virality', () => {
  test('skill_candidates/**/*.pdf is tracked by LFS', () => {
    const glob = 'skill_candidates/**/*.pdf';
    expect(hasLfsFor(glob)).toBe(
      true,
    );
  });

  test('whitepaper-foundlings/**/*.pdf is tracked by LFS', () => {
    const glob = 'whitepaper-foundlings/**/*.pdf';
    expect(hasLfsFor(glob)).toBe(
      true,
    );
  });

  test('LFS lines are not commented out or negated', () => {
    const lines = getEffectiveLines();
    const offending = lines.filter(
      (l) => /filter=lfs/.test(l) && /-filter/.test(l),
    );
    expect(offending).toEqual([]);
  });
});