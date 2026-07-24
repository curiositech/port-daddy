import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { daemonBinaryName, resolveDaemonLaunchCommand, jscSafeModeEnv } from '../../shared/daemon-binary.js';

describe('daemon binary launch contract', () => {
  test('resolves the distributed daemon binary when present', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-daemon-binary-'));
    const binaryPath = join(root, 'dist', 'daemon', daemonBinaryName());
    mkdirSync(join(root, 'dist', 'daemon'), { recursive: true });
    writeFileSync(binaryPath, '');

    const command = resolveDaemonLaunchCommand(root, { env: {} });

    expect(command.mode).toBe('binary');
    expect(command.program).toBe(binaryPath);
    expect(command.args).toEqual([]);
    expect(command.env?.PORT_DADDY_RESOURCE_DIR).toBe(root);
  });

  test('refuses source daemon fallback unless explicitly allowed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-daemon-source-refuse-'));

    expect(() => resolveDaemonLaunchCommand(root, { env: {} }))
      .toThrow(/daemon binary missing/);
  });

  test('allows source fallback only behind the development override', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-daemon-source-allow-'));

    const command = resolveDaemonLaunchCommand(root, {
      env: { PORT_DADDY_ALLOW_SOURCE_DAEMON: '1' },
    });

    expect(command.mode).toBe('source');
    expect(command.program).toBe(join(root, 'node_modules', '.bin', 'tsx'));
    expect(command.args).toEqual([join(root, 'server.ts')]);
  });

  test('single binary mode self-hosts the daemon before source fallback', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-daemon-self-'));

    const command = resolveDaemonLaunchCommand(root, {
      env: { PORT_DADDY_CAN_SELF_DAEMON: '1' },
    });

    expect(command.mode).toBe('self');
    expect(command.program).toBe(process.execPath);
    expect(command.args).toEqual(['__daemon']);
    expect(command.env?.PORT_DADDY_RESOURCE_DIR).toBe(root);
  });
});

// 2026-07-23 (issue #676): the Bun 1.2.21 JSC concurrent-GC segfault only stays mitigated if the
// long-lived daemon process INHERITS BUN_JSC_useConcurrentGC/JIT=0 — JSC reads them once at init.
// The launchd plist set them, but CLI-started daemons (pd start, the --foreground re-exec,
// harbormaster) inherited a plain process.env and ran UNMITIGATED. jscSafeModeEnv() is the shared
// single source of truth every spawn path now merges in.
describe('JSC safe-mode env (#676) is the shared source of truth for every daemon spawn path', () => {
  test('jscSafeModeEnv() returns concurrent-GC/JIT=0 by default', () => {
    expect(jscSafeModeEnv({})).toEqual({
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
  });

  test('PORT_DADDY_JSC_SAFE_MODE=0 opts out to an empty env (nothing to merge)', () => {
    expect(jscSafeModeEnv({ PORT_DADDY_JSC_SAFE_MODE: '0' })).toEqual({});
  });

  test('any other PORT_DADDY_JSC_SAFE_MODE value keeps the mitigation on', () => {
    expect(jscSafeModeEnv({ PORT_DADDY_JSC_SAFE_MODE: '1' }).BUN_JSC_useConcurrentGC).toBe('0');
  });

  test('jscSafeModeEnvXml() renders byte-identically from jscSafeModeEnv()', async () => {
    delete process.env.PORT_DADDY_JSC_SAFE_MODE;
    const { jscSafeModeEnvXml } = await import('../../install-daemon.js');
    expect(jscSafeModeEnvXml()).toBe(
      '        <key>BUN_JSC_useConcurrentGC</key>\n' +
        '        <string>0</string>\n' +
        '        <key>BUN_JSC_useConcurrentJIT</key>\n' +
        '        <string>0</string>',
    );
  });

  // Source-level guards: every process that becomes a long-lived Bun daemon must layer
  // jscSafeModeEnv() into the spawned child's env. A regression that drops the merge on any
  // one path silently reintroduces the crash on daemons NOT started by launchd.
  test('cli/commands/daemon.ts merges jscSafeModeEnv() into spawnDaemon AND the --foreground re-exec', () => {
    const src = readFileSync(join(process.cwd(), 'cli/commands/daemon.ts'), 'utf8');
    expect(src).toContain("import { resolveDaemonLaunchCommand, isBunCompiledRuntime, jscSafeModeEnv");
    // spawnDaemon() base-env merge
    const spawnDaemonBody = src.slice(src.indexOf('function spawnDaemon('), src.indexOf('function spawnDaemon(') + 600);
    expect(spawnDaemonBody).toContain('...jscSafeModeEnv()');
    // the isBunCompiledBinary() re-exec path (the only chance to set BUN_JSC for that daemon)
    const reExecIdx = src.indexOf("spawn(process.execPath, ['start', '--foreground']");
    expect(reExecIdx).toBeGreaterThan(-1);
    expect(src.slice(reExecIdx, reExecIdx + 220)).toContain('...jscSafeModeEnv()');
  });

  test('cli/commands/harbormaster.ts merges jscSafeModeEnv() into its detached daemon spawn', () => {
    const src = readFileSync(join(process.cwd(), 'cli/commands/harbormaster.ts'), 'utf8');
    expect(src).toContain("import { jscSafeModeEnv } from '../../shared/daemon-binary.js'");
    const spawnIdx = src.indexOf("'harbormaster', 'start', '--foreground'");
    expect(spawnIdx).toBeGreaterThan(-1);
    expect(src.slice(spawnIdx, spawnIdx + 220)).toContain('...jscSafeModeEnv()');
  });
});
