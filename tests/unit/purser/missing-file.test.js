// tests/unit/purser/missing-file.test.js
import { test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';

test('parity check fails when a file is missing from ROUTING.json', () => {
  // Prepare a temporary copy of the purser directory
  const scratchRoot = mkdtempSync(join(homedir(), 'coding', 'tmp', 'purser-'));
  const srcPurserDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'purser');
  const destPurserDir = join(scratchRoot, 'tests', 'purser');
  cpSync(srcPurserDir, destPurserDir, { recursive: true });

  // Insert an extra file that is not in ROUTING.json
  const extraFile = join(destPurserDir, 'extra.test.js');
  writeFileSync(extraFile, 'import { test } from "@jest/globals"; test("extra", () => {});');

  // Run the parity logic that the original test uses
  const routingPath = join(destPurserDir, '..', '..', 'ROUTING.json');
  const routing = JSON.parse(readFileSync(routingPath, 'utf8'));
  const onDisk = readdirSync(destPurserDir).filter(f => f !== 'ROUTING.json').sort();
  const routingFiles = Object.keys(routing.files).sort();

  try {
    // The parity check should throw because 'extra.test.js' is not listed
    expect(() => {
      expect(routingFiles).toEqual(onDisk);
    }).toThrow();
  } finally {
    // Clean up the temporary directory
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});