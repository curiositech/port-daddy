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
import { removeAllContextFiles, writeCurrentContext } from '../../cli/utils/current-context.js';

const STATE_FILE = join(tmpdir(), 'port-daddy-test-state.json');
const TSX_PATH = join(import.meta.dirname, '../../node_modules/.bin/tsx');
const DAEMON_BODY_LIMIT_BYTES = 10 * 1024;
const TEST_ENV = {
  sockPath: 'PORT_DADDY_TEST_SOCK',
  ipcPath: 'PORT_DADDY_TEST_IPC',
  dbPath: 'PORT_DADDY_TEST_DB',
  tmpDir: 'PORT_DADDY_TEST_TMPDIR',
  homeDir: 'PORT_DADDY_TEST_HOME',
  contextDir: 'PORT_DADDY_TEST_CONTEXT_DIR',
  pid: 'PORT_DADDY_TEST_PID'
};

let _state = null;

function getDaemonStateFromEnv() {
  const sockPath = process.env[TEST_ENV.sockPath];
  const ipcPath = process.env[TEST_ENV.ipcPath];
  const dbPath = process.env[TEST_ENV.dbPath];
  const tmpDir = process.env[TEST_ENV.tmpDir];
  const homeDir = process.env[TEST_ENV.homeDir];
  const contextDir = process.env[TEST_ENV.contextDir];
  const pid = process.env[TEST_ENV.pid];

  if (!sockPath || !ipcPath || !dbPath || !tmpDir || !homeDir || !contextDir || !pid) return null;

  return {
    sockPath,
    ipcPath,
    dbPath,
    tmpDir,
    homeDir,
    contextDir,
    pid: Number.parseInt(pid, 10)
  };
}

function applyTestEnv(state) {
  process.env[TEST_ENV.sockPath] = state.sockPath;
  process.env[TEST_ENV.ipcPath] = state.ipcPath;
  process.env[TEST_ENV.dbPath] = state.dbPath;
  process.env[TEST_ENV.tmpDir] = state.tmpDir;
  process.env[TEST_ENV.homeDir] = state.homeDir;
  process.env[TEST_ENV.contextDir] = state.contextDir;
  process.env.PORT_DADDY_CONTEXT_DIR = state.contextDir;
  process.env[TEST_ENV.pid] = String(state.pid);
}

/**
 * Get ephemeral daemon connection state.
 */
export function getDaemonState() {
  if (!_state) {
    try {
      _state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
      _state = getDaemonStateFromEnv();
    }
  }

  if (!_state) {
    throw new Error(`missing ephemeral daemon state: ${STATE_FILE}`);
  }

  applyTestEnv(_state);

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
  const { sockPath, dbPath, contextDir } = getDaemonState();
  const cliPath = join(import.meta.dirname, '../../bin/port-daddy-cli.ts');
  const { env: extraEnv = {}, ...spawnOptions } = options;

  // Use --direct to silence daemon-unreachable warnings if we are intentionally 
  // bypassing the socket (useful for debugging)
  const finalArgs = [...args];
  
  const testEnv = {
    ...process.env,
    PORT_DADDY_SOCK: sockPath,
    PORT_DADDY_DB: dbPath,
    PORT_DADDY_CONTEXT_DIR: contextDir,
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
    env: {
      ...testEnv,
      ...extraEnv,
    },
    ...spawnOptions
  });

  return {
    stdout: stripAnsi(result.stdout || '').trim(),
    stderr: stripAnsi(result.stderr || '').trim(),
    status: result.status,
    success: result.status === 0
  };
}

/**
 * Run CLI command through the daemon IPC path.
 * Uses an isolated HOME so HTTP/socket fallback cannot accidentally hit the
 * user's real daemon when IPC coverage regresses.
 */
export function runCliViaIpc(args, options = {}) {
  const { ipcPath, homeDir, contextDir } = getDaemonState();
  const cliPath = join(import.meta.dirname, '../../bin/port-daddy-cli.ts');
  const { env: extraEnv = {}, ...spawnOptions } = options;

  const testEnv = {
    ...process.env,
    HOME: homeDir,
    PORT_DADDY_IPC: ipcPath,
    PORT_DADDY_CONTEXT_DIR: contextDir,
    PORT_DADDY_URL: '',
    PORT_DADDY_SOCK: '',
    PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
    PORT_DADDY_NON_INTERACTIVE: '1',
    NO_COLOR: '1',
    CI: '1'
  };

  delete testEnv.FORCE_COLOR;
  delete testEnv.COLORTERM;

  const result = spawnSync(TSX_PATH, [cliPath, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
    env: {
      ...testEnv,
      ...extraEnv,
    },
    ...spawnOptions
  });

  return {
    stdout: stripAnsi(result.stdout || '').trim(),
    stderr: stripAnsi(result.stderr || '').trim(),
    status: result.status,
    success: result.status === 0
  };
}

/**
 * Write CLI current-context state into the isolated integration-test context dir.
 */
export function writeTestCurrentContext(context) {
  const { contextDir } = getDaemonState();
  return writeCurrentContext(context, contextDir);
}

/**
 * Clear all isolated current-context files created during integration tests.
 */
export function clearTestCurrentContext() {
  const { contextDir } = getDaemonState();
  removeAllContextFiles(contextDir);
}
