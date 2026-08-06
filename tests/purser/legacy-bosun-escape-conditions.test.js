import { describe, expect, test } from '@jest/globals';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI_PATH = resolve(import.meta.dirname, '../..', 'bin/port-daddy-cli.ts');

describe('Bosun command escape conditions', () => {
  test('install-bosun is not a valid command', () => {
    const error = execSync(`npx tsx ${CLI_PATH} install-bosun`, { stdio: 'pipe' }).toString();
    expect(error).toContain('Unknown command');
    expect(error).toContain('install-bosun');
  });

  test('install-bosun is not in command list', () => {
    const output = execSync(`npx tsx ${CLI_PATH} --help`, { stdio: 'pipe' }).toString();
    expect(output).not.toContain('install-bosun');
  });

  test('install-bosun is not in tab completion', () => {
    const output = execSync(`npx tsx ${CLI_PATH} install-bosun<TAB>`, { stdio: 'pipe' }).toString();
    expect(output).not.toContain('install-bosun');
  });
});