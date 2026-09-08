// tests/unit/purser/brand-colors-skip-dir.test.ts
import { describe, expect, test, beforeAll } from '@jest/globals';
import * as fs from 'node:fs';

let SKIP_DIR: RegExp;

/**
 * Resolve the SKIP_DIR RegExp from the script under test.
 *
 * The script may export it directly; if not, we fall back to parsing the source
 * file for a literal RegExp definition. This dual‑approach makes the test robust
 * against implementation changes while still guaranteeing that the actual
 * regular‑expression text in the source satisfies the contract.
 */
beforeAll(async () => {
  // Attempt a direct import – works if the script exports SKIP_DIR.
  const mod = await import('../../../scripts/check-brand-colors.mjs');
  if (mod && mod.SKIP_DIR instanceof RegExp) {
    SKIP_DIR = mod.SKIP_DIR;
    return;
  }

  // Fallback: read the source file and extract the literal RegExp.
  const scriptPath = new URL('../../../scripts/check-brand-colors.mjs', import.meta.url);
  const source = fs.readFileSync(scriptPath, 'utf8');

  // Look for a top‑level `const SKIP_DIR = /.../flags;` declaration.
  const literalMatch = source.match(/const\s+SKIP_DIR\s*=\s*(\/[^;]+?)\s*;/s);
  if (!literalMatch) {
    throw new Error('SKIP_DIR regular‑expression literal not found in check-brand-colors.mjs');
  }

  // Evaluate the literal safely – it is under our control (the source file).
  // eslint-disable-next-line no-eval
  SKIP_DIR = eval(literalMatch[1]) as RegExp;

  if (!(SKIP_DIR instanceof RegExp)) {
    throw new Error('Extracted SKIP_DIR is not a RegExp instance');
  }
});

describe('check-brand-colors SKIP_DIR regex', () => {
  test('is a RegExp instance', () => {
    expect(SKIP_DIR).toBeInstanceOf(RegExp);
  });

  test('is anchored to the start of the path', () => {
    // The source of a RegExp includes its flags after the closing slash.
    // Anchoring means the pattern string begins with '^'.
    expect(SKIP_DIR.source.startsWith('^')).toBe(true);
  });

  test('excludes the scratch hierarchy (and its sub‑directories)', () => {
    const shouldMatch = [
      'scratch/',
      'scratch/README.md',
      'scratch/design/design-tui-fleetbar-mockups/index.html',
      'scratch/actor-coordination/maritime-actors.test.js',
      'scratch/section3-salvage/backend-bin-resolver.ts',
    ];
    for (const p of shouldMatch) {
      expect(SKIP_DIR.test(p)).toBe(true);
    }
  });

  test('does not mistakenly skip look‑alike paths outside the scratch root', () => {
    const shouldNotMatch = [
      'not-scratch/design/foo.html',
      'my-scratch/notes.txt',
      'src/scratch/design/foo.html',
      'scratchpad/readme.md',
      'scratchy/file.txt',
    ];
    for (const p of shouldNotMatch) {
      expect(SKIP_DIR.test(p)).toBe(false);
    }
  });
});