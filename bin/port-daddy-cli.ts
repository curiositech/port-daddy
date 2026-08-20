#!/usr/bin/env node

/**
 * Port Daddy CLI
 *
 * The authoritative port management tool for multi-agent development.
 * Grammar: port-daddy <verb> [identity] [--options]
 */

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';

import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { readFileSync, writeFileSync as fsWriteFileSync, existsSync, unlinkSync, watch } from 'node:fs';
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
import { createNoteEncryption } from '../lib/note-encryption.js';
import { createSessions } from '../lib/sessions.js';
import { createActivityLog } from '../lib/activity.js';
import { highlightChannel, flag, SignalFlags, ANSI as marANSI } from '../lib/maritime.js';
import { BANNER, TAGLINE } from '../lib/banner.js';
import * as ui from '../cli/utils/ui.js';
import PKG from '../package.json' with { type: 'json' };

// Command modules (extracted from this file)
import {
  // Services
  handleClaim, handleRelease, handleFind, handleUrl, handleEnv, handleEnvExec, autoIdentityFromPackageJson,
  // Locks
  handleLock, handleUnlock, handleLocks,
  // Messaging
  handlePub, handleSub, handleChannels, handleWait,
  // Sessions
  handleSession, handleSessions, handleNote, handleNotes,
  // Agents & Resurrection
  handleAgent, handleAgents, handleRoster, ROSTER_HELP,
  handleSalvage,
  // Changelog
  handleChangelog,
  // Booty (artifact harvest)
  handleBooty,
  // Inbox
  handleInbox,
  handleSent, SENT_HELP,
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
  handleMetrics, handleConfigCmd, handleHealth, handlePorts, handleDashboard, handleDoctor, handleStatus, handleVersion, handleHints,
  // Daemon
  handleDaemon, handleDaemonCommand, handleDev, runDaemonInProcess,
  // Benchmarking
  handleBench,
  handleBenchmark,
  // Setup
  handleSetup,
  // DNS, Briefing, Integration
  handleDns, handleBriefing, handleIntegration,
  // Sugar commands
  handleBegin, handleDone, handleWhoami, handleWithLock,
  // Attention (inbox + subscribed channels — see docs/RELEASING.md for hook wiring)
  handleAttention, ATTENTION_HELP,
  // Nudge (suggestibility layer — claim-overlap heads-up, ADR-0039)
  handleNudge,
  // Tutorial
  handleLearn,
  // File claims
  handleWhoOwns,
  // Briefing history
  handleHistory,
  // Spawn + Watch
  handleSpawn, handleSpawned, handleWatch, handleSortie,
  // Work Intent family (ADR-0095): pd work probe / matrix (binder ch18 C2)
  handleWork,
  // Transcripts
  handleTranscripts,
  // Dispatch (renamed from nightshift per ADR-0035) + morning summary +
  // review (pd review --accept|--reject contract). `handleNightshift` is
  // kept as a back-compat alias that delegates to `handleDispatch`.
  handleDispatch, handleNightshift, handleReview, handleMorning,
  // Harbors
  handleHarborCreate, handleHarborEnter, handleHarborLeave, handleHarborShow, handleHarborDestroy, handleHarbors,
  // Demo
  handleDemo,
  // Tuples
  handleTuple,
  // Semantic graph + episodic memory
  handleGraph, handleIdeas,
  // Shared local embedder (ADR-0061)
  handleEmbed,
  handleSkillGraft,
  handleRoadmap,
  // Durable commitments (ADR-0041)
  handleCommit, handleObligations,
  handleQuorum,
  handleParley,
  handleFeedback,
  // Consolidated read/write verbs + sitrep + pheromone (3.8.4)
  handleSitrep, SITREP_HELP, handleSay, handleLook, handlePheromone, handlePlan,
  // Coordination advisor / suggestibility
  handleAdvisor,
  // Maritime actor directory
  handleActors,
  // Tube — relay-independent conversational pipe (Track B1)
  handleTube,
  // Coordination Guard enforcement controls
  handleGuard,
  // Claim-aware git add wrapper
  handleAdd,
  // Claim-watcher snapshot list/restore/prune
  handleSnapshots,
  // Durable backups of port-registry.db (ADR-0037)
  handleBackup,
  handleCut,
  handleBatten,
  handleRestore,
  // Honest attestation / loud-fail invariants (ADR-0045)
  handleAttest,
  // Host-safety posture audit — `pd safe scan|baseline|fix` (ADR-0088 Phase A)
  handleSafe,
  // Shipwright — survey/propose/apply for fleet authoring
  handleShipwright,
  // App-Native Development Cockpit
  handleCockpit,
  // Roadmap popper — autonomous roadmap-to-dispatch task puller
  handlePopper,
  // Managed provider secret store (keychain-backed)
  handleSecret,
  // Operator loop · SIGHT stage — raise the periscope (state + next cut)
  handlePeriscope,
  // Coast Guard read path — `pd coast-guard status` (ADR-0050 legibility)
  handleCoastGuard,
  // Suggest — Tender's suggestion queue (approve/dismiss)
  handleSuggest,
  // Seamanship — skill registry, search, graft, outcomes
  handleSeamanship,
} from '../cli/commands/index.js';
// pd memory — Core/Recall/Archival vocabulary + episodic memory dispatcher.
// Imported directly (not via index.js) so the tier subcommands take precedence
// over the older semantic.ts export. See docs/adr/0035-three-tier-memory-vocabulary.md
import { handleMemory } from '../cli/commands/memory.js';
import { handleRelay } from '../cli/commands/relay.js';
import { handleAccount } from '../cli/commands/account.js';
import { handleWhois } from '../cli/commands/whois.js';
// Daemon Berths (ADR-0084): `pd dev up/down/list` + `pd use` per-shell targeting.
import { handleDevBerth, handleUse } from '../cli/commands/berths.js';
import { handleSelfUpdate } from '../cli/commands/self-update.js';
import { handleUpgrade } from '../cli/commands/upgrade.js';
import { resolveBerthTargetUrl } from '../shared/daemon-berths.js';
import { readDevDaemonRegistry } from '../cli/utils/berth-registry.js';
import { getDaemonTcpUrl, readDaemonPort, resolveDaemonTcpTarget, DEFAULT_DAEMON_PORT } from '../shared/daemon-discovery.js';
import { calculateRuntimeCodeHash } from '../shared/code-hash.js';
import { DEFAULT_SOCK as _DEFAULT_SOCK, DEFAULT_PORT_FILE as _DEFAULT_PORT_FILE } from '../shared/paths.js';
import {
  hasExplicitDaemonTarget,
  shouldAutoRestartDaemonForFreshness,
  shouldCheckDaemonFreshness,
} from '../cli/utils/freshness.js';
import { maybeNudgeStaleness } from '../cli/utils/staleness-nudge.js';
import { readCurrentContext } from '../cli/utils/current-context.js';
import {
  attachCliSessionWorktreePolicy,
  resolveCliSessionWorktreePolicy,
} from '../cli/utils/session-worktree-policy.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../cli/utils/destructive-confirm.js';
import { resolveTier, tierBadge, TIER_LEGEND, type Tier } from '../cli/permission-tiers.js';

const __dirname: string = dirname(fileURLToPath(import.meta.url));
const PORT_DADDY_URL: string = getDaemonTcpUrl(process.env.PORT_DADDY_URL);
// Primary transport for CLI->daemon communication.
// Falls back to TCP (PORT_DADDY_URL) if socket doesn't exist.
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || _DEFAULT_SOCK;

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
  'status', 'version',
  'ports',               // 'ports cleanup' is Tier 1
  'session', 'sessions', 'takeover',
  'note', 'notes',
]);

