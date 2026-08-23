// tests/unit/purser/test-namespace-conflicts-edge-cases.test.js
import { strict as assert } from 'assert';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import {
  makeFixture,
  cleanupFixture,
} from '../../purser/mega-volume-test-helpers.js';

/**
 * Helper that writes a manifest with the given `references` value (or omits it)
 * and asserts that the positivity check throws an error.
 *
 * @param {any} referencesValue - The value to assign to `references` in the
 *   manifest. Pass `undefined` to omit the key entirely.
 * @param {string} description - Human‑readable description for the test.
 */
function expectReferenceCheckFails(referencesValue, description) {
  const root = makeFixture();
  try {
    // Ensure the directory exists
    mkdirSync(join(root, '.cache', 'generated'), { recursive: true });

    // Build the manifest object
    const manifest = {
      chapters: 7,
      sources: [1, 2, 3, 4, 5, 6, 7],
    };

    // Conditionally add the `references` key
    if (referencesValue !== undefined) {
      manifest.references = referencesValue;
    }

    // Write the manifest JSON
    writeFileSync(
      join(root, '.cache', 'generated', 'mega-volume-generation.json'),
      JSON.stringify(manifest),
    );

    // Read and parse the manifest
    const content = readFileSync(
      join(root, '.cache', 'generated', 'mega-volume-generation.json'),
      'utf8',
    );
    const parsed = JSON.parse(content);

    // The positivity assertion from the updated test
    assert.ok(
      Number.isInteger(parsed.references) && parsed.references > 0,
      `manifest must report a real reference count, got: ${JSON.stringify(
        parsed.references,
      )}`,
    );
  } finally {
    cleanupFixture(root);
  }
}

describe('Reference count positivity edge cases', () => {
  test('rejects zero references', () => {
    expect(() =>
      expectReferenceCheckFails(0, 'zero references'),
    ).toThrow(/manifest must report a real reference count/);
  });

  test('rejects non‑integer number references', () => {
    expect(() =>
      expectReferenceCheckFails(0.5, 'non‑integer number'),
    ).toThrow(/manifest must report a real reference count/);
  });

  test('rejects negative references', () => {
    expect(() =>
      expectReferenceCheckFails(-5, 'negative references'),
    ).toThrow(/manifest must report a real reference count/);
  });

  test('rejects string numeric references', () => {
    expect(() =>
      expectReferenceCheckFails('123', 'string numeric references'),
    ).toThrow(/manifest must report a real reference count/);
  });

  test('rejects string non‑numeric references', () => {
    expect(() =>
      expectReferenceCheckFails('NaN', 'string non‑numeric references'),
    ).toThrow(/manifest must report a real reference count/);
  });

  test('rejects null references', () => {
    expect(() =>
      expectReferenceCheckFails(null, 'null references'),
    ).toThrow(/manifest must report a real reference count/);
  });

  test('rejects missing references field', () => {
    expect(() =>
      expectReferenceCheckFails(undefined, 'missing references field'),
    ).toThrow(/manifest must report a real reference count/);
  });
});