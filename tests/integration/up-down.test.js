/**
 * Integration Tests for `port-daddy up` and `port-daddy down`
 *
 * Spawns the CLI with a temp .portdaddyrc containing two minimal HTTP servers,
 * verifies ports are claimed, services respond, env vars are injected,
 * then sends SIGTERM and verifies ports are released.
 *
 * Uses the ephemeral test daemon (started by Jest globalSetup).
 */

import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { request, getDaemonState } from '../helpers/integration-setup.js';

const CLI_PATH = join(import.meta.dirname, '../../bin/port-daddy-cli.ts');
const TSX_PATH = join(import.meta.dirname, '../../node_modules/.bin/tsx');

// Helper: get the PID file path for a given directory (matches CLI logic)
function getPidFilePath(dir) {
  const hash = createHash('sha256').update(dir).digest('hex').substring(0, 12);
  return join(tmpdir(), `port-daddy-up-${hash}.pid`);
}

// Inline server script that reads PORT from env and responds with JSON
const MINI_SERVER_SCRIPT = `
import { createServer } from 'node:http';

const PORT = process.env.PORT || 0;
const NAME = process.env.SERVICE_NAME || 'unknown';

// Collect all env vars that look like sibling injections
const siblings = {};
for (const [key, val] of Object.entries(process.env)) {
  if (key.endsWith('_PORT') || key.endsWith('_URL')) {
    siblings[key] = val;
  }
}

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: NAME, port: PORT, siblings }));
  } else {
    res.writeHead(200);
    res.end('ok');
  }
});

server.listen(PORT, () => {
  console.log(NAME + ' listening on port ' + PORT);
});
`;

// Helper: get claimed services from the ephemeral daemon
async function getClaimedServices() {
  try {
    const res = await request('/services');
    if (res.ok) {
      return res.data.services || [];
    }
  } catch { /* daemon unreachable */ }
  return [];
}

// Helper: wait for a condition with timeout
function waitForOutput(child, pattern, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(
        `Timed out waiting for "${pattern}" after ${timeoutMs}ms.\nOutput so far:\n${output}`
      ));
    }, timeoutMs);

    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(pattern)) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.stderr.off('data', onStderr);
        resolve(output);
      }
    };

    const onStderr = (chunk) => {
      output += chunk.toString();
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onStderr);

    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(
        `Process exited with code ${code} before pattern "${pattern}" appeared.\nOutput:\n${output}`
      ));
    });
  });
}

// Helper: try to fetch from a local port
async function fetchLocal(port, path = '/health', retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1',
          port,
          path,
          timeout: 2000
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve({ ok: res.statusCode === 200, json: async () => JSON.parse(data) }); }
            catch { reject(new Error('Invalid JSON')); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      });
      if (res.ok) return await res.json();
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

// Helper: kill process and wait for exit
function killAndWait(child, signal = 'SIGTERM', timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve('already-dead');
      return;
    }

    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* no process group */ }
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      resolve('timeout');
    }, timeoutMs);

    child.on('exit', () => {
      clearTimeout(timer);
      resolve('exited');
    });

    try { child.kill(signal); } catch { resolve('already-dead'); }
  });
}

// Helper: forcefully kill entire process group (for afterEach cleanup)
function killProcessGroup(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* no process group or already dead */ }
  try { child.kill('SIGKILL'); } catch { /* already dead */ }
}

/**
 * Build the env for spawned CLI processes — routes through ephemeral daemon's socket.
 */
function cliEnv() {
  const { sockPath, dbPath } = getDaemonState();
  return {
    ...process.env,
    PORT_DADDY_SOCK: sockPath,
    PORT_DADDY_DB: dbPath,
    PORT_DADDY_URL: '',
    PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
    NO_COLOR: '1'
  };
}

