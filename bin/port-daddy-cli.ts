#!/usr/bin/env node

/**
 * Port Daddy CLI
 *
 * The authoritative port management tool for multi-agent development.
 * Grammar: port-daddy <verb> [identity] [--options]
 */

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { readFileSync, readdirSync, writeFileSync as fsWriteFileSync, existsSync, unlinkSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { discoverServices, suggestNames, mergeWithConfig } from '../lib/discover.js';
import type { DiscoveredService } from '../lib/discover.js';
import { loadConfig } from '../lib/config.js';
import type { PortDaddyRcConfig, ServiceConfig } from '../lib/config.js';
import {
  topologicalSort,
  normalizeServiceConfig,
  buildEnvMap,
  createOrchestrator
} from '../lib/orchestrator.js';

// Direct-DB mode: allows Tier 1 commands to work without the daemon
import { initDatabase, isPortAvailable, resolveDbPath } from '../lib/db.js';
import { createServices } from '../lib/services.js';
import { createLocks } from '../lib/locks.js';
import { createSessions } from '../lib/sessions.js';
import { createActivityLog } from '../lib/activity.js';
import { status as maritimeStatus, highlightChannel, flag } from '../lib/maritime.js';

// Command modules (extracted from this file)
import {
  // Services
  handleClaim, handleRelease, handleFind, handleUrl, handleEnv, autoIdentityFromPackageJson,
  // Locks
  handleLock, handleUnlock, handleLocks,
  // Messaging
  handlePub, handleSub, handleChannels, handleWait,
  // Sessions
  handleSession, handleSessions, handleNote, handleNotes,
  // Agents & Resurrection
  handleAgent, handleAgents,
  handleSalvage,
  // Changelog
  handleChangelog,
  // Activity
  handleLog,
  // Webhooks
  handleWebhook,
  // Projects
  handleScan, handleProjects,
  // Orchestration
  handleUp, handleDown,
  // Diagnostics
  handleMetrics, handleConfigCmd, handleHealth, handlePorts, handleDashboard, handleDoctor, handleStatus, handleVersion,
  // Daemon
  handleDaemon, handleDev,
  // DNS
  handleDns,
} from '../cli/commands/index.js';

const __dirname: string = dirname(fileURLToPath(import.meta.url));
const PORT_DADDY_URL: string = process.env.PORT_DADDY_URL || 'http://localhost:9876';

// Default Unix socket path — the primary transport for CLI->daemon communication.
// Falls back to TCP (PORT_DADDY_URL) if socket doesn't exist.
const DEFAULT_SOCK: string = '/tmp/port-daddy.sock';
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;

// =============================================================================
// Direct-DB Mode: Tier 1 commands work without the daemon
// =============================================================================

/**
 * Tier 1 commands can work via direct SQLite access (no daemon needed).
 * Tier 2 commands require the running daemon for real-time features.
 */
const TIER_1_COMMANDS: Set<string> = new Set([
  'claim', 'c',
  'release', 'r',
  'find', 'f', 'list', 'l', 'ps',
  'lock', 'unlock', 'locks',
  'status',
  'ports',               // 'ports cleanup' is Tier 1
  'session', 'sessions',
  'note', 'notes',
]);

const TIER_2_COMMANDS: Set<string> = new Set([
  'pub', 'publish', 'sub', 'subscribe', 'wait',
  'agent', 'agents',
  'up', 'down',
  'channels', 'webhook', 'webhooks',
  'metrics', 'health', 'dashboard',
]);

/**
 * Lazily initialized direct-DB modules.
 * Shared across all direct-mode calls within a single CLI invocation.
 */
let _directDb: ReturnType<typeof initDatabase> | null = null;
let _directServices: ReturnType<typeof createServices> | null = null;
let _directLocks: ReturnType<typeof createLocks> | null = null;
let _directSessions: ReturnType<typeof createSessions> | null = null;

function getDirectDb(): ReturnType<typeof initDatabase> {
  if (!_directDb) {
    _directDb = initDatabase();
  }
  return _directDb;
}

function getDirectServices(): ReturnType<typeof createServices> {
  if (!_directServices) {
    _directServices = createServices(getDirectDb());
  }
  return _directServices;
}

function getDirectLocks(): ReturnType<typeof createLocks> {
  if (!_directLocks) {
    _directLocks = createLocks(getDirectDb());
  }
  return _directLocks;
}

function getDirectSessions(): ReturnType<typeof createSessions> {
  if (!_directSessions) {
    const db = getDirectDb();
    _directSessions = createSessions(db);
    // Wire up activity log for direct mode too
    const activityLog = createActivityLog(db);
    _directSessions.setActivityLog(activityLog);
  }
  return _directSessions;
}

// =============================================================================
// Types
// =============================================================================

interface ConnectionTarget {
  socketPath?: string;
  host?: string;
  port?: number;
}

interface PdFetchResponse {
  ok: boolean;
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  json: () => Promise<Record<string, unknown>>;
  text: () => Promise<string>;
}

interface CLIOptions {
  [key: string]: string | boolean | undefined;
}

// =============================================================================
// Output Helpers (TTY-aware)
// =============================================================================

/** Whether stdout is a terminal (not a pipe or redirect) */
const IS_TTY: boolean = process.stderr.isTTY ?? false;

/** Print a Unicode separator line (only in TTY mode) */
function separator(width: number = 75): void {
  if (IS_TTY) console.error('\u2500'.repeat(width));
}

/** Format a table header (only decorates in TTY mode) */
function tableHeader(...cols: [string, number][]): string {
  return cols.map(([label, width]) => label.padEnd(width)).join('');
}

/** Format relative time from milliseconds (for sessions/notes) */
function relativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// =============================================================================
// Connection & Fetch
// =============================================================================

/**
 * Resolve connection target: Unix socket or TCP.
 */
function resolveTarget(): ConnectionTarget {
  // Explicit TCP URL overrides socket
  if (process.env.PORT_DADDY_URL) {
    const url = new URL(process.env.PORT_DADDY_URL);
    return { host: url.hostname, port: parseInt(url.port, 10) || 9876 };
  }
  // Use socket if it exists
  if (existsSync(SOCK_PATH)) {
    return { socketPath: SOCK_PATH };
  }
  // Fallback to TCP
  return { host: 'localhost', port: 9876 };
}

/**
 * Drop-in replacement for fetch() that routes through Unix socket when available.
 * Returns an object matching the subset of the fetch Response API that the CLI uses:
 *   .ok, .status, .json(), .text(), .headers
 */
function pdFetch(urlOrPath: string, options: { method?: string; headers?: Record<string, string | number>; body?: string | null } = {}): Promise<PdFetchResponse> {
  // Extract just the path from a full URL or use as-is if already a path
  let path: string;
  if (urlOrPath.startsWith('/')) {
    path = urlOrPath;
  } else {
    try { path = new URL(urlOrPath).pathname + (new URL(urlOrPath).search || ''); }
    catch { path = urlOrPath; }
  }

  const target: ConnectionTarget = resolveTarget();
  const { method = 'GET', headers = {}, body = null } = options;

  const reqHeaders: Record<string, string | number> = { ...headers };
  if (body && !reqHeaders['Content-Length']) {
    reqHeaders['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const reqOpts: http.RequestOptions = {
      method,
      path,
      headers: reqHeaders as http.OutgoingHttpHeaders,
      timeout: 10000,
      ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port })
    };

    const req: ClientRequest = http.request(reqOpts, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text: string = Buffer.concat(chunks).toString();
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode,
          headers: res.headers,
          json: async () => JSON.parse(text) as Record<string, unknown>,
          text: async () => text
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });

    if (body) req.write(body);
    req.end();
  });
}

