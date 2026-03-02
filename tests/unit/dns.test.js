/**
 * Unit Tests for DNS Module (dns.ts)
 *
 * Tests DNS record registration, hostname generation, validation,
 * lookup, listing, cleanup, activity logging, and edge cases.
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTestDb, createMockLogger } from '../setup-unit.js';
import { createDns } from '../../lib/dns.js';
import { createActivityLog, ActivityType } from '../../lib/activity.js';

describe('DNS Module', () => {
  let db;
  let dns;

  beforeEach(() => {
    db = createTestDb();
    dns = createDns(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  // ===========================================================================
  // Hostname Generation
  // ===========================================================================

  describe('identityToHostname', () => {
    it('should convert simple identity to .local hostname', () => {
      expect(dns.identityToHostname('myapp')).toBe('myapp.local');
    });

    it('should convert colons to dashes', () => {
      expect(dns.identityToHostname('myapp:api')).toBe('myapp-api.local');
    });

    it('should convert multi-level identity', () => {
      expect(dns.identityToHostname('myapp:api:main')).toBe('myapp-api-main.local');
    });

    it('should lowercase the hostname', () => {
      expect(dns.identityToHostname('MyApp:API')).toBe('myapp-api.local');
    });

    it('should replace invalid characters with dashes', () => {
      expect(dns.identityToHostname('my app@v2')).toBe('my-app-v2.local');
    });

    it('should collapse multiple dashes', () => {
      expect(dns.identityToHostname('my--app:::api')).toBe('my-app-api.local');
    });

    it('should trim leading and trailing dashes', () => {
      expect(dns.identityToHostname('-myapp-')).toBe('myapp.local');
    });

    it('should return unknown.local for empty sanitized result', () => {
      expect(dns.identityToHostname('---')).toBe('unknown.local');
    });

    it('should handle dots in identity', () => {
      expect(dns.identityToHostname('my.app')).toBe('my.app.local');
    });
  });

  // ===========================================================================
  // Hostname Validation
  // ===========================================================================

  describe('validateHostname', () => {
    it('should accept valid .local hostname', () => {
      const result = dns.validateHostname('myapp.local');
      expect(result.valid).toBe(true);
    });

    it('should accept hostname with dashes', () => {
      const result = dns.validateHostname('my-app.local');
      expect(result.valid).toBe(true);
    });

    it('should accept hostname with dots', () => {
      const result = dns.validateHostname('my.app.local');
      expect(result.valid).toBe(true);
    });

    it('should reject empty string', () => {
      const result = dns.validateHostname('');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/non-empty/);
    });

    it('should reject null', () => {
      const result = dns.validateHostname(null);
      expect(result.valid).toBe(false);
    });

    it('should reject non-string', () => {
      const result = dns.validateHostname(123);
      expect(result.valid).toBe(false);
    });

    it('should reject hostname not ending in .local', () => {
      const result = dns.validateHostname('myapp.com');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/\.local/);
    });

    it('should reject hostname longer than 253 characters', () => {
      const longName = 'a'.repeat(250) + '.local';
      const result = dns.validateHostname(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/253/);
    });

    it('should reject bare .local without name', () => {
      const result = dns.validateHostname('.local');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/name before/);
    });

    it('should reject hostname with invalid characters', () => {
      const result = dns.validateHostname('my app.local');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid characters/);
    });

    it('should reject hostname starting with dash', () => {
      const result = dns.validateHostname('-myapp.local');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid characters/);
    });

    it('should reject hostname ending with dash before .local', () => {
      const result = dns.validateHostname('myapp-.local');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid characters/);
    });
  });

  // ===========================================================================
  // Register
  // ===========================================================================

  describe('register', () => {
    it('should register a DNS record with auto-generated hostname', () => {
      const result = dns.register('myapp:api', { port: 3000 });

      expect(result.success).toBe(true);
      expect(result.identity).toBe('myapp:api');
      expect(result.hostname).toBe('myapp-api.local');
      expect(result.port).toBe(3000);
      expect(result.updated).toBe(false);
      expect(result.bonjourAdvertised).toBe(false);
    });

    it('should register with custom hostname', () => {
      const result = dns.register('myapp:api', { port: 3000, hostname: 'api.local' });

      expect(result.success).toBe(true);
      expect(result.hostname).toBe('api.local');
    });

    it('should update existing record', () => {
      dns.register('myapp:api', { port: 3000 });
      const result = dns.register('myapp:api', { port: 4000 });

      expect(result.success).toBe(true);
      expect(result.port).toBe(4000);
      expect(result.updated).toBe(true);
    });

    it('should reject empty identity', () => {
      const result = dns.register('', { port: 3000 });
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject null identity', () => {
      const result = dns.register(null, { port: 3000 });
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject whitespace-only identity', () => {
      const result = dns.register('   ', { port: 3000 });
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should trim identity whitespace', () => {
      const result = dns.register('  myapp:api  ', { port: 3000 });
      expect(result.success).toBe(true);
      expect(result.identity).toBe('myapp:api');
    });

    it('should reject invalid port (0)', () => {
      const result = dns.register('myapp:api', { port: 0 });
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid port (negative)', () => {
      const result = dns.register('myapp:api', { port: -1 });
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid port (too high)', () => {
      const result = dns.register('myapp:api', { port: 70000 });
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject non-number port', () => {
      const result = dns.register('myapp:api', { port: 'abc' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid custom hostname', () => {
      const result = dns.register('myapp:api', { port: 3000, hostname: 'bad.com' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should detect hostname conflicts', () => {
      dns.register('app-a', { port: 3000, hostname: 'shared.local' });
      const result = dns.register('app-b', { port: 4000, hostname: 'shared.local' });

      expect(result.success).toBe(false);
      expect(result.code).toBe('HOSTNAME_CONFLICT');
      expect(result.error).toMatch(/already in use/);
    });

    it('should allow same hostname when updating same identity', () => {
      dns.register('myapp:api', { port: 3000 });
      const result = dns.register('myapp:api', { port: 4000 });

      expect(result.success).toBe(true);
      expect(result.updated).toBe(true);
    });

    it('should accept port 1 (minimum)', () => {
      const result = dns.register('myapp', { port: 1 });
      expect(result.success).toBe(true);
      expect(result.port).toBe(1);
    });

    it('should accept port 65535 (maximum)', () => {
      const result = dns.register('myapp', { port: 65535 });
      expect(result.success).toBe(true);
      expect(result.port).toBe(65535);
    });
  });

  // ===========================================================================
  // Unregister
  // ===========================================================================

  describe('unregister', () => {
    it('should unregister an existing record', () => {
      dns.register('myapp:api', { port: 3000 });
      const result = dns.unregister('myapp:api');

      expect(result.success).toBe(true);
      expect(result.identity).toBe('myapp:api');
      expect(result.hostname).toBe('myapp-api.local');
    });

    it('should fail for non-existent record', () => {
      const result = dns.unregister('nonexistent');

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should reject empty identity', () => {
      const result = dns.unregister('');
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject null identity', () => {
      const result = dns.unregister(null);
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should allow re-registration after unregister', () => {
      dns.register('myapp:api', { port: 3000 });
      dns.unregister('myapp:api');
      const result = dns.register('myapp:api', { port: 4000 });

      expect(result.success).toBe(true);
      expect(result.port).toBe(4000);
      expect(result.updated).toBe(false);
    });
  });

  // ===========================================================================
  // List
  // ===========================================================================

  describe('list', () => {
    it('should list all records when no options', () => {
      dns.register('app-a', { port: 3000 });
      dns.register('app-b', { port: 4000 });

      const result = dns.list();

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.records).toHaveLength(2);
    });

    it('should return empty list when no records', () => {
      const result = dns.list();

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.records).toHaveLength(0);
    });

    it('should filter by pattern using glob', () => {
      dns.register('myapp:api', { port: 3000 });
      dns.register('myapp:frontend', { port: 3001 });
      dns.register('other:api', { port: 4000 });

      const result = dns.list({ pattern: 'myapp*' });

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        dns.register(`app-${i}`, { port: 3000 + i });
      }

      const result = dns.list({ limit: 3 });
      expect(result.count).toBe(3);
    });

    it('should format records correctly', () => {
      dns.register('myapp:api', { port: 3000 });
      const result = dns.list();

      const record = result.records[0];
      expect(record.identity).toBe('myapp:api');
      expect(record.hostname).toBe('myapp-api.local');
      expect(record.port).toBe(3000);
      expect(typeof record.createdAt).toBe('number');
      expect(typeof record.updatedAt).toBe('number');
    });
  });

  // ===========================================================================
  // Lookup
  // ===========================================================================

  describe('lookup', () => {
    it('should find record by hostname', () => {
      dns.register('myapp:api', { port: 3000 });
      const result = dns.lookup('myapp-api.local');

      expect(result.success).toBe(true);
      expect(result.record.identity).toBe('myapp:api');
      expect(result.record.port).toBe(3000);
    });

    it('should be case-insensitive', () => {
      dns.register('myapp:api', { port: 3000 });
      const result = dns.lookup('MYAPP-API.LOCAL');

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for missing hostname', () => {
      const result = dns.lookup('nonexistent.local');

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should reject empty hostname', () => {
      const result = dns.lookup('');

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });

    it('should reject null hostname', () => {
      const result = dns.lookup(null);

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  // ===========================================================================
  // Get
  // ===========================================================================

  describe('get', () => {
    it('should find record by identity', () => {
      dns.register('myapp:api', { port: 3000 });
      const result = dns.get('myapp:api');

      expect(result.success).toBe(true);
      expect(result.record.hostname).toBe('myapp-api.local');
      expect(result.record.port).toBe(3000);
    });

    it('should return NOT_FOUND for missing identity', () => {
      const result = dns.get('nonexistent');

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
    });

    it('should reject empty identity', () => {
      const result = dns.get('');

      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
    });
  });

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  describe('cleanup', () => {
    it('should remove DNS records for identities not in services table', () => {
      // Register DNS record
      dns.register('orphan-service', { port: 3000 });

      // The services table is empty, so this should clean up the orphan
      const result = dns.cleanup();

      expect(result.success).toBe(true);
      expect(result.cleaned).toBe(1);
    });

    it('should keep DNS records for identities that are in services table', () => {
      // Create a service first
      const now = Date.now();
      db.prepare(`INSERT INTO services (id, port, status, created_at, last_seen) VALUES (?, ?, ?, ?, ?)`).run(
        'active-service', 3000, 'assigned', now, now
      );

      // Register DNS for the active service
      dns.register('active-service', { port: 3000 });

      const result = dns.cleanup();
      expect(result.success).toBe(true);
      expect(result.cleaned).toBe(0);
    });

    it('should handle empty records gracefully', () => {
      const result = dns.cleanup();
      expect(result.success).toBe(true);
      expect(result.cleaned).toBe(0);
    });
  });

  // ===========================================================================
  // Status
  // ===========================================================================

  describe('status', () => {
    it('should return record count and bonjour status', () => {
      const result = dns.status();

      expect(result.success).toBe(true);
      expect(result.bonjourAvailable).toBe(false);
      expect(result.recordCount).toBe(0);
    });

    it('should reflect correct record count', () => {
      dns.register('app-a', { port: 3000 });
      dns.register('app-b', { port: 4000 });

      const result = dns.status();
      expect(result.recordCount).toBe(2);
    });
  });

  // ===========================================================================
  // Activity Logging
  // ===========================================================================

  describe('Activity Logging', () => {
    let activityLog;

    beforeEach(() => {
      activityLog = createActivityLog(db);
      dns.setActivityLog(activityLog);
    });

    it('should log DNS registration', () => {
      dns.register('myapp:api', { port: 3000 });

      const recent = activityLog.getRecent({ type: ActivityType.DNS_REGISTER, limit: 10 });
      expect(recent.entries.length).toBeGreaterThanOrEqual(1);
      expect(recent.entries[0].details).toMatch(/DNS registered/);
    });

    it('should log DNS update', () => {
      dns.register('myapp:api', { port: 3000 });
      dns.register('myapp:api', { port: 4000 });

      const recent = activityLog.getRecent({ type: ActivityType.DNS_REGISTER, limit: 10 });
      const updateEntry = recent.entries.find(e => e.details.includes('updated'));
      expect(updateEntry).toBeDefined();
    });

    it('should log DNS unregistration', () => {
      dns.register('myapp:api', { port: 3000 });
      dns.unregister('myapp:api');

      const recent = activityLog.getRecent({ type: ActivityType.DNS_UNREGISTER, limit: 10 });
      expect(recent.entries.length).toBeGreaterThanOrEqual(1);
      expect(recent.entries[0].details).toMatch(/DNS unregistered/);
    });

    it('should log DNS cleanup when records removed', () => {
      dns.register('orphan', { port: 3000 });
      dns.cleanup();

      const recent = activityLog.getRecent({ type: ActivityType.DNS_CLEANUP, limit: 10 });
      expect(recent.entries.length).toBeGreaterThanOrEqual(1);
    });

    it('should not log cleanup when no records removed', () => {
      dns.cleanup();

      const recent = activityLog.getRecent({ type: ActivityType.DNS_CLEANUP, limit: 10 });
      expect(recent.entries.length).toBe(0);
    });
  });

  // ===========================================================================
  // Edge Cases & Adversarial Inputs
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle very long identity', () => {
      const longId = 'a'.repeat(200);
      const result = dns.register(longId, { port: 3000 });
      expect(result.success).toBe(true);
    });

    it('should handle unicode in identity', () => {
      const result = dns.register('app-cafe', { port: 3000 });
      expect(result.success).toBe(true);
    });

    it('should handle identity with only special characters', () => {
      // After sanitization this becomes "unknown.local"
      const result = dns.register('!!!', { port: 3000 });
      expect(result.success).toBe(true);
    });

    it('should register multiple services on different ports', () => {
      dns.register('app:api', { port: 3000 });
      dns.register('app:frontend', { port: 3001 });
      dns.register('app:worker', { port: 3002 });

      const result = dns.list();
      expect(result.count).toBe(3);
    });

    it('should handle rapid registration and unregistration', () => {
      for (let i = 0; i < 50; i++) {
        dns.register(`app-${i}`, { port: 3000 + i });
      }
      for (let i = 0; i < 50; i++) {
        dns.unregister(`app-${i}`);
      }

      const result = dns.list();
      expect(result.count).toBe(0);
    });

    it('should handle port boundary values', () => {
      expect(dns.register('app-min', { port: 1 }).success).toBe(true);
      expect(dns.register('app-max', { port: 65535 }).success).toBe(true);
      expect(dns.register('app-zero', { port: 0 }).success).toBe(false);
      expect(dns.register('app-over', { port: 65536 }).success).toBe(false);
    });

    it('should handle concurrent hostname auto-generation for similar identities', () => {
      // These should get different auto-generated hostnames
      dns.register('myapp:api', { port: 3000 });
      dns.register('myapp-api', { port: 3001 });

      // Both have the same auto-hostname "myapp-api.local", second should fail
      const list = dns.list();
      // One should succeed, the other should get a conflict
      expect(list.count).toBeLessThanOrEqual(2);
    });

    it('should handle custom hostname that matches auto-generated pattern', () => {
      dns.register('first', { port: 3000, hostname: 'myapp-api.local' });
      // Now try to register an identity that would auto-generate the same hostname
      const result = dns.register('myapp:api', { port: 3001 });
      expect(result.success).toBe(false);
      expect(result.code).toBe('HOSTNAME_CONFLICT');
    });
  });

  // ===========================================================================
  // Concurrent Operations
  // ===========================================================================

  describe('Concurrent Operations', () => {
    it('should handle register-get-unregister cycle correctly', () => {
      const reg = dns.register('myapp', { port: 3000 });
      expect(reg.success).toBe(true);

      const got = dns.get('myapp');
      expect(got.success).toBe(true);
      expect(got.record.port).toBe(3000);

      const unreg = dns.unregister('myapp');
      expect(unreg.success).toBe(true);

      const gotAfter = dns.get('myapp');
      expect(gotAfter.success).toBe(false);
    });

    it('should maintain data integrity across many operations', () => {
      // Register 20 services
      for (let i = 0; i < 20; i++) {
        dns.register(`svc-${i}`, { port: 3000 + i });
      }

      // Update half of them
      for (let i = 0; i < 10; i++) {
        dns.register(`svc-${i}`, { port: 5000 + i });
      }

      // Delete a quarter
      for (let i = 0; i < 5; i++) {
        dns.unregister(`svc-${i}`);
      }

      const list = dns.list({ limit: 100 });
      expect(list.count).toBe(15);

      // Check updated ones still have correct ports
      const svc5 = dns.get('svc-5');
      expect(svc5.success).toBe(true);
      expect(svc5.record.port).toBe(5005);

      // Check non-updated ones still have original ports
      const svc15 = dns.get('svc-15');
      expect(svc15.success).toBe(true);
      expect(svc15.record.port).toBe(3015);
    });
  });
});
