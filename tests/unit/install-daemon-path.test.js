import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Tests are in tests/unit/ — two directories up from the repo root
const REPO_ROOT = join(__dirname, '../..');

describe('daemon installer service PATH', () => {
  test('keeps the Codex app CLI visible to the macOS LaunchAgent', () => {
    const source = readFileSync(join(REPO_ROOT, 'install-daemon.ts'), 'utf8');

    expect(source).toContain('/Applications/Codex.app/Contents/Resources');
    expect(source).toContain('servicePath(...daemon.pathDirs, dirname(NODE_PATH))');
  });

  test('installs a binary daemon by default instead of hardcoding tsx server.ts', () => {
    const source = readFileSync(join(REPO_ROOT, 'install-daemon.ts'), 'utf8');

    expect(source).toContain('resolveDaemonLaunchCommand(__dirname)');
    expect(source).toContain('resolveDistributionRoot(MODULE_DIR)');
    expect(source).not.toContain('<string>${TSX_PATH}</string>');
    expect(source).not.toContain('<string>${SERVER_PATH}</string>');
    expect(source).toContain('PORT_DADDY_RESOURCE_DIR');
  });

  test('detects the Homebrew daemon service and skips creating a duplicate launchd job', () => {
    const source = readFileSync(join(REPO_ROOT, 'install-daemon.ts'), 'utf8');

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

  // ─── Backend bin resolver integration ────────────────────────────────────

  test('calls installTimeResolve at install time and injects extraDirs into daemon.pathDirs', () => {
    const source = readFileSync(join(REPO_ROOT, 'install-daemon.ts'), 'utf8');

    // Must import the resolver.
    expect(source).toContain('installTimeResolve');
    expect(source).toContain('backend-bin-resolver');

    // Must call it and capture extraDirs.
    expect(source).toContain('const { extraDirs }');
    expect(source).toContain('installTimeResolve()');

    // Must merge extraDirs into pathDirs BEFORE plist generation.
    // The plist generation is the `installMacOS(daemon)` call — everything
    // before that call must contain the pathDirs spread.
    const installMacOSIdx = source.indexOf('installMacOS(daemon)');
    const extraDirsIdx = source.indexOf('extraDirs');
    expect(extraDirsIdx).toBeGreaterThan(-1);
    expect(extraDirsIdx).toBeLessThan(installMacOSIdx);
  });

  test('extraDirs are spread into daemon.pathDirs before the plist write', () => {
    const source = readFileSync(join(REPO_ROOT, 'install-daemon.ts'), 'utf8');

    // The merge pattern: daemon = { ...daemon, pathDirs: [...daemon.pathDirs, ...extraDirs] }
    // (exact syntax may vary, but all three must appear in order before installMacOS)
    expect(source).toContain('...daemon.pathDirs');
    expect(source).toContain('...extraDirs');
  });
});
