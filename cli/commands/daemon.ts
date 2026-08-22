/**
 * CLI Daemon Commands
 *
 * Handles: start, stop, restart, install, uninstall, dev commands
 */

import { join } from 'node:path';
import { closeSync, existsSync, openSync, readFileSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import { pdFetch, PORT_DADDY_URL, getDaemonUrl } from '../utils/fetch.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { printBanner, printCompactHeader, printFarewell, WHEEL, ANCHOR, ANSI } from '../../lib/banner.js';
import { autoFixStartupBlockers, diagnoseStartupBlockers } from '../utils/startup-doctor.js';
import { DEFAULT_DAEMON_PORT, LOOPBACK_TCP_HOST, readDaemonPort } from '../../shared/daemon-discovery.js';
import {
  resolveDaemonLaunchCommand,
  isBunCompiledRuntime,
  mergeJscSafeModeEnv,
  type DaemonLaunchCommand,
} from '../../shared/daemon-binary.js';
import { calculateRuntimeCodeHash, listRuntimeSourceFiles } from '../../shared/code-hash.js';
import {
  buildDaemonProfileEnv,
  ensureDaemonProfileDir,
  isProcessRunning,
  listDaemonProfiles,
  readDaemonProfileState,
  readNumberFile,
  resolveDaemonProfile,
  writeDaemonProfileState,
  type DaemonProfilePaths,
  type DaemonProfileState,
} from '../../lib/daemon-profiles.js';
import * as ui from '../utils/ui.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import { posixShellQuote } from '../../lib/shell-quote.js';
import {
  collectRuntimeIdentity,
  inspectCanonicalLaunchdSupervisor,
  probeCanonicalHealth,
  runCanonicalLaunchdAction,
  waitForCanonicalRuntime,
  type LaunchdSupervisorSnapshot,
  type RuntimeIdentityAssessment,
} from '../../lib/daemon-runtime.js';

// __dirname equivalent for ESM
const __dirname = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const STARTUP_HEALTH_TIMEOUT_MS = 10000;

/**
 * Detect whether we're running inside a `bun build --compile` binary.
 * Thin runtime-state collector; the actual decision logic lives in
 * `shared/daemon-binary.ts::isBunCompiledRuntime` so it's unit-testable.
 */
function isBunCompiledBinary(): boolean {
  return isBunCompiledRuntime({
    versionsBun: process.versions.bun,
    importMetaUrl: import.meta.url,
    errorStack: new Error().stack ?? '',
    execPath: process.execPath,
  });
}

/**
 * Run the daemon entrypoint in-process. The dynamic import has the side
 * effect of executing server.ts's top-level body, which binds the Unix
 * socket and TCP listener and starts servicing requests on this process's
 * event loop. Returns a promise that never resolves so the process stays
 * alive under launchd/brew-services KeepAlive.
 *
 * The literal-string specifier is required for bun's `--compile` static
 * analyzer to bundle server.ts (and its transitive imports) into the binary.
 */
export async function runDaemonInProcess(): Promise<never> {
  await import('../../server.js');
  return new Promise<never>(() => {});
}

const SHUTDOWN_TIMEOUT_MS = 5000;
const PROFILE_STARTUP_TIMEOUT_MS = 30000;

interface DaemonCommandOptions {
  [key: string]: unknown;
  json?: boolean;
  quiet?: boolean;
  profile?: string;
  port?: string | number | boolean;
  fleet?: boolean;
  fleetbar?: boolean;
  force?: boolean;
}

interface SocketJsonResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | string | null;
}

async function waitForDaemonHealthy(timeoutMs: number = STARTUP_HEALTH_TIMEOUT_MS): Promise<unknown | null> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / 100));
  for (let i = 0; i < attempts; i++) {
    await new Promise<void>(r => setTimeout(r, 100));
    try {
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
      if (res.ok) {
        return await res.json();
      }
    } catch {}
  }
  return null;
}

async function waitForProcessExit(pid: number, timeoutMs: number = SHUTDOWN_TIMEOUT_MS): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / 100));
  for (let i = 0; i < attempts; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise<void>(r => setTimeout(r, 100));
  }
  return false;
}

function parseProfilePort(raw: string | number | boolean | undefined, fallback: number | null = null): number | null {
  if (raw === undefined || raw === false || raw === true) return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error(`Invalid daemon profile port: ${raw}`);
  }
  return parsed;
}

function getRequestedProfile(action: string, positional: string[], options: DaemonCommandOptions): string {
  const profile = options.profile || positional[1];
  if (typeof profile === 'string' && profile.trim()) return profile;
  throw new Error(`Usage: pd daemon ${action} <profile>`);
}

function requestJsonViaSocket(sockPath: string, path: string, timeout = 1500): Promise<SocketJsonResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: SocketJsonResponse | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = http.request({
      socketPath: sockPath,
      path,
      method: 'GET',
      timeout,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let data: SocketJsonResponse['data'] = text;
        try {
          data = text ? JSON.parse(text) as Record<string, unknown> : null;
        } catch {
          data = text;
        }
        finish({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          data,
        });
      });
    });

    req.on('error', () => finish(null));
    req.on('timeout', () => {
      req.destroy();
      finish(null);
    });
    req.end();
  });
}

