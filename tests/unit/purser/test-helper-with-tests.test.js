// tests/unit/purser/test-helper-with-tests.test.js
import { describe, expect, test } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const purserDir = join(repoRoot, 'tests', 'purser');
const routingPath = join(purserDir, 'ROUTING.json');

const routing = JSON.parse(readFileSync(routingPath, 'utf8'));
const entries = Object.entries(routing.files);

describe('helper files must not contain test declarations', () => {
  test('no helper entry declares a test', () => {
    const helperFiles = entries
      .filter(([, { runner }]) => runner === 'helper')
      .map(([file]) => file);

    const offending = helperFiles.filter((file) => {
      const content = readFileSync(join(purserDir, file), 'utf8');
      return /^\s*(?:describe|test|it)\s*\(/m.test(content);
    });

    expect(offending).toEqual([]);
  });
});