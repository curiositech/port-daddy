#!/usr/bin/env node

/**
 * Port Daddy v2 CLI
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

const __dirname: string = dirname(fileURLToPath(import.meta.url));
const PORT_DADDY_URL: string = process.env.PORT_DADDY_URL || 'http://localhost:9876';

// Default Unix socket path — the primary transport for CLI->daemon communication.
// Falls back to TCP (PORT_DADDY_URL) if socket doesn't exist.
const DEFAULT_SOCK: string = '/tmp/port-daddy.sock';
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || DEFAULT_SOCK;

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
  // Dynamically discover all .js files in lib/ — must match server.js logic exactly
  const libDirPath: string = join(libDir, 'lib');
  const libFiles: string[] = existsSync(libDirPath)
    ? readdirSync(libDirPath).filter((f: string) => f.endsWith('.js')).sort().map((f: string) => `lib/${f}`)
    : [];
  const filesToHash: string[] = ['server.js', ...libFiles];

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
        const serverScript: string = join(__dirname, '..', 'server.js');
        const child: ChildProcess = spawn('node', [serverScript], {
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
  unlock <name>     Release a distributed lock
  locks             List all active locks

Agent Registry:
  agent register    Register as an agent (enables heartbeat)
  agent heartbeat   Send heartbeat (auto-registered if not exists)
  agent unregister  Unregister agent (release resources)
  agent <id>        Get info about an agent
  agents            List all registered agents

Activity Log:
  log [options]     View recent activity (audit trail)
  log summary       View activity summary by type

Project Setup:
  scan [dir]        Deep scan project, detect all services (alias: s)
  projects          List all registered projects (alias: p)
  projects rm <id>  Remove a registered project
  detect            (deprecated — use scan)
  init              (deprecated — use scan)

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
  --service <name>    Start only this service + its dependencies (up)
  --no-health         Skip health checks (up)
  --branch            Use git branch as context in identity (up/scan)
  --dry-run           Preview scan results without saving config (scan)
  --dir <path>        Target directory (scan, detect, init)

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

let autoStartAttempted: boolean = false;

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

  // Check for stale daemon before running commands (skip for daemon management)
  const skipFreshnessCheck: boolean = ['start', 'stop', 'restart', 'install', 'uninstall', 'status', 'version', 'dev', 'ci-gate', 'doctor', 'diagnose', 'up', 'down'].includes(command as string);
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

      case 'detect':
        console.error('Note: "detect" is deprecated. Use "port-daddy scan" instead.\n');
        await handleDetect(options);
        break;

      case 'init':
        console.error('Note: "init" is deprecated. Use "port-daddy scan" instead.\n');
        await handleInit(options);
        break;

      // Agent registry
      case 'agent':
        await handleAgent(positional[0], positional.slice(1), options);
        break;

      case 'agents':
        await handleAgents(options);
        break;

      // Activity log
      case 'log':
      case 'activity':
        await handleLog(positional[0], options);
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

      default:
        // If it looks like an identity, treat as claim
        if (command.match(/^[a-zA-Z0-9._:-]+$/)) {
          await handleClaim(command, options);
        } else {
          console.error(`Unknown command: ${command}`);
          console.error('Run "port-daddy help" for usage');
          process.exit(1);
        }
    }
  } catch (err: unknown) {
    const error = err as Error & { cause?: { code?: string } };
    if (error.cause?.code === 'ECONNREFUSED') {
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

// =============================================================================
// Auto-Identity
// =============================================================================

/**
 * Walk up from cwd looking for a package.json, extract the project name.
 * Returns a sanitized identity string or undefined if not found.
 */
function autoIdentityFromPackageJson(): string | undefined {
  let dir: string = process.cwd();
  const root: string = dirname(dir) === dir ? dir : '/';

  while (true) {
    const pkgPath: string = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name) {
          // Sanitize: strip @scope/, replace invalid chars with dashes
          const name: string = pkg.name
            .replace(/^@[^/]+\//, '')   // strip npm scope
            .replace(/[^a-zA-Z0-9._:-]/g, '-')
            .replace(/^-+|-+$/g, '');   // trim leading/trailing dashes
          return name || undefined;
        }
      } catch {
        // Invalid JSON, keep walking
      }
    }
    const parent: string = dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return undefined;
}

// =============================================================================
// Service Commands
// =============================================================================

async function handleClaim(id: string | undefined, options: CLIOptions): Promise<void> {
  // Auto-identity: read from nearest package.json if no id given
  if (!id) {
    id = autoIdentityFromPackageJson();
    if (!id) {
      console.error('Usage: port-daddy claim <identity> [options]');
      console.error('  Tip: Run from a directory with package.json for auto-detection');
      process.exit(1);
    }
    if (IS_TTY) console.error(`Auto-detected identity: ${id}`);
  }

  const body: Record<string, unknown> = { id };
  if (options.port) body.port = parseInt(options.port as string, 10);
  if (options.range) {
    const [min, max] = (options.range as string).split('-').map((n: string) => parseInt(n, 10));
    body.range = [min, max];
  }
  if (options.expires) body.expires = options.expires;
  if (options.pair) body.pair = options.pair;
  if (options.cmd) body.cmd = options.cmd;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PID': String(process.pid)
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to claim port');
    process.exit(1);
  }

  if (options.json) {
    // JSON mode: full data to stdout
    console.log(JSON.stringify(data, null, 2));
  } else if (options.export) {
    // Export mode: prints shell export statement for eval
    // Usage: eval $(port-daddy claim myapp --export)
    console.log(`export PORT=${data.port}`);
  } else if (options.quiet) {
    // Quiet mode: just the port to stdout
    console.log(data.port);
  } else {
    // Normal mode: friendly message to stderr, port to stdout
    // This allows: PORT=$(port-daddy claim myapp) to work
    // while still showing the user what happened
    if (IS_TTY) {
      console.error(`${data.id} \u2192 port ${data.port}`);
      if (data.existing) console.error('  (reused existing)');
    }
    console.log(data.port);
  }
}

