import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const PUBLIC_COMMAND_SURFACES = [
  'bin/port-daddy-cli.ts',
  'completions/port-daddy.bash',
  'completions/port-daddy.fish',
  'completions/port-daddy.zsh',
  'features.manifest.json',
  'README.md',
];

const INSTALL_DAEMON_PATH = resolve(ROOT, 'install-daemon.ts');

describe('retired Bosun command surface', () => {
  test.each(PUBLIC_COMMAND_SURFACES)('%s does not advertise install-bosun', (file) => {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    expect(source).not.toContain('install-bosun');
    expect(source).not.toMatch(/install[_-]bosun/i);
  });

  test('install-daemon has no direct Bosun-only entrypoint', () => {
    const source = readFileSync(INSTALL_DAEMON_PATH, 'utf8');
    expect(source).not.toMatch(/installBosunOnly|case\s+'install-bosun'|install-daemon\.js\s+install-bosun/);
    expect(source).not.toMatch(/Bosun\s+watchdog/i);
  });

  test('CLI command list excludes install-bosun', () => {
    const source = readFileSync(resolve(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');
    expect(source).not.toMatch(/'install-bosun'/);
    expect(source).not.toMatch(/install-bosun/);
  });

  test('Completions do not suggest install-bosun', () => {
    const bash = readFileSync(resolve(ROOT, 'completions/port-daddy.bash'), 'utf8');
    const fish = readFileSync(resolve(ROOT, 'completions/port-daddy.fish'), 'utf8');
    const zsh = readFileSync(resolve(ROOT, 'completions/port-daddy.zsh'), 'utf8');
    expect(bash).not.toContain('install-bosun');
    expect(fish).not.toContain('install-bosun');
    expect(zsh).not.toContain('install-bosun');
  });

  test('README does not reference Bosun installer', () => {
    const source = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    expect(source).not.toMatch(/install-bosun|Bosun watchdog/i);
  });
});