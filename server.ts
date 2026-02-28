#!/usr/bin/env node

/**
 * Port Daddy - Semantic Port Management Service
 *
 * Features:
 * - Semantic identities: project:stack:context
 * - Service directory: local/tunnel/dev/staging/prod URLs
 * - Pub/sub messaging for agent coordination
 * - Agent registry, distributed locks, webhooks
 */

import express from 'express';
import type { Request, Response, NextFunction, Express } from 'express';
import Database from 'better-sqlite3';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import winston from 'winston';
import rateLimit from 'express-rate-limit';

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
import { createResurrection } from './lib/resurrection.js';
import { createChangelog } from './lib/changelog.js';
import { createTunnel } from './lib/tunnel.js';
import { initDatabase, resolveDbPath } from './lib/db.js';

// Route aggregator
import { createRoutes } from './routes/index.js';

// Shared utilities
import { getSystemPorts } from './shared/port-utils.js';

const __dirname: string = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// CONFIGURATION
// =============================================================================

interface PortDaddyServerConfig {
  service: { port: number; host: string };
  ports: { range_start: number; range_end: number; reserved: number[] };
  cleanup: { interval_ms: number };
  logging: { level: string; file: string; error_file: string };
  security: { rate_limit: { window_ms: number; max_requests: number } };
}

const configPath: string = join(__dirname, 'config.json');
const config: PortDaddyServerConfig = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8')) as PortDaddyServerConfig
  : {
      service: { port: 9876, host: 'localhost' },
      ports: { range_start: 3100, range_end: 9999, reserved: [8080, 8000, 9876] },
      cleanup: { interval_ms: 300000 },
      logging: { level: 'info', file: 'port-daddy.log', error_file: 'port-daddy-error.log' },
      security: { rate_limit: { window_ms: 60000, max_requests: 1000 } }
    };

const pkgPath: string = join(__dirname, 'package.json');
const pkg: { version: string } = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string } : { version: '2.0.0' };
const VERSION: string = pkg.version;

// =============================================================================
// CODE HASH (stale daemon detection)
// =============================================================================

function calculateCodeHash(): string {
  // Dynamically discover all .ts files in lib/ — no more parallel lists to maintain
  const libDir: string = join(__dirname, 'lib');
  const libFiles: string[] = existsSync(libDir)
    ? readdirSync(libDir).filter((f: string) => f.endsWith('.ts')).sort().map((f: string) => `lib/${f}`)
    : [];
  const filesToHash: string[] = ['server.ts', ...libFiles];

  const hash = createHash('sha256');
  for (const file of filesToHash) {
    const filePath: string = join(__dirname, file);
    if (existsSync(filePath)) {
      hash.update(readFileSync(filePath));
    }
  }
  return hash.digest('hex').slice(0, 12);
}

const CODE_HASH: string = calculateCodeHash();
const STARTED_AT: number = Date.now();

