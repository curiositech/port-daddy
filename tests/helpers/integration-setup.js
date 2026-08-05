/**
 * Integration Test Setup
 *
 * Reads ephemeral daemon connection info and exposes helpers.
 * Imported by each integration test file.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import {
  getContextPathForSlot,
  getLegacyContextPath,
  removeAllContextFiles,
  writeCurrentContext,
} from '../../cli/utils/current-context.js';

const TEST_STATE_FILE_ENV = 'PORT_DADDY_TEST_STATE_FILE';
const FALLBACK_STATE_FILE = join(tmpdir(), 'port-daddy-test-state.json');
const TSX_PATH = join(import.meta.dirname, '../../node_modules/.bin/tsx');
const DAEMON_BODY_LIMIT_BYTES = 10 * 1024;
// Full-suite integration runs can saturate CPU hard enough that spawning a
// fresh tsx-backed CLI process takes noticeably longer than an isolated run.
// Keep the harness above that contention window so we kill genuine hangs,
// not healthy commands that simply lost the scheduler for a few seconds.
const CLI_COMMAND_TIMEOUT_MS = 30_000;
const CLI_CONTEXT_SLOT = `ppid-${process.pid}`;
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

function getStateFile() {
  return process.env[TEST_STATE_FILE_ENV] || FALLBACK_STATE_FILE;
}

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
    _state = getDaemonStateFromEnv();
    if (!_state) {
      try {
        _state = JSON.parse(readFileSync(getStateFile(), 'utf8'));
      } catch {
        _state = null;
      }
    }
  }

  if (!_state) {
    throw new Error(`missing ephemeral daemon state: ${getStateFile()}`);
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
      // Body-too-large fast path: daemon closes the unix socket before we
      // finish writing — translate to a stable 413.
      if ((err?.code === 'EPIPE' || err?.code === 'ECONNRESET') && jsonBodyBytes > DAEMON_BODY_LIMIT_BYTES) {
        resolve({
          ok: false,
          status: 413,
          data: { error: 'request payload too large' },
          text: '{"error":"request payload too large"}'
        });
        return;
      }
      // Linux runners occasionally surface EPIPE/ECONNRESET when the daemon
      // responds with a short error body and closes the connection before
      // the client finishes flushing the request body. The server is still
      // alive (subsequent requests pass), so resolve as an aborted-write
      // result rather than rejecting the test promise. Adversarial tests
      // assert "not 500" + "daemon still healthy"; both are satisfied here.
      if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') {
        resolve({
          ok: false,
          status: 0,
          data: { error: `socket aborted (${err.code})` },
          text: `{"error":"socket aborted (${err.code})"}`,
          aborted: true
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
  const contextSlot = extraEnv.PORT_DADDY_CONTEXT_SLOT
    || process.env.PORT_DADDY_CONTEXT_SLOT
    || CLI_CONTEXT_SLOT;

  // Use --direct to silence daemon-unreachable warnings if we are intentionally 
  // bypassing the socket (useful for debugging)
  const finalArgs = [...args];
  
  const testEnv = {
    ...process.env,
    PORT_DADDY_SOCK: sockPath,
    PORT_DADDY_DB: dbPath,
    PORT_DADDY_CONTEXT_DIR: contextDir,
    PORT_DADDY_CONTEXT_SLOT: contextSlot,
    // Clear PORT_DADDY_URL so CLI uses socket
    PORT_DADDY_URL: '',
    // Skip freshness check during integration tests to avoid noise and races
    PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
    // GitHub Actions checks out PRs as a main worktree; integration tests
    // intentionally opt in while production CLI behavior stays fail-closed.
    PORT_DADDY_ALLOW_MAIN_WORKTREE_SESSION: '1',
    // Force non-interactive mode
    PORT_DADDY_NON_INTERACTIVE: '1',
    // Rent-at-claim (S3): integration tests exercise begin mechanics, not the
    // roadmap-link gate — opt out via the bounded env exemption. Tests that
    // cover the gate itself clear this via extraEnv.
    PD_RENT_EXEMPT: 'chore',
    // Override comparable on-disk binary path to prevent binary drift checks
    // from failing against host-installed versions of Port Daddy.
    PORT_DADDY_BIN_OVERRIDE: process.execPath,
    // The test asserts Port Daddy stderr, not Node/tsx deprecation chatter.
    NODE_NO_WARNINGS: '1',
    NO_COLOR: '1',
    CI: '1'
  };

  // Ensure color-forcing variables are removed so NO_COLOR is respected without warnings
  delete testEnv.FORCE_COLOR;
  delete testEnv.COLORTERM;
  delete testEnv.PD_AGENT_ID;
  delete testEnv.PD_SESSION_ID;
  delete testEnv.PD_ACTOR;
  
  const result = spawnSync(process.execPath, [TSX_PATH, cliPath, ...finalArgs], {
    encoding: 'utf-8',
    timeout: CLI_COMMAND_TIMEOUT_MS,
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
  const contextSlot = extraEnv.PORT_DADDY_CONTEXT_SLOT
    || process.env.PORT_DADDY_CONTEXT_SLOT
    || CLI_CONTEXT_SLOT;

  const testEnv = {
    ...process.env,
    HOME: homeDir,
    PORT_DADDY_IPC: ipcPath,
    PORT_DADDY_CONTEXT_DIR: contextDir,
    PORT_DADDY_CONTEXT_SLOT: contextSlot,
    PORT_DADDY_URL: '',
    PORT_DADDY_SOCK: '',
    PORT_DADDY_SKIP_FRESHNESS_CHECK: '1',
    PORT_DADDY_ALLOW_MAIN_WORKTREE_SESSION: '1',
    PORT_DADDY_NON_INTERACTIVE: '1',
    // Override comparable on-disk binary path to prevent binary drift checks
    // from failing against host-installed versions of Port Daddy.
    PORT_DADDY_BIN_OVERRIDE: process.execPath,
    NODE_NO_WARNINGS: '1',
    NO_COLOR: '1',
    CI: '1'
  };

  delete testEnv.FORCE_COLOR;
  delete testEnv.COLORTERM;
  delete testEnv.PD_AGENT_ID;
  delete testEnv.PD_SESSION_ID;
  delete testEnv.PD_ACTOR;

  const result = spawnSync(process.execPath, [TSX_PATH, cliPath, ...args], {
    encoding: 'utf-8',
    timeout: CLI_COMMAND_TIMEOUT_MS,
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
export function clearTestCurrentContext(slot) {
  const { contextDir } = getDaemonState();
  if (slot) {
    try {
      const slotPath = getContextPathForSlot(slot, contextDir);
      if (existsSync(slotPath)) unlinkSync(slotPath);
    } catch {
      // Best-effort cleanup for slot-scoped test state.
    }

    try {
      const legacyPath = getLegacyContextPath(contextDir);
      if (existsSync(legacyPath)) {
        const parsed = JSON.parse(readFileSync(legacyPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.contextSlot === slot) {
          unlinkSync(legacyPath);
        }
      }
    } catch {
      // Best-effort cleanup for legacy compatibility file.
    }
    return;
  }

  removeAllContextFiles(contextDir);
}