async function handleRelease(id: string | undefined, options: CLIOptions): Promise<void> {
  const body: Record<string, unknown> = {};

  if (options.expired) {
    body.expired = true;
  } else if (!id) {
    console.error('Usage: port-daddy release <identity> [options]');
    console.error('       port-daddy release --expired');
    process.exit(1);
  } else {
    body.id = id;
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/release`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to release');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (options.quiet || options.q) {
    console.log(data.released);
  } else {
    console.log(data.message);
  }
}

async function handleFind(pattern: string | undefined, options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (pattern) params.append('pattern', pattern);
  if (options.status) params.append('status', options.status as string);
  if (options.port) params.append('port', options.port as string);
  if (options.expired) params.append('expired', 'true');

  const url: string = `${PORT_DADDY_URL}/services${params.toString() ? '?' + params : ''}`;
  const res: PdFetchResponse = await pdFetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to find services');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.error('No services found');

    // Helpful hint about wildcards
    if (pattern && !pattern.includes('*')) {
      console.error('');
      console.error(`Hint: To find all services for "${pattern}", try:`);
      console.error(`  port-daddy find '${pattern}:*'`);
      console.error('');
      console.error('Remember to quote wildcards to prevent shell expansion.');
    }
    return;
  }

  // Table output goes to stderr (human-readable)
  // This keeps stdout clean for piping/scripting
  console.error('');
  console.error('ID'.padEnd(35) + 'PORT'.padEnd(8) + 'STATUS'.padEnd(12) + 'URL');
  console.error('\u2500'.repeat(75));

  const services = data.services as Array<{ id: string; port: number; status: string; urls?: { local?: string } }>;
  for (const svc of services) {
    const localUrl: string = svc.urls?.local || '-';
    console.error(
      svc.id.padEnd(35) +
      String(svc.port).padEnd(8) +
      svc.status.padEnd(12) +
      localUrl
    );
  }

  console.error('');
  console.log(`Total: ${data.count} service(s)`);
}

async function handleUrl(id: string | undefined, options: CLIOptions): Promise<void> {
  if (!id) {
    console.error('Usage: port-daddy url <identity> [--env <environment>]');
    process.exit(1);
  }

  const env: string = (options.env as string) || 'local';
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services/${encodeURIComponent(id)}`);
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Service not found');
    process.exit(1);
  }

  const service = data.service as { urls?: Record<string, string> };
  const url: string | undefined = service.urls?.[env];
  if (!url) {
    console.error(`No ${env} URL for ${id}`);
    process.exit(1);
  }

  if (options.open) {
    const openCmd: string = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(openCmd, [url], { stdio: 'ignore', detached: true }).unref();
    console.log(`Opening ${url}`);
  } else {
    console.log(url);
  }
}

