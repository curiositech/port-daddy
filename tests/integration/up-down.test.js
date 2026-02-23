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
import { tmpdir, homedir } from 'node:os';
import { request, getDaemonState } from '../helpers/integration-setup.js';

const CLI_PATH = join(import.meta.dirname, '../../bin/port-daddy-cli.js');
const TSX_PATH = join(import.meta.dirname, '../../node_modules/.bin/tsx');
const UP_PID_FILE = join(homedir(), '.port-daddy-up.pid');

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
      const res = await fetch(`http://localhost:${port}${path}`, {
        signal: AbortSignal.timeout(2000)
      });
      if (res.ok) return await res.json();
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

// Helper: kill process and wait for exit
// Sends signal to the main process only (not process group) to allow graceful shutdown.
// Use killProcessGroup() for force cleanup in afterEach.
function killAndWait(child, signal = 'SIGTERM', timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve('already-dead');
      return;
    }

    const timer = setTimeout(() => {
      // Timeout: force kill process group and individual process
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* no process group */ }
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      resolve('timeout');
    }, timeoutMs);

    child.on('exit', () => {
      clearTimeout(timer);
      resolve('exited');
    });

    // Send signal to main process only — lets graceful shutdown handlers run
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
  const { sockPath } = getDaemonState();
  return {
    ...process.env,
    PORT_DADDY_SOCK: sockPath,
    PORT_DADDY_URL: ''
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
      // Try graceful shutdown first (allows port release in orchestrator.stop)
      await killAndWait(upProcess, 'SIGTERM', 5000);
      // Force kill entire process group to clean up orphaned children (sh -c node …)
      killProcessGroup(upProcess);
    }
    upProcess = null;

    // Clean up PID file
    try {
      if (existsSync(UP_PID_FILE)) {
        const pid = parseInt(readFileSync(UP_PID_FILE, 'utf-8').trim(), 10);
        try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      }
    } catch { /* best effort */ }

    // Release all services from the daemon to prevent state leakage between tests
    try {
      const svcRes = await request('/services');
      if (svcRes.ok && svcRes.data?.services) {
        for (const svc of svcRes.data.services) {
          try { await request('/release', { method: 'DELETE', body: { id: svc.id } }); }
          catch { /* best effort */ }
        }
      }
    } catch { /* daemon unreachable, ok */ }

    // Clean up temp dir
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ok */ }

    // Pause for port release and process cleanup
    await new Promise(r => setTimeout(r, 1000));
  });

  // =========================================================================
  // Basic startup / shutdown
  // =========================================================================

  test('up starts services and down stops them', async () => {
    // Create two mini server scripts
    const apiDir = join(tempDir, 'api');
    const frontendDir = join(tempDir, 'frontend');
    mkdirSync(apiDir, { recursive: true });
    mkdirSync(frontendDir, { recursive: true });

    writeFileSync(join(apiDir, 'server.mjs'), MINI_SERVER_SCRIPT);
    writeFileSync(join(frontendDir, 'server.mjs'), MINI_SERVER_SCRIPT);

    // Write .portdaddyrc
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

    // Write a minimal package.json so discover doesn't complain
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-up-down'
    }));

    // Spawn `port-daddy up` — use detached so we can kill the entire process group
    upProcess = spawn(TSX_PATH, [CLI_PATH, 'up', '--dir', tempDir], {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    // Wait for "All ... service(s) running"
    const output = await waitForOutput(upProcess, 'service(s) running', 45000);

    // Verify preview output
    expect(output).toContain('api');
    expect(output).toContain('frontend');
    expect(output).toContain('Claiming ports');

    // Extract ports from the "Claiming ports" section only
    const claimSection = output.slice(output.indexOf('Claiming ports'));
    const portMatches = [...claimSection.matchAll(/(\w+)\s+→\s+(\d{4,5})/g)];
    const portMap = {};
    for (const [, name, port] of portMatches) {
      portMap[name] = parseInt(port, 10);
    }

    expect(portMap.api).toBeGreaterThanOrEqual(3100);
    expect(portMap.frontend).toBeGreaterThanOrEqual(3100);
    expect(portMap.api).not.toBe(portMap.frontend);

    // Verify services are healthy via HTTP
    const apiHealth = await fetchLocal(portMap.api);
    expect(apiHealth).not.toBeNull();
    expect(apiHealth.name).toBe('api');

    const frontendHealth = await fetchLocal(portMap.frontend);
    expect(frontendHealth).not.toBeNull();
    expect(frontendHealth.name).toBe('frontend');

    // Verify env var injection: frontend should see API_PORT and API_URL
    expect(frontendHealth.siblings.API_PORT).toBe(String(portMap.api));
    expect(frontendHealth.siblings.API_URL).toBe(`http://localhost:${portMap.api}`);

    // Verify api sees FRONTEND_PORT
    expect(apiHealth.siblings.FRONTEND_PORT).toBe(String(portMap.frontend));

    // Verify PID file was written (tsx forks a child, so PID may differ from upProcess.pid)
    expect(existsSync(UP_PID_FILE)).toBe(true);
    const pid = parseInt(readFileSync(UP_PID_FILE, 'utf-8').trim(), 10);
    expect(pid).toBeGreaterThan(0);

    // Verify ports are claimed in daemon
    const services = await getClaimedServices();
    const claimedPorts = services.map(s => s.port);
    expect(claimedPorts).toContain(portMap.api);
    expect(claimedPorts).toContain(portMap.frontend);

    // Use `port-daddy down` to stop — the proper shutdown path.
    // `down` sends SIGTERM, waits for process exit, verifies port release,
    // and force-releases stragglers. Much more reliable than raw SIGTERM.
    const downResult = spawnSync(TSX_PATH, [CLI_PATH, 'down'], {
      encoding: 'utf-8',
      timeout: 30000,
      env: cliEnv()
    });

    // `down` should complete successfully
    expect(downResult.status).toBe(0);
    expect(downResult.stdout).toContain('Stopped');

    // Wait for upProcess exit event to fire (down already killed it)
    await killAndWait(upProcess, 'SIGTERM', 5000);

    // Verify ports are released from daemon
    const servicesAfter = await getClaimedServices();
    const claimedPortsAfter = servicesAfter.map(s => s.port);
    expect(claimedPortsAfter).not.toContain(portMap.api);
    expect(claimedPortsAfter).not.toContain(portMap.frontend);
  }, 60000);

  // =========================================================================
  // --no-health flag
  // =========================================================================

  test('up --no-health skips health checks', async () => {
    const svcDir = join(tempDir, 'svc');
    mkdirSync(svcDir, { recursive: true });

    // A server that does NOT have a /health endpoint returning 200
    writeFileSync(join(svcDir, 'server.mjs'), `
import { createServer } from 'node:http';
const PORT = process.env.PORT || 0;
createServer((req, res) => {
  res.writeHead(200);
  res.end('running');
}).listen(PORT, () => console.log('listening on ' + PORT));
`);

    writeFileSync(join(tempDir, '.portdaddyrc'), JSON.stringify({
      project: 'test-nohealth',
      services: {
        svc: {
          cmd: 'node server.mjs',
          dir: svcDir,
          healthPath: '/health'
        }
      }
    }));

    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-nohealth'
    }));

    upProcess = spawn(TSX_PATH, [CLI_PATH, 'up', '--no-health', '--dir', tempDir], {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    // With --no-health, it should reach "all started" without waiting for health
    const output = await waitForOutput(upProcess, 'service(s) running', 30000);
    expect(output).toContain('svc');

    await killAndWait(upProcess, 'SIGTERM', 10000);
  }, 45000);

  // =========================================================================
  // No services found
  // =========================================================================

  test('up exits with error when no services found', async () => {
    // Empty directory with just a package.json (no framework)
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'empty-project'
    }));

    const result = spawnSync(TSX_PATH, [CLI_PATH, 'up', '--dir', tempDir], {
      encoding: 'utf-8',
      timeout: 15000,
      env: cliEnv()
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No services found');
  }, 20000);

  // =========================================================================
  // down with no up session
  // =========================================================================

  test('down exits with error when no session running', () => {
    // Ensure PID file doesn't exist
    try {
      if (existsSync(UP_PID_FILE)) {
        const pid = parseInt(readFileSync(UP_PID_FILE, 'utf-8').trim(), 10);
        try { process.kill(pid, 'SIGTERM'); } catch { /* ok */ }
      }
    } catch { /* ok */ }
    try { rmSync(UP_PID_FILE, { force: true }); } catch { /* ok */ }

    const result = spawnSync(TSX_PATH, [CLI_PATH, 'down'], {
      encoding: 'utf-8',
      timeout: 10000,
      env: cliEnv()
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No port-daddy up session found');
  }, 15000);

  // =========================================================================
  // --service flag (selective startup)
  // =========================================================================

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

    // Only start frontend (should also start api as a dependency, but NOT worker)
    upProcess = spawn(TSX_PATH, [
      CLI_PATH, 'up', '--service', 'frontend', '--dir', tempDir
    ], {
      env: cliEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    const output = await waitForOutput(upProcess, 'service(s) running', 45000);

    // Should mention both api and frontend in the preview
    expect(output).toContain('api');
    expect(output).toContain('frontend');

    // Extract ports from the "Claiming ports" section only
    const claimSection = output.slice(output.indexOf('Claiming ports'));
    const portMatches = [...claimSection.matchAll(/(\w+)\s+→\s+(\d{4,5})/g)];
    const portMap = {};
    for (const [, name, port] of portMatches) {
      portMap[name] = parseInt(port, 10);
    }

    // api and frontend should have ports
    expect(portMap.api).toBeGreaterThanOrEqual(3100);
    expect(portMap.frontend).toBeGreaterThanOrEqual(3100);

    // worker should NOT have a port (was not started)
    expect(portMap.worker).toBeUndefined();

    // Verify services respond
    const apiHealth = await fetchLocal(portMap.api);
    expect(apiHealth).not.toBeNull();

    const frontendHealth = await fetchLocal(portMap.frontend);
    expect(frontendHealth).not.toBeNull();

    await killAndWait(upProcess, 'SIGTERM', 10000);
  }, 60000);

  // =========================================================================
  // Remote service (no process spawned, just URL injection)
  // =========================================================================

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

    // Should show remote marker
    expect(output).toContain('remote');

    // Extract frontend port from the "Claiming ports" section only
    const claimSection = output.slice(output.indexOf('Claiming ports'));
    const portMatches = [...claimSection.matchAll(/frontend\s+→\s+(\d{4,5})/g)];
    expect(portMatches.length).toBeGreaterThan(0);
    const frontendPort = parseInt(portMatches[0][1], 10);

    // Wait a moment for server to be ready
    await new Promise(r => setTimeout(r, 1000));

    // Frontend should have API_URL pointing to remote
    const frontendHealth = await fetchLocal(frontendPort);
    expect(frontendHealth).not.toBeNull();
    expect(frontendHealth.siblings.API_URL).toBe('https://api.staging.example.com');
    // Remote services should NOT inject a PORT var
    expect(frontendHealth.siblings.API_PORT).toBeUndefined();

    await killAndWait(upProcess, 'SIGTERM', 10000);
  }, 45000);
});
