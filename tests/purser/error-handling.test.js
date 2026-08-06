import { describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readPublishedPortFile,
  readPublishedPidFile,
} from '../../lib/daemon-runtime.js';

const scratchBase = join(homedir(), 'coding', 'tmp');
mkdirSync(scratchBase, { recursive: true });
const scratch = mkdtempSync(join(scratchBase, 'error-handling-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function createPortFile(content) {
  const path = join(scratch, 'port');
  writeFileSync(path, content);
  return path;
}

function createPidFile(content) {
  const path = join(scratch, 'pid');
  writeFileSync(path, content);
  return path;
}

describe('error handling', () => {
  test('reports correct error for missing port file', () => {
    const path = join(scratch, 'missing');
    const result = readPublishedPortFile(path);
    expect(result.error).toMatch(/not published/);
  });

  test('reports correct error for empty pid file', () => {
    const path = createPidFile('');
    const result = readPublishedPidFile(path);
    expect(result.error).toMatch(/empty/);
  });

  test('reports malformed port file with trailing content', () => {
    const path = createPortFile('21001 trailing');
    const result = readPublishedPortFile(path);
    expect(result.error).toMatch(/malformed/);
  });

  test('reports out-of-range pid file', () => {
    const path = createPidFile('4194305');
    const result = readPublishedPidFile(path);
    expect(result.error).toMatch(/out of range/);
  });
});