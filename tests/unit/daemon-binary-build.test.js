import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { daemonBinaryName, resolveDaemonLaunchCommand } from '../../shared/daemon-binary.js';

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