async function handleEnv(id: string | undefined, options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (id) params.append('pattern', id);

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services?${params}`);
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to get services');
    process.exit(1);
  }

  const lines: string[] = [];
  const services = data.services as Array<{ id: string; port: number; urls?: { local?: string } }>;
  for (const svc of services) {
    const varName: string = svc.id.toUpperCase().replace(/[:.]/g, '_') + '_PORT';
    lines.push(`${varName}=${svc.port}`);

    const urlVarName: string = svc.id.toUpperCase().replace(/[:.]/g, '_') + '_URL';
    if (svc.urls?.local) {
      lines.push(`${urlVarName}=${svc.urls.local}`);
    }
  }

  const output: string = lines.join('\n');

  if (options.file) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(options.file as string, output + '\n');
    console.log(`Wrote ${lines.length} variables to ${options.file}`);
  } else {
    console.log(output);
  }
}

// =============================================================================
// Agent Coordination
// =============================================================================

async function handlePub(channel: string | undefined, message: string | undefined, options: CLIOptions): Promise<void> {
  if (!channel) {
    console.error('Usage: port-daddy pub <channel> <message>');
    process.exit(1);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(message || '{}');
  } catch {
    payload = message || '';
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/msg/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, sender: options.sender })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to publish');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!options.quiet && !options.q) {
    console.log(`Published to ${channel} (id: ${data.id})`);
  }
}

async function handleSub(channel: string | undefined, options: CLIOptions): Promise<void> {
  if (!channel) {
    console.error('Usage: port-daddy sub <channel>');
    process.exit(1);
  }

  console.error(`Subscribing to ${channel}... (Ctrl+C to exit)`);

  // SSE requires raw streaming — can't use pdFetch which buffers the full response
  const target: ConnectionTarget = resolveTarget();
  const path: string = `/msg/${encodeURIComponent(channel)}/subscribe`;

  const reqOpts: http.RequestOptions = {
    method: 'GET',
    path,
    headers: { 'Accept': 'text/event-stream' },
    ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port })
  };

  const req: ClientRequest = http.request(reqOpts, (res: IncomingMessage) => {
    if (res.statusCode !== 200) {
      console.error('Failed to subscribe');
      process.exit(1);
    }

    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      const lines: string[] = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data: string = line.slice(6);
          if (options.json) {
            console.log(data);
          } else {
            try {
              const msg = JSON.parse(data) as { createdAt: number; payload: unknown };
              console.log(`[${new Date(msg.createdAt).toISOString()}] ${JSON.stringify(msg.payload)}`);
            } catch {
              console.log(data);
            }
          }
        }
      }
    });

    res.on('end', () => {
      console.error('Subscription ended');
      process.exit(0);
    });
  });

  req.on('error', (err: Error) => {
    console.error(`Connection error: ${err.message}`);
    process.exit(1);
  });

  req.end();

  // Keep process alive until Ctrl+C
  await new Promise<void>(() => {});
}

// =============================================================================
// Multi-Agent Coordination
// =============================================================================

async function handleWait(serviceIds: string[], options: CLIOptions): Promise<void> {
  if (!serviceIds || serviceIds.length === 0) {
    console.error('Usage: port-daddy wait <service> [service2] [...]');
    console.error('       port-daddy wait myapp:api myapp:frontend');
    process.exit(1);
  }

  const timeout: number = options.timeout ? parseInt(options.timeout as string, 10) : 60000;

  console.error(`Waiting for ${serviceIds.length} service(s) to become healthy...`);

  if (serviceIds.length === 1) {
    // Single service wait
    const url: string = `${PORT_DADDY_URL}/wait/${encodeURIComponent(serviceIds[0])}?timeout=${timeout}`;
    const res: PdFetchResponse = await pdFetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.error((data.error as string) || 'Wait failed');
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`\u2713 ${serviceIds[0]} is healthy (${data.latency}ms)`);
    }
  } else {
    // Multiple services wait
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ services: serviceIds, timeout })
    });

    const data = await res.json();

    if (!res.ok) {
      console.error((data.error as string) || 'Wait failed');
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      const svcList = data.services as Array<{ serviceId: string; healthy: boolean; latency?: number; error?: string }>;
      for (const svc of svcList) {
        const icon: string = svc.healthy ? '\u2713' : '\u2717';
        console.log(`${icon} ${svc.serviceId} ${svc.healthy ? `(${svc.latency}ms)` : svc.error || 'unhealthy'}`);
      }
      console.log(`\nAll services healthy: ${data.allHealthy}`);
    }
  }
}

async function handleLock(name: string | undefined, options: CLIOptions): Promise<void> {
  if (!name) {
    console.error('Usage: port-daddy lock <name> [--ttl <ms>] [--owner <id>]');
    console.error('       port-daddy lock db-migrations');
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    owner: options.owner,
    ttl: options.ttl ? parseInt(options.ttl as string, 10) : 300000
  };

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/locks/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PID': String(process.pid)
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    if (data.error === 'lock is held') {
      console.error(`Lock '${name}' is held by ${data.holder}`);
      console.error(`  Held since: ${new Date(data.heldSince as number).toISOString()}`);
      if (data.expiresAt) {
        const remaining: number = Math.max(0, (data.expiresAt as number) - Date.now());
        console.error(`  Expires in: ${Math.ceil(remaining / 1000)}s`);
      }
      process.exit(1);
    }
    console.error((data.error as string) || 'Failed to acquire lock');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (options.quiet) {
    // Silent success for scripting: port-daddy lock foo && do_stuff
  } else {
    console.log(`Acquired lock: ${name}`);
    if (data.expiresAt) {
      const ttlSeconds: number = Math.ceil(((data.expiresAt as number) - (data.acquiredAt as number)) / 1000);
      console.log(`  TTL: ${ttlSeconds}s`);
    }
  }
}

async function handleUnlock(name: string | undefined, options: CLIOptions): Promise<void> {
  if (!name) {
    console.error('Usage: port-daddy unlock <name> [--force]');
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    owner: options.owner,
    force: options.force === true
  };

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/locks/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to release lock');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!options.quiet) {
    if (data.released) {
      console.log(`Released lock: ${name}`);
    } else {
      console.log(`Lock '${name}' was not held`);
    }
  }
}

async function handleLocks(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.owner) params.append('owner', options.owner as string);

  const url: string = `${PORT_DADDY_URL}/locks${params.toString() ? '?' + params : ''}`;
  const res: PdFetchResponse = await pdFetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to list locks');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.log('No active locks');
    return;
  }

  console.log('');
  console.log('NAME'.padEnd(30) + 'OWNER'.padEnd(25) + 'EXPIRES');
  console.log('\u2500'.repeat(70));

  const locks = data.locks as Array<{ name: string; owner: string; expiresAt?: number }>;
  for (const lock of locks) {
    const expires: string = lock.expiresAt
      ? new Date(lock.expiresAt).toISOString().replace('T', ' ').slice(0, 19)
      : 'never';
    console.log(
      lock.name.padEnd(30) +
      lock.owner.slice(0, 24).padEnd(25) +
      expires
    );
  }

  console.log('');
  console.log(`Total: ${data.count} lock(s)`);
}

// =============================================================================
// Orchestration (up/down)
// =============================================================================

const UP_PID_FILE: string = join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.port-daddy-up.pid'
);

async function handleUp(positional: string[], options: CLIOptions): Promise<void> {
  const dir: string = (options.dir as string) || process.cwd();

  // Ensure daemon is running
  try {
    const healthRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    if (!healthRes.ok) throw new Error('unhealthy');
  } catch {
    console.error('Port Daddy daemon is not running.');
    console.error('Start it with: port-daddy start');
    process.exit(1);
  }

  // 1. Load config (if exists)
  let config: PortDaddyRcConfig | null = null;
  try {
    config = loadConfig(dir);
  } catch (err: unknown) {
    console.error(`Config error: ${(err as Error).message}`);
    process.exit(1);
  }

  // 2. Discover services
  const discovered = discoverServices(dir);
  const mergedServices = mergeWithConfig(discovered.services, config) as Record<string, DiscoveredService>;

  if (Object.keys(mergedServices).length === 0) {
    // Auto-scan: try deep scan before giving up
    console.error('  No config found. Scanning...');
    console.error('');
    try {
      const scanRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir, save: true, useBranch: options.branch === true })
      });
      const scanData = await scanRes.json();

      if (scanRes.ok && (scanData.serviceCount as number) > 0) {
        // Scan found services — reload config and continue
        console.error(`  Scan found ${scanData.serviceCount} service(s). Config saved.`);
        console.error('');
        config = loadConfig(dir);
        const rediscovered = discoverServices(dir);
        Object.assign(mergedServices, mergeWithConfig(rediscovered.services, config) as Record<string, DiscoveredService>);
      }
    } catch {
      // Scan failed silently, fall through to error below
    }

    if (Object.keys(mergedServices).length === 0) {
      console.error('  No services found.');
      console.error('');
      console.error('  Port Daddy looked for known frameworks (Next.js, Express,');
      console.error('  FastAPI, Docker, Go, Rust, etc.) but found nothing.');
      console.error('');
      console.error('  Try: port-daddy scan --dry-run    (see what would be detected)');
      console.error('       port-daddy scan              (scan & save config)');
      process.exit(1);
    }
  }

  // 3. Suggest semantic identities
  const useGitBranch: boolean = options.branch === true;
  const nameOpts: { useBranch?: boolean } = useGitBranch ? { useBranch: true } : {};
  const identitySuggestions = suggestNames(mergedServices, dir, nameOpts);

  // Build identity map: service name -> full semantic ID
  // Deduplicate: if two services get the same identity, append service name
  const identities: Record<string, string> = {};
  const seenIds = new Map<string, string | null>(); // full id -> service name
  for (const [name, suggestion] of Object.entries(identitySuggestions)) {
    let id: string = suggestion.full;
    if (seenIds.has(id)) {
      // Conflict: rename the earlier one too (if not already renamed)
      const prevName: string | null | undefined = seenIds.get(id);
      if (prevName && identities[prevName] === id) {
        identities[prevName] = `${suggestion.project}:${prevName}:${suggestion.context}`;
      }
      // Use service name as the stack component for this one
      id = `${suggestion.project}:${name}:${suggestion.context}`;
      seenIds.set(id, null); // mark as resolved
    } else {
      seenIds.set(id, name);
    }
    identities[name] = id;
  }

  // 4. Normalize all service configs
  const normalizedServices: Record<string, ReturnType<typeof normalizeServiceConfig>> = {};
  for (const [name, svc] of Object.entries(mergedServices)) {
    normalizedServices[name] = normalizeServiceConfig(name, svc as unknown as Parameters<typeof normalizeServiceConfig>[1]);
  }

  // 5. Print preview
  const serviceEntries = Object.entries(normalizedServices);

  console.log('');
  if (config) {
    console.log(`  Config: ${(config as PortDaddyRcConfig & { _path?: string })._path}`);
  } else {
    console.log(`  Config: auto-detected (${discovered.type})`);
  }
  console.log(`  Detected ${serviceEntries.length} service(s):`);
  console.log('');

  const maxNameLen: number = Math.max(...serviceEntries.map(([n]) => n.length));
  for (const [name, svc] of serviceEntries) {
    const padded: string = name.padEnd(maxNameLen);
    const svcAny = svc as unknown as Record<string, unknown>;
    const stackObj = svcAny.stack as { name?: string } | undefined;
    const stackLabel: string = stackObj?.name || (svcAny.remote ? 'remote' : 'local');
    const identity: string = identities[name] || name;
    const marker: string = svcAny.remote ? '  (remote)' : '';
    console.log(`    ${padded}  ${stackLabel.padEnd(12)} \u2192 ${identity}${marker}`);
  }
  console.log('');

  // 6. Topological sort to validate dependency graph
  const { order, error: sortError } = topologicalSort(normalizedServices);
  if (sortError) {
    console.error(`  Error: ${sortError}`);
    process.exit(1);
  }

  // 7. Create orchestrator
  const orchestrator = createOrchestrator({
    services: normalizedServices,
    identities,
    config: {
      noHealth: options['no-health'] === true,
      healthTimeout: options.timeout ? parseInt(options.timeout as string, 10) : 30000,
      targetService: (options.service as string) || null
    }
  });

  // 8. Wire events
  // The orchestrator extends EventEmitter; cast listeners to satisfy TS strict mode
  orchestrator.on('portsReady', (data: unknown) => {
    const { portMap } = data as { portMap: Record<string, number> };
    console.log('  Claiming ports...');
    for (const [name, port] of Object.entries(portMap)) {
      console.log(`    ${name.padEnd(maxNameLen)}  \u2192 ${port}`);
    }
    console.log('');
  });

  orchestrator.on('healthy', (data: unknown) => {
    const { name, port } = data as { name: string; port: number };
    console.log(`  \u2713 ${name} healthy (port ${port})`);
  });

  orchestrator.on('healthTimeout', (data: unknown) => {
    const { name, port } = data as { name: string; port: number };
    console.error(`  \u26a0 ${name} did not become healthy (port ${port})`);
  });

  orchestrator.on('crash', (data: unknown) => {
    const { name } = data as { name: string };
    console.error(`  \u2717 ${name} crashed during startup`);
  });

  orchestrator.on('exit', (data: unknown) => {
    const { name, code, signal, early } = data as { name: string; code: number; signal: string; early: boolean };
    if (early) {
      console.error(`  \u2717 ${name} exited immediately (code ${code})`);
    } else {
      console.error(`  ${name} exited (code ${code}, signal ${signal})`);
    }
  });

  orchestrator.on('allStarted', (data: unknown) => {
    const { services } = data as { services: string[] };
    console.log('');
    console.log(`  All ${services.length} service(s) running. Press Ctrl+C to stop.`);
    console.log(`  Dashboard: ${PORT_DADDY_URL}/`);
    console.log('');
  });

  orchestrator.on('stopped', () => {
    console.log('');
    console.log('  All services stopped.');
    removePidFile();
  });

  orchestrator.on('error', (data: unknown) => {
    const { name, error } = data as { name: string; error: string };
    console.error(`  Error in ${name}: ${error}`);
  });

  // 9. Handle Ctrl+C
  let shuttingDown: boolean = false;
  const gracefulShutdown = async (): Promise<void> => {
    if (shuttingDown) {
      // Double Ctrl+C: force kill
      console.error('\n  Force killing...');
      process.exit(1);
    }
    shuttingDown = true;
    console.log('\n  Shutting down...');
    await orchestrator.stop();
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  // 10. Write PID file for `down` command
  writePidFile();

  // 11. Start
  console.log(`  Starting in dependency order: ${order.join(' \u2192 ')}`);
  console.log('');

  try {
    await orchestrator.start();
  } catch (err: unknown) {
    console.error(`  Failed to start: ${(err as Error).message}`);
    removePidFile();
    process.exit(1);
  }

  // Keep alive
  await new Promise<void>(() => {});
}

async function handleDown(options: CLIOptions): Promise<void> {
  // Read PID file
  try {
    if (!existsSync(UP_PID_FILE)) {
      console.error('No port-daddy up session found.');
      console.error('(No PID file at ' + UP_PID_FILE + ')');
      process.exit(1);
    }

    const pidStr: string = readFileSync(UP_PID_FILE, 'utf-8').trim();
    const pid: number = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      console.error('Invalid PID file. Removing it.');
      removePidFile();
      process.exit(1);
    }

    // Check if process is alive
    try {
      process.kill(pid, 0); // Signal 0 = just check if alive
    } catch {
      console.error(`Process ${pid} is not running. Cleaning up PID file.`);
      removePidFile();
      process.exit(1);
    }

    // Send SIGTERM to trigger graceful shutdown
    console.log(`Sending shutdown signal to port-daddy up (PID ${pid})...`);
    process.kill(pid, 'SIGTERM');
    console.log('Shutdown initiated.');
  } catch (err: unknown) {
    const error = err as Error & { code?: number };
    if (error.code !== undefined) throw err; // Re-throw non-handled errors
    console.error(`Failed to stop: ${error.message}`);
    process.exit(1);
  }
}

function writePidFile(): void {
  try {
    fsWriteFileSync(UP_PID_FILE, String(process.pid));
  } catch { /* best effort */ }
}

function removePidFile(): void {
  try {
    if (existsSync(UP_PID_FILE)) unlinkSync(UP_PID_FILE);
  } catch { /* best effort */ }
}

// =============================================================================
// Project Setup
// =============================================================================

async function handleDetect(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: (options.dir as string) || process.cwd() })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Detection failed');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const stack = data.stack as { name: string; defaultPort: number; devCmd: string; healthPath?: string } | null;
  if (stack) {
    console.log(`Detected: ${stack.name}`);
    console.log(`  Default port: ${stack.defaultPort}`);
    console.log(`  Dev command: ${stack.devCmd}`);
    console.log(`  Health path: ${stack.healthPath || '/'}`);
  } else {
    console.log('No framework detected');
  }

  console.log('');
  console.log('Suggested identity:');
  const suggestedIdentity = data.suggestedIdentity as { full: string };
  console.log(`  ${suggestedIdentity.full}`);
}

async function handleInit(options: CLIOptions): Promise<void> {
  const save: boolean = !options.dry;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: (options.dir as string) || process.cwd(), save })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Init failed');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.saved) {
    console.log(`Created: ${data.path}`);
    console.log('');
    console.log('Config:');
    console.log(JSON.stringify(data.config, null, 2));
  } else {
    console.log('Generated config (use without --dry to save):');
    console.log('');
    console.log(JSON.stringify(data.config, null, 2));
  }
}

// =============================================================================
// Scan & Projects
// =============================================================================

async function handleScan(dir: string | undefined, options: CLIOptions): Promise<void> {
  const targetDir: string = dir || (options.dir as string) || process.cwd();
  const dryRun: boolean = options['dry-run'] === true;
  const useBranch: boolean = options.branch === true;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: targetDir, save: !dryRun, dryRun, useBranch })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Scan failed');
    if (data.details) console.error(`  ${data.details}`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Header
  console.log('');
  console.log(`  Project: ${data.project}`);
  console.log(`  Root:    ${data.root}`);
  console.log(`  Type:    ${data.type}`);
  console.log('');

  if (data.serviceCount === 0) {
    console.log('  No services detected.');
    console.log('');
    if (data.guidance) {
      for (const line of data.guidance as string[]) {
        console.log(`  ${line}`);
      }
    }
    return;
  }

  // Service tree
  console.log(`  Services (${data.serviceCount}):`);
  console.log('');

  const svcMap = data.services as Record<string, { framework?: string; preferredPort?: number; dir?: string }>;
  const entries = Object.entries(svcMap);
  const maxName: number = Math.max(...entries.map(([n]) => n.length));

  for (const [name, svc] of entries) {
    const padded: string = name.padEnd(maxName);
    const framework: string = svc.framework || 'unknown';
    const port: string = svc.preferredPort ? `:${svc.preferredPort}` : '';
    const svcDir: string = svc.dir || '.';
    console.log(`    ${padded}  ${framework.padEnd(20)} ${svcDir}${port}`);
  }
  console.log('');

  // Config status
  if (dryRun) {
    console.log('  Dry run \u2014 config not saved.');
    console.log('  Run without --dry-run to save .portdaddyrc');
  } else if (data.saved) {
    console.log(`  Config saved: ${data.savedPath}`);
  }

  const existingConfig = data.existingConfig as { path: string; serviceCount: number } | undefined;
  if (existingConfig) {
    console.log(`  Existing config: ${existingConfig.path} (${existingConfig.serviceCount} services)`);
  }

  // Guidance
  console.log('');
  if (data.guidance) {
    for (const line of data.guidance as string[]) {
      console.log(`  ${line}`);
    }
  }
  console.log('');
}

async function handleProjects(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  // Handle "projects rm <id>"
  if (subcommand === 'rm' || subcommand === 'remove' || subcommand === 'delete') {
    const projectId: string | undefined = args[0];
    if (!projectId) {
      console.error('Usage: port-daddy projects rm <project-id>');
      process.exit(1);
    }

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE'
    });

    const data = await res.json();

    if (!res.ok) {
      console.error((data.error as string) || 'Failed to remove project');
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`  Removed project: ${projectId}`);
    }
    return;
  }

  // Handle "projects <id>" — get specific project
  if (subcommand && subcommand !== 'list') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/projects/${encodeURIComponent(subcommand)}`);
    const data = await res.json();

    if (!res.ok) {
      console.error((data.error as string) || 'Project not found');
      if (data.suggestion) console.error(`  ${data.suggestion}`);
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const p = data.project as { id: string; root: string; type: string; lastScanned: number; services?: Record<string, { stack?: { name: string } }> };
    console.log('');
    console.log(`  Project: ${p.id}`);
    console.log(`  Root:    ${p.root}`);
    console.log(`  Type:    ${p.type}`);
    console.log(`  Scanned: ${new Date(p.lastScanned).toLocaleString()}`);
    console.log('');

    if (p.services) {
      const entries = Object.entries(p.services);
      console.log(`  Services (${entries.length}):`);
      for (const [name, svc] of entries) {
        const framework: string = svc?.stack?.name || 'unknown';
        console.log(`    ${name}  ${framework}`);
      }
    }
    console.log('');
    return;
  }

  // Default: list all projects
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/projects`);
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to list projects');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.log('');
    console.log('  No projects registered.');
    console.log('');
    console.log('  Run "port-daddy scan" from a project directory to register it.');
    console.log('');
    return;
  }

  console.log('');
  console.log(`  Registered projects (${data.count}):`);
  console.log('');

  const projectsList = data.projects as Array<{ id: string; type: string; serviceCount: number; lastScanned?: number; frameworks?: string[] }>;
  const maxId: number = Math.max(...projectsList.map((p) => p.id.length));
  for (const p of projectsList) {
    const padded: string = p.id.padEnd(maxId);
    const type: string = p.type.padEnd(9);
    const svcCount: string = `${p.serviceCount} svc`;
    const scanned: string = p.lastScanned ? new Date(p.lastScanned).toLocaleDateString() : 'never';
    const frameworks: string = p.frameworks?.length ? p.frameworks.join(', ') : '';
    console.log(`    ${padded}  ${type} ${svcCount.padEnd(6)}  scanned ${scanned}  ${frameworks}`);
  }

  console.log('');
}

// =============================================================================
// Agent Registry
// =============================================================================

async function handleAgent(subcommand: string | undefined, args: string[], options: CLIOptions): Promise<void> {
  if (!subcommand || subcommand === 'help') {
    console.error('Usage: port-daddy agent <subcommand> [options]');
    console.error('');
    console.error('Subcommands:');
    console.error('  register [--agent <id>] [--type <type>]   Register as an agent');
    console.error('  heartbeat [--agent <id>]                  Send heartbeat');
    console.error('  unregister [--agent <id>]                 Unregister agent');
    console.error('  <agent-id>                                Get agent info');
    process.exit(1);
  }

  const agentId: string = (options.agent as string) || `cli-${process.pid}`;

  switch (subcommand) {
    case 'register': {
      const body: Record<string, unknown> = {
        id: agentId,
        name: options.name,
        type: options.type || 'cli',
        maxServices: options.maxServices ? parseInt(options.maxServices as string, 10) : undefined,
        maxLocks: options.maxLocks ? parseInt(options.maxLocks as string, 10) : undefined
      };

      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PID': String(process.pid)
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      if (!res.ok) {
        console.error((data.error as string) || 'Failed to register agent');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data.registered ? `Registered agent: ${agentId}` : `Updated agent: ${agentId}`);
      }
      break;
    }

    case 'heartbeat': {
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PID': String(process.pid)
        }
      });

      const data = await res.json();

      if (!res.ok) {
        console.error((data.error as string) || 'Failed to send heartbeat');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else if (!options.quiet) {
        console.log(`Heartbeat sent for ${agentId}`);
      }
      break;
    }

    case 'unregister': {
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (!res.ok) {
        console.error((data.error as string) || 'Failed to unregister agent');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data.unregistered ? `Unregistered agent: ${agentId}` : `Agent not found: ${agentId}`);
      }
      break;
    }

    default: {
      // Treat as agent ID lookup
      const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/agents/${encodeURIComponent(subcommand)}`);
      const data = await res.json();

      if (!res.ok) {
        console.error((data.error as string) || 'Agent not found');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        const agent = data.agent as { id: string; name?: string; type: string; pid: number; isActive: boolean; lastHeartbeat: number; registeredAt: number; maxServices: number; maxLocks: number };
        console.log(`Agent: ${agent.id}`);
        console.log(`  Name: ${agent.name || '-'}`);
        console.log(`  Type: ${agent.type}`);
        console.log(`  PID: ${agent.pid}`);
        console.log(`  Active: ${agent.isActive ? 'yes' : 'no'}`);
        console.log(`  Last heartbeat: ${new Date(agent.lastHeartbeat).toISOString()}`);
        console.log(`  Registered: ${new Date(agent.registeredAt).toISOString()}`);
        console.log(`  Limits: ${agent.maxServices} services, ${agent.maxLocks} locks`);
      }
    }
  }
}