async function waitForProfileHealth(profile: DaemonProfilePaths, timeoutMs = PROFILE_STARTUP_TIMEOUT_MS): Promise<SocketJsonResponse | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(profile.sockPath)) {
      const health = await requestJsonViaSocket(profile.sockPath, '/health', 2000);
      if (health?.ok) return health;
    }
    await new Promise<void>(r => setTimeout(r, 150));
  }
  return null;
}

function readProfileRuntimeState(profile: DaemonProfilePaths): DaemonProfileState {
  const saved = readDaemonProfileState(profile);
  return {
    name: profile.name,
    pid: readNumberFile(profile.pidFile) ?? saved?.pid ?? null,
    port: readNumberFile(profile.portFile) ?? saved?.port ?? null,
    preferredPort: saved?.preferredPort ?? null,
    runtimeDir: profile.runtimeDir,
    socketPath: profile.sockPath,
    ipcPath: profile.ipcPath,
    dbPath: profile.dbPath,
    startedAt: saved?.startedAt ?? null,
    cwd: saved?.cwd ?? null,
    fleetEnabled: saved?.fleetEnabled ?? false,
    fleetBarEnabled: saved?.fleetBarEnabled ?? false,
  };
}

function profileUrl(state: Pick<DaemonProfileState, 'port'>): string | null {
  return state.port ? `http://${LOOPBACK_TCP_HOST}:${state.port}` : null;
}

function tailFile(path: string, maxChars = 4000): string {
  try {
    const text = readFileSync(path, 'utf8');
    return text.slice(-maxChars).trim();
  } catch {
    return '';
  }
}

async function describeProfile(profile: DaemonProfilePaths): Promise<DaemonProfileState & { running: boolean; healthy: boolean }> {
  const state = readProfileRuntimeState(profile);
  const health = existsSync(profile.sockPath)
    ? await requestJsonViaSocket(profile.sockPath, '/health')
    : null;
  const healthData = health?.data && typeof health.data === 'object' ? health.data as Record<string, unknown> : {};
  const pid = typeof healthData.pid === 'number' ? healthData.pid : state.pid;
  const port = readNumberFile(profile.portFile) ?? state.port;
  return {
    ...state,
    pid,
    port,
    running: Boolean(health?.ok) || isProcessRunning(pid),
    healthy: Boolean(health?.ok),
  };
}

function printProfileState(state: DaemonProfileState & { running: boolean; healthy: boolean }): void {
  const url = profileUrl(state);
  const status = state.healthy ? 'healthy' : state.running ? 'running-unhealthy' : 'stopped';
  console.log(`${state.name}: ${status}`);
  console.log(`  PID: ${state.pid ?? '-'}`);
  console.log(`  Port: ${state.port ?? '-'}`);
  console.log(`  URL: ${url ?? '-'}`);
  console.log(`  Runtime: ${state.runtimeDir}`);
  console.log(`  Socket: ${state.socketPath}`);
  console.log(`  DB: ${state.dbPath}`);
  console.log(`  Log: ${join(state.runtimeDir, 'daemon.log')}`);
  console.log(`  Fleet: ${state.fleetEnabled ? 'enabled' : 'disabled'}`);
}

function getLocalCodeHash(): string {
  return calculateRuntimeCodeHash(join(__dirname, '..', '..'));
}

function isCanonicalDaemonTarget(): boolean {
  return !process.env.PORT_DADDY_URL && !process.env.PORT_DADDY_SOCK && !process.env.PORT_DADDY_PORT_FILE;
}

function canonicalSupervisor(): LaunchdSupervisorSnapshot | null {
  if (!isCanonicalDaemonTarget()) return null;
  return inspectCanonicalLaunchdSupervisor();
}

function printRuntimeIdentity(assessment: RuntimeIdentityAssessment): void {
  const facts = assessment.facts;
  console.log(`  ${ANSI.fgGray}Supervisor:${ANSI.reset} launchd ${facts.supervisor?.label ?? 'not applicable'} (PID ${facts.supervisor?.pid ?? '-'})`);
  console.log(`  ${ANSI.fgGray}Generation:${ANSI.reset} PID ${facts.healthPid ?? '-'} · heartbeat ${facts.heartbeatPid ?? '-'} · pid file ${facts.pidFilePid ?? '-'}`);
  console.log(`  ${ANSI.fgGray}Control:${ANSI.reset}    http://${LOOPBACK_TCP_HOST}:${facts.expectedPort} · port file ${facts.portFilePort ?? '-'}`);
}

