/**
 * Bosun Heartbeat Writer
 *
 * The V4 Bosun supervisor must not depend on the daemon's HTTP stack. This
 * module gives the daemon one narrow responsibility: periodically write an
 * atomic filesystem heartbeat that an external `pd-bosun` process can inspect.
 *
 * Example heartbeat payload:
 *
 * ```json
 * {
 *   "schema": "port-daddy.bosun.heartbeat.v1",
 *   "pid": 12345,
 *   "writtenAt": 1777050000000,
 *   "uptimeMs": 2500,
 *   "version": "3.10.0",
 *   "codeHash": "abc123",
 *   "startedAt": 1777049997500,
 *   "installDir": "/Users/me/port-daddy-stable",
 *   "pidFile": "/Users/me/.port-daddy/daemon.pid",
 *   "portFile": "/Users/me/.port-daddy/daemon.port",
 *   "hostname": "workstation"
 * }
 * ```
 *
 * Sample status returned by `getStatus()` after a successful write:
 *
 * ```json
 * {
 *   "enabled": true,
 *   "state": "healthy",
 *   "heartbeatPath": "/Users/me/.port-daddy/heartbeat",
 *   "intervalMs": 5000,
 *   "staleAfterMs": 30000,
 *   "lastWrittenAt": 1777050000000,
 *   "lastError": null,
 *   "writeCount": 1,
 *   "pid": 12345
 * }
 * ```
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_PID_FILE, DEFAULT_PORT_FILE, PD_HOME } from '../shared/paths.js';

export const BOSUN_HEARTBEAT_SCHEMA = 'port-daddy.bosun.heartbeat.v1';
export const DEFAULT_BOSUN_HEARTBEAT_INTERVAL_MS = 5_000;
export const DEFAULT_BOSUN_STALE_AFTER_MS = 30_000;

export type BosunHeartbeatState = 'idle' | 'healthy' | 'degraded' | 'stopped';

export interface BosunHeartbeatPayload {
  schema: typeof BOSUN_HEARTBEAT_SCHEMA;
  pid: number;
  writtenAt: number;
  uptimeMs: number;
  version: string;
  codeHash: string;
  startedAt: number;
  installDir: string;
  pidFile: string;
  portFile: string;
  hostname: string;
}

export interface BosunHeartbeatStatus {
  enabled: boolean;
  state: BosunHeartbeatState;
  heartbeatPath: string;
  intervalMs: number;
  staleAfterMs: number;
  lastWrittenAt: number | null;
  lastError: string | null;
  writeCount: number;
  pid: number;
  ownerPid: number | null;
}

export interface BosunHeartbeatOptions {
  heartbeatPath?: string;
  intervalMs?: number;
  staleAfterMs?: number;
  version: string;
  codeHash: string;
  startedAt: number;
  installDir: string;
  pidFile?: string;
  portFile?: string;
  pid?: number;
  requirePidFileMatch?: boolean;
  now?: () => number;
  uptimeMs?: () => number;
  logger?: {
    info?(message: string, meta?: Record<string, unknown>): void;
    warn?(message: string, meta?: Record<string, unknown>): void;
    error?(message: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Resolve the daemon heartbeat path.
 *
 * Input:
 *
 * ```ts
 * process.env.PORT_DADDY_HEARTBEAT_FILE = '/tmp/pd-heartbeat'
 * defaultBosunHeartbeatPath()
 * ```
 *
 * Output:
 *
 * ```ts
 * '/tmp/pd-heartbeat'
 * ```
 */
export function defaultBosunHeartbeatPath(): string {
  return process.env.PORT_DADDY_HEARTBEAT_FILE || join(PD_HOME, 'heartbeat');
}

/**
 * Read and parse a Bosun heartbeat file.
 *
 * Input file contents:
 *
 * ```json
 * {"schema":"port-daddy.bosun.heartbeat.v1","pid":123,"writtenAt":1}
 * ```
 *
 * Output:
 *
 * ```ts
 * { schema: 'port-daddy.bosun.heartbeat.v1', pid: 123, writtenAt: 1, ... }
 * ```
 */
export function readBosunHeartbeat(path = defaultBosunHeartbeatPath()): BosunHeartbeatPayload | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as BosunHeartbeatPayload;
  return parsed.schema === BOSUN_HEARTBEAT_SCHEMA ? parsed : null;
}

