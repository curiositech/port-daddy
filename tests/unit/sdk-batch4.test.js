/**
 * Unit tests for SDK Batch 4 — waitForService, lockWithRetry, withLock auto-extend,
 * subscribe with reconnect, and machine-readable error codes.
 *
 * Tests the SDK client against a local mock HTTP server plus route-level error codes.
 *
 * Route tests share a SINGLE Express server (port 0) to avoid ephemeral port
 * exhaustion (EADDRNOTAVAIL). Each describe swaps fresh routes + db via a
 * delegation middleware — one server for all route tests instead of 30+.
 */

import http from 'node:http';
import request from 'supertest';
import express from 'express';
import { PortDaddy, PortDaddyError } from '../../lib/client.js';
import { createTestDb, createMockLogger } from '../setup-unit.js';
import { createServicesRoutes } from '../../routes/services.js';
import { createLocksRoutes } from '../../routes/locks.js';
import { createSessionsRoutes } from '../../routes/sessions.js';
import { createServices } from '../../lib/services.js';
import { createLocks } from '../../lib/locks.js';
import { createSessions } from '../../lib/sessions.js';

// ============================================================================
// Mock HTTP server for SDK tests (TCP — SDK client needs a URL)
// ============================================================================

let mockServer;
let mockPort;
let receivedRequests = [];
let queuedResponses = [];
let savedUrl;

function queueResponse(body, status = 200) {
  queuedResponses.push({ body, status });
}

function resetMock() {
  receivedRequests = [];
  queuedResponses = [];
}

function createClient(opts = {}) {
  return new PortDaddy({
    url: `http://localhost:${mockPort}`,
    socketPath: '/tmp/nonexistent-port-daddy-batch4-test.sock',
    ...opts,
  });
}

// ============================================================================
// Shared Express server for route tests (single port 0, reused across all)
// ============================================================================

let routeServer;
let currentRouter;

beforeAll(async () => {
  // --- Mock TCP server for SDK client tests ---
  mockServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString();
      let parsedBody = null;
      try { parsedBody = JSON.parse(bodyText); } catch { /* not JSON */ }

      receivedRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody,
        bodyText
      });

      const resp = queuedResponses.shift();
      if (!resp) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no queued response' }));
        return;
      }

      res.writeHead(resp.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp.body));
    });
  });

  await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });

  savedUrl = process.env.PORT_DADDY_URL;
  process.env.PORT_DADDY_URL = `http://localhost:${mockPort}`;

  // --- Shared route server (single port 0, delegation middleware) ---
  const routeApp = express();
  routeApp.use(express.json());
  routeApp.use((req, res, next) => {
    if (currentRouter) return currentRouter(req, res, next);
    res.status(503).json({ error: 'no router mounted' });
  });

  await new Promise((resolve) => {
    routeServer = routeApp.listen(0, '127.0.0.1', resolve);
  });
});

afterAll(async () => {
  if (savedUrl === undefined) delete process.env.PORT_DADDY_URL;
  else process.env.PORT_DADDY_URL = savedUrl;
  await new Promise(resolve => mockServer.close(resolve));
  await new Promise(resolve => routeServer.close(resolve));
});

beforeEach(() => {
  resetMock();
});

// =============================================================================
// SDK: waitForService
// =============================================================================