async function terminateVerifiedDaemonPid(pid: number | null): Promise<void> {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  let exited = await waitForProcessExit(pid, SHUTDOWN_TIMEOUT_MS);
  if (!exited) {
    ui.warn(`Duplicate daemon PID ${pid} did not exit after SIGTERM; forcing stop`);
    try { process.kill(pid, 'SIGKILL'); } catch {}
    exited = await waitForProcessExit(pid, 2_000);
  }
  if (!exited) throw new Error(`duplicate daemon PID ${pid} did not stop`);
}

async function waitForSupervisedReadiness(previousPid: number | null = null): Promise<RuntimeIdentityAssessment> {
  return waitForCanonicalRuntime({
    previousPid,
    onProgress: (elapsedMs, assessment) => {
      const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
      const phase = assessment.facts.supervisor?.running
        ? assessment.facts.healthPid
          ? assessment.state === 'converged' ? 'stabilizing identity' : 'reconciling runtime identity'
          : 'initializing daemon'
        : 'waiting for launchd process';
      console.log(`  ${WHEEL} ${phase} (${seconds}s) — ${assessment.summary}`);
    },
  });
}

/**
 * Handle the canonical macOS daemon entirely through launchd. Returns false
 * when this is not the Homebrew-managed canonical target, allowing the named
 * berth/Linux fallback paths below to retain their existing behavior.
 */
async function handleCanonicalSupervisedAction(
  action: 'start' | 'stop' | 'restart',
  supervisor: LaunchdSupervisorSnapshot,
): Promise<boolean> {
  const health = await probeCanonicalHealth();
  const current = collectRuntimeIdentity(health, {
    endpointPort: health ? DEFAULT_DAEMON_PORT : null,
    supervisor,
  });
  const healthPid = current.facts.healthPid;
  const supervisorPid = supervisor.pid;
  const splitBrain = healthPid !== null && supervisorPid !== null && healthPid !== supervisorPid;

  // A canonical macOS daemon without its launchd job has no safe start path.
  // Falling through to the legacy detached spawner would immediately recreate
  // the two-supervisor split brain this command exists to prevent.
  if (!supervisor.installed) {
    if (action === 'stop') {
      await terminateVerifiedDaemonPid(healthPid);
      printFarewell();
      ui.success(healthPid
        ? `Stopped unsupervised Port Daddy PID ${healthPid}; no launchd job was installed`
        : 'Daemon is already stopped; no launchd job is installed');
      return true;
    }
    ui.error(`Canonical launchd job is not installed at ${supervisor.plistPath}`);
    console.log(`  ${ANSI.fgGray}Repair:${ANSI.reset} port-daddy install`);
    console.log(`  ${ANSI.fgGray}Safety:${ANSI.reset} refusing to create a detached canonical daemon`);
    process.exit(1);
  }

  if (action === 'start' && current.state === 'converged') {
    ui.info(`Port Daddy already running under launchd (PID ${healthPid})`);
    printRuntimeIdentity(current);
    return true;
  }

  if (action === 'stop') {
    const stopResult = runCanonicalLaunchdAction('stop', supervisor);
    if (stopResult.status !== 0) {
      ui.error(`launchd could not stop ${supervisor.label}: ${stopResult.stderr.trim() || `exit ${stopResult.status}`}`);
      process.exit(1);
    }
    // If /health belonged to a detached sibling, bootout cannot stop it. It is
    // safe to terminate because the canonical /health response identified it
    // as Port Daddy and launchd has already been stood down.
    if (splitBrain || (!supervisor.loaded && healthPid !== null)) {
      await terminateVerifiedDaemonPid(healthPid);
    } else if (supervisorPid) {
      await waitForProcessExit(supervisorPid, SHUTDOWN_TIMEOUT_MS);
    }
    printFarewell();
    ui.success('Daemon stopped; launchd is unloaded and no detached replacement was spawned');
    return true;
  }

  // A split brain cannot be repaired by kickstart alone: launchd would replace
  // only its own child while the detached listener kept the canonical port.
  // Stand down the supervisor, terminate the verified sibling, then bootstrap
  // exactly one generation.
  let launchResult;
  let previousPid = action === 'restart' ? healthPid ?? supervisorPid : null;
  if (splitBrain || (!supervisor.loaded && healthPid !== null)) {
    ui.warn(`Collapsing daemon split brain: launchd PID ${supervisorPid ?? '-'}, listener PID ${healthPid ?? '-'}`);
    if (supervisor.loaded) {
      const stopResult = runCanonicalLaunchdAction('stop', supervisor);
      if (stopResult.status !== 0) {
        ui.error(`launchd could not stand down ${supervisor.label}: ${stopResult.stderr.trim() || `exit ${stopResult.status}`}`);
        process.exit(1);
      }
      if (supervisorPid) await waitForProcessExit(supervisorPid, SHUTDOWN_TIMEOUT_MS);
    }
    await terminateVerifiedDaemonPid(healthPid);
    const unloaded = inspectCanonicalLaunchdSupervisor() ?? { ...supervisor, loaded: false, running: false, pid: null };
    launchResult = runCanonicalLaunchdAction('start', unloaded);
  } else if (action === 'start' && supervisor.running && !health) {
    // A launchd child can spend close to a minute loading the compiled Bun
    // runtime. Wait for that already-owned generation instead of creating a
    // second child after the old 10-second timeout.
    const pending = await waitForSupervisedReadiness(null);
    if (pending.state === 'converged') {
      ui.success(`Daemon ready under launchd (PID ${pending.facts.healthPid})`);
      printRuntimeIdentity(pending);
      return true;
    }
    ui.warn('Existing launchd generation did not become ready within 120s; replacing it once through launchd');
    previousPid = supervisorPid;
    launchResult = runCanonicalLaunchdAction('restart', supervisor);
  } else if (action === 'start' && supervisor.running) {
    // The job is alive but its identity facts disagree. Replace that launchd
    // generation once; a plain kickstart would be a no-op for a running job.
    previousPid = healthPid ?? supervisorPid;
    launchResult = runCanonicalLaunchdAction('restart', supervisor);
  } else {
    launchResult = runCanonicalLaunchdAction(action === 'restart' ? 'restart' : 'start', supervisor);
  }

  if (launchResult.status !== 0) {
    ui.error(`launchd ${action} failed for ${supervisor.label}: ${launchResult.stderr.trim() || `exit ${launchResult.status}`}`);
    process.exit(1);
  }

  printBanner();
  console.log(`  ${WHEEL} launchd accepted ${action}; waiting for one verified generation...`);
  const ready = await waitForSupervisedReadiness(previousPid);
  if (ready.state !== 'converged') {
    ui.error(`Daemon did not converge within 120s: ${ready.summary}`);
    printRuntimeIdentity(ready);
    console.log(`  ${ANSI.fgGray}Inspect:${ANSI.reset} port-daddy doctor --json`);
    process.exit(1);
  }
  ui.success(`Daemon ready under launchd (PID ${ready.facts.healthPid})`);
  printRuntimeIdentity(ready);
  console.log(`  ${ANSI.fgGray}Dashboard:${ANSI.reset} http://${LOOPBACK_TCP_HOST}:${DEFAULT_DAEMON_PORT}`);
  return true;
}

