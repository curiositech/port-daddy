import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../port-registry-security-test.db');

// Validation constants (must match server.js)
const PROJECT_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;
const PROJECT_NAME_MAX_LENGTH = 255;
const PID_MIN = 1;
const PID_MAX = 99999;
const PORT_MIN = 1024;
const PORT_MAX = 65535;
const RESERVED_PORTS = [8080, 8000, 9876];

// Validation functions (must match server.js)
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

function validatePid(pid) {
  if (pid === undefined || pid === null) {
    return { valid: true, pid: null };
  }
  const parsed = parseInt(pid, 10);
  if (isNaN(parsed) || parsed < PID_MIN || parsed > PID_MAX) {
    return { valid: false, error: `PID must be a number between ${PID_MIN} and ${PID_MAX}` };
  }
  return { valid: true, pid: parsed };
}

function validatePort(port) {
  if (port === undefined || port === null) {
    return { valid: true, port: null };
  }
  const parsed = parseInt(port, 10);
  if (isNaN(parsed) || parsed < PORT_MIN || parsed > PORT_MAX) {
    return { valid: false, error: `Port must be a number between ${PORT_MIN} and ${PORT_MAX}` };
  }
  if (RESERVED_PORTS.includes(parsed)) {
    return { valid: false, error: `Port ${parsed} is reserved` };
  }
  return { valid: true, port: parsed };
}

// Safe process checking using spawnSync with array args (no shell injection risk)
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

