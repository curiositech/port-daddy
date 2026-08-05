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

    expect(source.match(/<key>PORT_DADDY_DB<\/key>/g)).toHaveLength(2);
    expect(source).toContain("join(homedir(), '.port-daddy', 'port-registry.db')");
  });

  test('detects the Homebrew daemon service and skips creating a duplicate launchd job', () => {
    const source = readFileSync(join(process.cwd(), 'install-daemon.ts'), 'utf8');

    // The brew services supervisor label is the dedup signal.
    expect(source).toContain("'homebrew.mxcl.port-daddy'");
    expect(source).toContain('function brewDaemonServiceLoaded');
    // installMacOS must consult the detector and short-circuit the daemon plist
    // write.
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
  // the next top-level `function` keyword so assertions remain scoped to one
  // generator instead of passing because an unrelated template happens to
  // contain the same launchd keys.
  function extractFunctionBody(source, name) {
    const start = source.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`could not find function ${name} in install-daemon.ts`);
    // Match the next top-level function boundary whether it is declared
    // `function ` or `export function `.
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

});
