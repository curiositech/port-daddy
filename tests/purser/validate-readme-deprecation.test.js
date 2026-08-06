import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const README_PATH = resolve(ROOT, 'README.md');

describe('README.md deprecation message', () => {
  test('should contain deprecation guidance for install-bosun', () => {
    const content = readFileSync(README_PATH, 'utf8');
    expect(content).toContain('Bosun watchdog setup is internal to supported installer and formula flows');
    expect(content).not.toContain('install-bosun');
  });
});