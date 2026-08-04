#!/usr/bin/env node

/**
 * Port Daddy - Semantic Port Management Service
 *
 * Fastify-based HTTP server with native plugin architecture.
 * Unix domain socket primary, TCP secondary for dashboard access.
 */

// Load .env files BEFORE the snapshot, otherwise keys that live in
// project-local .env / .env.local never make it into the secret cache.
// (Snapshot runs once, deletes from process.env; subsequent fleet-level
// env loading would be invisible to getSecret().) See lib/secret-env.ts.
import { loadEnvFiles } from './lib/env-loader.js';
import { fileURLToPath as _fileURLToPath } from 'url';
import { dirname as _dirname } from 'path';
loadEnvFiles(_dirname(_fileURLToPath(import.meta.url)));

// Snapshot sensitive env BEFORE any other module loads — many libraries
// read process.env at module-init time, so this has to run first so
// dependencies (Fastify plugins, winston, Anthropic SDK, etc.) cannot
// capture the raw env values on load. See lib/secret-env.ts.
import { snapshotSensitiveEnv } from './lib/secret-env.js';
snapshotSensitiveEnv();

import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import http from 'node:http';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { readFileSync, existsSync, readdirSync, unlinkSync, writeFileSync, mkdirSync, accessSync, constants as fsConstants } from 'fs';
import type { DatabaseInstance } from './lib/sqlite-runtime.js';
import { createConnection } from 'net';
import winston from 'winston';

// Core modules
import { createServices } from './lib/services.js';
import { createMessaging } from './lib/messaging.js';
import { createLocks } from './lib/locks.js';
import { createHealth } from './lib/health.js';
import { createAgents } from './lib/agents.js';
import { createActivityLog, ActivityType } from './lib/activity.js';
import { createWebhooks, WebhookEvent } from './lib/webhooks.js';
import { createProjects } from './lib/projects.js';
import { createSessions } from './lib/sessions.js';
import { createAgentInbox } from './lib/agent-inbox.js';
import { createAttention } from './lib/attention.js';
import { createClaimWatcher } from './lib/claim-watcher.js';
import { createResurrection } from './lib/resurrection.js';
import { createChangelog } from './lib/changelog.js';
import { createTunnel } from './lib/tunnel.js';
import { createDns } from './lib/dns.js';
import { createResolver } from './lib/resolver.js';
import { createSpawner } from './lib/spawner.js';
import { createTranscripts } from './lib/transcripts.js';
import { createJsonlTranscriptArchive } from './lib/transcript-archive.js';
import { createBriefing } from './lib/briefing.js';
import { createSugar } from './lib/sugar.js';
import { createHarbors } from './lib/harbors.js';
import { createHarborTokens } from './lib/harbor-tokens.js';
import { createSorties } from './lib/sorties.js';
import { createPheromoneManager } from './lib/pheromone.js';
import { createReactiveOrchestrator } from './lib/orchestrator.js';
import { createConductor } from './lib/fleet/conductor.js';
import { createDispatchQueue } from './lib/dispatch/queue.js';
import { createDispatchWorker } from './lib/dispatch/worker.js';
import { runAutoMergeSweep } from './lib/dispatch/auto-merge.js';
import { createConductorSpawnAdapter } from './lib/dispatch/conductor-adapter.js';
import { createWorkIntentService } from './lib/agent-harbor/work-intent-service.js';
import { recallEpisodes, SEARCH_QUERY_SCHEMA } from './lib/agent-harbor/memory-episodes.js';
import { randomUUID } from 'node:crypto';
import {
  gitWorktreeAdd,
  gitPushBranch,
  openDraftPr,
  disableGuardInWorktree,
} from './lib/dispatch/spawn-adapter.js';
import { createCorrelationEngine } from './lib/correlation.js';
import { createArbiter } from './lib/arbiter.js';
import { createJsonlForensicsArchive } from './lib/forensics-archive.js';
import { createSemanticIndex } from './lib/semantic-index.js';
import { createTupleSpace } from './lib/tuples.js';
import { createBlobStore } from './lib/blob.js';
import { createBootyStore } from './lib/booty.js';
import { createNoteEncryption } from './lib/note-encryption.js';
import { initDatabase, closeDatabase, resolveDbPath } from './lib/db.js';
import { createIpcServer } from './lib/ipc-server.js';
import { createIpcRouter } from './lib/ipc-router.js';
import { createFleetDaemon } from './lib/fleet-daemon.js';
import { createRepoRegistry } from './lib/github-repo-registry.js';
import { createOrchestratorRegistry } from './lib/orchestrator-plugins.js';
import { createSymbolIndex } from './lib/symbol-index.js';
import { createSymbolClaims } from './lib/symbol-claims.js';
import { createMergeQueue } from './lib/merge-queue.js';
import { createCostTracker } from './lib/cost-tracker.js';
import { createCloudAppTelemetry } from './lib/cloud-app-telemetry.js';
import { createContextWindowTracker } from './lib/context-window-tracker.js';
import { createKnowledgeCustodian } from './lib/knowledge-custodian.js';
import { normalizeSelfSalvage } from './lib/telos-salvage.js';
import { createOperatorPermissions } from './lib/operator-permissions.js';
import { createCounters } from './lib/counters.js';
import { createMetricsRegistry } from './lib/metrics-registry.js';
import { createBonds } from './lib/bonds.js';
import { createBudgetGuard } from './lib/budget-guard.js';
import { createActorSouls } from './lib/actor-souls.js';
import { migrateActorSouls } from './scripts/migrate-actor-souls.js';
import { homedir } from 'node:os';
import { createBudgetPause } from './lib/budget-pause.js';
import { createQuorum } from './lib/quorum.js';
import { createParley } from './lib/parley.js';
import { createFeedback } from './lib/feedback.js';
import { createRoadmapItems } from './lib/roadmap-items.js';
import { createCommitments } from './lib/commitments.js';
import { createSuggestions } from './lib/suggestions.js';
import { createWhois } from './lib/whois.js';
import { createObligationMonitor } from './lib/obligation-monitor.js';
import { createRoadmapPromote } from './lib/roadmap-promote.js';
import { createRoadmapPop } from './lib/roadmap-pop.js';
import { launchFleetBarIfEnabled } from './lib/fleetbar-launcher.js';
import { createGraphEdges } from './lib/graph-edges.js';
import { createEpisodicMemory } from './lib/episodic-memory.js';
import { createLocalEmbedder, createSemanticResolver, defaultTransformersCacheDir } from './lib/semantic-resolver.js';
import { installGovernor } from './lib/observability/index.js';
import { createObservabilityMaintenance } from './lib/observability/maintenance.js';
import { createDurableAgentRoster } from './lib/durable-agent-roster.js';
import { createGalaxy } from './lib/galaxy.js';
import { createBosunHeartbeat, createSocketHealthProbe } from './lib/bosun-heartbeat.js';
import { decideTakeover, probePortOwner } from './lib/port-takeover.js';
import { createResourceGovernance } from './lib/resource-governance.js';
import { createDaemonCorsOptions } from './lib/daemon-cors.js';

// Fastify route aggregator (Phase 3 — native Fastify plugins, no Express bridge)
import { registerAllRoutes } from './routes/index.js';

// Shared utilities
import { getSystemPorts, startSystemPortsRefresh } from './shared/port-utils.js';
import { LOOPBACK_TCP_HOST, DEFAULT_DAEMON_PORT } from './shared/daemon-discovery.js';
import {
  resolveDaemonBerthIdentity,
  registerDaemonBerth,
  deregisterDaemonBerth,
  BERTH_ENV,
  type DaemonBerthIdentity,
} from './shared/daemon-berths.js';
import { classifyPlane, STATE_PLANE_ENV, type StatePlane } from './lib/state-plane.js';
import { calculateRuntimeCodeHash } from './shared/code-hash.js';
import { snapshotRunningBinary, detectDrift, type BinaryDriftSnapshot } from './lib/binary-drift-detector.js';
import { resolveDistributionRoot } from './shared/daemon-binary.js';

const MODULE_DIR: string = dirname(fileURLToPath(import.meta.url));
const __dirname: string = resolveDistributionRoot(MODULE_DIR);
const REPO_ROOT: string = existsSync(join(__dirname, 'apps', 'FleetBar'))
  ? __dirname
  : dirname(__dirname);

// =============================================================================
// CONFIGURATION (identical to server.ts)
// =============================================================================

interface PortDaddyServerConfig {
  service: { port: number; host: string };
  ports: { range_start: number; range_end: number; reserved: number[] };
  cleanup: { interval_ms: number };
  logging: {
    level: string;
    file: string;
    error_file: string;
    /** Per-file rotation cap in bytes. Default 50 MB. */
    maxsize?: number;
    /** Number of rotated files to keep. Default 5. Older files are deleted. */
    maxFiles?: number;
    /**
     * Fraction of successful requests to log (0..1). Default 0 — only errors are logged.
     * The request-log firehose was the dominant source of disk pressure
     * (625 MB unrotated). Per-route latency now lives in the in-memory
     * MetricsRegistry; the file log is for forensic error tracing only.
     */
    requestSamplingRate?: number;
  };
  security: { rate_limit: { window_ms: number; max_requests: number } };
}

const configPath: string = join(__dirname, 'config.json');
const config: PortDaddyServerConfig = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8')) as PortDaddyServerConfig
  : {
      service: { port: DEFAULT_DAEMON_PORT, host: LOOPBACK_TCP_HOST },
      ports: { range_start: 3100, range_end: 9999, reserved: [8080, 8000, DEFAULT_DAEMON_PORT] },
      cleanup: { interval_ms: 300000 },
      logging: { level: 'info', file: 'port-daddy.log', error_file: 'port-daddy-error.log' },
      security: { rate_limit: { window_ms: 60000, max_requests: 1000 } }
    };

// Build-time version constant. sync-version.ts keeps this literal in lockstep
// with package.json via the `postversion` hook. The runtime package.json read
// is still tried first so source-mode dev (tsx server.ts) reflects an edited
// package.json without a sync step, but the embedded constant is what the
// bun-compiled binary actually serves — inside the /$bunfs/ bundle, __dirname
// resolves to a virtual path where package.json doesn't exist on disk.
const EMBEDDED_PACKAGE_VERSION: string = '3.27.0';
const pkgPath: string = join(__dirname, 'package.json');
const pkg: { version: string } = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string } : { version: EMBEDDED_PACKAGE_VERSION };
const VERSION: string = pkg.version;

// =============================================================================
// CODE HASH (identical to server.ts)
// =============================================================================

function calculateCodeHash(): string {
  return calculateRuntimeCodeHash(__dirname);
}

const CODE_HASH: string = calculateCodeHash();
const STARTED_AT: number = Date.now();