// Create a security-hardened test server
function createSecureTestServer() {
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

  // Prepared statements
  const stmts = {
    getByProject: db.prepare('SELECT * FROM port_assignments WHERE project = ?'),
    getByPort: db.prepare('SELECT * FROM port_assignments WHERE port = ?'),
    insert: db.prepare('INSERT INTO port_assignments (port, project, pid, started, last_seen) VALUES (?, ?, ?, ?, ?)'),
    updateLastSeen: db.prepare('UPDATE port_assignments SET last_seen = ? WHERE port = ?'),
    deleteByPort: db.prepare('DELETE FROM port_assignments WHERE port = ?'),
    deleteByProject: db.prepare('DELETE FROM port_assignments WHERE project = ?'),
    getAllPorts: db.prepare('SELECT port FROM port_assignments'),
    count: db.prepare('SELECT COUNT(*) as count FROM port_assignments'),
  };

  const app = express();

  // CORS restricted to localhost only
  app.use(cors({
    origin: /^https?:\/\/localhost(:\d+)?$/,
    credentials: true
  }));

  app.use(express.json({ limit: '1kb' }));

  // Rate limiting keyed by project/PID
  const limiter = rateLimit({
    windowMs: 1000, // 1 second for testing
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      if (req.body && req.body.project && typeof req.body.project === 'string') {
        return `project:${req.body.project.substring(0, 50)}`;
      }
      return `pid:${req.headers['x-pid'] || 'unknown'}`;
    },
    skip: (req) => req.path === '/health' || req.path === '/version',
    message: { error: 'Too many requests, please try again later' }
  });

  app.use(limiter);

  function findAvailablePort() {
    const used = stmts.getAllPorts.all().map(r => r.port);
    const usedSet = new Set([...used, ...RESERVED_PORTS]);

    for (let port = 3100; port <= 9999; port++) {
      if (!usedSet.has(port)) {
        return port;
      }
    }
    throw new Error('No available ports');
  }

  app.post('/ports/request', (req, res) => {
    try {
      const { project, preferred } = req.body;

      // Validate project name
      const projectValidation = validateProjectName(project);
      if (!projectValidation.valid) {
        return res.status(400).json({ error: projectValidation.error });
      }

      // Validate preferred port if provided
      if (preferred !== undefined) {
        const portValidation = validatePort(preferred);
        if (!portValidation.valid) {
          return res.status(400).json({ error: portValidation.error });
        }
      }

      // Validate PID header
      const pidHeader = req.headers['x-pid'];
      const pidValidation = validatePid(pidHeader);
      if (!pidValidation.valid) {
        return res.status(400).json({ error: pidValidation.error });
      }
      const requestingPid = pidValidation.pid || process.pid;

      const now = Date.now();
      const existing = stmts.getByProject.get(project);

      if (existing) {
        if (isProcessAlive(existing.pid)) {
          stmts.updateLastSeen.run(now, existing.port);
          return res.json({
            port: existing.port,
            message: 'reusing existing port',
            existing: true
          });
        } else {
          stmts.deleteByPort.run(existing.port);
        }
      }

      if (preferred && !RESERVED_PORTS.includes(preferred)) {
        const conflict = stmts.getByPort.get(preferred);
        if (!conflict || !isProcessAlive(conflict.pid)) {
          if (conflict) {
            stmts.deleteByPort.run(preferred);
          }
          stmts.insert.run(preferred, project, requestingPid, now, now);
          return res.json({ port: preferred, message: 'assigned preferred port' });
        }
      }

      const port = findAvailablePort();
      stmts.insert.run(port, project, requestingPid, now, now);

      res.json({ port, message: 'assigned new port' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/ports/release', (req, res) => {
    try {
      const { port, project } = req.body;

      if (port !== undefined) {
        const portValidation = validatePort(port);
        if (!portValidation.valid) {
          return res.status(400).json({ error: portValidation.error });
        }
        stmts.deleteByPort.run(port);
        res.json({ success: true, message: `released port ${port}` });
      } else if (project !== undefined) {
        const projectValidation = validateProjectName(project);
        if (!projectValidation.valid) {
          return res.status(400).json({ error: projectValidation.error });
        }
        const result = stmts.deleteByProject.run(project);
        res.json({ success: true, message: `released ${result.changes} port(s) for project ${project}` });
      } else {
        res.status(400).json({ error: 'port or project required' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/health', (req, res) => {
    const portCount = stmts.count.get().count;
    res.json({
      status: 'ok',
      uptime_seconds: Math.floor(process.uptime()),
      active_ports: portCount,
      pid: process.pid
    });
  });

  app.clearDatabase = () => {
    db.prepare('DELETE FROM port_assignments').run();
  };

  app.closeDatabase = () => {
    db.close();
  };

  return app;
}

describe('Security Validation', () => {
  let app;

  beforeEach(() => {
    app = createSecureTestServer();
    app.clearDatabase();
  });

  afterEach(() => {
    app.closeDatabase();
  });

  describe('Project Name Validation', () => {
    it('should reject non-string project names (null)', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: null });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('non-empty string');
    });

    it('should reject non-string project names (number)', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 12345 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('non-empty string');
    });

    it('should reject non-string project names (array)', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: ['my-app'] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('non-empty string');
    });

    it('should reject empty project names', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('non-empty string');
    });

    it('should reject project names that are too long', async () => {
      const longName = 'a'.repeat(300);
      const res = await request(app)
        .post('/ports/request')
        .send({ project: longName });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('too long');
    });

    it('should reject project names with spaces', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'my app' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid characters');
    });

    it('should reject project names with SQL injection attempts', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: "'; DROP TABLE port_assignments; --" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid characters');
    });

    it('should reject project names with quotes', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'my"app' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid characters');
    });

    it('should reject project names with special characters', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'my@app!#$%' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid characters');
    });

    it('should accept valid project names with alphanumeric', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'myapp123' });

      expect(res.status).toBe(200);
      expect(res.body.port).toBeDefined();
    });

    it('should accept valid project names with dashes', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'my-awesome-app' });

      expect(res.status).toBe(200);
      expect(res.body.port).toBeDefined();
    });

    it('should accept valid project names with underscores', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'my_app_v2' });

      expect(res.status).toBe(200);
      expect(res.body.port).toBeDefined();
    });

    it('should accept valid project names with dots', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'com.example.myapp' });

      expect(res.status).toBe(200);
      expect(res.body.port).toBeDefined();
    });
  });

  describe('Port Validation', () => {
    it('should reject non-numeric preferred port', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'test-app', preferred: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('number between');
    });

    it('should reject port below minimum (system ports)', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'test-app', preferred: 80 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('number between');
    });

    it('should reject port above maximum', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'test-app', preferred: 70000 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('number between');
    });

    it('should reject reserved port 8080', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'test-app', preferred: 8080 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reserved');
    });

    it('should reject reserved port 9876 (Port Daddy)', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'test-app', preferred: 9876 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reserved');
    });

    it('should accept valid port in range', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'test-app', preferred: 5000 });

      expect(res.status).toBe(200);
      expect(res.body.port).toBe(5000);
    });
  });

  describe('PID Header Validation', () => {
    it('should reject invalid PID in header (non-numeric)', async () => {
      const res = await request(app)
        .post('/ports/request')
        .set('X-PID', 'abc')
        .send({ project: 'test-app' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('PID');
    });

    it('should reject PID below minimum', async () => {
      const res = await request(app)
        .post('/ports/request')
        .set('X-PID', '0')
        .send({ project: 'test-app' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('PID');
    });

    it('should reject PID above maximum', async () => {
      const res = await request(app)
        .post('/ports/request')
        .set('X-PID', '999999')
        .send({ project: 'test-app' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('PID');
    });

    it('should accept valid PID in header', async () => {
      const res = await request(app)
        .post('/ports/request')
        .set('X-PID', '12345')
        .send({ project: 'test-app' });

      expect(res.status).toBe(200);
      expect(res.body.port).toBeDefined();
    });

    it('should work without PID header (uses process.pid)', async () => {
      const res = await request(app)
        .post('/ports/request')
        .send({ project: 'test-app-no-pid' });

      expect(res.status).toBe(200);
      expect(res.body.port).toBeDefined();
    });
  });

  describe('Release Endpoint Validation', () => {
    it('should validate project name on release', async () => {
      const res = await request(app)
        .delete('/ports/release')
        .send({ project: "'; DROP TABLE --" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid characters');
    });

    it('should validate port number on release', async () => {
      const res = await request(app)
        .delete('/ports/release')
        .send({ port: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('number between');
    });

    it('should reject reserved port on release', async () => {
      const res = await request(app)
        .delete('/ports/release')
        .send({ port: 9876 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('reserved');
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit rapid requests from same project', async () => {
      const promises = [];

      // Send 15 rapid requests (limit is 10)
      for (let i = 0; i < 15; i++) {
        promises.push(
          request(app)
            .post('/ports/request')
            .send({ project: 'rate-limit-test' })
        );
      }

      const results = await Promise.all(promises);
      const rateLimited = results.filter(r => r.status === 429);

      // At least some should be rate limited
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it('should not rate limit /health endpoint', async () => {
      const promises = [];

      // Send 15 rapid health checks
      for (let i = 0; i < 15; i++) {
        promises.push(request(app).get('/health'));
      }

      const results = await Promise.all(promises);
      const rateLimited = results.filter(r => r.status === 429);

      // None should be rate limited
      expect(rateLimited.length).toBe(0);
    });
  });

  describe('JSON Payload Limits', () => {
    it('should reject excessively large JSON payloads', async () => {
      const largePayload = {
        project: 'test',
        extraData: 'x'.repeat(10000)
      };

      const res = await request(app)
        .post('/ports/request')
        .send(largePayload);

      expect(res.status).toBe(413);
    });
  });
});

describe('Validation Functions (Unit Tests)', () => {
  describe('validateProjectName', () => {
    it('should reject undefined', () => {
      expect(validateProjectName(undefined).valid).toBe(false);
    });

    it('should reject null', () => {
      expect(validateProjectName(null).valid).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateProjectName('').valid).toBe(false);
    });

    it('should reject long names', () => {
      expect(validateProjectName('a'.repeat(256)).valid).toBe(false);
    });

    it('should accept max length name', () => {
      expect(validateProjectName('a'.repeat(255)).valid).toBe(true);
    });

    it('should reject special characters', () => {
      expect(validateProjectName('test@app').valid).toBe(false);
      expect(validateProjectName('test app').valid).toBe(false);
      expect(validateProjectName('test/app').valid).toBe(false);
    });

    it('should accept valid characters', () => {
      expect(validateProjectName('test-app_v1.0').valid).toBe(true);
    });
  });

  describe('validatePid', () => {
    it('should accept undefined (optional)', () => {
      expect(validatePid(undefined).valid).toBe(true);
    });

    it('should accept null (optional)', () => {
      expect(validatePid(null).valid).toBe(true);
    });

    it('should reject 0', () => {
      expect(validatePid(0).valid).toBe(false);
    });

    it('should accept 1', () => {
      const result = validatePid(1);
      expect(result.valid).toBe(true);
      expect(result.pid).toBe(1);
    });

    it('should accept valid PID', () => {
      const result = validatePid(12345);
      expect(result.valid).toBe(true);
      expect(result.pid).toBe(12345);
    });

    it('should reject above max', () => {
      expect(validatePid(100000).valid).toBe(false);
    });
  });

  describe('validatePort', () => {
    it('should accept undefined (optional)', () => {
      expect(validatePort(undefined).valid).toBe(true);
    });

    it('should reject below min', () => {
      expect(validatePort(80).valid).toBe(false);
    });

    it('should accept min valid port', () => {
      expect(validatePort(1024).valid).toBe(true);
    });

    it('should reject reserved ports', () => {
      expect(validatePort(8080).valid).toBe(false);
      expect(validatePort(8000).valid).toBe(false);
      expect(validatePort(9876).valid).toBe(false);
    });

    it('should accept valid port', () => {
      const result = validatePort(5000);
      expect(result.valid).toBe(true);
      expect(result.port).toBe(5000);
    });
  });
});
