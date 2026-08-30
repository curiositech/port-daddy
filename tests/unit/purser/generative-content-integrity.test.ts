/**
 * tests/unit/purser/generative-content-integrity.test.ts
 *
 * This test validates that the mega‑volume generator respects the
 * contractual obligations for the PR #9964:
 *
 *  • Editorial plates are stripped (no `validateEditorialPlate` calls,
 *    no `paper.plate` configuration).
 *  • The seams file is loaded (the generated TeX must reference the seams
 *    source).
 *  • Chapter boundaries are expressed with the required macros
 *    `\pdchapteropening{…}` and `\pdchapterhandoff{…}`.
 *  • Art assets that belong to the jacket/inside‑jacket/coda are not
 *    present in the final TeX.
 *
 * The test reads the already‑generated LaTeX source from the repository
 * (the PR ships the compiled `.tex` file) and checks for the presence or
 * absence of the relevant patterns.  It does **not** invoke the generator
 * script directly – the contract is about the *output* of the generator.
 *
 * The test is written for Jest (the repository’s test runner) and uses
 * native ESM utilities (`import.meta.url`) because the project is
 * declared `"type": "module"` in its `package.json`.
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { readFile } from 'fs/promises';

// Resolve __dirname in an ESM context.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to the generated LaTeX source and the seams source file.
const GENERATED_TEX_PATH = path.resolve(
  __dirname,
  '../../../website-v2/public/whitepaper/coordination-papers-mega-volume.tex',
);
const SEAMS_TEX_PATH = path.resolve(
  __dirname,
  '../../../website-v2/public/whitepaper/coordination-papers-mega-volume-seams.tex',
);

let generatedTex: string;
let seamsTex: string;

beforeAll(async () => {
  // Load both files once for the suite.
  [generatedTex, seamsTex] = await Promise.all([
    readFile(GENERATED_TEX_PATH, 'utf8'),
    readFile(SEAMS_TEX_PATH, 'utf8'),
  ]);
});

describe('Mega‑volume generation contract compliance', () => {
  test('generated TeX references the seams file', () => {
    // The generator must load the seams file; the simplest observable
    // evidence is an `\input{…}` (or similar) line that mentions the file.
    expect(generatedTex).toMatch(
      /\\input\{[^}]*coordination-papers-mega-volume-seams\.tex\}/,
    );
  });

  test('generated TeX contains chapter opening and handoff macros', () => {
    // At least one opening macro and one handoff macro must be present.
    const openingCount = (generatedTex.match(/\\pdchapteropening\{[^}]*\}/g) ?? [])
      .length;
    const handoffCount = (generatedTex.match(/\\pdchapterhandoff\{[^}]*\}/g) ?? [])
      .length;

    expect(openingCount).toBeGreaterThan(0);
    expect(handoffCount).toBeGreaterThan(0);
    // The counts should be equal – each opening should have a corresponding handoff.
    expect(openingCount).toBe(handoffCount);
  });

  test('editorial‑plate logic is stripped', () => {
    // The generator must remove any call to `validateEditorialPlate`.
    expect(generatedTex).not.toMatch(/validateEditorialPlate/);
    // And it must not contain any `paper.plate` configuration fragment.
    expect(generatedTex).not.toMatch(/paper\.plate/);
  });

  test('jacket / inside‑jacket / coda art assets are excluded', () => {
    // These asset names should never appear in the final TeX.
    const forbiddenTokens = ['jacket', 'inside-jacket', 'coda'];
    for (const token of forbiddenTokens) {
      expect(generatedTex).not.toMatch(new RegExp(token, 'i'));
    }
  });

  test('seams content is not accidentally omitted', () => {
    // A sanity check that at least a portion of the seams file is present
    // in the generated output (either inlined or via \input).  We take the
    // first non‑empty line of the seams file as a representative snippet.
    const firstNonEmptyLine = seamsTex
      .split(/\r?\n/)
      .find((l) => l.trim().length > 0);
    if (firstNonEmptyLine) {
      expect(generatedTex).toContain(firstNonEmptyLine.trim());
    } else {
      // If the seams file were empty, the contract would be violated elsewhere.
      throw new Error('Seams file appears to be empty.');
    }
  });
});