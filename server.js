#!/usr/bin/env node

/**
 * Port Daddy - Authoritative port assignment service
 *
 * Runs on localhost:9876 and manages port assignments for all dev servers
 * across multiple AI agent sessions. Prevents port conflicts through atomic
 * SQLite transactions and automatic cleanup of stale processes.
 */

import express from 'express';
import Database from 'better-sqlite3';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import winston from 'winston';
import rateLimit from 'express-rate-limit';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// CONFIGURATION
// =============================================================================

const configPath = join(__dirname, 'config.json');
const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8'))
  : {
      service: { port: 9876, host: 'localhost' },
      ports: { range_start: 3100, range_end: 9999, reserved: [8080, 8000, 9876] },
      cleanup: { interval_ms: 300000 },
      logging: { level: 'info', file: 'port-daddy.log', error_file: 'port-daddy-error.log' },
      security: { rate_limit: { window_ms: 60000, max_requests: 100 } }
    };

const versionPath = join(__dirname, 'VERSION');
const VERSION = existsSync(versionPath)
  ? readFileSync(versionPath, 'utf8').trim()
  : '0.0.0-dev';

// =============================================================================
// INPUT VALIDATION (Security Fix #1)
// =============================================================================

const PROJECT_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const PROJECT_NAME_MAX_LENGTH = 255;
const PID_MIN = 1;
const PID_MAX = 99999;

function validateProjectName(project) {
  if (!project || typeof project !== 'string') {
    return { valid: false, error: 'project name must be a non-empty string' };
  }
  if (project.length > PROJECT_NAME_MAX_LENGTH) {
    return { valid: false, error: `project name too long (max ${PROJECT_NAME_MAX_LENGTH} characters)` };
  }
  if (!PROJECT_NAME_REGEX.test(project)) {
    return { valid: false, error: 'project name contains invalid characters (use alphanumeric, dash, underscore, dot)' };
  }
  return { valid: true };
}

function validatePid(pidValue) {
  if (pidValue === undefined || pidValue === null) {
    return { valid: true, pid: null };
  }
  const pid = parseInt(pidValue, 10);
  if (isNaN(pid) || pid < PID_MIN || pid > PID_MAX) {
    return { valid: false, error: `PID must be between ${PID_MIN} and ${PID_MAX}` };
  }
  return { valid: true, pid };
}

function validatePort(portValue) {
  if (portValue === undefined || portValue === null) {
    return { valid: true, port: null };
  }
  const port = parseInt(portValue, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return { valid: false, error: 'port must be between 1 and 65535' };
  }
  return { valid: true, port };
}

function validatePreferredPort(portValue, rangeStart, rangeEnd, reservedPorts) {
  const baseValidation = validatePort(portValue);
  if (!baseValidation.valid) return baseValidation;
  if (baseValidation.port === null) return { valid: true, port: null };

  const port = baseValidation.port;
  if (port < rangeStart || port > rangeEnd) {
    return { valid: false, error: `preferred port must be in range ${rangeStart}-${rangeEnd}` };
  }
  if (reservedPorts.includes(port)) {
    return { valid: false, error: 'preferred port is reserved and cannot be assigned' };
  }
  return { valid: true, port };
}

