/**
 * `pd install-bosun` is retired. Bosun (ADR-0036) is an optional legacy
 * watchdog; since v3.28 a supported install has exactly one lifecycle
 * supervisor, and the release archives and Homebrew `post_install` deliberately
 * do not install Bosun. Wiring it is an installer-internal step
 * (`install-daemon.ts install-bosun`), not a verb a user is invited to type.
 *
 * This is a ratchet over the PUBLIC command surface only: the dispatcher's verb
 * list, the three shell completions, the parity manifest, the compiled-CLI
 * surface sweep, the README, the doctor hint, and the help-coverage list. The
 * internal installer entry point is deliberately NOT listed — it still exists
 * and is still called.
 */
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
  'cli/commands/diagnostics.ts',
  'scripts/e2e-compiled-cli-surface.sh',
  'tests/unit/help-topic-aliases.test.js',
];

describe('retired Bosun command surface', () => {
  test.each(PUBLIC_COMMAND_SURFACES)('%s does not advertise install-bosun', (file) => {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    expect(source).not.toContain('install-bosun');
  });
});
