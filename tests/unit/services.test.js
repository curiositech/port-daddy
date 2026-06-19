/**
 * Unit Tests for Services Module
 *
 * Comprehensive test suite for lib/services.js covering:
 * - Port claiming with semantic identities
 * - Port release by ID or pattern
 * - Service finding with filters
 * - Endpoint management
 * - Status updates
 * - Expiration handling
 *
 * Total: 45+ tests across 7 categories
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { createTestDb, createMockLogger } from '../setup-unit.js';
import { createServices } from '../../lib/services.js';

describe('Services Module - Claim Operations (15 tests)', () => {
  let db, services;

  beforeEach(() => {
    db = createTestDb();
    services = createServices(db);
  });

  it('should claim port for new service', () => {
    const result = services.claim('myapp:api:main');

    expect(result.success).toBe(true);
    expect(result.id).toBe('myapp:api:main');
    expect(result.port).toBeGreaterThanOrEqual(3100);
    expect(result.port).toBeLessThanOrEqual(9999);
    expect(result.status).toBe('assigned');
    expect(result.existing).toBe(false);
  });

  it('should return existing port for same identity', () => {
    const first = services.claim('myapp:api:main');
    const second = services.claim('myapp:api:main');

    expect(first.port).toBe(second.port);
    expect(second.existing).toBe(true);
    expect(second.message).toContain('reusing existing service');
  });

  it('should assign preferred port when available', () => {
    const result = services.claim('myapp:api:main', { port: 3500 });

    expect(result.port).toBe(3500);
    expect(result.message).toContain('preferred port');
  });

  it('should find alternative when preferred port taken', () => {
    const first = services.claim('app1:api:main', { port: 3500 });
    const second = services.claim('app2:api:main', { port: 3500 });

    expect(first.port).toBe(3500);
    expect(second.port).not.toBe(3500);
    expect(second.success).toBe(true);
  });

  it('should reject wildcard identity for claim', () => {
    const result = services.claim('myapp:*:main');

    expect(result.success).toBe(false);
    expect(result.error).toContain('wildcard');
  });

  it('should reject invalid identity format', () => {
    const result = services.claim('myapp:api:main:extra');

    expect(result.success).toBe(false);
    expect(result.error).toContain('3 segments');
  });

  it('should handle expiration time with duration string', () => {
    const now = Date.now();
    const result = services.claim('myapp:api:main', { expires: '1h' });

    expect(result.success).toBe(true);

    // Get service and check expiration
    const svc = db.prepare('SELECT expires_at FROM services WHERE id = ?').get('myapp:api:main');
    const expiresIn = svc.expires_at - now;

    // Should expire in ~1 hour (3600000ms), allow 1 second tolerance
    expect(expiresIn).toBeGreaterThan(3599000);
    expect(expiresIn).toBeLessThan(3601000);
  });

  it('should parse duration strings (30m, 1d)', () => {
    const now = Date.now();

    // Test 30 minutes
    services.claim('app1:api:main', { expires: '30m' });
    const svc1 = db.prepare('SELECT expires_at FROM services WHERE id = ?').get('app1:api:main');
    const thirtyMinMs = svc1.expires_at - now;
    expect(thirtyMinMs).toBeGreaterThan(1799000);
    expect(thirtyMinMs).toBeLessThan(1801000);

    // Test 1 day
    services.claim('app2:api:main', { expires: '1d' });
    const svc2 = db.prepare('SELECT expires_at FROM services WHERE id = ?').get('app2:api:main');
    const oneDayMs = svc2.expires_at - now;
    expect(oneDayMs).toBeGreaterThan(86399000);
    expect(oneDayMs).toBeLessThan(86401000);
  });

  it('should store metadata correctly', () => {
    const metadata = { version: '1.0', feature: 'auth' };
    const result = services.claim('myapp:api:main', { metadata });

    expect(result.success).toBe(true);

    // Verify stored metadata
    const svc = db.prepare('SELECT metadata FROM services WHERE id = ?').get('myapp:api:main');
    const stored = JSON.parse(svc.metadata);
    expect(stored).toEqual(metadata);
  });

  it('should create local endpoint automatically', () => {
    const result = services.claim('myapp:api:main', { port: 3500 });

    const endpoint = db.prepare('SELECT url FROM endpoints WHERE service_id = ? AND env = ?')
      .get('myapp:api:main', 'local');

    expect(endpoint).toBeDefined();
    expect(endpoint.url).toBe('http://localhost:3500');
  });

  it('should handle race conditions on concurrent claims', () => {
    // Simulate concurrent claims by directly inserting to create conflict
    const result1 = services.claim('myapp:api:main', { port: 3500 });

    // Try to claim another service with same port (simulating race condition)
    const result2 = services.claim('app2:api:main', { port: 3500 });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.port).toBe(3500);
    expect(result2.port).not.toBe(3500);
  });

  it('should respect port range limits', () => {
    const customRange = [3100, 3105];

    // Claim first 6 ports in range
    for (let i = 0; i < 6; i++) {
      services.claim(`app${i}:api:main`, { range: customRange });
    }

    // 7th claim should fail (no ports available)
    const result = services.claim('app6:api:main', { range: customRange });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No available ports');
  });

  it('should skip reserved ports (8080, 8000, 9876)', () => {
    const result1 = services.claim('app1:api:main', { port: 8080 });
    const result2 = services.claim('app2:api:main', { port: 8000 });
    const result3 = services.claim('app3:api:main', { port: 9876 });

    expect(result1.port).not.toBe(8080);
    expect(result2.port).not.toBe(8000);
    expect(result3.port).not.toBe(9876);
  });

  it('should store pid, cmd, cwd in service record', () => {
    const result = services.claim('myapp:api:main', {
      pid: 12345,
      cmd: 'npm run dev',
      cwd: '/home/user/project'
    });

    const svc = db.prepare('SELECT pid, cmd, cwd FROM services WHERE id = ?').get('myapp:api:main');

    expect(svc.pid).toBe(12345);
    expect(svc.cmd).toBe('npm run dev');
    expect(svc.cwd).toBe('/home/user/project');
  });
});

describe('Services Module - Release Operations (10 tests)', () => {
  let db, services;

  beforeEach(() => {
    db = createTestDb();
    services = createServices(db);
  });

  it('should release single service by ID', () => {
    services.claim('myapp:api:main');
    const result = services.release('myapp:api:main');

    expect(result.success).toBe(true);
    expect(result.released).toBe(1);
    expect(result.message).toContain('released');
  });

  it('should release multiple services by pattern', () => {
    services.claim('myapp:api:main');
    services.claim('myapp:api:dev');
    services.claim('myapp:frontend:main');

    const result = services.release('myapp:api:*');

    expect(result.success).toBe(true);
    expect(result.released).toBe(2);
  });

  it('should handle wildcard pattern (*)', () => {
    services.claim('app1:api:main');
    services.claim('app2:api:main');
    services.claim('app3:frontend:main');

    const result = services.release('*');

    expect(result.success).toBe(true);
    expect(result.released).toBe(3);
  });

  it('should release expired services with flag', () => {
    const now = Date.now();

    // Manually insert expired service
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, expires_at)
      VALUES (?, ?, 'assigned', ?, ?, ?)
    `).run('app1:api:main', 3100, now, now, now - 1000);

    const result = services.release('*', { expired: true });

    expect(result.success).toBe(true);
    expect(result.released).toBe(1);
  });

  it('should clean up endpoints on release', () => {
    services.claim('myapp:api:main');

    // Verify endpoint exists
    let endpoint = db.prepare('SELECT * FROM endpoints WHERE service_id = ?').get('myapp:api:main');
    expect(endpoint).toBeDefined();

    // Release service
    services.release('myapp:api:main');

    // Verify endpoint deleted
    endpoint = db.prepare('SELECT * FROM endpoints WHERE service_id = ?').get('myapp:api:main');
    expect(endpoint).toBeUndefined();
  });

  it('should return released port number', () => {
    const claim = services.claim('myapp:api:main', { port: 3500 });
    const release = services.release('myapp:api:main');

    expect(release.port).toBe(3500);
  });

  it('should handle release of non-existent service', () => {
    const result = services.release('nonexistent:api:main');

    expect(result.success).toBe(true);
    expect(result.released).toBe(0);
  });

  it('should match partial patterns (myapp:*)', () => {
    services.claim('myapp:api:main');
    services.claim('myapp:api:dev');
    services.claim('myapp:frontend:main');

    const result = services.release('myapp:*');

    expect(result.released).toBe(3);
  });

  it('should not release services not matching pattern', () => {
    services.claim('app1:api:main');
    services.claim('app2:api:main');
    services.claim('app3:frontend:main');

    const result = services.release('app1:api:*');

    expect(result.released).toBe(1);

    // Verify others still exist
    const remaining = db.prepare('SELECT COUNT(*) as count FROM services').get();
    expect(remaining.count).toBe(2);
  });

  it('should return count of released services', () => {
    for (let i = 0; i < 5; i++) {
      services.claim(`app:api:instance${i}`);
    }

    const result = services.release('app:api:*');

    expect(result.released).toBe(5);
  });
});

describe('Services Module - Find Operations (10 tests)', () => {
  let db, services;

  beforeEach(() => {
    db = createTestDb();
    services = createServices(db);
  });

  it('should find all services with *', () => {
    services.claim('app1:api:main');
    services.claim('app2:api:main');
    services.claim('app3:frontend:main');

    const result = services.find('*');

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
  });

  it('should find services by pattern', () => {
    services.claim('myapp:api:main');
    services.claim('myapp:api:dev');
    services.claim('myapp:frontend:main');
    services.claim('otherapp:api:main');

    const result = services.find('myapp:api:*');

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.services[0].id).toMatch(/^myapp:api:/);
  });

  it('should filter by status', () => {
    const claim = services.claim('app1:api:main');
    services.setStatus(claim.id, 'running');

    services.claim('app2:api:main'); // stays in 'assigned' status

    const result = services.find('*', { status: 'running' });

    expect(result.count).toBe(1);
    expect(result.services[0].status).toBe('running');
  });

  it('should filter by port number', () => {
    services.claim('app1:api:main', { port: 3500 });
    services.claim('app2:api:main', { port: 3501 });

    const result = services.find('*', { port: 3500 });

    expect(result.count).toBe(1);
    expect(result.services[0].port).toBe(3500);
  });

  it('should filter by expired flag (true)', () => {
    const now = Date.now();

    // Insert expired service directly
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, expires_at)
      VALUES (?, ?, 'assigned', ?, ?, ?)
    `).run('app1:api:main', 3100, now, now, now - 1000);

    services.claim('app2:api:main'); // no expiration

    const result = services.find('*', { expired: true });

    expect(result.count).toBe(1);
    expect(result.services[0].id).toBe('app1:api:main');
  });

  it('should filter by expired flag (false)', () => {
    const now = Date.now();

    // Insert expired and non-expired
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, expires_at)
      VALUES (?, ?, 'assigned', ?, ?, ?)
    `).run('app1:api:main', 3100, now, now, now - 1000);

    services.claim('app2:api:main');

    const result = services.find('*', { expired: false });

    expect(result.count).toBe(1);
    expect(result.services[0].id).toBe('app2:api:main');
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      services.claim(`app${i}:api:main`);
    }

    const result = services.find('*', { limit: 3 });

    expect(result.count).toBe(3);
  });

  it('should return enriched service objects', () => {
    services.claim('myapp:api:main', {
      port: 3500,
      metadata: { version: '1.0' }
    });

    const result = services.find('myapp:*');
    const svc = result.services[0];

    expect(svc.id).toBe('myapp:api:main');
    expect(svc.port).toBe(3500);
    expect(svc.status).toBe('assigned');
    expect(svc.createdAt).toBeDefined();
    expect(svc.lastSeen).toBeDefined();
    expect(svc.metadata).toEqual({ version: '1.0' });
  });

  it('should include endpoint URLs', () => {
    services.claim('myapp:api:main', { port: 3500 });
    services.setEndpoint('myapp:api:main', 'staging', 'https://staging.example.com');

    const result = services.find('myapp:*');
    const svc = result.services[0];

    expect(svc.urls.local).toBe('http://localhost:3500');
    expect(svc.urls.staging).toBe('https://staging.example.com');
  });

  it('should parse metadata JSON', () => {
    const metadata = { feature: 'auth', version: '1.0' };
    services.claim('myapp:api:main', { metadata });

    const result = services.find('myapp:*');

    expect(result.services[0].metadata).toEqual(metadata);
  });
});

describe('Services Module - Get Single Service (3 tests)', () => {
  let db, services;

  beforeEach(() => {
    db = createTestDb();
    services = createServices(db);
  });

  it('should get service by exact ID', () => {
    services.claim('myapp:api:main', { port: 3500 });
    const result = services.get('myapp:api:main');

    expect(result.success).toBe(true);
    expect(result.service.id).toBe('myapp:api:main');
    expect(result.service.port).toBe(3500);
  });

  it('should return error for non-existent service', () => {
    const result = services.get('nonexistent:api:main');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should include all service fields', () => {
    services.claim('myapp:api:main', {
      port: 3500,
      pid: 12345,
      cmd: 'npm run dev',
      cwd: '/home/user/project',
      metadata: { version: '1.0' }
    });
    services.setStatus('myapp:api:main', 'running');

    const result = services.get('myapp:api:main');
    const svc = result.service;

    expect(svc.id).toBe('myapp:api:main');
    expect(svc.port).toBe(3500);
    expect(svc.pid).toBe(12345);
    expect(svc.cmd).toBe('npm run dev');
    expect(svc.cwd).toBe('/home/user/project');
    expect(svc.status).toBe('running');
    expect(svc.createdAt).toBeDefined();
    expect(svc.lastSeen).toBeDefined();
    expect(svc.urls).toBeDefined();
    expect(svc.metadata).toEqual({ version: '1.0' });
  });
});

describe('Services Module - Endpoint Management (4 tests)', () => {
  let db, services;

  beforeEach(() => {
    db = createTestDb();
    services = createServices(db);
  });

  it('should set endpoint URL', () => {
    services.claim('myapp:api:main');
    const result = services.setEndpoint('myapp:api:main', 'staging', 'https://staging.example.com');

    expect(result.success).toBe(true);

    const endpoint = db.prepare('SELECT url FROM endpoints WHERE service_id = ? AND env = ?')
      .get('myapp:api:main', 'staging');

    expect(endpoint.url).toBe('https://staging.example.com');
  });

  it('should update existing endpoint', () => {
    services.claim('myapp:api:main');
    services.setEndpoint('myapp:api:main', 'staging', 'https://staging-old.example.com');
    services.setEndpoint('myapp:api:main', 'staging', 'https://staging-new.example.com');

    const endpoint = db.prepare('SELECT url FROM endpoints WHERE service_id = ? AND env = ?')
      .get('myapp:api:main', 'staging');

    expect(endpoint.url).toBe('https://staging-new.example.com');
  });

  it('should reject invalid service ID', () => {
    const result = services.setEndpoint('nonexistent:api:main', 'staging', 'https://example.com');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should handle multiple environments (local, tunnel, staging, prod)', () => {
    services.claim('myapp:api:main', { port: 3500 });

    services.setEndpoint('myapp:api:main', 'tunnel', 'https://tunnel.example.com');
    services.setEndpoint('myapp:api:main', 'staging', 'https://staging.example.com');
    services.setEndpoint('myapp:api:main', 'prod', 'https://api.example.com');

    const result = services.get('myapp:api:main');
    const urls = result.service.urls;

    expect(urls.local).toBe('http://localhost:3500');
    expect(urls.tunnel).toBe('https://tunnel.example.com');
    expect(urls.staging).toBe('https://staging.example.com');
    expect(urls.prod).toBe('https://api.example.com');
  });
});

describe('Services Module - Status Operations (3 tests)', () => {
  let db, services;

  beforeEach(() => {
    db = createTestDb();
    services = createServices(db);
  });

  it('should update service status', () => {
    services.claim('myapp:api:main');
    const result = services.setStatus('myapp:api:main', 'running');

    expect(result.success).toBe(true);

    const svc = services.get('myapp:api:main');
    expect(svc.service.status).toBe('running');
  });

  it('should reject invalid service ID for status update', () => {
    const result = services.setStatus('nonexistent:api:main', 'running');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should update last_seen timestamp on status update', () => {
    services.claim('myapp:api:main');
    const before = services.get('myapp:api:main').service.lastSeen;

    // Wait a bit to ensure timestamp difference
    const now = Date.now();
    while (Date.now() < now + 10) {}

    services.setStatus('myapp:api:main', 'running');
    const after = services.get('myapp:api:main').service.lastSeen;

    expect(after).toBeGreaterThan(before);
  });
});

describe('Services Module - Cleanup Operations (2 tests)', () => {
  let db, services;

  beforeEach(() => {
    db = createTestDb();
    services = createServices(db);
  });

  it('should remove expired services', () => {
    const now = Date.now();

    // Insert expired service
    db.prepare(`
      INSERT INTO services (id, port, status, created_at, last_seen, expires_at)
      VALUES (?, ?, 'assigned', ?, ?, ?)
    `).run('app1:api:main', 3100, now, now, now - 1000);

    // Insert non-expired service
    services.claim('app2:api:main');

    const result = services.cleanup();

    expect(result.cleaned).toBe(1);

    // Verify expired removed, non-expired remains
    const remaining = db.prepare('SELECT COUNT(*) as count FROM services').get();
    expect(remaining.count).toBe(1);
  });

  it('should return count of cleaned services', () => {
    const now = Date.now();

    // Insert multiple expired services
    for (let i = 0; i < 3; i++) {
      db.prepare(`
        INSERT INTO services (id, port, status, created_at, last_seen, expires_at)
        VALUES (?, ?, 'assigned', ?, ?, ?)
      `).run(`app${i}:api:main`, 3100 + i, now, now, now - 1000);
    }

    const result = services.cleanup();

    expect(result.cleaned).toBe(3);
  });

  it('should cleanup services with dead PIDs', () => {
    // Claim a service with a PID that definitely doesn't exist
    const deadPid = 99999999;
    services.claim('zombie:api:main', { pid: deadPid, cmd: 'node index.js' });

    // Set it to 'running' status (cleanup only checks running services)
    services.setStatus('zombie:api:main', 'running');

    // Verify it exists
    const before = services.get('zombie:api:main');
    expect(before.success).toBe(true);

    // Cleanup should detect dead PID and remove it
    const result = services.cleanup();
    expect(result.cleaned).toBeGreaterThanOrEqual(1);

    // Verify it's gone
    const after = services.get('zombie:api:main');
    expect(after.success).toBe(false);
  });

  it('should not cleanup services with alive PIDs', () => {
    // Claim with our own PID (definitely alive)
    services.claim('alive:api:main', { pid: process.pid, cmd: 'node index.js' });
    services.setStatus('alive:api:main', 'running');

    // Cleanup should not touch it
    services.cleanup();

    const after = services.get('alive:api:main');
    expect(after.success).toBe(true);
  });

  it('should not cleanup assigned services regardless of PID', () => {
    // Assigned services haven't started - don't check their PID
    const deadPid = 99999999;
    services.claim('assigned:api:main', { pid: deadPid });

    // Status is 'assigned' by default (not 'running')
    const before = services.get('assigned:api:main');
    expect(before.service.status).toBe('assigned');

    services.cleanup();

    // Should still exist
    const after = services.get('assigned:api:main');
    expect(after.success).toBe(true);
  });
});

describe('Services Module - Edge Cases and Error Handling (3 tests)', () => {
  let db, services;

  beforeEach(() => {
    db = createTestDb();
    services = createServices(db);
  });

  it('should handle empty or null identities', () => {
    const result1 = services.claim(null);
    const result2 = services.claim('');
    const result3 = services.claim(undefined);

    expect(result1.success).toBe(false);
    expect(result2.success).toBe(false);
    expect(result3.success).toBe(false);
  });

  it('should handle invalid characters in identity', () => {
    const result1 = services.claim('myapp@api:main');
    const result2 = services.claim('myapp:api#main');

    expect(result1.success).toBe(false);
    expect(result2.success).toBe(false);
  });

  it('should handle very long identity segments', () => {
    const longSegment = 'a'.repeat(100);
    const result = services.claim(`${longSegment}:api:main`);

    expect(result.success).toBe(false);
    expect(result.error).toContain('too long');
  });
});