// =============================================================================
// LOGGING
// =============================================================================

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'port-daddy', version: VERSION },
  transports: [
    new winston.transports.File({
      filename: join(__dirname, config.logging.error_file),
      level: 'error'
    }),
    new winston.transports.File({
      filename: join(__dirname, config.logging.file)
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// =============================================================================
// DATABASE
// =============================================================================

const DB_PATH = join(__dirname, 'port-registry.db');
const PORT = config.service.port;
const PORT_RANGE_START = config.ports.range_start;
const PORT_RANGE_END = config.ports.range_end;
const RESERVED_PORTS = config.ports.reserved;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS port_assignments (
    port INTEGER PRIMARY KEY,
    project TEXT NOT NULL,
    pid INTEGER NOT NULL,
    started INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_project ON port_assignments(project);
  CREATE INDEX IF NOT EXISTS idx_pid ON port_assignments(pid);
`);

// Prepared statements for better performance and safety
const stmts = {
  getByProject: db.prepare('SELECT * FROM port_assignments WHERE project = ?'),
  getByPort: db.prepare('SELECT * FROM port_assignments WHERE port = ?'),
  insert: db.prepare('INSERT INTO port_assignments (port, project, pid, started, last_seen) VALUES (?, ?, ?, ?, ?)'),
  updateLastSeen: db.prepare('UPDATE port_assignments SET last_seen = ? WHERE port = ?'),
  deleteByPort: db.prepare('DELETE FROM port_assignments WHERE port = ?'),
  deleteByProject: db.prepare('DELETE FROM port_assignments WHERE project = ?'),
  getAllPorts: db.prepare('SELECT port FROM port_assignments'),
  getAll: db.prepare('SELECT port, pid, project FROM port_assignments'),
  getAllFull: db.prepare('SELECT port, project, pid, started, last_seen FROM port_assignments ORDER BY port'),
  getPortProject: db.prepare('SELECT port, project FROM port_assignments'),
  countAll: db.prepare('SELECT COUNT(*) as count FROM port_assignments')
};

// =============================================================================
// METRICS
// =============================================================================

const metrics = {
  total_assignments: 0,
  total_releases: 0,
  total_cleanups: 0,
  ports_freed_by_cleanup: 0,
  validation_failures: 0,
  race_condition_retries: 0,
  errors: 0,
  uptime_start: Date.now()
};

// =============================================================================
// EXPRESS APP
// =============================================================================

const app = express();

// Rate limiting - keyed by project or PID (Security Fix #5)
const limiter = rateLimit({
  windowMs: config.security.rate_limit.window_ms,
  max: config.security.rate_limit.max_requests,
  keyGenerator: (req) => {
    if (req.body && req.body.project && typeof req.body.project === 'string') {
      return `project:${req.body.project.substring(0, 50)}`;
    }
    const pid = req.headers['x-pid'] || 'unknown';
    return `pid:${pid}`;
  },
  skip: (req) => req.path === '/health' || req.path === '/version',
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false
});

// CORS - localhost only
app.use(cors({
  origin: ['http://localhost:9876', 'http://127.0.0.1:9876'],
  credentials: true
}));

app.use(limiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(join(__dirname, 'public')));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
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

// =============================================================================
// UTILITY FUNCTIONS (using spawnSync with arrays - safe from injection)
// =============================================================================

function isProcessAlive(pid) {
  try {
    const result = spawnSync('ps', ['-p', String(pid)], {
      stdio: 'ignore',
      timeout: 1000
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// Caching for system port scans (DoS prevention)
let systemPortsCache = { data: null, timestamp: 0 };
const SYSTEM_PORTS_CACHE_TTL = 2000;

function getSystemPorts() {
  const now = Date.now();
  if (systemPortsCache.data && (now - systemPortsCache.timestamp) < SYSTEM_PORTS_CACHE_TTL) {
    return systemPortsCache.data;
  }

  try {
    const result = spawnSync('lsof', ['-i', '-P', '-n', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });

    if (result.status !== 0 || !result.stdout) {
      return systemPortsCache.data || [];
    }

    const lines = result.stdout.trim().split('\n').slice(1);
    const ports = [];
    const maxLines = 1000;

    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      const parts = lines[i].split(/\s+/);
      if (parts.length < 9) continue;
      const command = parts[0];
      const pid = parseInt(parts[1], 10);
      const user = parts[2];
      const name = parts[8];
      const portMatch = name.match(/:(\d+)$/);
      if (portMatch) {
        ports.push({ port: parseInt(portMatch[1], 10), pid, command, user });
      }
    }

    const seen = new Set();
    const deduplicated = ports.filter(p => {
      if (seen.has(p.port)) return false;
      seen.add(p.port);
      return true;
    }).sort((a, b) => a.port - b.port);

    systemPortsCache = { data: deduplicated, timestamp: now };
    return deduplicated;
  } catch (err) {
    logger.error('system_port_scan_failed', { error: err.message });
    return systemPortsCache.data || [];
  }
}

function isPortInUseOnSystem(port) {
  try {
    const result = spawnSync('lsof', ['-i', `:${port}`, '-P', '-n', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      timeout: 2000
    });
    return result.status === 0 && result.stdout && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function cleanupStale() {
  const entries = stmts.getAll.all();
  const freed = [];
  for (const entry of entries) {
    if (!isProcessAlive(entry.pid)) {
      stmts.deleteByPort.run(entry.port);
      freed.push({ port: entry.port, project: entry.project });
    }
  }
  if (freed.length > 0) {
    metrics.total_cleanups++;
    metrics.ports_freed_by_cleanup += freed.length;
    logger.info('cleanup_completed', { freed_count: freed.length, freed_ports: freed });
  }
  return freed;
}

function findAvailablePort() {
  const dbUsed = stmts.getAllPorts.all().map(r => r.port);
  const systemPorts = getSystemPorts().map(p => p.port);
  const usedSet = new Set([...dbUsed, ...systemPorts, ...RESERVED_PORTS]);

  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (!usedSet.has(port) && !isPortInUseOnSystem(port)) {
      return port;
    }
  }
  throw new Error('No available ports in range');
}

// Atomic port assignment with retry (race condition fix)
const assignPortTransaction = db.transaction((port, project, pid, now) => {
  stmts.insert.run(port, project, pid, now, now);
  return true;
});

function assignPortWithRetry(project, preferredPort, requestingPid, maxRetries = 3) {
  const now = Date.now();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      let port = preferredPort || findAvailablePort();
      const existing = stmts.getByPort.get(port);

      if (existing) {
        if (isProcessAlive(existing.pid)) {
          if (preferredPort) { port = findAvailablePort(); preferredPort = null; }
          continue;
        } else {
          stmts.deleteByPort.run(port);
        }
      }

      if (isPortInUseOnSystem(port)) {
        if (preferredPort) { port = findAvailablePort(); preferredPort = null; }
        continue;
      }

      assignPortTransaction(port, project, requestingPid, now);
      return { port, success: true, retries: attempt };

    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        metrics.race_condition_retries++;
        logger.debug('port_assignment_retry', { project, attempt: attempt + 1 });
        preferredPort = null;
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to assign port after retries');
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// =============================================================================
// API ENDPOINTS
// =============================================================================

app.get('/version', (req, res) => {
  res.json({ version: VERSION, service: 'port-daddy', node_version: process.version });
});

app.get('/metrics', (req, res) => {
  const uptime_seconds = Math.floor((Date.now() - metrics.uptime_start) / 1000);
  res.json({
    ...metrics,
    active_ports: stmts.countAll.get().count,
    uptime_seconds,
    uptime_formatted: formatUptime(uptime_seconds)
  });
});

app.post('/ports/request', (req, res) => {
  try {
    const { project, preferred } = req.body;

    const projectValidation = validateProjectName(project);
    if (!projectValidation.valid) {
      metrics.validation_failures++;
      logger.warn('validation_failed', { field: 'project', error: projectValidation.error });
      return res.status(400).json({ error: projectValidation.error });
    }

    const pidValidation = validatePid(req.headers['x-pid']);
    if (!pidValidation.valid) {
      metrics.validation_failures++;
      return res.status(400).json({ error: pidValidation.error });
    }
    const requestingPid = pidValidation.pid || process.pid;

    const portValidation = validatePreferredPort(preferred, PORT_RANGE_START, PORT_RANGE_END, RESERVED_PORTS);
    if (!portValidation.valid) {
      metrics.validation_failures++;
      return res.status(400).json({ error: portValidation.error });
    }

    const now = Date.now();
    const existing = stmts.getByProject.get(project);

    if (existing) {
      if (isProcessAlive(existing.pid)) {
        stmts.updateLastSeen.run(now, existing.port);
        logger.info('port_renewed', { port: existing.port, project, pid: existing.pid });
        return res.json({ port: existing.port, message: 'existing assignment renewed', existing: true });
      } else {
        stmts.deleteByPort.run(existing.port);
        logger.info('stale_assignment_cleared', { port: existing.port, project, old_pid: existing.pid });
      }
    }

    let portToTry = portValidation.port;
    if (portToTry && isPortInUseOnSystem(portToTry)) {
      logger.info('preferred_port_system_conflict', { port: portToTry, project });
      portToTry = null;
    }

    const result = assignPortWithRetry(project, portToTry, requestingPid);
    metrics.total_assignments++;
    logger.info('port_assigned', { port: result.port, project, pid: requestingPid, preferred: !!portValidation.port && result.port === portValidation.port, retries: result.retries });

    res.json({ port: result.port, message: portValidation.port && result.port === portValidation.port ? 'assigned preferred port' : 'port assigned successfully' });

  } catch (error) {
    metrics.errors++;
    logger.error('port_request_failed', { error: error.message, project: req.body?.project ? 'provided' : 'missing' });
    res.status(500).json({ error: error.message });
  }
});

app.delete('/ports/release', (req, res) => {
  try {
    const { port, project } = req.body;

    if (port !== undefined) {
      const portValidation = validatePort(port);
      if (!portValidation.valid) {
        metrics.validation_failures++;
        return res.status(400).json({ error: portValidation.error });
      }
      const existing = stmts.getByPort.get(portValidation.port);
      stmts.deleteByPort.run(portValidation.port);
      metrics.total_releases++;
      logger.info('port_released', { port: portValidation.port, project: existing?.project });
      res.json({ success: true, message: `released port ${portValidation.port}` });

    } else if (project !== undefined) {
      const projectValidation = validateProjectName(project);
      if (!projectValidation.valid) {
        metrics.validation_failures++;
        return res.status(400).json({ error: projectValidation.error });
      }
      const result = stmts.deleteByProject.run(project);
      metrics.total_releases += result.changes;
      logger.info('ports_released_by_project', { project, count: result.changes });
      res.json({ success: true, message: `released ${result.changes} port(s) for project ${project}` });

    } else {
      res.status(400).json({ error: 'port or project required' });
    }
  } catch (error) {
    metrics.errors++;
    logger.error('port_release_failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/ports/active', (req, res) => {
  try {
    const entries = stmts.getAllFull.all();
    const enhanced = entries.map(e => ({
      ...e,
      alive: isProcessAlive(e.pid),
      age_minutes: Math.floor((Date.now() - e.started) / 60000),
      started_at: new Date(e.started).toISOString(),
      last_seen_at: new Date(e.last_seen).toISOString()
    }));
    res.json({ ports: enhanced, count: enhanced.length });
  } catch (error) {
    metrics.errors++;
    logger.error('list_ports_failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

const systemPortsLimiter = rateLimit({ windowMs: 60000, max: 30, message: { error: 'System port scanning rate limited' } });

app.get('/ports/system', systemPortsLimiter, (req, res) => {
  try {
    const systemPorts = getSystemPorts();
    const dbAssignments = stmts.getPortProject.all();
    const dbMap = new Map(dbAssignments.map(a => [a.port, a.project]));

    let filtered = systemPorts.map(p => ({ ...p, managed_by_port_daddy: dbMap.has(p.port), project: dbMap.get(p.port) || null }));

    if (req.query.range_only === 'true') filtered = filtered.filter(p => p.port >= PORT_RANGE_START && p.port <= PORT_RANGE_END);
    if (req.query.unmanaged_only === 'true') filtered = filtered.filter(p => !p.managed_by_port_daddy);

    res.json({ ports: filtered, count: filtered.length, total_system_ports: systemPorts.length });
  } catch (error) {
    metrics.errors++;
    logger.error('system_ports_failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.post('/ports/cleanup', (req, res) => {
  try {
    const freed = cleanupStale();
    res.json({ freed, count: freed.length });
  } catch (error) {
    metrics.errors++;
    logger.error('cleanup_failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: VERSION, uptime_seconds: Math.floor(process.uptime()), active_ports: stmts.countAll.get().count, pid: process.pid });
});

// =============================================================================
// LIFECYCLE
// =============================================================================

setInterval(() => cleanupStale(), config.cleanup.interval_ms);

function shutdown(signal) {
  logger.info('shutdown_initiated', { signal });
  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen(PORT, config.service.host, () => {
  logger.info('server_started', { port: PORT, host: config.service.host, db_path: DB_PATH, port_range: `${PORT_RANGE_START}-${PORT_RANGE_END}` });
  console.log(`
  Port Daddy v${VERSION}
  ────────────────────────────────────
  Service:    http://${config.service.host}:${PORT}
  Dashboard:  http://${config.service.host}:${PORT}/
  Database:   ${DB_PATH}
  Port range: ${PORT_RANGE_START}-${PORT_RANGE_END}
  ────────────────────────────────────
  Ready to assign ports!
  `);
});
