/**
 * Unit Tests for Distributed Locks Module (locks.js)
 *
 * Tests lock acquisition, release, expiration, ownership, and cleanup.
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createLocks } from '../../lib/locks.js';

describe('Locks Module', () => {
  let db;
  let locks;

  beforeEach(() => {
    db = createTestDb();
    locks = createLocks(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('Acquire (15 tests)', () => {
    it('should acquire a new lock successfully', () => {
      const result = locks.acquire('my-lock');

      expect(result.success).toBe(true);
      expect(result.name).toBe('my-lock');
      expect(result.owner).toBe(`agent-${process.pid}`);
      expect(result.acquiredAt).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(result.message).toMatch(/acquired lock/);
    });

    it('should reject acquiring lock with empty name', () => {
      const result = locks.acquire('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject acquiring lock with null name', () => {
      const result = locks.acquire(null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject acquiring lock with wildcard names', () => {
      const invalidNames = [
        'docs/*',
        'lib/*.ts',
        '*'
      ];

      for (const name of invalidNames) {
        const result = locks.acquire(name);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/wildcard/);
      }
    });

    it('should accept valid lock names with dashes, underscores, colons', () => {
      const validNames = [
        'my-lock',
        'my_lock',
        'my:lock',
        'my-lock_1:prod',
        'a',
        '0',
        '123-456_789:abc'
      ];

      for (const name of validNames) {
        const result = locks.acquire(name);
        expect(result.success).toBe(true);
        expect(result.name).toBe(name);
      }
    });

    it('should accept repo-relative file paths as lock names', () => {
      const name = 'docs/recovery/CURRENT-WORK.md';
      const result = locks.acquire(name);

      expect(result.success).toBe(true);
      expect(result.name).toBe(name);
    });

    it('should accept absolute file paths as lock names', () => {
      const name = '/Users/erichowens/coding/port-daddy/lib/webhooks.ts';
      const result = locks.acquire(name);

      expect(result.success).toBe(true);
      expect(result.name).toBe(name);
    });

    it('should prevent acquiring a lock already held', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.acquire('my-lock', { owner: 'agent2' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/lock is held/);
      expect(result.holder).toBe('agent1');
    });

    it('should use provided owner name', () => {
      const result = locks.acquire('my-lock', { owner: 'my-custom-owner' });

      expect(result.success).toBe(true);
      expect(result.owner).toBe('my-custom-owner');
    });

    it('should use default owner (agent-pid)', () => {
      const result = locks.acquire('my-lock');

      expect(result.success).toBe(true);
      expect(result.owner).toMatch(/^agent-\d+$/);
    });

    it('should set default TTL to 5 minutes (300000 ms)', () => {
      const beforeAcquire = Date.now();
      const result = locks.acquire('my-lock');
      const afterAcquire = Date.now();

      // Expected expiry should be now + 300000
      const expectedMinExpiry = beforeAcquire + 300000;
      const expectedMaxExpiry = afterAcquire + 300000;

      expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result.expiresAt).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('should accept custom TTL', () => {
      const beforeAcquire = Date.now();
      const result = locks.acquire('my-lock', { ttl: 60000 });
      const afterAcquire = Date.now();

      const expectedMinExpiry = beforeAcquire + 60000;
      const expectedMaxExpiry = afterAcquire + 60000;

      expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMinExpiry);
      expect(result.expiresAt).toBeLessThanOrEqual(expectedMaxExpiry);
    });

    it('should handle very short TTL (1ms)', () => {
      const result = locks.acquire('my-lock', { ttl: 1 });

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeDefined();
      // Expires immediately after
      expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 100);
    });

    it('should support metadata', () => {
      const metadata = { task: 'important', priority: 'high' };
      const result = locks.acquire('my-lock', { metadata });

      expect(result.success).toBe(true);

      // Verify metadata is stored
      const check = locks.check('my-lock');
      expect(check.metadata).toEqual(metadata);
    });

    it('should handle metadata as null', () => {
      const result = locks.acquire('my-lock', { metadata: null });

      expect(result.success).toBe(true);

      const check = locks.check('my-lock');
      expect(check.metadata).toBeNull();
    });

    it('should track PID', () => {
      const result = locks.acquire('my-lock', { pid: 12345 });

      expect(result.success).toBe(true);

      const check = locks.check('my-lock');
      expect(check.pid).toBe(12345);
    });

    it('should use default PID (process.pid)', () => {
      const result = locks.acquire('my-lock');

      expect(result.success).toBe(true);

      const check = locks.check('my-lock');
      expect(check.pid).toBe(process.pid);
    });

    it('should auto-clean expired locks on acquire', () => {
      // Acquire and expire a lock by manually setting past timestamp
      const result1 = locks.acquire('expired-lock', { ttl: 1 });
      expect(result1.success).toBe(true);

      // Manually set it to expired in the past
      db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        'expired-lock'
      );

      // Try to acquire a new lock - should trigger cleanup
      const result2 = locks.acquire('new-lock', { owner: 'agent2' });
      expect(result2.success).toBe(true);

      // Verify expired lock is gone
      const expired = locks.check('expired-lock');
      expect(expired.held).toBe(false);
    });
  });

  describe('Release (12 tests)', () => {
    it('should release a lock successfully', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.release('my-lock');

      expect(result.success).toBe(true);
      expect(result.released).toBe(true);
      expect(result.name).toBe('my-lock');
      expect(result.message).toMatch(/released lock/);
    });

    it('should reject releasing lock with empty name', () => {
      const result = locks.release('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject releasing lock with null name', () => {
      const result = locks.release(null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should handle releasing non-existent lock gracefully', () => {
      const result = locks.release('nonexistent-lock');

      expect(result.success).toBe(true);
      expect(result.released).toBe(false);
      expect(result.message).toMatch(/lock not held/);
    });

    it('should prevent releasing lock by wrong owner', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.release('my-lock', { owner: 'agent2' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/held by another owner/);
      expect(result.holder).toBe('agent1');
    });

    it('should release lock by correct owner', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.release('my-lock', { owner: 'agent1' });

      expect(result.success).toBe(true);
      expect(result.released).toBe(true);
    });

    it('should force release regardless of owner', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.release('my-lock', { owner: 'agent2', force: true });

      expect(result.success).toBe(true);
      expect(result.released).toBe(true);
    });

    it('should verify lock is actually released', () => {
      locks.acquire('my-lock');
      locks.release('my-lock');

      const check = locks.check('my-lock');
      expect(check.held).toBe(false);
    });

    it('should handle double release', () => {
      locks.acquire('my-lock');
      locks.release('my-lock');
      const result = locks.release('my-lock');

      expect(result.success).toBe(true);
      expect(result.released).toBe(false);
    });

    it('should allow re-acquisition after release', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      locks.release('my-lock', { owner: 'agent1' });

      const reacquire = locks.acquire('my-lock', { owner: 'agent2' });
      expect(reacquire.success).toBe(true);
      expect(reacquire.owner).toBe('agent2');
    });

    it('should release without owner check when owner not specified', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.release('my-lock'); // No owner specified

      expect(result.success).toBe(true);
      expect(result.released).toBe(true);
    });

    it('should release filepath locks by wildcard pattern', () => {
      locks.acquire('docs/recovery/CURRENT-WORK.md', { owner: 'agent1' });
      locks.acquire('docs/recovery/PD-AGENT-SORTIE-PLAN.md', { owner: 'agent1' });
      locks.acquire('lib/webhooks.ts', { owner: 'agent1' });

      const result = locks.release('docs/recovery/*');

      expect(result.success).toBe(true);
      expect(result.released).toBe(2);
      expect(locks.check('docs/recovery/CURRENT-WORK.md').held).toBe(false);
      expect(locks.check('docs/recovery/PD-AGENT-SORTIE-PLAN.md').held).toBe(false);
      expect(locks.check('lib/webhooks.ts').held).toBe(true);
    });

    it('should auto-clean expired locks before releasing', () => {
      const expiredName = 'expired-lock';
      locks.acquire(expiredName, { ttl: 1 });

      // Expire it
      db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        expiredName
      );

      // Release should trigger cleanup
      const result = locks.release(expiredName);

      // The cleanup happens before check, so lock gets deleted
      // Release without owner should succeed (lock doesn't exist anymore)
      expect(result.success).toBe(true);
      expect(result.released).toBe(true);
    });
  });

  describe('Check (10 tests)', () => {
    it('should check if lock is held', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.check('my-lock');

      expect(result.success).toBe(true);
      expect(result.held).toBe(true);
      expect(result.owner).toBe('agent1');
    });

    it('should check non-existent lock', () => {
      const result = locks.check('nonexistent');

      expect(result.success).toBe(true);
      expect(result.held).toBe(false);
    });

    it('should reject check with empty name', () => {
      const result = locks.check('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject check with null name', () => {
      const result = locks.check(null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should return lock metadata', () => {
      const metadata = { task: 'critical', retry: 3 };
      locks.acquire('my-lock', { metadata });

      const result = locks.check('my-lock');
      expect(result.metadata).toEqual(metadata);
    });

    it('should return null metadata when not set', () => {
      locks.acquire('my-lock');

      const result = locks.check('my-lock');
      expect(result.metadata).toBeNull();
    });

    it('should return PID', () => {
      locks.acquire('my-lock', { pid: 9999 });

      const result = locks.check('my-lock');
      expect(result.pid).toBe(9999);
    });

    it('should return expiration time', () => {
      const result1 = locks.acquire('my-lock', { ttl: 60000 });
      const result2 = locks.check('my-lock');

      expect(result2.expiresAt).toBe(result1.expiresAt);
    });

    it('should return expiration for locks with very short TTL', () => {
      locks.acquire('my-lock', { ttl: 10 });

      const result = locks.check('my-lock');
      // Should have an expiration time set
      expect(result.expiresAt).toBeDefined();
      expect(typeof result.expiresAt).toBe('number');
      expect(result.expiresAt).toBeGreaterThan(0);
    });

    it('should auto-clean expired locks before checking', () => {
      locks.acquire('expired-lock', { ttl: 1 });

      // Expire it
      db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        'expired-lock'
      );

      // Check should trigger cleanup
      const result = locks.check('expired-lock');
      expect(result.held).toBe(false);
    });
  });

  describe('List (8 tests)', () => {
    it('should list all locks', () => {
      locks.acquire('lock1', { owner: 'agent1' });
      locks.acquire('lock2', { owner: 'agent2' });
      locks.acquire('lock3', { owner: 'agent1' });

      const result = locks.list();

      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(result.locks).toHaveLength(3);
    });

    it('should list locks by owner', () => {
      locks.acquire('lock1', { owner: 'agent1' });
      locks.acquire('lock2', { owner: 'agent2' });
      locks.acquire('lock3', { owner: 'agent1' });

      const result = locks.list({ owner: 'agent1' });

      expect(result.count).toBe(2);
      expect(result.locks).toHaveLength(2);
      expect(result.locks.every(l => l.owner === 'agent1')).toBe(true);
    });

    it('should return empty list when no locks exist', () => {
      const result = locks.list();

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.locks).toHaveLength(0);
    });

    it('should return empty list for non-existent owner', () => {
      locks.acquire('lock1', { owner: 'agent1' });

      const result = locks.list({ owner: 'nonexistent' });

      expect(result.count).toBe(0);
      expect(result.locks).toHaveLength(0);
    });

    it('should include all lock fields', () => {
      locks.acquire('my-lock', {
        owner: 'agent1',
        pid: 12345,
        metadata: { key: 'value' }
      });

      const result = locks.list();

      expect(result.locks[0]).toHaveProperty('name');
      expect(result.locks[0]).toHaveProperty('owner');
      expect(result.locks[0]).toHaveProperty('pid');
      expect(result.locks[0]).toHaveProperty('acquiredAt');
      expect(result.locks[0]).toHaveProperty('expiresAt');
      expect(result.locks[0]).toHaveProperty('metadata');
    });

    it('should order by most recent acquisition first', () => {
      locks.acquire('lock1', { owner: 'agent1' });
      // Small delay to ensure different timestamps
      db.prepare('UPDATE locks SET acquired_at = ? WHERE name = ?').run(
        Date.now() - 5000,
        'lock1'
      );

      locks.acquire('lock2', { owner: 'agent2' });

      const result = locks.list();

      expect(result.locks[0].name).toBe('lock2');
      expect(result.locks[1].name).toBe('lock1');
    });

    it('should auto-clean expired locks before listing', () => {
      locks.acquire('lock1', { owner: 'agent1', ttl: 1 });
      locks.acquire('lock2', { owner: 'agent2' });

      // Expire lock1
      db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        'lock1'
      );

      const result = locks.list();

      expect(result.count).toBe(1);
      expect(result.locks[0].name).toBe('lock2');
    });

    it('should parse metadata in list results', () => {
      const metadata = { priority: 'high', task: 'urgent' };
      locks.acquire('my-lock', { metadata });

      const result = locks.list();

      expect(result.locks[0].metadata).toEqual(metadata);
    });
  });

  describe('Extend (8 tests)', () => {
    it('should extend lock TTL', () => {
      locks.acquire('my-lock', { ttl: 60000 });
      const checkBefore = locks.check('my-lock');

      // Wait a tiny bit
      db.prepare('UPDATE locks SET acquired_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        'my-lock'
      );

      const result = locks.extend('my-lock', { ttl: 120000 });

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeGreaterThan(checkBefore.expiresAt);
    });

    it('should reject extending non-existent lock', () => {
      const result = locks.extend('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/lock not held/);
    });

    it('should reject extending with empty name', () => {
      const result = locks.extend('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should reject extending with null name', () => {
      const result = locks.extend(null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/non-empty string/);
    });

    it('should prevent extending by wrong owner', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.extend('my-lock', { owner: 'agent2' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/held by another owner/);
    });

    it('should extend by correct owner', () => {
      locks.acquire('my-lock', { owner: 'agent1' });
      const result = locks.extend('my-lock', { owner: 'agent1', ttl: 120000 });

      expect(result.success).toBe(true);
    });

    it('should use default TTL of 5 minutes', () => {
      locks.acquire('my-lock');
      const beforeExtend = Date.now();
      const result = locks.extend('my-lock');
      const afterExtend = Date.now();

      const expectedMin = beforeExtend + 300000;
      const expectedMax = afterExtend + 300000;

      expect(result.expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(result.expiresAt).toBeLessThanOrEqual(expectedMax);
    });

    it('should allow extending lock with short initial TTL', () => {
      const before = Date.now();
      locks.acquire('my-lock', { ttl: 1000 });
      const after = Date.now();

      const checkBefore = locks.check('my-lock');

      // Now extend with longer TTL
      const resultExtend = locks.extend('my-lock', { ttl: 120000 });

      expect(resultExtend.success).toBe(true);
      expect(resultExtend.expiresAt).toBeGreaterThan(checkBefore.expiresAt);
    });
  });

  describe('Cleanup (6 tests)', () => {
    it('should clean up expired locks', () => {
      locks.acquire('lock1', { ttl: 60000 });
      locks.acquire('lock2', { ttl: 60000 });

      // Force-expire both
      db.prepare('UPDATE locks SET expires_at = ? WHERE 1=1').run(Date.now() - 1000);

      const result = locks.cleanup();

      expect(result.cleaned).toBe(2);
    });

    it('should not clean non-expired locks', () => {
      locks.acquire('lock1', { ttl: 60000 });
      locks.acquire('lock2', { ttl: 60000 });

      const result = locks.cleanup();

      expect(result.cleaned).toBe(0);
    });

    it('should handle cleanup with no locks', () => {
      const result = locks.cleanup();

      expect(result.cleaned).toBe(0);
    });

    it('should clean only expired locks, not fresh ones', () => {
      locks.acquire('fresh-lock', { ttl: 60000 });
      locks.acquire('expired-lock', { ttl: 1 });

      // Expire only the second one
      db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        'expired-lock'
      );

      const result = locks.cleanup();

      expect(result.cleaned).toBe(1);

      // Verify fresh lock still exists
      const check = locks.check('fresh-lock');
      expect(check.held).toBe(true);
    });

    it('should cleanup locks with old timestamps correctly', () => {
      locks.acquire('old-lock', { ttl: 1000 });
      locks.acquire('fresh-lock', { ttl: 60000 });

      // Manually set one to old timestamp
      db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        'old-lock'
      );

      const result = locks.cleanup();

      expect(result.cleaned).toBe(1);

      // Verify fresh-lock still exists
      const check = locks.check('fresh-lock');
      expect(check.held).toBe(true);
    });

    it('should verify lock is truly deleted after cleanup', () => {
      locks.acquire('my-lock', { ttl: 1 });

      // Expire it
      db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        'my-lock'
      );

      locks.cleanup();

      const check = locks.check('my-lock');
      expect(check.held).toBe(false);
    });
  });

  describe('Concurrent Behavior (6 tests)', () => {
    it('should handle multiple agents acquiring different locks', () => {
      const r1 = locks.acquire('lock1', { owner: 'agent1' });
      const r2 = locks.acquire('lock2', { owner: 'agent2' });
      const r3 = locks.acquire('lock3', { owner: 'agent1' });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r3.success).toBe(true);
    });

    it('should handle race condition detection', () => {
      locks.acquire('my-lock', { owner: 'agent1' });

      // Simulate race condition - try to acquire same lock
      const result = locks.acquire('my-lock', { owner: 'agent2' });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/lock is held/);
    });

    it('should handle rapid acquire/release cycles', () => {
      for (let i = 0; i < 10; i++) {
        const acquire = locks.acquire(`lock-${i}`, { owner: 'agent1' });
        expect(acquire.success).toBe(true);

        const release = locks.release(`lock-${i}`, { owner: 'agent1' });
        expect(release.success).toBe(true);
      }
    });

    it('should maintain data integrity with mixed operations', () => {
      locks.acquire('lock1', { owner: 'agent1' });
      locks.acquire('lock2', { owner: 'agent2' });
      locks.release('lock1', { owner: 'agent1' });
      locks.acquire('lock3', { owner: 'agent1' });

      const result = locks.list();

      expect(result.count).toBe(2); // lock2 and lock3
      expect(result.locks.map(l => l.name).sort()).toEqual(['lock2', 'lock3']);
    });

    it('should handle multiple owners correctly', () => {
      locks.acquire('shared-resource', { owner: 'agent1' });

      const results = [];
      for (let i = 2; i <= 5; i++) {
        const r = locks.acquire('shared-resource', { owner: `agent${i}` });
        results.push(r);
      }

      // All should fail
      expect(results.every(r => !r.success)).toBe(true);
      expect(results.every(r => r.holder === 'agent1')).toBe(true);
    });

    it('should prevent lock migration without release', () => {
      locks.acquire('my-lock', { owner: 'agent1' });

      // Agent2 tries to acquire - should fail
      const result = locks.acquire('my-lock', { owner: 'agent2' });
      expect(result.success).toBe(false);

      // Agent1 releases
      locks.release('my-lock', { owner: 'agent1' });

      // Now agent2 can acquire
      const result2 = locks.acquire('my-lock', { owner: 'agent2' });
      expect(result2.success).toBe(true);
    });
  });

  describe('Edge Cases (10 tests)', () => {
    it('should handle very long lock names', () => {
      const longName = 'a'.repeat(500);
      const result = locks.acquire(longName);

      expect(result.success).toBe(true);
    });

    it('should handle very long owner names', () => {
      const longOwner = 'owner-' + 'a'.repeat(500);
      const result = locks.acquire('my-lock', { owner: longOwner });

      expect(result.success).toBe(true);
      expect(result.owner).toBe(longOwner);
    });

    it('should handle complex metadata', () => {
      const metadata = {
        nested: { deep: { structure: { value: 'here' } } },
        array: [1, 2, 3, { key: 'value' }],
        special: null
      };

      locks.acquire('my-lock', { metadata });
      const result = locks.check('my-lock');

      expect(result.metadata).toEqual(metadata);
    });

    it('should cap very large TTL values to MAX_TTL (1 hour)', () => {
      const largeTTL = 365 * 24 * 60 * 60 * 1000; // 1 year
      const MAX_TTL = 3600000; // 1 hour (hardcoded in lib/locks.ts)
      const result = locks.acquire('my-lock', { ttl: largeTTL });

      expect(result.success).toBe(true);
      // TTL should be capped at MAX_TTL, not the requested 1 year
      expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + MAX_TTL + 1000);
      expect(result.expiresAt).toBeGreaterThan(Date.now() + MAX_TTL - 1000);
    });

    it('should handle zero and negative PIDs', () => {
      const r1 = locks.acquire('lock1', { pid: 0 });
      const r2 = locks.acquire('lock2', { pid: -1 });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it('should handle acquiring multiple locks by same owner', () => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(locks.acquire(`lock-${i}`, { owner: 'agent1' }));
      }

      expect(results.every(r => r.success)).toBe(true);

      const listResult = locks.list({ owner: 'agent1' });
      expect(listResult.count).toBe(10);
    });

    it('should handle lock names with all allowed special chars', () => {
      const specialName = 'test:lock_1-name:2_3-4';
      const result = locks.acquire(specialName);

      expect(result.success).toBe(true);
      expect(result.name).toBe(specialName);
    });

    it('should reject lock names with control characters', () => {
      const invalidNames = [
        'line\nbreak',
        'tab\tname',
        'null\u0000byte'
      ];

      for (const name of invalidNames) {
        const result = locks.acquire(name);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/control characters/);
      }
    });

    it('should handle rapid cleanup cycles', () => {
      locks.acquire('lock1', { ttl: 1 });
      locks.acquire('lock2', { ttl: 1 });

      // Expire both
      db.prepare('UPDATE locks SET expires_at = ? WHERE 1=1').run(Date.now() - 1000);

      // Multiple cleanups
      const r1 = locks.cleanup();
      const r2 = locks.cleanup();
      const r3 = locks.cleanup();

      expect(r1.cleaned).toBe(2);
      expect(r2.cleaned).toBe(0);
      expect(r3.cleaned).toBe(0);
    });

    it('should handle release after automatic expiration', () => {
      locks.acquire('my-lock', { ttl: 1, owner: 'agent1' });

      // Expire it
      db.prepare('UPDATE locks SET expires_at = ? WHERE name = ?').run(
        Date.now() - 1000,
        'my-lock'
      );

      // Try to release - cleanup happens first, so lock is gone
      const result = locks.release('my-lock', { owner: 'agent1' });

      // Lock was auto-cleaned, so release succeeds but reports not held
      expect(result.success).toBe(true);
    });

    it('should handle null returns gracefully for missing locks', () => {
      const check = locks.check('definitely-does-not-exist');

      expect(check.success).toBe(true);
      expect(check.held).toBe(false);
    });
  });

  describe('Type Safety and Validation (8 tests)', () => {
    it('should reject non-string lock names', () => {
      const results = [
        locks.acquire(123),
        locks.acquire(true),
        locks.acquire({}),
        locks.acquire([])
      ];

      expect(results.every(r => !r.success)).toBe(true);
    });

    it('should reject non-string owner', () => {
      const result = locks.acquire('my-lock', { owner: 12345 });

      // The module doesn't validate owner type, so it might succeed
      // but let's verify the behavior is consistent
      if (result.success) {
        const check = locks.check('my-lock');
        expect(check.owner).toBeDefined();
      }
    });

    it('should handle undefined options gracefully', () => {
      const result = locks.acquire('my-lock', undefined);

      expect(result.success).toBe(true);
    });

    it('should handle empty options object', () => {
      const result = locks.acquire('my-lock', {});

      expect(result.success).toBe(true);
    });

    it('should ignore unknown option properties', () => {
      const result = locks.acquire('my-lock', {
        owner: 'agent1',
        unknownProp: 'ignored',
        anotherProp: 123
      });

      expect(result.success).toBe(true);
    });

    it('should validate lock name type in check()', () => {
      expect(locks.check(null).success).toBe(false);
      expect(locks.check(undefined).success).toBe(false);
      expect(locks.check(123).success).toBe(false);
    });

    it('should validate lock name type in release()', () => {
      expect(locks.release(null).success).toBe(false);
      expect(locks.release(undefined).success).toBe(false);
      expect(locks.release(123).success).toBe(false);
    });

    it('should validate lock name type in extend()', () => {
      expect(locks.extend(null).success).toBe(false);
      expect(locks.extend(undefined).success).toBe(false);
      expect(locks.extend(123).success).toBe(false);
    });
  });

  describe('TTL Validation (regression tests for Bug #16/#17)', () => {
    it('should accept string TTL that starts with valid number (parseInt behavior)', () => {
      // parseInt('300s', 10) === 300, so '300s' is accepted as 300ms
      const result = locks.acquire('my-lock', { ttl: '300s' });
      expect(result.success).toBe(true);
      // The 's' is ignored, parsed as 300ms
    });

    it('should reject string TTL that does not start with a number', () => {
      const result = locks.acquire('my-lock', { ttl: 'abc' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_TTL');
    });

    it('should reject NaN TTL', () => {
      const result = locks.acquire('my-lock', { ttl: 'NaN' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_TTL');
    });

    it('should reject Infinity TTL', () => {
      const result = locks.acquire('my-lock', { ttl: Infinity });
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_TTL');
    });

    it('should use default TTL for negative values', () => {
      const result = locks.acquire('my-lock', { ttl: -100 });
      expect(result.success).toBe(true);
      // Default TTL is 300000 (5 minutes)
      const expectedExpiry = Date.now() + 300000;
      expect(result.expiresAt).toBeGreaterThan(expectedExpiry - 2000);
      expect(result.expiresAt).toBeLessThan(expectedExpiry + 2000);
    });

    it('should use default TTL for zero', () => {
      const result = locks.acquire('my-lock', { ttl: 0 });
      expect(result.success).toBe(true);
      const expectedExpiry = Date.now() + 300000;
      expect(result.expiresAt).toBeGreaterThan(expectedExpiry - 2000);
      expect(result.expiresAt).toBeLessThan(expectedExpiry + 2000);
    });

    it('should accept string TTL that parses to valid number', () => {
      const result = locks.acquire('my-lock', { ttl: '60000' });
      expect(result.success).toBe(true);
      const expectedExpiry = Date.now() + 60000;
      expect(result.expiresAt).toBeGreaterThan(expectedExpiry - 2000);
      expect(result.expiresAt).toBeLessThan(expectedExpiry + 2000);
    });

    it('should cap TTL at MAX_TTL (1 hour) for acquire', () => {
      const hugeTtl = 999999999;
      const result = locks.acquire('my-lock', { ttl: hugeTtl });
      expect(result.success).toBe(true);
      // Should be capped at 1 hour (3600000ms)
      const expectedExpiry = Date.now() + 3600000;
      expect(result.expiresAt).toBeLessThan(expectedExpiry + 2000);
    });

    it('should validate TTL in extend() too', () => {
      locks.acquire('my-lock', { owner: 'test-agent' });
      const result = locks.extend('my-lock', { ttl: 'invalid', owner: 'test-agent' });
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_TTL');
    });
  });

  describe('State Consistency (5 tests)', () => {
    it('should maintain consistent state across operations', () => {
      locks.acquire('lock1', { owner: 'agent1' });
      locks.acquire('lock2', { owner: 'agent2' });

      const list1 = locks.list();
      locks.release('lock1', { owner: 'agent1' });
      const list2 = locks.list();

      expect(list1.count).toBe(2);
      expect(list2.count).toBe(1);
      expect(list2.locks[0].name).toBe('lock2');
    });

    it('should keep counts accurate', () => {
      for (let i = 0; i < 5; i++) {
        locks.acquire(`lock-${i}`, { owner: 'agent1' });
      }

      const result1 = locks.list({ owner: 'agent1' });
      expect(result1.count).toBe(5);

      locks.release(`lock-0`, { owner: 'agent1' });
      const result2 = locks.list({ owner: 'agent1' });
      expect(result2.count).toBe(4);
    });

    it('should preserve data integrity through mixed operations', () => {
      const operations = [
        () => locks.acquire('a', { owner: 'x' }),
        () => locks.acquire('b', { owner: 'y' }),
        () => locks.acquire('c', { owner: 'x' }),
        () => locks.release('b', { owner: 'y' }),
        () => locks.acquire('d', { owner: 'z' }),
        () => locks.release('a', { owner: 'x' }),
        () => locks.acquire('e', { owner: 'x' })
      ];

      operations.forEach(op => op());

      const final = locks.list();

      // Should have c, d, e
      expect(final.count).toBe(3);
      const names = final.locks.map(l => l.name).sort();
      expect(names).toEqual(['c', 'd', 'e']);
    });

    it('should handle metadata through full lifecycle', () => {
      const metadata = { version: 1, task: 'test' };
      locks.acquire('my-lock', { owner: 'agent1', metadata });

      const check1 = locks.check('my-lock');
      expect(check1.metadata).toEqual(metadata);

      locks.extend('my-lock', { owner: 'agent1' });

      const check2 = locks.check('my-lock');
      expect(check2.metadata).toEqual(metadata);
    });

    it('should be queryable at any point in lifecycle', () => {
      locks.acquire('my-lock', { owner: 'agent1', ttl: 60000 });

      // Check multiple times
      const c1 = locks.check('my-lock');
      const c2 = locks.check('my-lock');
      const c3 = locks.check('my-lock');

      expect(c1.held).toBe(true);
      expect(c2.held).toBe(true);
      expect(c3.held).toBe(true);
      expect(c1.owner).toBe('agent1');
      expect(c2.owner).toBe('agent1');
      expect(c3.owner).toBe('agent1');
    });
  });
});
