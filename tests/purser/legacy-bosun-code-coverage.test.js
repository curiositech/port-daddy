import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const INSTALL_DAEMON_PATH = resolve(ROOT, 'install-daemon.ts');

describe('Bosun code coverage validation', () => {
  test('install-bosun logic is fully removed', () => {
    const source = readFileSync(INSTALL_DAEMON_PATH, 'utf8');
    expect(source).not.toMatch(/installBosunOnly/);
    expect(source).not.toMatch(/Bosun\s+watchdog/i);
    expect(source).not.toMatch(/homebrew.mxcl.port-daddy/);
  });

  test('No residual Bosun references in CLI', () => {
    const source = readFileSync(resolve(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');
    expect(source).not.toMatch(/Bosun\s+watchdog/i);
    expect(source).not.toMatch(/homebrew\/port-daddy/i);
  });

  test('No Bosun-related environment variables', () => {
    const source = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    expect(source).not.toMatch(/BOSUN_|PORT_DADDY_BOSUN_/i);
  });
});