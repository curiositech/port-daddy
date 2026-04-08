/**
 * Integration Test Setup
 *
 * Reads ephemeral daemon connection info and exposes helpers.
 * Imported by each integration test file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const STATE_FILE = join(tmpdir(), 'port-daddy-test-state.json');
const TSX_PATH = join(import.meta.dirname, '../../node_modules/.bin/tsx');
const DAEMON_BODY_LIMIT_BYTES = 10 * 1024;

let _state = null;

/**
 * Get ephemeral daemon connection state.
 */
export function getDaemonState() {
  if (!_state) {
    _state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  }
  return _state;
}

/**
 * Make a request to the ephemeral daemon.
 */
export function request(path, options = {}) {
  const { sockPath } = getDaemonState();
  const {
    method = 'GET',
    body = null,
    headers = {}
  } = options;

  const jsonBody = body ? JSON.stringify(body) : null;
  const jsonBodyBytes = jsonBody ? Buffer.byteLength(jsonBody) : 0;
  const reqHeaders = {
    ...headers,
    ...(jsonBody ? {
      'Content-Type': 'application/json',
      'Content-Length': String(jsonBodyBytes)
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
          text
        });
      });
    });

    req.on('error', (err) => {
      if ((err?.code === 'EPIPE' || err?.code === 'ECONNRESET') && jsonBodyBytes > DAEMON_BODY_LIMIT_BYTES) {
        resolve({
          ok: false,
          status: 413,
          data: { error: 'request payload too large' },
          text: '{"error":"request payload too large"}'
        });
        return;
      }
      reject(err);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (jsonBody) req.write(jsonBody);
    req.end();
  });
}

// Helper: strip ANSI escape codes
function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * Run CLI command against ephemeral daemon.
 */
export function runCli(args, options = {}) {
  const { sockPath, dbPath } = getDaemonState();
  const cliPath = join(import.meta.dirname, '../../bin/port-daddy-cli.ts');

  // Use --direct to silence daemon-unreachable warnings if we are intentionally 
  // bypassing the socket (useful for debugging)
  const finalArgs = [...args];
  
  const testEnv = {
    ...process.env,
    PORT_DADDY_SOCK: sockPath,
    PORT_DADDY_DB: dbPath,
    // Clear PORT_DADDY_URL so CLI uses socket
    PORT_DADDY_URL: '',
    // Skip freshness check during integration tests to avoid noise and races
    PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
    // Force non-interactive mode
    PORT_DADDY_NON_INTERACTIVE: '1',
    NO_COLOR: '1',
    CI: '1'
  };

  // Ensure color-forcing variables are removed so NO_COLOR is respected without warnings
  delete testEnv.FORCE_COLOR;
  delete testEnv.COLORTERM;
  
  const result = spawnSync(TSX_PATH, [cliPath, ...finalArgs], {
    encoding: 'utf-8',
    timeout: 10000,
    env: testEnv,
    ...options
  });

  return {
    stdout: stripAnsi(result.stdout || '').trim(),
    stderr: stripAnsi(result.stderr || '').trim(),
    status: result.status,
    success: result.status === 0
  };
}
