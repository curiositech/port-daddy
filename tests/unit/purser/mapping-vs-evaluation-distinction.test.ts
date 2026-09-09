// tests/unit/purser/mapping-vs-evaluation-distinction.test.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve repository root from this file's location (tests/unit/purser)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..', '..');

// Paths to the documentation we need to inspect
const kernelTexPath = join(repoRoot, 'whitepaper', 'single-writer-kernel.tex');
const pedagogyTexPath = join(repoRoot, 'whitepaper', 'figures', 'pd-pedagogy.tex');

/**
 * Helper to safely read a file as UTF‑8 text.
 * Throws if the file cannot be read – the test runner will surface the error.
 */
function readTex(path: string): string {
  return readFileSync(path, { encoding: 'utf8' });
}

/**
 * Extract the LaTeX section named “What it buys”.
 * Returns the raw section text (everything after the header up to the next section/subsection)
 * or an empty string if the header cannot be located.
 */
function extractWhatItBuysSection(content: string): string {
  const sectionHeader = /\\(sub)?section\{[^}]*What it buys[^}]*\}/i;
  const match = content.search(sectionHeader);
  if (match === -1) return '';
  // Slice from the end of the header forward
  const afterHeader = content.slice(match);
  // Cut off at the next section/subsection command (or end of file)
  const nextSection = afterHeader.search(/\\(sub)?section\{[^}]+\}/i);
  return nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection);
}

/**
 * Count distinct Sheridan level numbers mentioned in a text.
 * Accepts patterns like “Sheridan Level 1”, “Sheridan level 2”, etc.
 */
function distinctSheridanLevels(text: string): Set<string> {
  const matches = [...text.matchAll(/Sheridan\s+Level\s+(\d+)/gi)];
  return new Set(matches.map(m => m[1]));
}

describe('Assurance Ladder documentation integrity', () => {
  const kernelTex = readTex(kernelTexPath);
  const pedagogyTex = readTex(pedagogyTexPath);

  test('maps the five assurance modes directly to the five Sheridan automation levels', () => {
    const sheridanLevels = distinctSheridanLevels(kernelTex);
    // The ladder defines exactly five modes → we expect at least five distinct levels.
    expect(sheridanLevels.size).toBeGreaterThanOrEqual(5);
    // Ensure the levels are the expected range 1‑5 (strict check for completeness).
    const expected = new Set(['1', '2', '3', '4', '5']);
    expected.forEach(level => {
      expect(sheridanLevels.has(level)).toBe(true);
    });
  });

  test('contains the “What it buys” section with the Sheridan ↔ Ladder mapping', () => {
    const section = extractWhatItBuysSection(kernelTex);
    expect(section).not.toBe('');
    // Verify the section mentions both Sheridan and the ladder’s five modes.
    expect(section).toMatch(/Sheridan/i);
    expect(section).toMatch(/assurance ladder/i);
    // Verify that the adjacency property wording appears.
    expect(section).toMatch(/adjacency.*work factor/i);
  });

  test('explicitly distinguishes ladder work‑factor measurement from Common Criteria audit effort', () => {
    // The whole kernel tex should contain a clear comparative paragraph.
    expect(kernelTex).toMatch(/Common\s+Criteria/i);
    // Look for language that frames CC as measuring audit effort against the whole product.
    expect(kernelTex).toMatch(/audit effort.*product/i);
    // And the ladder as measuring runtime adversary work factor against a single mechanism.
    expect(kernelTex).toMatch(/adversary work factor.*runtime/i);
    expect(kernelTex).toMatch(/single mechanism/i);
  });

  test('includes the required justification phrasing in the ladder discussion', () => {
    // The contract demands the exact phrasing (case‑insensitive match).
    expect(kernelTex).toMatch(/nothing at Observed/i);
    expect(kernelTex).toMatch(/client's willingness at Coordinated/i);
  });

  test('the pedagogy figure references both Sheridan levels and Common Criteria', () => {
    // The figure tex is expected to label the comparative axes or legends.
    expect(pedagogyTex).toMatch(/Sheridan/i);
    expect(pedagogyTex).toMatch(/Common\s+Criteria/i);
  });
});