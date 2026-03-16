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
          text
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (jsonBody) req.write(jsonBody);
    req.end();
  });
}

/**
 * Run CLI command against ephemeral daemon.
 */
export function runCli(args, options = {}) {
  const { sockPath } = getDaemonState();
  const cliPath = join(import.meta.dirname, '../../bin/port-daddy-cli.js');

  // Use --direct to silence daemon-unreachable warnings if we are intentionally 
  // bypassing the socket (useful for debugging)
  const finalArgs = [...args];
  
  const result = spawnSync(TSX_PATH, [cliPath, ...finalArgs], {
    encoding: 'utf-8',
    timeout: 10000,
    env: {
      ...process.env,
      PORT_DADDY_SOCK: sockPath,
      // Clear PORT_DADDY_URL so CLI uses socket
      PORT_DADDY_URL: ''
    },
    ...options
  });

  return {
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
    status: result.status,
    success: result.status === 0
  };
}