// Snapshot the running binary once at boot. We hash process.execPath BEFORE
// any `brew upgrade` (or other in-place swap) can land a newer binary at the
// canonical pd path. Later drift checks compare this baseline to whatever
// `command -v pd` currently resolves to. See lib/binary-drift-detector.ts.
const RUNNING_BINARY_SNAPSHOT = snapshotRunningBinary();

/**
 * Derive a git/build snapshot for this daemon's berth identity (ADR-0084),
 * once at boot. Best-effort: a compiled binary outside a git checkout (the
 * stable brew berth) simply reports nulls, which is correct — it was cut from a
 * release, not a live branch. `PD_DAEMON_SOURCE_DIR` points at the source tree
 * a dev/codebase berth was built from; we read git from there when present.
 */
function snapshotDaemonGit(sourceDir: string | null): { branch: string | null; rev: string | null; builtAt: string | null } {
  const cwd = sourceDir || __dirname;
  const git = (cargs: string[]): string | null => {
    try {
      const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
      const r = spawnSync('git', cargs, { cwd, encoding: 'utf-8', timeout: 2000 });
      if (r.status === 0 && typeof r.stdout === 'string') {
        const out = r.stdout.trim();
        return out.length > 0 ? out : null;
      }
    } catch {
      // git absent or not a checkout — fall through to null.
    }
    return null;
  };
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    rev: git(['rev-parse', '--short', 'HEAD']),
    builtAt: new Date(STARTED_AT).toISOString(),
  };
}

// =============================================================================
// LOGGING (identical to server.ts)
// =============================================================================

const isSilent: boolean = process.env.PORT_DADDY_SILENT === '1';

// Resolve log directory by trying candidates in priority order until one
// is mkdir-able AND writable. Each candidate is gated by a writability
// probe (mkdir recursive + accessSync W_OK) so winston is never wired to
// a directory it can't actually write to.
//
// Priority order:
//   1. PORT_DADDY_LOG_DIR env (explicit override)
//   2. PORT_DADDY_PREFIX/logs/ (matches the rest of the runtime layout)
//   3. %LOCALAPPDATA%\port-daddy\logs (Windows convention)
//   4. ~/.port-daddy/logs/ (user-writable fallback; works inside compiled
//      Bun binaries where __dirname is the read-only /$bunfs/root/)
//   5. __dirname (dev-from-checkout fallback)
function tryWritableDir(dir: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, fsConstants.W_OK);
    return dir;
  } catch {
    return null;
  }
}

function resolveLogDir(): string {
  const isWindows = process.platform === 'win32';
  const candidates: Array<string | undefined> = [
    process.env.PORT_DADDY_LOG_DIR,
    process.env.PORT_DADDY_PREFIX ? join(process.env.PORT_DADDY_PREFIX, 'logs') : undefined,
    isWindows && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'port-daddy', 'logs')
      : undefined,
    process.env.HOME ? join(process.env.HOME, '.port-daddy', 'logs') : undefined,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.port-daddy', 'logs') : undefined,
    __dirname,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const writable = tryWritableDir(candidate);
    if (writable) return writable;
  }

  // Last-resort: return __dirname even if it isn't writable. winston's
  // File transport will throw on first write and surface the failure
  // rather than silently swallowing it. The operator can set
  // PORT_DADDY_SILENT=1 to skip file transports entirely.
  return __dirname;
}

const LOG_DIR: string = resolveLogDir();

const logger: winston.Logger = winston.createLogger({
  level: isSilent ? 'error' : config.logging.level,
  silent: isSilent,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'port-daddy', version: VERSION },
  transports: isSilent ? [] : [
    new winston.transports.File({
      filename: join(LOG_DIR, config.logging.error_file),
      level: 'error',
      maxsize: config.logging.maxsize ?? 50 * 1024 * 1024,
      maxFiles: config.logging.maxFiles ?? 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: join(LOG_DIR, config.logging.file),
      maxsize: config.logging.maxsize ?? 50 * 1024 * 1024,
      maxFiles: config.logging.maxFiles ?? 5,
      tailable: true,
    })
  ]
});

if (!isSilent && process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Install the process-wide governed logger over winston. Loop/tick call sites log through this
// (dedup + rate-limit + sampling + correlation) so a persistently-failing operation can never again
// storm the logs the way `semantic_resolution_failed` did (7,182 lines → a 255 MB stdout capture).
const governor = installGovernor(logger, { windowMs: 60_000, burst: 3 });

// =============================================================================
// DATABASE + PATHS (identical to server.ts)
// =============================================================================

const PREFIX: string | undefined = process.env.PORT_DADDY_PREFIX;
const IS_DEV_MODE: boolean = !!PREFIX;

const DB_PATH: string = resolveDbPath(PREFIX ? join(PREFIX, 'port-daddy.db') : undefined);
const PORT: number = parseInt(process.env.PORT_DADDY_PORT as string, 10) || (IS_DEV_MODE ? 9877 : config.service.port);

// State plane (S1): classify once at boot which state this daemon mutates —
// 'prod' | 'dev-latest' | 'ephemeral:<label>'. Pure inference from the same
// signals used above (PORT_DADDY_PLANE override > canonical prefix > the
// dev-latest lane > ephemeral). Surfaced on /version, /health, the berth
// registry, and the Bosun heartbeat file.
const DAEMON_PLANE: StatePlane = classifyPlane({
  prefixPath: PREFIX,
  port: PORT,
  profileName: process.env[BERTH_ENV.label]?.trim() || null,
  envOverride: process.env[STATE_PLANE_ENV],
});

// Berth identity (ADR-0084): self-report which berth this daemon is. Defaults
// to the stable, canonical berth when PD_DAEMON_* env is unset, so the existing
// brew daemon transparently reports as `stable` with no launch change.
const DAEMON_BERTH: DaemonBerthIdentity = {
  ...resolveDaemonBerthIdentity({
    env: process.env,
    port: PORT,
    gitSnapshot: snapshotDaemonGit(process.env.PD_DAEMON_SOURCE_DIR?.trim() || null),
  }),
  // Plane rides with the berth identity so `registerDaemonBerth` records it
  // (shared/ cannot import lib/, so classification happens here, not there).
  plane: DAEMON_PLANE,
};

import { DEFAULT_SOCK, DEFAULT_IPC, DEFAULT_PID_FILE, DEFAULT_PORT_FILE } from './shared/paths.js';
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || (PREFIX ? join(PREFIX, 'port-daddy.sock') : DEFAULT_SOCK);
const DISABLE_TCP: boolean = process.env.PORT_DADDY_NO_TCP === '1';
const IPC_PATH: string = process.env.PORT_DADDY_IPC || (PREFIX ? join(PREFIX, 'port-daddy.ipc') : DEFAULT_IPC);
const DISABLE_IPC: boolean = process.env.PORT_DADDY_NO_IPC === '1';
const DISABLE_FLEET: boolean = process.env.PORT_DADDY_NO_FLEET === '1';
const DISABLE_FLEETBAR: boolean = process.env.PORT_DADDY_NO_FLEETBAR === '1';
const ALLOW_STABLE_FLEET: boolean = process.env.PORT_DADDY_ALLOW_STABLE_FLEET === '1';
const CUSTOM_RUNTIME_DIR: string | undefined = PREFIX ?? (process.env.PORT_DADDY_SOCK ? dirname(process.env.PORT_DADDY_SOCK) : undefined);
const PID_FILE: string = process.env.PORT_DADDY_PID_FILE || (CUSTOM_RUNTIME_DIR ? join(CUSTOM_RUNTIME_DIR, 'daemon.pid') : DEFAULT_PID_FILE);
const PORT_FILE: string = process.env.PORT_DADDY_PORT_FILE || (CUSTOM_RUNTIME_DIR ? join(CUSTOM_RUNTIME_DIR, 'daemon.port') : DEFAULT_PORT_FILE);
const HEARTBEAT_FILE: string | undefined = process.env.PORT_DADDY_HEARTBEAT_FILE || (CUSTOM_RUNTIME_DIR ? join(CUSTOM_RUNTIME_DIR, 'heartbeat') : undefined);

if (IS_DEV_MODE) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(PREFIX!, { recursive: true });
  console.error(`[Dev Mode] PREFIX=${PREFIX}`);
  console.error(`[Dev Mode] DB=${DB_PATH} SOCK=${SOCK_PATH} PORT=${PORT}`);
}

// =============================================================================
// DUPLICATE DAEMON DETECTION (identical to server.ts)
//
// A live unix socket alone is NOT proof of a healthy predecessor: a daemon
// whose binary was deleted underneath it (brew upgrade churn) can keep
// answering on the socket while its TCP listener is dead. Under launchd
// KeepAlive that half-alive zombie once ate 345 consecutive respawns — each
// new spawn heard "ok" on the socket and exited 0 while the TCP port served nothing
// (2026-07-04). Defer only when BOTH surfaces answer; socket-ok + TCP-dead
// (after generous retries) means zombie: terminate the stale PID, take over.
// =============================================================================

import { decideDuplicateAction, probeTcpHealth, terminateStalePid } from './lib/daemon-takeover.js';

if (existsSync(SOCK_PATH)) {
  const sockAlive: boolean = await new Promise<boolean>((resolve) => {
    const conn = createConnection({ path: SOCK_PATH }, () => {
      conn.write('GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n');
    });
    conn.on('data', (data: Buffer) => {
      conn.destroy();
      resolve(data.toString().includes('"status":"ok"'));
    });
    conn.on('error', () => resolve(false));
    conn.setTimeout(2000, () => { conn.destroy(); resolve(false); });
  });

  const tcpAlive: boolean = sockAlive && !DISABLE_TCP ? await probeTcpHealth(PORT) : false;
  const action = decideDuplicateAction({ sockAlive, tcpAlive, tcpDisabled: DISABLE_TCP });

  if (action === 'defer') {
    let existingPid = '?';
    try { existingPid = readFileSync(PID_FILE, 'utf-8').trim(); } catch {}
    console.error(`Port Daddy already running (PID ${existingPid}). Not starting a second daemon.`);
    process.exit(0);
  }

  if (action === 'takeover') {
    let stalePid = NaN;
    try { stalePid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10); } catch {}
    console.error(
      `[takeover] unix socket answers /health but TCP :${PORT} is dead after retries — ` +
      `half-alive daemon (stale PID ${Number.isFinite(stalePid) ? stalePid : '?'}). Terminating it and taking over.`,
    );
    const outcome = await terminateStalePid(stalePid);
    console.error(`[takeover] stale daemon termination: ${outcome}`);
  }

  try { unlinkSync(SOCK_PATH); } catch {}
  try { unlinkSync(PID_FILE); } catch {}
}

// =============================================================================
// SLEEP DETECTION (identical to server.ts)
// =============================================================================

