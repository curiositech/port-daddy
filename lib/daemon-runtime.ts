/**
 * Canonical daemon runtime identity and macOS supervisor control.
 *
 * launchd owns process resurrection, the daemon owns readiness, and Bosun
 * observes the daemon heartbeat. Those are deliberately separate jobs, but
 * they must all describe the same generation. This module is the one place
 * that joins their claims into an operator-visible verdict.
 */

import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_DAEMON_PORT, LOOPBACK_TCP_HOST } from '../shared/daemon-discovery.js';
import { DEFAULT_PID_FILE, DEFAULT_PORT_FILE, PD_HOME } from '../shared/paths.js';
import { BOSUN_HEARTBEAT_SCHEMA, DEFAULT_BOSUN_STALE_AFTER_MS } from './bosun-heartbeat.js';

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
  binaryDrift?: { drifted?: boolean; reason?: string };
}

export interface RuntimeIdentityFacts {
  checkedAt: number;
  expectedPort: number;
  endpointPort: number | null;
  healthPid: number | null;
  healthPort: number | null;
  healthStatus: string | null;
  binaryDrifted: boolean | null;
  pidFilePid: number | null;
  portFilePort: number | null;
  heartbeatPid: number | null;
  heartbeatWrittenAt: number | null;
  heartbeatFresh: boolean | null;
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

function readNumber(path: string): number | null {
  try {
    const value = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function readHeartbeat(path: string): { pid: number; writtenAt: number } | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as {
      schema?: string;
      pid?: number;
      writtenAt?: number;
    };
    if (value.schema !== BOSUN_HEARTBEAT_SCHEMA) return null;
    if (!Number.isInteger(value.pid) || !Number.isFinite(value.writtenAt)) return null;
    return { pid: value.pid as number, writtenAt: value.writtenAt as number };
  } catch {
    return null;
  }
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
  if (facts.endpointPort !== facts.expectedPort) {
    issues.push(`health endpoint used port ${facts.endpointPort ?? 'unknown'}, expected ${facts.expectedPort}`);
  }
  if (facts.healthPort === null) missing.push('daemon advertised port');
  else if (facts.healthPort !== facts.expectedPort) issues.push(`daemon advertised port ${facts.healthPort}, expected ${facts.expectedPort}`);
  if (facts.portFilePort === null) missing.push('daemon.port');
  else if (facts.portFilePort !== facts.expectedPort) issues.push(`daemon.port contains ${facts.portFilePort}, expected ${facts.expectedPort}`);
  if (facts.pidFilePid === null) missing.push('daemon.pid');
  else if (facts.pidFilePid !== healthPid) issues.push(`daemon.pid=${facts.pidFilePid}, /health pid=${healthPid}`);
  if (facts.heartbeatPid === null) missing.push('Bosun heartbeat');
  else if (facts.heartbeatPid !== healthPid) issues.push(`Bosun heartbeat pid=${facts.heartbeatPid}, /health pid=${healthPid}`);
  if (facts.heartbeatFresh === false) issues.push('Bosun heartbeat is stale');
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
  if (missing.length > 0 || facts.binaryDrifted === null || facts.heartbeatFresh === null) {
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
    ? 'launchd, /health, daemon.pid, daemon.port, and Bosun heartbeat'
    : '/health, daemon.pid, daemon.port, and Bosun heartbeat';
  return {
    state: 'converged',
    severity: 'ok',
    summary: `${authorities} agree on PID ${healthPid} at :${facts.expectedPort}`,
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
    expectedPort?: number;
    endpointPort?: number | null;
    pidFile?: string;
    portFile?: string;
    heartbeatFile?: string;
    heartbeatStaleAfterMs?: number;
    supervisor?: LaunchdSupervisorSnapshot | null;
  } = {},
): RuntimeIdentityAssessment {
  const now = opts.now ?? Date.now();
  const heartbeat = readHeartbeat(opts.heartbeatFile ?? join(PD_HOME, 'heartbeat'));
  const facts: RuntimeIdentityFacts = {
    checkedAt: now,
    expectedPort: opts.expectedPort ?? DEFAULT_DAEMON_PORT,
    endpointPort: opts.endpointPort ?? null,
    healthPid: Number.isInteger(health?.pid) ? health!.pid! : null,
    healthPort: Number.isInteger(health?.daemon?.port) ? health!.daemon!.port! : null,
    healthStatus: typeof health?.status === 'string' ? health.status : null,
    binaryDrifted: typeof health?.binaryDrift?.drifted === 'boolean' ? health.binaryDrift.drifted : null,
    pidFilePid: readNumber(opts.pidFile ?? DEFAULT_PID_FILE),
    portFilePort: readNumber(opts.portFile ?? DEFAULT_PORT_FILE),
    heartbeatPid: heartbeat?.pid ?? null,
    heartbeatWrittenAt: heartbeat?.writtenAt ?? null,
    heartbeatFresh: heartbeat
      ? now - heartbeat.writtenAt <= (opts.heartbeatStaleAfterMs ?? DEFAULT_BOSUN_STALE_AFTER_MS)
      : null,
    supervisor: opts.supervisor === undefined ? inspectCanonicalLaunchdSupervisor() : opts.supervisor,
  };
  return assessRuntimeIdentity(facts);
}

/** Probe the canonical TCP endpoint directly, never through a stale port file. */
export function probeCanonicalHealth(
  port = DEFAULT_DAEMON_PORT,
  timeoutMs = 1_500,
): Promise<RuntimeHealthSnapshot | null> {
  return new Promise((resolve) => {
    const request = http.request({
      host: LOOPBACK_TCP_HOST,
      port,
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

export async function waitForCanonicalRuntime(opts: {
  previousPid?: number | null;
  timeoutMs?: number;
  pollIntervalMs?: number;
  stableSamples?: number;
  probeHealth?: () => Promise<RuntimeHealthSnapshot | null>;
  inspectSupervisor?: () => LaunchdSupervisorSnapshot | null;
  collect?: (health: RuntimeHealthSnapshot | null, supervisor: LaunchdSupervisorSnapshot | null) => RuntimeIdentityAssessment;
  onProgress?: (elapsedMs: number, assessment: RuntimeIdentityAssessment) => void;
} = {}): Promise<RuntimeIdentityAssessment> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 250;
  const stableSamples = Math.max(1, opts.stableSamples ?? 2);
  const probe = opts.probeHealth ?? (() => probeCanonicalHealth());
  const inspect = opts.inspectSupervisor ?? (() => inspectCanonicalLaunchdSupervisor());
  const collect = opts.collect ?? ((health, supervisor) => collectRuntimeIdentity(health, {
    endpointPort: DEFAULT_DAEMON_PORT,
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
