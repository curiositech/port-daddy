import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const COMPLETIONS = [
  'completions/port-daddy.bash',
  'completions/port-daddy.fish',
  'completions/port-daddy.zsh'
].map(p => resolve(ROOT, p));

describe('Shell completions', () => {
  test.each(COMPLETIONS)('%s should not contain install-bosun', (file) => {
    const content = readFileSync(file, 'utf8');
    expect(content).not.toContain('install-bosun');
  });
});