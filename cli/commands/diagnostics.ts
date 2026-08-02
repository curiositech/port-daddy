/**
 * CLI Diagnostics Commands
 *
 * Handles: metrics, config, health, ports, dashboard, doctor, status, version commands
 */

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, accessSync, constants, openSync, closeSync, readSync, fstatSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { ANSI as marANSI } from '../../lib/maritime.js';
// SQLite via the runtime adapter — NOT better-sqlite3 directly. The `pd`
// CLI is compiled to a single Bun binary (ADR-0028), where a
// `better-sqlite3` import cannot resolve its native binding inside the
// read-only /$bunfs/ virtual filesystem (the same blocker that grounded
// the daemon). The adapter picks bun:sqlite under Bun and better-sqlite3
// under Node, so `pd doctor` works in both the compiled binary and dev.
import Database from '../../lib/sqlite-runtime.js';
// Canonical DB-path resolver. handleDoctor used to derive the registry path
// as join(__dirname, '..', '..', 'port-registry.db'); inside the compiled `pd`
// binary __dirname resolves into the read-only /$bunfs/ virtual filesystem, so
// existsSync() was always false and the SQLite-integrity probe was SILENTLY
// SKIPPED ('No database file yet') against the real registry. resolveDbPath()
// honours PORT_DADDY_DB and otherwise anchors on the distribution root, so it
// finds <project-root>/port-registry.db under both dev and the binary.
import { resolveDbPath, durableDbHomePath, isVersionVolatileDbPath } from '../../lib/db.js';
import { pdFetch, PORT_DADDY_URL, SOCK_PATH, getDaemonUrl } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import { separator, tableHeader } from '../utils/output.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { diagnoseStartupBlockers, confirmFix, detectHostileEnvLocal } from '../utils/startup-doctor.js';
import { CANONICAL_TCP_PORT } from '../../shared/daemon-discovery.js';
import { calculateRuntimeCodeHash } from '../../shared/code-hash.js';
import { PD_HOME } from '../../shared/paths.js';
import { type Severity, worstSeverity } from '../../lib/health-severity.js';
import {
  daemonBinaryPath,
  isBunVirtualPath,
  resolveDistributionRoot,
  resolveBosunBinaryPath,
} from '../../shared/daemon-binary.js';
import {
  SQUID_HOOK_PRIVACY_NOTICE,
  type SquidProviderHookDiagnosis,
} from '../../lib/squid/adapter.js';
import { inspectHookTargets } from './hooks-install.js';
import { isEmbeddingModelCached, prefetchEmbeddingModel } from './embed.js';
import { DEFAULT_SEMANTIC_MODEL_ID, defaultTransformersCacheDir } from '../../lib/semantic-resolver.js';
import { isStdinInteractive, isStdoutInteractive } from '../utils/tty.js';
import { createPlatforms } from './mcp-install.js';
import * as ui from '../utils/ui.js';
import {
  assessHarborReadiness,
  computeFirstValue,
  formatDurationMs,
  loadFirstValueRecord,
  saveFirstValueRecord,
  type AgentNodeV0,
} from '../../lib/agent-harbor/setup-doctor.js';
import { gatherHarborFacts } from '../utils/harbor-facts.js';

// __dirname equivalent for ESM
const __dirname = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

// Baked-in CLI version. The compiled `pd` binary has no sibling package.json to read, so the
// version checks below fell back to 'unknown' (reported "CLI vunknown" then advised a pointless
// restart). Stamped every release by scripts/sync-version.ts — do not hand-edit.
const EMBEDDED_PACKAGE_VERSION: string = '3.27.0';

interface StatusCommandResponse {
  status?: string;
  severity?: Severity;
  version?: string;
  pid?: number;
  uptimeSeconds?: number;
  uptimeHuman?: string;
  active_ports?: number;
  daemon?: {
    version?: string;
    codeHash?: string;
    berth?: {
      plane?: string;
      label?: string;
    };
  };
  metrics?: {
    activePorts?: number;
  };
  runtime?: {
    state?: string;
    degraded?: boolean;
  };
  fleet?: {
    projects?: unknown[];
    totalAgents?: number;
    totalLaunchableAgents?: number;
    launchableAgents?: number;
  };
  guardians?: {
    bosun?: {
      state?: string;
      reason?: string | null;
    };
  };
  history?: {
    lastActivityAt?: number;
  };
  binaryDrift?: {
    drifted?: boolean;
    reason?: string;
    runningPath?: string;
    onDiskPath?: string;
  };
  healthProbe?: {
    ok: boolean;
    error?: string;
  };
}

type StatusFailureCode =
  | 'DAEMON_UNAVAILABLE'
  | 'HTTP_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'HEALTH_UNAVAILABLE'
  | 'BINARY_DRIFT'
  | 'HEALTH_DEGRADED'
  | 'HEALTH_STATE_INVALID';

interface StatusFailure {
  code: StatusFailureCode;
  message: string;
  retryable: boolean;
}

function getLocalCodeHash(): string {
  return calculateRuntimeCodeHash(join(__dirname, '..', '..'));
}

function resolveDiagnosticPort(): number {
  try {
    const url = new URL(getDaemonUrl());
    return Number.parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : CANONICAL_TCP_PORT);
  } catch {
    return CANONICAL_TCP_PORT;
  }
}

/**
 * Handle `pd metrics` command
 */
export async function handleMetrics(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/metrics`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to get metrics');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('');
  console.log('Port Daddy Metrics');
  separator(50);

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null) {
      console.log(`  ${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        console.log(`    ${k}: ${v}`);
      }
    } else {
      console.log(`  ${key}: ${value}`);
    }
  }
  console.log('');
}

/**
 * Handle `pd config` command
 */
export async function handleConfigCmd(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.dir) params.append('dir', options.dir as string);

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/config${params.toString() ? '?' + params : ''}`);
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to get config');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('');
  console.log('Port Daddy Configuration');
  separator(50);

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    } else {
      console.log(`  ${key}: ${value}`);
    }
  }
  console.log('');
}

/**
 * Handle `pd health [service]` command
 */
export async function handleHealth(id: string | undefined, options: CLIOptions): Promise<void> {
  if (id) {
    // Single service health - still query Daemon
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services/health/${encodeURIComponent(id)}`);
    const data = await res.json() as { error?: string; id?: string; healthy?: boolean; port?: number; latencyMs?: number };
    if (!res.ok) {
      ui.error((data.error as string) || `Health check failed for '${id}'`);
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const h = data as { id?: string; healthy?: boolean; port?: number; latencyMs?: number; error?: string };
      const status = h.healthy ? 'healthy' : 'unhealthy';
      console.log(`${h.id || id}: ${status}`);
      if (h.port) console.log(`  Port: ${h.port}`);
      if (h.latencyMs !== undefined) console.log(`  Latency: ${h.latencyMs}ms`);
      if (h.error) console.log(`  Error: ${h.error}`);
    }
    return;
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
  const data = await res.json() as {
    status?: string;
    error?: string;
    uptime_seconds?: number;
    pid?: number;
    runtime?: { state?: string; degraded?: boolean };
  };

  if (!res.ok) {
    ui.error(data.error || 'Failed to get daemon health');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const runtimeState = data.runtime?.state ?? (data.status === 'ok' ? 'nominal' : 'degraded');
  const statusColor = data.status === 'ok' && !data.runtime?.degraded ? marANSI.fgGreen : marANSI.fgYellow;

  console.log('');
  console.log(`System Status: ${statusColor}${runtimeState.toUpperCase()}${marANSI.reset}`);
  separator(50);
  console.log(`Daemon:   ${data.status === 'ok' ? 'Online' : 'Degraded'}${data.pid ? ` (PID ${data.pid})` : ''}`);
  if (data.uptime_seconds !== undefined) {
    console.log(`Uptime:   ${Math.floor(data.uptime_seconds / 60)}m ${data.uptime_seconds % 60}s`);
  }
  console.log('');
}

/**
 * Handle `pd dashboard` command
 *
 * Default: launches the Ink terminal UI dashboard.
 * --web is retired: the browser dashboard was consolidated into the native
 * surfaces (FleetBar Control Center, pd-console).
 */
export async function handleDashboard(opts: { web?: boolean } = {}): Promise<void> {
  if (opts.web) {
    console.log('The web dashboard has been retired.');
    console.log('Use FleetBar → Control Center, FleetBar → Open Operator Console (pd-console),');
    console.log('or run `pd dashboard` for the terminal UI.');
    return;
  }

  // Launch Ink TUI — tsx handles the .tsx extension directly
  const tuiPath = join(__dirname, '../../dashboard/tui.tsx');
  const tsxBin = join(__dirname, '../../node_modules/.bin/tsx');
  const child = spawn(process.execPath, [tsxBin, tuiPath], { stdio: 'inherit' });
  await new Promise<void>(resolve => child.on('close', resolve));
}

/**
 * Handle `pd status` command
 */
export function renderStatusPlain(data: StatusCommandResponse): string {
  const lines: string[] = [];
  const visualState = statusLineworkState(data);
  lines.push(`Port Daddy is responsive (${visualState})`);
  const buildVersion = data.daemon?.version || data.version;
  const buildHash = data.daemon?.codeHash ? ` (${data.daemon.codeHash})` : '';
  lines.push(`  Version: ${buildVersion || 'unknown'}${buildHash}`);
  lines.push(`  PID: ${data.pid ?? 'unknown'}`);
  const uptime = data.uptimeHuman || (typeof data.uptimeSeconds === 'number'
    ? `${Math.floor(data.uptimeSeconds / 60)}m ${data.uptimeSeconds % 60}s`
    : 'unknown');
  lines.push(`  Uptime: ${uptime}`);
  lines.push(`  Active ports: ${data.metrics?.activePorts ?? data.active_ports ?? 0}`);

  if (data.runtime?.state) {
    const runtimeState = data.runtime.degraded ? `${data.runtime.state} (degraded)` : data.runtime.state;
    lines.push(`  Runtime: ${runtimeState}`);
  }

  if (data.severity) lines.push(`  Health: ${data.severity}`);
  if (data.binaryDrift?.drifted) {
    lines.push(`  WARN binary drift: ${binaryDriftText(data)}`);
    lines.push(data.daemon?.berth?.plane?.startsWith('ephemeral:')
      ? '    Feature berth is isolated; promote this binary only after review'
      : '    Next: restart this daemon and retry pd status');
  }
  if (data.healthProbe?.ok === false) {
    lines.push(`  UNKNOWN health probe: ${data.healthProbe.error || 'unavailable'}`);
  }

  if (data.fleet) {
    const projectCount = Array.isArray(data.fleet.projects) ? data.fleet.projects.length : 0;
    const totalAgents = data.fleet.totalAgents ?? 0;
    const launchable = data.fleet.totalLaunchableAgents ?? data.fleet.launchableAgents;
    const launchSuffix =
      typeof launchable === 'number' && totalAgents > 0
        ? `, ${launchable}/${totalAgents} launchable`
        : '';
    lines.push(`  Fleet: ${projectCount} project(s), ${totalAgents} agent(s)${launchSuffix}`);
    if (typeof launchable === 'number' && launchable === 0 && totalAgents > 0) {
      lines.push('    WARN no launchable backend — fleet will arm but every spawn is policy-blocked');
    }
  }

  const bosun = data.guardians?.bosun;
  if (bosun) {
    const normalizedState = bosun.state === 'disabled' && bosun.reason?.includes('missing')
      ? 'not installed (optional)'
      : bosun.state;
    const reason = bosun.reason && !bosun.reason.includes('missing') && bosun.reason !== normalizedState
      ? ` — ${bosun.reason}`
      : '';
    lines.push(`  Bosun: ${normalizedState}${reason}`);
  }

  if (data.history?.lastActivityAt) {
    const ageMs = Date.now() - Number(data.history.lastActivityAt);
    const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
    lines.push(`  Last activity: ${ageSeconds}s ago`);
  }
  return lines.join('\n');
}

function runtimeLineworkState(state: string | undefined, degraded?: boolean): ui.LineworkState {
  if (!state) return 'unknown';
  const normalized = state.toLowerCase();
  if (degraded) return 'warning';
  if (normalized.includes('recover')) return 'recovering';
  if (normalized.includes('pending') || normalized.includes('starting')) return 'pending';
  if (normalized.includes('unknown')) return 'unknown';
  if (normalized.includes('block')) return 'blocked';
  if (normalized.includes('fail') || normalized.includes('error')) return 'failed';
  if (normalized === 'nominal' || normalized === 'ok' || normalized === 'healthy') return 'healthy';
  if (normalized === 'active' || normalized === 'running') return 'active';
  return 'unknown';
}

function statusLineworkState(data: StatusCommandResponse): ui.LineworkState {
  if (data.severity === 'critical') return 'failed';
  if (data.severity === 'warn' || data.runtime?.degraded || data.binaryDrift?.drifted || data.healthProbe?.ok === false) {
    return 'warning';
  }
  if (data.status !== 'ok') return data.status === 'degraded' ? 'warning' : 'unknown';
  return runtimeLineworkState(data.runtime?.state, data.runtime?.degraded);
}