let lastWakeCheck: number = Date.now();
let sleepGraceUntil: number = 0;
const SLEEP_CHECK_INTERVAL_MS: number = 30000;
const SLEEP_DETECTION_GAP_MS: number = 60000;
const SLEEP_GRACE_PERIOD_MS: number = 300000;

function isInSleepGracePeriod(): boolean {
  return Date.now() < sleepGraceUntil;
}

// The daemon IS the write-boundary (the Door): it opens with owner semantics and
// is the single legitimate writer of the registry. Non-daemon openers use
// role:'client' and get a write-guarded handle.
const db: DatabaseInstance = initDatabase({ dbPath: DB_PATH, role: 'daemon' });

// =============================================================================
// MODULE INITIALIZATION (identical to server.ts)
// =============================================================================

const semanticIndex = createSemanticIndex(db);
const graphEdges = createGraphEdges(db);
const symbolIndex = createSymbolIndex(db, { graphEdges });
const tuples = createTupleSpace(db);
const blobs = createBlobStore();
const booty = createBootyStore(db);
const counters = createCounters(db);
const metricsRegistry = createMetricsRegistry();
const semanticResolver = createSemanticResolver(db, {
  // Stable, daemon-portable cache (~/.port-daddy/transformers-cache) shared with
  // the install-time prefetch — NOT a repo/cwd-relative dir (ADR-0061).
  cacheDir: defaultTransformersCacheDir(),
  counters,
  graphEdges,
  tuples,
  logger,
  governor,
});
const episodicMemory = createEpisodicMemory(db, { tuples, graphEdges, semanticResolver });
const durableAgentRoster = createDurableAgentRoster(db, { resolver: semanticResolver, logger });
const quorum = createQuorum({ tuples });
const feedback = createFeedback({ tuples });
const roadmapItems = createRoadmapItems({ db, tuples });
const roadmapPromote = createRoadmapPromote({ feedback, roadmapItems });
const roadmapPop = createRoadmapPop({ db, feedback });

const services = createServices(db, { semanticIndex });
const messaging = createMessaging(db);
const locks = createLocks(db);
const health = createHealth(db, services as Parameters<typeof createHealth>[1]);
const agents = createAgents(db, { semanticIndex });
const activityLog = createActivityLog(db);

// Observability maintenance: on each cleanup tick, prune the audit-identified unbounded tables
// (harbor_issued_tokens, semantic_resolution_events), reclaim freed pages, and sample the daemon's
// own DB/WAL/row footprint — raising a durable RESOURCE_ALARM before a runaway can reach 313 GB.
const observabilityMaintenance = createObservabilityMaintenance({
  db,
  dbPath: DB_PATH,
  governor,
  onCritAlarm: (alarm) => {
    try {
      activityLog.log(ActivityType.RESOURCE_ALARM, {
        details: `resource ceiling crossed: ${alarm.metric}`,
        metadata: { metric: alarm.metric, value: alarm.value, threshold: alarm.threshold, severity: alarm.severity },
      });
    } catch { /* durable-audit best effort; the governed log already fired */ }
  },
});
// Durable commitments + obligation monitor (ADR-0041 first slice). The
// obligation half of accountability: resurrection watches heartbeats, this
// watches promises. The monitor is a PURE runtime check over SQLite (Law 4 —
// no Arbiter/Rust FFI dependency, so it cannot silently degrade to a stub).
const commitments = createCommitments(db);
const suggestions = createSuggestions(db);
const whois = createWhois(db, { resolver: semanticResolver, logger });
const obligationMonitor = createObligationMonitor(db, { activityLog });
const webhooks = createWebhooks(db);
const projects = createProjects(db);
const noteEncryption = createNoteEncryption({ requireMasterKey: true });
const sessions = createSessions(db, noteEncryption, {
  semanticIndex,
  episodicMemory,
  symbolIndex,
  requireAgentForFileClaims: true,
});
sessions.setActivityLog(activityLog);

const symbolClaims = createSymbolClaims(db, {
  symbolIndex,
  agentForSession: (sessionId: string) => {
    const r = sessions.get(sessionId) as { session?: { agentId?: string | null } } | undefined;
    return r?.session?.agentId ?? null;
  },
});

const agentInbox = createAgentInbox(db, (agentId, message) => {
  messaging.publish(`inbox:${agentId}`, {
    ...message,
    sender: message.from || 'SYSTEM',
    signal: (message as any).signal || 'report'
  });
});
const parley = createParley({ tuples, agentInbox });
// Mid-claim hash watcher — snapshots claimed files when their content
// hash changes mid-claim and DMs the claim-holder. Reactive, not
// preventive — but turns silent steamrolls into recoverable events.
const claimWatcher = createClaimWatcher({
  listClaims: () => {
    const result = sessions.listAllActiveClaims();
    if (!result.success || !Array.isArray(result.claims)) return [];
    return result.claims.map(c => ({
      filePath: c.filePath,
      sessionId: c.sessionId,
      agentId: c.agentId,
    }));
  },
  sendInbox: (agentId, content, options) => agentInbox.send(agentId, content, options),
  writeNote: (sessionId, note) => sessions.quickNote(note.content, { sessionId, type: note.type }),
  searchRoots: [process.cwd()],
  log: (msg, meta) => logger.info(msg, meta),
});

const resurrection = createResurrection(db, { sessions });
const changelog = createChangelog(db);
const tunnel = createTunnel(db);
const dns = createDns(db);
dns.setActivityLog(activityLog);
const resolver = createResolver(db);
dns.setResolver(resolver);
const briefing = createBriefing(db, { sessions, agents, resurrection, activityLog, services, messaging });
// Task-conditioned recall closure for the welcome briefing (#3131 read path):
// recallEpisodes over the harbor episode store, hybrid mode, with the shared
// galaxyEmbedder (declared below; the closure only runs at request time, well
// after startup). Budget is caller-supplied and engine-enforced.
const recallMemoryForBriefing = async (
  queryText: string,
  budget: { maxResults: number; maxContextTokens: number },
) => {
  const result = await recallEpisodes(db, {
    schema: SEARCH_QUERY_SCHEMA,
    queryId: `welcome_${randomUUID()}`,
    issuedAt: new Date().toISOString(),
    issuedBy: { kind: 'daemon' },
    queryText,
    mode: 'hybrid',
    sources: ['memory-episodes'],
    budget,
    retrievalHints: { fusion: 'rrf', recencyWeight: 0.2 },
  }, { embedder: galaxyEmbedder });
  return { hits: result.hits as unknown as Array<Record<string, unknown>>, budget: result.budget as unknown as Record<string, unknown>, engine: result.engine as unknown as Record<string, unknown> };
};
const sugar = createSugar({ agents, sessions, activityLog, roadmapItems, feedback, commitments, recallMemory: recallMemoryForBriefing });
const attention = createAttention({ db, inbox: agentInbox, messaging });
const harborTokens = createHarborTokens(db);
await harborTokens.initDaemonIdentity();
const harbors = createHarbors(db, { harborTokens });
const sorties = createSorties(db, { episodicMemory });

// Bond escrow + budget guard — FleetControl hardening. Built BEFORE
// cost-tracker and spawner so they can inject it as a dep (enforcement
// teeth) rather than it being observability-only.
const bonds = createBonds(db, {
  harbors, noteEncryption,
  broadcast: (channel, event) => messaging.publish(channel, event),
});
// ADR-0040 keystone: daemon-minted, non-forgeable actor identity. The souls
// store is the spend-choke input for budget-guard — it resolves each agentId
// (minted id or display alias) to a soul + class, soul-sources the ceiling, and
// meters newcomers against the SHARED per-project pool so minting fresh ids buys
// no new budget. HONEST LIMIT: the anti-launder only fully bites once the `door`
// lane makes the SQLite write-boundary real (a same-UID agent can otherwise
// write a ledger/pool row directly). This is ADR-0040's explicit non-goal.
const actorSouls = createActorSouls(db);
// Grandfather EXISTING agents (from budget_ledger/bond_escrow/agents) into
// trusted souls before budgetGuard starts routing spend through the souls
// choke below -- otherwise every already-running agent looks like a brand
// new "unknown" soul on this boot and gets capped at the newcomer pool floor
// instead of its real budget. Idempotent (see scripts/migrate-actor-souls.ts);
// safe to run on every boot, not just the first one after this lands.
try {
  migrateActorSouls(db, { apply: true, credentialsDir: join(homedir(), '.port-daddy', 'actor-credentials') });
} catch (err) {
  console.error('[actor-souls] grandfather migration failed (spend routing may throttle pre-existing agents until this is fixed):', err);
}
const budgetGuard = createBudgetGuard(db, {}, {
  broadcast: (channel, event) => messaging.publish(channel, event),
  souls: actorSouls,
});

// Late-binding spawner ref: cost-tracker needs to trigger spawner.kill() on
// budget breach, but spawner needs costTracker in its constructor. Resolve
// with a mutable container — set after both are created.
let spawnerRef: ReturnType<typeof createSpawner> | null = null;

// Pause-and-ask sits between the budget-breach signal and the actual
// SIGTERM. Default 60s grace; operator can raise, kill, or extend.
const budgetPause = createBudgetPause({
  killAgent: (agentId: string) => {
    logger.warn('budget_kill_executing', { agentId });
    spawnerRef?.kill(agentId);
  },
  bonds,
  broadcast: (channel, event) => messaging.publish(channel, event),
});

const costTracker = createCostTracker(db, {
  budgetGuard,
  // Budgets live on project_wallets.budget_usd_per_day. Projects without
  // a budget set are refused at spawn time (see lib/spawner.ts), so this
  // resolver returning null for unset projects is fine — we never get here.
  budgetResolver: (project: string) => bonds.getBudget(project),
  onKill: ({ agentId, project, reason, spentTodayUsd, budgetUsdPerDay }) => {
    logger.warn('budget_breach_pending', { agentId, project, reason, spentTodayUsd, budgetUsdPerDay });
    // Interpose grace window. If operator doesn't resolve within graceMs,
    // the pause module fires killAgent() automatically.
    budgetPause.arm({ agentId, project, reason, spentTodayUsd, budgetUsdPerDay });
  },
});
const cloudAppTelemetry = createCloudAppTelemetry(db, { costTracker, counters });
const contextTracker = createContextWindowTracker(db);
// Transcript recorder — backs `pd transcripts ...`, the dashboard panel, and
// (critically) makes every spawn record its full conversation. The spawner is
// constructed with enforceTranscriptPolicy:true, so wiring this is mandatory:
// without it createSpawner throws rather than run agents whose work vanishes.
//
// archiveSink: every finalized transcript is ALSO written, in full, to an
// always-on append-only JSONL archive OUTSIDE the live DB (~/.port-daddy/
// transcripts/), so the record survives DB loss/corruption/reset. This is the
// retention floor (ADR-0058); external warehouses plug in behind the same sink.
// Opt out with PD_TRANSCRIPT_ARCHIVE=off (durability is on by default).
const transcriptArchive =
  process.env.PD_TRANSCRIPT_ARCHIVE === 'off' ? undefined : createJsonlTranscriptArchive();
