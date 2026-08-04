import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { daemonBinaryName, resolveDaemonLaunchCommand } from '../../shared/daemon-binary.js';

describe('daemon binary launch contract', () => {
  const scratchRoot = join(homedir(), 'coding', 'tmp');
  test('dedicated daemon build uses an argv-dispatch wrapper for the integrity helper', () => {
    const buildScript = readFileSync(join(process.cwd(), 'scripts', 'build-daemon-binary.mjs'), 'utf8');
    const entrypoint = readFileSync(join(process.cwd(), 'bin', 'port-daddy-daemon-bundle.ts'), 'utf8');

    expect(buildScript).toContain("const ENTRYPOINT = 'bin/port-daddy-daemon-bundle.ts'");
    expect(buildScript).not.toContain("['build', '--compile', 'server.ts'");
    expect(entrypoint).toContain("process.argv[2] === '__db_integrity_check'");
    expect(entrypoint.indexOf("await import('../lib/db-integrity.js')"))
      .toBeLessThan(entrypoint.indexOf("await import('../server.js')"));
    expect(buildScript).toContain("OUTFILE, ['__db_integrity_check', dbPath]");
    expect(buildScript).toContain("schema !== 'port-daddy.db-integrity-proof.v1'");
  });

  test('resolves the distributed daemon binary when present', () => {
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, 'pd-daemon-binary-'));
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
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, 'pd-daemon-source-refuse-'));

    expect(() => resolveDaemonLaunchCommand(root, { env: {} }))
      .toThrow(/daemon binary missing/);
  });

  test('allows source fallback only behind the development override', () => {
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, 'pd-daemon-source-allow-'));

    const command = resolveDaemonLaunchCommand(root, {
      env: { PORT_DADDY_ALLOW_SOURCE_DAEMON: '1' },
    });

    expect(command.mode).toBe('source');
    expect(command.program).toBe(join(root, 'node_modules', '.bin', 'tsx'));
    expect(command.args).toEqual([join(root, 'server.ts')]);
  });

  test('single binary mode self-hosts the daemon before source fallback', () => {
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, 'pd-daemon-self-'));

    const command = resolveDaemonLaunchCommand(root, {
      env: { PORT_DADDY_CAN_SELF_DAEMON: '1' },
    });

    expect(command.mode).toBe('self');
    expect(command.program).toBe(process.execPath);
    expect(command.args).toEqual(['__daemon']);
    expect(command.env?.PORT_DADDY_RESOURCE_DIR).toBe(root);
  });
});
