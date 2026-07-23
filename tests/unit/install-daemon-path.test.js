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

  test('pins generated launchd surfaces to the canonical user DB', () => {
    const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');

    expect(source.match(/<key>PORT_DADDY_DB<\/key>/g)).toHaveLength(3);
    expect(source).toContain("join(homedir(), '.port-daddy', 'port-registry.db')");
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

  // Extracts the body of a top-level `function <name>(` declaration up to
  // the next top-level `function` keyword, so assertions can be scoped to
  // ONE plist generator instead of matching anywhere in the file. Needed
  // because generateBosunPlist() already contains an identical
  // `<key>ThrottleInterval</key>`/`<integer>15</integer>` pair — a
  // whole-file substring check would pass even if generatePlist() itself
  // never got one (caught by Copilot review on PR #879).
  function extractFunctionBody(source, name) {
    const start = source.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`could not find function ${name} in install-daemon.ts`);
    // Match the next top-level function boundary whether it's declared
    // `function ` or `export function ` (some plist generators are exported
    // for direct testing — see generateBosunPlist/jscSafeModeEnvXml).
    const rest = source.slice(start + 1);
    const nextMatch = rest.match(/\n(?:export )?function /);
    return nextMatch ? source.slice(start, start + 1 + nextMatch.index) : source.slice(start);
  }

  test('sets a ThrottleInterval on the generated DAEMON plist specifically (not just anywhere in the file)', () => {
    const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');
    const generatePlistBody = extractFunctionBody(source, 'generatePlist');
    expect(generatePlistBody).toContain('<key>ThrottleInterval</key>');
    expect(generatePlistBody).toContain('<integer>15</integer>');
  });

  // 2026-07-08 (issue #676 investigation): experimental, clearly-labeled
  // mitigation for the Bun 1.2.21 JSC-GC crash family — see jscSafeModeEnvXml
  // in install-daemon.ts for the full reasoning and honest-scope caveat.
  describe('JSC concurrent GC/JIT safe-mode env vars', () => {
    test('generatePlist wires BUN_JSC_useConcurrentGC/JIT=0 by default', async () => {
      delete process.env.PORT_DADDY_JSC_SAFE_MODE;
      const mod = await import('../../install-daemon.js');
      expect(mod.jscSafeModeEnvXml()).toContain('BUN_JSC_useConcurrentGC');
      expect(mod.jscSafeModeEnvXml()).toContain('BUN_JSC_useConcurrentJIT');
      expect(mod.jscSafeModeEnvXml()).toContain('<string>0</string>');
    });

    test('PORT_DADDY_JSC_SAFE_MODE=0 opts out and emits nothing', async () => {
      process.env.PORT_DADDY_JSC_SAFE_MODE = '0';
      try {
        const mod = await import('../../install-daemon.js');
        expect(mod.jscSafeModeEnvXml()).toBe('');
      } finally {
        delete process.env.PORT_DADDY_JSC_SAFE_MODE;
      }
    });

    test('the plist template actually interpolates jscSafeModeEnvXml() into EnvironmentVariables', () => {
      const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');
      expect(source).toContain('${jscSafeModeEnvXml()}');
    });
  });

  // 2026-07-08 (issue #676 investigation, coordinator-directed follow-up):
  // core/pd-bosun already implements exactly the "detect a stale heartbeat,
  // force `launchctl kickstart` within seconds" circuit breaker a daemon
  // exposed to native crashes needs (5s poll / 30s staleness threshold by
  // default). But generateBosunPlist() never told Bosun WHICH launchd label
  // to kickstart, so it always defaulted to `com.portdaddy.daemon` — a label
  // that does not exist under a Homebrew-managed install. installMacOS()'s
  // own brew-detected branch installs Bosun as a complementary watcher
  // specifically for that case, so Bosun's restart action was silently
  // targeting a job that was never there: an already-built safety net that
  // was a no-op on exactly the machine (a brew install) it was meant to help.
  describe('Bosun watchdog targets the daemon launchd label that is actually supervising it', () => {
    test('generateBosunPlist sets PORT_DADDY_BOSUN_DAEMON_LABEL to whatever label is passed in', async () => {
      const mod = await import('../../install-daemon.js');
      const brewPlist = mod.generateBosunPlist(mod.BREW_DAEMON_LABEL);
      expect(brewPlist).toContain('<key>PORT_DADDY_BOSUN_DAEMON_LABEL</key>');
      expect(brewPlist).toContain('<string>homebrew.mxcl.port-daddy</string>');

      const selfInstalledPlist = mod.generateBosunPlist(mod.PLIST_LABEL);
      expect(selfInstalledPlist).toContain('<string>com.portdaddy.daemon</string>');
      expect(selfInstalledPlist).not.toContain('homebrew.mxcl.port-daddy');
    });

    test('the brew-detected branch in installMacOS passes BREW_DAEMON_LABEL to installBosunMacOS', () => {
      const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');
      const guardIdx = source.indexOf('if (brewDaemonServiceLoaded())');
      expect(guardIdx).toBeGreaterThan(-1);
      // Scope to the brew-detected branch's body specifically (up to its
      // closing brace, i.e. the next `stopExistingCanonicalDaemon()` call
      // that begins the non-brew path) so this can't pass by matching the
      // OTHER call site's argument instead.
      const nonBrewPathIdx = source.indexOf('stopExistingCanonicalDaemon()', guardIdx);
      const brewBranchBody = source.slice(guardIdx, nonBrewPathIdx);
      expect(brewBranchBody).toContain('installBosunMacOS(BREW_DAEMON_LABEL)');
    });

    test('the non-brew (self-installed) path passes PLIST_LABEL to installBosunMacOS, not BREW_DAEMON_LABEL', () => {
      const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');
      const nonBrewPathIdx = source.indexOf('stopExistingCanonicalDaemon()');
      expect(nonBrewPathIdx).toBeGreaterThan(-1);
      const restOfFunction = source.slice(nonBrewPathIdx);
      expect(restOfFunction).toContain('installBosunMacOS(PLIST_LABEL)');
    });
  });
});

// Regression (3.26.2/.3): the Bosun watchdog plist embedded a VERSIONED Cellar keg path
// (.../3.26.1_2/bin/pd-bosun), which the next `brew upgrade` deletes → launchd ExecStart points
// at a dead keg (EX_CONFIG) and a crashing daemon stops auto-restarting. The plist must instead
// reference the version-STABLE `<prefix>/bin/pd-bosun` symlink that brew repoints every upgrade.
describe('Bosun plist references the version-stable symlink, not a versioned Cellar keg', () => {
  test('a brew KEG execPath (post_install) maps to <prefix>/bin/pd-bosun', async () => {
    const { stableBosunPathFromExec } = await import('../../install-daemon.js');
    expect(stableBosunPathFromExec('/opt/homebrew/Cellar/port-daddy/3.26.2_2/bin/port-daddy', () => true))
      .toBe('/opt/homebrew/bin/pd-bosun');
  });

  test('a brew SYMLINK execPath maps to the co-located <prefix>/bin/pd-bosun', async () => {
    const { stableBosunPathFromExec } = await import('../../install-daemon.js');
    expect(stableBosunPathFromExec('/opt/homebrew/bin/port-daddy', () => true))
      .toBe('/opt/homebrew/bin/pd-bosun');
  });

  test('returns null when the stable symlink is absent, so non-brew/dev falls back to the resolver', async () => {
    const { stableBosunPathFromExec } = await import('../../install-daemon.js');
    expect(stableBosunPathFromExec('/usr/local/opt/node/bin/node', () => false)).toBeNull();
  });
});