function binaryDriftText(data: StatusCommandResponse): string {
  if (data.daemon?.berth?.plane?.startsWith('ephemeral:')) {
    const running = data.binaryDrift?.runningPath || 'feature binary';
    const installed = data.binaryDrift?.onDiskPath || 'installed binary';
    return `feature berth binary ${running} differs from ${installed}; isolated by design`;
  }
  return data.binaryDrift?.reason || 'running binary differs from expected on-disk binary';
}

export function renderStatusLinework(data: StatusCommandResponse, opts?: { width?: number; colorLevel?: import('../utils/output.js').CliColorLevel; styled?: boolean }): string {
  const buildVersion = String(data.daemon?.version || data.version || 'unknown');
  const buildHash = data.daemon?.codeHash ? ` (${data.daemon.codeHash})` : '';
  const activePorts = data.metrics?.activePorts ?? data.active_ports ?? 0;
  const runtimeState = data.runtime?.state
    ? data.runtime.degraded ? `${data.runtime.state} degraded` : data.runtime.state
    : 'unknown';
  const projectCount = Array.isArray(data.fleet?.projects) ? data.fleet.projects.length : 0;
  const totalAgents = data.fleet?.totalAgents ?? 0;
  const launchable = data.fleet?.totalLaunchableAgents ?? data.fleet?.launchableAgents;
  const launchText = typeof launchable === 'number' && totalAgents > 0
    ? `${launchable}/${totalAgents} launchable`
    : `${totalAgents} agent(s)`;
  const daemonState = statusLineworkState(data);
  const rows: ui.LineworkRow[] = [
    {
      state: daemonState,
      label: 'daemon',
      text: `pid ${data.pid ?? 'unknown'} · up ${data.uptimeHuman || `${Math.floor((data.uptimeSeconds as number) / 60)}m ${(data.uptimeSeconds as number) % 60}s`} · ${activePorts} ports`,
    },
    {
      state: runtimeLineworkState(data.runtime?.state, data.runtime?.degraded),
      label: 'runtime',
      text: runtimeState,
    },
  ];

  if (data.binaryDrift?.drifted) {
    const driftAction = data.daemon?.berth?.plane?.startsWith('ephemeral:')
      ? 'feature berth is isolated; promote only after review'
      : 'next: restart this daemon';
    rows.push({
      state: 'warning',
      label: 'binary',
      text: `${binaryDriftText(data)} · ${driftAction}`,
    });
  }

  if (data.healthProbe?.ok === false) {
    rows.push({
      state: 'unknown',
      label: 'health',
      text: `${data.healthProbe.error || 'health probe unavailable'} · next: retry pd status or inspect pd doctor`,
    });
  }

  if (data.fleet) {
    rows.push({
      state: typeof launchable === 'number' && launchable === 0 && totalAgents > 0
        ? 'blocked'
        : totalAgents > 0
          ? 'fleet-healthy'
          : 'idle',
      label: 'fleet',
      text: `${projectCount} project(s) · ${launchText}`,
    });
  }

  const bosun = data.guardians?.bosun;
  if (bosun) {
    const normalizedState = bosun.state === 'disabled' && bosun.reason?.includes('missing')
      ? 'not installed optional'
      : bosun.state;
    const reason = bosun.reason && !bosun.reason.includes('missing') && bosun.reason !== normalizedState
      ? ` · ${bosun.reason}`
      : '';
    rows.push({
      state: normalizedState?.includes('active')
        ? 'active'
        : normalizedState?.includes('idle')
          ? 'idle'
          : normalizedState?.includes('not installed')
            ? 'info'
            : 'unknown',
      label: 'bosun',
      text: `${normalizedState}${reason}`,
    });
  }

  if (data.history?.lastActivityAt) {
    const ageMs = Date.now() - Number(data.history.lastActivityAt);
    const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
    rows.push({
      state: 'info',
      label: 'activity',
      text: `${ageSeconds}s ago`,
    });
  }

  const zone = daemonState === 'healthy'
    ? 'daemon confirmed'
    : daemonState === 'warning'
      ? 'daemon responsive · degraded'
      : daemonState === 'failed'
        ? 'daemon critical'
        : 'daemon responsive · health unknown';
  return ui.renderLineworkPanel({
    title: 'Port Daddy',
    version: buildVersion,
    subtitle: `daemon · ${buildHash ? buildHash.trim() : 'live'}`,
    tone: ui.lineworkVisual(daemonState).tone,
    zone,
    rows,
    footer: `runtime ${runtimeState} · active ports ${activePorts}`,
    width: opts?.width,
    colorLevel: opts?.colorLevel,
    styled: opts?.styled,
  });
}

export function renderStatusFailureLinework(
  opts?: { width?: number; colorLevel?: import('../utils/output.js').CliColorLevel; styled?: boolean },
  failure: StatusFailure = {
    code: 'DAEMON_UNAVAILABLE',
    message: 'Port Daddy daemon is not accepting status requests',
    retryable: true,
  },
): string {
  return ui.renderLineworkPanel({
    title: 'Port Daddy',
    subtitle: 'daemon unavailable',
    tone: 'failed',
    zone: 'failed with next action',
    rows: [
      { state: 'failed', label: 'daemon', text: `${failure.code} · ${failure.message}` },
      { state: 'guard-blocked', label: 'next', text: 'open FleetBar and restart the daemon, then retry pd status' },
      { state: 'recovering', label: 'diagnose', text: 'run pd doctor if FleetBar cannot recover it' },
    ],
    footer: 'exit 1 · machine callers keep the same failure code',
    width: opts?.width,
    colorLevel: opts?.colorLevel,
    styled: opts?.styled,
  });
}

export function renderStatusOutput(
  data: StatusCommandResponse,
  options: CLIOptions = {},
  failure?: StatusFailure,
): string {
  if (isJson(options)) {
    return JSON.stringify(failure
      ? { success: false, error: failure, data }
      : { success: true, ...data }, null, 2);
  }
  if (ui.lineworkEnabled({ quiet: Boolean(options.quiet || options.q) })) {
    return renderStatusLinework(data);
  }
  return renderStatusPlain(data);
}

export function renderStatusFailureOutput(
  options: CLIOptions = {},
  failure: StatusFailure = {
    code: 'DAEMON_UNAVAILABLE',
    message: 'Port Daddy daemon is not accepting status requests',
    retryable: true,
  },
): string {
  if (isJson(options)) {
    return JSON.stringify({
      success: false,
      error: failure,
      nextActions: [
        'Open FleetBar and restart the daemon, then retry pd status',
        'Run pd doctor if FleetBar cannot recover it',
      ],
    }, null, 2);
  }
  if (ui.lineworkEnabled({ quiet: Boolean(options.quiet || options.q) })) {
    return renderStatusFailureLinework(undefined, failure);
  }
  return [
    `Port Daddy status failed: ${failure.message}`,
    '  Start with: port-daddy start',
    '  Or install: port-daddy install',
    '  Diagnose:   port-daddy doctor',
  ].join('\n');
}

