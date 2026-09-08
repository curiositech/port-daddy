// tests/unit/purser/golden-ref-count-validation.test.js
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, beforeAll } from '@jest/globals';

/**
 * Resolve the repository root from this file's location.
 * This file lives in <repo>/tests/unit/purser/, so we go three levels up.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../');

/**
 * Recursively walk a directory and collect all files that satisfy a predicate.
 *
 * @param {string} dir - directory to walk
 * @param {(filePath:string)=>boolean} predicate - return true for files we want
 * @returns {Promise<string[]>} absolute paths of matching files
 */
async function walk(dir, predicate) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const matches = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await walk(full, predicate)));
    } else if (predicate(full)) {
      matches.push(full);
    }
  }

  return matches;
}

/**
 * Locate all Purser golden‑snapshot markdown files.
 *
 * The project historically stores them with a `.golden.md` suffix,
 * but we also accept `.snapshot.md` or any file that contains
 * the word “golden” in its name and ends with `.md`.
 */
async function locateGoldenSnapshots() {
  const isGolden = (p) => {
    const lower = p.toLowerCase();
    return (
      lower.endsWith('.md') &&
      (lower.includes('.golden.') ||
        lower.endsWith('.golden.md') ||
        lower.endsWith('.snapshot.md'))
    );
  };
  return walk(REPO_ROOT, isGolden);
}

/**
 * Count markdown link references in a document.
 *
 * A reference is any occurrence of `[text](url)`.  This is a simple
 * heuristic that works for the Purser output and guarantees we
 * detect at least one citation when the document is well‑formed.
 *
 * @param {string} content
 * @returns {number}
 */
function countReferences(content) {
  const matches = content.match(/\[[^\]]+\]\([^\)]+\)/g);
  return matches ? matches.length : 0;
}

/**
 * Helper that verifies the presence of a required phrase (case‑insensitive)
 * and provides a helpful error message.
 *
 * @param {string} content
 * @param {RegExp} regex
 * @param {string} description
 */
function assertPhrase(content, regex, description) {
  const found = regex.test(content);
  expect(found).toBeTruthy(); // Jest will surface the description on failure
}

/* -------------------------------------------------------------------------- */
/*                               Test Suite                                   */
/* -------------------------------------------------------------------------- */

describe('Purser golden‑snapshot reference validation', () => {
  /** @type {string[]} */
  let goldenFiles = [];

  beforeAll(async () => {
    goldenFiles = await locateGoldenSnapshots();
  });

  test('repository contains at least one golden snapshot', () => {
    expect(goldenFiles.length).toBeGreaterThan(0);
  });

  /**
   * For each golden snapshot we enforce three invariants derived from the
   * contract in the PR description:
   *
   * 1. The document must contain at least one markdown reference.
   * 2. It must explicitly mention a roadmap commitment.
   * 3. It must contain an unambiguous receipt clause.
   * 4. Production‑gate terminology must appear consistently.
   */
  test.each(goldenFiles.map((abs) => [path.relative(REPO_ROOT, abs), abs]))(
    'snapshot %s satisfies reference and clause requirements',
    async (_relativePath, absolutePath) => {
      const content = await fs.readFile(absolutePath, 'utf8');

      // 1️⃣ Reference count > 0
      const refCount = countReferences(content);
      expect(refCount).toBeGreaterThan(
        0,
      );

      // 2️⃣ Roadmap commitment presence
      assertPhrase(
        content,
        /roadmap\s+commitment/i,
        'roadmap commitment phrase missing',
      );

      // 3️⃣ Receipt clause presence
      assertPhrase(
        content,
        /receipt\s+clause/i,
        'receipt clause phrase missing',
      );

      // 4️⃣ Production‑gate terminology consistency
      // Accept “production‑gate”, “production gate”, or “production‑gate”.
      assertPhrase(
        content,
        /production[-\s]gate/i,
        'production‑gate terminology missing',
      );
    },
  );
});