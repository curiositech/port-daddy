/**
 * Port Daddy — Shared Path Constants
 *
 * All runtime files live in ~/.port-daddy/ by default.
 * This eliminates /tmp/ symlink attacks, survives /tmp/ cleanup,
 * and keeps permissions user-private (0700 directory).
 *
 * Override any path via environment variables for dev/test.
 */

import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, chmodSync } from 'fs';

const HOME = process.env.PD_HOME?.trim() || join(homedir(), '.port-daddy');

// Ensure the directory exists with restrictive permissions
try {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
} catch {
  // Already exists or no permission — will fail on socket bind
}

/** Base directory: ~/.port-daddy/ */
export const PD_HOME = HOME;

/** HTTP Unix socket (CLI, SDK, MCP) */
export const DEFAULT_SOCK = process.env.PORT_DADDY_SOCK || join(HOME, 'daemon.sock');

/** Binary IPC socket (agent hot path) */
export const DEFAULT_IPC = process.env.PORT_DADDY_IPC || join(HOME, 'daemon.ipc');

/** PID file */
export const DEFAULT_PID_FILE = join(HOME, 'daemon.pid');

/** Ready-generation lease (published only after the daemon can serve hooks) */
export const DEFAULT_READY_FILE = process.env.PORT_DADDY_READY_FILE || join(HOME, 'daemon.ready');

/** TCP port file (for CLI to discover the dashboard port) */
export const DEFAULT_PORT_FILE = process.env.PORT_DADDY_PORT_FILE || join(HOME, 'daemon.port');

/** Shared UI preferences (menu bar companion, daemon UI hints) */
export const UI_PREFS_FILE = join(HOME, 'ui-preferences.json');
