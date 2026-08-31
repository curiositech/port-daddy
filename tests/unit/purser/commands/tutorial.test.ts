// tests/unit/purser/commands/tutorial.test.ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to load a source file as a string
async function loadSource(relPath: string): Promise<string> {
  const absPath = resolve(__dirname, '..', '..', '..', relPath);
  return await readFile(absPath, 'utf8');
}

// Strings that must never appear in a read‑only orientation handler
const FORBIDDEN_SUBSTRINGS = [
  '/claim',
  '/sugar/begin',
  '/notes',
  '/locks',
  '/agents',
  '/dns',
  '/msg',
  '/actors',
  'resetState',
  'cleanupTutorialState',
];

describe('tutorial command read‑only contract', () => {
  let tutorialSrc: string;
  let learnSrc: string | null = null;

  beforeAll(async () => {
    tutorialSrc = await loadSource('cli/commands/tutorial.ts');

    // The learn command is expected to exist side‑by‑side with tutorial.
    // If it does not, we surface a clear failure (the contract is broken).
    try {
      learnSrc = await loadSource('cli/commands/learn.ts');
    } catch {
      learnSrc = null;
    }
  });

  test('does not contain any mutating endpoint literals or state‑reset symbols', () => {
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(tutorialSrc.includes(forbidden)).toBe(
        false,
        `tutorial.ts must not reference "${forbidden}"`
      );
    }
  });

  test('imports the read‑only orientation handler runLearnOrientation', () => {
    const importRegex = /import\s+.*runLearnOrientation.*from\s+['"]([^'"]+)['"]/;
    const match = tutorialSrc.match(importRegex);
    expect(match).not.toBeNull();
    // sanity check – the import path should be a relative module inside the repo
    expect(match![1]).toMatch(/\.\/.*runLearnOrientation/);
  });

  test('learn command exists and also imports runLearnOrientation', async () => {
    expect(learnSrc).not.toBeNull();
    if (!learnSrc) return; // safeguard for TypeScript

    const importRegex = /import\s+.*runLearnOrientation.*from\s+['"]([^'"]+)['"]/;
    const match = learnSrc.match(importRegex);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/\.\/.*runLearnOrientation/);
  });

  test('tutorial and learn commands invoke the identical handler import', async () => {
    expect(learnSrc).not.toBeNull();
    if (!learnSrc) return;

    const importRegex = /import\s+.*runLearnOrientation.*from\s+['"]([^'"]+)['"]/g;

    const tutorialMatches = [...tutorialSrc.matchAll(importRegex)].map(m => m[1]);
    const learnMatches = [...learnSrc!.matchAll(importRegex)].map(m => m[1]);

    // Both files should import exactly one module that provides runLearnOrientation
    expect(tutorialMatches).toHaveLength(1);
    expect(learnMatches).toHaveLength(1);
    expect(tutorialMatches[0]).toBe(learnMatches[0]);
  });
});