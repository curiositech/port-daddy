import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jest } from '@jest/globals';

const ROOT = join(import.meta.dirname, '../..');
const cliSource = readFileSync(join(ROOT, 'bin/port-daddy-cli.ts'), 'utf8');
const manifest = JSON.parse(readFileSync(join(ROOT, 'features.manifest.json'), 'utf8'));

function hasCommandCase(command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`case\\s+['"\`]${escaped}['"\`]\\s*:`).test(cliSource);
}

describe('operator short aliases', () => {
  test('manifest-advertised single-letter sugar aliases are wired in the CLI switch', () => {
    const sugarCommands = manifest.features.sugar.cli;
    const advertisedAliases = sugarCommands.filter((command) => ['n', 'u', 'd'].includes(command));

    expect(advertisedAliases).toEqual(['n', 'u', 'd']);
    expect(advertisedAliases.filter((command) => !hasCommandCase(command))).toEqual([]);
  });

  test('alias truth matches the shipped shell completions', () => {
    const bashCompletions = readFileSync(join(ROOT, 'completions/port-daddy.bash'), 'utf8');
    const fishCompletions = readFileSync(join(ROOT, 'completions/port-daddy.fish'), 'utf8');
    const zshCompletions = readFileSync(join(ROOT, 'completions/port-daddy.zsh'), 'utf8');

    for (const command of ['n', 'u', 'd']) {
      expect(bashCompletions).toContain(command);
      expect(fishCompletions).toContain(command);
      expect(zshCompletions).toContain(`${command}:`);
      expect(hasCommandCase(command)).toBe(true);
    }
  });
});

describe('operator repeatable flags', () => {
  test('--files accumulates across repeated CLI flag occurrences', () => {
    // 'tag' joined the repeatable set for `pd roadmap upsert --tag a --tag b`
    // (Jira-grade roadmap items, 2026-08-22).
    expect(cliSource).toMatch(/REPEATABLE_FLAGS[\s\S]*new Set\(\['files', 'client-arg', 'codex-config', 'tag'\]\)/);
    expect(cliSource).toContain('options[key] = [existing, value as string];');
  });

  test('the retained begin handler forwards every file to the daemon without writing real context', async () => {
    const fetchModule = await import('../../cli/utils/fetch.js');
    const contextModule = await import('../../cli/utils/current-context.js');
    const beginFetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, agentId: 'fixture-agent', sessionId: 'fixture-session' }),
    }));
    const writeContext = jest.fn();
    const output = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.unstable_mockModule('../../cli/utils/fetch.js', () => ({ ...fetchModule, pdFetch: beginFetch }));
    jest.unstable_mockModule('../../cli/utils/current-context.js', () => ({ ...contextModule, writeCurrentContext: writeContext }));

    try {
      await jest.isolateModulesAsync(async () => {
        const { handleBegin } = await import('../../cli/commands/sugar.js');
        await handleBegin('Verify repeatable files', ['src/positional.ts'], {
          files: ['src/first.ts', 'src/second.ts'],
          identity: 'fixture:tests:repeatable-files',
          lifecycle: 'durable',
          sidequest: 'Test-only begin request fixture',
          'allow-main-worktree': true,
          json: true,
        });
      });
      expect(beginFetch).toHaveBeenCalledTimes(1);
      expect(beginFetch).toHaveBeenCalledWith('/sugar/begin', expect.objectContaining({ method: 'POST' }));
      expect(JSON.parse(beginFetch.mock.calls[0][1].body)).toMatchObject({
        files: ['src/first.ts', 'src/second.ts', 'src/positional.ts'],
        lifecycle: 'durable',
        identity: 'fixture:tests:repeatable-files',
      });
      expect(writeContext).toHaveBeenCalledTimes(1);
    } finally {
      jest.unstable_unmockModule('../../cli/utils/fetch.js');
      jest.unstable_unmockModule('../../cli/utils/current-context.js');
      output.mockRestore();
    }
  });
});
