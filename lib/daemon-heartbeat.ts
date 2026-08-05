/**
 * Daemon Heartbeat Writer
 *
 * The daemon periodically publishes an atomic filesystem heartbeat. Doctor,
 * FleetBar, and recovery tooling can inspect it without depending on the
 * daemon's HTTP stack; launchd/systemd remain the only process supervisors.
 *
 * Example heartbeat payload:
 *
 * ```json
 * {
 *   "schema": "port-daddy.daemon.heartbeat.v1",
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
import http from 'node:http';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_PID_FILE, DEFAULT_PORT_FILE, PD_HOME } from '../shared/paths.js';

export const DAEMON_HEARTBEAT_SCHEMA = 'port-daddy.daemon.heartbeat.v1';
export const DEFAULT_DAEMON_HEARTBEAT_INTERVAL_MS = 5_000;
export const DEFAULT_DAEMON_HEARTBEAT_STALE_AFTER_MS = 30_000;
export const DEFAULT_DAEMON_HEARTBEAT_PROBE_FAILURE_THRESHOLD = 3;
export const DEFAULT_DAEMON_HEARTBEAT_PROBE_TIMEOUT_MS = 2_000;

// 'wedged' = the daemon process is alive and the event loop is turning (so the
// heartbeat interval still fires), but its own HTTP request pipeline failed a
// loopback self-probe `probeFailureThreshold` times in a row. We deliberately
// stop advancing the heartbeat so diagnostics report the wedge instead of
// claiming the process is healthy. The OS supervisor still owns crash recovery;
// a live-but-wedged process remains an explicit recovery condition.
export type DaemonHeartbeatState = 'idle' | 'healthy' | 'degraded' | 'wedged' | 'displaced' | 'stopped';

export interface DaemonHeartbeatPayload {
  schema: typeof DAEMON_HEARTBEAT_SCHEMA;
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
  /**
   * State plane the daemon classified itself onto at boot (S1 —
   * lib/state-plane.ts). Absent when the daemon predates plane identity.
   */
  plane?: string;
}

export interface DaemonHeartbeatStatus {
  enabled: boolean;
  state: DaemonHeartbeatState;
  heartbeatPath: string;
  intervalMs: number;
  staleAfterMs: number;
  lastWrittenAt: number | null;
  lastError: string | null;
  writeCount: number;
  pid: number;
  ownerPid: number | null;
  /** Consecutive self-probe failures. Always 0 when no `selfProbe` is configured. */
  consecutiveProbeFailures: number;
  /** Result of the most recent self-probe, or null if none has run yet. */
  lastProbeOk: boolean | null;
}

