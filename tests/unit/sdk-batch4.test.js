/**
 * Unit tests for SDK Batch 4 — waitForService, lockWithRetry, withLock auto-extend,
 * subscribe with reconnect, and machine-readable error codes.
 *
 * Tests the SDK client against a local mock HTTP server plus route-level error codes.
 *
 * Route tests use Fastify inject() with fresh app instances per describe block.
 */

import http from 'node:http';
import Fastify from 'fastify';
import { jest } from '@jest/globals';
import { PortDaddy, PortDaddyError } from '../../lib/client.js';
import { createTestDb, createMockLogger } from '../setup-unit.js';
import { servicesPlugin } from '../../routes/services.js';
import { locksPlugin } from '../../routes/locks.js';
import { sessionsPlugin } from '../../routes/sessions.js';
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
});

afterAll(async () => {
  if (savedUrl === undefined) delete process.env.PORT_DADDY_URL;
  else process.env.PORT_DADDY_URL = savedUrl;
  await new Promise(resolve => mockServer.close(resolve));
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
// (Route tests use Fastify inject() with fresh app instances per describe)
// =============================================================================

describe('Route error codes: services', () => {
  let app;
  let services;

  beforeEach(async () => {
    const db = createTestDb();
    const logger = createMockLogger();
    services = createServices(db);

    app = Fastify();
    await app.register(servicesPlugin, {
      deps: {
        logger,
        metrics: { errors: 0, total_assignments: 0, total_releases: 0, validation_failures: 0 },
        services,
        agents: { canClaimService: () => ({ allowed: true }) },
        activityLog: { logService: { claim: () => {}, release: () => {} } },
        webhooks: { trigger: () => {} },
        config: { ports: { range_start: 3100, range_end: 9999, reserved: [] } }
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test('POST /claim returns IDENTITY_INVALID for bad id', async () => {
    const res = await app.inject({ method: 'POST', url: '/claim', payload: { id: '!!!bad!!!' } });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IDENTITY_INVALID');
    expect(res.json().error).toBeDefined();
  });

  test('GET /services/:id returns SERVICE_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/services/nonexistent:svc' });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SERVICE_NOT_FOUND');
  });

  test('GET /services/:id returns IDENTITY_INVALID for bad id', async () => {
    const res = await app.inject({ method: 'GET', url: '/services/!!!bad!!!' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IDENTITY_INVALID');
  });

  test('DELETE /release returns IDENTITY_INVALID for bad id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/release', payload: { id: '!!!bad!!!' } });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IDENTITY_INVALID');
  });

  test('DELETE /release returns VALIDATION_ERROR when no id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/release', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('DELETE /release returns success with released=0 for unknown service', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/release', payload: { id: 'nonexistent:svc' } });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().released).toBe(0);
  });
});

// =============================================================================
// Route Error Codes: Wait routes
// =============================================================================

describe('Route: wait routes', () => {
  let app;
  let services;

  beforeEach(async () => {
    const db = createTestDb();
    const logger = createMockLogger();
    services = createServices(db);

    app = Fastify();
    await app.register(servicesPlugin, {
      deps: {
        logger,
        metrics: { errors: 0, total_assignments: 0, total_releases: 0, validation_failures: 0 },
        services,
        agents: { canClaimService: () => ({ allowed: true }) },
        activityLog: { logService: { claim: () => {}, release: () => {} } },
        webhooks: { trigger: () => {} },
        config: { ports: { range_start: 3100, range_end: 9999, reserved: [] } }
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test('GET /wait/:id returns service immediately if exists', async () => {
    services.claim('myapp:api', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const res = await app.inject({ method: 'GET', url: '/wait/myapp:api?timeout=1000' });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().services).toHaveLength(1);
    expect(res.json().services[0].id).toBe('myapp:api');
    expect(res.json().resolved).toBe(1);
    expect(res.json().timedOut).toBe(false);
  });

  test('GET /wait/:id times out for nonexistent service', async () => {
    const res = await app.inject({ method: 'GET', url: '/wait/nonexistent:svc?timeout=300' });

    expect(res.statusCode).toBe(408);
    expect(res.json().success).toBe(false);
    expect(res.json().code).toBe('TIMEOUT');
    expect(res.json().timedOut).toBe(true);
    expect(res.json().resolved).toBe(0);
  });

  test('GET /wait/:id validates identity', async () => {
    const res = await app.inject({ method: 'GET', url: '/wait/!!!bad!!!?timeout=100' });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IDENTITY_INVALID');
  });

  test('POST /wait returns all services immediately if they exist', async () => {
    services.claim('svc-a:api', { range: [3100, 9999], pid: process.pid, systemPorts: new Set() });
    services.claim('svc-b:api', { range: [3100, 9999], pid: process.pid, systemPorts: new Set() });

    const res = await app.inject({ method: 'POST', url: '/wait', payload: { ids: ['svc-a:api', 'svc-b:api'], timeout: 1000 } });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().services).toHaveLength(2);
    expect(res.json().resolved).toBe(2);
    expect(res.json().timedOut).toBe(false);
  });

  test('POST /wait times out if some services missing', async () => {
    services.claim('svc-a:api', { range: [3100, 9999], pid: process.pid, systemPorts: new Set() });

    const res = await app.inject({ method: 'POST', url: '/wait', payload: { ids: ['svc-a:api', 'svc-missing:api'], timeout: 300 } });

    expect(res.statusCode).toBe(408);
    expect(res.json().success).toBe(false);
    expect(res.json().code).toBe('TIMEOUT');
    expect(res.json().resolved).toBe(1);
    expect(res.json().requested).toBe(2);
  });

  test('POST /wait validates empty ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/wait', payload: { ids: [], timeout: 100 } });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('POST /wait validates missing ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/wait', payload: { timeout: 100 } });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('POST /wait validates individual ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/wait', payload: { ids: ['good:svc', '!!!bad!!!'], timeout: 100 } });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('IDENTITY_INVALID');
  });
});

// =============================================================================
// Route Error Codes: Locks
// =============================================================================

describe('Route error codes: locks', () => {
  let app;

  beforeEach(async () => {
    const db = createTestDb();
    const logger = createMockLogger();
    const locks = createLocks(db);

    app = Fastify();
    await app.register(locksPlugin, {
      deps: {
        logger,
        metrics: { errors: 0 },
        locks,
        agents: { canAcquireLock: () => ({ allowed: true }) },
        activityLog: { logLock: { acquire: () => {}, release: () => {} } },
        webhooks: { trigger: () => {} }
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test('POST /locks/:name returns LOCK_HELD on conflict', async () => {
    await app.inject({ method: 'POST', url: '/locks/deploy', payload: { owner: 'agent-1', ttl: 60000 } });

    const res = await app.inject({ method: 'POST', url: '/locks/deploy', payload: { owner: 'agent-2', ttl: 60000 } });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LOCK_HELD');
  });

  test('DELETE /locks/:name returns LOCK_NOT_FOUND for wrong owner', async () => {
    await app.inject({ method: 'POST', url: '/locks/deploy', payload: { owner: 'agent-1', ttl: 60000 } });

    const res = await app.inject({ method: 'DELETE', url: '/locks/deploy', payload: { owner: 'agent-wrong' } });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('LOCK_NOT_FOUND');
  });

  test('PUT /locks/:name returns LOCK_NOT_FOUND for non-existent lock', async () => {
    const res = await app.inject({ method: 'PUT', url: '/locks/nonexistent', payload: { owner: 'agent-1', ttl: 60000 } });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('LOCK_NOT_FOUND');
  });
});

// =============================================================================
// Route Error Codes: Sessions
// =============================================================================

describe('Route error codes: sessions', () => {
  let app;
  let sessionsMod;
  let logger;
  let activityEntries;

  beforeEach(async () => {
    const db = createTestDb();
    logger = createMockLogger();
    activityEntries = [];
    sessionsMod = createSessions(db, undefined, { requireAgentForFileClaims: true });

    app = Fastify();
    await app.register(sessionsPlugin, {
      deps: {
        sessions: sessionsMod,
        metrics: { errors: 0 },
        logger,
        activityLog: { log: (...args) => activityEntries.push(args) }
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test('POST /sessions returns VALIDATION_ERROR for missing purpose', async () => {
    const res = await app.inject({ method: 'POST', url: '/sessions', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(res.json().error).toContain('purpose');
  });

  test('POST /sessions logs the resolved session agent identity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { 'x-agent-id': 'agent-from-header' },
      payload: { purpose: 'header-owned session' },
    });

    expect(res.statusCode).toBe(200);

    const sessionStarted = logger.getLogs().info.find(([event]) => event === 'session_started');
    expect(sessionStarted?.[1]).toEqual(expect.objectContaining({
      agentId: 'agent-from-header',
      purpose: 'header-owned session',
    }));

    const activityStarted = activityEntries.find(([event]) => event === 'session_start');
    expect(activityStarted?.[1].metadata).toEqual(expect.objectContaining({
      agentId: 'agent-from-header',
      purpose: 'header-owned session',
    }));
  });

  test('POST /sessions preserves SESSION_AGENT_REQUIRED for initial file claims', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'test', files: ['file-a.ts'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('SESSION_AGENT_REQUIRED');
  });

  test('GET /sessions/:id returns SESSION_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions/session-nonexistent' });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SESSION_NOT_FOUND');
  });

  test('PUT /sessions/:id returns SESSION_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'PUT', url: '/sessions/session-nonexistent', payload: { status: 'completed' } });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SESSION_NOT_FOUND');
  });

  test('DELETE /sessions/:id returns SESSION_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/sessions/session-nonexistent' });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SESSION_NOT_FOUND');
  });

  test('POST /sessions/:id/notes returns VALIDATION_ERROR for missing content', async () => {
    // First create a session
    const session = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'test' } });
    const sessionId = session.json().id;

    const res = await app.inject({ method: 'POST', url: `/sessions/${sessionId}/notes`, payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  }, 30000);

  test('POST /sessions/:id/notes returns SESSION_NOT_FOUND for bad session', async () => {
    const res = await app.inject({ method: 'POST', url: '/sessions/session-nonexistent/notes', payload: { content: 'hello' } });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('SESSION_NOT_FOUND');
  });

  test('POST /sessions/:id/notes uses the canonical quick-note write path', async () => {
    const session = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'test' } });
    const sessionId = session.json().id;
    const quickNote = jest.spyOn(sessionsMod, 'quickNote');
    const addNote = jest.spyOn(sessionsMod, 'addNote');

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/notes`,
      payload: { content: 'hello from compat route', type: 'progress' },
    });

    expect(res.statusCode).toBe(200);
    expect(quickNote).toHaveBeenCalledWith('hello from compat route', expect.objectContaining({
      sessionId,
      type: 'progress',
    }));
    expect(addNote).not.toHaveBeenCalled();
  });

  test('POST /sessions/:id/files returns VALIDATION_ERROR for empty files', async () => {
    const session = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'test' } });
    const sessionId = session.json().id;

    const res = await app.inject({ method: 'POST', url: `/sessions/${sessionId}/files`, payload: { files: [] } });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('POST /sessions/:id/files returns SESSION_AGENT_REQUIRED for agentless sessions', async () => {
    const session = await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'test' } });
    const sessionId = session.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/files`,
      payload: { files: ['file-a.ts'] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SESSION_AGENT_REQUIRED');
  });

  test('POST /sessions/:id/files requires the owning agent before conflict checks', async () => {
    await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'owner', agentId: 'agent-owner', files: ['file-a.ts'] },
    });
    const session = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'intruder', agentId: 'agent-intruder' },
    });
    const sessionId = session.json().id;

    const noAgent = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/files`,
      payload: { files: ['file-a.ts'] },
    });
    expect(noAgent.statusCode).toBe(409);
    expect(noAgent.json().code).toBe('SESSION_AGENT_REQUIRED');

    const wrongAgent = await app.inject({
      method: 'POST',
      url: `/sessions/${sessionId}/files`,
      payload: { agentId: 'agent-owner', files: ['file-a.ts'] },
    });
    expect(wrongAgent.statusCode).toBe(403);
    expect(wrongAgent.json().code).toBe('SESSION_AGENT_MISMATCH');
  });

  test('DELETE /sessions/:id/files requires the owning agent', async () => {
    const session = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'owned release', agentId: 'agent-owner', files: ['file-a.ts'] },
    });
    const sessionId = session.json().id;

    const wrongAgent = await app.inject({
      method: 'DELETE',
      url: `/sessions/${sessionId}/files`,
      payload: { agentId: 'agent-intruder', files: ['file-a.ts'] },
    });
    expect(wrongAgent.statusCode).toBe(403);
    expect(wrongAgent.json().code).toBe('SESSION_AGENT_MISMATCH');

    const owner = await app.inject({
      method: 'DELETE',
      url: `/sessions/${sessionId}/files`,
      payload: { agentId: 'agent-owner', files: ['file-a.ts'] },
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().released).toEqual(['file-a.ts']);
  });

  test('POST /notes returns VALIDATION_ERROR for empty content', async () => {
    const res = await app.inject({ method: 'POST', url: '/notes', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  test('POST /notes returns AMBIGUOUS_ACTIVE_SESSION when two sessions are active and no sessionId/agentId is given', async () => {
    await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session A' } });
    await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session B' } });

    const res = await app.inject({ method: 'POST', url: '/notes', payload: { content: 'which session am I?' } });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('AMBIGUOUS_ACTIVE_SESSION');
  });

  test('POST /notes resolves the ambiguity when agentId is given (mcp add_note fix regression guard)', async () => {
    const owner = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'Session A', agentId: 'agent-owner' },
    });
    const ownerSessionId = owner.json().id;
    await app.inject({ method: 'POST', url: '/sessions', payload: { purpose: 'Session B' } });

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'scoped by agentId', agentId: 'agent-owner' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe(ownerSessionId);
  });

  test('POST /sessions with conflicting files returns FILE_CONFLICT', async () => {
    // Create a session and claim files
    await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'session-1', agentId: 'agent-1', files: ['file-a.ts'] },
    });

    // Try to create another session with the same files
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'session-2', agentId: 'agent-2', files: ['file-a.ts'] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('FILE_CONFLICT');
  });
});

// =============================================================================
// Concurrent wait scenarios
// =============================================================================

describe('Concurrent wait scenarios', () => {
  let app;
  let services;

  beforeEach(async () => {
    const db = createTestDb();
    const logger = createMockLogger();
    services = createServices(db);

    app = Fastify();
    await app.register(servicesPlugin, {
      deps: {
        logger,
        metrics: { errors: 0, total_assignments: 0, total_releases: 0, validation_failures: 0 },
        services,
        agents: { canClaimService: () => ({ allowed: true }) },
        activityLog: { logService: { claim: () => {}, release: () => {} } },
        webhooks: { trigger: () => {} },
        config: { ports: { range_start: 3100, range_end: 9999, reserved: [] } }
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test('service appearing mid-wait resolves successfully', async () => {
    const waitPromise = app.inject({ method: 'GET', url: '/wait/late:svc?timeout=5000' });

    await new Promise(resolve => setTimeout(resolve, 300));
    services.claim('late:svc', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const res = await waitPromise;

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().services[0].id).toBe('late:svc');
  });

  test('multiple concurrent waiters for same service all resolve', async () => {
    const wait1 = app.inject({ method: 'GET', url: '/wait/shared:svc?timeout=5000' });
    const wait2 = app.inject({ method: 'GET', url: '/wait/shared:svc?timeout=5000' });

    await new Promise(resolve => setTimeout(resolve, 300));
    services.claim('shared:svc', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const [res1, res2] = await Promise.all([wait1, wait2]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.json().services[0].id).toBe('shared:svc');
    expect(res2.json().services[0].id).toBe('shared:svc');
  });

  test('POST /wait resolves when last service appears', async () => {
    services.claim('first:svc', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const waitPromise = app.inject({ method: 'POST', url: '/wait', payload: { ids: ['first:svc', 'second:svc'], timeout: 5000 } });

    await new Promise(resolve => setTimeout(resolve, 300));
    services.claim('second:svc', {
      range: [3100, 9999],
      pid: process.pid,
      systemPorts: new Set()
    });

    const res = await waitPromise;

    expect(res.statusCode).toBe(200);
    expect(res.json().resolved).toBe(2);
    expect(res.json().timedOut).toBe(false);
  });
});
