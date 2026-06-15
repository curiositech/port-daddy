import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source-text assertions (NOT an import): importing bin/port-daddy-cli.ts runs
// `void main()` at module load, so — like tests/unit/cli-short-aliases.test.js —
// we read the CLI as text and assert the wiring. This guards the messaging
// discoverability fix: `pd send` as a top-level verb, and `pd <cmd> --help`
// resolving to the messaging TOPIC instead of falling through to global help.
const ROOT = join(import.meta.dirname, '../..');
const cliSource = readFileSync(join(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');

describe('messaging discoverability', () => {
  test('HELP_TOPIC_ALIASES maps the messaging family to the messaging topic', () => {
    for (const cmd of ['inbox', 'send', 'tube', 'pub', 'sub', 'channels', 'wait']) {
      expect(cliSource).toMatch(new RegExp(`\\b${cmd}:\\s*'messaging'`));
    }
  });

  test('the --help router consults HELP_TOPIC_ALIASES (no silent fall-through)', () => {
    // Before the fix this was `TOPIC_HELP[command as string]` only, so
    // `pd inbox --help` (command='inbox', not a topic) fell back to buildHelp().
    expect(cliSource).toMatch(
      /TOPIC_HELP\[command as string\]\s*\?\?\s*TOPIC_HELP\[HELP_TOPIC_ALIASES\[command as string\]\]/
    );
  });

  test('`pd send` is wired as a top-level verb routing to the durable inbox send', () => {
    expect(cliSource).toMatch(/case 'send':\s*\n\s*await handleInbox\('send', positional, options\)/);
  });

  test('main help surfaces the durable directed primitives', () => {
    expect(cliSource).toContain('pd send');
    expect(cliSource).toContain('Read direct messages sent to you');
  });
});