const transcripts = createTranscripts(db, { archiveSink: transcriptArchive });

// Session Galaxy — 2-D embedding map of recent agent sessions over
// fleet_transcripts. createLocalEmbedder gives the batch embed(texts[])
// interface the semanticResolver singleton lacks (its .embed is single-text);
// both share the on-disk model cache (~/.port-daddy/transformers-cache,
// ADR-0061 — never omit cacheDir, the built-in default is cwd-relative), so no
// second model download. The pipeline is lazy: the first /galaxy/map call may
// take seconds while MiniLM loads; the 30s per-param-tuple response cache in
// lib/galaxy.ts makes the steady state cheap.
const galaxyEmbedder = createLocalEmbedder({ cacheDir: defaultTransformersCacheDir() });
const galaxy = createGalaxy({ db, transcripts, sessions, embedder: galaxyEmbedder });

const spawner = createSpawner({
  costTracker, counters, bonds, harbors, transcripts,
  enforceTelemetryPolicy: true,
  enforceTranscriptPolicy: true,
  // Live observability seam (ADR-0060): give the spawner the daemon's messaging
  // layer as a tube client so cli-tube spawns that carry a stable channel (a
  // folded dispatch stamps `dispatch:<id>`) publish their exchange there. This is
  // what restores `pd tube dispatch:<id>` after the fold-in routed dispatch
  // through conductor → spawner.spawn → runCliTube. Adapter shape: messaging's
  // `publish` returns `{ success, id, error }`; the cli-tube TubeClientLike wants
  // `{ ok, id?, error? }`, so we translate. Best-effort — never throws.
  tubeClient: {
    publish: async (channel, payload, opts) => {
      try {
        const r = messaging.publish(channel, payload, opts?.sender ? { sender: opts.sender } : {});
        return r.success
          ? { ok: true, id: r.id }
          : { ok: false, error: r.error };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
});
spawnerRef = spawner;

// The Daemon Fleet Conductor (ADR-0060) — the ONE spawn primitive. Every surface
// that used to call `spawner.spawn` directly (the sortie POST, the reactive
// orchestrator) now routes through `conductor.launch(intent)`, so the daemon has
// a single chokepoint owning the bond/lineage/breaker/halt envelope. The
// conductor rebuilds the byte-identical spawn spec (golden-tested), so behavior
// at the spawner boundary is unchanged.
// Fleet cost-safety config (ADR-0060). These ARM the conductor's budget gates on
// the LIVE sortie/orchestrator paths. Without them the breaker governs nothing:
// no global ceiling, no per-launch reservation → I4/I5 admit everything. All are
// env-overridable; the defaults are deliberately conservative so the daemon is
// "safe to walk away" out of the box.
function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  const n = raw != null ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw != null ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
// $0 / 'off' / 'none' / 'unbounded' disables the global ceiling (explicit opt-out).
const _rawGlobalCeiling = process.env.PD_FLEET_GLOBAL_CEILING_USD?.trim().toLowerCase();
const FLEET_GLOBAL_CEILING_USD: number | null =
  _rawGlobalCeiling === 'off' || _rawGlobalCeiling === 'none' || _rawGlobalCeiling === 'unbounded' || _rawGlobalCeiling === '0'
    ? null
    : parsePositiveFloat(process.env.PD_FLEET_GLOBAL_CEILING_USD, 25);
const FLEET_LINEAGE_CEILING_USD = parsePositiveFloat(process.env.PD_FLEET_LINEAGE_CEILING_USD, 5);
const FLEET_DEFAULT_BOND_USD = parsePositiveFloat(process.env.PD_FLEET_DEFAULT_BOND_USD, 0.01);
const FLEET_MAX_DEPTH = parsePositiveInt(process.env.PD_FLEET_MAX_DEPTH, 3);
// Upper bound (ms) on the dispatch PR publish (git push + gh pr create). A hung
// publish must not pin a dispatch's in-flight slot until the OS TCP timeout; the
// Conductor abandons the await past this bound (resultArtifact null, run stays
// produced). Default 2 min; raise for slow remotes, never make it unbounded for
// an autonomous/overnight dispatch.
const FLEET_PUBLISH_TIMEOUT_MS = parsePositiveInt(process.env.PD_FLEET_PUBLISH_TIMEOUT_MS, 120_000);

const conductor = createConductor({
  db,
  // The real Spawner / bonds satisfy the Conductor's minimal duck-typed
  // interfaces at runtime; the casts bridge a nominal seam only (the real
  // spawn spec requires backend+task and the real bonds' `state` is the
  // BondState enum, vs the Conductor's structural `Record`/`string`). Shapes
  // are verified by the fleet-conductor golden + gate tests.
  spawner: spawner as unknown as Parameters<typeof createConductor>[0]['spawner'],
  bonds: bonds as unknown as Parameters<typeof createConductor>[0]['bonds'],
  broadcast: (channel: string, event: unknown) => messaging.publish(channel, event),
  maxDepth: FLEET_MAX_DEPTH,
  // ARM I4 on the live paths: every root launch without its own ceiling gets this
  // per-subtree cap, and every launch without a bond reserves this floor — so the
  // breaker actually accrues committed spend instead of reserving $0.
  defaultLineageCeilingUsd: FLEET_LINEAGE_CEILING_USD,
  defaultBondUsd: FLEET_DEFAULT_BOND_USD,
  // FIX 3 (ADR-0060): bound the dispatch publish so a wedged push/PR can't hold
  // the launch's in-flight slot indefinitely.
  publishTimeoutMs: FLEET_PUBLISH_TIMEOUT_MS,
  // ADR-0060 dispatch fold-in: the Conductor owns the dispatch worktree mint +
  // draft-PR publish so dispatch becomes a `worktree:'create', mergePolicy:'review'`
  // LaunchIntent (see lib/dispatch/conductor-adapter.ts). These hooks are only
  // exercised by `source:'dispatch'` launches (they carry worktreePath/branch/
  // baseRef); every other launch leaves them untouched.
  mintWorktree: async (_launch, intent) => {
    // I2 NO_SPAWN_ON_MAIN is satisfied here: carve a fresh off-main worktree on
    // the dispatch branch, then scope-disable the Coordination Guard inside it so
    // the autonomous agent can commit without an interactive `pd begin` session.
    if (!intent.worktreePath || !intent.worktreeBranch || !intent.worktreeBaseRef) {
      // Not a dispatch-shaped intent — fall back to the intent's own workdir.
      return intent.workdir;
    }
    await gitWorktreeAdd(intent.worktreePath, intent.worktreeBranch, intent.worktreeBaseRef);
    disableGuardInWorktree(intent.worktreePath);
    return intent.worktreePath;
  },
  publishArtifact: async (launch, intent) => {
    // Push the dispatch branch and open a draft PR; return its URL. Runs OUTSIDE
    // the cost breaker/bonds (Conductor guarantees this). A throw is swallowed by
    // the Conductor (resultArtifact stays null, launch not lost), but we also
    // catch here so the log message is dispatch-specific.
    if (!intent.worktreePath || !intent.worktreeBranch) return null;
    try {
      await gitPushBranch(intent.worktreePath, intent.worktreeBranch);
      // worktreeBaseRef is `<remote>/<branch>` (e.g. origin/main); the PR base is
      // the branch name with the remote prefix stripped.
      const baseRef = intent.worktreeBaseRef ?? 'origin/main';
      const slash = baseRef.indexOf('/');
      const baseBranch = slash >= 0 ? baseRef.slice(slash + 1) : baseRef;
      return await openDraftPr({
        branch: intent.worktreeBranch,
        baseBranch,
        goal: launch.goal,
        dispatchId: launch.id,
        worktreePath: intent.worktreePath,
      });
    } catch (e) {
      console.error('[Conductor] dispatch PR publish failed:', e);
      return null;
    }
  },
});
// ARM I5: register the GLOBAL ceiling so aggregate fleet spend is bounded. Without
// this the global breaker has a null ceiling = unbounded and never trips.
conductor.setGlobalCeiling(FLEET_GLOBAL_CEILING_USD);
if (FLEET_GLOBAL_CEILING_USD == null) {
  console.error('[Conductor] WARNING: PD_FLEET_GLOBAL_CEILING_USD disabled — aggregate fleet spend is UNBOUNDED.');
} else {
  console.error(`[Conductor] Fleet cost gates ARMED: global=$${FLEET_GLOBAL_CEILING_USD}, lineage=$${FLEET_LINEAGE_CEILING_USD}, bond floor=$${FLEET_DEFAULT_BOND_USD}, maxDepth=${FLEET_MAX_DEPTH}.`);
}

// ── Dispatch worker (ADR-0060 — the FOURTH spawn surface, folded into the Conductor) ──
// Before this, dispatch execution was bound to the foreground CLI for up to 6h;
// an interrupted CLI stranded the dispatch `in_progress` forever. The worker is a
// background poll loop that claims `proposed` dispatches and runs them — fully
// detached from any terminal — and recovers dispatches stranded by a previous
// daemon on start. Disable with PD_DISPATCH_WORKER=false.
//
// THE FOLD-IN: rather than the legacy inline spawn adapter (which did worktree +
// raw spawn + cost parse + PR itself), the worker is injected with the
// CONDUCTOR-backed adapter. Every dispatch therefore spawns through the ONE
// `conductor.launch` primitive — bond-gated, ceiling-gated, depth-capped,
// halt-able, capability-scoped, and refused on a main checkout — and the
// Conductor owns the worktree mint + cost pricing + draft-PR publish via its
// hooks above. The dispatch `costFn` is no longer threaded through (the Conductor
// prices the run), so it is omitted here. Live tube observability is preserved at
// the SPAWNER layer: the conductor stamps `dispatch:<id>` onto the spawn spec
// (intentToSpawnSpec) and the spawner — wired with `tubeClient: messaging` above —
// publishes the cli-tube exchange there, so `pd tube dispatch:<id>` still works.
const dispatchQueue = createDispatchQueue({ db });
const workIntentService = createWorkIntentService({ db });
const DISPATCH_WORKER_ENABLED = process.env.PD_DISPATCH_WORKER !== 'false';
const _dispatchConcurrency = parseInt(process.env.PD_DISPATCH_CONCURRENCY ?? '2', 10);
const DISPATCH_CONCURRENCY = Number.isFinite(_dispatchConcurrency) && _dispatchConcurrency >= 1
  ? Math.min(_dispatchConcurrency, 5)
  : 2;
const _dispatchPollMs = parseInt(process.env.PD_DISPATCH_POLL_MS ?? '5000', 10);
const DISPATCH_POLL_MS = Number.isFinite(_dispatchPollMs) && _dispatchPollMs >= 500
  ? _dispatchPollMs
  : 5000;
// Optional model pin for dispatch work. Absent → the CLI's authenticated default.
const DISPATCH_MODEL = process.env.PD_DISPATCH_MODEL?.trim() || undefined;
const dispatchWorker = DISPATCH_WORKER_ENABLED
  ? createDispatchWorker({
      queue: dispatchQueue,
      logger,
      maxConcurrency: DISPATCH_CONCURRENCY,
      pollIntervalMs: DISPATCH_POLL_MS,
      workIntentService,
      model: DISPATCH_MODEL,
      // THE INJECTION POINT: spawn every dispatch through the Conductor.
      spawnAdapter: createConductorSpawnAdapter(conductor),
    })
  : null;
if (dispatchWorker) dispatchWorker.start();

// ── Auto-merge sweep (merge_policy='auto') ──────────────────────────────────
// A DIFFERENT loop from the dispatch worker above: this one doesn't run
// agents, it checks already-produced PRs for dispatches proposed with
// `--merge-policy auto` and merges the ones that are CI-green + mergeable +
// zero unresolved review threads (lib/dispatch/auto-merge.ts owns the full
// safety gate). Disable with PD_DISPATCH_AUTOMERGE=false. Interval defaults
// to 60s — merges are rare relative to the 5s dispatch-poll cadence above, so
// there is no need to hammer `gh api` that often.
const DISPATCH_AUTOMERGE_ENABLED = process.env.PD_DISPATCH_AUTOMERGE !== 'false';
const _autoMergePollMs = parseInt(process.env.PD_DISPATCH_AUTOMERGE_POLL_MS ?? '60000', 10);
const DISPATCH_AUTOMERGE_POLL_MS = Number.isFinite(_autoMergePollMs) && _autoMergePollMs >= 5000
  ? _autoMergePollMs
  : 60000;
let autoMergeTimer: ReturnType<typeof setInterval> | null = null;
if (DISPATCH_AUTOMERGE_ENABLED) {
  const tick = () => {
    runAutoMergeSweep(dispatchQueue, { repoRoot: REPO_ROOT }).then((result) => {
      if (result.merged.length > 0 || result.errors.length > 0) {
        logger.info('dispatch_auto_merge_sweep', {
          checked: result.checked,
          merged: result.merged.length,
          blocked: result.blocked.length,
          errors: result.errors.length,
        });
      }
    }).catch((err) => {
      logger.warn('dispatch_auto_merge_sweep_failed', { error: err instanceof Error ? err.message : String(err) });
    });
  };
  autoMergeTimer = setInterval(tick, DISPATCH_AUTOMERGE_POLL_MS);
  autoMergeTimer.unref?.();
}

const resourceGovernance = createResourceGovernance({ repoRoot: REPO_ROOT, startedAt: STARTED_AT });

function resolveArbiterStrictMode(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return true;
  return !new Set(['0', 'false', 'off', 'no', 'observe', 'observe_only']).has(value.trim().toLowerCase());
}

semanticIndex.initialize();
const arbiterStrictMode = resolveArbiterStrictMode(process.env.PORT_DADDY_ARBITER_STRICT);
// Durable forensics journal — every Arbiter security event is written, in full,
// to an append-only JSONL journal OUTSIDE the live DB (~/.port-daddy/forensics/),
// so it survives the 7-day activity_log prune. Default on; opt out with
// PD_FORENSICS_ARCHIVE=off. (ADR-0089.)
const forensicsSink =
  process.env.PD_FORENSICS_ARCHIVE === 'off' ? undefined : createJsonlForensicsArchive();
const arbiter = createArbiter(
  { activityLog, agents, sessions, locks, resurrection, bonds, forensicsSink },
  { strictMode: arbiterStrictMode }
);
console.error(`[Arbiter] Runtime invariant enforcement active (6 rules, strictMode=${arbiterStrictMode}, forensicsJournal=${forensicsSink ? 'on' : 'off'})`);
const pheromones = createPheromoneManager(db);
pheromones.start();

// Phase 3 — Knowledge Custodian (daemon-resident compaction engine caretaker)
const operatorPermissions = createOperatorPermissions(db);
const CUSTODIAN_ENABLED = process.env.PD_CUSTODIAN_ENABLED !== 'false';
const _parsedPollMs = parseInt(process.env.PD_CUSTODIAN_POLL_MS ?? '60000', 10);
const CUSTODIAN_POLL_MS = Number.isFinite(_parsedPollMs) && _parsedPollMs >= 5000 ? _parsedPollMs : 60_000;
const custodian = CUSTODIAN_ENABLED
  ? createKnowledgeCustodian({
      db,
      logger,
      episodicMemory: episodicMemory as any,
      noteEncryption,
      messaging: messaging as any,
      resurrection,
      contextTracker: contextTracker as any,
      operatorPermissions,
      blobs: blobs as any,
      pollIntervalMs: CUSTODIAN_POLL_MS,
    })
  : null;
if (custodian) custodian.start();

// Phase 1 — Semantic Graph modules (orchestrator plugins, symbol index, merge queue)
const orchestratorRegistry = createOrchestratorRegistry(db, { activityLog });
const mergeQueue = createMergeQueue(db, {
  orchestratorRegistry,
  activityLog,
  graphEdges,
  tuples,
  semanticResolver,
});

const bosunHeartbeat = createBosunHeartbeat({
  heartbeatPath: HEARTBEAT_FILE,
  version: VERSION,
  plane: DAEMON_PLANE,
  codeHash: CODE_HASH,
  startedAt: STARTED_AT,
  installDir: __dirname,
  pidFile: PID_FILE,
  portFile: PORT_FILE,
  requirePidFileMatch: true,
  // Loopback probe of our own request pipeline over the primary Unix socket.
  // If HTTP wedges while the event loop keeps turning, the heartbeat halts and
  // Bosun restarts us (Bosun is HTTP-free by design and can't see this itself).
  selfProbe: createSocketHealthProbe({ socketPath: SOCK_PATH }),
  logger,
});

const orchestrator = createReactiveOrchestrator(db, messaging, spawner, conductor);
const correlationEngine = createCorrelationEngine(activityLog, sessions);

// Fleet daemon — always-on fleet subsystem (multi-project)
const fleetDaemon = createFleetDaemon({
  projects,
  messaging,
  tuples,
  semanticResolver,
  logger,
  daemonDir: __dirname,
  allowStableInstallFleet: ALLOW_STABLE_FLEET,
  costTracker,
  locks,
});

// GitHub repo → project registry. Resolves a webhook's owner/repo to the
// project that claims it (pd-fleet.yml `github.repo` or inferred git origin)
// so routes/github-webhook.ts can publish project-scoped channels and only
// that project's fleet fires. Project dirs come from the fleet daemon's live
// supervisor map; the registry caches and rebuilds on a TTL.
const repoRegistry = createRepoRegistry({
  getProjectDirs: () => fleetDaemon.listProjects(),
  logger,
});

// Wire resurrection events (identical to server.ts)
resurrection.on('agent:stale', (agent) => {
  messaging.publish('resurrection', JSON.stringify({
    event: 'stale', agentId: agent.id, name: agent.name,
    purpose: agent.purpose, lastHeartbeat: agent.lastHeartbeat, staleSince: agent.staleSince
  }));
  logger.info('agent_stale', { agentId: agent.id, name: agent.name });
});

resurrection.on('agent:dead', (agent) => {
  harbors.leaveAll(agent.id);

  // Capture the agent's active session ids BEFORE abandoning them, so the custodian
  // can harvest each session's notes into episodic memory while they remain queryable
  // (Item 6 — on-death fast path; without it, notes wait up to a poll interval or are
  // lost when the zombie protocol abandons the session first).
  const abandonedSessionIds = sessions.activeSessionIdsByAgent(agent.id);
  const zombied = sessions.abandonByAgent(agent.id);
  if (zombied > 0) {
    logger.warn('zombie_sessions_abandoned', { agentId: agent.id, count: zombied });
    activityLog.log(ActivityType.SESSION_END, {
      details: `Zombie protocol: ${zombied} active session(s) abandoned — agent ${agent.name || agent.id} is dead`,
      metadata: { agentId: agent.id, zombied }
    });
  }
  messaging.publish('resurrection', JSON.stringify({
    event: 'dead', agentId: agent.id, name: agent.name, purpose: agent.purpose,
    lastHeartbeat: agent.lastHeartbeat, staleSince: agent.staleSince, zombiedSessions: zombied
  }));
  messaging.publish('agents', JSON.stringify({
    event: 'dead', agentId: agent.id,
    message: `Agent ${agent.name || agent.id} is dead and queued for resurrection`
  }));
  logger.warn('agent_dead', { agentId: agent.id, name: agent.name });
  activityLog.log(ActivityType.AGENT_CLEANUP, {
    details: `Agent ${agent.name || agent.id} detected as dead, queued for resurrection`,
    metadata: { agentId: agent.id, staleSince: agent.staleSince }
  });

  if (custodian) {
    // Item 6 (on-death harvest): promote each abandoned session's notes immediately.
    for (const sid of abandonedSessionIds) void custodian.onSessionEnd(sid);

    // Items 1b + 2 (auto-resurrect): read the dying agent's self-salvage capsule as
    // untrusted respawn CONTEXT, and hand the custodian the AUTHENTICATED scope from the
    // verified StaleAgent record — never from the forgeable capsule. Passing scope as a
    // distinct argument makes a forged `capsule.identityProject` structurally unable to
    // influence the operator-permission check (ADR-0040 trust boundary).
    //
    // The raw capsule read back from resurrection.getSalvageCapsule() is only guaranteed
    // to be *some* plain object (see resurrection.ts's getSalvageCapsule — it just checks
    // `typeof === 'object'`), never that it matches SelfSalvageCapsule's shape. Run it
    // through the same normalizeSelfSalvage() producer contract that governs the capsule
    // elsewhere (telos-salvage.ts) before handing it to the custodian, so a malformed or
    // corrupted capsule degrades to `undefined` respawn context instead of propagating an
    // arbitrary shape into the resurrection_context inbox message / operator approval
    // payload.
    const rawCapsule = resurrection.getSalvageCapsule(agent.id);
    const salvage = normalizeSelfSalvage(rawCapsule);
    if (rawCapsule && !salvage.success) {
      logger.warn('salvage_capsule_invalid', { agentId: agent.id, error: salvage.error });
    }
    void custodian.onAgentDead(agent.id, agent.identityProject ?? '', salvage.capsule as Record<string, unknown> | undefined);
  }
});

resurrection.on('agent:resurrected', (oldAgentId, newAgentId) => {
  messaging.publish('resurrection', JSON.stringify({ event: 'resurrected', oldAgentId, newAgentId }));
  messaging.publish('agents', JSON.stringify({
    event: 'resurrected', oldAgentId, newAgentId,
    message: `Agent ${oldAgentId} has been resurrected as ${newAgentId}`
  }));
  logger.info('agent_resurrected', { oldAgentId, newAgentId });
});

interface DaemonMetrics {
  total_assignments: number;
  total_releases: number;
  total_cleanups: number;
  ports_freed_by_cleanup: number;
  validation_failures: number;
  race_condition_retries: number;
  messages_published: number;
  errors: number;
  uptime_start: number;
}

const metrics: DaemonMetrics = {
  total_assignments: 0, total_releases: 0, total_cleanups: 0,
  ports_freed_by_cleanup: 0, validation_failures: 0, race_condition_retries: 0,
  messages_published: 0, errors: 0, uptime_start: Date.now()
};

// =============================================================================
// BACKGROUND TASKS (identical to server.ts)
// =============================================================================

const systemPortsRefresh = startSystemPortsRefresh();

// =============================================================================
// CLEANUP (identical to server.ts)
// =============================================================================

function cleanupStale(): ReturnType<typeof services.cleanup> {
  const serviceResult = services.cleanup();
  messaging.cleanup();

  if (isInSleepGracePeriod()) {
    logger.info('sleep_grace_active', {
      message: 'Skipping agent reaping during post-sleep grace period',
      graceUntil: new Date(sleepGraceUntil).toISOString()
    });
  } else {
    interface AgentListItem {
      id: string; name: string | null; isActive: boolean;
      lastHeartbeat: number; status?: string; metadata?: { purpose?: string } | null;
      identityProject?: string | null; identityStack?: string | null; identityContext?: string | null;
    }

    const allAgents = agents.list();
    const inactiveAgents = ((allAgents.agents || []) as AgentListItem[]).filter(a => !a.isActive);

    if (inactiveAgents.length > 0) {
      const inactiveIds = inactiveAgents.map(a => a.id);
      const placeholders = inactiveIds.map(() => '?').join(', ');

      interface AgentSessionRow { agent_id: string; session_id: string }
      const agentSessionRows = db.prepare(`
        SELECT agent_id, id AS session_id FROM sessions
        WHERE agent_id IN (${placeholders}) AND status = 'active'
        GROUP BY agent_id HAVING MAX(updated_at)
      `).all(...inactiveIds) as AgentSessionRow[];

      const agentSessionMap = new Map<string, string>(
        agentSessionRows.map(r => [r.agent_id, r.session_id])
      );

      const sessionIds = agentSessionRows.map(r => r.session_id);
      const notesBySession = new Map<string, string[]>();

      if (sessionIds.length > 0) {
        const notePlaceholders = sessionIds.map(() => '?').join(', ');
        interface NoteRow { session_id: string; content: string }
        const noteRows = db.prepare(`
          SELECT session_id, content FROM session_notes
          WHERE session_id IN (${notePlaceholders})
          ORDER BY session_id, created_at ASC
        `).all(...sessionIds) as NoteRow[];

        for (const row of noteRows) {
          if (!notesBySession.has(row.session_id)) notesBySession.set(row.session_id, []);
          notesBySession.get(row.session_id)!.push(row.content);
        }
      }

      for (const agent of inactiveAgents) {
        const sessionId = agentSessionMap.get(agent.id);
        const notes = sessionId ? (notesBySession.get(sessionId) ?? []) : [];
        resurrection.check({
          id: agent.id, name: agent.name || agent.id,
          purpose: agent.metadata?.purpose, sessionId,
          lastHeartbeat: agent.lastHeartbeat,
          status: agent.status,
          notes,
          identityProject: agent.identityProject ?? undefined,
          identityStack: agent.identityStack ?? undefined,
          identityContext: agent.identityContext ?? undefined,
        });
      }
    }

    const agentCleanup = agents.cleanup(locks);
    if (agentCleanup.cleaned > 0) {
      logger.info('agent_cleanup', agentCleanup);
      activityLog.log(ActivityType.AGENT_CLEANUP, {
        details: `cleaned ${agentCleanup.cleaned} stale agents`,
        metadata: agentCleanup
      });
    }

    const orphanedSessions = sessions.abandonOrphanedActive({
      olderThan: agents.DEFAULT_CLEANUP_TTL,
    });
    if (orphanedSessions.count > 0) {
      logger.warn('orphaned_active_sessions_abandoned', orphanedSessions);
    }

    // Obligation monitor — the dual of resurrection's heartbeat sweep, run in the
    // SAME sleep-grace-gated block (Law 1: skip during post-sleep grace so a
    // laptop wake does not mark every open promise overdue). The daemon supplies
    // `now`; the commitment row never does. Emits OBLIGATION_OVERDUE per breach.
    const overdueResult = obligationMonitor.checkOverdue(Date.now());
    if (overdueResult.count > 0) {
      logger.warn('obligations_overdue', {
        count: overdueResult.count,
        ids: overdueResult.overdue.map((c) => c.id),
      });
    }
  }

  activityLog.cleanup();
  webhooks.cleanup();
  sessions.cleanup();
  agentInbox.cleanup();
  resurrection.cleanup();
  // Unified retention sweep + page reclaim + self-footprint sample (see createObservabilityMaintenance).
  try { observabilityMaintenance.tick(); } catch (err) {
    governor.governed({ key: 'observability_maintenance_failed', level: 'error', message: 'observability_maintenance_failed', meta: { error: (err as Error).message } });
  }
  db.pragma('wal_checkpoint(PASSIVE)');
  metrics.total_cleanups++;
  return serviceResult;
}

// =============================================================================
// FASTIFY APP + PLUGINS
// =============================================================================

const app: FastifyInstance = Fastify({
  bodyLimit: 10240,  // 10kb (replaces express.json({ limit: '10kb' }))
  logger: false,     // We use winston, not pino
});

// --- Request Logging (Debug) ---
if (process.env.DEBUG_TESTS) {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    console.error(`[DEBUG] INCOMING: ${request.method} ${request.url}`);
    if (request.body) console.error(`[DEBUG] BODY: ${JSON.stringify(request.body)}`);
  });
}

// --- CORS (replaces cors middleware) ---
await app.register(fastifyCors, createDaemonCorsOptions());

// --- Rate Limiting (replaces express-rate-limit) ---
await app.register(fastifyRateLimit, {
  max: config.security.rate_limit.max_requests,
  timeWindow: config.security.rate_limit.window_ms,
  keyGenerator: (request: FastifyRequest): string => {
    const body = request.body as Record<string, unknown> | undefined;
    if (body?.project && typeof body.project === 'string') {
      return `project:${body.project.substring(0, 50)}`;
    }
    if (body?.id && typeof body.id === 'string') {
      return `id:${body.id.substring(0, 50)}`;
    }
    return `pid:${request.headers['x-pid'] || 'unknown'}`;
  },
  allowList: (request: FastifyRequest): boolean => {
    if (request.url === '/health' || request.url === '/version') return true;
    const ip = request.ip || '';
    if (!ip) return true;
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    return false;
  },
  errorResponseBuilder: () => ({ error: 'Too many requests, please slow down' }),
});

type EmbeddedPublicAsset = {
  path?: string;
  name?: string;
  type?: string;
  dataBase64?: string;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

function contentTypeForPublicPath(path: string, fallback?: string): string {
  if (fallback) return fallback;
  switch (extname(path).toLowerCase()) {
    case '.css': return 'text/css; charset=utf-8';
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.md': return 'text/markdown; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.ts': return 'text/plain; charset=utf-8';
    case '.txt': return 'text/plain; charset=utf-8';
    case '.yml':
    case '.yaml': return 'text/yaml; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function embeddedPublicAssets(): Map<string, EmbeddedPublicAsset> {
  const globalAssets = (globalThis as typeof globalThis & {
    __PORT_DADDY_EMBEDDED_PUBLIC_ASSETS__?: readonly EmbeddedPublicAsset[];
  }).__PORT_DADDY_EMBEDDED_PUBLIC_ASSETS__;
  const bun = (globalThis as typeof globalThis & {
    Bun?: { embeddedFiles?: readonly EmbeddedPublicAsset[] };
  }).Bun;
  const assets = new Map<string, EmbeddedPublicAsset>();
  for (const asset of globalAssets ?? []) {
    if (asset.path?.startsWith('/')) assets.set(asset.path, asset);
  }
  for (const blob of bun?.embeddedFiles ?? []) {
    const name = blob.name?.replace(/\\/g, '/');
    if (!name?.startsWith('public/')) continue;
    assets.set(`/${name.slice('public/'.length)}`, blob);
  }
  return assets;
}

async function registerEmbeddedPublicAssets(appInstance: FastifyInstance): Promise<boolean> {
  const assets = embeddedPublicAssets();
  if (assets.size === 0) return false;

  const registered = new Set<string>();
  const registerAssetRoute = (route: string, asset: EmbeddedPublicAsset): void => {
    if (registered.has(route)) return;
    registered.add(route);
    appInstance.get(route, async (_request: FastifyRequest, reply: FastifyReply) => {
      const body = asset.dataBase64
        ? Buffer.from(asset.dataBase64, 'base64')
        : Buffer.from(await asset.arrayBuffer!());
      reply.header('Cache-Control', route.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      reply.type(contentTypeForPublicPath(route, asset.type));
      return reply.send(body);
    });
  };

  for (const [route, blob] of assets) {
    registerAssetRoute(route, blob);
    if (route.endsWith('/index.html')) {
      const directoryRoute = route.slice(0, -'index.html'.length);
      registerAssetRoute(directoryRoute, blob);
      registerAssetRoute(directoryRoute.replace(/\/$/, ''), blob);
    }
  }
  logger.info('embedded_public_assets_registered', { count: assets.size });
  return true;
}

// --- Static Files (replaces express.static) ---
const publicRoot = join(__dirname, 'public');
if (existsSync(publicRoot)) {
  await app.register(fastifyStatic, {
    root: publicRoot,
    prefix: '/',
    decorateReply: false,  // Don't decorate reply with sendFile — we only serve static
  });
} else if (!(await registerEmbeddedPublicAssets(app))) {
  logger.warn('public_assets_missing', { publicRoot });
}

// --- DNS Rebinding Protection (replaces custom middleware) ---
app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
  const host = (request.headers.host || '').replace(/:\d+$/, '');
  const allowedHosts = ['localhost', '127.0.0.1', '[::1]', '::1', ''];
  if (!allowedHosts.includes(host) && !host.endsWith('.local')) {
    reply.code(403);
    return { error: 'Invalid Host header' };
  }
});

// --- Security Headers (replaces custom middleware) ---
app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  // Allow same-origin framing so fleet-ui (/fleet-ui/) can embed /metrics.html.
  // The DNS rebinding hook above restricts requests to loopback hosts plus any
  // host ending in `.local` (mDNS / Bonjour names used by FleetBar and local
  // tooling). SAMEORIGIN is the strictest framing policy that still allows the
  // in-app Metrics tab to render; tightening back to DENY breaks that path.
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:* ws://[::1]:* http://[::1]:*; img-src 'self' data:; frame-ancestors 'self';"
  );
});

