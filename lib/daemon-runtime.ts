/**
 * Canonical daemon runtime identity and macOS supervisor control.
 *
 * There is exactly one process supervisor: Homebrew's launchd job. It owns
 * process resurrection; the daemon owns readiness and publishes the port it
 * actually bound. Those are deliberately separate jobs, but they must all
 * describe the same generation. This module is the one place that joins
 * their claims into an operator-visible verdict.
 *
 * The daemon's preferred startup port is a seed, not a promise — if it is
 * occupied, the stable daemon binds elsewhere and publishes wherever it
 * actually landed via a strict `daemon.port` file. Nothing in this module
 * assumes a fixed port; every port comparison is anchored to that published
 * (or an explicitly injected) endpoint.
 */

import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOOPBACK_TCP_HOST } from '../shared/daemon-discovery.js';
import { DEFAULT_PID_FILE, DEFAULT_PORT_FILE, PD_HOME } from '../shared/paths.js';

export const CANONICAL_LAUNCHD_LABEL = 'homebrew.mxcl.port-daddy';

export interface LaunchdSupervisorSnapshot {
  label: string;
  target: string;
  plistPath: string;
  installed: boolean;
  loaded: boolean;
  running: boolean;
  pid: number | null;
  state: string | null;
  error: string | null;
}

export interface RuntimeHealthSnapshot {
  status?: string;
  severity?: string;
  pid?: number;
  version?: string;
  daemon?: { port?: number; canonical?: boolean; builtAt?: string | null };
  plane?: string;
  binaryDrift?: { drifted?: boolean; reason?: string };
}

export interface RuntimeIdentityScope {
  expectedPort: number;
  pidFile: string;
  portFile: string;
  supervisor: LaunchdSupervisorSnapshot | null;
}

export interface RuntimeIdentityFacts {
  checkedAt: number;
  /**
   * The reference port every other authority is checked against. Always
   * resolved from a selected or published endpoint — never a fixed
   * constant — and `null` when no such endpoint could be determined.
   */
  expectedPort: number | null;
  endpointPort: number | null;
  healthPid: number | null;
  healthPort: number | null;
  healthStatus: string | null;
  binaryDrifted: boolean | null;
  pidFilePid: number | null;
  portFilePort: number | null;
  supervisor: LaunchdSupervisorSnapshot | null;
}

export interface RuntimeIdentityAssessment {
  state: 'converged' | 'diverged' | 'incomplete' | 'unavailable';
  severity: 'ok' | 'warn' | 'critical';
  summary: string;
  issues: string[];
  missing: string[];
  facts: RuntimeIdentityFacts;
}

export interface LaunchctlResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

type LaunchctlRunner = (args: string[]) => LaunchctlResult;

