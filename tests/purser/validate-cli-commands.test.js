import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const CLI_PATH = resolve(ROOT, 'bin/port-daddy-cli.ts');

describe('CLI command list', () => {
  test('should not include install-bosun', () => {
    const content = readFileSync(CLI_PATH, 'utf8');
    expect(content).not.toContain('install-bosun');
  });
});