// --- Request metrics + sampled logging ---
//
// Per-request JSON dumps to winston grew port-daddy.log to 625 MB. We now record
// every request into the in-memory MetricsRegistry (Prometheus histograms +
// outlier ring) and only log to disk when the request is interesting:
//   - any non-2xx/3xx status
//   - any duration above the slow threshold (default 1000 ms)
//   - a small random sample of successes when requestSamplingRate > 0
// /metrics/* paths are excluded from observation entirely (we shouldn't
// measure the cost of measuring); SSE long-poll routes are observed in the
// histograms but skipped from the outlier ring inside MetricsRegistry itself
// (see lib/metrics-registry.ts LONG_POLL_ROUTES).
const SLOW_REQUEST_MS = 1000;
// Clamp to [0, 1] — values outside that range would either disable sampling
// (negative) or log every successful request (>1), neither of which the
// config docs promise.
const requestSamplingRate = Math.min(1, Math.max(0, config.logging.requestSamplingRate ?? 0));

app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
  const url = request.url ?? '';
  if (url.startsWith('/metrics')) return;

  // Fastify 5 — request.routeOptions.url is the route TEMPLATE (e.g. "/projects/:id").
  // Falling back to "(unknown)" for static-served files / 404s keeps cardinality bounded.
  const routeTemplate = request.routeOptions?.url ?? (reply.statusCode === 404 ? '(404)' : '(unknown)');
  const durationMs = reply.elapsedTime;
  const status = reply.statusCode;

  metricsRegistry.observeHttpRequest({
    method: request.method,
    route: routeTemplate,
    rawPath: url,
    statusCode: status,
    durationMs,
  });

  // Persist a coarse minute-bucketed counter so the dashboard seasonality
  // heatmap has multi-day history beyond the in-memory window.
  // Status class only (not exact code) to keep counter cardinality low.
  counters.bump('http.requests', {
    method: request.method,
    route: routeTemplate,
    status: status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx',
  });

  const isError = status >= 400;
  const isSlow = durationMs >= SLOW_REQUEST_MS;
  const shouldSample = requestSamplingRate > 0 && Math.random() < requestSamplingRate;
  if (!isError && !isSlow && !shouldSample) return;

  const meta = {
    method: request.method,
    path: url,
    route: routeTemplate,
    status,
    duration_ms: +durationMs.toFixed(2),
    reason: isError ? 'error' : isSlow ? 'slow' : 'sampled',
  };
  if (isError) logger.warn('request', meta);
  else logger.info('request', meta);
});

