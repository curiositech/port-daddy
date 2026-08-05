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

describe('retired Bosun command surface', () => {
  test.each(PUBLIC_COMMAND_SURFACES)('%s does not advertise install-bosun', (file) => {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    expect(source).not.toContain('install-bosun');
  });

  test('install-daemon has no retired secondary-watchdog implementation', () => {
    const source = readFileSync(resolve(ROOT, 'install-daemon.ts'), 'utf8');
    expect(source).not.toMatch(/bosun|pd-bosun/i);
  });
});
