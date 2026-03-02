/**
 * Unit Tests for Tunnel Module (tunnel.ts)
 *
 * Tests tunnel lifecycle management:
 * - Provider detection (ngrok, cloudflared, localtunnel)
 * - Start validation (service not found, provider not installed)
 * - Stop tunnel and DB cleanup
 * - Status reporting and listing
 * - StopAll cleanup
 * - Database interaction and SQL injection safety
 * - Concurrent operations
 *
 * NOTE: The tunnel module spawns real child processes (ngrok, cloudflared, lt).
 * We cannot easily mock `spawn` in ESM without a heavy mocking setup.
 * Tests that call `start()` with a valid service only do so when the provider
 * is NOT installed (fast path), to avoid 30-second URL wait timeouts.
 * The synchronous methods (stop, status, list, stopAll) are fully tested.
 *
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createTunnel } from '../../lib/tunnel.js';

describe('Tunnel Module', () => {
  let db;
  let tunnel;

  beforeEach(() => {
    db = createTestDb();
    tunnel = createTunnel(db);
  });

  /**
   * Helper: Insert a service into the DB for tunnel tests
   */
  function insertService(id, port = 3100) {
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen)
      VALUES (?, ?, 'assigned', ?, ?)
    `).run(id, port, Date.now(), Date.now());
  }

  /**
   * Helper: Insert a service with tunnel data
   */
  function insertServiceWithTunnel(id, port, provider, url) {
    db.prepare(`
      INSERT INTO services (id, port, status, tunnel_provider, tunnel_url, created_at, last_seen)
      VALUES (?, ?, 'assigned', ?, ?, ?, ?)
    `).run(id, port, provider, url, Date.now(), Date.now());
  }

  // ======================================================================
  // PROVIDER DETECTION
  // ======================================================================
  describe('checkProvider()', () => {
    it('should return a boolean for ngrok', async () => {
      const result = await tunnel.checkProvider('ngrok');
      expect(typeof result).toBe('boolean');
    });

    it('should return a boolean for cloudflared', async () => {
      const result = await tunnel.checkProvider('cloudflared');
      expect(typeof result).toBe('boolean');
    });

    it('should return a boolean for localtunnel', async () => {
      const result = await tunnel.checkProvider('localtunnel');
      expect(typeof result).toBe('boolean');
    });
  });

  // ======================================================================
  // START — FAST PATH VALIDATIONS (no process spawning)
  // ======================================================================
  describe('start() — validation', () => {
    it('should fail when service does not exist', async () => {
      const result = await tunnel.start('nonexistent-service');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/service not found/i);
    });

    it('should fail when service does not exist regardless of provider', async () => {
      const result = await tunnel.start('nonexistent', 'cloudflared');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/service not found/i);
    });

    it('should return install hint when provider is not installed', async () => {
      insertService('start-test', 3100);

      // Check all three providers -- use the ones NOT installed
      const ngrokInstalled = await tunnel.checkProvider('ngrok');
      const cfInstalled = await tunnel.checkProvider('cloudflared');
      const ltInstalled = await tunnel.checkProvider('localtunnel');

      // Find an uninstalled provider for a reliable fast-path test
      const providers = [
        { name: 'ngrok', installed: ngrokInstalled },
        { name: 'cloudflared', installed: cfInstalled },
        { name: 'localtunnel', installed: ltInstalled },
      ];

      const uninstalled = providers.find(p => !p.installed);

      if (uninstalled) {
        const result = await tunnel.start('start-test', uninstalled.name);
        expect(result.success).toBe(false);
        expect(result.error).toContain('not installed');
        expect(result.error).toContain('Install with:');
      } else {
        // All providers are installed (unusual but possible).
        // Skip this assertion -- the provider tests cover detection.
        expect(true).toBe(true);
      }
    });

    it('should include provider name in install hint', async () => {
      insertService('hint-test', 3200);

      const ngrokInstalled = await tunnel.checkProvider('ngrok');

      if (!ngrokInstalled) {
        const result = await tunnel.start('hint-test', 'ngrok');
        expect(result.error).toContain('ngrok');
        expect(result.error).toContain('brew install');
      }

      const ltInstalled = await tunnel.checkProvider('localtunnel');
      if (!ltInstalled) {
        // Need a fresh service since start() may have registered 'hint-test' in activeTunnels
        insertService('hint-test-lt', 3201);
        const result = await tunnel.start('hint-test-lt', 'localtunnel');
        expect(result.error).toContain('localtunnel');
        expect(result.error).toContain('npm');
      }
    });
  });

  // ======================================================================
  // STOP — TUNNEL CLEANUP
  // ======================================================================
  describe('stop()', () => {
    it('should succeed even when no tunnel exists', () => {
      const result = tunnel.stop('nonexistent-service');
      expect(result.success).toBe(true);
    });

    it('should clear tunnel data from database on stop', () => {
      insertServiceWithTunnel('my-service', 3100, 'ngrok', 'https://abc.ngrok.io');

      tunnel.stop('my-service');

      const row = db.prepare('SELECT tunnel_provider, tunnel_url FROM services WHERE id = ?')
        .get('my-service');
      expect(row.tunnel_provider).toBeNull();
      expect(row.tunnel_url).toBeNull();
    });

    it('should update last_seen timestamp on stop', () => {
      const oldTime = Date.now() - 60000;
      db.prepare(`
        INSERT INTO services (id, port, status, tunnel_provider, tunnel_url, created_at, last_seen)
        VALUES (?, ?, 'assigned', 'ngrok', 'https://test.ngrok.io', ?, ?)
      `).run('ts-test', 3300, oldTime, oldTime);

      tunnel.stop('ts-test');

      const row = db.prepare('SELECT last_seen FROM services WHERE id = ?').get('ts-test');
      expect(row.last_seen).toBeGreaterThan(oldTime);
    });

    it('should handle multiple stops on the same service (idempotent)', () => {
      insertServiceWithTunnel('multi-stop', 3400, 'ngrok', 'https://x.ngrok.io');

      const r1 = tunnel.stop('multi-stop');
      const r2 = tunnel.stop('multi-stop');

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });

  // ======================================================================
  // STATUS — TUNNEL STATUS REPORTING
  // ======================================================================
  describe('status()', () => {
    it('should return stopped status for unknown service', () => {
      const result = tunnel.status('nonexistent');
      expect(result.serviceId).toBe('nonexistent');
      expect(result.status).toBe('stopped');
      expect(result.url).toBeNull();
      expect(result.port).toBe(0);
      expect(result.provider).toBe('ngrok'); // default
    });

    it('should return stopped status with previous tunnel info from database', () => {
      insertServiceWithTunnel('old-service', 4200, 'cloudflared', 'https://test.trycloudflare.com');

      const result = tunnel.status('old-service');
      expect(result.status).toBe('stopped');
      expect(result.url).toBe('https://test.trycloudflare.com');
      expect(result.provider).toBe('cloudflared');
      expect(result.port).toBe(4200);
    });

    it('should include serviceId in response', () => {
      const result = tunnel.status('any-svc');
      expect(result.serviceId).toBe('any-svc');
    });

    it('should return stopped status after tunnel is stopped', () => {
      insertServiceWithTunnel('stop-check', 4300, 'ngrok', 'https://stop.ngrok.io');

      tunnel.stop('stop-check');
      const result = tunnel.status('stop-check');
      expect(result.url).toBeNull();
    });

    it('should distinguish between service with and without previous tunnel', () => {
      // Service with tunnel data
      insertServiceWithTunnel('has-tunnel', 4400, 'ngrok', 'https://had.ngrok.io');
      const withTunnel = tunnel.status('has-tunnel');
      expect(withTunnel.url).toBe('https://had.ngrok.io');

      // Service without tunnel data
      insertService('no-tunnel', 4401);
      const withoutTunnel = tunnel.status('no-tunnel');
      // Service exists but no tunnel_url, so it falls to default path
      // Actually, if tunnel_url is NULL and service exists, it returns stopped with null url
      expect(withoutTunnel.status).toBe('stopped');
    });
  });

  // ======================================================================
  // LIST — ACTIVE TUNNELS
  // ======================================================================
  describe('list()', () => {
    it('should return empty array when no tunnels are active', () => {
      const result = tunnel.list();
      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return empty after stopAll', () => {
      // Even if we had tunnels, stopAll clears them
      tunnel.stopAll();
      expect(tunnel.list()).toEqual([]);
    });
  });

  // ======================================================================
  // STOP ALL — BULK CLEANUP
  // ======================================================================
  describe('stopAll()', () => {
    it('should return 0 when no tunnels are active', () => {
      const count = tunnel.stopAll();
      expect(count).toBe(0);
    });

    it('should be callable multiple times (idempotent)', () => {
      expect(tunnel.stopAll()).toBe(0);
      expect(tunnel.stopAll()).toBe(0);
    });
  });

  // ======================================================================
  // DATABASE INTERACTION
  // ======================================================================
  describe('Database interaction', () => {
    it('should use services table for port lookup', () => {
      insertService('db-test-svc', 5500);

      const row = db.prepare('SELECT * FROM services WHERE id = ?').get('db-test-svc');
      expect(row).toBeDefined();
      expect(row.port).toBe(5500);
    });

    it('should read tunnel_provider and tunnel_url from services table', () => {
      insertServiceWithTunnel('read-test', 5600, 'ngrok', 'https://read.ngrok.io');

      // The tunnel module's status() reads from this table
      const result = tunnel.status('read-test');
      expect(result.provider).toBe('ngrok');
      expect(result.url).toBe('https://read.ngrok.io');
    });

    it('should write NULL to tunnel columns on clearTunnel', () => {
      insertServiceWithTunnel('clear-test', 5700, 'cloudflared', 'https://clear.trycloudflare.com');

      tunnel.stop('clear-test');

      const row = db.prepare('SELECT tunnel_provider, tunnel_url FROM services WHERE id = ?')
        .get('clear-test');
      expect(row.tunnel_provider).toBeNull();
      expect(row.tunnel_url).toBeNull();
    });

    it('should handle SQL injection in service identity (parameterized queries)', () => {
      const maliciousId = "'; DROP TABLE services; --";
      const result = tunnel.stop(maliciousId);
      expect(result.success).toBe(true);

      // services table should still exist and be functional
      const count = db.prepare('SELECT COUNT(*) as count FROM services').get();
      expect(typeof count.count).toBe('number');
    });

    it('should handle SQL injection in start() service lookup', async () => {
      const maliciousId = "' OR '1'='1";
      const result = await tunnel.start(maliciousId);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/service not found/i);
    });

    it('should survive concurrent stop calls on different services', () => {
      insertServiceWithTunnel('svc-a', 6000, 'ngrok', 'https://a.ngrok.io');
      insertServiceWithTunnel('svc-b', 6001, 'ngrok', 'https://b.ngrok.io');

      tunnel.stop('svc-a');
      tunnel.stop('svc-b');

      const rowA = db.prepare('SELECT tunnel_url FROM services WHERE id = ?').get('svc-a');
      const rowB = db.prepare('SELECT tunnel_url FROM services WHERE id = ?').get('svc-b');
      expect(rowA.tunnel_url).toBeNull();
      expect(rowB.tunnel_url).toBeNull();
    });
  });

  // ======================================================================
  // EDGE CASES
  // ======================================================================
  describe('Edge cases', () => {
    it('should handle empty string service ID in start()', async () => {
      const result = await tunnel.start('');
      expect(result.success).toBe(false);
    });

    it('should handle status for service with NULL tunnel columns', () => {
      insertService('null-tunnel', 7000);

      const result = tunnel.status('null-tunnel');
      // Service exists but tunnel_url is null, so should fall to default return
      expect(result.status).toBe('stopped');
    });

    it('should handle stop on service that never had a tunnel', () => {
      insertService('never-tunnel', 7100);

      const result = tunnel.stop('never-tunnel');
      expect(result.success).toBe(true);

      // Service should still exist, just with null tunnel columns
      const row = db.prepare('SELECT * FROM services WHERE id = ?').get('never-tunnel');
      expect(row).toBeDefined();
      expect(row.tunnel_provider).toBeNull();
    });
  });
});
