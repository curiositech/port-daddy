// tests/unit/purser/harvest-directory-consistency.test.ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';

// Resolve repository root (project is an ES‑module, so __dirname is unavailable)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Recursively determine whether a directory contains at least one regular file.
 */
async function hasAtLeastOneFile(dir: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile()) return true;
    if (entry.isDirectory()) {
      if (await hasAtLeastOneFile(fullPath)) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* 1. Verify top‑level `scratch/` hierarchy and that each folder has content.  */
/* -------------------------------------------------------------------------- */
describe('scratch hierarchy', () => {
  const expectedDirs = [
    'scratch/design',
    'scratch/actor-coordination',
    'scratch/section3-salvage',
    'scratch/skill_candidates',
    'scratch/whitepaper-foundlings',
  ];

  for (const relPath of expectedDirs) {
    const absPath = join(repoRoot, relPath);
    test(`directory ${relPath} exists`, async () => {
      const stats = await fs.stat(absPath);
      expect(stats.isDirectory()).toBe(true);
    });

    test(`${relPath} contains at least one file`, async () => {
      const contains = await hasAtLeastOneFile(absPath);
      expect(contains).toBe(true);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 2. .gitattributes must declare LFS for PDF files under the two folders.    */
/* -------------------------------------------------------------------------- */
describe('.gitattributes LFS rules', () => {
  const gitattributesPath = join(repoRoot, '.gitattributes');

  test('file exists', async () => {
    const stats = await fs.stat(gitattributesPath);
    expect(stats.isFile()).toBe(true);
  });

  test('contains LFS rule for whitepaper-foundlings/**/*.pdf', async () => {
    const content = await fs.readFile(gitattributesPath, 'utf8');
    const regex = /^\s*whitepaper-foundlings\/\*\*\/\*\.pdf\b.*filter=lfs/m;
    expect(regex.test(content)).toBe(true);
  });

  test('contains LFS rule for skill_candidates/**/*.pdf', async () => {
    const content = await fs.readFile(gitattributesPath, 'utf8');
    const regex = /^\s*skill_candidates\/\*\*\/\*\.pdf\b.*filter=lfs/m;
    expect(regex.test(content)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. check-brand-colors.mjs must have an anchored SKIP_DIR regex for scratch.*/
/* -------------------------------------------------------------------------- */
describe('scripts/check-brand-colors.mjs SKIP_DIR', () => {
  const scriptPath = join(repoRoot, 'scripts', 'check-brand-colors.mjs');

  test('file exists', async () => {
    const stats = await fs.stat(scriptPath);
    expect(stats.isFile()).toBe(true);
  });

  test('SKIP_DIR regex is anchored and matches scratch/ paths', async () => {
    const content = await fs.readFile(scriptPath, 'utf8');
    // Look for something like: const SKIP_DIR = /^scratch\// or similar
    const match = content.match(/SKIP_DIR\s*=\s*\/([^\/]*)\/[gimsuy]*/);
    expect(match).not.toBeNull();
    const pattern = match ? match[1] : '';
    // Must start with ^ and contain scratch/
    expect(pattern.startsWith('^')).toBe(true);
    expect(pattern.includes('scratch/')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. source-is-text.mjs must allow LFS‑triggered binary PDFs.                */
/* -------------------------------------------------------------------------- */
describe('scripts/lib/source-is-text.mjs ALLOWED_NON_TEXT_PATTERNS', () => {
  const scriptPath = join(repoRoot, 'scripts', 'lib', 'source-is-text.mjs');

  test('file exists', async () => {
    const stats = await fs.stat(scriptPath);
    expect(stats.isFile()).toBe(true);
  });

  test('ALLOWED_NON_TEXT_PATTERNS includes a PDF matcher', async () => {
    const content = await fs.readFile(scriptPath, 'utf8');
    // Rough check: the array literal should contain a pattern for .pdf
    const arrayMatch = content.match(/ALLOWED_NON_TEXT_PATTERNS\s*=\s*\[([\s\S]*?)\]/);
    expect(arrayMatch).not.toBeNull();
    const arrayBody = arrayMatch ? arrayMatch[1] : '';
    // Look for either a string or RegExp that mentions .pdf
    const pdfPattern = /(?:\.pdf|\\.pdf)/i;
    expect(pdfPattern.test(arrayBody)).toBe(true);
  });
});