/**
 * Jest Global Setup — Ephemeral Daemon
 *
 * Starts a fresh daemon before all integration tests.
 * Writes connection info to a temp file that tests read.
 */

import { startEphemeralDaemon } from './ephemeral-daemon.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_STATE_FILE_ENV = 'PORT_DADDY_TEST_STATE_FILE';
const FALLBACK_STATE_FILE = join(tmpdir(), 'port-daddy-test-state.json');
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
  if (process.env[TEST_STATE_FILE_ENV]) return process.env[TEST_STATE_FILE_ENV];
  const stateFile = join(tmpdir(), `port-daddy-test-state-${process.pid}-${Date.now()}.json`);
  process.env[TEST_STATE_FILE_ENV] = stateFile;
  return stateFile;
}

export default async function globalSetup() {
  const daemon = await startEphemeralDaemon();
  const stateFile = getStateFile();
  globalThis.__PORT_DADDY_TEST_STATE_FILE__ = stateFile;
  const state = {
    sockPath: daemon.sockPath,
    ipcPath: daemon.ipcPath,
    dbPath: daemon.dbPath,
    tmpDir: daemon.tmpDir,
    homeDir: daemon.homeDir,
    contextDir: daemon.contextDir,
    pid: daemon.pid
  };

  process.env[TEST_ENV.sockPath] = state.sockPath;
  process.env[TEST_ENV.ipcPath] = state.ipcPath;
  process.env[TEST_ENV.dbPath] = state.dbPath;
  process.env[TEST_ENV.tmpDir] = state.tmpDir;
  process.env[TEST_ENV.homeDir] = state.homeDir;
  process.env[TEST_ENV.contextDir] = state.contextDir;
  process.env.PORT_DADDY_CONTEXT_DIR = state.contextDir;
  process.env[TEST_ENV.pid] = String(state.pid);

  // Write connection info for test files and teardown to read
  writeFileSync(stateFile || FALLBACK_STATE_FILE, JSON.stringify(state));
}