const TIER_2_COMMANDS: Set<string> = new Set([
  'pub', 'publish', 'sub', 'subscribe', 'wait', 'broadcast', 'listen', 'tube',
  'agent', 'agents', 'actor', 'actors', 'roster',
  'up', 'down', 'watch', 'swarm', 'fleet',
  'channels', 'webhook', 'webhooks', 'tunnel', 'dns', 'inbox',
  'advise', 'preflight', 'compass', 'guard',
  'metrics', 'health', 'dashboard',
  'bench', 'benchmark', 'demo', 'tuple', 'sortie', 'roadmap',
  'secret', 'secrets', 'skill-graft', 'plan'
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
    _directSessions = createSessions(db, createNoteEncryption());
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
  [key: string]: string | string[] | boolean | undefined;
}

// =============================================================================
// Output Helpers (TTY-aware)
// =============================================================================

/** Whether stdout is a terminal (not a pipe or redirect). FORCE_COLOR enables for scripted demos. */
const IS_TTY: boolean = (process.stderr.isTTY ?? false) || !!process.env.FORCE_COLOR;

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

/** Print context-aware salvage and onboarding hints at launch (TTY only). */
function printLaunchHints(hints: {
  projectName?: string;
  isNewFolder?: boolean;
  uncharted_waters?: boolean;
  salvage?: { total: number; inProject: number; recent: Array<{ id: string; purpose?: string | null; identity?: string | null; minutesAgo?: number | null }> };
  nudges?: Array<{ type: string; message: string; cmd: string }>;
}): void {
  const { salvage, nudges, isNewFolder, uncharted_waters, projectName } = hints;
  if (!salvage && !nudges?.length && !isNewFolder && !uncharted_waters) return;

  const inProject = salvage?.inProject ?? 0;
  const total = salvage?.total ?? 0;

  if (inProject > 0) {
    const n = inProject;
    const agentLines = (salvage?.recent ?? []).map(a => {
      const ago = a.minutesAgo != null ? ` (${a.minutesAgo}m ago)` : '';
      const id = a.identity ? ` [${a.identity}]` : '';
      return `  ${a.purpose ?? a.id}${id}${ago}`;
    }).join('\n');
    const cmd = `pd salvage${projectName ? ` --project ${projectName}` : ''}`;
    ui.warn(`${n} agent${n > 1 ? 's' : ''} from ${projectName || 'this project'} need salvaging`);
    if (agentLines) ui.message(agentLines);
    ui.info(`Run: ${cmd}`);
  } else if (total > 0) {
    ui.info(`${total} agent${total > 1 ? 's' : ''} pending salvage across all projects — run pd salvage`);
  }

  if (isNewFolder || uncharted_waters) {
    const name = projectName || 'this folder';
    const body = [
      `I haven't seen ${name} before. Here's what I can do:`,
      '',
      '  pd init          Full project onboarding (scan, fleet, MCP, git hook)',
      '  pd scan          Detect all services in this project',
      '  pd learn         Interactive tutorial (5 min)',
      '  pd mcp install   Add to your AI agent\'s MCP config',
    ].join('\n');
    ui.note(body, 'New project detected');
  }
}

// =============================================================================
// Connection & Fetch
// =============================================================================

/**
 * Resolve connection target: Unix socket or TCP.
 */
function resolveTarget(): ConnectionTarget {
  if (process.env.PORT_DADDY_FORCE_TCP === '1') {
    return { host: 'localhost', port: readDaemonPort(_DEFAULT_PORT_FILE) };
  }
  // Explicit TCP URL overrides socket
  if (process.env.PORT_DADDY_URL) {
    return resolveDaemonTcpTarget(process.env.PORT_DADDY_URL);
  }
  // Use socket if it exists
  if (existsSync(SOCK_PATH)) {
    return { socketPath: SOCK_PATH };
  }
  // Fallback to TCP
  return { host: 'localhost', port: readDaemonPort(_DEFAULT_PORT_FILE) };
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

function envFirst(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function traceCategoryForCommand(command: string): string {
  if (['look', 'say'].includes(command)) return 'pheromones';
  if (['tuple'].includes(command)) return 'tuples';
  if (['pub', 'publish', 'broadcast', 'sub', 'subscribe', 'listen', 'channels', 'tube'].includes(command)) return 'channels';
  if (['agent', 'agents', 'spawn', 'spawned'].includes(command)) return 'agents';
  if (['session', 'begin', 'done', 'whoami', 'note', 'notes', 'files', 'who-owns', 'advise'].includes(command)) return 'sessions';
  if (['fleet', 'watch', 'sortie', 'transcripts'].includes(command)) return 'fleet';
  if (['lock', 'unlock', 'locks', 'with-lock'].includes(command)) return 'locks';
  if (['claim', 'c', 'release', 'r', 'find', 'list', 'ps', 'services', 'url', 'env', 'ports'].includes(command)) return 'ports';
  if (['salvage'].includes(command)) return 'salvage';
  if (['metrics', 'health', 'status', 'version', 'doctor'].includes(command)) return 'usage';
  return 'other';
}

async function recordCliUsage(
  command: string,
  positional: string[],
  options: CLIOptions,
  status: 'ok' | 'error',
  startedAt: number,
  error?: unknown,
): Promise<void> {
  const body = JSON.stringify({
    surface: 'cli',
    kind: 'command',
    name: `pd ${command}`,
    category: traceCategoryForCommand(command),
    agentId: envFirst(['PORT_DADDY_AGENT', 'PD_AGENT_ID', 'CODEX_AGENT_ID', 'CLAUDE_AGENT_ID']),
    agentType: envFirst(['PORT_DADDY_AGENT_TYPE', 'CODEX_AGENT_TYPE', 'CLAUDE_AGENT_TYPE']) ?? 'cli',
    agentModel: envFirst(['PORT_DADDY_AGENT_MODEL', 'CODEX_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'CLAUDE_MODEL']),
    backend: envFirst(['PORT_DADDY_BACKEND', 'CODEX_BACKEND', 'CLAUDE_BACKEND']),
    model: envFirst(['PORT_DADDY_MODEL', 'CODEX_MODEL', 'OPENAI_MODEL', 'ANTHROPIC_MODEL', 'CLAUDE_MODEL']),
    project: typeof options.identity === 'string' ? options.identity.split(':')[0] : null,
    projectDir: process.cwd(),
    cwd: process.cwd(),
    status,
    durationMs: Date.now() - startedAt,
    workScope: 'port_daddy_call',
    toolCalls: 1,
    version: PKG.version,
    codeHash: getLocalCodeHash(),
    context: {
      positionalCount: positional.length,
      flags: Object.keys(options).sort(),
      direct: Boolean(options.direct),
      json: Boolean(options.json || options.j),
      tty: Boolean(process.stdout.isTTY || process.stderr.isTTY),
    },
    metadata: {
      command,
      node: process.version,
      error: error instanceof Error ? error.message : undefined,
    },
  });

  try {
    await Promise.race([
      pdFetch('/usage/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]);
  } catch {
    // Usage telemetry is best-effort and must not change CLI behavior.
  }
}

// Calculate local code hash to compare with daemon
function getLocalCodeHash(): string {
  return calculateRuntimeCodeHash(join(__dirname, '..'));
}

// Check if daemon is running stale code
// Returns true if daemon was restarted
// Skip when the user explicitly chose a daemon URL or named profile.
async function checkDaemonFreshness(autoRestart: boolean = true, quiet: boolean = false): Promise<boolean> {
  if (hasExplicitDaemonTarget()) return false;
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/version`);
    if (!res.ok) return false;

    const data = await res.json();
    const isInteractive = !!(process.stdout.isTTY || process.stderr.isTTY);
    const localInstallDir = resolve(join(__dirname, '..'));
    const daemonInstallDir = typeof data.installDir === 'string' ? data.installDir : null;
    if (!shouldAutoRestartDaemonForFreshness({
      daemonInstallDir,
      localInstallDir,
      isInteractive,
    })) {
      return false;
    }
    const localHash: string = getLocalCodeHash();

    if (data.codeHash && data.codeHash !== localHash) {
      if (!quiet) ui.warn('Daemon is running stale code — auto-restarting...');

      if (autoRestart) {

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
          stdio: quiet ? 'ignore' : 'inherit',
          detached: true,
          env: {
            ...process.env,
            // Ensure child daemon uses same socket/db as its killer
            PORT_DADDY_SOCK: SOCK_PATH,
            PORT_DADDY_DB: resolveDbPath()
          }
        });
        child.unref();

        // Wait for it to be ready
        for (let i = 0; i < 30; i++) {
          await new Promise<void>(r => setTimeout(r, 100));
          try {
            const healthRes: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/health`);
            if (healthRes.ok) {
              if (!quiet) ui.success('Daemon restarted with fresh code');
              return true;
            }
          } catch {}
        }
        if (!quiet) ui.error('Failed to restart daemon');
        process.exit(1);
      } else {
        // No auto-restart (CI mode)
        if (!quiet) {
          console.error('   Run: port-daddy restart');
          console.error('');
        }
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
  const data = readCurrentContext();
  return data?.sessionId ? data : null;
}

// Maps a command (or alias) to the `pd help <topic>` whose text documents it,
// so `pd <command> --help` shows real help instead of falling through to the
// global help. TOPIC_HELP is keyed by topic name (messaging, sessions, …), NOT
// by command name, so `pd inbox --help` needs this indirection. Exported for
// the help-topic-aliases unit test.
export const HELP_TOPIC_ALIASES: Record<string, string> = {
  // messaging family: durable directed (inbox/send) + ephemeral pub/sub
  inbox: 'messaging', send: 'messaging', sent: 'messaging', tube: 'messaging',
  pub: 'messaging', publish: 'messaging', broadcast: 'messaging',
  sub: 'messaging', subscribe: 'messaging', listen: 'messaging',
  channels: 'messaging', wait: 'messaging',
  claim: 'ports', c: 'ports', release: 'ports', r: 'ports',
  find: 'ports', f: 'ports', list: 'ports', l: 'ports', ps: 'ports', services: 'ports',
  url: 'ports', env: 'ports',
  lock: 'locks', unlock: 'locks',
  begin: 'sugar', done: 'sugar', whoami: 'sugar', 'with-lock': 'sugar',
  n: 'sugar', u: 'sugar', d: 'sugar',
  session: 'sessions', takeover: 'sessions', note: 'sessions', notes: 'sessions',
  feedback: 'sessions',
  agent: 'agents', agents: 'agents', swarm: 'agents', salvage: 'agents', resurrection: 'agents',
  actor: 'actors', actors: 'actors',
  up: 'orchestration', down: 'orchestration', scan: 'orchestration', s: 'orchestration',
  projects: 'orchestration', p: 'orchestration', health: 'orchestration',
  hooks: 'setup', init: 'setup',
  memory: 'semantic', graph: 'semantic',
  advise: 'advisor', preflight: 'advisor', compass: 'advisor',
  secrets: 'secret',
  learn: 'tutorial',
  skillgraft: 'skill-graft',
};

/** Precise per-verb help whose source lives beside the flags it documents. */
export const VERB_HELP: Record<string, string> = {
  attention: ATTENTION_HELP,
  sitrep: SITREP_HELP,
  roster: ROSTER_HELP,
  sent: SENT_HELP,
};

/** Heavy lazy-loaded commands whose own handler remains the help authority. */
export const HANDLER_OWNED_HELP_COMMANDS = new Set(['squid']);

export function shouldDispatchHelpToHandler(command: string): boolean {
  return HANDLER_OWNED_HELP_COMMANDS.has(command);
}

/**
 * Build the compact main help output.
 * Shows context-aware next steps if an active session exists.
 */
function buildHelp(): string {
  const A = marANSI.bold + marANSI.fgCyan;
  const Z = marANSI.reset;
  const G = marANSI.fgGreen;
  const D = marANSI.fgGray;
  const lines: string[] = [];

  // Context-aware: show active session
  const session = readCurrentSession();
  if (session) {
    lines.push(`${A}You're in a session:${Z} ${session.sessionId}${session.purpose ? ` — "${session.purpose}"` : ''}`);
    lines.push(`  ${G}pd note${Z} "progress"     Log what you're doing`);
    lines.push(`  ${G}pd done${Z} "summary"      Wrap it up`);
    lines.push('');
  }

  // Tier badge formatter for help lines. Renders [silent]/[notify]/[approval]/[destructive]
  // in muted gray so the verb stays scannable.
  const tag = (tier: Tier): string => `${D}${tierBadge(tier)}${Z}`;

  lines.push(
    `${A}Get started:${Z}`,
    `  ${G}pd setup${Z}                  ${tag('notify')} Install daemon, MCP, FleetBar, hooks, Guard`,
    `  ${G}pd hooks install${Z}          ${tag('notify')} Wire coordination into claude/codex/gemini/agy (per-project, daemon-gated)`,
    `  ${G}pd begin${Z} "purpose" --lifecycle durable  ${tag('notify')} I'll set up your agent + session`,
    `  ${G}pd done${Z} "summary"        ${tag('notify')} Finish up — I'll clean everything`,
    `  ${G}pd whoami${Z}                ${tag('silent')} See your current context`,
    `  ${G}pd attention${Z}             ${tag('notify')} What other agents queued for you (run first thing!)`,
    '',
    `${A}Ports:${Z}`,
    `  ${G}pd claim${Z} <id>            ${tag('notify')} I'll assign a port  ${D}(c)${Z}`,
    `  ${G}pd release${Z} <id>          ${tag('notify')} Free it up  ${D}(r)${Z}  ${D}(--expired is destructive)${Z}`,
    `  ${G}pd find${Z} [pattern]        ${tag('silent')} What's running  ${D}(f, l, ps)${Z}`,
    '',
    `${A}Sessions & notes:${Z}`,
    `  ${G}pd session start${Z} "why"   ${tag('notify')} Manual session start`,
    `  ${G}pd session takeover${Z} <id> ${tag('notify')} Continue stale work, preserve notes`,
    `  ${G}pd takeover${Z} <id>         ${tag('notify')} Alias for session takeover`,
    `  ${G}pd session abandon${Z}        ${tag('destructive')} End session as abandoned, release claims`,
    `  ${G}pd note${Z} "message"        ${tag('notify')} Leave a note`,
    `  ${G}pd notes${Z}                 ${tag('silent')} Review recent notes`,
    `  ${G}pd feedback${Z} "message"    ${tag('notify')} Drop structured feedback (auto-slug, agent from context)`,
    `  ${G}pd send${Z} <agent> "msg"    ${tag('notify')} Send a durable direct message to one agent`,
    `  ${G}pd inbox${Z}                 ${tag('silent')} Read direct messages sent to you`,
    `  ${G}pd sent${Z}                  ${tag('silent')} Read receipts: messages you sent + if/when read`,
    '',
    `${A}Coordination:${Z}`,
    `  ${G}pd lock${Z} <name>           ${tag('notify')} Grab a distributed lock`,
    `  ${G}pd agent${Z} "task"          ${tag('approval')} One-shot autopilot delegation`,
    `  ${G}pd agents --live${Z}         ${tag('silent')} Active harness roster + session controls`,
    `  ${G}pd agent register${Z}        ${tag('notify')} Register as an agent`,
    `  ${G}pd salvage${Z}               ${tag('silent')} List a dead agent's work  ${D}(claim/dismiss are destructive)${Z}`,
    `  ${G}pd actors${Z}                ${tag('silent')} Inspect durable actor roster`,
    `  ${G}pd advise${Z}                ${tag('silent')} Suggest coordination moves before editing`,
    `  ${G}pd guard${Z}                 ${tag('silent')} Enforce session + file-claim discipline  ${D}(install/enable/disable destructive)${Z}`,
    `  ${G}pd graph stats${Z}           ${tag('silent')} Inspect semantic graph totals`,
    `  ${G}pd memory episodes${Z}       ${tag('silent')} Inspect episodic memory`,
    `  ${G}pd memory tiers${Z}          ${tag('silent')} Core/Recall/Archival mapping with live counts`,
    `  ${G}pd ideas search${Z} "text"   ${tag('silent')} Search ideas, notes, tuples, and repo markdown`,
    `  ${G}pd roadmap${Z}               ${tag('silent')} Show Cartographer's current roadmap projection`,
    `  ${G}pd skill-graft${Z} "task"     ${tag('silent')} Preview native skill guidance for fleet ships`,
    `  ${G}pd secret list${Z}           ${tag('silent')} Manage keychain-backed provider credentials`,
    `  ${G}pd daemon list${Z}           ${tag('silent')} Inspect named sidecar daemon profiles`,
    '',
    `${A}Permission tiers:${Z}`,
    TIER_LEGEND,
    '',
    `${D}pd help <topic> for details — topics: setup, sessions, locks, agents, actors, ports, messaging, dns, orchestration, sugar, semantic, advisor, guard, ideas, roadmap, skill-graft, secret, daemon, tutorial${Z}`,
    `${D}Dashboard: ${PORT_DADDY_URL}  •  Tutorial: pd learn${Z}`,
  );

  return lines.join('\n');
}

/**
 * Topic-specific detailed help maps.
 * Each topic shows relevant commands with flags and examples.
 */
export const TOPIC_HELP: Record<string, string> = {
  setup: `Setup — Install the full local Port Daddy environment

Commands:
  setup                     Install daemon, MCP, FleetBar, Pilot, project hooks, and Guard
    --project <path>        Initialize a specific project directory
    --no-daemon             Skip daemon installation/start
    --no-mcp                Skip MCP + shell hook installation
    --no-fleetbar           Skip FleetBar install (macOS)
    --no-skill              Skip Port Daddy agent skill symlink
    --no-agents             Skip Port Daddy Pilot agent definitions
    --no-harness            Skip Squid hooks and Coordination Guard
    --no-squid-hooks        Skip agent hook installation only
    --no-guard              Skip Coordination Guard hook installation only
    --status                Show cross-tool skill sync status only
    --skill-status          Alias for --status
    --dry-run               Preview cross-tool skill sync without writing links
    --no-init               Skip project initialization
    --no-fleet              Pass through to pd init
    --no-hook               Pass through to pd init

Examples:
  pd setup
  pd setup --status
  pd setup --project ~/coding/workgroup-ai
  pd setup --no-fleetbar
  pd setup --no-skill
  pd setup --no-init
  pd setup --no-harness

Agent-CLI hooks (per-project, daemon-gated):
  pd hooks install              Wire claude/codex/gemini/agy for THIS project
  pd hooks install --user       Also write user-level config for claude/gemini
  pd hooks list                 Show detected CLIs + wiring status
  pd hooks uninstall            Remove Port Daddy hooks from every surface`,

  sessions: `Sessions & Notes \u2014 Structured multi-agent coordination

Commands:
  session start <purpose>    Start a new session
    --agent <id>             Associate with an agent
    --force                  Force start even if another session is active
    --lifecycle <mode>       Required: durable for work contexts, ephemeral for heartbeat-bound process sessions
    --files <paths...>       Claim files at session start
    --allow-main-worktree    Explicitly allow an integration session in the main worktree

  session end [note]         End the active session (completed)
    --no-pr                  Bypass mandatory PR URL check
    --subtask                Bypass mandatory PR URL check (subtask code delivery)
  session done [note]        Alias for "session end"
  session abandon [note]     End active session (abandoned)
  session takeover <id> [note]  Create successor; preserve predecessor notes
  takeover <id> [note]       Alias for "session takeover"
  session rm <id>            Archive a session; preserve notes
  session files add <paths>  Claim files in active session
  session files rm <paths>   Release files from active session
    compat aliases           claim -> add, release -> rm

  sessions                   List sessions (active only by default)
    --all                    Show all sessions (including completed)
    --status <s>             Filter by status
    --all-worktrees          Show sessions from all worktrees
    -j, --json               Output as JSON

  note <content>             Quick note (auto-creates session if needed)
    --type <type>            Note type: progress, decision, blocker, etc.

  notes [session-id]         View notes for a session or project-scoped recent notes
    --limit <n>              Limit number of notes
    --type <type>            Filter by note type
    --project <slug>         Scope recent notes to one project
    --all-projects           Intentional global recent-notes read
    -j, --json               Output as JSON

  feedback "<message>"       Drop structured feedback (bare form)
    --severity <s>           low | medium | high | critical
    --surface <s>            CLI | API | MCP | Roadmap | ...
    --hook <text>            What you were doing when you noticed
    --suggest <text>         Suggested fix
    --as <agentId>           Override droppedBy (defaults to active session/agent)
  feedback list              List feedback (filter by --severity, --surface, --status)
  feedback show <id>         Show one entry
  feedback harvest <id>      Mark as harvested into roadmap
  feedback summary           Counts by severity + surface

Examples:
  pd session start "Building auth module" --agent agent-42 --lifecycle durable
  pd note "Finished login endpoint" --type progress
  pd notes --limit 10
  pd feedback "tests dropped from 1638 to 1620 — investigate" --severity high
  pd session files add src/auth.ts src/login.ts
  pd session end "Auth module complete"
  pd sessions --all --json`,

  locks: `Distributed Locks \u2014 Exclusive access for shared resources

Commands:
  lock <name-or-path>      Acquire a distributed lock
    --ttl <ms>             Time-to-live (default: 300000 = 5 min)
    --owner <id>           Lock owner identifier
    --wait                 Block until lock is available
    --timeout <ms>         Wait timeout (default: 60000)

  lock extend <name-or-path>
                           Extend a lock's TTL
    --ttl <ms>             New TTL from now

  unlock <name-or-path>    Release a distributed lock
    --force                Release even if not the owner

  locks                    List all active locks
    -j, --json             Output as JSON

Examples:
  pd lock db-migrations && npm run migrate && pd unlock db-migrations
  pd lock lib/webhooks.ts --owner codex
  pd lock deploy --ttl 600000 --owner ci-pipeline
  pd lock extend deploy --ttl 300000
  pd locks --json`,

  agents: `Agent Registry \u2014 Track active agents with heartbeats

Commands:
  agent "task text"         Run a one-shot pd agent autopilot task
  agent run "task text"     Explicit autopilot form

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
    --live, --roster       Show active harness lanes, worktrees, files, and control commands
    --project <name>       Filter the live roster by project
    --limit <n>            Cap live roster rows
    -j, --json             Output as JSON

  salvage                  Check resurrection queue for dead agents
    --project <name>       Filter by project
    --stack <name>         Filter by stack

  salvage triage           Cluster queue into resume / verify-dismiss / test-noise buckets
    --json                 Machine-readable queue for future idle-agent pull loops

  salvage next             Print one bounded queue item for an idle agent
    --bucket <id>          Pull a specific bucket instead of resume-now/archive-later
    --claim                Claim the selected claimable item immediately
    --json                 Machine-readable single-item queue pull

  salvage claim <id>       Claim a dead agent's work to continue

Examples:
  pd agent register --agent build-42 --identity myapp:api --purpose "Building auth"
  pd agent heartbeat --agent build-42
  pd agents --active --json
  pd agents --live --project port-daddy
  pd salvage --project myapp
  pd salvage triage --project myapp
  pd salvage next --project myapp --json
  pd salvage claim dead-agent-99`,

  actors: `Actors \u2014 Durable coordination souls and live body signals

Commands:
  actors                    List canonical actors and live lease signals
    --project <name>        Filter live session/agent/salvage evidence by project
    --limit <n>             Limit session/salvage evidence per actor
    -j, --json              Output as JSON

  actor <id-or-alias>       Show one actor by canonical id or alias
                            Examples: cartographer, coxswain, qa
    --project <name>        Filter live evidence by project
    --message <text>        Queue a message to the actor mailbox
    --inbox                 Read recent actor mailbox messages
    --inbox-stats           Show actor mailbox depth
    --unread                With --inbox, only show unread messages
    --mark-read             With --inbox, mark that actor mailbox read after printing
    --wake                  Try to hail the compatibility fleet body, if one exists
    -j, --json              Output as JSON

Canonical actors (mirror lib/actor-roster.ts ACTOR_ROSTER):
  gardener                  Working-tree hygiene, uncommitted-state drift
  qa                        Tests, validation, evidence, signal quality
  test-hunter               Coverage gaps, test quality, tautology / mock-echo flags
  documentarian             Docs, OpenAPI, CLI, MCP, website, and skill drift
  simplifier                Complexity reduction; deletion preferred over addition
  coxswain                  Claims, locks, stale assets, channels, tuples, comm-pipeline debug
  quartermaster             Backends, models, spawn discipline, telemetry policy, budget
  cartographer              Roadmap, recovery ledger, work-slice evidence, feedback harvest
  spark                     Idea generation, deduped against the canonical idea trove
  spider                    Combinatorial connections; new capabilities implied by combinations

Functional aliases:
  tree, wip \u2192 gardener           validation, evidence \u2192 qa
  hunter, coverage \u2192 test-hunter docs, drift \u2192 documentarian
  shrink, reduce \u2192 simplifier    roadmap, mapmaker \u2192 cartographer
  ideator, proposer \u2192 spark      weaver, connector \u2192 spider
  claim-owner, lock-owner, ownership, contention, comms-officer, signaler \u2192 coxswain
  spend, budget, backend-owner, model-owner, launch-readiness \u2192 quartermaster

Examples:
  pd actors --project port-daddy
  pd actor cartographer
  pd actor cartographer --message "roadmap item needs evidence"
  pd actor cartographer --inbox --unread
  pd actor cartographer --inbox --unread --mark-read
  pd actor coxswain --json`,

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

  messaging: `Inter-agent messaging \u2014 durable direct messages + ephemeral pub/sub

Direct durable messages (RELIABLE \u2014 survives the recipient being offline):
  pd send <agent> <message>       Send a durable direct message to one agent
  pd inbox [list|stats|read-all]  Read messages others sent you (default: list)
  pd sent [--unread]              Read receipts: messages YOU sent + if/when read

Reliability:
  The pub/sub below is an EPHEMERAL SSE stream \u2014 it times out and is only
  received by a subscriber holding the stream open live. A turn-based agent
  cannot hold a stream open, so for durable agent-to-agent handoffs prefer
  \`pd send\`/\`pd inbox\` or \`pd note\` (both durable), NOT pub/sub.

Pub/Sub (ephemeral, real-time) commands:
  pub <channel> <message>  Publish a message to a channel
    --sender <id>          Sender identifier
    --dir <path>           Resolve declared logical channels for this worktree
    --raw-channel          Bypass logical-channel resolution and use the literal string

  sub <channel>            Subscribe to a channel (real-time SSE stream)
    --dir <path>           Resolve declared logical channels for this worktree
    --raw-channel          Bypass logical-channel resolution and use the literal string

  wait <id> [ids...]       Wait for service(s) to become healthy
    --timeout <ms>         Wait timeout (default: 60000)

  channels                 List active pub/sub channels
  channels discover [q]    Discover declared channels for this repo/worktree
    --dir <path>           Resolve git/worktree context from this project dir
    --observed             Include observed undeclared raw channels
  channels ensure <name>   Declare/update a canonical git-sensitive channel
    --scope <scope>        branch | worktree | repo | global (default: branch)
    --aliases a,b          Alternate names that resolve to this channel
  channels describe <name> Resolve a logical channel to its physical name
  channels clear <name>    Clear messages from a channel
    --dir <path>           Resolve declared logical channels for this worktree
    --raw-channel          Bypass logical-channel resolution and use the literal string

Note:
  Declared logical channels auto-resolve in the current repo/worktree for pub, sub, and channels clear.
  Use --raw-channel only when you intentionally want the literal channel string.

Examples:
  pd pub build:done '{"status":"success"}'
  pd sub build:done
  pd channels discover tauri
  pd channels ensure tauri:desktop --aliases desktop:probe --scope branch
  pd channels describe tauri:desktop
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
    --lifecycle <mode>     Required: durable for work contexts, ephemeral for heartbeat-bound process sessions
    --allow-main-worktree  Explicitly allow an integration session in the main worktree

  done "summary"           End session + unregister agent atomically
                           Cleans up .portdaddy/current.json
    --self-salvage         Queue unfinished-but-doable telos for salvage
    --why-stopped <text>   Explain why the telos was not fulfilled
    --next-plan <text>     Leave the next concrete continuation move
    --no-pr                Bypass mandatory PR URL check
    --subtask              Bypass mandatory PR URL check (subtask code delivery)

  whoami                   Show current agent/session context
                           Reads from .portdaddy/current.json

  with-lock <name> <cmd>   Acquire lock, run command, release lock
                           Lock is always released, even on failure

Aliases:
  n <content>              Alias for "note"
  u                        Alias for "up"
  d                        Alias for "down"

Examples:
  pd begin "Building auth module" --lifecycle durable
  pd note "Login endpoint done"
  pd done "Auth module complete"
  pd done --self-salvage --telos-verdict not-fulfilled --doable yes --why-stopped "Tests still red" --next-plan "Fix parser fixture and rerun npm test"
  pd whoami
  pd with-lock db-migrations npm run migrate`,

  semantic: `Semantic Coordination Surfaces \u2014 Inspect graph edges and episodic memory

Commands:
  graph edges               List semantic graph edges
    --dir <path>            Project directory filter
    --scope <scope>         Scope filter
    --source-type <type>    Source entity type
    --source-id <id>        Source entity id
    --edge-type <type>      Edge type
    --target-type <type>    Target entity type
    --target-id <id>        Target entity id
    --query <text>          Text search
    --limit <n>             Max edges to return

  graph stats               Summarize graph edge counts
    --dir <path>            Project directory filter

  memory episodes           List episodic memory entries
    --dir <path>            Project directory filter
    --project <name>        Logical project filter
    --harbor <name>         Harbor filter
    --agent <id>            Agent filter
    --type <kind>           Episode type filter
    --query <text>          Text search
    --limit <n>             Max episodes to return

  memory stats              Summarize episodic memory counts
    --dir <path>            Project directory filter
    --project <name>        Logical project filter

  memory tiers              Print Core/Recall/Archival mapping with live counts
  memory tier <construct>   Print the tier for one construct
  memory summary            One-line-per-tier rollup
    --json, -j              Machine-readable output (stable schema)
    --quiet, -q             Bare value

Examples:
  pd graph edges --scope symbols:file:/abs/path.ts
  pd graph stats --dir /Users/you/coding/port-daddy
  pd memory episodes --project port-daddy --type handoff
  pd memory stats --dir /Users/you/coding/port-daddy
  pd memory tiers
  pd memory tier active-file-claims
  pd memory summary --json

See: docs/adr/0035-three-tier-memory-vocabulary.md`,

  advisor: `Advisor / Compass \u2014 Suggest coordination moves before editing

Commands:
  advise [files...]         Inspect current context, file claims, symbols, salvage, channels, tuples, and lock candidates
  preflight [files...]      Alias for advise, intended before a risky edit
  compass [files...]        Maritime alias for advise
    --task <text>           Describe the intended work
    --session <id>          Explicit session ID
    --agent <id>            Explicit agent ID
    --dir <path>            Project root
    --channels              Include channel suggestions even if task text is ambiguous
    --tuples                Include tuple suggestions even if task text is ambiguous
    --json                  Machine-readable advice objects

Examples:
  pd advise lib/sessions.ts --task "fix file claim conflict"
  pd preflight docs/recovery/CURRENT-WORK.md --tuples
  pd compass --task "handoff blocker to another agent" --channels`,

  guard: `Coordination Guard \u2014 Enforce Port Daddy coordination discipline

Commands:
  guard status              Show active session, checked files, and violations
  guard check [files...]    Verify current dirty files or explicit files
    --staged                Check staged files only, for pre-commit hooks
    --mode <mode>           off | warn | enforce
    -j, --json              Machine-readable result

  guard enable              Write project config in enforce mode
    --mode <warn|enforce>   Select enforcement strength
  guard disable             Turn checks off for this project
  guard install             Install/update the managed pre-commit hook block
    --mode <warn|enforce>   Default: enforce

What it enforces:
  - an active Port Daddy session exists
  - changed files are claimed by the active session
  - files claimed by another active session block in enforce mode

Examples:
  pd guard status
  pd guard check --staged --mode enforce
  pd guard enable --mode enforce
  pd guard install --mode enforce`,

  ideas: `Ideas Search \u2014 Search canonical ideas plus live repo memory

Commands:
  ideas list                List curated ideas/families from docs/recovery/IDEAS-TROVE.md
    --dir <path>            Project directory filter
    --status <status>       Filter by now|backlog|parked|merge|local
    --limit <n>             Limit results
    --include-raw           Include local .spark/.spider residue not promoted into the trove

  ideas search <query>      Federated search across ideas, notes, tuples, and repo markdown
    --dir <path>            Project directory filter
    --status <status>       Filter by now|backlog|parked|merge|local
    --limit <n>             Limit results
    --sources <list>        trove,raw,notes,tuples,markdown,all
    --include-raw           Include local .spark/.spider residue

  ideas show <slug>         Show one idea/family in detail
    --dir <path>            Project directory filter
    --include-raw           Include raw residue lookups

Examples:
  pd ideas list --status now
  pd ideas search "salvage disconnect" --include-raw
  pd ideas search "phase 3 parity debt" --sources markdown
  pd ideas show tuple-driven-fleet`,

  roadmap: `Roadmap Projection \u2014 Cartographer-curated work for agents

Commands:
  roadmap                   Show roadmap_items DB-of-record entries
    --dir <path>            Project directory (defaults to cwd)
    --limit <n>             Limit rows per section (default: 8)
    --status <s>            now|backlog|parked|merge|done|all
    --harbor <h>            Harbor scope
    -q, --quiet             Print one slug per line
    -j, --json              Output raw roadmap_items rows

  roadmap upsert <slug>     Create/update a durable roadmap item receipt
    --summary <md>          Roadmap summary markdown
    --status <s>            now|backlog|parked|merge|done
    --as <agentId>          Actor recorded on the receipt
    --note <text>           Receipt note attached to the item
    --harbor <h>            Target harbor (default: repo/project name, then $PD_HARBOR)

  roadmap delete <slug>     Remove a roadmap item (and its status-event audit rows)
    --harbor <h>            Harbor to delete from (default: repo/project name)

  roadmap touch <slug>      Append a roadmap receipt note to an existing item
    --as <agentId>          Actor recorded on the receipt
    --note <text>           Why this slice touched the roadmap

  roadmap ack <feedbackId>  Harvest/ack live feedback through the feedback primitive
    --as <agentId>          Harvester id (default: operator-cli)
    --into <roadmap-slug>   Roadmap slug the feedback was folded into

Examples:
  pd roadmap
  pd roadmap --limit 3 --status now
  pd roadmap --dir /Users/you/coding/port-daddy --json
  pd roadmap upsert swarm-coordination --summary "Governed swarm coordination" --status now
  pd roadmap touch swarm-coordination --note "Phase 0 parley implementation"
  pd roadmap ack 5a8e37de --as cartographer --into coordination-guard`,

  'skill-graft': `Skill Graft — Native local skill guidance for fleet ships

Commands:
  skill-graft "<task>"           Shorthand for query
  skill-graft query "<task>"     Rank local skills and render bounded guidance
    --root <path>                Project root to scan (default: cwd)
    --shortlist-limit <n>        Number of cheap matches to show
    --top-limit <n>              Number of full SKILL.md bodies to include
    --body-chars <n>             Hard cap per inlined SKILL.md body
    --json                       Emit the structured SkillGraftResult

  skill-graft warm               Rescan skills and precompute Tool2Vec centroids when explicitly configured
  skill-graft reference <id> <path>
                                 Read one file from inside a skill directory

This is the same lib/skill-graft.ts index used by lib/fleet-engine.ts when a
pd-fleet.yml ship opts into skill_graft: true. Query is safe on a cold cache:
it scans local skills and ranks via BM25 until Tool2Vec centroids are warmed.

Examples:
  pd skill-graft "write tests for a flaky fleet trigger"
  pd skill-graft warm --json
  pd skill-graft reference rag-retrieval-pattern-design scripts/audit.mjs`,

  secret: `Managed Secrets \u2014 keychain-backed provider credentials

The store is the OS keychain (macOS Keychain), encrypted at rest and
fail-closed. Only allow-listed provider keys are accepted. Values are never
printed by set/list; reveal exists for the menu-bar Copy flow and is
loopback-only on the daemon side.

Commands:
  secret set <KEY> [--backend <b>]   Store a value via a HIDDEN stdin prompt.
                                     The value is NEVER read from argv (it would
                                     leak to shell history + ps). Pipe-friendly:
                                     echo "$TOKEN" | pd secret set KEY
  secret list                        Table of KEY, BACKEND, STORAGE, ENCRYPTED,
                                     SET? \u2014 names + status only, never values.
  secret reveal <KEY> [--copy]       Print the value (with a warning), or with
                                     --copy pipe to pbcopy (auto-clears in 45s)
                                     and print nothing.
  secret rm <KEY>                    Remove the value from the keychain.

Examples:
  pd secret set ANTHROPIC_API_KEY
  pd secret list
  pd secret reveal GEMINI_API_KEY --copy
  pd secret rm CLOUDFLARE_API_TOKEN`,

  daemon: `Daemon Profiles \u2014 Named sidecar daemons beside the canonical daemon

Commands:
  daemon list                         List named sidecar profiles
  daemon status <profile>             Show one profile's runtime, socket, DB, and URL
  daemon start <profile>              Start an isolated profile
    --port <port>                     Preferred TCP port (falls forward if busy)
    --fleet                           Allow this profile to arm fleet runners
    --fleetbar                        Allow this profile to launch FleetBar
    --force                           Replace an unhealthy live PID for this profile
  daemon stop <profile>               Stop a named profile
    --force                           Escalate to SIGKILL if SIGTERM does not exit
  daemon env <profile>                Print shell exports to target that profile

Examples:
  pd daemon start dev --port 9877
  pd daemon list
  eval "$(pd daemon env dev)"
  pd daemon stop dev`,

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

/** The exact resolver used by `pd <verb> --help`; null means honest global help. */
export function resolveVerbHelp(command: string): string | null {
  return TOPIC_HELP[command] ?? VERB_HELP[command] ?? TOPIC_HELP[HELP_TOPIC_ALIASES[command]] ?? null;
}

// HELP is built lazily via getHelp() for context-aware output

// =============================================================================
// Command Suggestion (fuzzy "did you mean?")
// =============================================================================

export const ALL_COMMANDS: string[] = [
  'claim', 'c', 'release', 'r', 'find', 'f', 'list', 'l', 'ps', 'url', 'env',
  'pub', 'publish', 'broadcast', 'sub', 'subscribe', 'listen', 'tube', 'wait', 'lock', 'unlock', 'locks',
  'up', 'down', 'setup', 'init', 'cut', 'batten', 'scan', 's', 'projects', 'p',
  'agent', 'agents', 'actor', 'actors', 'roster', 'swarm', 'inbox', 'send', 'sent', 'log', 'activity',
  'wallet', 'bond',
  'session', 'sessions', 'takeover', 'note', 'notes', 'say',
  'begin', 'done', 'whoami', 'account', 'attention', 'nudge', 'with-lock', 'learn',
  'n', 'u', 'd',
  'dashboard', 'channels', 'webhook', 'webhooks', 'metrics', 'config', 'health', 'ports',
  'start', 'stop', 'restart', 'status', 'install', 'install-bosun', 'uninstall', 'dev', 'use', 'daemon', 'ci-gate', 'self-update', 'upgrade',
  'doctor', 'diagnose', 'hints', 'mcp', 'version', 'help', 'bench', 'benchmark', 'look', 'sitrep', 'roadmap',
  'advise', 'preflight', 'compass', 'guard', 'hooks',
  'salvage', 'resurrection', 'changelog', 'booty', 'tunnel',
  'services', 'dns', 'briefing', 'integration', 'pheromone', 'ph',
  'b', 'w', 'who-owns', 'history', 'tutorial', 'files', 'add', 'snapshots', 'snapshot', 'backup', 'restore', 'attest', 'shipwright',
  'spawn', 'spawned', 'watch', 'work', 'transcripts', 'transcript', 'relay',
  'harbor', 'harbors', 'harbor-ledger', 'whois', 'demo', 'fleet', 'backend', 'squid', 'tuple', 'sortie', 'graph', 'embed', 'skill-graft', 'skillgraft', 'memory', 'ideas',
  'quorum', 'parley',
  'feedback',
  'commit', 'obligations',
  'secret', 'secrets',
  'cockpit',
  'popper',
  'harbormaster', 'hm',
  'dispatch', 'nightshift', 'review', 'morning',
  'backend',
  'periscope', 'sight', 'scope',
  'coast-guard', 'cg',
  'safe',
  'relay',
  'plan',
  'suggest',
  'seamanship', 'skills',
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

function maybeRelaunchShortBinary(): void {
  if (process.env.PORT_DADDY_DISABLE_SHORT_REEXEC === '1') return;

  const execPath = process.execPath || '';
  const argv0 = process.argv[0] || '';
  const invokedAsPd = basename(execPath) === 'pd' || basename(argv0) === 'pd';
  if (!invokedAsPd) return;

  const sibling = join(dirname(execPath), 'port-daddy');
  if (sibling === execPath || !existsSync(sibling)) return;

  const result = spawnSync(sibling, process.argv.slice(2), {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT_DADDY_DISABLE_SHORT_REEXEC: '1',
    },
  });

  if (result.error) {
    ui.error(`Failed to relaunch sibling port-daddy binary: ${result.error.message}`);
    process.exit(127);
  }
  if (result.signal) {
    const signalNumber = result.signal === 'SIGINT' ? 2 : result.signal === 'SIGTERM' ? 15 : 1;
    process.exit(128 + signalNumber);
  }
  process.exit(result.status ?? 0);
}

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
  if (command === 'takeover') {
    command = 'session';
    positional = ['takeover', ...positional];
  }

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
      if (process.env.DEBUG_TESTS) console.error(`[DEBUG] executeDirectMode claim options: ${JSON.stringify(options)}`);
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
        ui.error(result.error || 'Failed to claim port');
        process.exit(1);
      }

      // In direct mode, verify port is actually free at OS level
      if (!result.existing) {
        const portFree = await isPortAvailable(result.port as number);
        if (!portFree && IS_TTY) {
          ui.warn(`port ${result.port} is assigned but appears in use by another process`);
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
          ui.success(`${highlightChannel(result.id as string)} → port ${result.port}`);
          if (result.existing) console.error('  (reused existing)');
        }
        process.stdout.write(`${result.port}\n`);
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
          ui.success(result.message as string);
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
        ui.error(result.error || 'Failed to release');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (options.quiet) {
        console.log(result.released);
      } else {
        ui.success(result.message as string);
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

      if (IS_TTY) {
        // Maritime signal flag banner
        const fl = [SignalFlags.charlie, SignalFlags.november, SignalFlags.kilo, SignalFlags.uniform, SignalFlags.alpha];
        for (let row = 0; row < 2; row++) {
          console.error('  ' + fl.map(f => f()[row]).join('   '));
        }
        console.error('');
      }

      console.error(
        marANSI.fgGray + 'ID'.padEnd(35) + 'PORT'.padEnd(8) + 'STATUS'.padEnd(12) + 'URL' + marANSI.reset
      );
      console.error(marANSI.fgGray + '\u2500'.repeat(75) + marANSI.reset);

      const services = result.services as Array<{ id: string; port: number; status: string }>;
      for (const s of services) {
        const statusColor = s.status === 'assigned' ? marANSI.fgGreen : marANSI.fgYellow;
        console.error(
          marANSI.fgCyan + s.id.padEnd(35) + marANSI.reset +
          marANSI.fgGreen + marANSI.bold + String(s.port).padEnd(8) + marANSI.reset +
          statusColor + s.status.padEnd(12) + marANSI.reset +
          marANSI.fgGray + `http://localhost:${s.port}` + marANSI.reset
        );
      }
      console.error('');
      console.error(marANSI.fgGray + `Total: ${result.count} service(s)` + marANSI.reset);
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
          ui.error(result.error || 'Failed to extend lock');
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
        ui.error(result.error || 'Failed to acquire lock');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (options.quiet) {
        // Silent success for scripting
      } else {
        ui.success(`Acquired lock: ${name}`);
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
        ui.error(result.error || 'Failed to release lock');
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (!options.quiet) {
        if (result.released) {
          ui.success(`Released lock: ${name}`);
        } else {
          ui.warn(`Lock '${name}' was not held`);
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
      const ver = PKG.version;

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
        console.error('Usage: port-daddy session <start|end|done|abandon|takeover|rm> [args]');
        process.exit(1);
      }

      switch (subcommand) {
        case 'start': {
          const purpose = rest[0];
          if (!purpose) {
            console.error('Usage: port-daddy session start <purpose> --lifecycle durable|ephemeral [--agent AGENT_ID] [--force]');
            process.exit(1);
          }

          const lifecycle = typeof options.lifecycle === 'string' ? options.lifecycle.trim().toLowerCase() : '';
          if (lifecycle !== 'durable' && lifecycle !== 'ephemeral') {
            console.error('Usage: port-daddy session start <purpose> --lifecycle durable|ephemeral [--agent AGENT_ID] [--force]');
            process.exit(1);
          }

          const startOpts: Record<string, unknown> = {};
          const current = readCurrentSession();
          const agentId = typeof options.agent === 'string'
            ? options.agent
            : current?.agentId || `cli-${process.pid}`;
          if (agentId) startOpts.agentId = agentId;
          if (options.force) startOpts.force = true;
          startOpts.durable = lifecycle === 'durable';

          // Collect files: --files may appear as a single string (one occurrence)
          // or an array (repeated --files flags). Positional tail also accepted.
          const files: string[] = [];
          if (typeof options.files === 'string') files.push(options.files);
          else if (Array.isArray(options.files)) files.push(...(options.files as string[]));
          for (let i = 1; i < rest.length; i++) {
            if (!rest[i].startsWith('-')) files.push(rest[i]);
          }
          if (files.length > 0) startOpts.files = files;

          const worktreePolicy = resolveCliSessionWorktreePolicy(options);
          if (!worktreePolicy.success) {
            ui.error(worktreePolicy.error || 'Session worktree policy failed');
            if (worktreePolicy.hint) console.error(`  ${worktreePolicy.hint}`);
            process.exit(1);
          }
          attachCliSessionWorktreePolicy(startOpts, worktreePolicy);
          if (worktreePolicy.worktree) startOpts.worktreeId = worktreePolicy.worktree.id;

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
            ui.success(`Started session: ${sessionId}`);
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
            ui.error('No active session found');
            process.exit(1);
          }

          const sessionId = sessionsList[0].id;
          const endOpts: Record<string, unknown> = { status };
          if (note) endOpts.note = note;

          const result = sess.end(sessionId, endOpts as Parameters<typeof sess.end>[1]);

          if (!result.success) {
            ui.error(result.error || 'Failed to end session');
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify({ success: true, id: sessionId, status }, null, 2));
          } else if (!options.quiet) {
            ui.success(`Ended session: ${sessionId}`);
            console.log(`  Status: ${status}`);
          }
          break;
        }

        case 'abandon': {
          const note = rest[0];

          const listResult = sess.list({ status: 'active', limit: 1 });
          const sessionsList = (listResult as Record<string, unknown>).sessions as Array<{ id: string }>;
          if (!sessionsList || sessionsList.length === 0) {
            ui.error('No active session found');
            process.exit(1);
          }

          const sessionId = sessionsList[0].id;
          const result = sess.abandon(sessionId);

          if (!result.success) {
            ui.error(result.error || 'Failed to abandon session');
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify({ success: true, id: sessionId, status: 'abandoned' }, null, 2));
          } else if (!options.quiet) {
            ui.warn(`Abandoned session: ${sessionId}`);
          }
          break;
        }

        case 'takeover': {
          const sessionId = rest[0];
          if (!sessionId) {
            console.error('Usage: port-daddy session takeover <id> [note]');
            process.exit(1);
          }

          const current = readCurrentSession();
          const agentId = typeof options.agent === 'string'
            ? options.agent
            : current?.agentId || `cli-${process.pid}`;
          const takeoverOpts: Record<string, unknown> = {
            agentId,
            note: rest.slice(1).join(' ') || undefined,
            purpose: typeof options.purpose === 'string' ? options.purpose : undefined,
            claimFiles: !(options['no-files'] || options['no-claims']),
          };

          const lifecycle = typeof options.lifecycle === 'string' ? options.lifecycle.trim().toLowerCase() : '';
          if (lifecycle) {
            if (lifecycle !== 'durable' && lifecycle !== 'ephemeral') {
              console.error('Usage: port-daddy session takeover <id> [note] --lifecycle durable|ephemeral');
              process.exit(1);
            }
            takeoverOpts.durable = lifecycle === 'durable';
          }

          const worktreePolicy = resolveCliSessionWorktreePolicy(options);
          if (!worktreePolicy.success) {
            ui.error(worktreePolicy.error || 'Session worktree policy failed');
            if (worktreePolicy.hint) console.error(`  ${worktreePolicy.hint}`);
            process.exit(1);
          }
          attachCliSessionWorktreePolicy(takeoverOpts, worktreePolicy);
          if (worktreePolicy.worktree) takeoverOpts.worktreeId = worktreePolicy.worktree.id;

          const result = sess.takeover(sessionId, takeoverOpts as Parameters<typeof sess.takeover>[1]);
          if (!result.success) {
            ui.error(typeof result.error === 'string' ? result.error : 'Failed to take over session');
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else if (options.quiet) {
            console.log(result.successorId);
          } else {
            ui.success(`Took over session: ${sessionId}`);
            console.log(`  Successor: ${result.successorId}`);
            console.log('  Notes preserved: yes');
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
            console.error(result.error || 'Failed to archive session');
            process.exit(1);
          }

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else if (!options.quiet) {
            console.log(`Archived session: ${sessionId}`);
            console.log('  Notes preserved: yes');
          }
          break;
        }

        case 'files': {
          const rawFilesCmd = rest[0];
          const filesCmd = rawFilesCmd === 'claim'
            ? 'add'
            : rawFilesCmd === 'release'
              ? 'rm'
              : rawFilesCmd;
          if (!filesCmd || !['add', 'rm'].includes(filesCmd)) {
            console.error('Usage: port-daddy session files <add|rm> <paths...>');
            console.error('       Compatibility aliases: claim -> add, release -> rm');
            process.exit(1);
          }

          const paths = rest.slice(1);
          if (paths.length === 0) {
            console.error(`Usage: port-daddy session files ${filesCmd} <paths...>`);
            process.exit(1);
          }

          const current = readCurrentSession();
          const agentId = typeof options.agent === 'string'
            ? options.agent
            : current?.agentId || `cli-${process.pid}`;
          const listResult = sess.list({ status: 'active', agentId, limit: 1 });
          const sessionsList = (listResult as Record<string, unknown>).sessions as Array<{ id: string }>;
          if (!sessionsList || sessionsList.length === 0) {
            console.error('No active session found');
            process.exit(1);
          }

          const sessionId = sessionsList[0].id;

          if (filesCmd === 'add') {
            const result = sess.claimFiles(sessionId, paths, { agentId });
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
            const result = sess.releaseFiles(sessionId, paths, { agentId });
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
      const context = readCurrentContext();
      const noteOpts: Record<string, unknown> = {};
      if (options.type) noteOpts.type = options.type;
      const explicitSessionId = typeof options.session === 'string' ? options.session : undefined;
      const explicitAgentId = typeof options.agent === 'string' ? options.agent : undefined;
      let sessionId = explicitSessionId;
      let agentId = explicitAgentId;

      if (!sessionId && !explicitAgentId && context?.sessionId) {
        const currentSession = sess.get(context.sessionId) as { success?: boolean };
        if (currentSession?.success) {
          sessionId = context.sessionId;
          agentId = context.agentId;
        }
      }

      if (!sessionId && !agentId && context?.agentId) {
        const activeForAgent = sess.list({
          status: 'active',
          agentId: context.agentId,
          allWorktrees: true,
          limit: 1,
        }) as { success?: boolean; sessions?: unknown[] };
        if (activeForAgent?.success && Array.isArray(activeForAgent.sessions) && activeForAgent.sessions.length > 0) {
          agentId = context.agentId;
        }
      }

      if (sessionId) noteOpts.sessionId = sessionId;
      if (agentId) noteOpts.agentId = agentId;

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

export function applyDaemonTarget(targetArg: string, command: string): void {
  if (command === 'use' || command === 'dev') return;
  const resolved = resolveBerthTargetUrl(targetArg, readDevDaemonRegistry());
  if (!resolved) {
    console.error(`--daemon: unknown target "${targetArg}". Known: stable, dev, dev-latest, a label from \`pd dev list\`, or a URL.`);
    process.exit(1);
  }
  process.env.PORT_DADDY_URL = resolved.url;
  delete process.env.PORT_DADDY_SOCK;
  if (!resolved.url.includes(`:${DEFAULT_DAEMON_PORT}`)) {
    process.env.PD_ACTIVE_DAEMON = resolved.label;
  }
}

export async function main(): Promise<void> {
  maybeRelaunchShortBinary();

  const rawArgs: string[] = process.argv.slice(2);

  // GLOBAL `--daemon <tier|label|url>` flag (ADR-0084): it may appear BEFORE the
  // subcommand (`pd --daemon dev status`). Extract it up front so `command` is
  // the real verb, then stash the target for the resolver below. Supports both
  // `--daemon dev` and `--daemon=dev`. (It is also tolerated mid-args by the
  // normal option parser, which sets options.daemon for the post-parse resolver.)
  let preDaemonTarget: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === '--daemon' && i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
      preDaemonTarget = rawArgs[i + 1];
      i++;
      continue;
    }
    if (a.startsWith('--daemon=')) {
      preDaemonTarget = a.slice('--daemon='.length);
      continue;
    }
    args.push(a);
  }
  const command: string | undefined = args[0];

  if (!command || command === '--help' || command === '-h') {
    if (IS_TTY) {
      ui.intro('Port Daddy — Run a tight harbor.');
    }

    // Launch hints — best-effort, skip if daemon not running (500ms timeout)
    if (IS_TTY) {
      try {
        const cwd = encodeURIComponent(process.cwd());
        const resp = await Promise.race([
          pdFetch(`/launch-hints?cwd=${cwd}`),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
        ]);
        if (resp && resp.ok) {
          const hints = await resp.json() as {
            projectName?: string;
            isNewFolder?: boolean;
            salvage?: { total: number; inProject: number; recent: Array<{ id: string; purpose?: string; identity?: string; minutesAgo?: number }> };
            nudges?: Array<{ type: string; message: string; cmd: string }>;
          };
          printLaunchHints(hints);
        }
      } catch {
        // Daemon not running — silently skip
      }

      // First-run hint
      const portdaddyDir = join(process.cwd(), '.portdaddy');
      if (!existsSync(portdaddyDir)) {
        ui.info('First time here? Run pd learn for an interactive tutorial.');
      }
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
    console.log(PKG.version);
    process.exit(0);
  }

  // Splash flag — 90s title-card flourish. Honors NO_COLOR + non-TTY for CI.
  if (command === '--splash' || command === 'splash') {
    const { renderSplash } = await import('../lib/splash.js');
    console.log(renderSplash());
    process.exit(0);
  }

  const isQuiet: boolean = args.includes('--quiet') || args.includes('-q') || args.includes('--json') || args.includes('-j');

  // Target ownership must be installed before freshness probes. Otherwise a
  // named feature-daemon command can inspect and restart the default daemon.
  if (preDaemonTarget) applyDaemonTarget(preDaemonTarget, command);
  
  if (shouldCheckDaemonFreshness(command as string, args)) {
    await checkDaemonFreshness(true, isQuiet);
  }

  // Cross-platform staleness nudge (ADR-0054 Phase 2): at most once/day, print a
  // one-line "you're behind the latest release" hint to stderr. Complements the
  // macOS-only auto-upgrade `pd self-update` (ADR-0062) for npm/Linux installs.
  // Throttled, TTY-gated, opt-out via PORT_DADDY_NO_UPDATE_CHECK, fail-soft.
  await maybeNudgeStaleness({ command: command as string, currentVersion: PKG.version, isQuiet });

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

  // Flags whose repeated occurrences should accumulate into an array
  // instead of last-write-wins. Add a key here when a consumer is array-aware
  // (e.g. `--files A --files B`).
  const REPEATABLE_FLAGS: Set<string> = new Set(['files', 'client-arg', 'codex-config']);

  const assignOption = (key: string, value: string | true): void => {
    if (REPEATABLE_FLAGS.has(key) && key in options) {
      const existing = options[key];
      if (Array.isArray(existing)) {
        existing.push(value as string);
      } else if (typeof existing === 'string') {
        options[key] = [existing, value as string];
      } else {
        options[key] = value;
      }
    } else {
      options[key] = value;
    }
  };

  for (let i = 1; i < args.length; i++) {
    const arg: string = args[i];

    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      // Handle --flag=value syntax
      const eqIndex: number = arg.indexOf('=');
      if (eqIndex !== -1) {
        const key: string = arg.slice(2, eqIndex);
        const value: string = arg.slice(eqIndex + 1);
        assignOption(key, value);
      } else {
        const key: string = arg.slice(2);
        const next: string | undefined = args[i + 1];
        if (next && !next.startsWith('-')) {
          assignOption(key, next);
          i++;
        } else {
          assignOption(key, true);
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
        assignOption(longKey, value);
      } else if (flagPart.length === 1) {
        // Single short flag: -q, -j, or -p 3000
        const longKey: string = shortFlags[flagPart] || flagPart;
        const next: string | undefined = args[i + 1];
        // Check if this flag expects a value
        const expectsValue: boolean = ['p', 'e'].includes(flagPart);
        if (expectsValue && next && !next.startsWith('-')) {
          assignOption(longKey, next);
          i++;
        } else {
          assignOption(longKey, true);
        }
      } else {
        // Multiple short flags combined: -qj (quiet + json)
        for (const char of flagPart) {
          const longKey: string = shortFlags[char] || char;
          assignOption(longKey, true);
        }
      }
    } else {
      positional.push(arg);
    }
  }

  // --daemon <tier|label|url>: GLOBAL targeting flag (ADR-0084). Resolves to a
  // daemon URL via the fixed berth lanes (stable→canonical, dev-latest→DEV_LATEST_PORT)
  // + the dev-berth registry, then overrides PORT_DADDY_URL for THIS command only by mutating the
  // process env before dispatch. pdFetch reads PORT_DADDY_URL live (and clearing
  // PORT_DADDY_SOCK forces it off the canonical socket onto the chosen berth).
  // Precedence: --daemon flag wins over PORT_DADDY_URL / `pd use` env.
  if (!preDaemonTarget && options.daemon) {
    applyDaemonTarget(String(options.daemon), command);
  }

  // --direct flag: skip daemon, go straight to direct-DB mode
  if (options.direct) {
    if (TIER_2_COMMANDS.has(command)) {
      console.error(`"${command}" requires the running daemon. It cannot work in --direct mode.`);
      console.error('Start with: port-daddy start');
      process.exit(1);
    }

    const handled = await executeDirectMode(command, positional, options);
    if (handled) {
      await recordCliUsage(command, positional, options, 'ok', Date.now());
      return;
    }

    // Not a Tier 1 command — fall through to normal handling
    // (e.g., daemon management commands like 'start', 'version', etc.)
  }

  const commandStartedAt = Date.now();

  // `pd <command> --help` / `-h` short-circuits to that command's help instead
  // of executing it. Without this, commands fall through to their handler and
  // run real logic — e.g. `pd done --help` triggered the done precondition and
  // printed "ERROR: pd done refused …", which also poisoned recorded terminal
  // demos (website-terminal-recordings reviewer flags /ERROR:/). Falls back to
  // the global help for commands without a dedicated topic.
  if (options.help && !shouldDispatchHelpToHandler(command as string)) {
    console.log(resolveVerbHelp(command as string) ?? buildHelp());
    process.exit(0);
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
        if (positional[0] === 'exec') {
          // `pd env exec -- <cmd>` resolves pd-secret:// refs into the child env
          // only (ADR-0088 Phase B access path). `--` flattens the command into
          // positional, so everything after `exec` is the command + its args.
          await handleEnvExec(positional.slice(1), options);
        } else {
          await handleEnv(positional[0], options);
        }
        break;

      // Agent coordination
      case 'pub':
      case 'publish':
      case 'broadcast':
        await handlePub(positional[0], positional.slice(1).join(' ') || (options.message as string | undefined), options);
        break;

      case 'sub':
      case 'subscribe':
      case 'listen':
        await handleSub(positional[0], options);
        break;

      // Track B1: relay-independent conversational pipe.
      case 'tube':
        await handleTube(positional[0], options);
        break;

      // Relay v0 — zero-trust event fabric (ADR-0049): pd relay url|status|exchange
      case 'relay':
        await handleRelay(positional, options);
        break;

      // Account — GitHub device-flow login for the CLI (ADR-0101 Phase 1)
      case 'account':
        process.exitCode = await handleAccount(positional);
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
      case 'u':
      case 'up':
        await handleUp(positional, options);
        break;

      case 'd':
      case 'down':
        await handleDown(options);
        break;

      // Project onboarding
      case 'setup': {
        await handleSetup(options);
        break;
      }

      case 'init': {
        const { handleInit } = await import('../cli/commands/init.js');
        await handleInit(options);
        break;
      }

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
      case 'swarm':
        await handleAgents(options);
        break;

      case 'actor':
        await handleActors(positional, options);
        break;

      case 'actors':
        await handleActors([], options);
        break;

      case 'roster':
        await handleRoster(positional[0], positional.slice(1), options);
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

      // Booty — artifact harvest into the blob store with provenance
      case 'booty':
        await handleBooty(positional[0], positional.slice(1), options);
        break;

      // Agent inbox (top-level shortcut)
      case 'inbox':
        await handleInbox(positional[0], positional.slice(1), options);
        break;

      // `pd send <agent> "msg"` — discoverable alias for the durable directed
      // send (`pd inbox send …`). POSTs to /agents/:id/inbox; survives the
      // recipient being offline, unlike ephemeral pub/sub.
      case 'send':
        await handleInbox('send', positional, options);
        break;

      // `pd sent` — read receipts: messages YOU sent + whether/when each was read.
      case 'sent':
        await handleSent(options);
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
      case 'takeover':
        await handleSession('takeover', positional, options);
        break;

      case 'session':
        await handleSession(positional[0], positional.slice(1), options);
        break;

      case 'sessions':
        await handleSessions(options);
        break;

      case 'n':
      case 'note':
        await handleNote(positional[0], options);
        break;

      case 'notes':
        await handleNotes(positional[0], options);
        break;

      // Daemon management
      case 'start':
        if (options.foreground === true) {
          // launchd / brew-services / `pd start --foreground &`: run the
          // daemon in-process so the supervisor can manage this PID.
          await runDaemonInProcess();
          return;
        }
        await handleDaemon('start');
        break;

      case 'stop':
        await handleDaemon('stop', options);
        break;

      case 'restart':
        await handleDaemon('restart', options);
        break;

      case 'daemon':
        await handleDaemonCommand(positional, options);
        break;

      case 'status':
        await handleStatus(options);
        break;

      case 'install':
        await handleDaemon('install', options);
        break;

      case 'install-bosun':
        await handleDaemon('install-bosun', options);
        break;

      case 'uninstall':
        await handleDaemon('uninstall', options);
        break;

      case 'dev':
        // ADR-0084 Daemon Berths: pd dev up/down/list (+ back-compat
        // start/stop/status). Builds the daemon BINARY (never tsx) and runs
        // tiered, colour-coded berths beside the canonical stable daemon.
        await handleDevBerth(positional, options);
        break;

      case 'use':
        // ADR-0084: per-shell targeting. Emits a shell snippet to eval:
        //   eval "$(pd use dev)"  → exports PORT_DADDY_URL + PD_ACTIVE_DAEMON.
        await handleUse(positional, options);
        break;

      case 'ci-gate':
        await ciGateCheck();
        break;

      case 'self-update':
        // ADR-0062: auto-freshness self-heal. The hourly com.portdaddy.freshness
        // LaunchAgent runs `pd self-update --tick`; humans can run `pd self-update`.
        await handleSelfUpdate({ tick: !!options.tick });
        break;

      case 'upgrade': {
        // ADR-0057 phase 7 (dist-update-channel): fetch the published latest.json
        // feed, compare to THIS binary's embedded version, report or (--apply)
        // perform the brew-upgrade path. Distinct from `self-update` (unattended
        // freshness): this is the interactive "is there a newer release" command.
        const upgradeResult = await handleUpgrade(PKG.version, {
          feed: typeof options.feed === 'string' ? options.feed : undefined,
          apply: !!options.apply,
          json: !!(options.json ?? options.j),
        });
        if (upgradeResult.exitCode !== 0) process.exitCode = upgradeResult.exitCode;
        break;
      }

      case 'doctor':
      case 'diagnose':
        await handleDoctor({
          json: !!(options.json ?? options.j),
          ci: !!options.ci,
          exitCode: !!(options['exit-code'] ?? options.exitCode),
        });
        break;

      case 'bench':
        await handleBench(positional);
        break;

      case 'benchmark':
        await handleBenchmark(positional);
        break;

      case 'demo':
        await handleDemo(positional[0], options);
        break;

      case 'hints':
        await handleHints(options);
        break;

      case 'version':
        await handleVersion();
        break;

      // New API-parity commands
      case 'dashboard':
        await handleDashboard({ web: !!(options['web'] ?? options['w']) });
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
        const mcpSub = positional[0];
        if (mcpSub === 'install') {
          const { handleMcpInstall } = await import('../cli/commands/mcp-install.js');
          await handleMcpInstall(options);
          break;
        }
        if (options.port) {
          process.env.PORT_DADDY_URL = `http://localhost:${options.port}`;
        }
        await import('../mcp/server.js');
        break;
      }

      case 'hooks': {
        const { handleHooks } = await import('../cli/commands/hooks-install.js');
        await handleHooks(positional, options);
        break;
      }

      case 'dns':
        await handleDns(positional[0], positional.slice(1), options);
        break;

      case 'briefing':
        await handleBriefing(options);
        break;

      // Operator loop · SIGHT stage. `pd periscope` (aliases: sight, scope) —
      // raise the periscope: what's the state, what's the next cut.
      case 'periscope':
      case 'sight':
      case 'scope':
        await handlePeriscope(options);
        break;

      // Coast Guard read path: SEE the guard — confinement, broker, egress cap.
      case 'coast-guard':
      case 'cg':
        handleCoastGuard(positional[0], options);
        break;

      // Tender suggestion queue — list, approve, dismiss
      case 'suggest':
        await handleSuggest(positional, options);
        break;

      // Skill registry, search, graft, outcomes
      case 'seamanship':
      case 'skills':
        await handleSeamanship(positional, options);
        break;

      case 'history':
        await handleHistory(options);
        break;

      // Consolidated read/write verbs (3.8.4)
      // `pd say` fans one text out to note + optional tuple/pheromone/broadcast
      // `pd look` is the sitrep synthesis (default) or --heat → file heat map
      // `pd sitrep` kept as an explicit alias (the maritime canonical name)
      case 'say':
        await handleSay(positional[0], options);
        break;

      case 'look':
        await handleLook(positional[0], options);
        break;

      case 'sitrep':
        await handleSitrep(options);
        break;

      case 'plan':
        await handlePlan(positional, options);
        break;

      case 'pheromone':
      case 'ph':
        await handlePheromone(positional[0], positional.slice(1), options);
        break;

      case 'advise':
      case 'preflight':
      case 'compass':
        await handleAdvisor(positional, options);
        break;

      case 'guard':
        await handleGuard(positional, options);
        break;

      case 'add':
        await handleAdd(positional, options);
        break;

      case 'snapshots':
      case 'snapshot':
        await handleSnapshots(positional, options);
        break;

      case 'backup':
        await handleBackup(positional, options);
        break;

      case 'cut':
        await handleCut(positional, options);
        break;

      case 'batten':
        await handleBatten(positional, options);
        break;

      case 'attest':
        await handleAttest(positional, options, PKG.version);
        break;

      // Host-safety layer — the read-only posture audit + opt-in reversible
      // perm-fix (ADR-0088 Phase A). `pd safe scan` defaults; `pd safe baseline
      // accept <id>` triages a finding; `pd safe fix --auto` tightens perms.
      case 'safe':
        await handleSafe(positional, options);
        break;

      case 'restore':
        await handleRestore(positional, options);
        break;

      case 'shipwright':
        await handleShipwright(positional[0], options);
        break;

      case 'cockpit':
        await handleCockpit(positional, options);
        break;

      // Roadmap popper — autonomous roadmap-to-dispatch task puller
      case 'popper':
        await handlePopper(positional, options);
        break;

      // Managed provider secret store (keychain-backed)
      case 'secret':
      case 'secrets':
        await handleSecret(positional, options);
        break;

      // Harbormaster — merge-owning actor body (ADR-0037)
      case 'hm':
      case 'harbormaster': {
        const { handleHarbormaster } = await import('../cli/commands/harbormaster.js');
        await handleHarbormaster(positional, options);
        break;
      }

      case 'integration':
        await handleIntegration(positional[0], positional.slice(1), options);
        break;

      // Sugar commands
      case 'b':
      case 'begin':
        await handleBegin(positional[0], positional.slice(1), options);
        break;

      case 'done':
        await handleDone(positional[0], options);
        break;

      case 'w':
      case 'whoami':
        await handleWhoami(options);
        break;

      case 'attention':
        await handleAttention(options);
        break;

      case 'nudge':
        await handleNudge(positional, options);
        break;

      case 'with-lock':
        await handleWithLock(positional[0], positional.slice(1), options);
        break;

      // Spawn — AI agent launcher
      case 'spawn':
        await handleSpawn(positional, options);
        break;

      // Work Intent family (ADR-0095 fork 4). First landing: pd work probe —
      // adapter conformance probes per binder ch18 Work Order C2.
      case 'work':
        await handleWork(positional, options);
        break;

      case 'spawned':
        await handleSpawned(positional, options);
        break;

      // Dispatch -- autonomous feature dev queue (renamed from nightshift per
      // ADR-0035). `nightshift` is an alias kept for one minor version.
      case 'dispatch':
        await handleDispatch(positional, options);
        break;

      case 'nightshift':
        await handleNightshift(positional, options);
        break;

      // Review -- pd review <id> --accept|--reject contract (ADR-0035).
      case 'review':
        await handleReview(positional, options);
        break;

      case 'morning':
        await handleMorning(positional, options);
        break;

      // Watch — ambient agent kernel (SSE subscriber)
      case 'watch':
        await handleWatch(positional[0], options);
        break;

      // Sortie — one-shot multi-agent mission (ephemeral harbor, explicit budget)
      case 'sortie':
        await handleSortie(positional, options);
        break;

      // Fleet transcripts — chat-record viewer for every ship run
      case 'transcripts':
      case 'transcript':
        await handleTranscripts(positional, options);
        break;

      // Relay — cloud relay configuration and status (ADR-0049)
      case 'relay': {
        const sub = positional[0];
        if (sub === 'url') {
          const url = positional[1];
          if (options.clear || options.c) {
            const res = await pdFetch('/relay/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relay_url: null }) });
            if (!res.ok) { console.error('Error clearing relay URL'); process.exit(1); }
            console.log('✓ Relay disabled (relay_url cleared)');
          } else if (url) {
            try { const p = new URL(url); if (!['https:', 'http:'].includes(p.protocol)) throw new Error('URL must use https: or http:'); }
            catch (e) { console.error(`Error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }
            const res = await pdFetch('/relay/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relay_url: url }) });
            if (!res.ok) { console.error('Error setting relay URL'); process.exit(1); }
            console.log(`✓ Relay URL set: ${url}`);
          } else {
            const res = await pdFetch('/relay/config');
            const data = await res.json() as { relay_url?: string | null };
            if (!data.relay_url) console.log('relay_url: (not set — relay federation disabled)');
            else console.log(`relay_url: ${data.relay_url}`);
          }
        } else if (sub === 'status') {
          const res = await pdFetch('/relay/status');
          const data = await res.json() as { relay_url?: string | null; connected?: boolean; session_id?: string | null; last_handshake?: number | null; accepted_channels?: string[]; relay_version?: string | null };
          if (!data.relay_url) { console.log('Relay: disabled (no relay_url configured)\n  Set with: pd relay url <https://relay.portdaddy.dev>'); break; }
          console.log(`Relay: ${data.relay_url}\nStatus: ${data.connected ? '✓ connected' : '✗ disconnected'}`);
          if (data.session_id) console.log(`Session: ${data.session_id}`);
          if (data.last_handshake) console.log(`Last handshake: ${Math.floor(Date.now() / 1000 - data.last_handshake)}s ago`);
          if ((data.accepted_channels ?? []).length > 0) { console.log(`Subscribed channels (${data.accepted_channels!.length}):`); for (const ch of data.accepted_channels!) console.log(`  - ${ch}`); }
          if (data.relay_version) console.log(`Relay version: ${data.relay_version}`);
        } else if (sub === 'exchange') {
          const token = (options['oidc-token'] as string | undefined) ?? process.env['ACTIONS_ID_TOKEN'];
          if (!token) { console.error('Error: --oidc-token or $ACTIONS_ID_TOKEN required'); process.exit(1); }
          let cap: unknown[];
          try { cap = options.cap ? JSON.parse(options.cap as string) : [{ op: 'pub', channel: '*' }]; }
          catch { console.error('Error: --cap must be valid JSON array'); process.exit(1); cap = []; }
          const res = await pdFetch('/relay/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oidc_token: token, cap }) });
          const data = await res.json() as { card: string; exp: number };
          if (options.out) { fsWriteFileSync(options.out as string, data.card, 'utf8'); console.log(`✓ Card written to ${options.out} (exp: ${new Date(data.exp * 1000).toISOString()})`); }
          else console.log(data.card);
        } else {
          console.error('Usage: pd relay <url|status|exchange> [args]');
          process.exit(1);
        }
        break;
      }

      // Harbors — named permission namespaces
      case 'harbor': {
        const sub = positional[0];
        const harborArgs = positional.slice(1);
        switch (sub) {
          case 'create':  await handleHarborCreate(harborArgs, options); break;
          case 'enter':   await handleHarborEnter(harborArgs, options); break;
          case 'leave':   await handleHarborLeave(harborArgs, options); break;
          case 'show':    await handleHarborShow(harborArgs, options); break;
          case 'destroy':
          case 'delete':  await handleHarborDestroy(harborArgs, options); break;
          default:
            console.error('Usage: pd harbor <create|enter|leave|show|destroy> [args]');
            process.exit(1);
        }
        break;
      }

      case 'harbors':
        await handleHarbors(positional, options);
        break;

      // Agent Harbor event ledger + projections (binder ch18 C1, ADR-0095)
      case 'harbor-ledger': {
        const { handleHarborLedger } = await import('../cli/commands/harbor-ledger.js');
        await handleHarborLedger(positional, options);
        break;
      }

      // Semantic phonebook / skill router
      case 'whois':
        await handleWhois(positional, options);
        break;

      // Tutorial
      case 'learn':
      case 'tutorial':
        await handleLearn();
        break;

      // File ownership lookup
      case 'who-owns':
        await handleWhoOwns(positional[0], options);
        break;

      // Fleet — background agent management (TypeScript, not shell)
      case 'fleet': {
        const { handleFleet } = await import('../cli/commands/fleet.js');
        await handleFleet(positional, options);
        break;
      }

      // Backend — surface CLI/SDK backend route, switch, and per-backend cost.
      case 'backend': {
        const { handleBackend } = await import('../cli/commands/backend.js');
        await handleBackend(positional, options);
        break;
      }

      case 'squid': {
        const { handleSquid } = await import('../cli/commands/squid.js');
        await handleSquid(positional, options);
        break;
      }

      case 'wallet': {
        const { handleWallet } = await import('../cli/commands/wallet.js');
        await handleWallet(positional, options);
        break;
      }

      case 'bond': {
        const { handleBond } = await import('../cli/commands/bond.js');
        await handleBond(positional, options);
        break;
      }

      // Tuples — Linda-style tuple space coordination
      case 'tuple':
        await handleTuple(positional, options);
        break;

      case 'graph':
        await handleGraph(positional, options);
        break;

      // The one shared local embedding surface (ADR-0061): skills and
      // matching code shell out here instead of standing up their own model.
      case 'embed':
        await handleEmbed(positional, options);
        break;

      // Native local skill grafting for fleet ships: inspect/warm the same
      // lib/skill-graft.ts index used by skill_graft: true in pd-fleet.yml.
      case 'skill-graft':
      case 'skillgraft':
        await handleSkillGraft(positional, options);
        break;

      case 'memory':
        await handleMemory(positional, options);
        break;

      case 'ideas':
        await handleIdeas(positional, options);
        break;

      // Durable commitments + obligation monitor (ADR-0041)
      case 'commit':
        await handleCommit(positional, options);
        break;

      case 'obligations':
        await handleObligations(positional, options);
        break;

      case 'roadmap':
        await handleRoadmap(positional, options);
        break;

      case 'quorum':
        await handleQuorum(positional, options);
        break;

      case 'parley':
        await handleParley(positional, options);
        break;

      case 'feedback':
        await handleFeedback(positional, options);
        break;

      default: {
        // Check for misspelled commands first
        const suggestion = suggestCommand(command);
        if (suggestion) {
          ui.error(`Unknown command: ${command}`);
          ui.info(`Did you mean: pd ${suggestion}?`);
          process.exit(1);
        }
        // Only treat as a claim if it's a semantic identity (must contain : for project:stack:context format)
        if (command.includes(':')) {
          await handleClaim(command, options);
        } else {
          ui.error(`Unknown command: ${command}`);
          ui.info('Run pd help for usage — or pd learn for a tutorial');
          process.exit(1);
        }
        break;
      }
    }
    await recordCliUsage(command, positional, options, 'ok', commandStartedAt);
  } catch (err: unknown) {
    await recordCliUsage(command, positional, options, 'error', commandStartedAt, err);
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
          ui.error('Could not auto-start the daemon.');
          ui.info('Start manually: pd start — or install as service: pd install');
          process.exit(1);
        }
      } else {
        ui.error('Daemon is not running.');
        ui.info('Start with: pd start — or install: pd install');
        process.exit(1);
      }
    } else {
      ui.error(error.message);
    }
    process.exit(1);
  }
}

if (process.env.PORT_DADDY_SUPPRESS_CLI_MAIN !== '1') {
  void main();
}
