// tests/unit/purser/build-syntactic-invariants.test.ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, test, expect } from '@jest/globals';

/**
 * Helper to locate the repository root regardless of where the test file lives.
 */
function repoRoot(): string {
  // This test lives in <repo>/tests/unit/purser/
  // Going up three directories lands at the repository root.
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
}

/**
 * Load the generated mega‑volume LaTeX source that is committed in the repo.
 * The contract requires this file to be the final product of the build pipeline.
 */
function loadMegaVolumeTex(): string {
  const texPath = resolve(
    repoRoot(),
    'website-v2/public/whitepaper/coordination-papers-mega-volume.tex',
  );
  return readFileSync(texPath, 'utf8');
}

/**
 * Extract macro arguments from the LaTeX source.
 *
 * @param source LaTeX source string
 * @param macroName name of the macro without leading backslash, e.g. "pdchapteropening"
 * @returns array of raw argument strings (order preserved)
 */
function extractMacroArgs(source: string, macroName: string): string[] {
  const re = new RegExp(`\\\\${macroName}\\{([^}]*)\\}`, 'g');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

/**
 * Ensure that no image inclusion commands reference the disallowed visual assets.
 *
 * The contract says jacket, inside‑jacket, and coda art must be omitted from the
 * build input list. Those assets are typically referenced via \includegraphics.
 */
function hasForbiddenImageReferences(source: string): boolean {
  // Look for \includegraphics (or similar) that mentions forbidden keywords.
  const forbiddenKeywords = ['jacket', 'inside[-_]jacket', 'coda'];
  const pattern = new RegExp(
    `\\\\includegraphics[^}]*(${forbiddenKeywords.join('|')})[^}]*\\.(png|jpe?g|pdf)`,
    'i',
  );
  return pattern.test(source);
}

/**
 * Verify that the seams file is explicitly included.
 *
 * The build script must load `coordination-papers‑mega‑volume‑seams.tex`.
 */
function includesSeamsFile(source: string): boolean {
  const seamsFile = 'coordination-papers-mega-volume-seams.tex';
  const re = new RegExp(`\\\\(?:input|include)\\{[^}]*${seamsFile}[^}]*\\}`, 'i');
  return re.test(source);
}

describe('build‑whitepapers syntactic invariants', () => {
  const texSource = loadMegaVolumeTex();

  test('seams file is included', () => {
    expect(includesSeamsFile(texSource)).toBe(
      true,
      'The main LaTeX source must \\input (or \\include) the seams file "coordination-papers‑mega‑volume‑seams.tex".',
    );
  });

  test('forbidden image assets are excluded', () => {
    expect(hasForbiddenImageReferences(texSource)).toBe(
      false,
      'The LaTeX source must not reference jacket, inside‑jacket, or coda images via \\includegraphics.',
    );
  });

  test('chapter macros are consistently injected', () => {
    const openings = extractMacroArgs(texSource, 'pdchapteropening');
    const handoffs = extractMacroArgs(texSource, 'pdchapterhandoff');

    // There must be at least one chapter macro pair.
    expect(openings.length).toBeGreaterThan(
      0,
      'At least one \\pdchapteropening{…} macro should be present.',
    );
    expect(handoffs.length).toBeGreaterThan(
      0,
      'At least one \\pdchapterhandoff{…} macro should be present.',
    );

    // The sets of chapter identifiers must match exactly and preserve order.
    expect(openings).toEqual(handoffs);

    // Optional sanity check: ensure identifiers look like valid LaTeX labels (no spaces).
    const invalid = openings.filter((id) => /\s/.test(id));
    expect(invalid).toHaveLength(
      0,
      `Chapter identifiers must not contain whitespace: ${invalid.join(', ')}`,
    );
  });
});