export async function runStatus(
  options: CLIOptions = {},
  deps: {
    fetch?: typeof pdFetch;
    write?: (text: string) => void;
  } = {},
): Promise<number> {
  const fetchStatus = deps.fetch ?? pdFetch;
  const write = deps.write ?? ((text: string) => console.log(text));
  try {
    const res: PdFetchResponse = await fetchStatus('/status');
    if (!res.ok) {
      const failure: StatusFailure = {
        code: 'HTTP_ERROR',
        message: `daemon returned HTTP ${res.status ?? 'unknown'} for /status`,
        retryable: (res.status ?? 500) >= 500,
      };
      write(renderStatusFailureOutput(options, failure));
      return 1;
    }

    let data: StatusCommandResponse;
    try {
      data = await res.json() as StatusCommandResponse;
    } catch {
      const failure: StatusFailure = {
        code: 'MALFORMED_RESPONSE',
        message: 'daemon returned malformed JSON for /status',
        retryable: true,
      };
      write(renderStatusFailureOutput(options, failure));
      return 1;
    }

    let healthRes: PdFetchResponse;
    try {
      healthRes = await fetchStatus('/health');
    } catch (error) {
      const failure: StatusFailure = {
        code: 'HEALTH_UNAVAILABLE',
        message: `daemon /health probe failed: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
      write(renderStatusFailureOutput(options, failure));
      return 1;
    }
    if (!healthRes.ok) {
      const failure: StatusFailure = {
        code: 'HEALTH_UNAVAILABLE',
        message: `daemon returned HTTP ${healthRes.status ?? 'unknown'} for /health`,
        retryable: (healthRes.status ?? 500) >= 500,
      };
      write(renderStatusFailureOutput(options, failure));
      return 1;
    }
    let health: StatusCommandResponse;
    try {
      health = await healthRes.json() as StatusCommandResponse;
    } catch {
      const failure: StatusFailure = {
        code: 'MALFORMED_RESPONSE',
        message: 'daemon returned malformed JSON for /health',
        retryable: true,
      };
      write(renderStatusFailureOutput(options, failure));
      return 1;
    }
    data.status = health.status ?? data.status;
    data.severity = health.severity ?? data.severity;
    data.runtime = health.runtime ?? data.runtime;
    data.binaryDrift = health.binaryDrift;

    const visualState = statusLineworkState(data);
    const failure: StatusFailure | undefined = data.binaryDrift?.drifted
      ? {
          code: 'BINARY_DRIFT',
          message: binaryDriftText(data),
          retryable: !data.daemon?.berth?.plane?.startsWith('ephemeral:'),
        }
      : visualState === 'warning' || visualState === 'failed'
        ? {
            code: 'HEALTH_DEGRADED',
            message: `daemon health is ${data.severity || visualState}`,
            retryable: true,
          }
        : visualState === 'unknown'
          ? {
              code: 'HEALTH_STATE_INVALID',
              message: `daemon reported unrecognized runtime state ${data.runtime?.state || 'unknown'}`,
              retryable: true,
            }
          : undefined;
    write(renderStatusOutput(data, options, failure));
    return failure ? 1 : 0;
  } catch (error) {
    const failure: StatusFailure = {
      code: 'DAEMON_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Port Daddy daemon is not accepting status requests',
      retryable: true,
    };
    write(renderStatusFailureOutput(options, failure));
    return 1;
  }
}

export async function handleStatus(options: CLIOptions = {}): Promise<void> {
  const exitCode = await runStatus(options);
  if (exitCode !== 0) process.exitCode = exitCode;
}

/**
 * Handle `pd version` command
 */
export async function handleVersion(): Promise<void> {
  const libDir: string = join(__dirname, '..', '..');
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
    const data = await res.json();
    console.log(`Port Daddy ${data.version}`);
    console.log(`Code hash: ${data.codeHash}`);
    console.log(`Server PID: ${data.pid}`);
    console.log(`Uptime: ${Math.floor((data.uptime as number) / 60)}m`);
  } catch {
    const pkgFallback: string = join(libDir, 'package.json');
    const ver: string = existsSync(pkgFallback)
      ? (JSON.parse(readFileSync(pkgFallback, 'utf8')) as { version: string }).version
      : process.env.PORT_DADDY_PACKAGE_VERSION || EMBEDDED_PACKAGE_VERSION;
    console.log(`Port Daddy v${ver} (server not running)`);
  }
}

/**
 * Handle `pd doctor` / `pd diagnose` command
 */
/**
 * True when a launchd plist still targets the source-running daemon
 * (`tsx` loader or a bare `server.ts` argument). Both signals indicate
 * the LaunchAgent hasn't been regenerated since the binary distribution
 * landed in ADR-0028 — the silent-failure path where a user upgrades
 * but launchd keeps running the old `tsx server.ts`.
 *
 * Pure on the plist contents string so it's trivially testable.
 *
 * Scoped to `<string>` element VALUES (with a tolerant pattern for
 * attribute-bearing tags). A naive whole-document regex would
 * false-positive on free-form comment lines like
 * `<key>Comment</key><string>Replaces the old server.ts launcher</string>`
 * — `port-daddy install` itself has shipped such commentary in the
 * past. We only care about plist STRING VALUES, which is where
 * ProgramArguments live.
 */
export function plistTargetsLegacyDaemon(plistContents: string): boolean {
  // Pull every `<string>...</string>` value. A plist <string> in
  // ProgramArguments is a single argv element — a filesystem path,
  // not prose — so we can apply path-shaped checks to the trimmed
  // value rather than substring-match the whole document.
  //
  //   - `node_modules/.bin/tsx` anywhere in the value: this token
  //     wouldn't appear in plausible English commentary, so any
  //     match is the legacy tsx loader.
  //   - The value ends with `/server.ts` (i.e. server.ts is the
  //     final path component): catches `/opt/port-daddy/server.ts`
  //     and `node server.ts`-style args, but NOT prose like
  //     "Migrated from server.ts. Do not edit." because that
  //     <string>'s trimmed tail is "edit.", not "/server.ts".
  const matches = plistContents.matchAll(/<string[^>]*>([\s\S]*?)<\/string>/g);
  for (const m of matches) {
    const value = m[1].trim();
    if (/node_modules\/\.bin\/tsx/.test(value)) return true;
    if (/(?:^|\/)server\.ts$/.test(value)) return true;
  }
  return false;
}

export interface ResourceDirBreakdown {
  envOverride: string | null;
  moduleDir: string;
  moduleDirIsBunVirtual: boolean;
  resolvedRoot: string;
  expectedBinary: string;
  binaryExists: boolean;
}

export interface AgentRuntimeInstallDiagnosis {
  mcpConfigured: boolean;
  mcpDetail: string;
  mcpHint: string;
  skillInstalled: boolean;
  skillDetail: string;
  skillHint: string;
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8').trim();
    return raw ? JSON.parse(raw) as Record<string, unknown> : {};
  } catch {
    return null;
  }
}

export function diagnoseAgentRuntimeInstall(home = homedir()): AgentRuntimeInstallDiagnosis {
  const platforms = createPlatforms(home);
  const detected = platforms.filter((platform) => {
    try {
      return platform.detect();
    } catch {
      return existsSync(platform.configPath);
    }
  });
  const configured = platforms.filter((platform) => {
    const cfg = readJsonFile(platform.configPath);
    const servers = cfg?.[platform.configKey] as Record<string, unknown> | undefined;
    return !!servers?.['port-daddy'];
  });

  const skillTargets = [
    join(home, '.claude', 'skills', 'port-daddy-agent-skill', 'SKILL.md'),
    join(home, '.codex', 'skills', 'port-daddy-agent-skill', 'SKILL.md'),
    join(home, '.agents', 'skills', 'port-daddy-agent-skill', 'SKILL.md'),
    join(home, '.gemini', 'extensions', 'port-daddy', 'skills', 'port-daddy-agent-skill', 'SKILL.md'),
    join(home, '.cursor', 'rules', 'port-daddy-agent-skill.md'),
  ];
  const installedSkills = skillTargets.filter((path) => existsSync(path));

  return {
    mcpConfigured: configured.length > 0,
    mcpDetail: configured.length > 0
      ? `port-daddy MCP configured for ${configured.map((platform) => platform.name).join(', ')}`
      : `port-daddy MCP missing from ${detected.length || platforms.length} known agent config(s)`,
    mcpHint: 'Run: pd mcp install   (or pd setup)',
    skillInstalled: installedSkills.length > 0,
    skillDetail: installedSkills.length > 0
      ? `Port Daddy skill present in ${installedSkills.length} local agent runtime(s)`
      : 'Port Daddy skill not found in Claude/Codex/Gemini/Cursor/common agent skill locations',
    skillHint: 'Run: pd setup   (refreshes skills and Pilot definitions)',
  };
}

/**
 * Computes the four-way resolution of `PORT_DADDY_RESOURCE_DIR` at the
 * current moment: explicit env override, raw module dir (and whether
 * Bun's virtual fs is in play), the resolved distribution root, and
 * the binary path that root implies (plus whether it actually exists).
 * Pure on inputs so it's easy to test under fake env / paths.
 */
export function describeResourceDir(
  moduleDir: string,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): ResourceDirBreakdown {
  const envOverride = env.PORT_DADDY_RESOURCE_DIR?.trim() || null;
  const moduleDirIsBunVirtual = isBunVirtualPath(moduleDir);
  const resolvedRoot = resolveDistributionRoot(moduleDir, env, execPath);
  const expectedBinary = daemonBinaryPath(resolvedRoot, env);
  return {
    envOverride,
    moduleDir,
    moduleDirIsBunVirtual,
    resolvedRoot,
    expectedBinary,
    binaryExists: existsSync(expectedBinary),
  };
}

/**
 * Resolves the canonical LaunchAgent plist path for the daemon on this
 * platform. Returns null when the platform doesn't use launchd —
 * systemd-user units (Linux) and Windows services have their own
 * regression paths to add later; for now this diagnostic is macOS-only.
 */
export function userLaunchAgentPlistPath(): string | null {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'LaunchAgents', 'com.portdaddy.daemon.plist');
  }
  return null;
}

/**
 * Reads a plist as XML text, normalizing binary plist format if
 * necessary. macOS `launchctl load` accepts both XML and binary
 * plists; `plutil -convert binary1` and several Homebrew install
 * scripts emit the binary variant. Reading those bytes as UTF-8
 * yields garbage that would silently false-negative
 * `plistTargetsLegacyDaemon` — the check would say "looks fine!"
 * on a stale binary plist that still targets `tsx server.ts`.
 *
 * Strategy: read raw bytes. If they start with the binary plist
 * magic (`bplist`), shell out to `plutil -convert xml1 -o - <path>`
 * to normalize, then return the XML stdout. Otherwise return the
 * UTF-8 string directly. Throws on plutil failure so the caller
 * can surface a real error rather than silently passing.
 *
 * macOS-only: `plutil` is shipped with the OS. Other platforms
 * shouldn't reach here because `userLaunchAgentPlistPath()` returns
 * null off darwin.
 */
export function readPlistAsXml(plistPath: string): string {
  const raw = readFileSync(plistPath);
  const isBinaryPlist = raw.length >= 6 && raw.slice(0, 6).toString('ascii') === 'bplist';
  if (!isBinaryPlist) {
    return raw.toString('utf8');
  }
  const result = spawnSync('plutil', ['-convert', 'xml1', '-o', '-', plistPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`plutil failed to convert binary plist: ${stderr}`);
  }
  return result.stdout;
}

// =============================================================================
// Supervision integrity — the crux of "is the daemon actually owned?"
//
// On macOS the daemon is supervised by exactly ONE launchd job: Homebrew's
// `homebrew.mxcl.port-daddy` (brew install) OR the legacy `com.portdaddy.daemon`
// (self/npm install, removed 2026-06-01 but may linger on old machines). The
// failure modes the operator keeps hitting:
//   - zero supervisors loaded            → nothing will resurrect the daemon
//   - one supervisor loaded but NOT      → the daemon is unsupervised right now;
//     running                              if it's also unreachable this is
//                                          exactly how it silently died
//   - two supervisors loaded             → duplicate KeepAlive jobs race the
//                                          listener (the install-daemon dedup bug)
// The previous `pd doctor` looked ONLY for `com.portdaddy.daemon` and so was
// blind to every brew-supervised install — it reported "LaunchAgent not
// installed" on a perfectly-supervised daemon. This replaces that.
// =============================================================================

/** The launchd labels that legitimately supervise the Port Daddy daemon. */
export const DAEMON_SUPERVISOR_LABELS = [
  'homebrew.mxcl.port-daddy',
  'com.portdaddy.daemon',
] as const;

export interface LaunchdSupervisor {
  label: string;
  /** launchctl knows this job (status 0). */
  loaded: boolean;
  /** the job currently has a live PID. */
  running: boolean;
  pid: number | null;
}

export interface SupervisionAssessment {
  severity: Severity;
  detail: string;
  hint?: string;
  /**
   * Structured single-command remediation for the specific failure (bootout a
   * duplicate, kickstart a stopped job, install a missing supervisor). The
   * Agent Harbor daemon card consumes this so its one repair is the right
   * repair, not a blanket `port-daddy install`.
   */
  repair?: { command: string; description: string };
}

/**
 * Pure severity judgment over the launchd supervisor set + daemon reachability.
 * Separated from the spawn so it is unit-testable without launchctl.
 *
 * ```ts
 * assessSupervisionIntegrity({ supervisors: [], daemonReachable: false, platform: 'darwin' }).severity
 * // => 'critical'
 * assessSupervisionIntegrity({ supervisors: [{label:'homebrew.mxcl.port-daddy',loaded:true,running:true,pid:42}], daemonReachable: true, platform: 'darwin' }).severity
 * // => 'ok'
 * ```
 */
export function assessSupervisionIntegrity(input: {
  supervisors: LaunchdSupervisor[];
  daemonReachable: boolean;
  platform?: NodeJS.Platform;
}): SupervisionAssessment {
  const plat = input.platform ?? process.platform;
  if (plat !== 'darwin') {
    return { severity: 'ok', detail: `Supervision integrity is a macOS-only check (skipped on ${plat})` };
  }

  const loaded = input.supervisors.filter((s) => s.loaded);
  const running = loaded.filter((s) => s.running);

  if (loaded.length === 0) {
    if (input.daemonReachable) {
      return {
        severity: 'warn',
        detail: 'Daemon is reachable but NO launchd supervisor owns it — it will not be resurrected if it dies',
        hint: 'Run: port-daddy install   (installs the launchd supervisor)',
        repair: { command: 'port-daddy install', description: 'Installs the launchd supervisor for the running daemon.' },
      };
    }
    return {
      severity: 'critical',
      detail: 'No launchd supervisor is loaded and the daemon is not reachable',
      hint: 'Run: port-daddy install   then: port-daddy start',
      repair: { command: 'port-daddy install', description: 'Installs the launchd supervisor, then start the daemon with port-daddy start.' },
    };
  }

  if (loaded.length >= 2) {
    return {
      severity: 'warn',
      detail: `${loaded.length} supervisors loaded (${loaded.map((s) => s.label).join(', ')}) — duplicate KeepAlive jobs race the listener`,
      hint: `Keep exactly one. Unload the duplicate: launchctl bootout gui/$(id -u)/${loaded[1].label}`,
      repair: {
        command: `launchctl bootout gui/$(id -u)/${loaded[1].label}`,
        description: 'Unloads the duplicate supervisor so exactly one KeepAlive job owns the daemon.',
      },
    };
  }

  // Exactly one supervisor loaded.
  const one = loaded[0];
  if (running.length >= 1) {
    // 2026-07-14 halt-mandate incident: `brew services` / `launchctl list`
    // claimed Running:true with a live-looking PID while /health returned
    // nothing and the process was actually gone — and this branch returned
    // 'ok' unconditionally, so `pd doctor` reported ALL GREEN during a live
    // outage. A supervisor claiming "running" is a CLAIM, not a fact; the
    // daemon's own /health response is the fact. This also closes the
    // "wedged-but-alive" hole: a process can be genuinely alive (the
    // supervisor is telling the truth about the PID) while its HTTP request
    // pipeline is deadlocked — the operator-visible symptom is identical
    // (daemon unreachable) and must be equally CRITICAL, not silently OK
    // because *some* process with that PID exists.
    if (!input.daemonReachable) {
      return {
        severity: 'critical',
        detail: `${one.label} claims PID ${one.pid} is running, but the daemon's /health is unreachable — the daemon is DEAD OR WEDGED despite the supervisor believing otherwise`,
        hint: `Run: port-daddy restart   (or: launchctl kickstart -k gui/$(id -u)/${one.label})`,
        repair: {
          command: 'port-daddy restart',
          description: 'Restarts the daemon; the supervisor\'s "running" claim did not match a reachable /health.',
        },
      };
    }
    return { severity: 'ok', detail: `${one.label} is loaded and running (PID ${one.pid})` };
  }
  // Loaded but not running — the unsupervised-drift precursor.
  if (input.daemonReachable) {
    return {
      severity: 'warn',
      detail: `${one.label} is loaded but its process is not running — the daemon is currently UNSUPERVISED (reachable now, but won't be resurrected)`,
      hint: `Re-kick the supervisor: launchctl kickstart -k gui/$(id -u)/${one.label}`,
      repair: {
        command: `launchctl kickstart -k gui/$(id -u)/${one.label}`,
        description: 'Re-kicks the loaded supervisor so the daemon is resurrected if it dies.',
      },
    };
  }
  return {
    severity: 'critical',
    detail: `${one.label} is loaded but not running, and the daemon is not reachable — this is how the daemon silently dies`,
    hint: `Run: port-daddy start   (or: launchctl kickstart -k gui/$(id -u)/${one.label})`,
    repair: { command: 'port-daddy start', description: 'Starts the daemon under the already-loaded supervisor.' },
  };
}

/**
 * Verify a PID actually names a live OS process — `kill(pid, 0)` sends no
 * signal, only checks existence/permission. ESRCH ("no such process") means
 * dead; a successful call OR EPERM (exists but we lack permission to signal
 * it) both mean alive. This is the direct counterpart of `pid_is_alive` in
 * core/pd-bosun/src/main.rs, applied here to launchctl's SELF-REPORTED PID —
 * the 2026-07-14 incident was exactly launchctl/`brew services` claiming
 * `Running:true` with a PID that no longer named a real process.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

/**
 * Query launchd for each candidate supervisor label. macOS-only; on other
 * platforms returns an empty set (the assessor short-circuits to ok there).
 *
 * `launchctl list <label>` exits 0 and prints a `"PID" = N;` line when the job
 * is loaded AND running; exits 0 with no PID line when loaded-but-stopped; and
 * exits non-zero ("Could not find service") when the job is not loaded.
 *
 * launchctl's own PID claim is NOT trusted at face value: `running` is only
 * true when the reported PID ALSO passes `isPidAlive` (2026-07-14 incident —
 * `brew services`/`launchctl` reported Running:true PID 69626 while no such
 * process existed and `pd doctor` believed it because it never re-verified).
 */
export function gatherLaunchdSupervisors(
  labels: readonly string[] = DAEMON_SUPERVISOR_LABELS,
): LaunchdSupervisor[] {
  if (process.platform !== 'darwin') return [];
  return labels.map((label) => {
    try {
      const res = spawnSync('launchctl', ['list', label], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });
      if (res.status !== 0) return { label, loaded: false, running: false, pid: null };
      const m = /"PID"\s*=\s*(\d+)/.exec(res.stdout || '');
      const pid = m ? parseInt(m[1], 10) : null;
      const claimsRunning = pid !== null && pid > 0;
      const running = claimsRunning && isPidAlive(pid as number);
      return { label, loaded: true, running, pid };
    } catch {
      return { label, loaded: false, running: false, pid: null };
    }
  });
}

