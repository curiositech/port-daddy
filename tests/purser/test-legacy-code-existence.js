import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DAEMON_TS = join(__dirname, '../../cli/commands/daemon.ts');
const FRESHNESS_TS = join(__dirname, '../../cli/utils/freshness.ts');
const CLI_FRESHNESS_TEST = join(__dirname, '../../tests/unit/cli-freshness.test.js');

describe('legacy code existence checks', () => {
  test('should not contain install-bosun references in daemon.ts', () => {
    const content = readFileSync(DAEMON_TS, 'utf-8');
    expect(content).not.toMatch(/install-bosun/g);
  });

  test('should not contain install-bosun references in freshness.ts', () => {
    const content = readFileSync(FRESHNESS_TS, 'utf-8');
    expect(content).not.toMatch(/install-bosun/g);
  });

  test('should not contain install-bosun references in cli-freshness.test.js', () => {
    const content = readFileSync(CLI_FRESHNESS_TEST, 'utf-8');
    expect(content).not.toMatch(/install-bosun/g);
  });
});