describe('SDK: waitForService', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'test-agent', pid: 1234 });
  });

  test('sends GET to /wait/:id with timeout', async () => {
    queueResponse({
      success: true,
      services: [{ id: 'myapp:api', port: 3142 }],
      resolved: 1,
      requested: 1,
      timedOut: false
    });

    const result = await pd.waitForService('myapp:api', 5000);

    expect(result.success).toBe(true);
    expect(result.services).toHaveLength(1);
    expect(result.timedOut).toBe(false);
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('GET');
    expect(receivedRequests[0].url).toContain('/wait/myapp%3Aapi');
    expect(receivedRequests[0].url).toContain('timeout=5000');
  });

  test('uses default timeout of 30000', async () => {
    queueResponse({
      success: true,
      services: [{ id: 'myapp:api', port: 3142 }],
      resolved: 1,
      requested: 1,
      timedOut: false
    });

    await pd.waitForService('myapp:api');

    expect(receivedRequests[0].url).toContain('timeout=30000');
  });

  test('throws on timeout response (408)', async () => {
    queueResponse({
      success: false,
      error: 'Timed out waiting for service',
      code: 'TIMEOUT',
      services: [],
      resolved: 0,
      requested: 1,
      timedOut: true
    }, 408);

    await expect(pd.waitForService('myapp:api', 100)).rejects.toThrow();
  });

  test('restores client timeout after call', async () => {
    const pd2 = createClient({ timeout: 3000 });
    queueResponse({
      success: true,
      services: [{ id: 'x:y', port: 3000 }],
      resolved: 1,
      requested: 1,
      timedOut: false
    });

    await pd2.waitForService('x:y', 60000);
    expect(pd2.timeout).toBe(3000);
  });
});

// =============================================================================
// SDK: waitForServices
// =============================================================================

describe('SDK: waitForServices', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'test-agent', pid: 1234 });
  });

  test('sends POST to /wait with ids and timeout', async () => {
    queueResponse({
      success: true,
      services: [
        { id: 'svc1', port: 3100 },
        { id: 'svc2', port: 3101 }
      ],
      resolved: 2,
      requested: 2,
      timedOut: false
    });

    const result = await pd.waitForServices(['svc1', 'svc2'], 10000);

    expect(result.success).toBe(true);
    expect(result.services).toHaveLength(2);
    expect(result.resolved).toBe(2);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/wait');
    expect(receivedRequests[0].body.ids).toEqual(['svc1', 'svc2']);
    expect(receivedRequests[0].body.timeout).toBe(10000);
  });

  test('uses default timeout of 30000', async () => {
    queueResponse({
      success: true,
      services: [],
      resolved: 0,
      requested: 1,
      timedOut: false
    });

    await pd.waitForServices(['svc1']);

    expect(receivedRequests[0].body.timeout).toBe(30000);
  });

  test('handles partial resolution on timeout', async () => {
    queueResponse({
      success: false,
      error: 'Timed out waiting for 1 service(s)',
      code: 'TIMEOUT',
      services: [{ id: 'svc1', port: 3100 }],
      resolved: 1,
      requested: 2,
      timedOut: true
    }, 408);

    await expect(pd.waitForServices(['svc1', 'svc2'], 100)).rejects.toThrow();
  });

  test('restores client timeout after call', async () => {
    const pd2 = createClient({ timeout: 3000 });
    queueResponse({
      success: true,
      services: [],
      resolved: 0,
      requested: 0,
      timedOut: false
    });

    await pd2.waitForServices([], 60000);
    expect(pd2.timeout).toBe(3000);
  });
});

// =============================================================================
// SDK: lockWithRetry
// =============================================================================