// --- Dashboard Broadcast on Mutations (replaces custom middleware) ---
app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    if (reply.statusCode >= 200 && reply.statusCode < 300) {
      broadcastDashboard('refresh', { trigger: request.url });
    }
  }
});

// --- Ping route ---
app.get('/ping', async () => {
  return { status: 'ok', pid: process.pid };
});

// =============================================================================
// ROUTES (native Fastify plugins — Phase 3)
// =============================================================================

// #160: collect every registered route into a registry so /health and /status
// can verify the daemon's critical routes are actually mounted (not 404). An
// onRoute hook on the root instance fires for all descendant plugin routes.
const routeRegistry = new Set<string>();
app.addHook('onRoute', (routeOptions) => {
  const methods = Array.isArray(routeOptions.method)
    ? routeOptions.method
    : [routeOptions.method];
  for (const m of methods) {
    routeRegistry.add(`${String(m).toUpperCase()} ${routeOptions.url}`);
  }
});

await registerAllRoutes(
  app,
  {
    db, logger, metrics, config,
    routeRegistry,
    services, messaging, locks, health, agents, activityLog, webhooks, projects, sessions,
    agentInbox, resurrection, changelog, tunnel, dns, resolver, briefing, sugar, attention, symbolClaims,
    harbors, sorties, conductor, dispatchQueue, dispatchWorker, workIntentService, orchestrator, correlationEngine, spawner, transcripts, tuples, blobs, booty, fleetDaemon, repoRegistry,
    orchestratorRegistry, symbolIndex, mergeQueue, graphEdges, episodicMemory, semanticResolver, durableAgentRoster, costTracker, cloudAppTelemetry, counters, metricsRegistry,
    // Episodic-memory consolidation: harvest routes need the encryption
    // inspector (skip encrypted-at-rest notes) and the shared embedder
    // (hybrid recall — lexical-only is never a silent fallback).
    noteEncryption, embedder: galaxyEmbedder,
    contextTracker,
    custodian, operatorPermissions,
    quorum, parley, galaxy, resourceGovernance, feedback, roadmapPop, roadmapItems, roadmapPromote,
    commitments, obligationMonitor, suggestions, whois,
    bonds, budgetGuard, budgetPause, actorSouls,
    arbiter, bosunHeartbeat,
    VERSION, CODE_HASH, STARTED_AT, __dirname, repoRoot: REPO_ROOT,
    runningBinarySnapshot: RUNNING_BINARY_SNAPSHOT,
    daemonBerth: DAEMON_BERTH,
    plane: DAEMON_PLANE,
    cleanupStale, getSystemPorts,
    // Relay (ADR-0049) connection status. The daemon does not yet start the
    // outbound RelayConnectionManager (lib/relay-client.ts), so this honestly
    // reports "not connected" — `pd relay status` shows disconnected even when
    // a relay_url is configured. When the SSE manager is wired, replace this
    // with the manager's live status getter.
    getRelayStatus: () => ({
      connected: false,
      session_id: null,
      last_handshake: null as number | null,
      accepted_channels: [] as string[],
      relay_version: null as string | null,
    }),
  },
  arbiter,
  { pheromones, sessions, db },
);