async function handleAgents(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.active) params.append('active', 'true');

  const url: string = `${PORT_DADDY_URL}/agents${params.toString() ? '?' + params : ''}`;
  const res: PdFetchResponse = await pdFetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to list agents');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.log('No agents registered');
    return;
  }

  console.log('');
  console.log('ID'.padEnd(25) + 'TYPE'.padEnd(10) + 'PID'.padEnd(10) + 'ACTIVE'.padEnd(10) + 'LAST HEARTBEAT');
  console.log('\u2500'.repeat(75));

  const agents = data.agents as Array<{ id: string; type: string; pid: number; isActive: boolean; lastHeartbeat: number }>;
  for (const agent of agents) {
    const lastHb: string = new Date(agent.lastHeartbeat).toISOString().replace('T', ' ').slice(0, 19);
    console.log(
      agent.id.slice(0, 24).padEnd(25) +
      agent.type.padEnd(10) +
      String(agent.pid).padEnd(10) +
      (agent.isActive ? 'yes' : 'no').padEnd(10) +
      lastHb
    );
  }

  console.log('');
  console.log(`Total: ${data.count} agent(s)`);
}

// =============================================================================
// Activity Log
// =============================================================================

async function handleLog(subcommand: string | undefined, options: CLIOptions): Promise<void> {
  if (subcommand === 'summary') {
    const params = new URLSearchParams();
    if (options.since) params.append('since', options.since as string);

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity/summary${params.toString() ? '?' + params : ''}`);
    const data = await res.json();

    if (!res.ok) {
      console.error((data.error as string) || 'Failed to get summary');
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log('');
    console.log('Activity Summary');
    console.log('\u2500'.repeat(40));

    const summary = data.summary as Record<string, number>;
    for (const [type, count] of Object.entries(summary)) {
      console.log(`  ${type.padEnd(25)} ${count}`);
    }

    console.log('\u2500'.repeat(40));
    console.log(`  Total: ${data.total}`);
    if ((data.since as number) > 0) {
      console.log(`  Since: ${new Date(data.since as number).toISOString()}`);
    }
    console.log('');
    return;
  }

  if (subcommand === 'stats') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity/stats`);
    const data = await res.json();

    if (!res.ok) {
      console.error((data.error as string) || 'Failed to get stats');
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const stats = data.stats as { totalEntries: number; maxEntries: number; retentionMs: number; oldestEntry?: number; newestEntry?: number };
    console.log('');
    console.log('Activity Log Stats');
    console.log('\u2500'.repeat(40));
    console.log(`  Total entries: ${stats.totalEntries}`);
    console.log(`  Max entries: ${stats.maxEntries}`);
    console.log(`  Retention: ${Math.floor(stats.retentionMs / 86400000)} days`);
    if (stats.oldestEntry) {
      console.log(`  Oldest: ${new Date(stats.oldestEntry).toISOString()}`);
    }
    if (stats.newestEntry) {
      console.log(`  Newest: ${new Date(stats.newestEntry).toISOString()}`);
    }
    console.log('');
    return;
  }

  // Default: show recent activity
  const params = new URLSearchParams();
  if (options.limit) params.append('limit', options.limit as string);
  if (options.type) params.append('type', options.type as string);
  if (options.agent) params.append('agent', options.agent as string);
  if (options.target) params.append('target', options.target as string);
  if (subcommand && subcommand !== 'recent') params.append('type', subcommand);

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/activity${params.toString() ? '?' + params : ''}`);
  const data = await res.json();

  if (!res.ok) {
    console.error((data.error as string) || 'Failed to get activity');
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.log('No activity found');
    return;
  }

  console.log('');
  console.log('TIMESTAMP'.padEnd(22) + 'TYPE'.padEnd(20) + 'AGENT'.padEnd(18) + 'DETAILS');
  console.log('\u2500'.repeat(85));

  const entries = data.entries as Array<{ timestamp: number; type: string; agentId?: string; details?: string }>;
  for (const entry of entries) {
    const time: string = new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19);
    console.log(
      time.padEnd(22) +
      entry.type.slice(0, 19).padEnd(20) +
      (entry.agentId || '-').slice(0, 17).padEnd(18) +
      (entry.details || '-')
    );
  }

  console.log('');
  console.log(`Showing ${data.count} entries`);
}

// =============================================================================
// Daemon Management
// =============================================================================

async function handleDaemon(action: string): Promise<void> {
  const installScript: string = join(__dirname, '..', 'install-daemon.js');
  const serverScript: string = join(__dirname, '..', 'server.js');

  switch (action) {
    case 'start': {
      // Check if already running
      try {
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
        if (res.ok) {
          console.log('Port Daddy is already running');
          return;
        }
      } catch {}

      console.log('Starting Port Daddy daemon...');
      const child: ChildProcess = spawn('node', [serverScript], {
        stdio: 'ignore',
        detached: true
      });
      child.unref();

      // Wait for it to be ready
      for (let i = 0; i < 30; i++) {
        await new Promise<void>(r => setTimeout(r, 100));
        try {
          const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
          if (res.ok) {
            console.log('Port Daddy daemon started');
            return;
          }
        } catch {}
      }
      console.error('Failed to start daemon');
      process.exit(1);
      break;
    }

    case 'stop': {
      try {
        const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
        const data = await res.json();
        process.kill(data.pid as number, 'SIGTERM');
        console.log('Port Daddy daemon stopped');
      } catch {
        console.log('Port Daddy is not running');
      }
      break;
    }

    case 'restart': {
      await handleDaemon('stop');
      await new Promise<void>(r => setTimeout(r, 1000));
      await handleDaemon('start');
      break;
    }

    case 'install': {
      const result: SpawnSyncReturns<Buffer> = spawnSync('node', [installScript, 'install'], { stdio: 'inherit' });
      process.exit(result.status ?? 1);
      break;
    }

    case 'uninstall': {
      const result: SpawnSyncReturns<Buffer> = spawnSync('node', [installScript, 'uninstall'], { stdio: 'inherit' });
      process.exit(result.status ?? 1);
      break;
    }
  }
}

async function handleStatus(): Promise<void> {
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    const data = await res.json();

    console.log(`Port Daddy is running`);
    console.log(`  Version: ${data.version}`);
    console.log(`  PID: ${data.pid}`);
    console.log(`  Uptime: ${Math.floor((data.uptime_seconds as number) / 60)}m ${(data.uptime_seconds as number) % 60}s`);
    console.log(`  Active ports: ${data.active_ports}`);
  } catch {
    console.log('Port Daddy is not running');
    console.log('  Start with: port-daddy start');
    console.log('  Or install: port-daddy install');
    process.exit(1);
  }
}

async function handleVersion(): Promise<void> {
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
    const data = await res.json();
    console.log(`Port Daddy ${data.version}`);
    console.log(`Code hash: ${data.codeHash}`);
    console.log(`Server PID: ${data.pid}`);
    console.log(`Uptime: ${Math.floor((data.uptime as number) / 60)}m`);
  } catch {
    console.log('Port Daddy v2.0.0 (server not running)');
  }
}

async function handleDoctor(): Promise<void> {
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
    const nodeModulesPath: string = join(__dirname, '..', 'node_modules');
    const pkgPath: string = join(__dirname, '..', 'package.json');
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
    const dbPath: string = join(__dirname, '..', 'port-registry.db');
    if (existsSync(dbPath)) {
      // Check if writable by trying to open for writing
      const { accessSync, constants } = await import('node:fs');
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
  // 4. Network: Can we reach localhost:9876
  // -------------------------------------------------------------------------
  let daemonData: Record<string, unknown> | null = null;
  let daemonRunning: boolean = false;

  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
    if (res.ok) {
      daemonData = await res.json();
      daemonRunning = true;
      check('Network', true, `localhost:9876 is reachable`);
    } else {
      check('Network', false, `localhost:9876 returned status ${res.status}`, 'Run: port-daddy start');
    }
  } catch {
    check('Network', false, 'Cannot connect to localhost:9876', 'Run: port-daddy start');
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
  // 7. Port 9876 availability
  // -------------------------------------------------------------------------
  try {
    if (daemonRunning) {
      check('Port 9876', true, 'Bound to Port Daddy daemon');
    } else {
      // Check if something else is using 9876
      const net = await import('node:net');
      const portInUse: boolean = await new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => {
          server.close();
          resolve(false);
        });
        server.listen(9876, '127.0.0.1');
      });

      if (portInUse) {
        check('Port 9876', false, 'In use by another process', 'Run: lsof -i :9876 to investigate');
      } else {
        check('Port 9876', true, 'Available (daemon not running)');
      }
    }
  } catch (err: unknown) {
    check('Port 9876', false, `Error: ${(err as Error).message}`, 'Run: lsof -i :9876 to investigate');
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
  // Output
  // -------------------------------------------------------------------------
  console.log('');
  console.log('Port Daddy Doctor');
  console.log('\u2501'.repeat(38));

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

  console.log('\u2501'.repeat(38));
  console.log(`${passed}/${total} checks passed`);
  console.log('');

  if (hasCriticalFailure) {
    process.exit(1);
  }
  if (passed < total) {
    process.exit(1);
  }
}

async function handleDev(): Promise<void> {
  const libDir: string = join(__dirname, '..');
  const filesToWatch: string[] = [
    'server.js',
    'lib/services.js',
    'lib/messaging.js',
    'lib/locks.js',
    'lib/health.js',
    'lib/detect.js',
    'lib/config.js',
    'lib/identity.js',
    'lib/utils.js',
    'lib/agents.js',
    'lib/activity.js'
  ];

  console.log('');
  console.log('Port Daddy Dev Mode');
  console.log('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
  console.log('Watching source files for changes...');
  console.log('Press Ctrl+C to exit');
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
        const serverScript: string = join(__dirname, '..', 'server.js');
        const child: ChildProcess = spawn('node', [serverScript], {
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

  // Also watch the lib directory for new files
  const libPath: string = join(libDir, 'lib');
  if (existsSync(libPath)) {
    try {
      const libWatcher: FSWatcher = watch(libPath, (eventType: string, filename: string | null) => {
        if (filename && filename.endsWith('.js')) {
          scheduleRestart();
        }
      });
      watchers.push(libWatcher);
      console.log(`  Watching: lib/`);
    } catch {}
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

main();