describe('SDK: lockWithRetry', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'retry-agent' });
  });

  test('succeeds on first attempt', async () => {
    queueResponse({ success: true, name: 'deploy', owner: 'retry-agent', acquiredAt: Date.now(), expiresAt: Date.now() + 300000, message: 'lock acquired' });

    const result = await pd.lockWithRetry('deploy');

    expect(result.success).toBe(true);
    expect(result.name).toBe('deploy');
    expect(receivedRequests).toHaveLength(1);
  });

  test('retries on 409 and succeeds', async () => {
    // First attempt: lock held
    queueResponse({ error: 'lock held by other-agent', owner: 'other-agent', success: false }, 409);
    // Second attempt: lock available
    queueResponse({ success: true, name: 'deploy', owner: 'retry-agent', acquiredAt: Date.now(), expiresAt: Date.now() + 300000, message: 'lock acquired' });

    const result = await pd.lockWithRetry('deploy', { timeout: 5000, interval: 50 });

    expect(result.success).toBe(true);
    expect(receivedRequests.length).toBeGreaterThanOrEqual(2);
  });

  test('throws after timeout', async () => {
    // All attempts fail with 409
    for (let i = 0; i < 30; i++) {
      queueResponse({ error: 'lock held', success: false }, 409);
    }

    try {
      await pd.lockWithRetry('deploy', { timeout: 200, interval: 50 });
      expect('should not reach').toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(PortDaddyError);
      expect(err.status).toBe(408);
      expect(err.message).toMatch(/Failed to acquire lock/);
    }
  });

  test('throws non-409 errors immediately', async () => {
    queueResponse({ error: 'invalid lock name' }, 400);

    await expect(
      pd.lockWithRetry('!!!bad!!!', { timeout: 5000, interval: 50 })
    ).rejects.toThrow('invalid lock name');

    expect(receivedRequests).toHaveLength(1); // No retries
  });

  test('passes lock options through', async () => {
    queueResponse({ success: true, name: 'my-lock', owner: 'retry-agent', acquiredAt: Date.now(), expiresAt: Date.now() + 60000, message: 'acquired' });

    await pd.lockWithRetry('my-lock', {
      ttl: 60000,
      metadata: { key: 'val' },
      timeout: 5000,
      interval: 100
    });

    expect(receivedRequests[0].body.ttl).toBe(60000);
    expect(receivedRequests[0].body.metadata).toEqual({ key: 'val' });
  });

  test('uses default timeout (10000ms) and interval (500ms)', async () => {
    queueResponse({ success: true, name: 'x', owner: 'retry-agent', acquiredAt: Date.now(), expiresAt: Date.now() + 300000, message: 'ok' });

    const start = Date.now();
    await pd.lockWithRetry('x');
    const elapsed = Date.now() - start;

    // Should resolve quickly on first attempt
    expect(elapsed).toBeLessThan(1000);
  });
});

// =============================================================================
// SDK: withLock with auto-extend
// =============================================================================

describe('SDK: withLock with auto-extend', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'my-agent' });
  });

  test('acquires lock, runs fn, releases', async () => {
    queueResponse({ success: true, owner: 'my-agent' }); // lock
    queueResponse({ success: true, released: true }); // unlock

    let executed = false;
    const result = await pd.withLock('test-lock', async () => {
      executed = true;
      return 42;
    });

    expect(executed).toBe(true);
    expect(result).toBe(42);
    expect(receivedRequests).toHaveLength(2);
    expect(receivedRequests[0].method).toBe('POST'); // acquire
    expect(receivedRequests[1].method).toBe('DELETE'); // release
  });

  test('releases lock even on error', async () => {
    queueResponse({ success: true, owner: 'my-agent' });
    queueResponse({ success: true, released: true });

    await expect(pd.withLock('test-lock', async () => {
      throw new Error('kaboom');
    })).rejects.toThrow('kaboom');

    expect(receivedRequests).toHaveLength(2);
    expect(receivedRequests[1].method).toBe('DELETE');
  });

  test('auto-extends lock during long operations', async () => {
    // Lock acquire
    queueResponse({ success: true, owner: 'my-agent' });
    // Extend responses (queue several)
    for (let i = 0; i < 5; i++) {
      queueResponse({ success: true, name: 'long-lock', expiresAt: Date.now() + 60000 });
    }
    // Lock release
    queueResponse({ success: true, released: true });

    await pd.withLock('long-lock', async () => {
      // Wait long enough for auto-extend to fire
      await new Promise(resolve => setTimeout(resolve, 250));
    }, { ttl: 60000, extendInterval: 100 });

    // Should have: 1 acquire + N extends + 1 release
    const methods = receivedRequests.map(r => r.method);
    expect(methods[0]).toBe('POST'); // acquire
    expect(methods[methods.length - 1]).toBe('DELETE'); // release

    // At least one extend should have happened (PUT to /locks/...)
    const puts = receivedRequests.filter(r => r.method === 'PUT');
    expect(puts.length).toBeGreaterThanOrEqual(1);
  });

  test('clears extend timer on completion', async () => {
    queueResponse({ success: true, owner: 'my-agent' });
    queueResponse({ success: true, released: true });

    await pd.withLock('quick-lock', async () => {
      return 'fast';
    }, { ttl: 60000, extendInterval: 50 });

    const requestCountAfter = receivedRequests.length;

    // Wait to ensure no more extend requests come through
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(receivedRequests.length).toBe(requestCountAfter);
  });

  test('passes lock options through', async () => {
    queueResponse({ success: true, owner: 'my-agent' });
    queueResponse({ success: true, released: true });

    await pd.withLock('opt-lock', async () => 'ok', {
      ttl: 120000,
      metadata: { purpose: 'test' }
    });

    expect(receivedRequests[0].body.ttl).toBe(120000);
    expect(receivedRequests[0].body.metadata).toEqual({ purpose: 'test' });
  });
});

