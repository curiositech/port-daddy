/**
 * Jest Global Teardown — Kill Ephemeral Daemon
 *
 * Reads the PID and temp directory from the state file written by globalSetup,
 * kills the daemon process, and cleans up temp files.
 */

import { readFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_STATE_FILE_ENV = 'PORT_DADDY_TEST_STATE_FILE';
const FALLBACK_STATE_FILE = join(tmpdir(), 'port-daddy-test-state.json');
const SHUTDOWN_TIMEOUT_MS = 2000;
const TEST_ENV = {
  sockPath: 'PORT_DADDY_TEST_SOCK',
  ipcPath: 'PORT_DADDY_TEST_IPC',
  dbPath: 'PORT_DADDY_TEST_DB',
  tmpDir: 'PORT_DADDY_TEST_TMPDIR',
  homeDir: 'PORT_DADDY_TEST_HOME',
  contextDir: 'PORT_DADDY_TEST_CONTEXT_DIR',
  pid: 'PORT_DADDY_TEST_PID'
};

function getStateFile() {
  return process.env[TEST_STATE_FILE_ENV]
    || globalThis.__PORT_DADDY_TEST_STATE_FILE__
    || FALLBACK_STATE_FILE;
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

export default async function globalTeardown() {
  let state;
  state = getDaemonStateFromEnv();
  if (!state) {
    try {
      state = JSON.parse(readFileSync(getStateFile(), 'utf8'));
    } catch {
      state = null;
    }
  }

  if (!state) {
    return;
  }

  // Kill daemon by PID
  if (state.pid) {
    await terminateDaemonPid(state.pid);
  }

  // Remove temp directory (DB, socket)
  if (state.tmpDir) {
    try { rmSync(state.tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // Remove state file
  try { unlinkSync(getStateFile()); } catch { /* best effort */ }
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
    // Older state files may reference non-detached wrappers. Fall back to PID.
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

async function terminateDaemonPid(pid) {
  signalProcessGroupOrPid(pid, 'SIGTERM');
  await sleep(SHUTDOWN_TIMEOUT_MS);

  if (processGroupOrPidAlive(pid)) {
    signalProcessGroupOrPid(pid, 'SIGKILL');
  }
}
