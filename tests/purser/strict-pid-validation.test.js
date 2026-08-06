import { describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readPublishedPidFile,
} from '../../lib/daemon-runtime.js';

const scratchBase = join(homedir(), 'coding', 'tmp');
mkdirSync(scratchBase, { recursive: true });
const scratch = mkdtempSync(join(scratchBase, 'pid-validation-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function createPidFile(content) {
  const path = join(scratch, 'pid');
  writeFileSync(path, content);
  return path;
}

describe('strict pid file validation', () => {
  test('accepts valid pid', () => {
    const path = createPidFile('4242');
    const result = readPublishedPidFile(path);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(4242);
  });

  test('rejects missing file', () => {
    const path = join(scratch, 'missing');
    const result = readPublishedPidFile(path);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not published/);
  });

  test('rejects empty file', () => {
    const path = createPidFile('');
    const result = readPublishedPidFile(path);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/);
  });

  test('rejects non-integer content', () => {
    const path = createPidFile('abc');
    const result = readPublishedPidFile(path);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/malformed/);
  });

  test('rejects out-of-range pid', () => {
    const path = createPidFile('4194305');
    const result = readPublishedPidFile(path);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/out of range/);
  });
});