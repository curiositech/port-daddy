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
  // Tunnel
  handleTunnel,
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

// =============================================================================
// Help System: Compact summary + topic-based detailed help
// =============================================================================

/**
 * Read .portdaddy/current.json to detect active session context.
 * Returns null if no active session exists.
 */
function readCurrentSession(): { sessionId: string; agentId?: string; purpose?: string } | null {
  try {
    const currentPath = join(process.cwd(), '.portdaddy', 'current.json');
    if (existsSync(currentPath)) {
      const data = JSON.parse(readFileSync(currentPath, 'utf8'));
      if (data && data.sessionId) return data;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

/**
 * Build the compact main help output (~25 lines).
 * Shows context-aware next steps if an active session exists.
 */
function buildHelp(): string {
  const lines: string[] = [
    'Port Daddy \u2014 Port management & agent coordination',
    '',
  ];

  // 5f: Context-aware help — show active session info if available
  const session = readCurrentSession();
  if (session) {
    lines.push(`Active session: ${session.sessionId}${session.purpose ? ` (purpose: "${session.purpose}")` : ''}`);
    lines.push(`  pd note "progress"     Log what you're doing`);
    lines.push(`  pd done "summary"      End this session`);
    lines.push('');
  }

  lines.push(
    'Quick Start:',
    '  pd begin "purpose"       Start working (registers agent + session)',
    '  pd done "summary"        Finish up (ends session + unregisters)',
    '  pd whoami                Show current context',
    '',
    'Port Management:',
    '  pd claim <id>            Claim a port  (alias: c)',
    '  pd release <id>          Release a port  (alias: r)',
    '  pd find [pattern]        List services  (alias: f, l, ps)',
    '',
    'Sessions & Notes:',
    '  pd session start "why"   Start a session manually',
    '  pd note "message"        Add a note to current session',
    '  pd notes                 View recent notes',
    '',
    'Coordination:',
    '  pd lock <name>           Acquire a distributed lock',
    '  pd agent register        Register as an agent',
    '  pd salvage               Check for dead agents to continue',
    '',
    'More: pd help <topic>',
    'Topics: sessions, locks, agents, ports, messaging, dns, orchestration, sugar, tutorial',
    '',
    'Tip: Run `pd learn` for an interactive tutorial',
  );

  return lines.join('\n');
}

/**
 * Topic-specific detailed help maps.
 * Each topic shows relevant commands with flags and examples.
 */
const TOPIC_HELP: Record<string, string> = {
  sessions: `Sessions & Notes \u2014 Structured multi-agent coordination

Commands:
  session start <purpose>    Start a new session
    --agent <id>             Associate with an agent
    --force                  Force start even if another session is active
    --files <paths...>       Claim files at session start

  session end [note]         End the active session (completed)
  session done [note]        Alias for "session end"
  session abandon [note]     End active session (abandoned)
  session rm <id>            Delete a session and its notes
  session files add <paths>  Claim files in active session
  session files rm <paths>   Release files from active session

  sessions                   List sessions (active only by default)
    --all                    Show all sessions (including completed)
    --status <s>             Filter by status
    --all-worktrees          Show sessions from all worktrees
    -j, --json               Output as JSON

  note <content>             Quick note (auto-creates session if needed)
    --type <type>            Note type: progress, decision, blocker, etc.

  notes [session-id]         View notes for a session or recent across all
    --limit <n>              Limit number of notes
    --type <type>            Filter by note type
    -j, --json               Output as JSON

Examples:
  pd session start "Building auth module" --agent agent-42
  pd note "Finished login endpoint" --type progress
  pd notes --limit 10
  pd session files add src/auth.ts src/login.ts
  pd session end "Auth module complete"
  pd sessions --all --json`,

  locks: `Distributed Locks \u2014 Exclusive access for shared resources

Commands:
  lock <name>              Acquire a distributed lock
    --ttl <ms>             Time-to-live (default: 300000 = 5 min)
    --owner <id>           Lock owner identifier
    --wait                 Block until lock is available
    --timeout <ms>         Wait timeout (default: 60000)

  lock extend <name>       Extend a lock's TTL
    --ttl <ms>             New TTL from now

  unlock <name>            Release a distributed lock
    --force                Release even if not the owner

  locks                    List all active locks
    -j, --json             Output as JSON

Examples:
  pd lock db-migrations && npm run migrate && pd unlock db-migrations
  pd lock deploy --ttl 600000 --owner ci-pipeline
  pd lock extend deploy --ttl 300000
  pd locks --json`,

  agents: `Agent Registry \u2014 Track active agents with heartbeats

Commands:
  agent register           Register as an agent
    --agent <id>           Agent ID (required)
    --identity <id>        Semantic identity (project:stack:context)
    --purpose "text"       What this agent is doing
    --type <type>          Agent type: cli, sdk, mcp

  agent heartbeat          Send heartbeat (keeps agent alive)
    --agent <id>           Agent ID

  agent unregister         Unregister agent (release resources)
    --agent <id>           Agent ID

  agent <id>               Get info about a specific agent

  agents                   List all registered agents
    --active               Show only active agents
    -j, --json             Output as JSON

  salvage                  Check resurrection queue for dead agents
    --project <name>       Filter by project
    --stack <name>         Filter by stack

  salvage claim <id>       Claim a dead agent's work to continue

Examples:
  pd agent register --agent build-42 --identity myapp:api --purpose "Building auth"
  pd agent heartbeat --agent build-42
  pd agents --active --json
  pd salvage --project myapp
  pd salvage claim dead-agent-99`,

  ports: `Port Management \u2014 Claim, release, and query ports

Commands:
  claim <id>               Claim a port for a service
    -p, --port <n>         Request a specific port
    --range <a>-<b>        Acceptable port range
    --expires <dur>        Auto-release after duration (2h, 30m, 1d)
    --export               Print 'export PORT=XXXX' for eval
    -q, --quiet            Just print the port number
    -j, --json             Output as JSON

  release <id>             Release port(s) by identity or pattern
    --expired              Release only expired assignments

  find [pattern]           List services matching pattern
    -j, --json             Output as JSON

  url <id>                 Get URL for a service
  env [pattern]            Export environment variables for matching services
  ports                    List active port assignments
    --system               Include system/well-known ports
  ports cleanup            Release stale port assignments

Identity Format:
  myapp                    Just the project name
  myapp:api                Project + stack
  myapp:api:feature-x      Project + stack + context
  myapp:*:main             Wildcards for querying/releasing

Note: Quote wildcards to prevent shell expansion:
  pd find 'myapp:*'        # Correct
  pd find myapp:*          # May fail in zsh

Examples:
  pd claim myapp                        # Get a port
  pd claim myapp:api --port 3000        # Request specific port
  pd claim myapp --expires 2h           # Auto-release in 2 hours
  eval $(pd claim myapp --export)       # Set PORT env var directly
  pd find 'myapp:*'                     # All stacks for myapp
  pd release 'myapp:*:*'               # Release all for project`,

  messaging: `Pub/Sub Messaging \u2014 Real-time inter-agent communication

Commands:
  pub <channel> <message>  Publish a message to a channel
    --sender <id>          Sender identifier

  sub <channel>            Subscribe to a channel (real-time SSE stream)

  wait <id> [ids...]       Wait for service(s) to become healthy
    --timeout <ms>         Wait timeout (default: 60000)

  channels                 List active pub/sub channels
  channels clear <name>    Clear messages from a channel

Examples:
  pd pub build:done '{"status":"success"}'
  pd sub build:done
  pd wait myapp:api myapp:frontend
  pd channels
  pd channels clear build:done`,

  dns: `DNS Records \u2014 Local service discovery via hostname

Commands:
  dns register             Register a DNS record
    --hostname <name>      Hostname to register
    --port <n>             Port to resolve to
    --service <id>         Associated service identity

  dns lookup <hostname>    Resolve a hostname to port
  dns list                 List all DNS records
  dns cleanup              Clean stale DNS records
  dns status               DNS system status

Examples:
  pd dns register --hostname api.local --port 3000 --service myapp:api
  pd dns lookup api.local`,

  orchestration: `Service Orchestration \u2014 Start/stop multi-service stacks

Commands:
  up                       Start all services (auto-detect or from .portdaddyrc)
    --service <name>       Start only this service + its dependencies
    --no-health            Skip health checks after starting
    --branch               Use git branch as context in identity

  down                     Stop all services started by 'up'

  scan [dir]               Deep scan project, detect all services
    --dry-run              Preview without saving config
    --dir <path>           Target directory
    --branch               Use git branch as context

  projects                 List all registered projects
  projects rm <id>         Remove a registered project

  health [id]              Check service health (all or by ID)

Examples:
  pd up                              # Auto-detect and start everything
  pd up --service frontend           # Start frontend + dependencies
  pd up --branch                     # Use git branch in identity
  pd down                            # Stop all running services
  pd scan --dry-run                  # Preview project detection
  pd health myapp:api                # Check specific service health`,

  sugar: `Sugar Commands \u2014 Compound operations for common workflows

Sugar commands combine multiple steps into single commands.
They manage agent registration, sessions, and local context together.

Commands:
  begin "purpose"          Register agent + start session atomically
                           Writes context to .portdaddy/current.json

  done "summary"           End session + unregister agent atomically
                           Cleans up .portdaddy/current.json

  whoami                   Show current agent/session context
                           Reads from .portdaddy/current.json

  with-lock <name> <cmd>   Acquire lock, run command, release lock
                           Lock is always released, even on failure

Aliases:
  n <content>              Alias for "note"
  u                        Alias for "up"
  d                        Alias for "down"

Examples:
  pd begin "Building auth module"
  pd note "Login endpoint done"
  pd done "Auth module complete"
  pd whoami
  pd with-lock db-migrations npm run migrate`,

  tutorial: `Interactive Tutorial \u2014 Learn Port Daddy step by step

Commands:
  learn                    Start the interactive tutorial

The tutorial walks you through:
  1. Claiming and releasing ports
  2. Using semantic identities
  3. Starting sessions and leaving notes
  4. Multi-agent coordination with locks
  5. Service orchestration with up/down
  6. Agent resurrection and salvage

Run: pd learn`,
};

// HELP is built lazily via getHelp() for context-aware output

// =============================================================================
// Command Suggestion (fuzzy "did you mean?")
// =============================================================================

const ALL_COMMANDS: string[] = [
  'claim', 'c', 'release', 'r', 'find', 'f', 'list', 'l', 'ps', 'url', 'env',
  'pub', 'publish', 'sub', 'subscribe', 'wait', 'lock', 'unlock', 'locks',
  'up', 'down', 'scan', 's', 'projects', 'p',
  'agent', 'agents', 'log', 'activity',
  'session', 'sessions', 'note', 'notes',
  'begin', 'done', 'whoami', 'with-lock', 'learn',
  'n', 'u', 'd',
  'dashboard', 'channels', 'webhook', 'webhooks', 'metrics', 'config', 'health', 'ports',
  'start', 'stop', 'restart', 'status', 'install', 'uninstall', 'dev', 'ci-gate',
  'doctor', 'diagnose', 'mcp', 'version', 'help',
  'salvage', 'resurrection', 'changelog', 'tunnel',
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
        // Always show auto-detected identity on stderr (including non-interactive/piped mode)
        if (!options.quiet) console.error(`Auto-detected identity: ${id}`);
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

  if (!command || command === '--help' || command === '-h') {
    // 5d: First-run detection — hint about pd learn if .portdaddy/ doesn't exist
    const portdaddyDir = join(process.cwd(), '.portdaddy');
    if (!existsSync(portdaddyDir)) {
      console.error('First time here? Run `pd learn` for an interactive tutorial.\n');
    }
    console.log(buildHelp());
    process.exit(0);
  }

  // 5c: pd help <topic> — show topic-specific detailed help
  if (command === 'help') {
    const topic = args[1];
    if (!topic) {
      console.log(buildHelp());
      process.exit(0);
    }

    const topicHelp = TOPIC_HELP[topic];
    if (topicHelp) {
      console.log(topicHelp);
      process.exit(0);
    }

    // Unknown topic — show available topics
    const topics = Object.keys(TOPIC_HELP).join(', ');
    console.error(`Unknown help topic: ${topic}`);
    console.error(`Available topics: ${topics}`);
    process.exit(1);
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

      // Tunnel
      case 'tunnel':
        await handleTunnel(positional[0], positional.slice(1), options);
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

      case 'mcp': {
        // Launch MCP server (stdio transport for Claude Code / Desktop)
        const { spawn } = await import('node:child_process');
        const mcpPath = new URL('../mcp/server.ts', import.meta.url).pathname;
        const child = spawn('npx', ['tsx', mcpPath], {
          stdio: 'inherit',
          env: { ...process.env, PORT_DADDY_URL: `http://localhost:${options.port || '9876'}` },
        });
        child.on('exit', (code) => process.exit(code ?? 0));
        // Keep parent alive until MCP server exits
        await new Promise(() => {});
        break;
      }

      default: {
        // Check for misspelled commands first
        const suggestion = suggestCommand(command);
        if (suggestion) {
          console.error(`Unknown command: ${command}`);
          console.error(`  Did you mean: port-daddy ${suggestion}?`);
          console.error('');
          console.error('Run "pd help" for usage or "pd help <topic>" for details');
          console.error('Tip: Run `pd learn` for an interactive tutorial');
          process.exit(1);
        }
        // If it looks like a semantic identity (contains : or is alphanumeric), treat as claim
        if (command.includes(':') || command.match(/^[a-zA-Z][a-zA-Z0-9._-]*$/)) {
          await handleClaim(command, options);
        } else {
          console.error(`Unknown command: ${command}`);
          console.error('Run "pd help" for usage or "pd help <topic>" for details');
          console.error('Tip: Run `pd learn` for an interactive tutorial');
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