/**
 * Candidate daemon log paths, in priority order. `brew services` writes to
 * the keg-relative `var/log/port-daddy.log` (the operator's actual layout,
 * `/opt/homebrew/var/log/port-daddy.log`); a manually-installed LaunchAgent
 * (`port-daddy install`, see install-daemon.ts LOG_PATH) writes to
 * `<distribution root>/port-daddy.log` instead — pass `distributionRoot`
 * (callers already compute this as `libDir` elsewhere in this file) so that
 * shape is actually checked too, not just the Homebrew/`~/.port-daddy` ones.
 * Check all — whichever exists first is the live log.
 */
export function candidateDaemonLogPaths(home = homedir(), distributionRoot?: string): string[] {
  if (process.env.PORT_DADDY_DAEMON_LOG_PATHS) {
    return process.env.PORT_DADDY_DAEMON_LOG_PATHS
      .split(':')
      .map((path) => path.trim())
      .filter(Boolean);
  }
  const paths = [
    '/opt/homebrew/var/log/port-daddy.log',
    '/usr/local/var/log/port-daddy.log', // Intel Homebrew prefix
    join(home, '.port-daddy', 'port-daddy.log'),
  ];
  if (distributionRoot) paths.push(join(distributionRoot, 'port-daddy.log'));
  return paths;
}

/**
 * Bun's native crash banner is two fixed lines that always appear together —
 * "panic(<thread>): <reason>" followed by "oh no: Bun has crashed." — for
 * ANY native Bun panic, not just segfaults (see issue #676). Count the panic
 * banner, not the "Segmentation fault" detail line, so an unrelated Bun panic
 * shape still trips this check instead of silently passing.
 */
const BUN_PANIC_MARKER = /oh no: Bun has crashed\. This indicates a bug in Bun, not your code\./g;

/** Pure: how many Bun native-crash banners appear in a slice of log text. */
export function countBunCrashSignatures(logText: string): number {
  return (logText.match(BUN_PANIC_MARKER) || []).length;
}

export interface RecentBunCrashCheck {
  count: number;
  logPath: string | null;
  /**
   * Set when a candidate log EXISTED but could not be read (permissions,
   * transient I/O error, etc). Distinct from "no candidate log exists" —
   * doctor must treat this as unknown, never as a silent 'ok'.
   */
  readError?: string;
}

/**
 * Reads the tail of whichever candidate daemon log exists and counts Bun
 * native-crash banners. Bounded to the last `maxBytes` via an actual seek +
 * bounded read (not a full-file read-then-slice) so a long-lived,
 * never-rotated multi-GB log can't make this check slow or memory-spiky —
 * 512KB comfortably covers many restart cycles of this daemon's log
 * verbosity.
 */
export function readRecentBunCrashCount(
  paths: string[] = candidateDaemonLogPaths(),
  maxBytes = 512 * 1024,
): RecentBunCrashCheck {
  for (const p of paths) {
    if (!existsSync(p)) continue;
    let fd: number | undefined;
    try {
      fd = openSync(p, 'r');
      const { size } = fstatSync(fd);
      const bytesToRead = Math.min(size, maxBytes);
      const start = size - bytesToRead;
      const buf = Buffer.alloc(bytesToRead);
      if (bytesToRead > 0) readSync(fd, buf, 0, bytesToRead, start);
      return { count: countBunCrashSignatures(buf.toString('utf8')), logPath: p };
    } catch (err) {
      // The path existed (existsSync passed) but reading it failed — report
      // this distinctly from "no log found" so the caller does not read it
      // as a clean bill of health.
      return { count: 0, logPath: null, readError: `${p}: ${(err as Error).message}` };
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          /* best-effort close */
        }
      }
    }
  }
  return { count: 0, logPath: null };
}

export interface CrashSignatureAssessment {
  severity: Severity;
  detail: string;
  hint?: string;
  crashCount: number;
}

/**
 * Pure severity judgment over a Bun native-crash count found in the daemon
 * log tail. Separated from the file read so it is unit-testable without
 * touching disk.
 *
 * Context (2026-07-07, see issue #676): the compiled daemon binary segfaults
 * intermittently under Bun 1.2.21 (JSC GC crash family — `MarkedBlock::sweep`
 * / `SlotVisitor::drain` — reproduced across many Bun versions in upstream
 * reports, not unique to this build). It is STATE- and LOAD-dependent: it
 * needs production-scale memory pressure and concurrent connections to
 * trigger, so idle soak tests do not catch it. Pinning to an older
 * port-daddy release does NOT fix it — 3.23.0 and 3.24.x compile against the
 * identical pinned `bun-version: 1.2.21` toolchain (pinned since 2026-06-01,
 * before either release existed), and both have been observed to crash under
 * load. There is no in-repo fix for a native Bun panic; this check exists so
 * the operator sees the crash-loop instead of `brew services` silently
 * respawning through it forever.
 *
 * ```ts
 * assessCrashSignature({ crashCount: 0 }).severity   // => 'ok'
 * assessCrashSignature({ crashCount: 1 }).severity   // => 'warn'
 * assessCrashSignature({ crashCount: 3 }).severity   // => 'critical'
 * assessCrashSignature({ crashCount: 0, readError: 'EACCES' }).severity   // => 'warn'
 * ```
 */
export function assessCrashSignature(
  input: { crashCount: number; logPath?: string | null; readError?: string },
): CrashSignatureAssessment {
  const { crashCount, logPath, readError } = input;
  const where = logPath ? ` (${logPath})` : '';
  // A log that exists but couldn't be read is an UNKNOWN result, not a clean
  // bill of health — reporting 'ok' here would let a permissions problem
  // (or any other read failure) silently mask a real crash-loop underneath
  // it. Never let "couldn't check" read as "checked, healthy".
  if (readError) {
    return {
      severity: 'warn',
      detail: `Could not read the daemon log to check for Bun crash signatures (${readError}) — unknown, not confirmed healthy`,
      hint: 'Fix the log file permissions/ownership so pd doctor can check for Bun native-crash banners (see issue #676).',
      crashCount: 0,
    };
  }
  if (crashCount === 0) {
    return { severity: 'ok', detail: `No Bun native-crash signatures found in the recent daemon log${where}`, crashCount };
  }
  const hint =
    'This is a known upstream Bun 1.2.21 native-crash family (JSC GC under load — see issue #676), not a port-daddy regression. ' +
    'Downgrading port-daddy does NOT fix it: 3.23.0 and 3.24.x compile against the same pinned Bun toolchain. ' +
    'Track upstream (oven-sh/bun) and issue #676; consider filing a fresh bun.report link if one is not already attached.';
  if (crashCount === 1) {
    return {
      severity: 'warn',
      detail: `1 Bun native-crash banner found in the recent daemon log${where} — the daemon restarted after a native crash`,
      hint,
      crashCount,
    };
  }
  return {
    severity: 'critical',
    detail: `${crashCount} Bun native-crash banners in the daemon log${where} — the daemon has crashed repeatedly (scans the possibly-unrotated log tail, so some may be historical; check \`pd status\` uptime for the live state)`,
    hint,
    crashCount,
  };
}

const MAC_DIAGNOSTIC_REPORT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAC_DIAGNOSTIC_REPORT_MAX_BYTES = 768 * 1024;
const MAC_DIAGNOSTIC_REPORT_NAME = /^port-daddy(?:-daemon)?-\d{4}-\d{2}-\d{2}-.+\.ips$/;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function regexField(text: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(text);
  return match?.[1];
}

function diagnosticThreadNames(parsed: Record<string, unknown> | null, text: string): string[] {
  const threads = parsed?.threads;
  if (Array.isArray(threads)) {
    return threads
      .map((thread) => stringValue(recordValue(thread), 'name'))
      .filter((name): name is string => Boolean(name));
  }
  return Array.from(text.matchAll(/"name"\s*:\s*"([^"]+)"/g), (match) => match[1]);
}

export interface MacDiagnosticCrashReport {
  path: string;
  procName?: string;
  procPath?: string;
  coalitionName?: string;
  exceptionType?: string;
  exceptionSignal?: string;
  terminationIndicator?: string;
  threadNames: string[];
  daemonLike: boolean;
  suspectedBunJsc: boolean;
}

export interface RecentMacDiagnosticCrashReports {
  count: number;
  reports: MacDiagnosticCrashReport[];
  readError?: string;
}

export interface CandidateMacDiagnosticReportPathsResult {
  paths: string[];
  readError?: string;
}

export interface MacDiagnosticCrashReportAssessment {
  severity: Severity;
  detail: string;
  hint?: string;
  crashCount: number;
}

export function candidateMacDiagnosticReportPathsWithStatus(
  home = homedir(),
  nowMs = Date.now(),
  maxAgeMs = MAC_DIAGNOSTIC_REPORT_MAX_AGE_MS,
): CandidateMacDiagnosticReportPathsResult {
  const reportDir = process.env.PORT_DADDY_DIAGNOSTIC_REPORT_DIR || join(home, 'Library', 'Logs', 'DiagnosticReports');
  if (!existsSync(reportDir)) return { paths: [] };
  try {
    const paths = readdirSync(reportDir)
      .filter((name) => MAC_DIAGNOSTIC_REPORT_NAME.test(name))
      .map((name) => {
        const path = join(reportDir, name);
        const stat = statSync(path);
        return { path, mtimeMs: stat.mtimeMs, ageMs: nowMs - stat.mtimeMs };
      })
      .filter((entry) => entry.ageMs >= 0 && entry.ageMs <= maxAgeMs)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map((entry) => entry.path);
    return { paths };
  } catch (err) {
    return {
      paths: [],
      readError: `${reportDir}: ${(err as Error).message}`,
    };
  }
}

export function candidateMacDiagnosticReportPaths(
  home = homedir(),
  nowMs = Date.now(),
  maxAgeMs = MAC_DIAGNOSTIC_REPORT_MAX_AGE_MS,
): string[] {
  return candidateMacDiagnosticReportPathsWithStatus(home, nowMs, maxAgeMs).paths;
}

export function parseMacDiagnosticReport(path: string, text: string): MacDiagnosticCrashReport {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = recordValue(JSON.parse(text));
  } catch {
    parsed = null;
  }

  const exception = recordValue(parsed?.exception);
  const termination = recordValue(parsed?.termination);
  const procName = stringValue(parsed, 'procName') ?? regexField(text, 'procName');
  const procPath = stringValue(parsed, 'procPath') ?? regexField(text, 'procPath');
  const coalitionName = stringValue(parsed, 'coalitionName') ?? regexField(text, 'coalitionName');
  const exceptionType = stringValue(exception, 'type') ?? regexField(text, 'type');
  const exceptionSignal = stringValue(exception, 'signal') ?? regexField(text, 'signal');
  const terminationIndicator = stringValue(termination, 'indicator') ?? regexField(text, 'indicator');
  const threadNames = diagnosticThreadNames(parsed, text);
  const signatureText = [
    procName,
    procPath,
    coalitionName,
    exceptionType,
    exceptionSignal,
    terminationIndicator,
    ...threadNames,
  ].filter(Boolean).join(' ');
  const daemonLike =
    procName === 'port-daddy-daemon' ||
    coalitionName === 'homebrew.mxcl.port-daddy' ||
    coalitionName === 'com.portdaddy.daemon' ||
    /\/port-daddy-daemon$/.test(procPath ?? '') ||
    (procName === 'port-daddy' && /portdaddy|port-daddy/i.test(coalitionName ?? ''));

  return {
    path,
    procName,
    procPath,
    coalitionName,
    exceptionType,
    exceptionSignal,
    terminationIndicator,
    threadNames,
    daemonLike,
    suspectedBunJsc: /\b(Bun|JavaScriptCore|JSC|MarkedBlock|SlotVisitor|Heap Helper|libpas|WTF)\b/i.test(signatureText),
  };
}

export function readRecentMacDiagnosticCrashReports(
  paths?: string[],
  maxBytes = MAC_DIAGNOSTIC_REPORT_MAX_BYTES,
): RecentMacDiagnosticCrashReports {
  let candidateReadError: string | undefined;
  if (paths === undefined) {
    const candidates = candidateMacDiagnosticReportPathsWithStatus();
    paths = candidates.paths;
    candidateReadError = candidates.readError;
  }
  if (candidateReadError) {
    return { count: 0, reports: [], readError: candidateReadError };
  }

  const reports: MacDiagnosticCrashReport[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let fd: number | undefined;
    try {
      fd = openSync(path, 'r');
      const { size } = fstatSync(fd);
      const bytesToRead = Math.min(size, maxBytes);
      const buf = Buffer.alloc(bytesToRead);
      if (bytesToRead > 0) readSync(fd, buf, 0, bytesToRead, 0);
      const report = parseMacDiagnosticReport(path, buf.toString('utf8'));
      if (report.daemonLike) reports.push(report);
    } catch (err) {
      return { count: reports.length, reports, readError: `${path}: ${(err as Error).message}` };
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          /* best-effort close */
        }
      }
    }
  }
  return { count: reports.length, reports };
}

