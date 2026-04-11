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

const STATE_FILE = join(tmpdir(), 'port-daddy-test-state.json');
const TEST_ENV = {
  sockPath: 'PORT_DADDY_TEST_SOCK',
  dbPath: 'PORT_DADDY_TEST_DB',
  tmpDir: 'PORT_DADDY_TEST_TMPDIR',
  pid: 'PORT_DADDY_TEST_PID'
};

export default async function globalSetup() {
  const daemon = await startEphemeralDaemon();
  const state = {
    sockPath: daemon.sockPath,
    dbPath: daemon.dbPath,
    tmpDir: daemon.tmpDir,
    pid: daemon.pid
  };

  process.env[TEST_ENV.sockPath] = state.sockPath;
  process.env[TEST_ENV.dbPath] = state.dbPath;
  process.env[TEST_ENV.tmpDir] = state.tmpDir;
  process.env[TEST_ENV.pid] = String(state.pid);

  // Write connection info for test files and teardown to read
  writeFileSync(STATE_FILE, JSON.stringify(state));
}