function daemonLaunchCommand(libDir: string): DaemonLaunchCommand {
  try {
    return resolveDaemonLaunchCommand(libDir);
  } catch (err) {
    ui.error((err as Error).message);
    process.exit(1);
  }
}

function spawnDaemon(command: DaemonLaunchCommand, options: Parameters<typeof spawn>[2] = {}): ChildProcess {
  return spawn(command.program, command.args, {
    ...options,
    env: mergeJscSafeModeEnv(
      process.env,
      command.env,
      options.env as NodeJS.ProcessEnv | undefined,
    ),
  });
}

export async function handleDaemonCommand(positional: string[], options: DaemonCommandOptions = {}): Promise<void> {
  const action = positional[0] || 'list';
  const libDir: string = join(__dirname, '..', '..');

  switch (action) {
    case 'list':
    case 'ls': {
      const profiles = listDaemonProfiles();
      const rows = await Promise.all(profiles.map((profile) => describeProfile(profile)));
      if (options.json) {
        console.log(JSON.stringify({ profiles: rows }, null, 2));
        return;
      }
      if (rows.length === 0) {
        ui.info('No named daemon profiles yet');
        ui.info('Start one with: pd daemon start dev --port 9877');
        return;
      }
      console.log('');
      for (const row of rows) {
        const status = row.healthy ? 'healthy' : row.running ? 'running-unhealthy' : 'stopped';
        const url = profileUrl(row) ?? '-';
        console.log(`${row.name.padEnd(18)} ${status.padEnd(18)} pid=${String(row.pid ?? '-').padEnd(8)} url=${url}`);
      }
      console.log('');
      return;
    }

    case 'status': {
      if (!positional[1] && !options.profile) {
        await handleDaemonCommand(['list'], options);
        return;
      }
      const profile = resolveDaemonProfile(getRequestedProfile(action, positional, options));
      const state = await describeProfile(profile);
      if (options.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        printProfileState(state);
      }
      return;
    }

    case 'start': {
      const profile = resolveDaemonProfile(getRequestedProfile(action, positional, options));
      ensureDaemonProfileDir(profile);

      const current = await describeProfile(profile);
      if (current.healthy) {
        if (options.json) {
          console.log(JSON.stringify({ success: true, alreadyRunning: true, profile: current }, null, 2));
        } else {
          ui.info(`Daemon profile "${profile.name}" already running (PID ${current.pid})`);
          const url = profileUrl(current);
          if (url) console.log(`  URL: ${url}`);
        }
        return;
      }

      if (current.pid && isProcessRunning(current.pid)) {
        if (!options.force) {
          ui.error(`Profile "${profile.name}" has a live PID ${current.pid} but did not answer health checks.`);
          ui.info(`Retry with: pd daemon start ${profile.name} --force`);
          process.exit(1);
        }
        try {
          process.kill(current.pid, 'SIGTERM');
        } catch {}
        await waitForProcessExit(current.pid, SHUTDOWN_TIMEOUT_MS);
      }

      const preferredPort = parseProfilePort(options.port, current.preferredPort);
      const logFd = openSync(profile.logFile, 'a');
      let child: ChildProcess;
      try {
        child = spawnDaemon(daemonLaunchCommand(libDir), {
          env: buildDaemonProfileEnv(profile, {
            port: preferredPort,
            enableFleet: options.fleet === true,
            enableFleetBar: options.fleetbar === true,
          }),
          stdio: ['ignore', logFd, logFd],
          detached: true,
        });
      } finally {
        closeSync(logFd);
      }
      child.unref();

      const health = await waitForProfileHealth(profile);
      if (!health?.ok) {
        ui.error(`Daemon profile "${profile.name}" failed to become healthy`);
        const logTail = tailFile(profile.logFile);
        if (logTail) {
          console.error(logTail);
        } else {
          ui.info(`No startup log was written at ${profile.logFile}`);
        }
        process.exit(1);
      }

      const healthData = health.data && typeof health.data === 'object' ? health.data as Record<string, unknown> : {};
      const state: DaemonProfileState = {
        name: profile.name,
        pid: typeof healthData.pid === 'number' ? healthData.pid : child.pid ?? null,
        port: readNumberFile(profile.portFile),
        preferredPort,
        runtimeDir: profile.runtimeDir,
        socketPath: profile.sockPath,
        ipcPath: profile.ipcPath,
        dbPath: profile.dbPath,
        startedAt: new Date().toISOString(),
        cwd: process.cwd(),
        fleetEnabled: options.fleet === true,
        fleetBarEnabled: options.fleetbar === true,
      };
      writeDaemonProfileState(profile, state);

      if (options.json) {
        console.log(JSON.stringify({ success: true, profile: state }, null, 2));
      } else {
        ui.success(`Daemon profile "${profile.name}" running (PID ${state.pid})`);
        console.log(`  Runtime: ${state.runtimeDir}`);
        console.log(`  Socket: ${state.socketPath}`);
        console.log(`  Log: ${profile.logFile}`);
        console.log(`  URL: ${profileUrl(state) ?? '-'}`);
        console.log(`  Use: eval "$(pd daemon env ${profile.name})"`);
      }
      return;
    }

    case 'stop': {
      const profile = resolveDaemonProfile(getRequestedProfile(action, positional, options));
      const current = await describeProfile(profile);
      const pid = current.pid;
      if (!pid || !isProcessRunning(pid)) {
        if (options.json) {
          console.log(JSON.stringify({ success: true, alreadyStopped: true, profile: current }, null, 2));
        } else {
          ui.warn(`Daemon profile "${profile.name}" is not running`);
        }
        return;
      }

      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
      let exited = await waitForProcessExit(pid, SHUTDOWN_TIMEOUT_MS);
      if (!exited && options.force) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
        exited = await waitForProcessExit(pid, 2000);
      }
      if (!exited) {
        ui.error(`Daemon profile "${profile.name}" PID ${pid} did not stop cleanly`);
        ui.info(`Retry with: pd daemon stop ${profile.name} --force`);
        process.exit(1);
      }

      const stoppedState: DaemonProfileState = {
        name: current.name,
        pid: null,
        port: current.port,
        preferredPort: current.preferredPort,
        runtimeDir: current.runtimeDir,
        socketPath: current.socketPath,
        ipcPath: current.ipcPath,
        dbPath: current.dbPath,
        startedAt: null,
        cwd: current.cwd,
        fleetEnabled: current.fleetEnabled,
        fleetBarEnabled: current.fleetBarEnabled,
      };
      writeDaemonProfileState(profile, stoppedState);

      if (options.json) {
        console.log(JSON.stringify({ success: true, stoppedPid: pid, profile: profile.name }, null, 2));
      } else {
        ui.success(`Daemon profile "${profile.name}" stopped (was PID ${pid})`);
      }
      return;
    }

    case 'env': {
      const profile = resolveDaemonProfile(getRequestedProfile(action, positional, options));
      console.log(`export PORT_DADDY_PROFILE=${posixShellQuote(profile.name)}`);
      console.log(`export PORT_DADDY_DB=${posixShellQuote(profile.dbPath)}`);
      console.log(`export PORT_DADDY_SOCK=${posixShellQuote(profile.sockPath)}`);
      console.log(`export PORT_DADDY_IPC=${posixShellQuote(profile.ipcPath)}`);
      console.log(`export PORT_DADDY_PID_FILE=${posixShellQuote(profile.pidFile)}`);
      console.log(`export PORT_DADDY_PORT_FILE=${posixShellQuote(profile.portFile)}`);
      console.log(`export PORT_DADDY_HEARTBEAT_FILE=${posixShellQuote(profile.heartbeatFile)}`);
      console.log(`export PORT_DADDY_NO_FLEET=1`);
      console.log(`export PORT_DADDY_NO_FLEETBAR=1`);
      console.log(`unset PORT_DADDY_URL PD_URL PORT_DADDY_PREFIX`);
      return;
    }

    default:
      ui.error(`Unknown daemon command: ${action}`);
      ui.info('Usage: pd daemon <list|status|start|stop|env> [profile]');
      process.exit(1);
  }
}

