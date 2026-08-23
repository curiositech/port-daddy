import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  daemonBinaryName,
  jscSafeModeEnv,
  mergeJscSafeModeEnv,
  resolveDaemonLaunchCommand,
  resolveOnnxRuntimeNativeLaunchEnv,
} from '../../shared/daemon-binary.js';

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

  test('keeps packaged macOS semantic runtime out of DYLD environment injection', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-daemon-native-env-'));
    const binaryPath = join(root, 'dist', 'daemon', daemonBinaryName('darwin'));
    const nativeDir = join(root, 'dist', 'native', 'onnxruntime-node', 'darwin-arm64');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'libonnxruntime.1.dylib'), 'runtime');

    expect(resolveOnnxRuntimeNativeLaunchEnv(root, binaryPath, {
      DYLD_FALLBACK_LIBRARY_PATH: '/operator/lib',
    }, 'darwin', 'arm64')).toEqual({});
  });

  test('injects the packaged Linux semantic runtime before daemon process start', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-daemon-native-linux-env-'));
    const binaryPath = join(root, 'dist', 'daemon', daemonBinaryName('linux'));
    const nativeDir = join(root, 'dist', 'native', 'onnxruntime-node', 'linux-x64');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'libonnxruntime.so.1'), 'runtime');

    expect(resolveOnnxRuntimeNativeLaunchEnv(root, binaryPath, {
      LD_LIBRARY_PATH: '/operator/lib',
    }, 'linux', 'x64')).toEqual({
      LD_LIBRARY_PATH: `${nativeDir}:/operator/lib`,
    });
  });

  test('rejects a file that only occupies the packaged runtime directory path', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-daemon-native-file-'));
    const binaryPath = join(root, 'dist', 'daemon', daemonBinaryName('darwin'));
    const nativePath = join(root, 'dist', 'native', 'onnxruntime-node', 'darwin-arm64');
    mkdirSync(join(nativePath, '..'), { recursive: true });
    writeFileSync(nativePath, 'not a directory');

    expect(resolveOnnxRuntimeNativeLaunchEnv(root, binaryPath, {}, 'darwin', 'arm64')).toEqual({});
  });
});

describe('JSC safe-mode launch environment', () => {
  test('enables the pinned Bun runtime mitigation by default', () => {
    expect(jscSafeModeEnv({})).toEqual({
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
  });

  test('supports the existing explicit opt-out', () => {
    expect(jscSafeModeEnv({ PORT_DADDY_JSC_SAFE_MODE: '0' })).toEqual({});
    expect(jscSafeModeEnv({ PORT_DADDY_JSC_SAFE_MODE: '1' })).toEqual({
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
  });

  test('applies safe mode after ordinary child-environment overlays', () => {
    expect(mergeJscSafeModeEnv(
      { OTHER: 'base', BUN_JSC_useConcurrentGC: '1' },
      { OTHER: 'profile', BUN_JSC_useConcurrentJIT: '1' },
    )).toMatchObject({
      OTHER: 'profile',
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
  });

  test('honors only the exact opt-out from the fully merged child environment', () => {
    expect(mergeJscSafeModeEnv(
      { PORT_DADDY_JSC_SAFE_MODE: '1', BUN_JSC_useConcurrentGC: 'base' },
      { PORT_DADDY_JSC_SAFE_MODE: '0', BUN_JSC_useConcurrentJIT: 'profile' },
    )).toMatchObject({
      PORT_DADDY_JSC_SAFE_MODE: '0',
      BUN_JSC_useConcurrentGC: 'base',
      BUN_JSC_useConcurrentJIT: 'profile',
    });

    for (const invalidOptOut of [undefined, '', 'false', '0 ', 'invalid']) {
      expect(mergeJscSafeModeEnv({
        PORT_DADDY_JSC_SAFE_MODE: invalidOptOut,
        BUN_JSC_useConcurrentGC: '1',
        BUN_JSC_useConcurrentJIT: '1',
      })).toMatchObject({
        BUN_JSC_useConcurrentGC: '0',
        BUN_JSC_useConcurrentJIT: '0',
      });
    }
  });

  test('every non-launchd long-lived Bun child routes through the executable merge boundary', () => {
    const daemonSource = readFileSync(join(process.cwd(), 'cli/commands/daemon.ts'), 'utf8');
    const spawnDaemonStart = daemonSource.indexOf('function spawnDaemon(');
    const foregroundStart = daemonSource.indexOf("spawn(process.execPath, ['start', '--foreground']");

    expect(spawnDaemonStart).toBeGreaterThan(-1);
    expect(daemonSource.slice(spawnDaemonStart, spawnDaemonStart + 500)).toContain('mergeJscSafeModeEnv(');
    expect(foregroundStart).toBeGreaterThan(-1);
    expect(daemonSource.slice(foregroundStart, foregroundStart + 250)).toContain('mergeJscSafeModeEnv(process.env)');

    const harbormasterSource = readFileSync(join(process.cwd(), 'cli/commands/harbormaster.ts'), 'utf8');
    const harbormasterStart = harbormasterSource.indexOf("'harbormaster', 'start', '--foreground'");
    expect(harbormasterStart).toBeGreaterThan(-1);
    expect(harbormasterSource.slice(harbormasterStart, harbormasterStart + 300)).toContain('mergeJscSafeModeEnv(process.env)');
  });
});