// Calculate local code hash to compare with daemon
function getLocalCodeHash(): string {
  const libDir: string = join(__dirname, '..');
  // Dynamically discover all .ts files in lib/ — must match server.ts logic exactly
  const libDirPath: string = join(libDir, 'lib');
  const libFiles: string[] = existsSync(libDirPath)
    ? readdirSync(libDirPath).filter((f: string) => f.endsWith('.ts')).sort().map((f: string) => `lib/${f}`)
    : [];
  const filesToHash: string[] = ['server.ts', ...libFiles];

  const hash = createHash('sha256');
  for (const file of filesToHash) {
    const filePath: string = join(libDir, file);
    if (existsSync(filePath)) {
      hash.update(readFileSync(filePath));
    }
  }
  return hash.digest('hex').slice(0, 12);
}

// Check if daemon is running stale code
// Returns true if daemon was restarted
async function checkDaemonFreshness(autoRestart: boolean = true): Promise<boolean> {
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
    if (!res.ok) return false;

    const data = await res.json();
    const localHash: string = getLocalCodeHash();

    if (data.codeHash && data.codeHash !== localHash) {
      console.error('');
      console.error('\u26a0\ufe0f  Daemon is running stale code');
      console.error(`   Daemon: ${data.codeHash}  Local: ${localHash}`);

      if (autoRestart) {
        console.error('   Auto-restarting...');
        console.error('');

        // Kill the old daemon
        try {
          process.kill(data.pid as number, 'SIGTERM');
        } catch {}

        // Wait for it to die
        await new Promise<void>(r => setTimeout(r, 500));

        // Start fresh daemon
        const serverScript: string = join(__dirname, '..', 'server.ts');
        const tsxBinPath: string = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
        const child: ChildProcess = spawn(tsxBinPath, [serverScript], {
          stdio: 'ignore',
          detached: true
        });
        child.unref();

        // Wait for it to be ready
        for (let i = 0; i < 30; i++) {
          await new Promise<void>(r => setTimeout(r, 100));
          try {
            const healthRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
            if (healthRes.ok) {
              console.error('   \u2713 Daemon restarted with fresh code');
              console.error('');
              return true;
            }
          } catch {}
        }
        console.error('   \u2717 Failed to restart daemon');
        process.exit(1);
      } else {
        // No auto-restart (CI mode)
        console.error('   Run: port-daddy restart');
        console.error('');
        return false;
      }
    }
  } catch {
    // Daemon not running or can't connect - other code will handle this
  }
  return false;
}

// CI mode: fail hard if daemon is stale
async function ciGateCheck(): Promise<void> {
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
    if (!res.ok) {
      console.error('CI GATE FAILED: Daemon not running');
      process.exit(1);
    }

    const data = await res.json();
    const localHash: string = getLocalCodeHash();

    if (data.codeHash !== localHash) {
      console.error('');
      console.error('\u274c CI GATE FAILED: Daemon is running stale code!');
      console.error(`   Daemon hash: ${data.codeHash}`);
      console.error(`   Local hash:  ${localHash}`);
      console.error('');
      console.error('   The test daemon must match the code being tested.');
      console.error('   Run: port-daddy restart');
      console.error('');
      process.exit(1);
    }

    console.log('\u2713 CI gate passed: daemon code hash matches');
  } catch (err: unknown) {
    console.error('CI GATE FAILED: Cannot connect to daemon');
    process.exit(1);
  }
}