// =============================================================================
// SDK: subscribe with auto-reconnect
// =============================================================================

describe('SDK: subscribe with options', () => {
  test('returns subscription with on/unsubscribe', () => {
    const pd = createClient();
    const sub = pd.subscribe('test-channel', { reconnect: false });

    expect(sub).toHaveProperty('on');
    expect(sub).toHaveProperty('unsubscribe');
    expect(typeof sub.on).toBe('function');
    expect(typeof sub.unsubscribe).toBe('function');

    sub.unsubscribe();
  });

  test('on method is chainable', () => {
    const pd = createClient();
    const sub = pd.subscribe('test', { reconnect: false });

    const result = sub.on('message', () => {}).on('error', () => {}).on('connected', () => {});
    expect(result).toBe(sub);

    sub.unsubscribe();
  });

  test('accepts reconnect options', () => {
    const pd = createClient();
    // Should not throw with options
    const sub = pd.subscribe('test', {
      reconnect: true,
      maxRetries: 5,
      reconnectDelay: 2000
    });

    sub.unsubscribe();
  });

  test('disabling reconnect works', () => {
    const pd = createClient();
    const sub = pd.subscribe('test', { reconnect: false });

    // Should still be a valid subscription
    expect(sub.on).toBeDefined();
    sub.unsubscribe();
  });
});

// =============================================================================
// SDK: expires type fix
// =============================================================================

describe('SDK: expires type accepts string | number', () => {
  let pd;
  beforeEach(() => {
    pd = createClient({ agentId: 'test-agent', pid: 1234 });
  });

  test('claim accepts numeric expires', async () => {
    queueResponse({ success: true, port: 3142, id: 'test:svc', existing: false });

    await pd.claim('test:svc', { expires: 60000 });

    expect(receivedRequests[0].body.expires).toBe(60000);
  });

  test('claim accepts string expires', async () => {
    queueResponse({ success: true, port: 3142, id: 'test:svc', existing: false });

    await pd.claim('test:svc', { expires: '2h' });

    expect(receivedRequests[0].body.expires).toBe('2h');
  });
});

// =============================================================================
// Route Error Codes: Services
// (All route tests below use the shared routeServer via currentRouter delegation)
// =============================================================================