async function stopRunningCanonicalDaemon(localCodeHash: string, daemonPort: number): Promise<boolean> {
  try {
    const healthRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    if (!healthRes.ok) return false;
    const health = await healthRes.json();
    const pid = typeof health.pid === 'number' ? health.pid : null;

    let remoteCodeHash: string | null = null;
    try {
      const versionRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
      if (versionRes.ok) {
        const version = await versionRes.json();
        remoteCodeHash = typeof version.codeHash === 'string' ? version.codeHash : null;
      }
    } catch {
      // Best-effort only; health result is enough to identify a running daemon.
    }

    if (remoteCodeHash === localCodeHash) {
      return false;
    }

    const daemonDesc = pid ? `PID ${pid}` : 'unknown PID';
    const hashDesc = remoteCodeHash ? `hash ${remoteCodeHash}` : 'unknown hash';
    ui.warn(`Replacing canonical daemon (${daemonDesc}, ${hashDesc}) with local hash ${localCodeHash}`);

    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Fall through to the generic auto-fix path below.
        }
      }
    }

    if (pid) {
      const exited = await waitForProcessExit(pid, SHUTDOWN_TIMEOUT_MS);
      if (!exited) {
        ui.warn(`Canonical daemon PID ${pid} did not exit after SIGTERM; forcing stop`);
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
        await waitForProcessExit(pid, 2000);
      }
    }
    const { fixed } = autoFixStartupBlockers(daemonPort);
    if (fixed) {
      await new Promise<void>(r => setTimeout(r, 1000));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to spawn the daemon and wait for it to become healthy.
 * Returns true if the daemon started successfully, false otherwise.
 *
 * In a bun-compiled binary the source tree (server.ts, node_modules/.bin/tsx)
 * is not on disk, so we cannot spawn tsx. Instead we re-exec the same binary
 * with `start --foreground`, which runs the daemon in-process.
 */
async function attemptDaemonStart(command: DaemonLaunchCommand): Promise<boolean> {
  // Bun-compiled binary short-circuit (v3.14.1 / PR #94, issue #86):
  // a launchctl / brew-services context cannot exec
  // `node_modules/.bin/tsx` because that path doesn't exist inside a
  // `bun build --compile` bundle. The supervisor must keep our PID,
  // so re-exec the same binary with `start --foreground` and let the
  // import side-effect bind the sockets in-process. This wins over
  // whatever `command` says when we know we're already running as
  // the compiled binary.
  let child: ChildProcess;
  if (isBunCompiledBinary()) {
    child = spawn(process.execPath, ['start', '--foreground'], {
      stdio: 'ignore',
      detached: true,
      env: mergeJscSafeModeEnv(process.env),
    });
  } else {
    child = spawnDaemon(command, {
      stdio: 'ignore',
      detached: true,
    });
  }
  child.unref();

  const data = await waitForDaemonHealthy();
  if (data && typeof data === 'object' && data !== null) {
    const daemonUrl = getDaemonUrl();
    ui.success(`Daemon running at ${daemonUrl} (PID ${(data as any).pid})`);
    console.log('');
    console.log(`  ${ANSI.fgGray}Dashboard:${ANSI.reset} ${ANSI.fgCyan}${daemonUrl}${ANSI.reset}`);
    console.log(`  ${ANSI.fgGray}Try:${ANSI.reset}       pd claim myapp -q`);
    console.log('');
    return true;
  }
  return false;
}

/**
 * Handle `pd start|stop|restart|install|uninstall` command
 */
export async function handleDaemon(action: string, options: Record<string, unknown> = {}): Promise<void> {
  const libDir: string = join(__dirname, '..', '..');
  const tsxBin: string = join(libDir, 'node_modules', '.bin', 'tsx');
  const installScript: string = join(libDir, 'install-daemon.ts');

  switch (action) {
    case 'start': {
      const supervisor = canonicalSupervisor();
      if (supervisor && await handleCanonicalSupervisedAction('start', supervisor)) return;

      const localCodeHash = getLocalCodeHash();
      const daemonPort = readDaemonPort();

      // Check if already running
      try {
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
        if (res.ok) {
          if (isCanonicalDaemonTarget()) {
            const replaced = await stopRunningCanonicalDaemon(localCodeHash, daemonPort);
            if (!replaced) {
              const data = await res.json();
              ui.info(`Port Daddy already running (PID ${data.pid})`);
              return;
            }
          } else {
            const data = await res.json();
            ui.info(`Port Daddy already running (PID ${data.pid})`);
            return;
          }
        }
      } catch {}

      printBanner();
      console.log(`  ${WHEEL} Starting daemon...`);

      // Attempt 1: Try to start normally
      const command = daemonLaunchCommand(libDir);
      if (await attemptDaemonStart(command)) return;

      // Attempt 1 failed — diagnose and auto-fix
      console.log(`  ${ANSI.fgYellow}First attempt failed, diagnosing...${ANSI.reset}`);

      const { fixed, issues } = autoFixStartupBlockers(daemonPort);

      if (issues.length === 0) {
        const lateData = await waitForDaemonHealthy(5000);
        if (lateData) {
          const daemonUrl = getDaemonUrl();
          ui.success(`Daemon running at ${daemonUrl} (PID ${(lateData as any).pid})`);
          console.log('');
          console.log(`  ${ANSI.fgGray}Dashboard:${ANSI.reset} ${ANSI.fgCyan}${daemonUrl}${ANSI.reset}`);
          console.log(`  ${ANSI.fgGray}Try:${ANSI.reset}       pd claim myapp -q`);
          console.log('');
          return;
        }

        ui.error('Failed to start daemon (no fixable issues found)');
        console.log(`  ${ANSI.fgGray}Run: pd doctor${ANSI.reset}`);
        process.exit(1);
      }

      // Report what we found and fixed
      for (const issue of issues) {
        if (issue.fixable) {
          console.log(`  ${ANSI.fgYellow}Fixed:${ANSI.reset} ${issue.detail}`);
        } else {
          console.log(`  ${ANSI.fgRed}Blocker:${ANSI.reset} ${issue.detail}`);
        }
      }

      if (!fixed) {
        // Found issues but couldn't fix any of them
        const unfixable = issues.filter(i => !i.fixable);
        if (unfixable.length > 0) {
          ui.error(`Cannot start: ${unfixable[0].detail}`);
        } else {
          ui.error('Failed to start daemon');
        }
        process.exit(1);
      }

      // Give killed processes time to release resources
      await new Promise<void>(r => setTimeout(r, 1500));

      // Attempt 2: Retry after fixes
      console.log(`  ${WHEEL} Retrying...`);

      if (await attemptDaemonStart(command)) return;

      // Still failing — one more diagnostic pass in case socket needs cleanup
      const secondPass = autoFixStartupBlockers(daemonPort);
      if (secondPass.fixed) {
        await new Promise<void>(r => setTimeout(r, 1000));
        console.log(`  ${WHEEL} Final retry...`);
        if (await attemptDaemonStart(command)) return;
      }

      ui.error('Failed to start daemon after auto-fix');
      console.log(`  ${ANSI.fgGray}Run: pd doctor${ANSI.reset}`);
      process.exit(1);
      break;
    }

    case 'stop': {
      const okStop = await requireConfirmation({
        summary: 'Daemon stop will unload the canonical supervisor and stop its verified daemon generation. Every active CLI/MCP/SDK connection drops; sessions remain in the DB but lose their live coordination heartbeat.',
        args: options,
      });
      if (!okStop) process.exit(DESTRUCTIVE_EXIT_CODE);

      const supervisor = canonicalSupervisor();
      if (supervisor && await handleCanonicalSupervisedAction('stop', supervisor)) return;

      try {
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
        const data = await res.json();
        const pid = data.pid as number;
        process.kill(pid, 'SIGTERM');
        let exited = await waitForProcessExit(pid, SHUTDOWN_TIMEOUT_MS);
        if (!exited) {
          ui.warn(`Daemon PID ${pid} did not exit after SIGTERM; forcing stop`);
          process.kill(pid, 'SIGKILL');
          exited = await waitForProcessExit(pid, 2000);
        }
        if (!exited) {
          ui.error(`Daemon PID ${pid} did not stop cleanly`);
          process.exit(1);
        }
        printFarewell();
        ui.success('Daemon stopped');
      } catch {
        ui.warn('Port Daddy is not running');
      }
      break;
    }

    case 'restart': {
      const okRestart = await requireConfirmation({
        summary: 'Daemon restart asks the canonical supervisor for exactly one replacement generation, then verifies launchd PID, health PID, heartbeat, pid file, and port file agree. All live SSE/socket connections drop and reconnect.',
        args: options,
      });
      if (!okRestart) process.exit(DESTRUCTIVE_EXIT_CODE);

      const supervisor = canonicalSupervisor();
      if (supervisor && await handleCanonicalSupervisedAction('restart', supervisor)) return;

      // Already confirmed at this layer — propagate as --yes to avoid a
      // second prompt from the recursive 'stop' call.
      await handleDaemon('stop', { ...options, yes: true });
      await new Promise<void>(r => setTimeout(r, 1000));
      await handleDaemon('start', options);
      break;
    }

    case 'install': {
      if (process.env.PORT_DADDY_CAN_SELF_DAEMON === '1') {
        const { runInstallDaemonCli } = await import('../../install-daemon.js');
        runInstallDaemonCli('install');
      } else {
        const result: SpawnSyncReturns<Buffer> = spawnSync(tsxBin, [installScript, 'install'], { stdio: 'inherit' });
        process.exit(result.status ?? 1);
      }
      break;
    }

    // Wires ONLY the Bosun watchdog (+ freshness) for a Homebrew-managed
    // install — no confirmation prompt, non-destructive, and safe to call
    // at any point in the brew install/upgrade lifecycle (see
    // install-daemon.ts installBosunOnly() for why the ordering hazard that
    // affects the full `install` path doesn't apply here). This is what the
    // Homebrew formula's post_install calls.
    case 'install-bosun': {
      if (process.env.PORT_DADDY_CAN_SELF_DAEMON === '1') {
        const { runInstallDaemonCli } = await import('../../install-daemon.js');
        runInstallDaemonCli('install-bosun');
      } else {
        const result: SpawnSyncReturns<Buffer> = spawnSync(tsxBin, [installScript, 'install-bosun'], { stdio: 'inherit' });
        process.exit(result.status ?? 1);
      }
      break;
    }

    case 'uninstall': {
      const okUn = await requireConfirmation({
        summary: 'Daemon uninstall will remove the launchd / brew-services daemon entry. Port Daddy will no longer auto-start on login until you run pd install again.',
        args: options,
      });
      if (!okUn) process.exit(DESTRUCTIVE_EXIT_CODE);

      if (process.env.PORT_DADDY_CAN_SELF_DAEMON === '1') {
        const { runInstallDaemonCli } = await import('../../install-daemon.js');
        runInstallDaemonCli('uninstall');
      } else {
        const result: SpawnSyncReturns<Buffer> = spawnSync(tsxBin, [installScript, 'uninstall'], { stdio: 'inherit' });
        process.exit(result.status ?? 1);
      }
      break;
    }
  }
}

/**
 * Handle `pd dev` command — development mode with file watching
 */
export async function handleDev(): Promise<void> {
  const libDir: string = join(__dirname, '..', '..');

  const filesToWatch: string[] = listRuntimeSourceFiles(libDir);

  printCompactHeader('DEV MODE');
  console.log(`  ${ANCHOR} Watching source files for changes...`);
  console.log(`  ${ANSI.fgGray}Press Ctrl+C to exit${ANSI.reset}`);
  console.log('');

  // Start daemon first
  await handleDaemon('start');

  let restartTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastHash: string = getLocalCodeHash();

  // Debounced restart
  const scheduleRestart = (): void => {
    if (restartTimeout) clearTimeout(restartTimeout);
    restartTimeout = setTimeout(async () => {
      const newHash: string = getLocalCodeHash();
      if (newHash !== lastHash) {
        lastHash = newHash;
        console.log('');
        console.log(`[${new Date().toLocaleTimeString()}] File changed, restarting daemon...`);

        // Kill current daemon
        try {
          const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
          const data = await res.json();
          process.kill(data.pid as number, 'SIGTERM');
        } catch {}

        await new Promise<void>(r => setTimeout(r, 500));

        // Start new daemon
        const devServerScript: string = join(libDir, 'server.ts');
        const devTsxBin: string = join(libDir, 'node_modules', '.bin', 'tsx');
        const child: ChildProcess = spawn(devTsxBin, [devServerScript], {
          stdio: 'ignore',
          detached: true
        });
        child.unref();

        // Wait for ready
        for (let i = 0; i < 30; i++) {
          await new Promise<void>(r => setTimeout(r, 100));
          try {
            const healthRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
            if (healthRes.ok) {
              console.log(`[${new Date().toLocaleTimeString()}] \u2713 Daemon restarted (hash: ${newHash})`);
              return;
            }
          } catch {}
        }
        console.log(`[${new Date().toLocaleTimeString()}] \u2717 Failed to restart daemon`);
      }
    }, 300); // 300ms debounce
  };

  // Watch each file
  const watchers: FSWatcher[] = [];
  for (const file of filesToWatch) {
    const filePath: string = join(libDir, file);
    if (existsSync(filePath)) {
      try {
        const watcher: FSWatcher = watch(filePath, (eventType: string) => {
          if (eventType === 'change') {
            scheduleRestart();
          }
        });
        watchers.push(watcher);
        console.log(`  Watching: ${file}`);
      } catch (err: unknown) {
        console.error(`  Failed to watch ${file}: ${(err as Error).message}`);
      }
    }
  }

  // Also watch directories for new/deleted files
  for (const dir of ['lib', 'routes', 'shared']) {
    const dirPath: string = join(libDir, dir);
    if (existsSync(dirPath)) {
      try {
        const dirWatcher: FSWatcher = watch(dirPath, (eventType: string, filename: string | null) => {
          if (filename && filename.endsWith('.ts')) {
            scheduleRestart();
          }
        });
        watchers.push(dirWatcher);
        console.log(`  Watching: ${dir}/`);
      } catch {}
    }
  }

  console.log('');
  console.log(`Current hash: ${lastHash}`);
  console.log('');

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\nStopping dev mode...');
    watchers.forEach((w: FSWatcher) => w.close());
    process.exit(0);
  });

  // Keep alive
  await new Promise<void>(() => {});
}