/**
 * Create a daemon heartbeat writer for the external Bosun supervisor.
 *
 * The writer performs atomic `write temp -> rename` updates so the supervisor
 * never observes a partially-written JSON document. Calling `start()` writes
 * immediately, then repeats every `intervalMs`.
 *
 * Input:
 *
 * ```ts
 * const heartbeat = createBosunHeartbeat({
 *   version: '3.10.0',
 *   codeHash: 'abc123',
 *   startedAt: Date.now(),
 *   installDir: '/repo'
 * });
 * heartbeat.start();
 * ```
 *
 * Output:
 *
 * ```ts
 * heartbeat.getStatus().state === 'healthy'
 * ```
 */
export function createBosunHeartbeat(options: BosunHeartbeatOptions) {
  const heartbeatPath = options.heartbeatPath ?? defaultBosunHeartbeatPath();
  const intervalMs = options.intervalMs ?? DEFAULT_BOSUN_HEARTBEAT_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_BOSUN_STALE_AFTER_MS;
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now;
  const uptimeMs = options.uptimeMs ?? (() => Math.floor(process.uptime() * 1000));
  const pidFile = options.pidFile ?? DEFAULT_PID_FILE;
  const portFile = options.portFile ?? DEFAULT_PORT_FILE;

  let timer: ReturnType<typeof setInterval> | null = null;
  const status: BosunHeartbeatStatus = {
    enabled: false,
    state: 'idle',
    heartbeatPath,
    intervalMs,
    staleAfterMs,
    lastWrittenAt: null,
    lastError: null,
    writeCount: 0,
    pid,
    ownerPid: null,
  };

  function readPidFileOwner(): number | null {
    try {
      const raw = readFileSync(pidFile, 'utf8').trim();
      const ownerPid = Number.parseInt(raw, 10);
      return Number.isInteger(ownerPid) && ownerPid > 0 ? ownerPid : null;
    } catch {
      return null;
    }
  }

  function assertCanonicalOwnership(): void {
    if (!options.requirePidFileMatch) return;
    const ownerPid = readPidFileOwner();
    status.ownerPid = ownerPid;
    if (ownerPid !== pid) {
      throw new Error(`canonical pid file ${pidFile} belongs to ${ownerPid ?? 'nobody'}, not heartbeat pid ${pid}`);
    }
  }

  function buildPayload(): BosunHeartbeatPayload {
    return {
      schema: BOSUN_HEARTBEAT_SCHEMA,
      pid,
      writtenAt: now(),
      uptimeMs: uptimeMs(),
      version: options.version,
      codeHash: options.codeHash,
      startedAt: options.startedAt,
      installDir: options.installDir,
      pidFile,
      portFile,
      hostname: hostname(),
    };
  }

  function writeOnce(): BosunHeartbeatPayload {
    const payload = buildPayload();
    const targetDir = dirname(heartbeatPath);
    const tempPath = join(targetDir, `.heartbeat.${pid}.${payload.writtenAt}.tmp`);

    try {
      assertCanonicalOwnership();
      mkdirSync(targetDir, { recursive: true, mode: 0o700 });
      writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
      renameSync(tempPath, heartbeatPath);
      status.enabled = true;
      status.state = 'healthy';
      status.lastWrittenAt = payload.writtenAt;
      status.lastError = null;
      status.writeCount += 1;
      return payload;
    } catch (err) {
      status.enabled = true;
      status.state = 'degraded';
      status.lastError = (err as Error).message;
      options.logger?.error?.('bosun_heartbeat_write_failed', {
        path: heartbeatPath,
        error: status.lastError,
      });
      throw err;
    }
  }

  return {
    start() {
      if (timer) return;
      try {
        writeOnce();
      } catch {
        // Status is already degraded and logged. Keep the interval alive so a
        // transient filesystem failure can recover without daemon restart.
      }
      timer = setInterval(() => {
        try {
          writeOnce();
        } catch {
          // writeOnce records the error in status.
        }
      }, intervalMs);
      timer.unref?.();
      options.logger?.info?.('bosun_heartbeat_started', {
        path: heartbeatPath,
        intervalMs,
        staleAfterMs,
      });
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      status.enabled = false;
      status.state = 'stopped';
    },

    writeOnce,

    getStatus(): BosunHeartbeatStatus {
      return { ...status };
    },
  };
}