// =============================================================================
// DASHBOARD SSE (Fastify raw reply pattern)
// =============================================================================

const dashboardClients = new Set<http.ServerResponse>();

app.get('/dashboard/events', async (request: FastifyRequest, reply: FastifyReply) => {
  if (dashboardClients.size >= 20) {
    reply.code(429);
    return { error: 'too many dashboard connections' };
  }

  // Take control of the raw response — Fastify won't send its own
  reply.hijack();
  const raw = reply.raw;

  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write('data: {"type":"connected"}\n\n');
  dashboardClients.add(raw);
  request.raw.on('close', () => { dashboardClients.delete(raw); });
});

function broadcastDashboard(event: string, data?: Record<string, unknown>): void {
  if (dashboardClients.size === 0) return;
  const payload = JSON.stringify({ type: event, ...data });
  for (const client of dashboardClients) {
    client.write(`data: ${payload}\n\n`);
  }
}

// --- Global Error Handler (replaces 4-arg Express middleware) ---
app.setErrorHandler((err: Error & { type?: string; statusCode?: number }, request: FastifyRequest, reply: FastifyReply) => {
  logger.error('unhandled_error', {
    error: err.message,
    type: err.type || err.name,
    path: request.url,
    method: request.method
  });

  if (err.type === 'entity.too.large' || err.statusCode === 413) {
    reply.code(413);
    return { error: 'request payload too large' };
  }
  if (err.type === 'entity.parse.failed' || (err.statusCode === 400 && err.message?.includes('JSON'))) {
    reply.code(400);
    return { error: 'invalid JSON' };
  }
  reply.code(500);
  return { error: 'internal server error' };
});

// =============================================================================
// LIFECYCLE (identical to server.ts)
// =============================================================================

setInterval(() => cleanupStale(), config.cleanup.interval_ms);

setInterval(() => {
  const now = Date.now();
  const elapsed = now - lastWakeCheck;
  if (elapsed > SLEEP_DETECTION_GAP_MS) {
    sleepGraceUntil = now + SLEEP_GRACE_PERIOD_MS;
    logger.warn('sleep_detected', {
      message: 'System sleep detected, entering grace period',
      gapMs: elapsed,
      graceUntil: new Date(sleepGraceUntil).toISOString()
    });
  }
  lastWakeCheck = now;
}, SLEEP_CHECK_INTERVAL_MS);