describe('port-daddy up/down Integration', () => {
  let tempDir;
  let upProcess;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pd-up-'));
  });

  afterEach(async () => {
    // Kill up process if still running
    if (upProcess && upProcess.exitCode === null) {
      await killAndWait(upProcess, 'SIGTERM', 5000);
      killProcessGroup(upProcess);
    }
    upProcess = null;

    // Release services from THIS test's projects only
    const testProjectPrefixes = [
      'test-up-down:',
      'test-nohealth:',
      'test-selective:',
      'test-remote:',
      'configured-service-proof:'
    ];
    try {
      const svcRes = await request('/services');
      if (svcRes.ok && svcRes.data?.services) {
        for (const svc of svcRes.data.services) {
          if (testProjectPrefixes.some(p => svc.id.startsWith(p))) {
            try { await request('/release', { method: 'DELETE', body: { id: svc.id } }); }
            catch { /* best effort */ }
          }
        }
      }
    } catch { /* daemon unreachable, ok */ }

    // Clean up temp dir
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ok */ }

    // Pause for port release and process cleanup
    await new Promise(r => setTimeout(r, 1000));
  });

  test('up starts services and down stops them', async () => {
    const apiDir = join(tempDir, 'api');
    const frontendDir = join(tempDir, 'frontend');
    mkdirSync(apiDir, { recursive: true });
    mkdirSync(frontendDir, { recursive: true });

    writeFileSync(join(apiDir, 'server.mjs'), MINI_SERVER_SCRIPT);
    writeFileSync(join(frontendDir, 'server.mjs'), MINI_SERVER_SCRIPT);

    writeFileSync(join(tempDir, '.portdaddyrc'), JSON.stringify({
      project: 'test-up-down',
      services: {
        api: {
          cmd: 'node server.mjs',
          dir: apiDir,
          healthPath: '/health',
          env: { SERVICE_NAME: 'api' }
        },
        frontend: {
          cmd: 'node server.mjs',
          dir: frontendDir,
          needs: ['api'],
          healthPath: '/health',
          env: { SERVICE_NAME: 'frontend' }
        }
      }
    }, null, 2));

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-up-down'
    }));

    upProcess = spawn(TSX_PATH, [CLI_PATH, 'up', '--dir', tempDir], {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const output = await waitForOutput(upProcess, 'service(s) running', 45000);

    expect(output).toContain('api');
    expect(output).toContain('frontend');
    expect(output).toContain('Claiming ports');

    const claimSection = output.slice(output.indexOf('Claiming ports'));
    const portMatches = [...claimSection.matchAll(/(\w+)\s+→\s+(\d{4,5})/g)];
    const portMap = {};
    for (const [, name, port] of portMatches) {
      portMap[name] = parseInt(port, 10);
    }

    expect(portMap.api).toBeGreaterThanOrEqual(3100);
    expect(portMap.frontend).toBeGreaterThanOrEqual(3100);

    const apiHealth = await fetchLocal(portMap.api);
    expect(apiHealth).not.toBeNull();
    expect(apiHealth.name).toBe('api');

    const frontendHealth = await fetchLocal(portMap.frontend);
    expect(frontendHealth).not.toBeNull();
    expect(frontendHealth.name).toBe('frontend');

    expect(frontendHealth.siblings.API_PORT).toBe(String(portMap.api));
    expect(apiHealth.siblings.FRONTEND_PORT).toBe(String(portMap.frontend));

    const pidFile = getPidFilePath(tempDir);
    expect(existsSync(pidFile)).toBe(true);
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    expect(pid).toBeGreaterThan(0);

    const downResult = spawnSync(TSX_PATH, [CLI_PATH, 'down', '--dir', tempDir, '--yes'], {
      encoding: 'utf-8',
      env: cliEnv()
    });

    expect(downResult.status).toBe(0);
    expect(downResult.stdout).toContain('Stopped');

    expect(existsSync(pidFile)).toBe(false);

    // Verify this test's services are released (filter by project prefix to ignore other suites)
    let thisTestServices = [];
    for (let i = 0; i < 10; i++) {
      const servicesAfter = await getClaimedServices();
      thisTestServices = servicesAfter.filter(s => s.id.startsWith('test-up-down:'));
      if (thisTestServices.length === 0) break;
      await new Promise(r => setTimeout(r, 500));
    }
    expect(thisTestServices.map(s => s.id)).toEqual([]);
  }, 60000);

  test('uses the configured project identity for registration and discovery after readiness', async () => {
    const appDir = join(tempDir, 'app');
    const configuredProject = 'configured-service-proof';
    const semanticId = `${configuredProject}:app:main`;
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'server.mjs'), MINI_SERVER_SCRIPT);

    writeFileSync(join(tempDir, '.portdaddyrc'), JSON.stringify({
      project: configuredProject,
      services: {
        app: {
          cmd: 'node server.mjs',
          dir: appDir,
          healthPath: '/health',
          env: { SERVICE_NAME: 'configured-app' }
        }
      }
    }, null, 2));
    // Deliberately disagree with .portdaddyrc: registration must use config.
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'package-directory-inference-must-not-win'
    }));

    upProcess = spawn(TSX_PATH, [CLI_PATH, 'up', '--dir', tempDir], {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const output = await waitForOutput(upProcess, 'service(s) running', 45000);
    expect(JSON.parse(readFileSync(join(tempDir, '.portdaddyrc'), 'utf8')).project).toBe(configuredProject);
    expect(output).toContain(semanticId);

    const portMatch = output.match(/app\s+→\s+(\d{4,5})/);
    expect(portMatch).not.toBeNull();
    const readiness = await fetchLocal(parseInt(portMatch[1], 10));
    expect(readiness).toMatchObject({ status: 'ok', name: 'configured-app' });

    const registered = (await getClaimedServices()).find(service => service.id === semanticId);
    expect(registered).toMatchObject({ id: semanticId });

    const discovery = spawnSync(TSX_PATH, [CLI_PATH, 'find', semanticId], {
      encoding: 'utf-8',
      env: cliEnv()
    });
    expect(discovery.status).toBe(0);
    expect(discovery.stderr).toContain(semanticId);
    expect(discovery.stderr).not.toContain('No services found');

    await killAndWait(upProcess, 'SIGTERM', 10000);
  }, 60000);

  test('up exits with error when no services found', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'empty-project'
    }));

    const result = spawnSync(TSX_PATH, [CLI_PATH, 'up', '--dir', tempDir], {
      encoding: 'utf-8',
      timeout: 15000,
      env: cliEnv()
    });

    expect(result.status).not.toBe(0);
    // Message changed due to auto-scanning
    expect(result.stderr).toContain('No config found');
  }, 20000);

  test('down exits with error when no session running', () => {
    const result = spawnSync(TSX_PATH, [CLI_PATH, 'down', '--dir', tempDir], {
      encoding: 'utf-8',
      timeout: 10000,
      env: cliEnv()
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No PID file');
  }, 15000);

  test('up --service starts only the specified service and its deps', async () => {
    const apiDir = join(tempDir, 'api');
    const frontendDir = join(tempDir, 'frontend');
    const workerDir = join(tempDir, 'worker');
    mkdirSync(apiDir, { recursive: true });
    mkdirSync(frontendDir, { recursive: true });
    mkdirSync(workerDir, { recursive: true });

    writeFileSync(join(apiDir, 'server.mjs'), MINI_SERVER_SCRIPT);
    writeFileSync(join(frontendDir, 'server.mjs'), MINI_SERVER_SCRIPT);
    writeFileSync(join(workerDir, 'server.mjs'), MINI_SERVER_SCRIPT);

    writeFileSync(join(tempDir, '.portdaddyrc'), JSON.stringify({
      project: 'test-selective',
      services: {
        api: {
          cmd: 'node server.mjs',
          dir: apiDir,
          healthPath: '/health',
          env: { SERVICE_NAME: 'api' }
        },
        frontend: {
          cmd: 'node server.mjs',
          dir: frontendDir,
          needs: ['api'],
          healthPath: '/health',
          env: { SERVICE_NAME: 'frontend' }
        },
        worker: {
          cmd: 'node server.mjs',
          dir: workerDir,
          healthPath: '/health',
          env: { SERVICE_NAME: 'worker' }
        }
      }
    }));

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-selective'
    }));

    upProcess = spawn(TSX_PATH, [
      CLI_PATH, 'up', '--service', 'frontend', '--dir', tempDir
    ], {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const output = await waitForOutput(upProcess, 'service(s) running', 45000);

    expect(output).toContain('api');
    expect(output).toContain('frontend');

    const claimSection = output.slice(output.indexOf('Claiming ports'));
    const portMatches = [...claimSection.matchAll(/(\w+)\s+→\s+(\d{4,5})/g)];
    const portMap = {};
    for (const [, name, port] of portMatches) {
      portMap[name] = parseInt(port, 10);
    }

    expect(portMap.api).toBeGreaterThanOrEqual(3100);
    expect(portMap.frontend).toBeGreaterThanOrEqual(3100);
    expect(portMap.worker).toBeUndefined();

    await killAndWait(upProcess, 'SIGTERM', 10000);
  }, 60000);

  test('up handles remote services without spawning them', async () => {
    const frontendDir = join(tempDir, 'frontend');
    mkdirSync(frontendDir, { recursive: true });
    writeFileSync(join(frontendDir, 'server.mjs'), MINI_SERVER_SCRIPT);

    writeFileSync(join(tempDir, '.portdaddyrc'), JSON.stringify({
      project: 'test-remote',
      services: {
        frontend: {
          cmd: 'node server.mjs',
          dir: frontendDir,
          needs: ['api'],
          healthPath: '/health',
          env: { SERVICE_NAME: 'frontend' }
        },
        api: {
          remote: 'https://api.staging.example.com'
        }
      }
    }));

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-remote'
    }));

    upProcess = spawn(TSX_PATH, [CLI_PATH, 'up', '--no-health', '--dir', tempDir], {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const output = await waitForOutput(upProcess, 'service(s) running', 30000);

    expect(output).toContain('remote');

    const claimSection = output.slice(output.indexOf('Claiming ports'));
    const portMatches = [...claimSection.matchAll(/frontend\s+→\s+(\d{4,5})/g)];
    expect(portMatches.length).toBeGreaterThan(0);
    const frontendPort = parseInt(portMatches[0][1], 10);

    await new Promise(r => setTimeout(r, 1000));

    const frontendHealth = await fetchLocal(frontendPort);
    expect(frontendHealth).not.toBeNull();
    expect(frontendHealth.siblings.API_URL).toBe('https://api.staging.example.com');
    expect(frontendHealth.siblings.API_PORT).toBeUndefined();

    await killAndWait(upProcess, 'SIGTERM', 10000);
  }, 45000);
});
