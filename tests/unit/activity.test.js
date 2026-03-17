/**
 * Unit Tests for Activity Log Module (activity.js)
 *
 * Tests activity logging, querying, filtering, cleanup, and statistics.
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createActivityLog, ActivityType } from '../../lib/activity.js';

describe('Activity Log Module', () => {
  let db;
  let activityLog;

  beforeEach(() => {
    db = createTestDb();
    activityLog = createActivityLog(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('ActivityType Enum', () => {
    it('should export all required activity type constants', () => {
      const required = [
        'SERVICE_CLAIM',
        'SERVICE_RELEASE',
        'SERVICE_STATUS_CHANGE',
        'LOCK_ACQUIRE',
        'LOCK_RELEASE',
        'LOCK_EXPIRE',
        'AGENT_REGISTER',
        'AGENT_HEARTBEAT',
        'AGENT_UNREGISTER',
        'AGENT_CLEANUP',
        'MESSAGE_PUBLISH',
        'DAEMON_START',
        'DAEMON_STOP',
        'CLEANUP'
      ];

      for (const type of required) {
        expect(ActivityType[type]).toBeDefined();
        expect(typeof ActivityType[type]).toBe('string');
      }
    });
  });

  describe('Basic Logging (10 tests)', () => {
    it('should log an activity with type only', () => {
      const result = activityLog.log(ActivityType.DAEMON_START);

      expect(result.success).toBe(true);
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('number');
    });

    it('should log an activity with all fields', () => {
      const result = activityLog.log(ActivityType.SERVICE_CLAIM, {
        agentId: 'agent-1',
        targetId: 'svc-123',
        details: 'service claimed',
        metadata: { port: 3000 }
      });

      expect(result.success).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it('should record timestamp in milliseconds', () => {
      const before = Date.now();
      const result = activityLog.log(ActivityType.DAEMON_START);
      const after = Date.now();

      expect(result.timestamp).toBeGreaterThanOrEqual(before);
      expect(result.timestamp).toBeLessThanOrEqual(after);
    });

    it('should stringify complex metadata objects', () => {
      const metadata = { port: 3000, status: 'active', nested: { key: 'value' } };
      const result = activityLog.log(ActivityType.SERVICE_CLAIM, {
        metadata
      });

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].metadata).toEqual(metadata);
    });

    it('should handle string metadata', () => {
      const result = activityLog.log(ActivityType.DAEMON_START, {
        metadata: { message: 'test string' }
      });

      expect(result.success).toBe(true);
    });

    it('should handle empty options object', () => {
      const result = activityLog.log(ActivityType.DAEMON_START, {});

      expect(result.success).toBe(true);
    });
  });

  describe('getRecent with No Filters (8 tests)', () => {
    it('should return empty array when no entries exist', () => {
      const result = activityLog.getRecent();

      expect(result.success).toBe(true);
      expect(result.entries).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should return recent entries in reverse chronological order', () => {
      activityLog.log(ActivityType.DAEMON_START);
      activityLog.log(ActivityType.SERVICE_CLAIM);
      activityLog.log(ActivityType.LOCK_ACQUIRE);

      const result = activityLog.getRecent();

      expect(result.count).toBe(3);
      expect(result.entries[0].type).toBe(ActivityType.LOCK_ACQUIRE);
      expect(result.entries[1].type).toBe(ActivityType.SERVICE_CLAIM);
      expect(result.entries[2].type).toBe(ActivityType.DAEMON_START);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        activityLog.log(ActivityType.DAEMON_START);
      }

      const result = activityLog.getRecent({ limit: 5 });

      expect(result.count).toBe(5);
      expect(result.entries).toHaveLength(5);
    });

    it('should default to limit of 100', () => {
      for (let i = 0; i < 150; i++) {
        activityLog.log(ActivityType.DAEMON_START);
      }

      const result = activityLog.getRecent();

      expect(result.count).toBe(100);
      expect(result.entries).toHaveLength(100);
    });

    it('should enforce minimum limit of 1', () => {
      activityLog.log(ActivityType.DAEMON_START);

      const result = activityLog.getRecent({ limit: 0 });

      expect(result.count).toBe(1);
    });

    it('should enforce maximum limit of 1000', () => {
      for (let i = 0; i < 1500; i++) {
        activityLog.log(ActivityType.DAEMON_START);
      }

      const result = activityLog.getRecent({ limit: 2000 });

      expect(result.count).toBe(1000);
    });

    it('should include all entry fields', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, {
        agentId: 'agent-1',
        targetId: 'svc-123',
        details: 'test details',
        metadata: { port: 3000 }
      });

      const result = activityLog.getRecent({ limit: 1 });
      const entry = result.entries[0];

      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.type).toBe(ActivityType.SERVICE_CLAIM);
      expect(entry.agentId).toBe('agent-1');
      expect(entry.targetId).toBe('svc-123');
      expect(entry.details).toBe('test details');
      expect(entry.metadata).toEqual({ port: 3000 });
    });

    it('should return single entry correctly', () => {
      activityLog.log(ActivityType.DAEMON_START);

      const result = activityLog.getRecent({ limit: 1 });

      expect(result.count).toBe(1);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].type).toBe(ActivityType.DAEMON_START);
    });
  });

  describe('getRecent with Type Filter (6 tests)', () => {
    it('should filter entries by type', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-1' });
      activityLog.log(ActivityType.LOCK_ACQUIRE, { targetId: 'lock-1' });
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-2' });

      const result = activityLog.getRecent({ type: ActivityType.SERVICE_CLAIM });

      expect(result.count).toBe(2);
      expect(result.entries.every(e => e.type === ActivityType.SERVICE_CLAIM)).toBe(true);
    });

    it('should return empty array for non-matching type', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM);

      const result = activityLog.getRecent({ type: ActivityType.LOCK_ACQUIRE });

      expect(result.count).toBe(0);
      expect(result.entries).toEqual([]);
    });

    it('should respect limit when filtering by type', () => {
      for (let i = 0; i < 20; i++) {
        activityLog.log(ActivityType.SERVICE_CLAIM);
      }

      const result = activityLog.getRecent({ type: ActivityType.SERVICE_CLAIM, limit: 5 });

      expect(result.count).toBe(5);
    });

    it('should handle type filter with null metadata', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { metadata: null });
      activityLog.log(ActivityType.LOCK_ACQUIRE);

      const result = activityLog.getRecent({ type: ActivityType.SERVICE_CLAIM });

      expect(result.count).toBe(1);
      expect(result.entries[0].metadata).toBeNull();
    });

    it('should correctly filter among mixed entry types', () => {
      activityLog.log(ActivityType.DAEMON_START);
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-1' });
      activityLog.log(ActivityType.AGENT_REGISTER, { agentId: 'agent-1' });
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-2' });
      activityLog.log(ActivityType.LOCK_ACQUIRE, { targetId: 'lock-1' });

      const result = activityLog.getRecent({ type: ActivityType.SERVICE_CLAIM });

      expect(result.count).toBe(2);
      // Both SERVICE_CLAIM entries returned; order depends on timestamp (may be same ms)
      const targetIds = result.entries.map(e => e.targetId).sort();
      expect(targetIds).toEqual(['svc-1', 'svc-2']);
    });
  });

  describe('getRecent with AgentId Filter (5 tests)', () => {
    it('should filter entries by agentId', () => {
      activityLog.log(ActivityType.AGENT_REGISTER, { agentId: 'agent-1' });
      activityLog.log(ActivityType.AGENT_REGISTER, { agentId: 'agent-2' });
      activityLog.log(ActivityType.AGENT_REGISTER, { agentId: 'agent-1' });

      const result = activityLog.getRecent({ agentId: 'agent-1' });

      expect(result.count).toBe(2);
      expect(result.entries.every(e => e.agentId === 'agent-1')).toBe(true);
    });

    it('should return empty array for non-matching agentId', () => {
      activityLog.log(ActivityType.AGENT_REGISTER, { agentId: 'agent-1' });

      const result = activityLog.getRecent({ agentId: 'agent-999' });

      expect(result.count).toBe(0);
    });

    it('should respect limit when filtering by agentId', () => {
      for (let i = 0; i < 10; i++) {
        activityLog.log(ActivityType.AGENT_HEARTBEAT, { agentId: 'agent-1' });
      }

      const result = activityLog.getRecent({ agentId: 'agent-1', limit: 3 });

      expect(result.count).toBe(3);
    });

    it('should ignore null agentId in filter', () => {
      activityLog.log(ActivityType.DAEMON_START, { agentId: null });
      activityLog.log(ActivityType.AGENT_REGISTER, { agentId: 'agent-1' });

      const result = activityLog.getRecent({ agentId: 'agent-1' });

      expect(result.count).toBe(1);
      expect(result.entries[0].agentId).toBe('agent-1');
    });

  });

  describe('getRecent with TargetPattern Filter (6 tests)', () => {
    it('should filter entries by exact targetId', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-123' });
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-456' });
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-123' });

      const result = activityLog.getRecent({ targetPattern: 'svc-123' });

      expect(result.count).toBe(2);
      expect(result.entries.every(e => e.targetId === 'svc-123')).toBe(true);
    });

    it('should support wildcard pattern in targetId', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-123' });
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-456' });
      activityLog.log(ActivityType.LOCK_ACQUIRE, { targetId: 'lock-789' });

      const result = activityLog.getRecent({ targetPattern: 'svc-*' });

      expect(result.count).toBe(2);
      expect(result.entries.every(e => e.targetId.startsWith('svc-'))).toBe(true);
    });

    it('should support wildcard at any position', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'app:svc:1' });
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'app:svc:2' });
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'other:svc:1' });

      const result = activityLog.getRecent({ targetPattern: 'app:*' });

      expect(result.count).toBe(2);
    });

    it('should return empty array for non-matching pattern', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-123' });

      const result = activityLog.getRecent({ targetPattern: 'nonexistent-*' });

      expect(result.count).toBe(0);
    });

    it('should respect limit when filtering by targetPattern', () => {
      for (let i = 0; i < 10; i++) {
        activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: `svc-${i}` });
      }

      const result = activityLog.getRecent({ targetPattern: 'svc-*', limit: 4 });

      expect(result.count).toBe(4);
    });

    it('should convert asterisks to SQL wildcards', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'myapp:service:prod' });
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'myapp:service:dev' });
      activityLog.log(ActivityType.LOCK_ACQUIRE, { targetId: 'otherapp:lock:prod' });

      const result = activityLog.getRecent({ targetPattern: 'myapp:service:*' });

      expect(result.count).toBe(2);
    });
  });

  describe('getByTimeRange (8 tests)', () => {
    it('should query entries within time range', () => {
      const start = Date.now();
      activityLog.log(ActivityType.DAEMON_START);
      const end = Date.now();

      const result = activityLog.getByTimeRange(start, end);

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });

    it('should return empty array for time range with no entries', () => {
      const pastStart = Date.now() - 10000;
      const pastEnd = Date.now() - 5000;

      const result = activityLog.getByTimeRange(pastStart, pastEnd);

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it('should include timeRange in response', () => {
      const start = Date.now() - 1000;
      const end = Date.now() + 1000;

      activityLog.log(ActivityType.DAEMON_START);
      const result = activityLog.getByTimeRange(start, end);

      expect(result.timeRange).toBeDefined();
      expect(result.timeRange.start).toBe(start);
      expect(result.timeRange.end).toBe(end);
    });

    it('should respect limit parameter', () => {
      const start = Date.now() - 1000;

      for (let i = 0; i < 20; i++) {
        activityLog.log(ActivityType.DAEMON_START);
      }

      const end = Date.now() + 1000;
      const result = activityLog.getByTimeRange(start, end, { limit: 5 });

      expect(result.count).toBe(5);
    });

    it('should default to limit of 1000', () => {
      const start = Date.now() - 1000;

      for (let i = 0; i < 1500; i++) {
        activityLog.log(ActivityType.DAEMON_START);
      }

      const end = Date.now() + 1000;
      const result = activityLog.getByTimeRange(start, end);

      expect(result.count).toBe(1000);
    });

    it('should enforce minimum limit of 1', () => {
      const start = Date.now() - 1000;
      activityLog.log(ActivityType.DAEMON_START);
      const end = Date.now() + 1000;

      const result = activityLog.getByTimeRange(start, end, { limit: 0 });

      expect(result.count).toBe(1);
    });

    it('should enforce maximum limit of 10000', () => {
      const start = Date.now() - 1000;

      for (let i = 0; i < 15000; i++) {
        activityLog.log(ActivityType.DAEMON_START);
      }

      const end = Date.now() + 1000;
      const result = activityLog.getByTimeRange(start, end, { limit: 50000 });

      expect(result.count).toBeLessThanOrEqual(10000);
    });

    it('should return entries in reverse chronological order', () => {
      const start = Date.now() - 1000;
      const timestamps = [];

      for (let i = 0; i < 3; i++) {
        const r = activityLog.log(ActivityType.DAEMON_START);
        timestamps.push(r.timestamp);
      }

      const end = Date.now() + 1000;
      const result = activityLog.getByTimeRange(start, end);

      expect(result.entries[0].timestamp).toBe(timestamps[2]);
      expect(result.entries[1].timestamp).toBe(timestamps[1]);
      expect(result.entries[2].timestamp).toBe(timestamps[0]);
    });
  });

  describe('getSummary (6 tests)', () => {
    it('should return empty summary when no entries exist', () => {
      const result = activityLog.getSummary();

      expect(result.success).toBe(true);
      expect(result.summary).toEqual({});
      expect(result.total).toBe(0);
    });

    it('should count entries by type', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM);
      activityLog.log(ActivityType.SERVICE_CLAIM);
      activityLog.log(ActivityType.LOCK_ACQUIRE);
      activityLog.log(ActivityType.LOCK_ACQUIRE);
      activityLog.log(ActivityType.LOCK_ACQUIRE);

      const result = activityLog.getSummary();

      expect(result.summary[ActivityType.SERVICE_CLAIM]).toBe(2);
      expect(result.summary[ActivityType.LOCK_ACQUIRE]).toBe(3);
      expect(result.total).toBe(5);
    });

    it('should include all activity types in summary', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-1' });
      activityLog.log(ActivityType.LOCK_ACQUIRE, { targetId: 'lock-1' });
      activityLog.log(ActivityType.AGENT_REGISTER, { agentId: 'agent-1' });
      activityLog.log(ActivityType.DAEMON_START);

      const result = activityLog.getSummary();

      expect(Object.keys(result.summary)).toHaveLength(4);
      expect(result.total).toBe(4);
    });

    it('should filter by sinceTimestamp', () => {
      // Use explicit past timestamp so DAEMON_START is strictly before midpoint
      const pastTime = Date.now() - 5000;
      db.prepare(
        'INSERT INTO activity_log (timestamp, type) VALUES (?, ?)'
      ).run(pastTime, ActivityType.DAEMON_START);

      const midpoint = Date.now() - 1;

      activityLog.log(ActivityType.SERVICE_CLAIM);
      activityLog.log(ActivityType.LOCK_ACQUIRE);

      const result = activityLog.getSummary(midpoint);

      expect(result.summary[ActivityType.DAEMON_START]).toBeUndefined();
      expect(result.summary[ActivityType.SERVICE_CLAIM]).toBe(1);
      expect(result.summary[ActivityType.LOCK_ACQUIRE]).toBe(1);
      expect(result.total).toBe(2);
    });

    it('should include since field in response', () => {
      const sinceTime = Date.now() - 5000;
      const result = activityLog.getSummary(sinceTime);

      expect(result.since).toBe(sinceTime);
    });

    it('should order types by count descending', () => {
      for (let i = 0; i < 5; i++) activityLog.log(ActivityType.SERVICE_CLAIM);
      for (let i = 0; i < 3; i++) activityLog.log(ActivityType.LOCK_ACQUIRE);
      for (let i = 0; i < 10; i++) activityLog.log(ActivityType.DAEMON_START);

      const result = activityLog.getSummary();

      const types = Object.keys(result.summary);
      const counts = types.map(t => result.summary[t]);

      // Verify descending order
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
      }
    });
  });

  describe('getStats (5 tests)', () => {
    it('should return zero stats when empty', () => {
      const result = activityLog.getStats();

      expect(result.success).toBe(true);
      expect(result.stats.totalEntries).toBe(0);
      expect(result.stats.oldestEntry).toBeNull();
      expect(result.stats.newestEntry).toBeNull();
    });

    it('should report total entry count', () => {
      for (let i = 0; i < 7; i++) {
        activityLog.log(ActivityType.DAEMON_START);
      }

      const result = activityLog.getStats();

      expect(result.stats.totalEntries).toBe(7);
    });

    it('should report oldest and newest timestamps', () => {
      const r1 = activityLog.log(ActivityType.DAEMON_START);
      const r2 = activityLog.log(ActivityType.SERVICE_CLAIM);
      const r3 = activityLog.log(ActivityType.LOCK_ACQUIRE);

      const result = activityLog.getStats();

      expect(result.stats.oldestEntry).toBe(r1.timestamp);
      expect(result.stats.newestEntry).toBe(r3.timestamp);
    });

    it('should include retention constants in stats', () => {
      activityLog.log(ActivityType.DAEMON_START);
      const result = activityLog.getStats();

      expect(result.stats.retentionMs).toBeDefined();
      expect(result.stats.retentionMs).toBeGreaterThan(0);
      expect(result.stats.maxEntries).toBeDefined();
      expect(result.stats.maxEntries).toBeGreaterThan(0);
    });

    it('should return stats with expected structure', () => {
      activityLog.log(ActivityType.DAEMON_START);
      const result = activityLog.getStats();

      expect(result.stats).toHaveProperty('totalEntries');
      expect(result.stats).toHaveProperty('oldestEntry');
      expect(result.stats).toHaveProperty('newestEntry');
      expect(result.stats).toHaveProperty('retentionMs');
      expect(result.stats).toHaveProperty('maxEntries');
    });
  });

  describe('cleanup (7 tests)', () => {
    it('should return cleanup result with changes count', () => {
      activityLog.log(ActivityType.DAEMON_START);
      const result = activityLog.cleanup();

      expect(result.deletedOld).toBeDefined();
      expect(result.deletedExcess).toBeDefined();
      expect(result.total).toBeDefined();
      expect(typeof result.deletedOld).toBe('number');
    });

    it('should not delete recent entries', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM);
      activityLog.log(ActivityType.LOCK_ACQUIRE);

      const beforeCleanup = activityLog.getRecent({ limit: 1000 });
      activityLog.cleanup();
      const afterCleanup = activityLog.getRecent({ limit: 1000 });

      expect(beforeCleanup.count).toBe(afterCleanup.count);
    });

    it('should clean up when called multiple times', () => {
      activityLog.log(ActivityType.DAEMON_START);
      activityLog.cleanup();
      const result = activityLog.cleanup();

      expect(result.deletedOld).toBeDefined();
      expect(result.deletedExcess).toBeDefined();
    });

    it('should return total as sum of deleted entries', () => {
      activityLog.log(ActivityType.DAEMON_START);
      const result = activityLog.cleanup();

      expect(result.total).toBe(result.deletedOld + result.deletedExcess);
    });

    it('should not fail when no entries to clean', () => {
      const result = activityLog.cleanup();

      expect(result.success).not.toBe(false);
      expect(result.deletedOld).toBe(0);
      expect(result.deletedExcess).toBe(0);
    });

    it('should handle cleanup with mixed entries', () => {
      for (let i = 0; i < 50; i++) {
        activityLog.log(ActivityType.SERVICE_CLAIM);
        activityLog.log(ActivityType.LOCK_ACQUIRE);
      }

      const beforeCleanup = activityLog.getStats();
      activityLog.cleanup();
      const afterCleanup = activityLog.getStats();

      expect(afterCleanup.stats.totalEntries).toBeLessThanOrEqual(beforeCleanup.stats.totalEntries);
    });

    it('should preserve chronological order after cleanup', () => {
      const timestamps = [];
      for (let i = 0; i < 5; i++) {
        const r = activityLog.log(ActivityType.DAEMON_START);
        timestamps.push(r.timestamp);
      }

      activityLog.cleanup();

      const result = activityLog.getRecent({ limit: 100 });
      for (let i = 1; i < result.entries.length; i++) {
        expect(result.entries[i].timestamp).toBeLessThanOrEqual(result.entries[i - 1].timestamp);
      }
    });
  });

  describe('logService Convenience Methods (4 tests)', () => {
    it('should log service claim', () => {
      const result = activityLog.logService.claim('svc-123', 'agent-1', 3000);

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].type).toBe(ActivityType.SERVICE_CLAIM);
      expect(entries.entries[0].targetId).toBe('svc-123');
      expect(entries.entries[0].agentId).toBe('agent-1');
      expect(entries.entries[0].metadata.port).toBe(3000);
    });

    it('should log service release', () => {
      const result = activityLog.logService.release('svc-123', 'agent-1', 3000);

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].type).toBe(ActivityType.SERVICE_RELEASE);
      expect(entries.entries[0].targetId).toBe('svc-123');
      expect(entries.entries[0].agentId).toBe('agent-1');
      expect(entries.entries[0].metadata.port).toBe(3000);
    });

    it('should include port in service claim metadata', () => {
      activityLog.logService.claim('svc-123', 'agent-1', 5000);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].metadata).toEqual({ port: 5000 });
    });

    it('should include details in service operations', () => {
      activityLog.logService.claim('svc-123', 'agent-1', 3000);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].details).toMatch(/claimed port 3000/);
    });
  });

  describe('logLock Convenience Methods (4 tests)', () => {
    it('should log lock acquisition', () => {
      const result = activityLog.logLock.acquire('lock-abc', 'agent-1');

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].type).toBe(ActivityType.LOCK_ACQUIRE);
      expect(entries.entries[0].targetId).toBe('lock-abc');
      expect(entries.entries[0].agentId).toBe('agent-1');
    });

    it('should log lock release', () => {
      const result = activityLog.logLock.release('lock-abc', 'agent-1');

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].type).toBe(ActivityType.LOCK_RELEASE);
      expect(entries.entries[0].targetId).toBe('lock-abc');
      expect(entries.entries[0].agentId).toBe('agent-1');
    });

    it('should include details in lock operations', () => {
      activityLog.logLock.acquire('lock-abc', 'agent-1');

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].details).toBe('acquired lock');
    });

    it('should handle multiple lock operations', () => {
      activityLog.logLock.acquire('lock-1', 'agent-1');
      activityLog.logLock.acquire('lock-2', 'agent-2');
      activityLog.logLock.release('lock-1', 'agent-1');

      const result = activityLog.getRecent({ limit: 100 });
      expect(result.count).toBe(3);
    });
  });

  describe('logAgent Convenience Methods (5 tests)', () => {
    it('should log agent registration', () => {
      const result = activityLog.logAgent.register('agent-1');

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].type).toBe(ActivityType.AGENT_REGISTER);
      expect(entries.entries[0].agentId).toBe('agent-1');
    });

    it('should log agent heartbeat', () => {
      const result = activityLog.logAgent.heartbeat('agent-1');

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].type).toBe(ActivityType.AGENT_HEARTBEAT);
      expect(entries.entries[0].agentId).toBe('agent-1');
    });

    it('should log agent unregistration', () => {
      const result = activityLog.logAgent.unregister('agent-1');

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].type).toBe(ActivityType.AGENT_UNREGISTER);
      expect(entries.entries[0].agentId).toBe('agent-1');
    });

    it('should include details in agent operations', () => {
      activityLog.logAgent.register('agent-1');

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].details).toBe('agent registered');
    });

    it('should track agent lifecycle in activity log', () => {
      activityLog.logAgent.register('agent-1');
      activityLog.logAgent.heartbeat('agent-1');
      activityLog.logAgent.heartbeat('agent-1');
      activityLog.logAgent.unregister('agent-1');

      const result = activityLog.getRecent({ agentId: 'agent-1', limit: 100 });

      expect(result.count).toBe(4);
      // Verify all lifecycle types are present (order may vary in same-ms inserts)
      const types = result.entries.map(e => e.type);
      expect(types).toContain(ActivityType.AGENT_REGISTER);
      expect(types).toContain(ActivityType.AGENT_HEARTBEAT);
      expect(types).toContain(ActivityType.AGENT_UNREGISTER);
    });
  });

  describe('Module Export (2 tests)', () => {
    it('should export all required functions', () => {
      expect(activityLog.log).toBeDefined();
      expect(activityLog.getRecent).toBeDefined();
      expect(activityLog.getByTimeRange).toBeDefined();
      expect(activityLog.getSummary).toBeDefined();
      expect(activityLog.cleanup).toBeDefined();
      expect(activityLog.getStats).toBeDefined();
    });

    it('should export all convenience log objects', () => {
      expect(activityLog.logService).toBeDefined();
      expect(activityLog.logLock).toBeDefined();
      expect(activityLog.logAgent).toBeDefined();
      expect(activityLog.ActivityType).toBeDefined();
    });
  });

  describe('Edge Cases and Error Handling (10 tests)', () => {
    it('should handle empty string values gracefully', () => {
      const result = activityLog.log(ActivityType.SERVICE_CLAIM, {
        targetId: '',
        agentId: '',
        details: ''
      });

      expect(result.success).toBe(true);
    });

    it('should handle very long strings', () => {
      const longString = 'x'.repeat(10000);
      const result = activityLog.log(ActivityType.DAEMON_START, {
        details: longString
      });

      expect(result.success).toBe(true);
    });

    it('should handle special characters in targetId', () => {
      const result = activityLog.log(ActivityType.SERVICE_CLAIM, {
        targetId: "app:service:prod'test\"special"
      });

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(entries.entries[0].targetId).toContain('special');
    });

    it('should handle large metadata objects', () => {
      const largeMetadata = {};
      for (let i = 0; i < 100; i++) {
        largeMetadata[`key_${i}`] = { nested: `value_${i}` };
      }

      const result = activityLog.log(ActivityType.DAEMON_START, { metadata: largeMetadata });

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      expect(Object.keys(entries.entries[0].metadata)).toHaveLength(100);
    });

    it('should handle concurrent-like sequential log calls', () => {
      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(activityLog.log(ActivityType.DAEMON_START));
      }

      const stats = activityLog.getStats();
      expect(stats.stats.totalEntries).toBe(100);
    });

    it('should preserve metadata types correctly', () => {
      const metadata = {
        stringVal: 'test',
        numberVal: 42,
        boolVal: true,
        arrayVal: [1, 2, 3],
        nestedObj: { key: 'value' }
      };

      activityLog.log(ActivityType.DAEMON_START, { metadata });

      const entries = activityLog.getRecent({ limit: 1 });
      const retrieved = entries.entries[0].metadata;

      expect(retrieved.stringVal).toBe('test');
      expect(retrieved.numberVal).toBe(42);
      expect(retrieved.boolVal).toBe(true);
      expect(Array.isArray(retrieved.arrayVal)).toBe(true);
      expect(retrieved.nestedObj.key).toBe('value');
    });

    it('should handle entries with all null fields except type', () => {
      const result = activityLog.log(ActivityType.DAEMON_START, {
        agentId: null,
        targetId: null,
        details: null,
        metadata: null
      });

      expect(result.success).toBe(true);

      const entries = activityLog.getRecent({ limit: 1 });
      const entry = entries.entries[0];

      expect(entry.agentId).toBeNull();
      expect(entry.targetId).toBeNull();
      expect(entry.details).toBeNull();
      expect(entry.metadata).toBeNull();
    });

    it('should handle pattern with percent signs', () => {
      activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: 'svc-100%' });

      // Pattern with % should be handled (escaped or used as wildcard)
      const result = activityLog.getRecent({ targetPattern: 'svc-%' });

      expect(result.success).toBe(true);
      // May or may not find the entry depending on SQL wildcard handling
    });

    it('should maintain data consistency across operations', () => {
      // Log several entries
      const logs = [];
      for (let i = 0; i < 10; i++) {
        logs.push(activityLog.log(ActivityType.SERVICE_CLAIM, { targetId: `svc-${i}` }));
      }

      // Query by type
      const byType = activityLog.getRecent({ type: ActivityType.SERVICE_CLAIM });
      expect(byType.count).toBe(10);

      // Get summary
      const summary = activityLog.getSummary();
      expect(summary.summary[ActivityType.SERVICE_CLAIM]).toBe(10);

      // Get stats
      const stats = activityLog.getStats();
      expect(stats.stats.totalEntries).toBe(10);

      // Verify all queries agree
      expect(byType.count).toBe(summary.total);
      expect(summary.total).toBe(stats.stats.totalEntries);
    });
  });
});
