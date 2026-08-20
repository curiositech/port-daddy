// the complete contents of tests/unit/purser/test-missing-file-in-routing.test.js
import { test, expect } from '@jest/globals';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const purserSrc = join(repoRoot, 'tests', 'purser');

test('a missing file in the routing manifest causes a test failure', () => {
  // Create a temporary copy of the purser directory
  const tmpRoot = mkdtempSync(join(tmpdir(), 'purser-test-'));
  const purserTmp = join(tmpRoot, 'tests', 'purser');
  mkdirSync(purserTmp, { recursive: true });

  // Recursively copy the real purser directory into the temp location
  cpSync(purserSrc, purserTmp, { recursive: true });

  // Add a new file that is not listed in ROUTING.json
  const missingFile = join(purserTmp, 'missing-file.test.js');
  writeFileSync(missingFile, 'test("dummy", () => {});', 'utf8');

  // Load the routing manifest from the temp copy
  const routing = JSON.parse(
    readFileSync(join(purserTmp, 'ROUTING.json'), 'utf8')
  );

  // Gather the list of files present on disk (excluding the manifest itself)
  const onDisk = readdirSync(purserTmp).filter((f) => f !== 'ROUTING.json').sort();

  // The assertion that the manifest and directory match will throw because
  // `missing-file.test.js` is on disk but not in the manifest.
  expect(() => {
    expect(Object.keys(routing.files).sort()).toEqual(onDisk);
  }).toThrow();

  // Clean up the temporary directory
  rmSync(tmpRoot, { recursive: true, force: true });
});