import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
