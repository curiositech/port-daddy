import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The CLI now has a side-effect suppression guard, so the help dispatch helper
// is imported and executed below. Source text remains useful for table wiring.
const ROOT = join(import.meta.dirname, '../..');
const cliSource = readFileSync(join(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');
let shouldDispatchHelpToHandler;

beforeAll(async () => {
  process.env.PORT_DADDY_SUPPRESS_CLI_MAIN = '1';
  ({ shouldDispatchHelpToHandler } = await import('../../bin/port-daddy-cli.ts'));
});

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

  test('diagnostic verbs reach their own precise help instead of global help', () => {
    for (const command of ['attention', 'sitrep', 'squid']) {
      expect(shouldDispatchHelpToHandler(command)).toBe(true);
    }
    expect(shouldDispatchHelpToHandler('claim')).toBe(false);
    expect(cliSource).toMatch(/\bhooks:\s*'setup'/);
  });

  test('`pd send` is wired as a top-level verb routing to the durable inbox send', () => {
    expect(cliSource).toMatch(/case 'send':\s*\n\s*await handleInbox\('send', positional, options\)/);
  });

  test('main help surfaces the durable directed primitives', () => {
    expect(cliSource).toContain('pd send');
    expect(cliSource).toContain('Read direct messages sent to you');
  });
});
