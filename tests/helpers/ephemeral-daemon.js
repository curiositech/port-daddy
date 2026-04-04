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
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

const SERVER_PATH = join(import.meta.dirname, '../../server.ts');
const TSX_PATH = join(import.meta.dirname, '../../node_modules/.bin/tsx');

/**
 * Start an ephemeral Port Daddy daemon for testing.
 *
 * @param {Object} [options]
 * @param {number} [options.startupTimeout=15000] - Max ms to wait for daemon ready
 * @returns {Promise<EphemeralDaemon>}
 */
export async function startEphemeralDaemon(options = {}) {
  const { startupTimeout = 15000 } = options;

  // Create temp directory for DB and socket
  const tmpDir = mkdtempSync(join(tmpdir(), 'port-daddy-test-'));
  const dbPath = join(tmpDir, 'test.db');
  const sockPath = join(tmpDir, 'test.sock');

  // Spawn daemon process (use tsx to handle .ts imports)
  const child = spawn(TSX_PATH, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT_DADDY_DB: dbPath,
      PORT_DADDY_SOCK: sockPath,
      PORT_DADDY_NO_TCP: '1',
      PORT_DADDY_SILENT: '1',
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', process.env.DEBUG_TESTS ? 'inherit' : 'pipe'],
    detached: false
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
    child.kill('SIGTERM');
    throw new Error(
      `Ephemeral daemon failed to start within ${startupTimeout}ms\n` +
      `socket: ${sockPath}\n` +
      `stderr: ${stderr}`
    );
  }

  return {
    sockPath,
    dbPath,
    tmpDir,
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
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        // Wait for clean exit
        await Promise.race([
          new Promise(resolve => child.on('exit', resolve)),
          sleep(3000)
        ]);
        // Force kill if still alive
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }

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
    headers = {}
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
      timeout: 10000
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