describe('Route error codes: services', () => {
  let services;

  beforeEach(() => {
    const db = createTestDb();
    const logger = createMockLogger();
    services = createServices(db);

    currentRouter = createServicesRoutes({
      logger,
      metrics: { errors: 0, total_assignments: 0, total_releases: 0, validation_failures: 0 },
      services,
      agents: { canClaimService: () => ({ allowed: true }) },
      activityLog: { logService: { claim: () => {}, release: () => {} } },
      webhooks: { trigger: () => {} },
      config: { ports: { range_start: 3100, range_end: 9999, reserved: [] } }
    });
  });

  test('POST /claim returns IDENTITY_INVALID for bad id', async () => {
    const res = await request(routeServer)
      .post('/claim')
      .send({ id: '!!!bad!!!' })
      .expect(400);

    expect(res.body.code).toBe('IDENTITY_INVALID');
    expect(res.body.error).toBeDefined();
  });

  test('GET /services/:id returns SERVICE_NOT_FOUND', async () => {
    const res = await request(routeServer)
      .get('/services/nonexistent:svc')
      .expect(404);

    expect(res.body.code).toBe('SERVICE_NOT_FOUND');
  });

  test('GET /services/:id returns IDENTITY_INVALID for bad id', async () => {
    const res = await request(routeServer)
      .get('/services/!!!bad!!!')
      .expect(400);

    expect(res.body.code).toBe('IDENTITY_INVALID');
  });

  test('DELETE /release returns IDENTITY_INVALID for bad id', async () => {
    const res = await request(routeServer)
      .delete('/release')
      .send({ id: '!!!bad!!!' })
      .expect(400);

    expect(res.body.code).toBe('IDENTITY_INVALID');
  });

  test('DELETE /release returns VALIDATION_ERROR when no id', async () => {
    const res = await request(routeServer)
      .delete('/release')
      .send({})
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('DELETE /release returns success with released=0 for unknown service', async () => {
    const res = await request(routeServer)
      .delete('/release')
      .send({ id: 'nonexistent:svc' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.released).toBe(0);
  });
});

// =============================================================================
// Route Error Codes: Wait routes
// =============================================================================

describe('Route: wait routes', () => {
  let services;

  beforeEach(() => {
    const db = createTestDb();
    const logger = createMockLogger();
    services = createServices(db);

    currentRouter = createServicesRoutes({
      logger,
      metrics: { errors: 0, total_assignments: 0, total_releases: 0, validation_failures: 0 },
      services,
      agents: { canClaimService: () => ({ allowed: true }) },
      activityLog: { logService: { claim: () => {}, release: () => {} } },
      webhooks: { trigger: () => {} },
      config: { ports: { range_start: 3100, range_end: 9999, reserved: [] } }
    });
  });

  test('GET /wait/:id returns service immediately if exists', async () => {
    services.claim('myapp:api', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const res = await request(routeServer)
      .get('/wait/myapp:api?timeout=1000')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.services).toHaveLength(1);
    expect(res.body.services[0].id).toBe('myapp:api');
    expect(res.body.resolved).toBe(1);
    expect(res.body.timedOut).toBe(false);
  });

  test('GET /wait/:id times out for nonexistent service', async () => {
    const res = await request(routeServer)
      .get('/wait/nonexistent:svc?timeout=300')
      .expect(408);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('TIMEOUT');
    expect(res.body.timedOut).toBe(true);
    expect(res.body.resolved).toBe(0);
  });

  test('GET /wait/:id validates identity', async () => {
    const res = await request(routeServer)
      .get('/wait/!!!bad!!!?timeout=100')
      .expect(400);

    expect(res.body.code).toBe('IDENTITY_INVALID');
  });

  test('POST /wait returns all services immediately if they exist', async () => {
    services.claim('svc-a:api', { range: [3100, 9999], pid: process.pid, systemPorts: new Set() });
    services.claim('svc-b:api', { range: [3100, 9999], pid: process.pid, systemPorts: new Set() });

    const res = await request(routeServer)
      .post('/wait')
      .send({ ids: ['svc-a:api', 'svc-b:api'], timeout: 1000 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.services).toHaveLength(2);
    expect(res.body.resolved).toBe(2);
    expect(res.body.timedOut).toBe(false);
  });

  test('POST /wait times out if some services missing', async () => {
    services.claim('svc-a:api', { range: [3100, 9999], pid: process.pid, systemPorts: new Set() });

    const res = await request(routeServer)
      .post('/wait')
      .send({ ids: ['svc-a:api', 'svc-missing:api'], timeout: 300 })
      .expect(408);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('TIMEOUT');
    expect(res.body.resolved).toBe(1);
    expect(res.body.requested).toBe(2);
  });

  test('POST /wait validates empty ids', async () => {
    const res = await request(routeServer)
      .post('/wait')
      .send({ ids: [], timeout: 100 })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /wait validates missing ids', async () => {
    const res = await request(routeServer)
      .post('/wait')
      .send({ timeout: 100 })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /wait validates individual ids', async () => {
    const res = await request(routeServer)
      .post('/wait')
      .send({ ids: ['good:svc', '!!!bad!!!'], timeout: 100 })
      .expect(400);

    expect(res.body.code).toBe('IDENTITY_INVALID');
  });
});

// =============================================================================
// Route Error Codes: Locks
// =============================================================================

describe('Route error codes: locks', () => {
  beforeEach(() => {
    const db = createTestDb();
    const logger = createMockLogger();
    const locks = createLocks(db);

    currentRouter = createLocksRoutes({
      logger,
      metrics: { errors: 0 },
      locks,
      agents: { canAcquireLock: () => ({ allowed: true }) },
      activityLog: { logLock: { acquire: () => {}, release: () => {} } },
      webhooks: { trigger: () => {} }
    });
  });

  test('POST /locks/:name returns LOCK_HELD on conflict', async () => {
    await request(routeServer)
      .post('/locks/deploy')
      .send({ owner: 'agent-1', ttl: 60000 })
      .expect(200);

    const res = await request(routeServer)
      .post('/locks/deploy')
      .send({ owner: 'agent-2', ttl: 60000 })
      .expect(409);

    expect(res.body.code).toBe('LOCK_HELD');
  });

  test('DELETE /locks/:name returns LOCK_NOT_FOUND for wrong owner', async () => {
    await request(routeServer)
      .post('/locks/deploy')
      .send({ owner: 'agent-1', ttl: 60000 })
      .expect(200);

    const res = await request(routeServer)
      .delete('/locks/deploy')
      .send({ owner: 'agent-wrong' })
      .expect(403);

    expect(res.body.code).toBe('LOCK_NOT_FOUND');
  });

  test('PUT /locks/:name returns LOCK_NOT_FOUND for non-existent lock', async () => {
    const res = await request(routeServer)
      .put('/locks/nonexistent')
      .send({ owner: 'agent-1', ttl: 60000 })
      .expect(400);

    expect(res.body.code).toBe('LOCK_NOT_FOUND');
  });
});

// =============================================================================
// Route Error Codes: Sessions
// =============================================================================

describe('Route error codes: sessions', () => {
  let sessionsMod;

  beforeEach(() => {
    const db = createTestDb();
    const logger = createMockLogger();
    sessionsMod = createSessions(db);

    currentRouter = createSessionsRoutes({
      sessions: sessionsMod,
      metrics: { errors: 0 },
      logger,
      activityLog: { log: () => {} }
    });
  });

  test('POST /sessions returns VALIDATION_ERROR for missing purpose', async () => {
    const res = await request(routeServer)
      .post('/sessions')
      .send({})
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('purpose');
  });

  test('GET /sessions/:id returns SESSION_NOT_FOUND', async () => {
    const res = await request(routeServer)
      .get('/sessions/session-nonexistent')
      .expect(404);

    expect(res.body.code).toBe('SESSION_NOT_FOUND');
  });

  test('PUT /sessions/:id returns SESSION_NOT_FOUND', async () => {
    const res = await request(routeServer)
      .put('/sessions/session-nonexistent')
      .send({ status: 'completed' })
      .expect(404);

    expect(res.body.code).toBe('SESSION_NOT_FOUND');
  });

  test('DELETE /sessions/:id returns SESSION_NOT_FOUND', async () => {
    const res = await request(routeServer)
      .delete('/sessions/session-nonexistent')
      .expect(404);

    expect(res.body.code).toBe('SESSION_NOT_FOUND');
  });

  test('POST /sessions/:id/notes returns VALIDATION_ERROR for missing content', async () => {
    // First create a session
    const session = await request(routeServer)
      .post('/sessions')
      .send({ purpose: 'test' })
      .expect(200);

    const res = await request(routeServer)
      .post(`/sessions/${session.body.id}/notes`)
      .send({})
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /sessions/:id/notes returns SESSION_NOT_FOUND for bad session', async () => {
    const res = await request(routeServer)
      .post('/sessions/session-nonexistent/notes')
      .send({ content: 'hello' })
      .expect(404);

    expect(res.body.code).toBe('SESSION_NOT_FOUND');
  });

  test('POST /sessions/:id/files returns VALIDATION_ERROR for empty files', async () => {
    const session = await request(routeServer)
      .post('/sessions')
      .send({ purpose: 'test' })
      .expect(200);

    const res = await request(routeServer)
      .post(`/sessions/${session.body.id}/files`)
      .send({ files: [] })
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /notes returns VALIDATION_ERROR for empty content', async () => {
    const res = await request(routeServer)
      .post('/notes')
      .send({})
      .expect(400);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /sessions with conflicting files returns FILE_CONFLICT', async () => {
    // Create a session and claim files
    await request(routeServer)
      .post('/sessions')
      .send({ purpose: 'session-1', files: ['file-a.ts'] })
      .expect(200);

    // Try to create another session with the same files
    const res = await request(routeServer)
      .post('/sessions')
      .send({ purpose: 'session-2', files: ['file-a.ts'] })
      .expect(409);

    expect(res.body.code).toBe('FILE_CONFLICT');
  });
});

// =============================================================================
// Concurrent wait scenarios
// =============================================================================

describe('Concurrent wait scenarios', () => {
  let services;

  beforeEach(() => {
    const db = createTestDb();
    const logger = createMockLogger();
    services = createServices(db);

    currentRouter = createServicesRoutes({
      logger,
      metrics: { errors: 0, total_assignments: 0, total_releases: 0, validation_failures: 0 },
      services,
      agents: { canClaimService: () => ({ allowed: true }) },
      activityLog: { logService: { claim: () => {}, release: () => {} } },
      webhooks: { trigger: () => {} },
      config: { ports: { range_start: 3100, range_end: 9999, reserved: [] } }
    });
  });

  test('service appearing mid-wait resolves successfully', async () => {
    const waitPromise = request(routeServer)
      .get('/wait/late:svc?timeout=5000');

    await new Promise(resolve => setTimeout(resolve, 300));
    services.claim('late:svc', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const res = await waitPromise;

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.services[0].id).toBe('late:svc');
  });

  test('multiple concurrent waiters for same service all resolve', async () => {
    const wait1 = request(routeServer).get('/wait/shared:svc?timeout=5000');
    const wait2 = request(routeServer).get('/wait/shared:svc?timeout=5000');

    await new Promise(resolve => setTimeout(resolve, 300));
    services.claim('shared:svc', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const [res1, res2] = await Promise.all([wait1, wait2]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.services[0].id).toBe('shared:svc');
    expect(res2.body.services[0].id).toBe('shared:svc');
  });

  test('POST /wait resolves when last service appears', async () => {
    services.claim('first:svc', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const waitPromise = request(routeServer)
      .post('/wait')
      .send({ ids: ['first:svc', 'second:svc'], timeout: 5000 });

    await new Promise(resolve => setTimeout(resolve, 300));
    services.claim('second:svc', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const res = await waitPromise;

    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(2);
    expect(res.body.timedOut).toBe(false);
  });
});
