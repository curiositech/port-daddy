import { describe, expect, test } from '@jest/globals';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI_PATH = resolve(import.meta.dirname, '../..', 'bin/port-daddy-cli.ts');

describe('Bosun network escape validation', () => {
  test('No Bosun-specific network endpoints', () => {
    const output = execSync(`npx tsx ${CLI_PATH} doctor`, { stdio: 'pipe' }).toString();
    expect(output).not.toMatch(/bosun\.watchdog|homebrew\/port-daddy/i);
  });

  test('No Bosun-related network configurations', () => {
    const output = execSync(`npx tsx ${CLI_PATH} config list`, { stdio: 'pipe' }).toString();
    expect(output).not.toMatch(/bosun\./i);
  });
});