// =============================================================================
// LOGGING
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
      level: 'error'
    }),
    new winston.transports.File({
      filename: join(__dirname, config.logging.file)
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
// DATABASE (schema lives in lib/db.ts — shared with CLI direct mode)
// =============================================================================

const DB_PATH: string = resolveDbPath();
const PORT: number = parseInt(process.env.PORT_DADDY_PORT as string, 10) || config.service.port;
const SOCK_PATH: string = process.env.PORT_DADDY_SOCK || '/tmp/port-daddy.sock';
const DISABLE_TCP: boolean = process.env.PORT_DADDY_NO_TCP === '1';
const db: Database.Database = initDatabase({ dbPath: DB_PATH });

// =============================================================================
// MODULE INITIALIZATION
// =============================================================================

const services = createServices(db);
const messaging = createMessaging(db);
const locks = createLocks(db);
// Cast services to the shape expected by createHealth — the actual runtime
// object satisfies the interface but TS can't verify discriminated union compat.
const health = createHealth(db, services as Parameters<typeof createHealth>[1]);
const agents = createAgents(db);
const activityLog = createActivityLog(db);
const webhooks = createWebhooks(db);
const projects = createProjects(db);
const sessions = createSessions(db);
sessions.setActivityLog(activityLog);
const agentInbox = createAgentInbox(db);
const resurrection = createResurrection(db);
const changelog = createChangelog(db);
const tunnel = createTunnel(db);

// Wire resurrection events to broadcast on the radio
resurrection.on('agent:stale', (agent) => {
  messaging.publish('resurrection', JSON.stringify({
    event: 'stale',
    agentId: agent.id,
    name: agent.name,
    purpose: agent.purpose,
    lastHeartbeat: agent.lastHeartbeat,
    staleSince: agent.staleSince
  }));
  logger.info('agent_stale', { agentId: agent.id, name: agent.name });
});

resurrection.on('agent:dead', (agent) => {
  messaging.publish('resurrection', JSON.stringify({
    event: 'dead',
    agentId: agent.id,
    name: agent.name,
    purpose: agent.purpose,
    lastHeartbeat: agent.lastHeartbeat,
    staleSince: agent.staleSince
  }));
  // Also broadcast on general agent channel
  messaging.publish('agents', JSON.stringify({
    event: 'dead',
    agentId: agent.id,
    message: `Agent ${agent.name || agent.id} is dead and queued for resurrection`
  }));
  logger.warn('agent_dead', { agentId: agent.id, name: agent.name });
  activityLog.log(ActivityType.AGENT_CLEANUP, {
    details: `Agent ${agent.name || agent.id} detected as dead, queued for resurrection`,
    metadata: { agentId: agent.id, staleSince: agent.staleSince }
  });
});

resurrection.on('agent:resurrected', (oldAgentId, newAgentId) => {
  messaging.publish('resurrection', JSON.stringify({
    event: 'resurrected',
    oldAgentId,
    newAgentId
  }));
  messaging.publish('agents', JSON.stringify({
    event: 'resurrected',
    oldAgentId,
    newAgentId,
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
  total_assignments: 0,
  total_releases: 0,
  total_cleanups: 0,
  ports_freed_by_cleanup: 0,
  validation_failures: 0,
  race_condition_retries: 0,
  messages_published: 0,
  errors: 0,
  uptime_start: Date.now()
};

// =============================================================================
// CLEANUP
// =============================================================================

function cleanupStale(): ReturnType<typeof services.cleanup> {
  // Cleanup V2 services and expired messages
  const serviceResult = services.cleanup();
  messaging.cleanup();

  // Check agents for staleness and queue for resurrection BEFORE cleanup deletes them
  const allAgents = agents.list();
  interface AgentListItem {
    id: string;
    name: string | null;
    isActive: boolean;
    lastHeartbeat: number;
    metadata?: { purpose?: string } | null;
  }
  interface SessionListItem { id: string }
  interface NoteListItem { content: string }

  for (const agent of (allAgents.agents || []) as AgentListItem[]) {
    if (!agent.isActive) {
      // Get agent's session and notes for resurrection context
      const agentSessions = sessions.list({ agentId: agent.id, status: 'active' });
      const notes: string[] = [];
      const sessionsList = (agentSessions.sessions || []) as unknown as SessionListItem[];
      for (const session of sessionsList) {
        const sessionNotes = sessions.getNotes(session.id);
        const notesList = (sessionNotes.notes || []) as unknown as NoteListItem[];
        for (const note of notesList) {
          notes.push(note.content);
        }
      }

      resurrection.check({
        id: agent.id,
        name: agent.name || agent.id,
        purpose: agent.metadata?.purpose,
        sessionId: sessionsList[0]?.id,
        lastHeartbeat: agent.lastHeartbeat,
        notes
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

  activityLog.cleanup();
  webhooks.cleanup();
  sessions.cleanup();
  agentInbox.cleanup();
  resurrection.cleanup();

  metrics.total_cleanups++;
  return serviceResult;
}

// =============================================================================
// EXPRESS APP + ROUTES
// =============================================================================

const app: Express = express();

app.use(rateLimit({
  windowMs: config.security.rate_limit.window_ms,
  max: config.security.rate_limit.max_requests,
  keyGenerator: (req: Request): string => {
    if (req.body?.project && typeof req.body.project === 'string') {
      return `project:${req.body.project.substring(0, 50)}`;
    }
    if (req.body?.id && typeof req.body.id === 'string') {
      return `id:${req.body.id.substring(0, 50)}`;
    }
    return `pid:${req.headers['x-pid'] || 'unknown'}`;
  },
  skip: (req: Request): boolean => {
    // Skip rate limiting for health checks
    if (req.path === '/health' || req.path === '/version') return true;
    // Skip for localhost/loopback (this is a local dev tool)
    const ip = req.ip || req.socket.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
    return false;
  },
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(cors({
  origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.static(join(__dirname, 'public')));

app.use((req: Request, res: Response, next: NextFunction): void => {
  const start: number = Date.now();
  res.on('finish', () => {
    logger.info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start
    });
  });
  next();
});

// Mount all routes via aggregator
app.use(createRoutes({
  db, logger, metrics, config,
  services, messaging, locks, health, agents, activityLog, webhooks, projects, sessions,
  agentInbox, resurrection, changelog, tunnel,
  VERSION, CODE_HASH, STARTED_AT, __dirname,
  cleanupStale, getSystemPorts
}));

// Global error handler
app.use((err: Error & { type?: string }, req: Request, res: Response, _next: NextFunction): void => {
  logger.error('unhandled_error', {
    error: err.message,
    type: err.type || err.name,
    path: req.path,
    method: req.method
  });

  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'request payload too large' });
    return;
  }
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid JSON' });
    return;
  }
  res.status(500).json({ error: 'internal server error' });
});

// =============================================================================
// LIFECYCLE
// =============================================================================

setInterval(() => cleanupStale(), config.cleanup.interval_ms);

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
    // Best-effort logging during shutdown — don't let it prevent exit
    logger.error('shutdown_logging_failed', { error: (e as Error).message });
  }
  db.close();
  // Clean up socket file
  try { unlinkSync(SOCK_PATH); } catch {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function onReady(): void {
  activityLog.log(ActivityType.DAEMON_START, {
    details: `Port Daddy v${VERSION} started`,
    metadata: { port: PORT, pid: process.pid, codeHash: CODE_HASH, socket: SOCK_PATH }
  });

  webhooks.trigger(WebhookEvent.DAEMON_START, {
    version: VERSION, port: PORT, pid: process.pid
  });
  webhooks.retryPending();
}

// Primary listener: Unix domain socket (no port needed)
try { unlinkSync(SOCK_PATH); } catch {}
app.listen(SOCK_PATH, () => {
  logger.info('socket_started', { socket: SOCK_PATH, version: VERSION });

  // Also listen on TCP for dashboard/browser access (unless disabled)
  if (!DISABLE_TCP) {
    app.listen(PORT, config.service.host, () => {
      logger.info('tcp_started', { port: PORT, host: config.service.host, version: VERSION });
      onReady();

      if (!isSilent) {
        console.log(`
  Port Daddy v${VERSION}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Socket:     ${SOCK_PATH}
  Dashboard:  http://${config.service.host}:${PORT}/
  Database:   ${DB_PATH}
  Port range: ${config.ports.range_start}-${config.ports.range_end}
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  API:
    POST   /claim             Claim port with semantic ID
    DELETE /release           Release by ID/pattern
    GET    /services          List services
    POST   /msg/:channel      Publish message
    GET    /agents            List agents
    GET    /activity          Activity log
    POST   /webhooks          Register webhook

  Ready to assign ports!
        `);
      }
    });
  } else {
    // Socket-only mode (used by ephemeral test daemons)
    onReady();
    if (!isSilent) {
      console.log(`Port Daddy v${VERSION} listening on ${SOCK_PATH}`);
    }
  }
});
