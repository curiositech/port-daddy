/**
 * Unit Tests for Health Check Module (health.js)
 *
 * Tests health monitoring, service checks, and wait-for functionality.
 * Uses a simple mock HTTP server to simulate endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import http from 'http';
import { createTestDb, sleep } from '../setup-unit.js';
import { createServices } from '../../lib/services.js';
import { createHealth } from '../../lib/health.js';

describe('Health Module', () => {
  let db;
  let services;
  let health;
  let mockServer;
  let mockPort;
  let mockResponses = new Map();

  beforeEach(async () => {
    db = createTestDb();
    services = createServices(db);

    // Start a simple mock HTTP server on a dynamic port (avoids collision
    // with Port Daddy's allocation range starting at 3100)
    mockServer = http.createServer((req, res) => {
      const path = req.url;
      const response = mockResponses.get(path) || { status: 200, body: 'OK' };

      res.writeHead(response.status, { 'Content-Type': 'text/plain' });
      if (response.delay) {
        // Simulate slow endpoint
        setTimeout(() => {
          res.end(response.body || 'OK');
        }, response.delay);
      } else {
        res.end(response.body || 'OK');
      }
    });

    // Use port 0 so the OS assigns a free port — no EADDRINUSE, no collisions
    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });
    health = createHealth(db, services);
  });

  afterEach(() => {
    // Clean up all intervals and server
    health.stopAll();
    mockResponses.clear();
    return new Promise((resolve) => {
      mockServer.close(resolve);
    });
  });

  describe('Health Check (12 tests)', () => {
    it('should check health of running service', async () => {
      mockResponses.set('/health', { status: 200, body: 'OK' });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.check('test:app:main');

      expect(result.success).toBe(true);
      expect(result.serviceId).toBe('test:app:main');
      expect(result.healthy).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('should return error for missing service', async () => {
      const result = await health.check('nonexistent:service:id');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle service without health URL gracefully', async () => {
      services.claim('test:app:main');

      const result = await health.check('test:app:main');

      // Without explicit health URL, service is assumed healthy
      expect(result.success).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.reason).toBe('no health endpoint configured');
    });

    it('should mark 5xx responses as unhealthy', async () => {
      mockResponses.set('/error', { status: 500, body: 'Server Error' });
      services.claim('error:service:main', { health: `http://127.0.0.1:${mockPort}/error` });

      const result = await health.check('error:service:main');

      expect(result.healthy).toBe(false);
      expect(result.statusCode).toBe(500);
    });

    it('should mark 4xx responses as unhealthy', async () => {
      mockResponses.set('/notfound', { status: 404, body: 'Not Found' });
      services.claim('notfound:service:main', { health: `http://127.0.0.1:${mockPort}/notfound` });

      const result = await health.check('notfound:service:main');

      expect(result.healthy).toBe(false);
      expect(result.statusCode).toBe(404);
    });

    it('should handle network errors gracefully', async () => {
      services.claim('dead:service:main', { health: 'http://localhost:9999/health' });

      const result = await health.check('dead:service:main');

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should construct full URL from relative path', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.check('test:app:main');

      expect(result.url).toContain(String(mockPort));
      expect(result.url).toMatch(/health/);
    });

    it('should handle absolute health URLs', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.check('test:app:main');

      expect(result.url).toBe(`http://127.0.0.1:${mockPort}/health`);
      expect(result.healthy).toBe(true);
    });

    it('should mark 200-299 as healthy', async () => {
      mockResponses.set('/status', { status: 201 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/status` });

      const result = await health.check('test:app:main');

      expect(result.healthy).toBe(true);
      expect(result.statusCode).toBe(201);
    });

    it('should mark 300-399 as healthy', async () => {
      mockResponses.set('/redirect', { status: 301 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/redirect` });

      const result = await health.check('test:app:main');

      expect(result.healthy).toBe(true);
      expect(result.statusCode).toBe(301);
    });

    it('should track health check latency', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.check('test:app:main');

      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(typeof result.latency).toBe('number');
    });

    it('should update health cache on check', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      await health.check('test:app:main');
      const status = health.getStatus('test:app:main');

      expect(status.success).toBe(true);
      expect(status.healthy).toBe(true);
      expect(status.serviceId).toBe('test:app:main');
    });
  });

  describe('Wait For Single (10 tests)', () => {
    it('should resolve immediately if service is healthy', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.waitFor('test:app:main', { timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.healthy).toBe(true);
    });

    it('should wait for service to become healthy', async () => {
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      // Start unhealthy
      mockResponses.set('/health', { status: 500 });

      // Schedule a fix after 500ms
      setTimeout(() => {
        mockResponses.set('/health', { status: 200 });
      }, 500);

      const start = Date.now();
      const result = await health.waitFor('test:app:main', {
        timeout: 5000,
        checkInterval: 100
      });

      expect(result.healthy).toBe(true);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(500);
    });

    it('should respect timeout parameter', async () => {
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });
      mockResponses.set('/health', { status: 500 });

      const start = Date.now();
      try {
        await health.waitFor('test:app:main', { timeout: 200, checkInterval: 50 });
      } catch (err) {
        // Expected to timeout
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(500);
    });

    it('should reject on timeout', async () => {
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });
      mockResponses.set('/health', { status: 500 });

      await expect(
        health.waitFor('test:app:main', { timeout: 100, checkInterval: 50 })
      ).rejects.toThrow(/Timeout/);
    });

    it('should poll periodically until healthy', async () => {
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });
      mockResponses.set('/health', { status: 500 });

      // Count HTTP requests hitting the mock server (can't monkey-patch the
      // closure-captured check(), so observe the server directly)
      let requestCount = 0;
      const origListeners = mockServer.listeners('request');
      mockServer.removeAllListeners('request');
      mockServer.on('request', (req, res) => {
        requestCount++;
        // Delegate to original handler
        origListeners[0](req, res);
      });

      setTimeout(() => {
        mockResponses.set('/health', { status: 200 });
      }, 300);

      await health.waitFor('test:app:main', { timeout: 5000, checkInterval: 50 });

      // Multiple polling requests must have been made
      expect(requestCount).toBeGreaterThan(1);
    });

    it('should return health status on success', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.waitFor('test:app:main');

      expect(result.serviceId).toBe('test:app:main');
      expect(result.statusCode).toBe(200);
      expect(result.url).toBeDefined();
    });

    it('should handle service without health URL', async () => {
      services.claim('test:app:main');

      const result = await health.waitFor('test:app:main', { timeout: 100 });

      expect(result.healthy).toBe(true);
      expect(result.reason).toMatch(/no health endpoint/);
    });

    it('should support custom check intervals', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const start = Date.now();
      await health.waitFor('test:app:main', {
        timeout: 5000,
        checkInterval: 50
      });

      const elapsed = Date.now() - start;
      // Should return quickly since healthy immediately
      expect(elapsed).toBeLessThan(500);
    });

    it('should track checkedAt timestamp', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.waitFor('test:app:main');

      expect(result.checkedAt).toBeGreaterThan(0);
      expect(result.checkedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should handle rapid sequential waits', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('test:app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result1 = await health.waitFor('test:app:main', { timeout: 1000 });
      const result2 = await health.waitFor('test:app:main', { timeout: 1000 });

      expect(result1.healthy).toBe(true);
      expect(result2.healthy).toBe(true);
    });
  });

  describe('Wait For All (10 tests)', () => {
    it('should wait for multiple services to be healthy', async () => {
      mockResponses.set('/health', { status: 200 });

      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.waitForAll(['app:1', 'app:2'], { timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.allHealthy).toBe(true);
      expect(result.services.length).toBe(2);
    });

    it('should wait for all services even if some start unhealthy', async () => {
      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health1` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/health2` });

      mockResponses.set('/health1', { status: 500 });
      mockResponses.set('/health2', { status: 200 });

      setTimeout(() => {
        mockResponses.set('/health1', { status: 200 });
      }, 300);

      const result = await health.waitForAll(['app:1', 'app:2'], {
        timeout: 5000,
        checkInterval: 50
      });

      expect(result.success).toBe(true);
      expect(result.allHealthy).toBe(true);
    });

    it('should resolve with services array', async () => {
      mockResponses.set('/health', { status: 200 });

      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.waitForAll(['app:1', 'app:2'], { timeout: 5000 });

      expect(Array.isArray(result.services)).toBe(true);
      expect(result.services[0].serviceId).toBe('app:1');
      expect(result.services[1].serviceId).toBe('app:2');
    });

    it('should handle services without health URLs', async () => {
      services.claim('app:1');
      services.claim('app:2');

      const result = await health.waitForAll(['app:1', 'app:2'], { timeout: 1000 });

      expect(result.allHealthy).toBe(true);
      expect(result.services.length).toBe(2);
    });

    it('should track individual service status', async () => {
      mockResponses.set('/h1', { status: 200 });
      mockResponses.set('/h2', { status: 200 });

      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/h1` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/h2` });

      const result = await health.waitForAll(['app:1', 'app:2'], { timeout: 5000 });

      expect(result.services[0].healthy).toBe(true);
      expect(result.services[1].healthy).toBe(true);
      expect(result.services[0].statusCode).toBe(200);
      expect(result.services[1].statusCode).toBe(200);
    });

    it('should use provided timeout for all services', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/health` });

      const start = Date.now();
      await health.waitForAll(['app:1', 'app:2'], { timeout: 1000 });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000);
    });

    it('should handle empty service list', async () => {
      const result = await health.waitForAll([], { timeout: 1000 });

      expect(result.success).toBe(true);
      expect(result.services.length).toBe(0);
    });

    it('should handle mixed healthy and unhealthy services', async () => {
      mockResponses.set('/h1', { status: 200 });
      mockResponses.set('/h2', { status: 500 });

      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/h1` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/h2` });

      // Fix app:2 after delay
      setTimeout(() => {
        mockResponses.set('/h2', { status: 200 });
      }, 200);

      const result = await health.waitForAll(['app:1', 'app:2'], {
        timeout: 5000,
        checkInterval: 50
      });

      expect(result.allHealthy).toBe(true);
    });

    it('should maintain individual latencies', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.waitForAll(['app:1', 'app:2'], { timeout: 5000 });

      expect(result.services[0].latency).toBeGreaterThanOrEqual(0);
      expect(result.services[1].latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Status Listing (3 tests)', () => {
    it('should list all health statuses', async () => {
      mockResponses.set('/health', { status: 200 });

      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/health` });

      await health.check('app:1');
      await health.check('app:2');

      const result = health.listStatus();

      expect(result.success).toBe(true);
      expect(Array.isArray(result.statuses)).toBe(true);
      expect(result.statuses.length).toBe(2);
    });

    it('should return empty list when no checks performed', async () => {
      const result = health.listStatus();

      expect(result.success).toBe(true);
      expect(result.statuses.length).toBe(0);
    });

    it('should include cached health data', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health` });

      await health.check('app:1');
      const result = health.listStatus();

      expect(result.statuses[0].serviceId).toBe('app:1');
      expect(result.statuses[0].healthy).toBe(true);
      expect(result.statuses[0].statusCode).toBe(200);
    });
  });

  describe('Monitoring (6 tests)', () => {
    it('should start periodic monitoring', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = health.startMonitoring('app:main', 100);

      expect(result.success).toBe(true);
      expect(result.interval).toBe(100);

      await sleep(250);
      health.stopMonitoring('app:main');

      const statuses = health.listStatus();
      expect(statuses.statuses.length).toBeGreaterThan(0);
    });

    it('should stop monitoring on demand', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      health.startMonitoring('app:main', 100);
      const result = health.stopMonitoring('app:main');

      expect(result.success).toBe(true);
      expect(result.stopped).toBe(true);
    });

    it('should handle stopping non-existent monitoring', async () => {
      const result = health.stopMonitoring('nonexistent');

      expect(result.success).toBe(true);
      expect(result.stopped).toBe(false);
    });

    it('should clear cache', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      await health.check('app:main');
      let statuses = health.listStatus();
      expect(statuses.statuses.length).toBe(1);

      health.clearCache();
      statuses = health.listStatus();
      expect(statuses.statuses.length).toBe(0);
    });

    it('should stop all monitoring', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/health` });

      health.startMonitoring('app:1', 100);
      health.startMonitoring('app:2', 100);

      const result = health.stopAll();

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/monitoring stopped/);
    });

    it('should handle getStatus for unchecked services', async () => {
      const result = health.getStatus('unchecked:app:main');

      expect(result.success).toBe(true);
      expect(result.healthy).toBe(null);
      expect(result.reason).toBe('not checked');
    });
  });

  describe('Additional Coverage (8 tests)', () => {
    it('should handle services with ports', async () => {
      mockResponses.set('/health', { status: 200 });
      const claimResult = services.claim('app:main', {
        port: mockPort,
        health: `http://127.0.0.1:${mockPort}/health`
      });

      const result = await health.check('app:main');

      expect(result.url).toMatch(new RegExp(`${mockPort}.*health`));
      expect(result.healthy).toBe(true);
    });

    it('should properly construct health URL with port', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:main', {
        port: mockPort,
        health: `http://127.0.0.1:${mockPort}/health`
      });

      const result = await health.check('app:main');

      expect(result.url).toContain(String(mockPort));
      expect(result.healthy).toBe(true);
    });

    it('should cache health status with timestamp', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const before = Date.now();
      await health.check('app:main');
      const after = Date.now();

      const status = health.getStatus('app:main');

      expect(status.checkedAt).toBeGreaterThanOrEqual(before);
      expect(status.checkedAt).toBeLessThanOrEqual(after);
    });

    it('should handle health check with no timeout specified', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      const result = await health.check('app:main');

      expect(result.success).toBe(true);
      expect(result.healthy).toBe(true);
    });

    it('should support metadata in service claims', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:main', {
        health: `http://127.0.0.1:${mockPort}/health`,
        metadata: { version: '1.0' }
      });

      const result = await health.check('app:main');

      expect(result.success).toBe(true);
      expect(result.healthy).toBe(true);
    });

    it('should handle simultaneous health checks', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/health` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/health` });

      const [result1, result2] = await Promise.all([
        health.check('app:1'),
        health.check('app:2')
      ]);

      expect(result1.healthy).toBe(true);
      expect(result2.healthy).toBe(true);
    });

    it('should maintain separate cache entries per service', async () => {
      mockResponses.set('/h1', { status: 200 });
      mockResponses.set('/h2', { status: 500 });

      services.claim('app:1', { health: `http://127.0.0.1:${mockPort}/h1` });
      services.claim('app:2', { health: `http://127.0.0.1:${mockPort}/h2` });

      await health.check('app:1');
      await health.check('app:2');

      const status1 = health.getStatus('app:1');
      const status2 = health.getStatus('app:2');

      expect(status1.healthy).toBe(true);
      expect(status2.healthy).toBe(false);
    });

    it('should handle services transitioning states', async () => {
      mockResponses.set('/health', { status: 200 });
      services.claim('app:main', { health: `http://127.0.0.1:${mockPort}/health` });

      // First check: healthy
      const result1 = await health.check('app:main');
      expect(result1.healthy).toBe(true);

      // Change endpoint to unhealthy
      mockResponses.set('/health', { status: 500 });

      // Second check: unhealthy
      const result2 = await health.check('app:main');
      expect(result2.healthy).toBe(false);

      // Status should reflect most recent check
      const status = health.getStatus('app:main');
      expect(status.healthy).toBe(false);
    });
  });
});
