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
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
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
import { createClaimWatcher } from './lib/claim-watcher.js';
import { createResurrection } from './lib/resurrection.js';
import { createChangelog } from './lib/changelog.js';
import { createTunnel } from './lib/tunnel.js';
import { createDns } from './lib/dns.js';
import { createResolver } from './lib/resolver.js';
import { createSpawner } from './lib/spawner.js';
import { createBriefing } from './lib/briefing.js';
import { createSugar } from './lib/sugar.js';
import { createHarbors } from './lib/harbors.js';
import { createHarborTokens } from './lib/harbor-tokens.js';
import { createSorties } from './lib/sorties.js';
import { createPheromoneManager } from './lib/pheromone.js';
import { createReactiveOrchestrator } from './lib/orchestrator.js';
import { createCorrelationEngine } from './lib/correlation.js';
import { createArbiter } from './lib/arbiter.js';
import { createSemanticIndex } from './lib/semantic-index.js';
import { createTupleSpace } from './lib/tuples.js';
import { createBlobStore } from './lib/blob.js';
import { createNoteEncryption } from './lib/note-encryption.js';
import { initDatabase, closeDatabase, resolveDbPath } from './lib/db.js';
import { createIpcServer } from './lib/ipc-server.js';
import { createIpcRouter } from './lib/ipc-router.js';
import { createFleetDaemon } from './lib/fleet-daemon.js';
import { createOrchestratorRegistry } from './lib/orchestrator-plugins.js';
import { createSymbolIndex } from './lib/symbol-index.js';
import { createMergeQueue } from './lib/merge-queue.js';
import { createCostTracker } from './lib/cost-tracker.js';
import { createCounters } from './lib/counters.js';
import { createMetricsRegistry } from './lib/metrics-registry.js';
import { createBonds } from './lib/bonds.js';
import { createBudgetGuard } from './lib/budget-guard.js';
import { createBudgetPause } from './lib/budget-pause.js';
import { createQuorum } from './lib/quorum.js';
import { createFeedback } from './lib/feedback.js';
import { launchFleetBarIfEnabled } from './lib/fleetbar-launcher.js';
import { createGraphEdges } from './lib/graph-edges.js';
import { createEpisodicMemory } from './lib/episodic-memory.js';
import { createSemanticResolver } from './lib/semantic-resolver.js';
import { createBosunHeartbeat } from './lib/bosun-heartbeat.js';
import { createResourceGovernance } from './lib/resource-governance.js';

// Fastify route aggregator (Phase 3 — native Fastify plugins, no Express bridge)
import { registerAllRoutes } from './routes/index.js';

// Shared utilities
import { getSystemPorts, startSystemPortsRefresh } from './shared/port-utils.js';
import { LOOPBACK_TCP_HOST } from './shared/daemon-discovery.js';
import { calculateRuntimeCodeHash } from './shared/code-hash.js';

const __dirname: string = dirname(fileURLToPath(import.meta.url));
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
      service: { port: 9876, host: LOOPBACK_TCP_HOST },
      ports: { range_start: 3100, range_end: 9999, reserved: [8080, 8000, 9876] },
      cleanup: { interval_ms: 300000 },
      logging: { level: 'info', file: 'port-daddy.log', error_file: 'port-daddy-error.log' },
      security: { rate_limit: { window_ms: 60000, max_requests: 1000 } }
    };

const pkgPath: string = join(__dirname, 'package.json');
const pkg: { version: string } = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string } : { version: '2.0.0' };
const VERSION: string = pkg.version;

// =============================================================================
// CODE HASH (identical to server.ts)
// =============================================================================

function calculateCodeHash(): string {
  return calculateRuntimeCodeHash(__dirname);
}

const CODE_HASH: string = calculateCodeHash();
const STARTED_AT: number = Date.now();

// =============================================================================
// LOGGING (identical to server.ts)
// =============================================================================

const isSilent: boolean = process.env.PORT_DADDY_SILENT === '1';

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
      filename: join(__dirname, config.logging.error_file),
      level: 'error',
      maxsize: config.logging.maxsize ?? 50 * 1024 * 1024,
      maxFiles: config.logging.maxFiles ?? 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: join(__dirname, config.logging.file),
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

// =============================================================================
// DATABASE + PATHS (identical to server.ts)
// =============================================================================

const PREFIX: string | undefined = process.env.PORT_DADDY_PREFIX;
const IS_DEV_MODE: boolean = !!PREFIX;

const DB_PATH: string = resolveDbPath(PREFIX ? join(PREFIX, 'port-daddy.db') : undefined);
const PORT: number = parseInt(process.env.PORT_DADDY_PORT as string, 10) || (IS_DEV_MODE ? 9877 : config.service.port);
import { DEFAULT_SOCK, DEFAULT_IPC, DEFAULT_PID_FILE, DEFAULT_PORT_FILE } from './shared/paths.js';
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || (PREFIX ? join(PREFIX, 'port-daddy.sock') : DEFAULT_SOCK);
const DISABLE_TCP: boolean = process.env.PORT_DADDY_NO_TCP === '1';
const IPC_PATH: string = process.env.PORT_DADDY_IPC || (PREFIX ? join(PREFIX, 'port-daddy.ipc') : DEFAULT_IPC);
const DISABLE_IPC: boolean = process.env.PORT_DADDY_NO_IPC === '1';
const DISABLE_FLEET: boolean = process.env.PORT_DADDY_NO_FLEET === '1';
const DISABLE_FLEETBAR: boolean = process.env.PORT_DADDY_NO_FLEETBAR === '1';
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
// =============================================================================