function shutdown(signal: string): void {
  logger.info('shutdown_initiated', { signal });
  // Remove this berth's own registry entry on a clean stop, so it doesn't
  // linger as a stale record until the next prune pass notices the dead pid.
  if (DAEMON_BERTH.tier !== 'stable') {
    deregisterDaemonBerth(process.pid, {
      onError: (error) => logger.warn('daemon_berth_deregister_failed', { error: error.message }),
    });
  }
  try {
    activityLog.log(ActivityType.DAEMON_STOP, {
      details: `Port Daddy stopped (${signal})`,
      metadata: { signal, uptime: Date.now() - STARTED_AT }
    });
    webhooks.trigger(WebhookEvent.DAEMON_STOP, {
      signal, uptime: Date.now() - STARTED_AT, version: VERSION
    });
  } catch (e) {
    logger.error('shutdown_logging_failed', { error: (e as Error).message });
  }
  // Flush counters before closing DB (pending in-memory batches)
  try { counters.shutdown(); } catch {}
  // Flush any pending log-suppression rollups so a governed tail isn't lost on exit.
  try { governor.flushAll(); } catch {}
  try { tunnel.stopAll(); } catch {}
  try { tunnel.dispose?.(); } catch {}
  try { bosunHeartbeat.stop(); } catch {}
  // Stop fleet runners before closing DB (graceful drain)
  try { fleetDaemon.stop(); } catch {}
  try { dispatchWorker?.stop(); } catch {}
  try { if (autoMergeTimer) clearInterval(autoMergeTimer); } catch {}
  systemPortsRefresh.stop();
  if (ipcServer) ipcServer.stop().catch(() => {});
  closeDatabase(db);
  try { unlinkSync(SOCK_PATH); } catch {}
  try { unlinkSync(PID_FILE); } catch {}
  try { unlinkSync(PORT_FILE); } catch {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => {
  logger.info('sighup_received', { action: 'fleet_reload' });
  try {
    fleetDaemon.reload();
    logger.info('fleet_reloaded_via_sighup');
  } catch (err) {
    logger.error('fleet_reload_failed', { error: (err as Error).message });
  }
});

// Global failure visibility — previously ABSENT (the audit's top dev-dogfooding gap). Without these,
// an unhandled rejection crashed the daemon with a terse message (Node ≥15 terminates by default) and
// a corrupting exception went unlogged. Governed so a flapping async fault can't itself become spam.
process.on('unhandledRejection', (reason: unknown) => {
  governor.governed({
    key: 'unhandled_rejection',
    level: 'error',
    message: 'unhandled_rejection',
    meta: {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    },
  });
});
process.on('uncaughtException', (err: Error) => {
  // Undefined state: log loudly (bypass dedup — this is fatal + singular), flush, and let the
  // supervisor (launchd/brew KeepAlive) respawn cleanly rather than limp on in a corrupt state.
  logger.error('uncaught_exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

function onReady(): void {
  activityLog.log(ActivityType.DAEMON_START, {
    details: `Port Daddy v${VERSION} started (Fastify)`,
    metadata: { port: PORT, pid: process.pid, codeHash: CODE_HASH, socket: SOCK_PATH }
  });
  webhooks.trigger(WebhookEvent.DAEMON_START, {
    version: VERSION, port: PORT, pid: process.pid
  });
  webhooks.retryPending();

  // Start mid-claim hash watcher. Cheap (sha256 every ~5s over the active
  // claim set), unref()'d so it doesn't keep the process alive on its own.
  try {
    claimWatcher.start();
  } catch (err) {
    logger.error('claim_watcher_start_failed', { error: (err as Error).message });
  }

  // Start fleet daemon — auto-discovers pd-fleet.yml in registered projects.
  // Named sidecar profiles default this off so they cannot accidentally arm the
  // same project fleet as the canonical daemon.
  if (DISABLE_FLEET) {
    logger.info('fleet_daemon_disabled', { reason: 'PORT_DADDY_NO_FLEET' });
  } else {
    try {
      fleetDaemon.start();
      const status = fleetDaemon.getStatus();
      if (status.fleets.length > 0) {
        logger.info('fleet_daemon_active', {
          fleets: status.fleets.map(f => f.project),
          totalAgents: status.totalAgents,
          totalWatchers: status.totalWatchers,
        });
      }
    } catch (err) {
      logger.error('fleet_daemon_start_failed', { error: (err as Error).message });
    }
  }

  if (DISABLE_FLEETBAR) {
    logger.info('fleetbar_launch_skipped', { reason: 'PORT_DADDY_NO_FLEETBAR' });
  } else {
    const fleetBarLaunch = launchFleetBarIfEnabled({
      logger,
      repoRoot: REPO_ROOT,
      daemonPort: PORT,
    });

    if (fleetBarLaunch.launched) {
      logger.info('fleetbar_launch_complete', {
        target: fleetBarLaunch.target,
        daemonPort: PORT,
      });
    }
  }
}

// =============================================================================
// IPC Server (binary protocol for agent hot path)
// =============================================================================

const ipcRouter = createIpcRouter({
  services,
  agents,
  sessions,
  locks,
  tuples,
  messaging,
  pheromones,
  resurrection,
  sugar,
  fleet: {
    promptLine: (project: string, since?: number) => fleetDaemon.getPromptLine(project, since),
  },
});

const ipcServer = DISABLE_IPC ? null : createIpcServer({
  socketPath: IPC_PATH,
  onFrame: ipcRouter.handleFrame,
  onConnect: (conn) => {
    logger.info('ipc_connect', { connId: conn.id });
  },
  onDisconnect: (conn) => {
    logger.info('ipc_disconnect', {
      connId: conn.id, agentId: conn.agentId,
      framesIn: conn.framesIn, bytesIn: conn.bytesIn,
      subscriptions: conn.subscriptions.length, framesDropped: conn.framesDropped,
    });
    // Do not couple lock lifetime to IPC socket lifetime.
    // The SDK uses short-lived IPC request/response clients for lock operations,
    // so disconnect-time release would silently drop freshly acquired locks.
    // TTL expiry and stale-agent cleanup remain the recovery path.
  },
  onError: (err, conn) => {
    logger.error('ipc_error', { error: err.message, connId: conn?.id, agentId: conn?.agentId });
  },
});

// =============================================================================
// LISTEN (Fastify: unix socket primary, TCP secondary)
// =============================================================================
// Fastify can only listen on one address per .listen() call. For dual-listen
// (unix socket + TCP), we use app.routing to share the handler with a second
// http.Server for TCP.

await app.ready();

const tcpHost: string = !config.service.host || config.service.host === 'localhost'
  ? LOOPBACK_TCP_HOST
  : config.service.host;

// Primary: Unix domain socket
try { unlinkSync(SOCK_PATH); } catch {}
const sockServer = http.createServer((req, res) => { app.routing(req, res); });
sockServer.listen(SOCK_PATH, async () => {
  try { writeFileSync(PID_FILE, String(process.pid)); } catch {}
  bosunHeartbeat.start();
  logger.info('socket_started', { socket: SOCK_PATH, version: VERSION });

  // Tertiary: Binary IPC socket for agent hot path
  if (ipcServer) {
    try {
      await ipcServer.start();
      logger.info('ipc_started', { socket: IPC_PATH, actions: ipcRouter.actions.length });
    } catch (err) {
      logger.error('ipc_start_failed', { error: (err as Error).message });
    }
  }

  // Secondary: TCP for dashboard/browser access
  if (!DISABLE_TCP) {
    const MAX_PORT_ATTEMPTS: number = 11;
    const ALLOW_TCP_FALLBACK = process.env.PD_ALLOW_TCP_FALLBACK === '1';
    function tryListenTcp(attempt: number = 0): void {
      const tryPort: number = PORT + attempt;
      if (attempt >= MAX_PORT_ATTEMPTS) {
        logger.error('tcp_bind_failed', { message: `Could not bind TCP on ports ${PORT}-${PORT + MAX_PORT_ATTEMPTS - 1}` });
        onReady();
        if (!isSilent) {
          console.log(`Port Daddy v${VERSION} listening on ${SOCK_PATH} (TCP unavailable: ports ${PORT}-${PORT + MAX_PORT_ATTEMPTS - 1} all in use)`);
        }
        return;
      }
      const tcpServer = http.createServer((req, res) => { app.routing(req, res); });
      tcpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // On the canonical port specifically, probe the existing owner
          // before falling back. Two Port Daddy daemons on different TCP
          // ports but the same SQLite DB silently corrupt each other; refuse
          // to start instead. PD_ALLOW_TCP_FALLBACK=1 restores legacy walk.
          if (attempt === 0) {
            void probePortOwner(tcpHost, tryPort).then((probe) => {
              const decision = decideTakeover({ probe, selfPid: process.pid, allowFallback: ALLOW_TCP_FALLBACK });
              if (decision.action === 'refuse') {
                logger.error('tcp_bind_blocked_by_sibling', {
                  port: tryPort,
                  reason: decision.reason,
                  foreignPid: decision.foreignPid,
                  probeKind: probe.kind,
                  probeVersion: probe.version,
                  probeUptimeSeconds: probe.uptimeSeconds,
                });
                if (!isSilent) {
                  console.error(`Port Daddy v${VERSION} refusing to start: ${decision.reason}`);
                  console.error(`  Existing daemon pid: ${decision.foreignPid ?? '(unknown)'}`);
                  console.error('  Resolve by killing the stale daemon or unsetting PD_ALLOW_TCP_FALLBACK only after verifying it is safe.');
                }
                process.exit(1);
              }
              logger.warn('tcp_port_busy', { port: tryPort, nextAttempt: tryPort + 1, reason: decision.reason });
              tryListenTcp(attempt + 1);
            }).catch((probeErr: Error) => {
              // If the probe itself fails unexpectedly, fall back rather
              // than refuse — refusing on probe failure would be a worse
              // failure mode than the legacy behavior.
              logger.warn('tcp_port_busy', { port: tryPort, nextAttempt: tryPort + 1, probeError: probeErr.message });
              tryListenTcp(attempt + 1);
            });
            return;
          }
          logger.warn('tcp_port_busy', { port: tryPort, nextAttempt: tryPort + 1 });
          tryListenTcp(attempt + 1);
        } else {
          logger.error('tcp_listen_error', { port: tryPort, error: err.message });
          onReady();
          if (!isSilent) {
            console.log(`Port Daddy v${VERSION} listening on ${SOCK_PATH} (TCP error: ${err.message})`);
          }
        }
      });
      tcpServer.on('listening', () => {
        try { writeFileSync(PORT_FILE, String(tryPort), { mode: 0o644 }); } catch {}
        logger.info('tcp_started', { port: tryPort, host: tcpHost, version: VERSION });
        // Self-register this berth (ADR-0084) so FleetBar's berth picker can
        // see it regardless of how this daemon was launched — registration
        // no longer depends on going through `pd dev up`. A no-op for the
        // stable tier (see registerDaemonBerth's own doc comment). tryPort is
        // the port actually bound, which can differ from DAEMON_BERTH.port
        // if the originally-requested port was busy and the retry loop above
        // moved on — register the real one.
        registerDaemonBerth({ ...DAEMON_BERTH, port: tryPort }, process.pid, {
          onError: (err) => logger.warn('daemon_berth_registration_failed', { error: err.message }),
        });
        // Surface binary drift on the boot path so an operator running
        // `tail -f port-daddy.log` after `brew upgrade` sees it immediately.
        // The check is cheap (one hash) and the snapshot is already taken.
        try {
          const drift = detectDrift({ runningSnapshot: RUNNING_BINARY_SNAPSHOT });
          if (drift.drifted) {
            logger.warn('binary_drift_detected', {
              runningHash: drift.runningHash,
              onDiskHash: drift.onDiskHash,
              runningPath: drift.runningPath,
              onDiskPath: drift.onDiskPath,
              reason: drift.reason,
            });
            if (!isSilent) {
              console.warn(`\n  ⚠️  Binary drift detected. Restart: pd stop && pd start\n     ${drift.reason}\n`);
            }
          }
        } catch (err) {
          logger.warn('binary_drift_check_failed', { error: (err as Error).message });
        }
        onReady();
        if (!isSilent) {
          const portNote: string = tryPort !== PORT ? ` (fallback from ${PORT})` : '';
          console.log(`
  Port Daddy v${VERSION}   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HTTP:       ${SOCK_PATH}
  IPC:        ${ipcServer ? IPC_PATH : 'disabled'}
  Dashboard:  http://${tcpHost}:${tryPort}/${portNote}
  Database:   ${DB_PATH}
  Port range: ${config.ports.range_start}-${config.ports.range_end}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Ready to assign ports!
          `);
        }
      });
      tcpServer.listen(tryPort, tcpHost);
    }
    tryListenTcp();
  } else {
    onReady();
    if (!isSilent) {
      console.log(`Port Daddy v${VERSION} (Fastify) listening on ${SOCK_PATH}`);
    }
  }
});
