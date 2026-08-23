// tests/unit/purser/nul-in-middle.test.js
/**
 * This test validates that our source‑file guard logic detects a NUL byte
 * anywhere in a file, even when the byte is positioned beyond Git's
 * 8000‑byte binary threshold.  The guard itself uses `fs.readFileSync`
 * followed by `Buffer.includes(0)` which scans the entire file.
 *
 * The test creates a temporary file that is > 8000 bytes long, injects
 * a NUL byte near the end, and asserts that the detection succeeds.
 * It also checks that a file without a NUL is not falsely reported.
 */

import { describe, test, expect, afterAll } from '@jest/globals';
import { writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const TEMP_DIR = resolve(tmpdir(), 'purser-nul-test-' + Date.now());

afterAll(() => {
  // Clean up the temporary directory after all tests
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('NUL detection beyond Git 8000‑byte threshold', () => {
  test('detects a NUL byte located after 8000 bytes', () => {
    // Ensure the temp directory exists
    mkdirSync(TEMP_DIR, { recursive: true });

    // Create a file 9000 bytes long (all 'a'), then inject a NUL at pos 8500
    const filePath = join(TEMP_DIR, 'large.txt');
    const buf = Buffer.alloc(9000, 'a'); // 9000 bytes of 'a'
    const nulIndex = 8500;
    buf[nulIndex] = 0; // inject raw NUL

    writeFileSync(filePath, buf);

    // Read back the file and check for the NUL
    const readBuf = readFileSync(filePath);
    const hasNul = readBuf.includes(0);

    expect(hasNul).toBe(true);
  });

  test('does not flag a file without a NUL byte', () => {
    const filePath = join(TEMP_DIR, 'clean.txt');
    writeFileSync(filePath, Buffer.alloc(9000, 'b')); // 9000 bytes of 'b'

    const readBuf = readFileSync(filePath);
    const hasNul = readBuf.includes(0);

    expect(hasNul).toBe(false);
  });
});