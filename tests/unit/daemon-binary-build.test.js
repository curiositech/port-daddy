import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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

describe('compiled daemon smoke runtime selection', () => {
  test('uses short recoverable scratch without obsolete release commands', () => {
    const smoke = readFileSync('scripts/smoke-compiled-daemon.sh', 'utf8');

    expect(smoke).toContain('choose_free_port()');
    expect(smoke).not.toContain('SMOKE_PORT:-19876');
    expect(smoke).toContain('coding/tmp/port-daddy-smoke');
    expect(smoke).not.toContain('$ROOT_DIR/.smoke-tmp');
    expect(smoke).not.toContain('npm run');
  });

  test('follows both published endpoints when each preferred seed is occupied', () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-smoke-behavior-'));
    const fakeDaemon = join(root, 'fake-daemon.mjs');
    const shutdownMarker = join(root, 'shutdown.marker');
    writeFileSync(fakeDaemon, `#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';

const tier = process.env.PD_DAEMON_TIER || 'stable';
const identity = JSON.stringify({ daemon: { tier, canonical: tier === 'stable' } });
const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url.includes('/interrupt')) {
    response.writeHead(404).end('{}');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(request.url === '/health' || request.url === '/whoami' ? identity : '{}');
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(process.env.PORT_DADDY_PORT_FILE, String(server.address().port));
});
process.on('SIGTERM', () => server.close(() => setTimeout(() => {
  fs.appendFileSync(process.env.FAKE_SHUTDOWN_MARKER, 'stopped\\n');
  process.exit(0);
}, 100)));
`);
    chmodSync(fakeDaemon, 0o755);

    const output = execFileSync('bash', ['scripts/smoke-compiled-daemon.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        SMOKE_DAEMON_BIN: fakeDaemon,
        SMOKE_SCRATCH_BASE: join(root, 'scratch'),
        SMOKE_OCCUPY_PREFERRED: '1',
        FAKE_SHUTDOWN_MARKER: shutdownMarker,
      },
    });

    expect(output).toContain('Compiled-daemon smoke PASSED');
    expect(readFileSync(shutdownMarker, 'utf8').trim().split('\n')).toHaveLength(2);
  });
});

describe('JSC safe-mode process-start contract', () => {
  test('enables the shared mitigation unless the operator explicitly opts out', () => {
    expect(jscSafeModeEnv({})).toEqual({
      BUN_JSC_useConcurrentGC: '0',
      BUN_JSC_useConcurrentJIT: '0',
    });
    expect(jscSafeModeEnv({ PORT_DADDY_JSC_SAFE_MODE: '0' })).toEqual({});
  });

  test('launchd plist rendering is derived from the shared environment map', async () => {
    delete process.env.PORT_DADDY_JSC_SAFE_MODE;
    const { jscSafeModeEnvXml } = await import('../../install-daemon.js');
    expect(jscSafeModeEnvXml()).toBe(
      '        <key>BUN_JSC_useConcurrentGC</key>\n' +
      '        <string>0</string>\n' +
      '        <key>BUN_JSC_useConcurrentJIT</key>\n' +
      '        <string>0</string>',
    );
  });

  test('every long-lived Bun spawn path merges the shared environment map', () => {
    const daemonSource = readFileSync('cli/commands/daemon.ts', 'utf8');
    const spawnDaemon = daemonSource.slice(
      daemonSource.indexOf('function spawnDaemon('),
      daemonSource.indexOf('function spawnDaemon(') + 700,
    );
    expect(spawnDaemon).toContain('...jscSafeModeEnv()');

    const compiledReexec = daemonSource.indexOf("spawn(process.execPath, ['start', '--foreground']");
    expect(compiledReexec).toBeGreaterThan(-1);
    expect(daemonSource.slice(compiledReexec, compiledReexec + 260)).toContain('...jscSafeModeEnv()');

    const harbormasterSource = readFileSync('cli/commands/harbormaster.ts', 'utf8');
    const harbormasterSpawn = harbormasterSource.indexOf("'harbormaster', 'start', '--foreground'");
    expect(harbormasterSpawn).toBeGreaterThan(-1);
    expect(harbormasterSource.slice(harbormasterSpawn, harbormasterSpawn + 260)).toContain('...jscSafeModeEnv()');
  });
});