function defaultLaunchctlRunner(args: string[]): LaunchctlResult {
  const result = spawnSync('launchctl', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function canonicalLaunchdCoordinates(home = homedir(), uid = process.getuid?.() ?? 501): {
  target: string;
  domain: string;
  plistPath: string;
} {
  const domain = `gui/${uid}`;
  return {
    domain,
    target: `${domain}/${CANONICAL_LAUNCHD_LABEL}`,
    plistPath: join(home, 'Library', 'LaunchAgents', `${CANONICAL_LAUNCHD_LABEL}.plist`),
  };
}

/** Parse the stable fields from `launchctl print gui/<uid>/<label>`. */
export function parseLaunchctlPrint(
  output: string,
  opts: { home?: string; uid?: number; pidAlive?: (pid: number) => boolean } = {},
): LaunchdSupervisorSnapshot {
  const coordinates = canonicalLaunchdCoordinates(opts.home, opts.uid);
  const state = /^\s*state\s*=\s*([^\n]+)$/m.exec(output)?.[1]?.trim() ?? null;
  const rawPid = /^\s*pid\s*=\s*(\d+)$/m.exec(output)?.[1];
  const pid = rawPid ? Number.parseInt(rawPid, 10) : null;
  const pidAlive = opts.pidAlive ?? ((candidate: number) => {
    try {
      process.kill(candidate, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  });
  const running = state === 'running' && pid !== null && pidAlive(pid);
  return {
    label: CANONICAL_LAUNCHD_LABEL,
    target: coordinates.target,
    plistPath: coordinates.plistPath,
    installed: true,
    loaded: true,
    running,
    pid,
    state,
    error: running || state ? null : 'launchd job has no running state',
  };
}

/** Inspect the canonical Homebrew launchd job without mutating it. */
export function inspectCanonicalLaunchdSupervisor(opts: {
  home?: string;
  uid?: number;
  platform?: NodeJS.Platform;
  runLaunchctl?: LaunchctlRunner;
  pidAlive?: (pid: number) => boolean;
} = {}): LaunchdSupervisorSnapshot | null {
  const currentPlatform = opts.platform ?? process.platform;
  if (currentPlatform !== 'darwin') return null;
  const coordinates = canonicalLaunchdCoordinates(opts.home, opts.uid);
  const installed = existsSync(coordinates.plistPath);
  const runLaunchctl = opts.runLaunchctl ?? defaultLaunchctlRunner;
  const result = runLaunchctl(['print', coordinates.target]);
  if (result.status === 0) {
    return {
      ...parseLaunchctlPrint(result.stdout, {
        home: opts.home,
        uid: opts.uid,
        pidAlive: opts.pidAlive,
      }),
      installed,
    };
  }
  return {
    label: CANONICAL_LAUNCHD_LABEL,
    target: coordinates.target,
    plistPath: coordinates.plistPath,
    installed,
    loaded: false,
    running: false,
    pid: null,
    state: null,
    error: result.stderr.trim() || 'launchd job is not loaded',
  };
}

export type CanonicalLaunchdAction = 'start' | 'restart' | 'stop';

/**
 * Perform one supervisor-owned lifecycle mutation. This never spawns a daemon
 * process itself, so launchd remains the sole parent and resurrection owner.
 */
export function runCanonicalLaunchdAction(
  action: CanonicalLaunchdAction,
  supervisor: LaunchdSupervisorSnapshot,
  runLaunchctl: LaunchctlRunner = defaultLaunchctlRunner,
): LaunchctlResult {
  if (!supervisor.installed) {
    return { status: 1, stdout: '', stderr: `launchd plist is missing: ${supervisor.plistPath}` };
  }
  if (action === 'stop') {
    if (!supervisor.loaded) return { status: 0, stdout: '', stderr: '' };
    return runLaunchctl(['bootout', supervisor.target]);
  }
  if (action === 'restart') {
    if (!supervisor.loaded) {
      return runLaunchctl(['bootstrap', supervisor.target.slice(0, supervisor.target.lastIndexOf('/')), supervisor.plistPath]);
    }
    return runLaunchctl(['kickstart', '-k', supervisor.target]);
  }
  if (!supervisor.loaded) {
    return runLaunchctl(['bootstrap', supervisor.target.slice(0, supervisor.target.lastIndexOf('/')), supervisor.plistPath]);
  }
  return runLaunchctl(['kickstart', supervisor.target]);
}

export interface StrictFileIntegerResult {
  ok: boolean;
  value: number | null;
  path: string;
  error: string | null;
}

const STRICT_WHOLE_NUMBER = /^[0-9]+$/;
const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const MIN_PID = 1;
// Generous ceiling covering both macOS's small PID space and Linux's
// configurable kernel.pid_max (2^22 - 1 at its documented maximum).
const MAX_PID = 4_194_304;

/**
 * Read a runtime identity file as a bare whole-file integer. The ENTIRE
 * trimmed file content must be digits — no trailing garbage, no embedded
 * lines, no sign, no fractional part — and the value must fall inside
 * `bounds`. A torn write, a stale multi-line file, or an out-of-range value
 * is rejected rather than partially parsed, so a malformed publication fails
 * closed instead of silently resolving to whatever `parseInt` could salvage.
 */
function readStrictWholeFileInteger(path: string, bounds: { min: number; max: number }): StrictFileIntegerResult {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { ok: false, value: null, path, error: `not published: ${path} does not exist` };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, value: null, path, error: `not published: ${path} is empty` };
  }
  if (!STRICT_WHOLE_NUMBER.test(trimmed)) {
    return { ok: false, value: null, path, error: `malformed: ${path} is not a bare whole-file integer` };
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
    return {
      ok: false,
      value: null,
      path,
      error: `out of range: ${path} contains ${trimmed}, expected ${bounds.min}-${bounds.max}`,
    };
  }
  return { ok: true, value, path, error: null };
}

/** Strictly read the published TCP port from a `daemon.port`-shaped file. */
export function readPublishedPortFile(path: string): StrictFileIntegerResult {
  return readStrictWholeFileInteger(path, { min: MIN_TCP_PORT, max: MAX_TCP_PORT });
}

/** Strictly read the published PID from a `daemon.pid`-shaped file. */
export function readPublishedPidFile(path: string): StrictFileIntegerResult {
  return readStrictWholeFileInteger(path, { min: MIN_PID, max: MAX_PID });
}

/**
 * Resolve every authority used to assess one daemon generation.
 *
 * `expectedPort` always tracks the caller's selected/published endpoint —
 * for the canonical production scope exactly as much as for a named or
 * ephemeral one. The stable daemon is free to bind away from its preferred
 * startup seed when that port is occupied, so pinning production to a fixed
 * constant here would flag a healthy, merely-relocated daemon as diverged.
 * What DOES stay scope-gated is which runtime files and which supervisor
 * apply: named and ephemeral berths own a private runtime directory and have
 * no relationship to the production launchd job, so their port, files, and
 * supervisor all move together as one scope.
 */
export function resolveRuntimeIdentityScope(
  health: RuntimeHealthSnapshot | null,
  opts: {
    endpointPort: number;
    runtimePrefix?: string | null;
    canonicalSupervisor?: LaunchdSupervisorSnapshot | null;
  },
): RuntimeIdentityScope {
  const plane = typeof health?.plane === 'string' ? health.plane : null;
  const nonCanonical = plane !== null
    ? plane !== 'prod'
    : health?.daemon?.canonical === false;
  const runtimePrefix = opts.runtimePrefix?.trim() || null;
  const runtimeDir = nonCanonical && runtimePrefix ? runtimePrefix : PD_HOME;
  return {
    expectedPort: opts.endpointPort,
    pidFile: join(runtimeDir, 'daemon.pid'),
    portFile: join(runtimeDir, 'daemon.port'),
    supervisor: nonCanonical ? null : (opts.canonicalSupervisor ?? null),
  };
}

export function assessRuntimeIdentity(facts: RuntimeIdentityFacts): RuntimeIdentityAssessment {
  const issues: string[] = [];
  const missing: string[] = [];
  const healthPid = facts.healthPid;
  if (healthPid === null) {
    return {
      state: 'unavailable',
      severity: 'critical',
      summary: 'daemon readiness is unavailable',
      issues: ['canonical /health did not identify a daemon PID'],
      missing: [],
      facts,
    };
  }
  if (facts.healthStatus !== 'ok') issues.push(`/health reported ${facts.healthStatus ?? 'no status'}`);

  const expectedPort = facts.expectedPort;
  if (expectedPort === null) {
    // No selected or published endpoint could be determined at all — every
    // port comparison below would be meaningless, so fail closed on that one
    // fact instead of fabricating a fixed-port baseline to compare against.
    missing.push('published port (daemon.port)');
  } else {
    if (facts.endpointPort !== expectedPort) {
      issues.push(`health endpoint used port ${facts.endpointPort ?? 'unknown'}, expected ${expectedPort}`);
    }
    if (facts.healthPort === null) missing.push('daemon advertised port');
    else if (facts.healthPort !== expectedPort) issues.push(`daemon advertised port ${facts.healthPort}, expected ${expectedPort}`);
    if (facts.portFilePort === null) missing.push('daemon.port');
    else if (facts.portFilePort !== expectedPort) issues.push(`daemon.port contains ${facts.portFilePort}, expected ${expectedPort}`);
  }

  if (facts.pidFilePid === null) missing.push('daemon.pid');
  else if (facts.pidFilePid !== healthPid) issues.push(`daemon.pid=${facts.pidFilePid}, /health pid=${healthPid}`);

  if (facts.supervisor) {
    if (!facts.supervisor.loaded) issues.push(`${facts.supervisor.label} is not loaded`);
    else if (!facts.supervisor.running) issues.push(`${facts.supervisor.label} is not running`);
    else if (facts.supervisor.pid !== healthPid) {
      issues.push(`${facts.supervisor.label} pid=${facts.supervisor.pid ?? 'unknown'}, /health pid=${healthPid}`);
    }
  }
  if (facts.binaryDrifted === true) issues.push('running daemon binary differs from the installed daemon binary');

  if (issues.length > 0) {
    return {
      state: 'diverged',
      severity: 'critical',
      summary: issues.join('; '),
      issues,
      missing,
      facts,
    };
  }
  if (missing.length > 0 || facts.binaryDrifted === null) {
    return {
      state: 'incomplete',
      severity: 'warn',
      summary: `runtime responded, but ${missing.join(', ') || 'one or more identity facts'} could not be verified`,
      issues,
      missing,
      facts,
    };
  }
  const authorities = facts.supervisor
    ? 'launchd, /health, daemon.pid, and daemon.port'
    : '/health, daemon.pid, and daemon.port';
  return {
    state: 'converged',
    severity: 'ok',
    summary: `${authorities} agree on PID ${healthPid} at :${expectedPort ?? '?'}`,
    issues,
    missing,
    facts,
  };
}

/** Collect one local snapshot and immediately assess it. */
export function collectRuntimeIdentity(
  health: RuntimeHealthSnapshot | null,
  opts: {
    now?: number;
    /** Explicit selected/published endpoint. Falls back to a strict read of `portFile` when omitted. */
    expectedPort?: number | null;
    endpointPort?: number | null;
    pidFile?: string;
    portFile?: string;
    supervisor?: LaunchdSupervisorSnapshot | null;
  } = {},
): RuntimeIdentityAssessment {
  const now = opts.now ?? Date.now();
  const pidFile = opts.pidFile ?? DEFAULT_PID_FILE;
  const portFile = opts.portFile ?? DEFAULT_PORT_FILE;
  const portRead = readPublishedPortFile(portFile);
  const expectedPort = opts.expectedPort ?? portRead.value;
  const facts: RuntimeIdentityFacts = {
    checkedAt: now,
    expectedPort,
    endpointPort: opts.endpointPort ?? null,
    healthPid: Number.isInteger(health?.pid) ? health!.pid! : null,
    healthPort: Number.isInteger(health?.daemon?.port) ? health!.daemon!.port! : null,
    healthStatus: typeof health?.status === 'string' ? health.status : null,
    binaryDrifted: typeof health?.binaryDrift?.drifted === 'boolean' ? health.binaryDrift.drifted : null,
    pidFilePid: readPublishedPidFile(pidFile).value,
    portFilePort: portRead.value,
    supervisor: opts.supervisor === undefined ? inspectCanonicalLaunchdSupervisor() : opts.supervisor,
  };
  return assessRuntimeIdentity(facts);
}

export interface CanonicalHealthEndpoint {
  host?: string;
  port: number;
}

type HealthRequester = (
  endpoint: { host: string; port: number },
  timeoutMs: number,
) => Promise<RuntimeHealthSnapshot | null>;

function requestHealthOverTcp(
  endpoint: { host: string; port: number },
  timeoutMs: number,
): Promise<RuntimeHealthSnapshot | null> {
  return new Promise((resolve) => {
    const request = http.request({
      host: endpoint.host,
      port: endpoint.port,
      path: '/health',
      method: 'GET',
      timeout: timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RuntimeHealthSnapshot;
          resolve(parsed && typeof parsed === 'object' ? parsed : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

export interface ProbeCanonicalHealthOptions {
  /** Explicit injected endpoint. When set, publication discovery never runs. */
  endpoint?: CanonicalHealthEndpoint | null;
  /** Strict `daemon.port` file to discover the published endpoint from. */
  portFile?: string;
  timeoutMs?: number;
  requestHealth?: HealthRequester;
}

/**
 * Resolve which endpoint {@link probeCanonicalHealth} would dial, without
 * performing any network I/O. An explicit `opts.endpoint` always wins; absent
 * that, the published port is discovered via a strict whole-file read of
 * `opts.portFile`. There is no fixed-port fallback — a missing or malformed
 * publication resolves to `null` (fail closed) rather than guessing.
 */
export function resolveProbeEndpoint(
  opts: { endpoint?: CanonicalHealthEndpoint | null; portFile?: string } = {},
): { host: string; port: number } | null {
  if (opts.endpoint) {
    return { host: opts.endpoint.host ?? LOOPBACK_TCP_HOST, port: opts.endpoint.port };
  }
  const published = readPublishedPortFile(opts.portFile ?? DEFAULT_PORT_FILE);
  if (!published.ok || published.value === null) return null;
  return { host: LOOPBACK_TCP_HOST, port: published.value };
}

/**
 * Probe a daemon's `/health` endpoint directly, never through a stale cache.
 * The target endpoint comes from an explicit injection or from a strict
 * `daemon.port` file read — never from a fixed constant. When neither
 * resolves an endpoint, this fails closed (resolves `null`) instead of
 * probing a guessed port.
 */
export function probeCanonicalHealth(
  opts: ProbeCanonicalHealthOptions = {},
): Promise<RuntimeHealthSnapshot | null> {
  const endpoint = resolveProbeEndpoint(opts);
  if (!endpoint) return Promise.resolve(null);
  const requestHealth = opts.requestHealth ?? requestHealthOverTcp;
  return requestHealth(endpoint, opts.timeoutMs ?? 1_500);
}

export async function waitForCanonicalRuntime(opts: {
  previousPid?: number | null;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stableSamples?: number;
  /** Strict `daemon.port` file the default probe/collect pair discovers the published endpoint from. */
  portFile?: string;
  probeHealth?: () => Promise<RuntimeHealthSnapshot | null>;
  inspectSupervisor?: () => LaunchdSupervisorSnapshot | null;
  collect?: (health: RuntimeHealthSnapshot | null, supervisor: LaunchdSupervisorSnapshot | null) => RuntimeIdentityAssessment;
  onProgress?: (elapsedMs: number, assessment: RuntimeIdentityAssessment) => void;
} = {}): Promise<RuntimeIdentityAssessment> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const stableSamples = Math.max(1, opts.stableSamples ?? 2);
  const portFile = opts.portFile ?? DEFAULT_PORT_FILE;
  const probe = opts.probeHealth ?? (() => probeCanonicalHealth({ portFile }));
  const inspect = opts.inspectSupervisor ?? (() => inspectCanonicalLaunchdSupervisor());
  const collect = opts.collect ?? ((health, supervisor) => collectRuntimeIdentity(health, {
    portFile,
    supervisor,
  }));
  const startedAt = Date.now();
  let consecutive = 0;
  let lastProgressAt = -5_000;
  let last = collect(null, inspect());
  while (Date.now() - startedAt <= timeoutMs) {
    const health = await probe();
    last = collect(health, inspect());
    const generationAdvanced = !opts.previousPid || last.facts.healthPid !== opts.previousPid;
    if (last.state === 'converged' && generationAdvanced) {
      consecutive += 1;
      if (consecutive >= stableSamples) return last;
    } else {
      consecutive = 0;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed - lastProgressAt >= 5_000) {
      opts.onProgress?.(elapsed, last);
      lastProgressAt = elapsed;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return last;
}