if (existsSync(SOCK_PATH)) {
  const isAlive: boolean = await new Promise<boolean>((resolve) => {
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

  if (isAlive) {
    let existingPid = '?';
    try { existingPid = readFileSync(PID_FILE, 'utf-8').trim(); } catch {}
    console.error(`Port Daddy already running (PID ${existingPid}). Not starting a second daemon.`);
    process.exit(0);
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

const db: Database.Database = initDatabase({ dbPath: DB_PATH });

// =============================================================================
// MODULE INITIALIZATION (identical to server.ts)
// =============================================================================

const semanticIndex = createSemanticIndex(db);
const graphEdges = createGraphEdges(db);
const symbolIndex = createSymbolIndex(db, { graphEdges });
const tuples = createTupleSpace(db);
const blobs = createBlobStore();
const counters = createCounters(db);
const metricsRegistry = createMetricsRegistry();
const semanticResolver = createSemanticResolver(db, {
  cacheDir: join(REPO_ROOT, '.cache', 'transformers'),
  counters,
  graphEdges,
  tuples,
  logger,
});
const episodicMemory = createEpisodicMemory(db, { tuples, graphEdges, semanticResolver });
const quorum = createQuorum({ tuples });
const feedback = createFeedback({ tuples });

const services = createServices(db, { semanticIndex });
const messaging = createMessaging(db);
const locks = createLocks(db);
const health = createHealth(db, services as Parameters<typeof createHealth>[1]);
const agents = createAgents(db, { semanticIndex });
const activityLog = createActivityLog(db);
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

const agentInbox = createAgentInbox(db, (agentId, message) => {
  messaging.publish(`inbox:${agentId}`, {
    ...message,
    sender: message.from || 'SYSTEM',
    signal: (message as any).signal || 'report'
  });
});
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
const sugar = createSugar({ agents, sessions, activityLog });
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
const budgetGuard = createBudgetGuard(db, {}, {
  broadcast: (channel, event) => messaging.publish(channel, event),
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
const spawner = createSpawner({ costTracker, counters, bonds, harbors, enforceTelemetryPolicy: true });
spawnerRef = spawner;
const resourceGovernance = createResourceGovernance({ repoRoot: REPO_ROOT, startedAt: STARTED_AT });

function resolveArbiterStrictMode(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return true;
  return !new Set(['0', 'false', 'off', 'no', 'observe', 'observe_only']).has(value.trim().toLowerCase());
}

semanticIndex.initialize();
const arbiterStrictMode = resolveArbiterStrictMode(process.env.PORT_DADDY_ARBITER_STRICT);
const arbiter = createArbiter(
  { activityLog, agents, sessions, locks, resurrection, bonds },
  { strictMode: arbiterStrictMode }
);
console.error(`[Arbiter] Runtime invariant enforcement active (6 rules, strictMode=${arbiterStrictMode})`);
const pheromones = createPheromoneManager(db);
pheromones.start();

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
  codeHash: CODE_HASH,
  startedAt: STARTED_AT,
  installDir: __dirname,
  pidFile: PID_FILE,
  portFile: PORT_FILE,
  requirePidFileMatch: true,
  logger,
});

const orchestrator = createReactiveOrchestrator(db, messaging, spawner);
const correlationEngine = createCorrelationEngine(activityLog, sessions);

// Fleet daemon — always-on fleet subsystem (multi-project)
const fleetDaemon = createFleetDaemon({
  projects,
  messaging,
  tuples,
  semanticResolver,
  logger,
  daemonDir: __dirname,
  costTracker,
  locks,
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
  }

  activityLog.cleanup();
  webhooks.cleanup();
  sessions.cleanup();
  agentInbox.cleanup();
  resurrection.cleanup();
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
await app.register(fastifyCors, {
  origin: /^https?:\/\/(localhost|127\.0\.0\.1|dashboard\.pd\.local)(:\d+)?$/,
  credentials: true
});

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

// --- Static Files (replaces express.static) ---
await app.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  prefix: '/',
  decorateReply: false,  // Don't decorate reply with sendFile — we only serve static
});

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
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:* ws://[::1]:* http://[::1]:*; img-src 'self' data:; frame-ancestors 'none';"
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

await registerAllRoutes(
  app,
  {
    db, logger, metrics, config,
    services, messaging, locks, health, agents, activityLog, webhooks, projects, sessions,
    agentInbox, resurrection, changelog, tunnel, dns, resolver, briefing, sugar,
    harbors, sorties, orchestrator, correlationEngine, spawner, tuples, blobs, fleetDaemon,
    orchestratorRegistry, symbolIndex, mergeQueue, graphEdges, episodicMemory, semanticResolver, costTracker, counters, metricsRegistry,
    quorum, resourceGovernance, feedback,
    bonds, budgetGuard, budgetPause,
    arbiter, bosunHeartbeat,
    VERSION, CODE_HASH, STARTED_AT, __dirname, repoRoot: REPO_ROOT,
    cleanupStale, getSystemPorts,
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
  try { tunnel.stopAll(); } catch {}
  try { tunnel.dispose?.(); } catch {}
  try { bosunHeartbeat.stop(); } catch {}
  // Stop fleet runners before closing DB (graceful drain)
  try { fleetDaemon.stop(); } catch {}
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
