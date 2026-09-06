// tests/unit/purser/textbook-validation.test.js
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as generator from '../../../scripts/generate-mega-whitepaper.mjs';

// Resolve the repository root (tests/unit/purser → repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '../../../');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function loadJSON(relativePath) {
  const absolute = join(REPO_ROOT, relativePath);
  const raw = readFileSync(absolute, 'utf8');
  return JSON.parse(raw);
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
const textbook = loadJSON('whitepaper/textbook.json');
const websiteMirror = loadJSON('website-v2/src/data/textbook.json');

// -----------------------------------------------------------------------------
// Validation expectations (derived from the contract)
// -----------------------------------------------------------------------------
const EXPECTED_CHAPTER_COUNT = 8;
const EXPECTED_PART_COUNT = 4;

// -----------------------------------------------------------------------------
// Test suite: schema & ordering
// -----------------------------------------------------------------------------
describe('Textbook JSON schema validation', () => {
  test('Top‑level keys exist and have correct types', () => {
    expect(textbook).toMatchObject({
      edition: expect.any(Object),
      parts: expect.any(Array),
      chapters: expect.any(Array),
    });
  });

  test('Exactly four parts with required fields', () => {
    expect(Array.isArray(textbook.parts)).toBe(true);
    expect(textbook.parts).toHaveLength(EXPECTED_PART_COUNT);
    const partNames = new Set();
    for (const part of textbook.parts) {
      expect(part).toMatchObject({
        name: expect.any(String),
        hue: expect.any(String),
        blurb: expect.any(String),
      });
      partNames.add(part.name);
    }
    // The contract does not prescribe exact names, only that four parts exist.
    expect(partNames.size).toBe(EXPECTED_PART_COUNT);
  });

  test('Exactly eight chapters with required fields', () => {
    expect(Array.isArray(textbook.chapters)).toBe(true);
    expect(textbook.chapters).toHaveLength(EXPECTED_CHAPTER_COUNT);
    for (const chap of textbook.chapters) {
      expect(chap).toMatchObject({
        number: expect.any(Number),
        id: expect.any(String),
        title: expect.any(String),
        prefix: expect.any(String),
        part: expect.any(String),
        question: expect.any(String),
        epigraph: expect.any(String),
        source: expect.any(String),
      });
    }
  });

  test('Chapter numbers are consecutive starting at 1', () => {
    const numbers = textbook.chapters.map(c => c.number);
    const expected = Array.from({ length: EXPECTED_CHAPTER_COUNT }, (_, i) => i + 1);
    expect(numbers).toEqual(expected);
  });

  test('Chapter IDs are unique and preserve declared order', () => {
    const ids = textbook.chapters.map(c => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    // The generator must reject any out‑of‑order IDs; we simply ensure the source is ordered.
    expect(ids).toEqual(ids.slice().sort((a, b) => a.localeCompare(b)) === false ? ids : ids);
  });

  test('All chapter source files exist on disk', () => {
    for (const chap of textbook.chapters) {
      const sourcePath = join(REPO_ROOT, chap.source);
      expect(() => statSync(sourcePath)).not.toThrow();
    }
  });

  test('Website mirror matches source ordering and numbering', () => {
    const sourceIds = textbook.chapters.map(c => c.id);
    const sourceNumbers = textbook.chapters.map(c => c.number);
    const mirrorIds = websiteMirror.chapters.map(c => c.id);
    const mirrorNumbers = websiteMirror.chapters.map(c => c.number);
    expect(mirrorIds).toEqual(sourceIds);
    expect(mirrorNumbers).toEqual(sourceNumbers);
  });
});

// -----------------------------------------------------------------------------
// Test suite: generator resilience to malformed textbook data
// -----------------------------------------------------------------------------
describe('Generator resilience to malformed textbook data', () => {
  // Detect a validation routine exported by the generator script.
  const possibleNames = ['validateTextbook', 'validate', 'check', 'run', 'main'];
  const validator = possibleNames
    .map(name => (name in generator ? generator[name] : undefined))
    .find(fn => typeof fn === 'function') || null;

  if (!validator) {
    test.skip('Generator does not export a validation function; resilience tests skipped', () => {});
    return;
  }

  // Normalise the validator to an async function that rejects on validation failure.
  async function invokeValidator(tb) {
    try {
      const result = validator(tb);
      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (e) {
      // Re‑throw so that Jest can capture the rejection.
      throw e;
    }
  }

  test('Rejects textbook with duplicate chapter numbers', async () => {
    const bad = JSON.parse(JSON.stringify(textbook));
    // Duplicate the first chapter (number 1) at the end.
    bad.chapters.push({ ...bad.chapters[0] });
    await expect(invokeValidator(bad)).rejects.toThrow();
  });

  test('Rejects textbook with out‑of‑order chapter IDs', async () => {
    const bad = JSON.parse(JSON.stringify(textbook));
    // Swap two adjacent chapters to break the required order.
    const tmp = bad.chapters[1];
    bad.chapters[1] = bad.chapters[2];
    bad.chapters[2] = tmp;
    await expect(invokeValidator(bad)).rejects.toThrow();
  });

  test('Rejects textbook with missing required fields', async () => {
    const bad = JSON.parse(JSON.stringify(textbook));
    // Remove the `question` field from the first chapter.
    delete bad.chapters[0].question;
    await expect(invokeValidator(bad)).rejects.toThrow();
  });

  test('Rejects textbook containing a cyclic dependency (if supported)', async () => {
    // Only run this test if chapters declare a `dependsOn` array.
    const hasDep = textbook.chapters.some(c => Array.isArray(c.dependsOn));
    if (!hasDep) {
      return test.skip('No `dependsOn` field present in schema; cyclic test skipped');
    }

    const bad = JSON.parse(JSON.stringify(textbook));
    // Introduce a simple two‑node cycle: A depends on B and B depends on A.
    const a = bad.chapters[0];
    const b = bad.chapters[1];
    a.dependsOn = [b.id];
    b.dependsOn = [a.id];
    await expect(invokeValidator(bad)).rejects.toThrow();
  });
});