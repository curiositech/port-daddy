import { describe, expect, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readPublishedPortFile,
  resolveProbeEndpoint,
} from '../../lib/daemon-runtime.js';

const scratchBase = join(homedir(), 'coding', 'tmp');
mkdirSync(scratchBase, { recursive: true });
const scratch = mkdtempSync(join(scratchBase, 'port-validation-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function createPortFile(content) {
  const path = join(scratch, 'port');
  writeFileSync(path, content);
  return path;
}

describe('strict port file validation', () => {
  test('accepts valid port', () => {
    const path = createPortFile('21001');
    const result = readPublishedPortFile(path);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(21001);
  });

  test('rejects missing file', () => {
    const path = join(scratch, 'missing');
    const result = readPublishedPortFile(path);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not published/);
  });

  test('rejects empty file', () => {
    const path = createPortFile('');
    const result = readPublishedPortFile(path);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/);
  });

  test('rejects non-integer content', () => {
    const path = createPortFile('abc');
    const result = readPublishedPortFile(path);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/malformed/);
  });

  test('rejects out-of-range port', () => {
    const path = createPortFile('65536');
    const result = readPublishedPortFile(path);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/out of range/);
  });

  test('uses explicit endpoint over port file', () => {
    const portFile = createPortFile('21001');
    const endpoint = { host: '127.0.0.1', port: 21002 };
    const result = resolveProbeEndpoint({ endpoint, portFile });
    expect(result).toEqual({ host: '127.0.0.1', port: 21002 });
  });
});