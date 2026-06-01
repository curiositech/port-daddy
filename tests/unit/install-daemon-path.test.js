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

  test('detects the Homebrew daemon service and skips creating a duplicate launchd job', () => {
    const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');

    // The brew services supervisor label is the dedup signal.
    expect(source).toContain("'homebrew.mxcl.port-daddy'");
    expect(source).toContain('function brewDaemonServiceLoaded');
    // installMacOS must consult the detector and short-circuit the daemon plist
    // write (Bosun install still proceeds).
    expect(source).toContain('if (brewDaemonServiceLoaded())');
    expect(source).toContain('Skipping com.portdaddy.daemon launchd job');
    // The dedup branch must NOT write the daemon plist before returning. The
    // only writeFileSync(PLIST_PATH, ...) call must live after the guard.
    const guardIdx = source.indexOf('if (brewDaemonServiceLoaded())');
    const writeIdx = source.indexOf('writeFileSync(PLIST_PATH, generatePlist(daemon))');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(guardIdx);
  });
});