const HELP: string = `
Port Daddy — Semantic Port Management for Multi-Agent Development

Usage: port-daddy <command> [identity] [options]

Orchestration:
  up [options]      Start all services (auto-detect or from .portdaddyrc)
  down              Stop all services started by 'up'

Service Commands:
  claim <id>        Claim a port (alias: c)
  release <id>      Release port(s) by identity/pattern (alias: r)
  find [pattern]    List services (alias: f, l)
  url <id>          Get URL for a service
  env [pattern]     Export environment variables
  ps                Alias for 'find' — list running services

Agent Coordination:
  pub <channel>     Publish a message to a channel
  sub <channel>     Subscribe to a channel (real-time stream)
  wait <id> [ids]   Wait for service(s) to become healthy
  lock <name>       Acquire a distributed lock
  lock extend <n>   Extend a lock's TTL
  unlock <name>     Release a distributed lock
  locks             List all active locks
  channels          List pub/sub channels
  channels clear    Clear messages from a channel

Agent Registry:
  agent register    Register as an agent (enables heartbeat)
  agent heartbeat   Send heartbeat (auto-registered if not exists)
  agent unregister  Unregister agent (release resources)
  agent <id>        Get info about an agent
  agents            List all registered agents

Activity Log:
  log [options]     View recent activity (audit trail)
  log summary       View activity summary by type
  log stats         View activity log statistics

Sessions & Notes:
  session start     Start a new session with purpose and files
  session end       End active session (completed)
  session done      Alias for "session end"
  session abandon   End active session (abandoned)
  session rm <id>   Delete a session
  session files     Manage files in active session (add/rm)
  sessions          List sessions (default: active only)
  note <content>    Quick note (auto-creates session if needed)
  notes [id]        View notes for session or recent across all

Project Setup:
  scan [dir]        Deep scan project, detect all services (alias: s)
  projects          List all registered projects (alias: p)
  projects rm <id>  Remove a registered project

System & Monitoring:
  dashboard         Open the web dashboard in your browser
  webhook <sub>     Manage webhooks (events, test, update, rm, deliveries)
  metrics           Show daemon metrics
  config            Show resolved configuration
  health [id]       Check service health (all or by ID)
  ports             List active port assignments
  ports cleanup     Release stale port assignments

Daemon Management:
  start             Start the Port Daddy daemon
  stop              Stop the daemon
  restart           Restart the daemon
  status            Check if daemon is running
  doctor            Run diagnostic checks on Port Daddy setup
  install           Install as system service (auto-start on login)
  uninstall         Remove system service
  dev               Dev mode: watch files, auto-restart on change
  ci-gate           CI mode: fail if daemon is stale (no auto-restart)

Identity Format:
  myapp                     Just the project name
  myapp:api                 Project + stack (api, frontend, worker)
  myapp:api:feature-x       Project + stack + context (branch, env)
  myapp:*:main              Wildcards for querying/releasing

Options:
  -p, --port <n>      Request a specific port
  --range <a>-<b>     Acceptable port range
  --expires <dur>     Auto-release after duration (2h, 30m, 1d)
  --export            Print 'export PORT=XXXX' for eval (claim)
  -e, --env <name>    Environment: local, tunnel, dev, staging, prod
  -j, --json          Output as JSON
  -q, --quiet         Minimal output (just the value)
  --timeout <ms>      Wait timeout (default: 60000)
  --ttl <ms>          Lock time-to-live (default: 300000)
  --owner <id>        Lock owner identifier
  --agent <id>        Agent ID for registration/heartbeat
  --type <type>       Agent type (cli, sdk, mcp)
  --limit <n>         Limit results (log command)
  --active            Show only active agents
  --from <ts>         Start of time range (log, ISO or epoch)
  --to <ts>           End of time range (log, ISO or epoch)
  --system            Show system/well-known ports (ports command)
  --service <name>    Start only this service + its dependencies (up)
  --no-health         Skip health checks (up)
  --branch            Use git branch as context in identity (up/scan)
  --dry-run           Preview scan results without saving config (scan)
  --dir <path>        Target directory (scan)

Note: Quote wildcards to prevent shell expansion:
  port-daddy find 'myapp:*'      # Correct
  port-daddy find myapp:*        # May fail in zsh

Examples:
  port-daddy claim myapp                    # Get a port for myapp
  port-daddy c myapp                        # Same, using alias
  port-daddy claim                          # Auto-detect from package.json
  port-daddy claim myapp:api:feature-x      # Full semantic identity
  port-daddy claim myapp --port 3000        # Request specific port
  port-daddy claim myapp --expires 2h       # Auto-release in 2 hours
  eval $(port-daddy claim myapp --export)   # Set PORT env var directly

  port-daddy find                           # List all services
  port-daddy find myapp:*                   # All stacks for myapp

  port-daddy release myapp                  # Release by name
  port-daddy release myapp:*:*              # Release all for project

  port-daddy pub build:done '{"status":"success"}'
  port-daddy sub build:done

  # Multi-agent coordination:
  port-daddy wait myapp:api                         # Block until healthy
  port-daddy wait myapp:api myapp:frontend          # Wait for multiple
  port-daddy lock db-migrations && npm run migrate  # Exclusive access
  port-daddy unlock db-migrations                   # Release lock

  # Project setup:
  port-daddy scan                           # Deep scan & auto-configure
  port-daddy scan --dry-run                 # Preview without saving
  port-daddy projects                       # List registered projects

  # Orchestration:
  port-daddy up                             # Auto-detect and start all services
  port-daddy up --service frontend          # Start frontend + its dependencies
  port-daddy up --no-health                 # Skip health checks
  port-daddy up --branch                    # Use git branch in identity
  port-daddy down                           # Stop all running services

  port-daddy status                         # Is daemon running?
  port-daddy install                        # Install as system service
`;

// =============================================================================
// Command Suggestion (fuzzy "did you mean?")
// =============================================================================

const ALL_COMMANDS: string[] = [
  'claim', 'c', 'release', 'r', 'find', 'f', 'list', 'l', 'ps', 'url', 'env',
  'pub', 'publish', 'sub', 'subscribe', 'wait', 'lock', 'unlock', 'locks',
  'up', 'down', 'scan', 's', 'projects', 'p',
  'agent', 'agents', 'log', 'activity',
  'session', 'sessions', 'note', 'notes',
  'dashboard', 'channels', 'webhook', 'webhooks', 'metrics', 'config', 'health', 'ports',
  'start', 'stop', 'restart', 'status', 'install', 'uninstall', 'dev', 'ci-gate',
  'doctor', 'diagnose', 'version', 'help'
];

