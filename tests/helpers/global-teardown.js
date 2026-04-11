/**
 * Jest Global Teardown — Kill Ephemeral Daemon
 *
 * Reads the PID and temp directory from the state file written by globalSetup,
 * kills the daemon process, and cleans up temp files.
 */

import { readFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const STATE_FILE = join(tmpdir(), 'port-daddy-test-state.json');
const TEST_ENV = {
  sockPath: 'PORT_DADDY_TEST_SOCK',
  dbPath: 'PORT_DADDY_TEST_DB',
  tmpDir: 'PORT_DADDY_TEST_TMPDIR',
  pid: 'PORT_DADDY_TEST_PID'
};

function getDaemonStateFromEnv() {
  const sockPath = process.env[TEST_ENV.sockPath];
  const dbPath = process.env[TEST_ENV.dbPath];
  const tmpDir = process.env[TEST_ENV.tmpDir];
  const pid = process.env[TEST_ENV.pid];

  if (!sockPath || !dbPath || !tmpDir || !pid) return null;

  return {
    sockPath,
    dbPath,
    tmpDir,
    pid: Number.parseInt(pid, 10)
  };
}

export default async function globalTeardown() {
  let state;
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    state = getDaemonStateFromEnv();
  }

  if (!state) {
    return;
  }

  // Kill daemon by PID
  if (state.pid) {
    try {
      process.kill(state.pid, 'SIGTERM');
      // Wait briefly for clean shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Force kill if still alive
      try { process.kill(state.pid, 0); process.kill(state.pid, 'SIGKILL'); } catch { /* already dead */ }
    } catch {
      // Process already dead — that's fine
    }
  }

  // Remove temp directory (DB, socket)
  if (state.tmpDir) {
    try { rmSync(state.tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // Remove state file
  try { unlinkSync(STATE_FILE); } catch { /* best effort */ }
}