export function assessMacDiagnosticCrashReports(input: RecentMacDiagnosticCrashReports): MacDiagnosticCrashReportAssessment {
  const { count, reports, readError } = input;
  if (readError) {
    return {
      severity: 'warn',
      detail: `Could not read macOS DiagnosticReports while checking daemon native crashes (${readError}) — unknown, not confirmed healthy`,
      hint: 'Fix DiagnosticReports permissions/ownership so pd doctor can inspect native crash records.',
      crashCount: count,
    };
  }
  if (count === 0) {
    return {
      severity: 'ok',
      detail: 'No recent macOS daemon crash reports found in ~/Library/Logs/DiagnosticReports',
      crashCount: count,
    };
  }

  const latest = reports[0];
  const bunJscCount = reports.filter((report) => report.suspectedBunJsc).length;
  const latestShape = [
    latest?.exceptionType,
    latest?.exceptionSignal,
    latest?.terminationIndicator,
  ].filter(Boolean).join('/') || 'unknown crash shape';
  const detail =
    `${count} recent macOS daemon crash report${count === 1 ? '' : 's'} found; latest=${latest?.path ?? 'unknown'} (${latestShape})` +
    (bunJscCount > 0 ? `; ${bunJscCount} mention Bun/JSC worker threads` : '');
  const hint =
    'Inspect the newest .ips report, then run the compiled-daemon smoke and soak gates before promoting a daemon build. ' +
    'Launchd may respawn through these crashes without preserving the Bun banner in the daemon log tail.';
  return {
    severity: count === 1 ? 'warn' : 'critical',
    detail,
    hint,
    crashCount: count,
  };
}

/**
 * Resolve the Bosun watchdog binary (`core/pd-bosun`). Prefers the release
 * artifact under `dist/`, falls back to the source-tree release build. Mirrors
 * the daemon-side `resolveBosunBinaryStatus` in routes/info.ts.
 */
export function resolveBosunBinary(rootDir: string): { binaryPath: string; exists: boolean } {
  // Delegate to the shared resolver so `pd doctor` and `port-daddy install`
  // agree on WHICH bosun binary is canonical (halt-mandate: no stale-dist
  // split-brain). Prefers the flat installed `<root>/pd-bosun`.
  const binaryPath = resolveBosunBinaryPath(rootDir);
  return { binaryPath, exists: existsSync(binaryPath) };
}

/**
 * Find scattered `port-registry*.db` files in a directory. The known continuity
 * bug (db-fragmentation): backups and brew-Cellar copies leave multiple
 * registry DBs around, and the daemon can end up reading or backing up the
 * wrong one. More than one is a fragmentation smell worth a WARN.
 */
