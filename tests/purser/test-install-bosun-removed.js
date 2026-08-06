import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DAEMON_TS = join(__dirname, '../../cli/commands/daemon.ts');
const FRESHNESS_TS = join(__dirname, '../../cli/utils/freshness.ts');

describe('install-bosun removal verification', () => {
  test('should not contain install-bosun command handler in daemon.ts', () => {
    const content = readFileSync(DAEMON_TS, 'utf-8');
    expect(content).not.toContain("'install-bosun'");
    expect(content).not.toContain('runInstallDaemonCli');
  });

  test('should not contain install-bosun in freshness skip list', () => {
    const content = readFileSync(FRESHNESS_TS, 'utf-8');
    expect(content).not.toContain("'install-bosun'");
    expect(content).not.toContain('Homebrew');
  });
});