/** Simple Levenshtein distance for short strings */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Suggest closest command if within edit distance 2 */
function suggestCommand(input: string): string | undefined {
  let best: string | undefined;
  let bestDist = 3; // threshold
  for (const cmd of ALL_COMMANDS) {
    if (cmd.length === 1) continue; // skip single-letter aliases for suggestions
    const d = editDistance(input.toLowerCase(), cmd);
    if (d < bestDist) {
      bestDist = d;
      best = cmd;
    }
  }
  return best;
}

let autoStartAttempted: boolean = false;

// =============================================================================
// Direct-DB Mode — Tier 1 command execution without the daemon
// =============================================================================

/**
 * Execute a Tier 1 command via direct SQLite access.
 * Returns true if the command was handled, false if not applicable.
 */
async function executeDirectMode(
  command: string,
  positional: string[],
  options: CLIOptions
): Promise<boolean> {
  // Only Tier 1 commands are supported
  if (!TIER_1_COMMANDS.has(command)) {
    return false;
  }

  // Tier 2 message (should not reach here, but safety net)
  if (TIER_2_COMMANDS.has(command)) {
    console.error(`"${command}" requires the running daemon.`);
    console.error('Start with: port-daddy start');
    return true;
  }

  if (IS_TTY && !options.direct) {
    console.error('[direct mode] Daemon unreachable — using local database');
  }

  switch (command) {
    case 'c':
    case 'claim': {
      let id: string | undefined = positional[0];
      if (!id) {
        id = autoIdentityFromPackageJson();
        if (!id) {
          console.error('Usage: port-daddy claim <identity> [options]');
          console.error('  Tip: Run from a directory with package.json for auto-detection');
          process.exit(1);
        }
        if (IS_TTY) console.error(`Auto-detected identity: ${id}`);
      }

      const svc = getDirectServices();
      const claimOpts: Record<string, unknown> = {};
      if (options.port) claimOpts.port = parseInt(options.port as string, 10);
      if (options.range) {
        const [min, max] = (options.range as string).split('-').map((n: string) => parseInt(n, 10));
        claimOpts.range = [min, max];
      }
      if (options.expires) claimOpts.expires = options.expires;
      if (options.pair) claimOpts.pair = options.pair;
      if (options.cmd) claimOpts.cmd = options.cmd;

      const result = svc.claim(id, claimOpts as Parameters<typeof svc.claim>[1]);

      if (!result.success) {
        console.error(maritimeStatus('error', result.error || 'Failed to claim port'));
        process.exit(1);
      }

      // In direct mode, verify port is actually free at OS level
      if (!result.existing) {
        const portFree = await isPortAvailable(result.port as number);
        if (!portFree && IS_TTY) {
          console.error(maritimeStatus('warning', `port ${result.port} is assigned but appears in use by another process`));
        }
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (options.export) {
        console.log(`export PORT=${result.port}`);
      } else if (options.quiet) {
        console.log(result.port);
      } else {
        if (IS_TTY) {
          console.error(maritimeStatus('success', `${highlightChannel(result.id as string)} → port ${result.port}`));
          if (result.existing) console.error('  (reused existing)');
        }
        console.log(result.port);
      }
      return true;
    }

    case 'r':
    case 'release': {
      const svc = getDirectServices();

      if (options.expired) {
        const result = svc.release('*', { expired: true });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (options.quiet) {
          console.log(result.released);
        } else {
          console.log(maritimeStatus('success', result.message as string));
        }
        return true;
      }

      const id = positional[0];
      if (!id) {
        console.error('Usage: port-daddy release <identity> [options]');
        console.error('       port-daddy release --expired');
        process.exit(1);
      }

      const result = svc.release(id);
      if (!result.success) {
        console.error(maritimeStatus('error', result.error || 'Failed to release'));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (options.quiet) {
        console.log(result.released);
      } else {
        console.log(maritimeStatus('success', result.message as string));
      }
      return true;
    }

    case 'f':
    case 'l':
    case 'find':
    case 'list':
    case 'ps':
    case 'services': {
      const pattern = positional[0] || '*';
      const svc = getDirectServices();
      const findOpts: Record<string, unknown> = {};
      if (options.status) findOpts.status = options.status;
      if (options.port) findOpts.port = parseInt(options.port as string, 10);

      // services.find() takes (idOrPattern, options), not (options)
      const result = svc.find(pattern, findOpts as Parameters<typeof svc.find>[1]);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return true;
      }

      if (result.count === 0) {
        console.error('No services found');
        if (pattern && !pattern.includes('*')) {
          console.error('');
          console.error(`Hint: To find all services for "${pattern}", try:`);
          console.error(`  port-daddy find '${pattern}:*'`);
        }
        return true;
      }

      console.error('');
      console.error('ID'.padEnd(35) + 'PORT'.padEnd(8) + 'STATUS'.padEnd(12));
      console.error('\u2500'.repeat(55));

      const services = result.services as Array<{ id: string; port: number; status: string }>;
      for (const s of services) {
        console.error(
          s.id.padEnd(35) +
          String(s.port).padEnd(8) +
          s.status.padEnd(12)
        );
      }
      console.error('');
      console.error(`Total: ${result.count} service(s)`);
      return true;
    }

    case 'lock': {
      const name = positional[0];
      const lk = getDirectLocks();

      // Handle 'lock extend'
      if (name === 'extend') {
        const extArgs = process.argv.slice(process.argv.indexOf('extend') + 1);
        let extName: string | undefined;
        let extTtl: string | undefined;
        for (let i = 0; i < extArgs.length; i++) {
          if (extArgs[i] === '--ttl' && extArgs[i + 1]) {
            extTtl = extArgs[++i];
          } else if (!extArgs[i].startsWith('-') && !extName) {
            extName = extArgs[i];
          }
        }
        if (!extName) {
          console.error('Usage: port-daddy lock extend <name> [--ttl <ms>]');
          process.exit(1);
        }

        const result = lk.extend(extName, {
          ttl: extTtl ? parseInt(extTtl, 10) : 300000,
          owner: options.owner as string | undefined,
        });

        if (!result.success) {
          console.error(maritimeStatus('error', result.error || 'Failed to extend lock'));
          process.exit(1);
        }
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!options.quiet) {
          console.log(`Extended lock: ${extName}`);
        }
        return true;
      }

      if (!name) {
        console.error('Usage: port-daddy lock <name> [--ttl <ms>] [--owner <id>]');
        process.exit(1);
      }

      const result = lk.acquire(name, {
        owner: options.owner as string | undefined,
        ttl: options.ttl ? parseInt(options.ttl as string, 10) : 300000,
        pid: process.pid,
      });

      if (!result.success) {
        if (result.error === 'lock is held') {
          console.error(`Lock '${name}' is held by ${result.holder}`);
          if (result.heldSince) console.error(`  Held since: ${new Date(result.heldSince as number).toISOString()}`);
          if (result.expiresAt) {
            const remaining = Math.max(0, (result.expiresAt as number) - Date.now());
            console.error(`  Expires in: ${Math.ceil(remaining / 1000)}s`);
          }
          process.exit(1);
        }
        console.error(maritimeStatus('error', result.error || 'Failed to acquire lock'));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (options.quiet) {
        // Silent success for scripting
      } else {
        console.log(maritimeStatus('success', `Acquired lock: ${name}`));
        if (result.expiresAt) {
          const ttlSeconds = Math.ceil(((result.expiresAt as number) - (result.acquiredAt as number)) / 1000);
          console.log(`  TTL: ${ttlSeconds}s`);
        }
      }
      return true;
    }

    case 'unlock': {
      const name = positional[0];
      if (!name) {
        console.error('Usage: port-daddy unlock <name> [--force]');
        process.exit(1);
      }

      const lk = getDirectLocks();
      const result = lk.release(name, {
        owner: options.owner as string | undefined,
        force: options.force === true,
      });

      if (!result.success) {
        console.error(maritimeStatus('error', result.error || 'Failed to release lock'));
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        if (result.released) {
          console.log(maritimeStatus('success', `Released lock: ${name}`));
        } else {
          console.log(maritimeStatus('warning', `Lock '${name}' was not held`));
        }
      }
      return true;
    }

    case 'locks': {
      const lk = getDirectLocks();
      const result = lk.list();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return true;
      }

      const locks = result.locks as Array<{ name: string; owner: string; acquiredAt: number; expiresAt: number | null }>;
      if (!locks || locks.length === 0) {
        console.log('No active locks');
        return true;
      }

      console.error('');
      console.error('NAME'.padEnd(25) + 'OWNER'.padEnd(20) + 'EXPIRES');
      console.error('\u2500'.repeat(65));
      for (const lock of locks) {
        const expires = lock.expiresAt
          ? new Date(lock.expiresAt).toISOString().slice(11, 19)
          : 'never';
        console.error(
          lock.name.padEnd(25) +
          lock.owner.slice(0, 19).padEnd(20) +
          expires
        );
      }
      console.error('');
      return true;
    }

    case 'status': {
      // In direct mode, we can't check daemon health — just report DB state
      const svc = getDirectServices();
      const result = svc.find('*');
      const pkgPath = join(__dirname, '..', 'package.json');
      const ver = existsSync(pkgPath)
        ? (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version
        : 'unknown';

      console.log('Port Daddy daemon is not running (direct-DB mode)');
      console.log(`  Version: ${ver}`);
      console.log(`  Database: ${resolveDbPath()}`);
      console.log(`  Active ports: ${result.count}`);
      console.log('  Start daemon with: port-daddy start');
      return true;
    }

    case 'ports': {
      const sub = positional[0];
      const svc = getDirectServices();

      if (sub === 'cleanup') {
        const result = svc.cleanup();
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!options.quiet) {
          console.log(`Cleanup complete: ${result.cleaned ?? 0} stale ports released`);
        }
        return true;
      }

      // Default: list active ports
      const findResult = svc.find('*');
      if (options.json) {
        console.log(JSON.stringify(findResult, null, 2));
        return true;
      }

      const ports = findResult.services as Array<{ id: string; port: number; createdAt: number; expiresAt?: number | null }>;
      if (!ports || ports.length === 0) {
        console.log('No active port assignments');
        return true;
      }

      console.log('');
      console.log(tableHeader(['PORT', 10], ['IDENTITY', 35], ['CLAIMED', 22]));
      separator(67);
      for (const p of ports) {
        const claimed = p.createdAt ? new Date(p.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '-';
        console.log(
          String(p.port).padEnd(10) +
          (p.id || '-').slice(0, 34).padEnd(35) +
          claimed.padEnd(22)
        );
      }
      console.log('');
      return true;
    }

    case 'session': {
      const subcommand = positional[0];
      const rest = positional.slice(1);
      const sess = getDirectSessions();

      if (!subcommand) {
        console.error('Usage: port-daddy session <start|end|done|abandon|rm> [args]');
        process.exit(1);
      }

      switch (subcommand) {
        case 'start': {
          const purpose = rest[0];
          if (!purpose) {
            console.error('Usage: port-daddy session start <purpose> [--agent AGENT_ID] [--force]');
            process.exit(1);
          }

          const startOpts: Record<string, unknown> = {};
          if (options.agent) startOpts.agentId = options.agent;
          if (options.force) startOpts.force = true;

          // Collect files
          const files: string[] = [];
          if (typeof options.files === 'string') files.push(options.files);
          for (let i = 1; i < rest.length; i++) {
            if (!rest[i].startsWith('-')) files.push(rest[i]);
          }
          if (files.length > 0) startOpts.files = files;

          const result = sess.start(purpose, startOpts as Parameters<typeof sess.start>[1]);

          if (!(result as Record<string, unknown>).success) {
            console.error((result as Record<string, unknown>).error || 'Failed to start session');
            process.exit(1);
          }

          // sessions.start() returns 'id' not 'sessionId'
          const sessionId = (result as Record<string, unknown>).id;
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else if (options.quiet) {
            console.log(sessionId);
          } else {
            console.log(maritimeStatus('success', `Started session: ${sessionId}`));
            console.log(`  Purpose: ${purpose}`);
            if (files.length > 0) console.log(`  Files claimed: ${files.length}`);
          }
          break;
        }

        case 'end':
        case 'done': {
          const note = rest[0];
          const status = (options.status as string) || 'completed';

          // Find active session
          const listResult = sess.list({ status: 'active', limit: 1 });
          const sessionsList = (listResult as Record<string, unknown>).sessions as Array<{ id: string }>;
          if (!sessionsList || sessionsList.length === 0) {
            console.error(maritimeStatus('error', 'No active session found'));
            process.exit(1);
          }

          const sessionId = sessionsList[0].id;
          const endOpts: Record<string, unknown> = { status };
          if (note) endOpts.note = note;

          const result = sess.end(sessionId, endOpts as Parameters<typeof sess.end>[1]);

          if (!result.success) {
            console.error(maritimeStatus('error', result.error || 'Failed to end session'));
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify({ success: true, id: sessionId, status }, null, 2));
          } else if (!options.quiet) {
            console.log(maritimeStatus('success', `Ended session: ${sessionId}`));
            console.log(`  Status: ${status}`);
          }
          break;
        }

        case 'abandon': {
          const note = rest[0];

          const listResult = sess.list({ status: 'active', limit: 1 });
          const sessionsList = (listResult as Record<string, unknown>).sessions as Array<{ id: string }>;
          if (!sessionsList || sessionsList.length === 0) {
            console.error(maritimeStatus('error', 'No active session found'));
            process.exit(1);
          }

          const sessionId = sessionsList[0].id;
          const result = sess.abandon(sessionId);

          if (!result.success) {
            console.error(maritimeStatus('error', result.error || 'Failed to abandon session'));
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify({ success: true, id: sessionId, status: 'abandoned' }, null, 2));
          } else if (!options.quiet) {
            console.log(maritimeStatus('warning', `Abandoned session: ${sessionId}`));
          }
          break;
        }

        case 'rm': {
          const sessionId = rest[0];
          if (!sessionId) {
            console.error('Usage: port-daddy session rm <id>');
            process.exit(1);
          }

          const result = sess.remove(sessionId);
          if (!result.success) {
            console.error(result.error || 'Failed to delete session');
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify({ success: true, id: sessionId, deleted: true }, null, 2));
          } else if (!options.quiet) {
            console.log(`Deleted session: ${sessionId}`);
          }
          break;
        }

        case 'files': {
          const filesCmd = rest[0];
          if (!filesCmd || !['add', 'rm'].includes(filesCmd)) {
            console.error('Usage: port-daddy session files <add|rm> <paths...>');
            process.exit(1);
          }

          const paths = rest.slice(1);
          if (paths.length === 0) {
            console.error(`Usage: port-daddy session files ${filesCmd} <paths...>`);
            process.exit(1);
          }

          const listResult = sess.list({ status: 'active', limit: 1 });
          const sessionsList = (listResult as Record<string, unknown>).sessions as Array<{ id: string }>;
          if (!sessionsList || sessionsList.length === 0) {
            console.error('No active session found');
            process.exit(1);
          }

          const sessionId = sessionsList[0].id;

          if (filesCmd === 'add') {
            const result = sess.claimFiles(sessionId, paths);
            if (!(result as Record<string, unknown>).success) {
              console.error((result as Record<string, unknown>).error || 'Failed to claim files');
              process.exit(1);
            }
            if (options.json) {
              console.log(JSON.stringify(result, null, 2));
            } else if (!options.quiet) {
              console.log(`Claimed ${paths.length} file(s) in session ${sessionId}`);
            }
          } else {
            const result = sess.releaseFiles(sessionId, paths);
            if (!(result as Record<string, unknown>).success) {
              console.error((result as Record<string, unknown>).error || 'Failed to release files');
              process.exit(1);
            }
            if (options.json) {
              console.log(JSON.stringify(result, null, 2));
            } else if (!options.quiet) {
              console.log(`Released file(s) from session ${sessionId}`);
            }
          }
          break;
        }

        default:
          console.error(`Unknown session command: ${subcommand}`);
          process.exit(1);
      }
      return true;
    }

    case 'sessions': {
      const sess = getDirectSessions();
      const listOpts: Record<string, unknown> = {};

      if (!options.all) {
        listOpts.status = 'active';
      }
      if (options.status) {
        listOpts.status = options.status;
      }
      // Support --all-worktrees or --aw flags
      if (options['all-worktrees'] || options.aw) {
        listOpts.allWorktrees = true;
      }

      const result = sess.list(listOpts as Parameters<typeof sess.list>[0]);
      const data = result as Record<string, unknown>;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return true;
      }

      const count = data.count as number;
      const worktreeId = data.worktreeId as string | undefined;
      if (count === 0) {
        const note = worktreeId ? ` (worktree: ${worktreeId})` : '';
        console.log(`No sessions found${note}`);
        return true;
      }

      // Show worktree context if filtering by worktree
      if (worktreeId && !options['all-worktrees'] && !options.aw) {
        console.log(`Showing sessions for worktree ${worktreeId} (use --all-worktrees for all)`);
      }

      // sessions.list() returns: { id, purpose, status, agentId, worktreeId, createdAt, updatedAt, completedAt, metadata }
      const sessions = data.sessions as Array<{
        id: string; purpose: string; status: string; worktreeId?: string;
        createdAt: number; updatedAt: number; completedAt?: number;
      }>;

      console.log('');
      console.log(tableHeader(
        ['ID', 16], ['PURPOSE', 30], ['STATUS', 10], ['AGE', 10]
      ));
      separator(66);

      for (const s of sessions) {
        const age = relativeTime(Date.now() - s.createdAt);
        console.log(
          s.id.slice(0, 15).padEnd(16) +
          s.purpose.slice(0, 29).padEnd(30) +
          s.status.padEnd(10) +
          age
        );
      }
      console.log('');
      console.log(`Total: ${count} session(s)`);
      return true;
    }

    case 'note': {
      const content = positional[0];
      if (!content) {
        console.error('Usage: port-daddy note <content> [--type TYPE]');
        process.exit(1);
      }

      const sess = getDirectSessions();
      const noteOpts: Record<string, unknown> = {};
      if (options.type) noteOpts.type = options.type;

      const result = sess.quickNote(content, noteOpts as Parameters<typeof sess.quickNote>[1]);
      const data = result as Record<string, unknown>;

      if (!data.success) {
        console.error(data.error || 'Failed to create note');
        process.exit(1);
      }

      if (options.quiet) {
        console.log(data.noteId);
      } else {
        console.log(`Created note: ${data.noteId}`);
        console.log(`  Session: ${data.sessionId}`);
        if (data.sessionCreated) {
          console.log(`  (New session auto-created)`);
        }
      }
      return true;
    }

    case 'notes': {
      const sessionId = positional[0];
      const sess = getDirectSessions();

      // getNotes(sessionId) for specific session, getNotes(null) for recent across all
      const noteOpts: Record<string, unknown> = {};
      if (options.limit) noteOpts.limit = parseInt(options.limit as string, 10);
      if (options.type) noteOpts.type = options.type;

      const result = sess.getNotes(
        sessionId || null,
        noteOpts as Parameters<typeof sess.getNotes>[1]
      );
      const data = result as Record<string, unknown>;

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return true;
      }

      const notes = data.notes as Array<{ id: string; sessionId?: string; content: string; type: string; createdAt: number }>;
      if (!notes || notes.length === 0) {
        console.log('No notes found');
        return true;
      }

      console.log('');
      for (const note of notes) {
        const age = relativeTime(Date.now() - note.createdAt);
        const typeLabel = note.type !== 'general' && note.type !== 'note' ? ` [${note.type}]` : '';
        console.log(`  [${age} ago]${typeLabel} ${note.content}`);
      }
      console.log('');
      console.log(`Total: ${notes.length} note(s)`);
      return true;
    }

    default:
      return false;
  }
}