export function scanRegistryDbFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => /^port-registry.*\.db$/.test(f) && !f.endsWith('-wal') && !f.endsWith('-shm'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export interface DoctorOptions {
  json?: boolean | string;
  /** CI/script mode: machine-readable, no interactive fix phase. */
  ci?: boolean | string;
  /** Force exit-code gating (alias of --ci's gating half). */
  exitCode?: boolean | string;
}

export async function handleDoctor(rawOptions: DoctorOptions = {}): Promise<void> {
  const jsonMode = !!(rawOptions.json);
  // CI/exit-code mode: never prompt, always gate the exit code on critical.
  const ciMode = !!(rawOptions.ci || rawOptions.exitCode);
  const nonInteractive = jsonMode || ciMode;

  interface CheckResult {
    ok: boolean;
    name: string;
    detail: string;
    hint?: string;
    severity: Severity;
    /** retained for back-compat with callers reading `.critical`. */
    critical?: boolean;
  }

  const results: CheckResult[] = [];
  let passed: number = 0;
  let total: number = 0;
  const daemonPort = resolveDiagnosticPort();
  const portLabel = `Daemon TCP port (${daemonPort}${daemonPort === CANONICAL_TCP_PORT ? ' preferred' : ''})`;

  const libDir: string = join(__dirname, '..', '..');

  // A non-critical failure is now a WARN, not a blanket fail: it is loud in the
  // output and surfaced to CI's machine view, but it does NOT gate the exit code
  // (only `critical` does). That is the whole point of the three-tier model —
  // missing shell completions should nag, not break the build.
  function check(name: string, ok: boolean, detail: string, hint?: string): void {
    total++;
    if (ok) {
      passed++;
      results.push({ ok: true, name, detail, severity: 'ok' });
    } else {
      results.push({ ok: false, name, detail, hint, severity: 'warn' });
    }
  }

  function warn(name: string, detail: string, hint?: string): void {
    total++;
    results.push({ ok: false, name, detail, hint, severity: 'warn' });
  }

  function criticalFail(name: string, detail: string, hint: string): void {
    total++;
    results.push({ ok: false, name, detail, hint, severity: 'critical', critical: true });
  }

  /** Record a pre-computed assessment (supervision, liveness, bosun, …). */
  function recordAssessment(name: string, a: { severity: Severity; detail: string; hint?: string }): void {
    total++;
    if (a.severity === 'ok') {
      passed++;
      results.push({ ok: true, name, detail: a.detail, severity: 'ok' });
    } else if (a.severity === 'warn') {
      results.push({ ok: false, name, detail: a.detail, hint: a.hint, severity: 'warn' });
    } else {
      results.push({ ok: false, name, detail: a.detail, hint: a.hint, severity: 'critical', critical: true });
    }
  }

  // -------------------------------------------------------------------------
  // 1. Node.js version
  // -------------------------------------------------------------------------
  try {
    const nodeVersion: string = process.version;
    const major: number = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (major >= 18) {
      check('Node.js version', true, `${nodeVersion} (>= 18 required)`);
    } else {
      criticalFail('Node.js version', `${nodeVersion} (>= 18 required)`, 'Upgrade Node.js to version 18 or later');
    }
  } catch (err: unknown) {
    criticalFail('Node.js version', `Error: ${(err as Error).message}`, 'Ensure Node.js is installed');
  }

  // -------------------------------------------------------------------------
  // 2. Dependencies installed
  // -------------------------------------------------------------------------
  try {
    const nodeModulesPath: string = join(libDir, 'node_modules');
    const pkgPath: string = join(libDir, 'package.json');
    // In the `bun build --compile` binary, libDir resolves into the read-only
    // /$bunfs/ virtual filesystem (or a layout with no sibling package.json),
    // and every dependency is BUNDLED into the binary — there is no
    // node_modules to inspect. Treat that as OK, not a false CRITICAL (this is
    // why the brew `pd doctor` used to fail "Dependencies: ENOENT /package.json"
    // on a perfectly healthy install).
    if (isBunVirtualPath(libDir) || !existsSync(pkgPath)) {
      check('Dependencies', true, 'Bundled in the compiled binary (no node_modules to verify)');
    } else {
      const pkg: { dependencies?: Record<string, string> } = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps: string[] = Object.keys(pkg.dependencies || {});
      const missing: string[] = [];

      for (const dep of deps) {
        const depPath: string = join(nodeModulesPath, dep);
        if (!existsSync(depPath)) {
          missing.push(dep);
        }
      }

      if (missing.length === 0) {
        check('Dependencies', true, `All ${deps.length} dependencies installed`);
      } else {
        criticalFail('Dependencies', `Missing: ${missing.join(', ')}`, 'Run: npm install');
      }
    }
  } catch (err: unknown) {
    criticalFail('Dependencies', `Error: ${(err as Error).message}`, 'Run: npm install');
  }

  // -------------------------------------------------------------------------
  // 3. Database exists and is writable
  // -------------------------------------------------------------------------
  try {
    // resolveDbPath() so this check sees the real registry in the compiled
    // binary too (join(__dirname,...) resolves into read-only /$bunfs/).
    const dbPath: string = resolveDbPath();
    if (existsSync(dbPath)) {
      // Check if writable by trying to open for writing
      try {
        accessSync(dbPath, constants.R_OK | constants.W_OK);
        check('Database', true, 'port-registry.db exists and is writable');
      } catch {
        criticalFail('Database', 'port-registry.db exists but is not writable', 'Check file permissions on port-registry.db');
      }
    } else {
      // Database not existing is fine if daemon hasn't started yet
      check('Database', true, 'port-registry.db will be created on first start');
    }
  } catch (err: unknown) {
    check('Database', false, `Error: ${(err as Error).message}`, 'Check port-registry.db permissions');
  }

  // ---------------------------------------------------------------------------
  // 3b. Database home durability: a registry inside a version-pinned install
  // directory (Homebrew Cellar) is deleted on every upgrade — the root cause
  // of repeated roadmap/notes data loss. Daemons must not own different truths.
  // ---------------------------------------------------------------------------
  try {
    const dbPath: string = resolveDbPath();
    if (isVersionVolatileDbPath(dbPath)) {
      criticalFail(
        'Database home',
        `Registry lives in a version-pinned install dir: ${dbPath} (wiped on next upgrade)`,
        `Restart the daemon without PORT_DADDY_DB (defaults to ${durableDbHomePath()}); boot migrates the legacy data automatically`,
      );
    } else {
      check('Database home', true, `Registry path is durable: ${dbPath}`);
    }
  } catch (err: unknown) {
    check('Database home', false, `Error: ${(err as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // 4. Network: Can we reach the discovered daemon URL
  // -------------------------------------------------------------------------
  let daemonData: Record<string, unknown> | null = null;
  let daemonRunning: boolean = false;

  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    if (res.ok) {
      const parsedHealth = await res.json();
      if (parsedHealth && typeof parsedHealth === 'object' && !Array.isArray(parsedHealth)) {
        daemonData = parsedHealth as Record<string, unknown>;
        daemonRunning = true;
        check('Network', true, `${getDaemonUrl()} is reachable`);
      } else {
        // A health check whose SUBJECT is broken must gate the exit code, not warn.
        // `pd doctor --ci/--json` exiting 0 while the daemon is down/broken is the
        // single worst doctor lie (a green build over a dead daemon).
        criticalFail('Network', `${getDaemonUrl()} returned an invalid /health payload`, 'Run: port-daddy restart');
      }
    } else {
      criticalFail('Network', `${getDaemonUrl()} returned status ${res.status}`, 'Run: port-daddy start');
    }
  } catch {
    criticalFail('Network', `Cannot connect to ${getDaemonUrl()}`, 'Run: port-daddy start');
  }

  // -------------------------------------------------------------------------
  // 5. Daemon status
  // -------------------------------------------------------------------------
  if (daemonRunning && daemonData) {
    check('Daemon running', true, `PID ${daemonData.pid}, v${daemonData.version}`);
  } else {
    // Daemon down = CRITICAL. This is the exit-code gate: a doctor run over a
    // non-running daemon must exit non-zero, never 0-with-a-warning.
    criticalFail('Daemon running', 'Daemon is not running', 'Run: port-daddy start');
  }

  // -------------------------------------------------------------------------
  // 5b. Daemon liveness DEPTH — not just "TCP bound" but the shared /health
  //     report: critical routes registered + runtime nominal. Consumes the
  //     SAME structured report the console and FleetBar read, so the three
  //     surfaces never disagree about what "degraded" means.
  // -------------------------------------------------------------------------
  if (daemonRunning && daemonData) {
    const routes = daemonData.routes as { ok?: boolean; missing?: Array<{ method: string; url: string }>; checked?: number } | undefined;
    const runtime = daemonData.runtime as { state?: string; degraded?: boolean } | undefined;
    const severity = daemonData.severity as Severity | undefined;
    if (routes && routes.ok === false) {
      const missingList = (routes.missing ?? []).map((r) => `${r.method} ${r.url}`).join(', ');
      criticalFail('Daemon liveness',
        `Daemon is 404'ing ${routes.missing?.length ?? 0} of its own critical routes: ${missingList || 'unknown'}`,
        'Rebuild + relaunch the daemon: port-daddy restart');
    } else if (severity === 'warn' || runtime?.degraded) {
      recordAssessment('Daemon liveness', {
        severity: 'warn',
        detail: `Runtime is ${runtime?.state ?? 'degraded'} (routes ok, but the daemon reports a degradation)`,
        hint: 'Inspect: pd status   (see runtime.reasons)',
      });
    } else {
      check('Daemon liveness', true, `Routes ok (${routes?.checked ?? 0} checked), runtime ${runtime?.state ?? 'nominal'}`);
    }
  } else {
    check('Daemon liveness', false, 'Daemon not running, cannot probe routes/runtime', 'Run: port-daddy start');
  }

  // -------------------------------------------------------------------------
  // 5c. Binary drift — the running daemon vs the binary `pd` now resolves on
  //     disk (brew-upgrade / Cellar-vs-opt drift). WARN: works now, but the
  //     operator is talking to a stale process.
  // -------------------------------------------------------------------------
  if (daemonRunning && daemonData) {
    const drift = daemonData.binaryDrift as { drifted?: boolean; reason?: string; runningPath?: string; onDiskPath?: string } | undefined;
    if (drift?.drifted) {
      warn('Binary drift',
        `Running daemon differs from on-disk binary (${drift.reason ?? 'hash mismatch'}): running=${drift.runningPath ?? '?'} on-disk=${drift.onDiskPath ?? '?'}`,
        'Restart to pick up the on-disk binary: port-daddy restart');
    } else {
      check('Binary drift', true, drift ? 'Running daemon matches the on-disk binary' : 'No drift snapshot (older daemon) — skipped');
    }
  }

  // -------------------------------------------------------------------------
  // 6. Code hash freshness
  // -------------------------------------------------------------------------
  try {
    if (daemonRunning) {
      const versionRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
      if (versionRes.ok) {
        const versionData = await versionRes.json();
        const localHash: string = getLocalCodeHash();

        if (versionData.codeHash === localHash) {
          check('Code hash', true, `Matches (${localHash})`);
        } else {
          check('Code hash', false,
            `Mismatch: daemon=${versionData.codeHash} local=${localHash}`,
            'Run: port-daddy restart');
        }
      } else {
        check('Code hash', false, 'Could not query daemon version', 'Run: port-daddy restart');
      }
    } else {
      check('Code hash', false, 'Daemon not running, cannot verify', 'Run: port-daddy start');
    }
  } catch (err: unknown) {
    check('Code hash', false, `Error: ${(err as Error).message}`, 'Run: port-daddy restart');
  }

  // -------------------------------------------------------------------------
  // 7. Daemon TCP port availability
  // -------------------------------------------------------------------------
  try {
    if (daemonRunning) {
      check(portLabel, true, `Bound to Port Daddy daemon at ${getDaemonUrl()}`);
    } else {
      // Check if something else is using the currently discovered daemon port.
      const net = await import('node:net');
      const portInUse: boolean = await new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => {
          server.close();
          resolve(false);
        });
        server.listen(daemonPort, '127.0.0.1');
      });

      if (portInUse) {
        check(portLabel, false, 'In use by another process', `Run: lsof -i :${daemonPort} to investigate`);
      } else {
        check(portLabel, true, 'Available (daemon not running)');
      }
    }
  } catch (err: unknown) {
    check(portLabel, false, `Error: ${(err as Error).message}`, `Run: lsof -i :${daemonPort} to investigate`);
  }

  // -------------------------------------------------------------------------
  // 8. Supervision integrity (the crux) — exactly ONE launchd job owns the
  //    daemon and it is running. CRITICAL when unsupervised + unreachable
  //    (silent-death), WARN when unsupervised-but-reachable or when two
  //    supervisors race the listener. The old check looked only for the
  //    removed `com.portdaddy.daemon` label and was blind to every
  //    brew-supervised install.
  // -------------------------------------------------------------------------
  // Captured for the Agent Harbor readiness section (C8): null = not assessed
  // (non-darwin), true = exactly-one-supervisor-running, false = anything else.
  let daemonSupervisedForHarbor: boolean | null = null;
  // The assessment's own words + structured repair, so the Harbor daemon card
  // recommends the RIGHT fix (bootout a duplicate / kickstart a stopped job)
  // instead of collapsing every non-ok state into `port-daddy install`.
  let daemonSupervisionDetailForHarbor: string | null = null;
  let daemonSupervisionRepairForHarbor: { command: string; description: string } | null = null;
  try {
    if (process.platform === 'darwin') {
      const supervision = assessSupervisionIntegrity({
        supervisors: gatherLaunchdSupervisors(),
        daemonReachable: daemonRunning,
      });
      daemonSupervisedForHarbor = supervision.severity === 'ok';
      if (supervision.severity !== 'ok') {
        daemonSupervisionDetailForHarbor = supervision.detail;
        daemonSupervisionRepairForHarbor = supervision.repair ?? null;
      }
      recordAssessment('Supervision integrity', supervision);
    } else if (process.platform === 'linux') {
      const homedir = (await import('node:os')).homedir();
      const unitPath: string = join(homedir, '.config', 'systemd', 'user', 'port-daddy.service');

      if (existsSync(unitPath)) {
        const result: SpawnSyncReturns<string> = spawnSync('systemctl', ['--user', 'is-active', 'port-daddy.service'], {
          encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        });
        const state: string = (result.stdout || '').trim();

        if (state === 'active') {
          check('System service', true, 'systemd user service active');
        } else if (state === 'failed') {
          check('System service', false,
            'systemd service failed',
            'Check: journalctl --user -u port-daddy.service');
        } else {
          check('System service', false,
            `systemd service installed but ${state}`,
            'Run: systemctl --user start port-daddy.service');
        }
      } else {
        check('System service', false,
          'systemd user service not installed',
          'Run: port-daddy install');
      }
    } else {
      check('System service', true, `N/A (${process.platform} \u2014 use: port-daddy start)`);
    }
  } catch (err: unknown) {
    check('System service', false, `Error: ${(err as Error).message}`, 'Run: port-daddy install');
  }

  // -------------------------------------------------------------------------
  // 8b. Bosun watchdog — the Rust heartbeat/PID supervisor (core/pd-bosun).
  //     Previously this was silently skipped when the binary was missing; now
  //     it is a loud WARN that names the exact build command. Running-state is
  //     read from the daemon's guardians.bosun when reachable.
  // -------------------------------------------------------------------------
  try {
    // `libDir` is a naive `join(__dirname, '..', '..')` — correct for a source
    // checkout, but for a `bun build --compile` binary `__dirname` is a virtual
    // bun:// path, so that join produces a string that never exists on disk.
    // `resolveDistributionRoot` (already used by describeResourceDir() below
    // for the same reason) resolves the REAL install root from process.execPath
    // in that case and is a no-op passthrough for a source checkout. Without
    // this, `pd doctor` always reported "pd-bosun binary not built" for every
    // packaged/brew install even when Bosun was genuinely installed and
    // healthy (found live during the v3.25.1/3.25.2 brew rollout).
    const bosun = resolveBosunBinary(resolveDistributionRoot(libDir));
    // The DAEMON is authoritative about its own watchdog: it resolves the binary
    // from its real runtime root and reports live state. Trust it over the CLI's
    // local resolver, which can guess a wrong distribution root under an unusual
    // install layout. Only fall back to the local resolver when the daemon is
    // unreachable.
    let daemonBinaryExists: boolean | null = null;
    let daemonBinaryPath: string | null = null;
    let bosunRunning: boolean | null = null;
    let bosunReason: string | null = null;
    if (daemonRunning) {
      try {
        const statusRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/status`);
        if (statusRes.ok) {
          const statusData = await statusRes.json() as {
            guardians?: { bosun?: { state?: string; reason?: string; binaryExists?: boolean; binaryPath?: string } };
          };
          const g = statusData?.guardians?.bosun;
          if (g) {
            bosunReason = g.reason ?? g.state ?? null;
            bosunRunning = g.state === 'healthy' || g.state === 'idle';
            if (typeof g.binaryExists === 'boolean') daemonBinaryExists = g.binaryExists;
            if (g.binaryPath) daemonBinaryPath = g.binaryPath;
          }
        }
      } catch { /* daemon guardians unavailable — fall back to local binary presence */ }
    }
    const bosunPresent = daemonBinaryExists ?? bosun.exists;
    const bosunPath = daemonBinaryPath ?? bosun.binaryPath;
    if (!bosunPresent) {
      // Required (halt-mandate): a brew/tarball install with NO watchdog binary
      // leaves the daemon with no independent heartbeat/PID supervisor. This is a
      // shipping defect, not a warning — fail the doctor so it can't reach users.
      criticalFail('Bosun watchdog',
        'pd-bosun watchdog binary is MISSING — the daemon has no independent heartbeat/PID supervisor',
        'Reinstall so the supervisor ships: `brew reinstall port-daddy` (or `npm run build:bosun` in a source checkout)');
    } else if (bosunRunning === false) {
      warn('Bosun watchdog',
        `pd-bosun binary present at ${bosunPath} but not active${bosunReason ? ` (${bosunReason})` : ''}`,
        'Heartbeat writer is the daemon-side fallback; run `port-daddy install-bosun` to wire the supervisor');
    } else {
      check('Bosun watchdog', true, `pd-bosun present at ${bosunPath}${bosunReason ? ` (${bosunReason})` : ''}`);
    }
  } catch (err: unknown) {
    check('Bosun watchdog', false, `Error: ${(err as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // 8c. Bun native-crash signature — launchd's KeepAlive respawns silently
  //     through a native Bun panic (segfault) with no escalation of its own
  //     (see issue #676: Bun 1.2.21 JSC-GC crash family, state/load-dependent,
  //     NOT fixed by pinning an older port-daddy release). Surface it loudly
  //     instead of letting the operator discover a crash-loop by accident.
  // -------------------------------------------------------------------------
  try {
    const { count, logPath, readError } = readRecentBunCrashCount(candidateDaemonLogPaths(homedir(), libDir));
    recordAssessment('Bun crash signature', assessCrashSignature({ crashCount: count, logPath, readError }));
  } catch (err: unknown) {
    // An unexpected throw here is itself an unknown, not a clean bill of
    // health — never let a failed check read as 'ok' (see PR #879 review).
    recordAssessment('Bun crash signature', {
      severity: 'warn',
      detail: `Could not check daemon log for crash signatures: ${(err as Error).message}`,
    });
  }

  // -------------------------------------------------------------------------
  // 8d. macOS DiagnosticReports — native crashes can be recorded as `.ips`
  //     reports even after the daemon log tail rotates past the Bun banner.
  //     Treat these as runtime truth too; this is the source the operator
  //     pointed us at under ~/Library/Logs.
  // -------------------------------------------------------------------------
  if (process.platform === 'darwin') {
    try {
      const reports = readRecentMacDiagnosticCrashReports(candidateMacDiagnosticReportPaths(homedir()));
      recordAssessment('macOS crash reports', assessMacDiagnosticCrashReports(reports));
    } catch (err: unknown) {
      recordAssessment('macOS crash reports', {
        severity: 'warn',
        detail: `Could not inspect macOS DiagnosticReports for daemon crashes: ${(err as Error).message}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 9. Stale services (services with dead PIDs)
  // -------------------------------------------------------------------------
  try {
    if (daemonRunning) {
      const servicesRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services`);
      if (servicesRes.ok) {
        const servicesData = await servicesRes.json();
        let staleCount: number = 0;

        const svcList = (servicesData.services || []) as Array<{ pid?: number }>;
        for (const svc of svcList) {
          if (svc.pid) {
            // Use isPidAlive (EPERM = alive-but-other-owner), not a bare process.kill —
            // a live service owned by another uid must not be miscounted as "stale".
            if (!isPidAlive(svc.pid)) staleCount++;
          }
        }

        if (staleCount === 0) {
          check('Stale services', true, 'No stale services found');
        } else {
          check('Stale services', false,
            `${staleCount} service(s) with dead PIDs`,
            'Run: port-daddy release --expired');
        }
      } else {
        check('Stale services', false, 'Could not query services', 'Run: port-daddy find');
      }
    } else {
      check('Stale services', true, 'Daemon not running (no services to check)');
    }
  } catch (err: unknown) {
    check('Stale services', false, `Error: ${(err as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // SQLite integrity
  // -------------------------------------------------------------------------
  try {
    // resolveDbPath() (not join(__dirname, ...)) so the probe runs against the
    // real registry inside the compiled binary too — see import note above.
    const dbPath: string = resolveDbPath();
    if (existsSync(dbPath)) {
      let testDb;
      try {
        testDb = new Database(dbPath, { readonly: true });
        const integrityResult = testDb.pragma('integrity_check', { simple: true }) as string;
        if (integrityResult === 'ok') {
          check('SQLite integrity', true, 'Database passes integrity check');
        } else {
          criticalFail('SQLite integrity',
            `Integrity check failed: ${integrityResult}`,
            'Back up port-registry.db then run: pd doctor --repair');
        }
      } catch (dbErr) {
        check('SQLite integrity', false,
          `Could not open database: ${(dbErr as Error).message}`,
          'Database may be locked or corrupted.');
      } finally {
        try { testDb?.close(); } catch { /* ignore */ }
      }
    } else {
      check('SQLite integrity', true, 'No database file yet (will be created on first start)');
    }
  } catch (err: unknown) {
    check('SQLite integrity', false, `Error: ${(err as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // DB fragmentation — multiple scattered port-registry*.db files (the known
  // continuity bug where backups/Cellar copies leave the daemon reading or
  // backing up the wrong registry). One is healthy; more than one is a WARN.
  // -------------------------------------------------------------------------
  try {
    const registryDbs = scanRegistryDbFiles(PD_HOME);
    const activeDb = resolveDbPath();
    const activeDir = activeDb.slice(0, activeDb.lastIndexOf('/'));
    // Also count a registry living outside ~/.port-daddy (e.g. a brew Cellar copy).
    const extra = activeDir && activeDir !== PD_HOME ? scanRegistryDbFiles(activeDir) : [];
    const all = Array.from(new Set([...registryDbs, ...extra]));
    if (all.length <= 1) {
      check('DB fragmentation', true, all.length === 1 ? `Single registry: ${all[0]}` : 'No scattered registry copies');
    } else {
      warn('DB fragmentation',
        `${all.length} registry DB files found (${all.join(', ')}) — the daemon may read/back-up the wrong one`,
        `Active registry is ${activeDb}; consolidate or remove the stale copies`);
    }
  } catch (err: unknown) {
    // "Could not check" is UNKNOWN, never healthy — a permissions failure on PD_HOME
    // must not read as a green "no fragmentation".
    warn('DB fragmentation', `Could not check registry fragmentation: ${(err as Error).message}`,
      'Check read permissions on the Port Daddy home directory');
  }

  // -------------------------------------------------------------------------
  // Stale socket file
  // -------------------------------------------------------------------------
  try {
    if (existsSync(SOCK_PATH)) {
      if (daemonRunning) {
        check('Socket file', true, `${SOCK_PATH} exists and daemon is responding`);
      } else {
        check('Socket file', false,
          `${SOCK_PATH} exists but daemon is not responding`,
          `Stale socket file. Remove it: rm ${SOCK_PATH}`);
      }
    } else {
      check('Socket file', true, daemonRunning ? 'No socket file (daemon using TCP)' : 'No socket file (daemon not running)');
    }
  } catch (err: unknown) {
    check('Socket file', false, `Error: ${(err as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // PID file staleness
  // -------------------------------------------------------------------------
  try {
    const pidFilePath: string = SOCK_PATH + '.pid';
    if (existsSync(pidFilePath)) {
      const pidStr: string = readFileSync(pidFilePath, 'utf8').trim();
      const pid: number = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        check('PID file', false, `${pidFilePath} contains invalid PID: "${pidStr}"`, `Remove: rm ${pidFilePath}`);
      } else {
        // isPidAlive treats EPERM as alive — a live daemon PID owned by another uid must
        // not be reported "stale" with advice to delete a running daemon's pidfile.
        const processAlive = isPidAlive(pid);
        check('PID file', processAlive, processAlive ? `PID ${pid} is running` : `PID ${pid} is not running (stale)`,
          processAlive ? undefined : `Remove: rm ${pidFilePath}`);
      }
    } else {
      check('PID file', true, 'No PID file (normal)');
    }
  } catch (err: unknown) {
    check('PID file', false, `Error: ${(err as Error).message}`);
  }

  // -------------------------------------------------------------------------
  // Stuck lsof processes
  // -------------------------------------------------------------------------
  try {
    const psResult: SpawnSyncReturns<string> = spawnSync('sh', ['-c', 'ps aux | grep "[l]sof" | wc -l'], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000
    });
    const lsofCount: number = parseInt((psResult.stdout || '0').trim(), 10);
    if (lsofCount > 5) {
      check('Stuck lsof processes', false,
        `${lsofCount} lsof processes found (expected < 5)`,
        'Kill them: pkill -f lsof');
    } else {
      check('Stuck lsof processes', true, `${lsofCount} lsof process(es) running`);
    }
  } catch (err: unknown) {
    // A failed probe is unknown, not clean — don't report ✓ when we never looked.
    warn('Stuck lsof processes', `Could not check for stuck lsof processes: ${(err as Error).message}`,
      'The ps/grep probe failed; check manually with `ps aux | grep lsof`');
  }

  // -------------------------------------------------------------------------
  // Shell completions
  // -------------------------------------------------------------------------
  const shell: string = process.env.SHELL || '';
  const completionsDir: string = join(libDir, 'completions');
  if (shell.includes('zsh')) {
    const zshFile: string = join(completionsDir, 'port-daddy.zsh');
    check('Shell completions', existsSync(zshFile),
      existsSync(zshFile) ? 'Zsh completions file found' : 'Zsh completions file missing',
      'Run: port-daddy install   (writes the zsh completion file)');
  } else if (shell.includes('bash')) {
    const bashFile: string = join(completionsDir, 'port-daddy.bash');
    check('Shell completions', existsSync(bashFile),
      existsSync(bashFile) ? 'Bash completions file found' : 'Bash completions file missing',
      'Run: port-daddy install   (writes the bash completion file)');
  } else if (shell.includes('fish')) {
    const fishFile: string = join(completionsDir, 'port-daddy.fish');
    check('Shell completions', existsSync(fishFile),
      existsSync(fishFile) ? 'Fish completions file found' : 'Fish completions file missing',
      'Run: port-daddy install   (writes the fish completion file)');
  } else {
    check('Shell completions', true, `Shell "${shell || 'unknown'}" — completions available for bash/zsh/fish`);
  }

  // -------------------------------------------------------------------------
  // 11. Startup blockers (stale sockets, zombie processes, port conflicts)
  // -------------------------------------------------------------------------
  const startupIssues = diagnoseStartupBlockers(daemonPort, {
    healthyDaemonPid: daemonRunning && typeof daemonData?.pid === 'number' ? daemonData.pid as number : null,
  });
  if (startupIssues.length === 0 && !daemonRunning) {
    check('Startup readiness', true, 'No blockers — daemon can start cleanly');
  } else if (startupIssues.length === 0) {
    // Daemon is running, no blockers
  } else {
    for (const issue of startupIssues) {
      check(issue.issue, false, issue.detail,
        issue.fixable ? 'Auto-fixable (will prompt below)' : 'Manual intervention needed');
    }
  }

  // -------------------------------------------------------------------------
  // 11b. Hostile `.env.local` in the current directory
  // -------------------------------------------------------------------------
  // The Homebrew `pd` is a `bun build --compile` binary, and bun auto-loads
  // `.env.local` from the cwd before any of our code runs. A shell-idiom value
  // that nests a command substitution inside a default-expansion —
  // `KEY="${KEY:-$(...)}"` — segfaults bun 1.2.21 (exit 133) during that
  // autoload, so `pd` is totally MUTE from that directory. This is exactly how
  // a "mute pd" looked in the field: every fleet agent running `pd` from a repo
  // with such an `.env.local` got silence. We detect the idiom textually
  // (never executing the file) and tell the operator how to fix it — but we
  // never auto-edit secrets without consent.
  try {
    const hostileEnv = detectHostileEnvLocal(process.cwd());
    if (hostileEnv.length === 0) {
      check('Shell-idiom .env.local', true, 'No bun-crashing .env.local in the current directory');
    } else {
      const first = hostileEnv[0];
      check(
        'Shell-idiom .env.local',
        false,
        `${first.path}:${first.lineNumber} uses a command-substitution inside a default-expansion ` +
          `(\${VAR:-\$(...)}), which segfaults bun's dotenv autoload — the compiled pd will be MUTE from this directory`,
        'Fix (any one): drop the ${VAR:-$(...)} wrapper — set the value as a plain literal or a bare ' +
          '$(...) (both load fine); OR move keychain/command resolution into your shell rc (export it ' +
          'before running pd) and remove it from .env.local. (Quoting does NOT help — single OR double ' +
          'quotes still crash bun.) pd will not edit secrets for you.',
      );
    }
  } catch (err: unknown) {
    // Unknown, not clean — a read failure here must not read as "no mute-pd trap present".
    warn('Shell-idiom .env.local', `Could not scan the current directory for a bun-crashing .env.local: ${(err as Error).message}`,
      'Check read permissions on the current directory');
  }

  // -------------------------------------------------------------------------
  // 12. Launch-agent target (binary daemon migration)
  // -------------------------------------------------------------------------
  // Catches the silent-upgrade failure where a user installed the binary
  // distribution but their existing launchd plist still points at the
  // source daemon (`tsx server.ts`). Without this check, `brew upgrade`
  // appears to do nothing because launchd keeps spawning the old tsx
  // path. This replaces the regression guard formerly at
  // `scripts/promote-stable.sh:144-148`, now reachable for every user
  // — not just developers running the (now-deleted) promote-stable
  // script. See ADR-0028 step 11.
  try {
    const plistPath = userLaunchAgentPlistPath();
    if (plistPath && existsSync(plistPath)) {
      // readPlistAsXml handles both XML and binary plist formats —
      // a stale binary plist still targeting tsx server.ts would
      // otherwise read as UTF-8 garbage and silently false-negative.
      const contents = readPlistAsXml(plistPath);
      if (plistTargetsLegacyDaemon(contents)) {
        check(
          'LaunchAgent target',
          false,
          `${plistPath} still targets source daemon (tsx/server.ts)`,
          'Run: port-daddy install   (regenerates the plist against the current daemon binary)',
        );
      } else {
        check('LaunchAgent target', true, `${plistPath} targets the binary daemon`);
      }
    } else if (plistPath) {
      check('LaunchAgent target', true, `No LaunchAgent installed (${plistPath} absent)`);
    } else {
      check('LaunchAgent target', true, `Skipped on ${platform()} (macOS-only diagnostic for now)`);
    }
  } catch (err: unknown) {
    check(
      'LaunchAgent target',
      false,
      `Error reading plist: ${(err as Error).message}`,
      'Check ~/Library/LaunchAgents/com.portdaddy.daemon.plist permissions',
    );
  }

  // -------------------------------------------------------------------------
  // 13. Resource-directory resolution breakdown
  // -------------------------------------------------------------------------
  // PORT_DADDY_RESOURCE_DIR is overloaded — it's the explicit env
  // override, the Bun-virtual-path escape hatch, the install-time plist
  // env value, AND the runtime asset root. Different layouts (Homebrew
  // prefix, custom --prefix, Windows) can make those four meanings
  // diverge silently. This check prints what each pass resolves to right
  // now so problems are visible at a glance.
  try {
    const breakdown = describeResourceDir(libDir);
    const lines: string[] = [
      `env=${breakdown.envOverride ?? '<unset>'}`,
      `moduleDir=${breakdown.moduleDir}${breakdown.moduleDirIsBunVirtual ? ' (bun virtual fs)' : ''}`,
      `resolvedRoot=${breakdown.resolvedRoot}`,
      `expectedBinary=${breakdown.expectedBinary}${breakdown.binaryExists ? ' (present)' : ' (MISSING)'}`,
    ];
    if (breakdown.binaryExists) {
      check('Resource directory', true, lines.join('; '));
    } else if (breakdown.envOverride) {
      // Explicit override AND binary missing — operator intent is clear,
      // so the missing binary is a real failure to flag.
      check(
        'Resource directory',
        false,
        lines.join('; '),
        'Build the daemon binary: npm run build:daemon:dist',
      );
    } else {
      // "Missing" means different things packaged vs source, and the old message lied to
      // brew users ("run npm run build:daemon:dist" — there is no source tree). A compiled/
      // Homebrew `pd` has NO separate dist/daemon binary; the daemon is bundled INTO the
      // compiled binary, which is correct. Only a source checkout is genuinely "not built".
      const isPackaged = !existsSync(join(libDir, 'package.json'));
      check(
        'Resource directory',
        true,
        isPackaged
          ? `${lines.join('; ')} (packaged install — the daemon is bundled in the compiled binary; no separate dist/daemon binary is expected)`
          : `${lines.join('; ')} (binary not built — run npm run build:daemon:dist when you need it)`,
      );
    }
  } catch (err: unknown) {
    check(
      'Resource directory',
      false,
      `Error: ${(err as Error).message}`,
      'Inspect PORT_DADDY_RESOURCE_DIR if set, otherwise file a bug',
    );
  }

  // -------------------------------------------------------------------------
  // 14. Agent runtime wiring: MCP, skills, and lifecycle hooks
  // -------------------------------------------------------------------------
  // Agent CLIs are right to show users installed hooks. This section makes that
  // disclosure auditable: the names are plain language, the privacy boundary is
  // explicit, and a user who removed hooks/skills/MCP gets a direct repair path.
  // Retained for the Agent Harbor readiness section (C8) so the harbor cards
  // judge the SAME probes this section printed — never a second opinion.
  let mcpFactsForHarbor: { configured: boolean; detail: string } = {
    configured: false,
    detail: 'Agent runtime wiring could not be probed',
  };
  let hookDiagnosesForHarbor: SquidProviderHookDiagnosis[] = [];

  try {
    const runtime = diagnoseAgentRuntimeInstall(homedir());
    mcpFactsForHarbor = { configured: runtime.mcpConfigured, detail: runtime.mcpDetail };
    check('Agent MCP wiring', runtime.mcpConfigured, runtime.mcpDetail, runtime.mcpHint);
    check('Agent Port Daddy skill', runtime.skillInstalled, runtime.skillDetail, runtime.skillHint);
  } catch (err: unknown) {
    check('Agent runtime wiring', false, `Error: ${(err as Error).message}`, 'Run: pd setup');
  }

  try {
    const hookChecks: SquidProviderHookDiagnosis[] = inspectHookTargets(homedir(), process.cwd())
      .filter((target) => target.detected)
      .map((target) => ({
      providerName: target.slug === 'claude' ? 'claude-code' : target.slug === 'agy' ? 'antigravity' : target.slug,
      binaryName: target.slug,
      configPath: target.expectedScope === 'project' ? target.projectPath ?? '' : target.userPath,
      ok: target.wired,
      detail: target.wired
          ? `${target.expectedScope} hook config is wired and this exact project root is armed`
          : `${target.expectedScope} hook config missing, stale, or this exact project root is not armed`,
      hint: 'Run: pd squid on',
    }));
    hookDiagnosesForHarbor = hookChecks;
    const okHooks = hookChecks.filter((result) => result.ok);
    if (okHooks.length === hookChecks.length) {
      check('Agent lifecycle hooks', true, `${okHooks.length} provider hook contract(s) installed with visible privacy metadata`);
    } else {
      check(
        'Agent lifecycle hooks',
        false,
        `${okHooks.length}/${hookChecks.length} provider hook contract(s) healthy`,
        'Run: pd setup   (or pd squid on)',
      );
      for (const result of hookChecks.filter((item) => !item.ok)) {
        check(`Agent hooks: ${result.providerName}`, false, `${result.detail} at ${result.configPath}`, result.hint);
      }
    }
    check('Hook privacy disclosure', true, SQUID_HOOK_PRIVACY_NOTICE);
  } catch (err: unknown) {
    check('Agent lifecycle hooks', false, `Error: ${(err as Error).message}`, 'Run: pd squid on');
  }

  // -------------------------------------------------------------------------
  // 15. Local embedding model (ADR-0061 shared cache; hybrid-search policy)
  // -------------------------------------------------------------------------
  // ONE model for every semantic surface: resolver, LLM semantic cache,
  // shipwright skill index, and `pd embed` (the surface skills shell out to).
  // A cancelled setup download is allowed — this is the repair path.
  let embeddingModelCached = true;
  try {
    const embCacheDir = defaultTransformersCacheDir();
    embeddingModelCached = isEmbeddingModelCached(embCacheDir);
    if (embeddingModelCached) {
      check('Local embedding model', true, `${DEFAULT_SEMANTIC_MODEL_ID} cached at ${embCacheDir}`);
    } else {
      check(
        'Local embedding model',
        false,
        `${DEFAULT_SEMANTIC_MODEL_ID} not cached at ${embCacheDir} — semantic/hybrid search degrades to lexical-only`,
        'Run: pd embed prefetch   (one-time ~27 MB download; also offered below)',
      );
    }
  } catch (err: unknown) {
    check('Local embedding model', false, `Error: ${(err as Error).message}`, 'Run: pd embed prefetch');
  }

  // -------------------------------------------------------------------------
  // 16. Agent Harbor readiness (binder ch18 Work Order C8, ADR-0095)
  // -------------------------------------------------------------------------
  // Ten areas, one RemediationCard each, ONE repair per detected issue. Cards
  // are judged by the pure core in lib/agent-harbor/setup-doctor.ts from facts
  // gathered here — including the facts this doctor already computed above
  // (daemon reachability, supervision, hooks, MCP), so the harbor view can
  // never disagree with the checks the operator just read. Every card names
  // its sync posture: local-only / syncs (opt-in) / disabled.
  try {
    const pkgPathForVersion = join(libDir, 'package.json');
    const cliVersion: string = existsSync(pkgPathForVersion)
      ? (JSON.parse(readFileSync(pkgPathForVersion, 'utf8')) as { version?: string }).version ?? 'unknown'
      : process.env.PORT_DADDY_PACKAGE_VERSION || EMBEDDED_PACKAGE_VERSION;
    const facts = await gatherHarborFacts({
      daemonReachable: daemonRunning,
      daemonVersion: daemonRunning && daemonData ? String(daemonData.version ?? '') || null : null,
      daemonSupervised: daemonSupervisedForHarbor,
      daemonSupervisionDetail: daemonSupervisionDetailForHarbor,
      daemonSupervisionRepair: daemonSupervisionRepairForHarbor,
      hookDiagnoses: hookDiagnosesForHarbor,
      mcp: mcpFactsForHarbor,
      cliVersion,
    });
    const cards = assessHarborReadiness(facts);
    for (const card of cards) {
      recordAssessment(`Harbor: ${card.title} [${card.syncState === 'local' ? 'local-only' : card.syncState === 'synced' ? 'syncs (opt-in)' : 'disabled'}]`, {
        severity: card.severity,
        detail: card.detail,
        hint: card.repair ? `Run: ${card.repair.command}   (${card.repair.description})` : undefined,
      });
    }

    // First-value metric: time to first OFFICIAL Agent Node. Seals once. The
    // Agent Node ledger route is the F0-canonical GET /agent-nodes (binder
    // ch09), served for real by routes/agent-harbor.ts over C1's projections
    // (wave3/routes). Older daemons without that route still 404 and we say
    // so honestly instead of inventing a number.
    let fvRecord = loadFirstValueRecord();
    if (fvRecord.setupCompletedAt && fvRecord.timeToFirstOfficialAgentNodeMs === null && daemonRunning) {
      try {
        const nodesRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agent-nodes`);
        if (nodesRes.ok) {
          const payload = await nodesRes.json() as { nodes?: AgentNodeV0[] } | AgentNodeV0[];
          const nodes = Array.isArray(payload) ? payload : (payload.nodes ?? []);
          const updated = computeFirstValue(fvRecord, nodes);
          if (updated.timeToFirstOfficialAgentNodeMs !== null) {
            saveFirstValueRecord(updated);
            fvRecord = updated;
          }
        }
      } catch { /* running daemon predates routes/agent-harbor.ts — report honestly below */ }
    }
    if (fvRecord.timeToFirstOfficialAgentNodeMs !== null) {
      check('Harbor: first-value metric', true,
        `Time to first official Agent Node: ${formatDurationMs(fvRecord.timeToFirstOfficialAgentNodeMs)} (setup ${fvRecord.setupCompletedAt} → node ${fvRecord.firstOfficialAgentNodeAt})`);
    } else if (fvRecord.setupCompletedAt) {
      check('Harbor: first-value metric', true,
        `Not yet measured — setup completed ${fvRecord.setupCompletedAt}; no official (daemon-witnessed) Agent Node observed yet.`);
    } else {
      check('Harbor: first-value metric', true,
        'Not yet measured — run the default install path (pd setup) to start the clock.');
    }
  } catch (err: unknown) {
    check('Harbor readiness', false, `Error: ${(err as Error).message}`, 'Run: pd setup');
  }

  // -------------------------------------------------------------------------
  // Tally + overall severity (the three-tier model)
  // -------------------------------------------------------------------------
  const warnCount = results.filter((r) => r.severity === 'warn').length;
  const criticalCount = results.filter((r) => r.severity === 'critical').length;
  const overall: Severity = worstSeverity(results.map((r) => r.severity));

  // -------------------------------------------------------------------------
  // JSON mode: one machine-readable report, no interactive phase. This is the
  // shape CI consumes (`pd doctor --json`) and the same severity vocabulary the
  // daemon's /health speaks.
  // -------------------------------------------------------------------------
  if (jsonMode) {
    const report = {
      tool: 'port-daddy doctor',
      severity: overall,
      summary: { ok: passed, warn: warnCount, critical: criticalCount, total },
      checks: results.map((r) => ({
        name: r.name,
        severity: r.severity,
        ok: r.ok,
        detail: r.detail,
        ...(r.hint ? { hint: r.hint } : {}),
      })),
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(criticalCount > 0 ? 1 : 0);
  }

  // -------------------------------------------------------------------------
  // Human output \u2014 severity-aware glyphs so warnings are loud but distinct
  // from a build-breaking critical.
  // -------------------------------------------------------------------------
  console.log('');
  console.log('Port Daddy Doctor');
  console.log('\u2501'.repeat(50));

  for (const r of results) {
    const glyph = r.severity === 'ok' ? '\u2713' : r.severity === 'warn' ? '\u26a0' : '\u2717';
    const tag = r.severity === 'critical' ? ' [CRITICAL]' : r.severity === 'warn' ? ' [warn]' : '';
    console.log(`${glyph} ${r.name}${tag}: ${r.detail}`);
    if (!r.ok && r.hint) {
      console.log(`  \u2192 ${r.hint}`);
    }
  }

  console.log('\u2501'.repeat(50));
  console.log(
    `${passed} ok \u00b7 ${warnCount} warn \u00b7 ${criticalCount} critical` +
    `   (of ${total})  \u2192  OVERALL: ${overall.toUpperCase()}`,
  );
  if (criticalCount > 0) {
    console.log('Critical failures gate CI and turn the operator UIs red.');
  }

  // -------------------------------------------------------------------------
  // CI / exit-code mode: stop here (no interactive prompts), gate on critical.
  // -------------------------------------------------------------------------
  if (ciMode) {
    console.log('');
    process.exit(criticalCount > 0 ? 1 : 0);
  }

  // -------------------------------------------------------------------------
  // Interactive fix phase: offer to fix each fixable issue
  // -------------------------------------------------------------------------
  const fixableIssues = startupIssues.filter(i => i.fixable && i.fix);

  if (!nonInteractive && fixableIssues.length > 0) {
    console.log('');
    console.log('Fixable issues found:');
    console.log('');

    let anyFixed = false;
    for (const issue of fixableIssues) {
      const accepted = await confirmFix(`Fix "${issue.issue}"? (${issue.detail})`);
      if (accepted && issue.fix) {
        issue.fix();
        console.log(`  \u2713 Fixed: ${issue.issue}`);
        anyFixed = true;
      } else {
        console.log(`  \u2014 Skipped: ${issue.issue}`);
      }
    }

    // Offer to auto-fix daemon-related issues
    if (anyFixed && !daemonRunning) {
      console.log('');
      const startDaemon = await confirmFix('Start the daemon now?');
      if (startDaemon) {
        console.log('  Starting daemon...');
        // Import handleDaemon dynamically to avoid circular dependency
        const { handleDaemon } = await import('./daemon.js');
        await handleDaemon('start');
        return;
      }
    }

    // Offer to restart if code hash mismatch
    if (daemonRunning) {
      const hashMismatch = results.find(r => !r.ok && r.name === 'Code hash');
      if (hashMismatch) {
        console.log('');
        const restart = await confirmFix('Restart daemon to pick up code changes?');
        if (restart) {
          const { handleDaemon } = await import('./daemon.js');
          await handleDaemon('restart');
          return;
        }
      }

      // Offer to clean stale services
      const staleServices = results.find(r => !r.ok && r.name === 'Stale services');
      if (staleServices) {
        const clean = await confirmFix('Clean up stale services?');
        if (clean) {
          try {
            await pdFetch(`${PORT_DADDY_URL}/ports/cleanup`, { method: 'POST' });
            console.log('  \u2713 Stale services cleaned');
          } catch {
            console.log('  \u2717 Failed to clean stale services');
          }
        }
      }
    }
  }

  // Repair path for a cancelled/failed setup download of the shared embedding
  // model (ADR-0061): offer the one-time fetch right here instead of leaving
  // hybrid search silently degraded to lexical-only. Interactivity-gated via
  // the canonical tty helpers: a piped `pd doctor` (CI smoke, scripts) must
  // never block on a prompt.
  if (!nonInteractive && !embeddingModelCached && isStdinInteractive() && isStdoutInteractive()) {
    console.log('');
    const download = await confirmFix(
      `Download the local embedding model now? (${DEFAULT_SEMANTIC_MODEL_ID}, ~27 MB, one-time)`,
    );
    if (download) {
      try {
        await prefetchEmbeddingModel();
        console.log('  ✓ Embedding model downloaded to the shared cache');
      } catch (err: unknown) {
        console.log(`  ✗ Download failed: ${(err as Error).message} — retry with: pd embed prefetch`);
      }
    } else {
      console.log('  — Skipped: run `pd embed prefetch` whenever you are ready');
    }
  }

  console.log('');

  // Exit code gates on CRITICAL only — warnings are loud but do not break the
  // build (the three-tier contract).
  if (criticalCount > 0) {
    process.exit(1);
  }
}

/**
 * Handle `pd hints` command
 *
 * Prints context-aware launch hints: salvage queue summary and new-folder nudges.
 * Same data shown in the banner, but available on demand at any time.
 */
export async function handleHints(options: CLIOptions): Promise<void> {
  const cwd = encodeURIComponent(process.cwd());
  const res = await pdFetch(`${PORT_DADDY_URL}/launch-hints?cwd=${cwd}`);
  const data = await res.json() as {
    projectName?: string;
    isNewFolder?: boolean;
    salvage?: { total: number; inProject: number; recent: Array<{ id: string; purpose?: string; identity?: string; minutesAgo?: number }> };
    nudges?: Array<{ type: string; message: string; cmd: string }>;
  };

  if (options.json || options.j) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const { salvage, nudges, isNewFolder, projectName } = data;
  const inProject = salvage?.inProject ?? 0;
  const total = salvage?.total ?? 0;

  if (inProject > 0) {
    const n = inProject;
    console.error(marANSI.fgYellow + `${n} agent${n > 1 ? 's' : ''} from ${projectName || 'this project'} need salvaging` + marANSI.reset);
    for (const a of (salvage?.recent ?? [])) {
      const ago = a.minutesAgo != null ? ` (${a.minutesAgo}m ago)` : '';
      const id = a.identity ? ` [${a.identity}]` : '';
      console.error(marANSI.fgGray + `  ${a.purpose ?? a.id}${id}${ago}` + marANSI.reset);
    }
    console.error(marANSI.fgCyan + `→ pd salvage${projectName ? ` --project ${projectName}` : ''}` + marANSI.reset);
    console.error('');
  } else if (total > 0) {
    console.error(marANSI.fgGray + `${total} agent${total > 1 ? 's' : ''} pending salvage across all projects  (pd salvage)` + marANSI.reset);
    console.error('');
  } else {
    console.error(marANSI.fgGreen + 'No agents pending salvage.' + marANSI.reset);
  }

  if (isNewFolder) {
    console.error(marANSI.fgCyan + 'New folder' + marANSI.reset + marANSI.fgGray + ' — run pd scan to register your services' + marANSI.reset);
    console.error('');
  }

  if (nudges && nudges.length > 0) {
    console.error(marANSI.fgGray + 'Nudges:' + marANSI.reset);
    for (const nudge of nudges) {
      console.error(`  ${marANSI.fgCyan}${nudge.cmd}${marANSI.reset}  ${marANSI.fgGray}${nudge.message}${marANSI.reset}`);
    }
  }
}
