/**
 * CLI Diagnostics Commands
 *
 * Handles: metrics, config, health, ports, dashboard, doctor, status, version commands
 */

import { join } from 'node:path';
import { existsSync, readFileSync, accessSync, constants } from 'node:fs';
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
import { resolveDbPath } from '../../lib/db.js';
import { pdFetch, PORT_DADDY_URL, SOCK_PATH, getDaemonUrl } from '../utils/fetch.js';
import { CLIOptions, isJson } from '../types.js';
import { separator, tableHeader } from '../utils/output.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { diagnoseStartupBlockers, confirmFix, detectHostileEnvLocal } from '../utils/startup-doctor.js';
import { CANONICAL_TCP_PORT } from '../../shared/daemon-discovery.js';
import { calculateRuntimeCodeHash } from '../../shared/code-hash.js';
import {
  daemonBinaryPath,
  isBunVirtualPath,
  resolveDistributionRoot,
} from '../../shared/daemon-binary.js';
import * as ui from '../utils/ui.js';

// __dirname equivalent for ESM
const __dirname = new URL('.', import.meta.url).pathname.replace(/\/$/, '');

interface StatusCommandResponse {
  version?: string;
  pid?: number;
  uptimeSeconds?: number;
  uptimeHuman?: string;
  active_ports?: number;
  daemon?: {
    version?: string;
    codeHash?: string;
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
 * Default: launches the Ink terminal UI dashboard
 * --web: opens the browser-based dashboard instead
 */
export async function handleDashboard(opts: { web?: boolean } = {}): Promise<void> {
  const daemonUrl = getDaemonUrl();
  const dashUrl = daemonUrl;

  if (opts.web) {
    console.log(`Opening dashboard: ${dashUrl}`);
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(openCmd, [dashUrl], { detached: true, stdio: 'ignore' }).unref();
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
export async function handleStatus(): Promise<void> {
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/status`);
    const data = await res.json() as StatusCommandResponse;

    console.log(`Port Daddy is running`);
    const buildVersion = data.daemon?.version || data.version;
    const buildHash = data.daemon?.codeHash ? ` (${data.daemon.codeHash})` : '';
    console.log(`  Version: ${buildVersion}${buildHash}`);
    console.log(`  PID: ${data.pid}`);
    console.log(`  Uptime: ${data.uptimeHuman || `${Math.floor((data.uptimeSeconds as number) / 60)}m ${(data.uptimeSeconds as number) % 60}s`}`);
    console.log(`  Active ports: ${data.metrics?.activePorts ?? data.active_ports ?? 0}`);

    if (data.runtime?.state) {
      const runtimeState = data.runtime.degraded ? `${data.runtime.state} (degraded)` : data.runtime.state;
      console.log(`  Runtime: ${runtimeState}`);
    }

    if (data.fleet) {
      const projectCount = Array.isArray(data.fleet.projects) ? data.fleet.projects.length : 0;
      const totalAgents = data.fleet.totalAgents ?? 0;
      const launchable = data.fleet.totalLaunchableAgents ?? data.fleet.launchableAgents;
      const launchSuffix =
        typeof launchable === 'number' && totalAgents > 0
          ? `, ${launchable}/${totalAgents} launchable`
          : '';
      console.log(`  Fleet: ${projectCount} project(s), ${totalAgents} agent(s)${launchSuffix}`);
      if (typeof launchable === 'number' && launchable === 0 && totalAgents > 0) {
        console.log(`    ⚠ no launchable backend — fleet will arm but every spawn is policy-blocked`);
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
      console.log(`  Bosun: ${normalizedState}${reason}`);
    }

    if (data.history?.lastActivityAt) {
      const ageMs = Date.now() - Number(data.history.lastActivityAt);
      const ageSeconds = Math.max(0, Math.floor(ageMs / 1000));
      console.log(`  Last activity: ${ageSeconds}s ago`);
    }
  } catch {
    console.log('Port Daddy is not running');
    console.log('  Start with: port-daddy start');
    console.log('  Or install: port-daddy install');
    console.log('  Diagnose:   port-daddy doctor');
    process.exit(1);
  }
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
      : process.env.PORT_DADDY_PACKAGE_VERSION || 'unknown';
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

export async function handleDoctor(): Promise<void> {
  interface CheckResult {
    ok: boolean;
    name: string;
    detail: string;
    hint?: string;
    critical?: boolean;
  }

  const results: CheckResult[] = [];
  let passed: number = 0;
  let total: number = 0;
  let hasCriticalFailure: boolean = false;
  const daemonPort = resolveDiagnosticPort();
  const portLabel = `Daemon TCP port (${daemonPort}${daemonPort === CANONICAL_TCP_PORT ? ' preferred' : ''})`;

  const libDir: string = join(__dirname, '..', '..');

  function check(name: string, ok: boolean, detail: string, hint?: string): void {
    total++;
    if (ok) {
      passed++;
      results.push({ ok: true, name, detail });
    } else {
      results.push({ ok: false, name, detail, hint });
    }
  }

  function criticalFail(name: string, detail: string, hint: string): void {
    total++;
    hasCriticalFailure = true;
    results.push({ ok: false, name, detail, hint, critical: true });
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

  // -------------------------------------------------------------------------
  // 4. Network: Can we reach the discovered daemon URL
  // -------------------------------------------------------------------------
  let daemonData: Record<string, unknown> | null = null;
  let daemonRunning: boolean = false;

  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    if (res.ok) {
      daemonData = await res.json();
      daemonRunning = true;
      check('Network', true, `${getDaemonUrl()} is reachable`);
    } else {
      check('Network', false, `${getDaemonUrl()} returned status ${res.status}`, 'Run: port-daddy start');
    }
  } catch {
    check('Network', false, `Cannot connect to ${getDaemonUrl()}`, 'Run: port-daddy start');
  }

  // -------------------------------------------------------------------------
  // 5. Daemon status
  // -------------------------------------------------------------------------
  if (daemonRunning && daemonData) {
    check('Daemon running', true, `PID ${daemonData.pid}, v${daemonData.version}`);
  } else {
    check('Daemon running', false, 'Daemon is not running', 'Run: port-daddy start');
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
  // 8. System service (LaunchAgent on macOS, systemd on Linux)
  // -------------------------------------------------------------------------
  try {
    if (process.platform === 'darwin') {
      const homedir = (await import('node:os')).homedir();
      const plistPath: string = join(homedir, 'Library', 'LaunchAgents', 'com.portdaddy.daemon.plist');

      if (existsSync(plistPath)) {
        const result: SpawnSyncReturns<Buffer> = spawnSync('launchctl', ['list', 'com.portdaddy.daemon'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        if (result.status === 0) {
          check('System service', true, 'LaunchAgent installed and loaded');
        } else {
          check('System service', false,
            'LaunchAgent plist exists but is not loaded',
            'Run: port-daddy install');
        }
      } else {
        // Check for legacy plist
        const legacyPath: string = join(homedir, 'Library', 'LaunchAgents', 'com.erichowens.port-daddy.plist');
        if (existsSync(legacyPath)) {
          check('System service', false,
            'Legacy LaunchAgent found (com.erichowens.port-daddy)',
            'Run: port-daddy install (will upgrade automatically)');
        } else {
          check('System service', false,
            'LaunchAgent not installed',
            'Run: port-daddy install');
        }
      }
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
            try {
              process.kill(svc.pid, 0);
            } catch {
              staleCount++;
            }
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
        let processAlive = false;
        try { process.kill(pid, 0); processAlive = true; } catch { /* not running */ }
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
  } catch {
    check('Stuck lsof processes', true, 'Could not check (skipped)');
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
      'See: completions/port-daddy.zsh');
  } else if (shell.includes('bash')) {
    const bashFile: string = join(completionsDir, 'port-daddy.bash');
    check('Shell completions', existsSync(bashFile),
      existsSync(bashFile) ? 'Bash completions file found' : 'Bash completions file missing',
      'See: completions/port-daddy.bash');
  } else if (shell.includes('fish')) {
    const fishFile: string = join(completionsDir, 'port-daddy.fish');
    check('Shell completions', existsSync(fishFile),
      existsSync(fishFile) ? 'Fish completions file found' : 'Fish completions file missing',
      'See: completions/port-daddy.fish');
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
    check('Shell-idiom .env.local', true, `Could not check (skipped): ${(err as Error).message}`);
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
      // Binary missing without an override — typical fresh dev clone.
      // Not a failure; it just means the developer hasn't built yet.
      check(
        'Resource directory',
        true,
        `${lines.join('; ')} (binary not built — run npm run build:daemon:dist when you need it)`,
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
  // Output
  // -------------------------------------------------------------------------
  console.log('');
  console.log('Port Daddy Doctor');
  console.log('\u2501'.repeat(50));

  for (const r of results) {
    if (r.ok) {
      console.log(`\u2713 ${r.name}: ${r.detail}`);
    } else {
      console.log(`\u2717 ${r.name}: ${r.detail}`);
      if (r.hint) {
        console.log(`  \u2192 ${r.hint}`);
      }
    }
  }

  console.log('\u2501'.repeat(50));
  console.log(`${passed}/${total} checks passed`);

  // -------------------------------------------------------------------------
  // Interactive fix phase: offer to fix each fixable issue
  // -------------------------------------------------------------------------
  const fixableIssues = startupIssues.filter(i => i.fixable && i.fix);
  const fixableChecks = results.filter(r => !r.ok && r.hint);

  if (fixableIssues.length > 0) {
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

  console.log('');

  if (hasCriticalFailure) {
    process.exit(1);
  }
  if (passed < total) {
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
