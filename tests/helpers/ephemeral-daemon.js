/**
 * Ephemeral Test Daemon
 *
 * Spawns a fresh Port Daddy daemon with:
 *   - Random Unix socket path (no port conflicts possible)
 *   - Temporary SQLite database (no state leakage)
 *   - Silent mode (no log noise)
 *
 * Each test run gets a completely isolated daemon instance.
 * No pre-running daemon required. Works in CI from clean state.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

const SERVER_PATH = join(import.meta.dirname, '../../server.ts');
const TSX_PATH = join(import.meta.dirname, '../../node_modules/.bin/tsx');
const SHUTDOWN_TIMEOUT_MS = 3000;

/**
 * Start an ephemeral Port Daddy daemon for testing.
 *
 * @param {Object} [options]
 * @param {number} [options.startupTimeout=30000] - Max ms to wait for daemon ready
 * @param {Record<string, string | undefined>} [options.env] - Extra daemon env overrides
 * @returns {Promise<EphemeralDaemon>}
 */
export async function startEphemeralDaemon(options = {}) {
  // Cold TypeScript + daemon boot on this repo can legitimately take longer
  // than 15s on the first run. Keep the harness above that threshold so we
  // fail on real hangs, not on normal cold-start variance.
  const { startupTimeout = 30000, env = {} } = options;

  // Create temp directory for DB and socket
  const tmpDir = mkdtempSync(join(tmpdir(), 'port-daddy-test-'));
  const dbPath = join(tmpDir, 'test.db');
  const sockPath = join(tmpDir, 'test.sock');
  const ipcPath = join(tmpDir, 'test.ipc');
  const pidPath = join(tmpDir, 'daemon.pid');
  const portFile = join(tmpDir, 'daemon.port');
  const heartbeatFile = join(tmpDir, 'heartbeat');
  const homeDir = join(tmpDir, 'home');
  const contextDir = join(tmpDir, 'context');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(contextDir, { recursive: true });

  // Spawn daemon process (use tsx to handle .ts imports)
  const child = spawn(process.execPath, [TSX_PATH, SERVER_PATH], {
    env: {
      ...process.env,
      HOME: homeDir,
      // A source-run test daemon executes under Node, not the installed `pd`
      // binary that may also be on the developer's PATH. Compare like with
      // like so a local Homebrew install cannot create synthetic binary drift.
      // Callers can still override this when explicitly testing drift.
      PORT_DADDY_BIN_OVERRIDE: process.execPath,
      ...env,
      PORT_DADDY_DB: dbPath,
      PORT_DADDY_SOCK: sockPath,
      PORT_DADDY_IPC: ipcPath,
      PORT_DADDY_PID_FILE: pidPath,
      PORT_DADDY_PORT_FILE: portFile,
      PORT_DADDY_HEARTBEAT_FILE: heartbeatFile,
      PORT_DADDY_NO_TCP: '1',
      PORT_DADDY_SILENT: '1',
      PORT_DADDY_BIN_OVERRIDE: process.execPath,
      // #8877 / ADR-0122: /sugar/begin is a mint door and integration suites
      // begin hundreds of fresh agents against this one daemon; raise the
      // per-project/day newcomer admission bound so the harness never trips
      // ADR-0040's default (production keeps the default).
      PORT_DADDY_NEWCOMER_ADMIT_MAX: '100000',
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', process.env.DEBUG_TESTS ? 'inherit' : 'pipe'],
    detached: true
  });

  let stderr = '';
  if (child.stderr) {
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  }

  // Wait for socket to appear and daemon to respond to /health
  const startedAt = Date.now();
  let ready = false;

  while (Date.now() - startedAt < startupTimeout) {
    if (child.exitCode !== null) {
      throw new Error(
        `Ephemeral daemon exited early with code ${child.exitCode}\n` +
        `stderr: ${stderr}`
      );
    }

    if (existsSync(sockPath)) {
      try {
        const ok = await healthCheck(sockPath, 2000);
        if (ok) {
          ready = true;
          break;
        }
      } catch {
        // Socket exists but daemon not ready yet
      }
    }

    await sleep(100);
  }

  if (!ready) {
    await terminateDaemonProcess(child);
    throw new Error(
      `Ephemeral daemon failed to start within ${startupTimeout}ms\n` +
      `socket: ${sockPath}\n` +
      `stderr: ${stderr}`
    );
  }

  return {
    sockPath,
    ipcPath,
    dbPath,
    tmpDir,
    homeDir,
    contextDir,
    pid: child.pid,
    process: child,

    /**
     * Make a request to this daemon.
     * @param {string} path - URL path (e.g., '/health')
     * @param {Object} [opts]
     * @returns {Promise<{ok: boolean, status: number, data: any}>}
     */
    request(path, opts = {}) {
      return daemonRequest(sockPath, path, opts);
    },

    /**
     * Clean up: kill daemon, remove temp directory.
     */
    async cleanup() {
      await terminateDaemonProcess(child);

      // Remove temp directory
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  };
}

/**
 * Health check via Unix socket.
 */
function healthCheck(sockPath, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: sockPath,
      path: '/health',
      method: 'GET',
      timeout
    }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

/**
 * Make an HTTP request to a daemon via Unix socket.
 * Returns a response object compatible with the CLI's pdFetch pattern.
 */
function daemonRequest(sockPath, path, options = {}) {
  const {
    method = 'GET',
    body = null,
    headers = {},
    timeout = 10000
  } = options;

  const jsonBody = body ? JSON.stringify(body) : null;
  const reqHeaders = {
    ...headers,
    ...(jsonBody ? {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(jsonBody))
    } : {})
  };

  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: sockPath,
      path,
      method,
      headers: reqHeaders,
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }

        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          data,
          text,
          headers: res.headers
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });

    if (jsonBody) req.write(jsonBody);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function signalProcessGroupOrPid(pid, signal) {
  if (!pid) return;

  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // If a caller hands us an older non-detached process, fall back to PID.
  }

  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
}

function processGroupOrPidAlive(pid) {
  if (!pid) return false;

  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    // Fall back below.
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateDaemonProcess(child) {
  if (!child?.pid || (child.exitCode !== null && !processGroupOrPidAlive(child.pid))) {
    return;
  }

  signalProcessGroupOrPid(child.pid, 'SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(SHUTDOWN_TIMEOUT_MS),
  ]);

  if (processGroupOrPidAlive(child.pid)) {
    signalProcessGroupOrPid(child.pid, 'SIGKILL');
  }
}
