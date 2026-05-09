import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('daemon installer service PATH', () => {
  test('keeps the Codex app CLI visible to the macOS LaunchAgent', () => {
    const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');

    expect(source).toContain('/Applications/Codex.app/Contents/Resources');
    expect(source).toContain('servicePath(...daemon.pathDirs, dirname(NODE_PATH))');
  });

  test('installs a binary daemon by default instead of hardcoding tsx server.ts', () => {
    const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');

    expect(source).toContain('resolveDaemonLaunchCommand(__dirname)');
    expect(source).toContain('resolveDistributionRoot(MODULE_DIR)');
    expect(source).not.toContain('<string>${TSX_PATH}</string>');
    expect(source).not.toContain('<string>${SERVER_PATH}</string>');
    expect(source).toContain('PORT_DADDY_RESOURCE_DIR');
  });
});
