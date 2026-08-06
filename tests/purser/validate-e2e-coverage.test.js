import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const E2E_SCRIPT = resolve(ROOT, 'scripts/e2e-compiled-cli-surface.sh');

describe('E2E coverage list', () => {
  test('should not include install-bosun', () => {
    const content = readFileSync(E2E_SCRIPT, 'utf8');
    expect(content).not.toContain('install-bosun');
  });
});