async function main(): Promise<void> {
  const args: string[] = process.argv.slice(2);
  const command: string | undefined = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  if (command === '--version' || command === '-V') {
    const pkgPath: string = join(__dirname, '..', 'package.json');
    const pkg: { version: string } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    console.log(pkg.version);
    process.exit(0);
  }

  // Check for stale daemon before running commands (skip for daemon management and --direct mode)
  const hasDirectFlag: boolean = args.includes('--direct');
  const skipFreshnessCheck: boolean = hasDirectFlag || ['start', 'stop', 'restart', 'install', 'uninstall', 'status', 'version', 'dev', 'ci-gate', 'doctor', 'diagnose', 'up', 'down', 'dashboard'].includes(command as string);
  if (!skipFreshnessCheck) {
    await checkDaemonFreshness();
  }

  // Parse options
  const options: CLIOptions = {};
  const positional: string[] = [];

  // Short flag mappings
  const shortFlags: Record<string, string> = {
    p: 'port',
    e: 'env',
    j: 'json',
    q: 'quiet',
    h: 'help'
  };

  for (let i = 1; i < args.length; i++) {
    const arg: string = args[i];

    if (arg.startsWith('--')) {
      // Handle --flag=value syntax
      const eqIndex: number = arg.indexOf('=');
      if (eqIndex !== -1) {
        const key: string = arg.slice(2, eqIndex);
        const value: string = arg.slice(eqIndex + 1);
        options[key] = value;
      } else {
        const key: string = arg.slice(2);
        const next: string | undefined = args[i + 1];
        if (next && !next.startsWith('-')) {
          options[key] = next;
          i++;
        } else {
          options[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Handle short flags: -q, -p 3000, -p=3000
      const flagPart: string = arg.slice(1);
      const eqIndex: number = flagPart.indexOf('=');

      if (eqIndex !== -1) {
        // -p=3000 style
        const shortKey: string = flagPart.slice(0, eqIndex);
        const value: string = flagPart.slice(eqIndex + 1);
        const longKey: string = shortFlags[shortKey] || shortKey;
        options[longKey] = value;
      } else if (flagPart.length === 1) {
        // Single short flag: -q, -j, or -p 3000
        const longKey: string = shortFlags[flagPart] || flagPart;
        const next: string | undefined = args[i + 1];
        // Check if this flag expects a value
        const expectsValue: boolean = ['p', 'e'].includes(flagPart);
        if (expectsValue && next && !next.startsWith('-')) {
          options[longKey] = next;
          i++;
        } else {
          options[longKey] = true;
        }
      } else {
        // Multiple short flags combined: -qj (quiet + json)
        for (const char of flagPart) {
          const longKey: string = shortFlags[char] || char;
          options[longKey] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  // --direct flag: skip daemon, go straight to direct-DB mode
  if (options.direct) {
    if (TIER_2_COMMANDS.has(command)) {
      console.error(`"${command}" requires the running daemon. It cannot work in --direct mode.`);
      console.error('Start with: port-daddy start');
      process.exit(1);
    }

    const handled = await executeDirectMode(command, positional, options);
    if (handled) return;

    // Not a Tier 1 command — fall through to normal handling
    // (e.g., daemon management commands like 'start', 'version', etc.)
  }

  try {
    switch (command) {
      // Service commands (single-letter aliases: c, r, f, l)
      case 'c':
      case 'claim':
        await handleClaim(positional[0], options);
        break;

      case 'r':
      case 'release':
        await handleRelease(positional[0], options);
        break;

      case 'f':
      case 'l':
      case 'find':
      case 'list':
      case 'ps':
      case 'services':
        await handleFind(positional[0], options);
        break;

      case 'url':
        await handleUrl(positional[0], options);
        break;

      case 'env':
        await handleEnv(positional[0], options);
        break;

      // Agent coordination
      case 'pub':
      case 'publish':
        await handlePub(positional[0], positional.slice(1).join(' ') || (options.message as string | undefined), options);
        break;

      case 'sub':
      case 'subscribe':
        await handleSub(positional[0], options);
        break;

      case 'wait':
        await handleWait(positional, options);
        break;

      case 'lock':
        await handleLock(positional[0], options);
        break;

      case 'unlock':
        await handleUnlock(positional[0], options);
        break;

      case 'locks':
        await handleLocks(options);
        break;

      // Orchestration
      case 'up':
        await handleUp(positional, options);
        break;

      case 'down':
        await handleDown(options);
        break;

      // Project setup (single-letter aliases: s, p)
      case 's':
      case 'scan':
        await handleScan(positional[0], options);
        break;

      case 'p':
      case 'projects':
        await handleProjects(positional[0], positional.slice(1), options);
        break;

      // Agent registry
      case 'agent':
        await handleAgent(positional[0], positional.slice(1), options);
        break;

      case 'agents':
        await handleAgents(options);
        break;

      // Self-healing / resurrection
      case 'salvage':
      case 'resurrection':
        await handleSalvage(positional[0], positional.slice(1), options);
        break;

      // Hierarchical changelog
      case 'changelog':
        await handleChangelog(positional[0], positional.slice(1), options);
        break;

      // Activity log
      case 'log':
      case 'activity':
        await handleLog(positional[0], options);
        break;

      // Sessions & Notes
      case 'session':
        await handleSession(positional[0], positional.slice(1), options);
        break;

      case 'sessions':
        await handleSessions(options);
        break;

      case 'note':
        await handleNote(positional[0], options);
        break;

      case 'notes':
        await handleNotes(positional[0], options);
        break;

      // Daemon management
      case 'start':
        await handleDaemon('start');
        break;

      case 'stop':
        await handleDaemon('stop');
        break;

      case 'restart':
        await handleDaemon('restart');
        break;

      case 'status':
        await handleStatus();
        break;

      case 'install':
        await handleDaemon('install');
        break;

      case 'uninstall':
        await handleDaemon('uninstall');
        break;

      case 'dev':
        await handleDev();
        break;

      case 'ci-gate':
        await ciGateCheck();
        break;

      case 'doctor':
      case 'diagnose':
        await handleDoctor();
        break;

      case 'version':
        await handleVersion();
        break;

      // New API-parity commands
      case 'dashboard':
        await handleDashboard();
        break;

      case 'channels':
        await handleChannels(positional[0], positional.slice(1), options);
        break;

      case 'webhook':
      case 'webhooks':
        await handleWebhook(positional[0], positional.slice(1), options);
        break;

      case 'metrics':
        await handleMetrics(options);
        break;

      case 'config':
        await handleConfigCmd(options);
        break;

      case 'health':
        await handleHealth(positional[0], options);
        break;

      case 'ports':
        await handlePorts(positional[0], options);
        break;

      case 'dns':
        await handleDns(positional[0], positional.slice(1), options);
        break;

      default: {
        // Check for misspelled commands first
        const suggestion = suggestCommand(command);
        if (suggestion) {
          console.error(`Unknown command: ${command}`);
          console.error(`  Did you mean: port-daddy ${suggestion}?`);
          console.error('');
          console.error('Run "port-daddy help" for usage');
          process.exit(1);
        }
        // If it looks like a semantic identity (contains : or is alphanumeric), treat as claim
        if (command.includes(':') || command.match(/^[a-zA-Z][a-zA-Z0-9._-]*$/)) {
          await handleClaim(command, options);
        } else {
          console.error(`Unknown command: ${command}`);
          console.error('Run "port-daddy help" for usage');
          process.exit(1);
        }
        break;
      }
    }
  } catch (err: unknown) {
    const error = err as Error & { code?: string; cause?: { code?: string } };
    const errCode = error.code || error.cause?.code;
    if (errCode === 'ECONNREFUSED' || errCode === 'ENOENT') {
      // Daemon unreachable — try direct-DB mode for Tier 1 commands
      if (TIER_1_COMMANDS.has(command)) {
        try {
          const handled = await executeDirectMode(command, positional, options);
          if (handled) return;
        } catch (directErr: unknown) {
          const dError = directErr as Error;
          console.error('Direct-DB mode failed:', dError.message);
          process.exit(1);
        }
      }

      // Tier 2 commands or unhandled — need the daemon
      if (TIER_2_COMMANDS.has(command)) {
        console.error(`"${command}" requires the running daemon.`);
        console.error('Start with: port-daddy start');
        process.exit(1);
      }

      if (!autoStartAttempted) {
        // Auto-start daemon on first use
        autoStartAttempted = true;
        console.error('Port Daddy daemon is not running. Starting it...');
        try {
          await handleDaemon('start');
          console.error('');
          // Retry the original command
          return main();
        } catch {
          console.error('Failed to auto-start daemon.');
          console.error('Start it manually: port-daddy start');
          console.error('Or install as service: port-daddy install');
          process.exit(1);
        }
      } else {
        console.error('Port Daddy daemon is not running.');
        console.error('Start it with: port-daddy start');
        console.error('Or install as service: port-daddy install');
        process.exit(1);
      }
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

main();