export interface DaemonHeartbeatOptions {
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
  /** State plane to stamp into every heartbeat payload (S1). */
  plane?: string;
  requirePidFileMatch?: boolean;
  now?: () => number;
  uptimeMs?: () => number;
  /**
   * Optional loopback liveness probe of the daemon's own request pipeline.
   * Returns true when the daemon can still serve a request, false (or throws)
   * when it cannot. When omitted, heartbeat behaviour is unchanged: the writer
   * only proves the event loop is turning, not that HTTP works. See
   * {@link createSocketHealthProbe} for the production wiring.
   */
  selfProbe?: () => boolean | Promise<boolean>;
  /**
   * Keep publishing the process heartbeat during bootstrap, but wait to arm
   * the request-pipeline probe until the listener exists. This prevents a
   * healthy, still-starting daemon from failing three connection probes and
   * deliberately making its own heartbeat stale before it can bind.
   */
  deferSelfProbeUntilReady?: boolean;
  /** Consecutive probe failures before the heartbeat halts. Default 3. */
  probeFailureThreshold?: number;
  /** Cadence of the self-probe loop. Defaults to `intervalMs`. */
  probeIntervalMs?: number;
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
 * defaultDaemonHeartbeatPath()
 * ```
 *
 * Output:
 *
 * ```ts
 * '/tmp/pd-heartbeat'
 * ```
 */
export function defaultDaemonHeartbeatPath(): string {
  return process.env.PORT_DADDY_HEARTBEAT_FILE || join(PD_HOME, 'heartbeat');
}

/**
 * Read and parse a daemon heartbeat file.
 *
 * Input file contents:
 *
 * ```json
 * {"schema":"port-daddy.daemon.heartbeat.v1","pid":123,"writtenAt":1}
 * ```
 *
 * Output:
 *
 * ```ts
 * { schema: 'port-daddy.daemon.heartbeat.v1', pid: 123, writtenAt: 1, ... }
 * ```
 */
export function readDaemonHeartbeat(path = defaultDaemonHeartbeatPath()): DaemonHeartbeatPayload | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as DaemonHeartbeatPayload;
  return parsed.schema === DAEMON_HEARTBEAT_SCHEMA ? parsed : null;
}

/**
 * Create the daemon-owned runtime heartbeat writer.
 *
 * The writer performs atomic `write temp -> rename` updates so the supervisor
 * never observes a partially-written JSON document. Calling `start()` writes
 * immediately, then repeats every `intervalMs`. The interval intentionally stays
 * referenced because heartbeat progress is mandatory runtime evidence, not an
 * optional background metric.
 *
 * Input:
 *
 * ```ts
 * const heartbeat = createDaemonHeartbeat({
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
export function createDaemonHeartbeat(options: DaemonHeartbeatOptions) {
  const heartbeatPath = options.heartbeatPath ?? defaultDaemonHeartbeatPath();
  const intervalMs = options.intervalMs ?? DEFAULT_DAEMON_HEARTBEAT_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_DAEMON_HEARTBEAT_STALE_AFTER_MS;
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now;
  const uptimeMs = options.uptimeMs ?? (() => Math.floor(process.uptime() * 1000));
  const pidFile = options.pidFile ?? DEFAULT_PID_FILE;
  const portFile = options.portFile ?? DEFAULT_PORT_FILE;
  const selfProbe = options.selfProbe;
  const probeFailureThreshold = Math.max(1, options.probeFailureThreshold ?? DEFAULT_DAEMON_HEARTBEAT_PROBE_FAILURE_THRESHOLD);
  const probeIntervalMs = options.probeIntervalMs ?? intervalMs;

  let timer: ReturnType<typeof setInterval> | null = null;
  let probeTimer: ReturnType<typeof setInterval> | null = null;
  let probeInFlight = false;
  const status: DaemonHeartbeatStatus = {
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
    consecutiveProbeFailures: 0,
    lastProbeOk: null,
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

  function assertCanonicalOwnership(): { displaced: boolean } {
    if (!options.requirePidFileMatch) return { displaced: false };
    const ownerPid = readPidFileOwner();
    status.ownerPid = ownerPid;
    if (ownerPid === pid) return { displaced: false };
    // A real owner pid that isn't us means another daemon has taken over the
    // canonical pid file. We are an orphan and our heartbeats are no longer
    // meaningful — surface this distinctly so the caller can self-stop instead
    // of retrying forever. A null owner (missing/empty pid file) is treated as
    // transient: the new daemon may still be writing it.
    const displaced = ownerPid !== null && ownerPid !== pid;
    const err = new Error(`canonical pid file ${pidFile} belongs to ${ownerPid ?? 'nobody'}, not heartbeat pid ${pid}`);
    (err as Error & { displaced?: boolean }).displaced = displaced;
    throw err;
  }

  function buildPayload(): DaemonHeartbeatPayload {
    return {
      schema: DAEMON_HEARTBEAT_SCHEMA,
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
      // State plane (S1) — spread conditionally so legacy heartbeat files keep
      // their exact JSON shape when no plane was classified.
      ...(options.plane ? { plane: options.plane } : {}),
    };
  }

  function writeOnce(): DaemonHeartbeatPayload {
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
      const displaced = (err as Error & { displaced?: boolean }).displaced === true;
      status.enabled = true;
      status.state = displaced ? 'displaced' : 'degraded';
      status.lastError = (err as Error).message;
      // Displacement is a one-shot event (another daemon owns the pid file);
      // log it once at warn so we don't spam error every interval forever.
      // Transient errors (filesystem, missing pid file) keep error logging so
      // they remain visible during real outages.
      if (displaced) {
        options.logger?.warn?.('daemon_heartbeat_displaced', {
          path: heartbeatPath,
          ownerPid: status.ownerPid,
          pid,
          error: status.lastError,
        });
      } else {
        options.logger?.error?.('daemon_heartbeat_write_failed', {
          path: heartbeatPath,
          error: status.lastError,
        });
      }
      throw err;
    }
  }

  function stopInternal(reason: 'manual' | 'displaced'): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (probeTimer) {
      clearInterval(probeTimer);
      probeTimer = null;
    }
    if (reason === 'displaced') {
      status.enabled = false;
      // Preserve state='displaced' so getStatus() and downstream readers can
      // distinguish "owner replaced us" from a clean stop().
      return;
    }
    status.enabled = false;
    status.state = 'stopped';
  }

  // Record one self-probe outcome. Pure and synchronous so the gating decision
  // is deterministic and timer-free in tests.
  function recordProbeResult(ok: boolean): boolean {
    status.lastProbeOk = ok;
    status.consecutiveProbeFailures = ok ? 0 : status.consecutiveProbeFailures + 1;
    return ok;
  }

  // Run the configured probe once and fold the result into the failure counter.
  // A thrown probe (e.g. connection refused, socket hang-up) counts as a failure.
  async function probeNow(): Promise<boolean> {
    if (!selfProbe) return true;
    try {
      return recordProbeResult((await selfProbe()) === true);
    } catch {
      return recordProbeResult(false);
    }
  }

  // True once the probe has failed `probeFailureThreshold` consecutive times.
  // Always false when no probe is configured (back-compat: heartbeat never halts
  // on its own).
  function shouldHalt(): boolean {
    return selfProbe != null && status.consecutiveProbeFailures >= probeFailureThreshold;
  }

  // One heartbeat interval iteration: halt (let the heartbeat go stale) if the
  // HTTP self-probe says we are wedged, otherwise write and handle displacement.
  function heartbeatTick(): void {
    if (shouldHalt()) {
      if (status.state !== 'wedged') {
        status.state = 'wedged';
        status.lastError = `self-probe failed ${status.consecutiveProbeFailures}x; halting heartbeat to expose the wedge`;
        options.logger?.error?.('daemon_heartbeat_wedged', {
          path: heartbeatPath,
          consecutiveProbeFailures: status.consecutiveProbeFailures,
          threshold: probeFailureThreshold,
          pid,
        });
      }
      // Do NOT advance the heartbeat. Doctor/FleetBar will observe staleness.
      // If the probe recovers first, the next tick writes again and state
      // returns to 'healthy' (self-heal).
      return;
    }
    try {
      writeOnce();
    } catch {
      // writeOnce records the error in status.
    }
    if (status.state === 'displaced') {
      options.logger?.info?.('daemon_heartbeat_self_stop', {
        path: heartbeatPath,
        reason: 'displaced',
        ownerPid: status.ownerPid,
        pid,
      });
      stopInternal('displaced');
    }
  }

  function startProbeLoop(): void {
    if (!selfProbe || probeTimer) return;
    const runProbe = () => {
      if (probeInFlight) return;
      probeInFlight = true;
      void probeNow().finally(() => {
        probeInFlight = false;
      });
    };
    runProbe();
    probeTimer = setInterval(runProbe, probeIntervalMs);
    if (typeof probeTimer.unref === 'function') probeTimer.unref();
    options.logger?.info?.('daemon_heartbeat_probe_started', {
      path: heartbeatPath,
      probeIntervalMs,
      probeFailureThreshold,
    });
  }

  return {
    start() {
      if (timer) return;
      try {
        writeOnce();
      } catch {
        // Status is already degraded/displaced and logged. If we were displaced
        // on the very first write, the interval below will short-circuit on the
        // next tick and self-stop without spamming errors.
      }
      if (status.state === 'displaced') {
        // No point starting an interval — we are an orphan. Log once and bail.
        options.logger?.info?.('daemon_heartbeat_self_stop', {
          path: heartbeatPath,
          reason: 'displaced',
          ownerPid: status.ownerPid,
          pid,
        });
        return;
      }
      timer = setInterval(heartbeatTick, intervalMs);
      // Self-probe loop runs on its own cadence and only updates the failure
      // counter; heartbeatTick reads it synchronously. A daemon may defer this
      // until its listener exists while the process heartbeat keeps advancing.
      if (!options.deferSelfProbeUntilReady) startProbeLoop();
      if (typeof timer.unref === 'function') timer.unref();
      options.logger?.info?.('daemon_heartbeat_started', {
        path: heartbeatPath,
        intervalMs,
        staleAfterMs,
        selfProbe: Boolean(selfProbe),
        probeFailureThreshold,
      });
    },

    stop() {
      stopInternal('manual');
    },

    /** Arm the request-pipeline probe after bootstrap has bound its listener. */
    startProbing() {
      startProbeLoop();
    },

    writeOnce,

    // Exposed for the daemon wiring and for deterministic, timer-free tests of
    // the wedge-detection path.
    probeNow,
    recordProbeResult,
    heartbeatTick,

    getStatus(): DaemonHeartbeatStatus {
      return { ...status };
    },
  };
}

/**
 * Build a loopback HTTP liveness probe over the daemon's Unix domain socket.
 *
 * The probe issues a real `GET /health` through the same Fastify request
 * pipeline that agents and the CLI use, so a handler/middleware deadlock,
 * exhausted connection capacity, or a hung route shows up as a non-response.
 * Any completed HTTP response (even a 5xx) counts as alive — the signal we care
 * about is "can the request pipeline answer at all", not route-level errors.
 * Only a timeout, connection refusal, or socket hang-up reads as dead.
 *
 * The Unix socket is the daemon's primary listener (TCP is secondary and races
 * the port file), so probing it is both representative and free of port races.
 *
 * Input:
 *
 * ```ts
 * const probe = createSocketHealthProbe({ socketPath: '/Users/me/.port-daddy/port-daddy.sock' });
 * await probe(); // true while the daemon serves requests, false once it wedges
 * ```
 */
export function createSocketHealthProbe(opts: {
  socketPath: string;
  path?: string;
  timeoutMs?: number;
}): () => Promise<boolean> {
  const path = opts.path ?? '/health';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_DAEMON_HEARTBEAT_PROBE_TIMEOUT_MS;
  return () =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (alive: boolean) => {
        if (settled) return;
        settled = true;
        resolve(alive);
      };
      const req = http.request(
        { socketPath: opts.socketPath, path, method: 'GET', timeout: timeoutMs },
        (res) => {
          // Any complete HTTP response means the pipeline answered: alive.
          const alive = typeof res.statusCode === 'number';
          res.resume(); // drain so the socket is released
          settle(alive);
        },
      );
      req.on('timeout', () => {
        req.destroy();
        settle(false);
      });
      req.on('error', () => settle(false));
      req.end();
    });
}
