/**
 * Unit Tests for Begin Flakiness Log Module (begin-flakiness.ts)
 *
 * Covers: classification, recording, recent/summary/stats queries, the rate
 * sparkline, retention cleanup, and subscriptions. Each test runs against a
 * fresh in-memory database for isolation (same pattern as activity.test.js).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import {
  createBeginFlakinessLog,
  classifyBeginFailure,
  BeginFlakinessClass,
} from '../../lib/begin-flakiness.js';

describe('Begin Flakiness Log Module', () => {
  let db;
  let log;

  beforeEach(() => {
    db = createTestDb();
    log = createBeginFlakinessLog(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('classifyBeginFailure', () => {
    it('maps known codes to coarse classes', () => {
      expect(classifyBeginFailure('MAIN_WORKTREE_CROWDED')).toBe(BeginFlakinessClass.CROWDED);
      expect(classifyBeginFailure('WORKTREE_REQUIRED')).toBe(BeginFlakinessClass.WORKTREE_POLICY);
      expect(classifyBeginFailure('MAIN_WORKTREE_SESSION_FORBIDDEN')).toBe(
        BeginFlakinessClass.WORKTREE_POLICY
      );
      expect(classifyBeginFailure('AGENT_REGISTRATION_FAILED')).toBe(
        BeginFlakinessClass.REGISTRATION
      );
      expect(classifyBeginFailure('SESSION_START_FAILED')).toBe(BeginFlakinessClass.SESSION_START);
      expect(classifyBeginFailure('VALIDATION_ERROR')).toBe(BeginFlakinessClass.VALIDATION);
      expect(classifyBeginFailure('SESSION_LIFECYCLE_REQUIRED')).toBe(
        BeginFlakinessClass.VALIDATION
      );
      expect(classifyBeginFailure('INTERNAL_ERROR')).toBe(BeginFlakinessClass.INTERNAL);
    });

    it('maps unknown / null codes to OTHER', () => {
      expect(classifyBeginFailure('WAT')).toBe(BeginFlakinessClass.OTHER);
      expect(classifyBeginFailure(null)).toBe(BeginFlakinessClass.OTHER);
      expect(classifyBeginFailure(undefined)).toBe(BeginFlakinessClass.OTHER);
    });
  });

  describe('record + getRecent', () => {
    it('records a failure and reads it back, classified', () => {
      const entry = log.record({
        code: 'MAIN_WORKTREE_CROWDED',
        error: 'main worktree is crowded',
        hint: 'Create a linked worktree…',
        identity: 'port-daddy:cli:fix',
        lifecycle: 'durable',
        purpose: 'fix the flake',
        httpStatus: 400,
      });

      expect(entry).not.toBeNull();
      expect(entry.class).toBe(BeginFlakinessClass.CROWDED);

      const recent = log.getRecent({ limit: 10 });
      expect(recent.count).toBe(1);
      const [row] = recent.entries;
      expect(row.code).toBe('MAIN_WORKTREE_CROWDED');
      expect(row.class).toBe('crowded');
      expect(row.hint).toBe('Create a linked worktree…');
      expect(row.identity).toBe('port-daddy:cli:fix');
      expect(row.httpStatus).toBe(400);
    });

    it('filters getRecent by class', () => {
      log.record({ code: 'MAIN_WORKTREE_CROWDED' });
      log.record({ code: 'INTERNAL_ERROR' });
      log.record({ code: 'MAIN_WORKTREE_CROWDED' });

      const crowded = log.getRecent({ class: 'crowded' });
      expect(crowded.count).toBe(2);
      expect(crowded.entries.every((e) => e.class === 'crowded')).toBe(true);

      const internal = log.getRecent({ class: 'internal' });
      expect(internal.count).toBe(1);
    });

    it('returns most-recent first', () => {
      log.record({ code: 'VALIDATION_ERROR', error: 'first' });
      log.record({ code: 'INTERNAL_ERROR', error: 'second' });
      const recent = log.getRecent({ limit: 10 });
      expect(recent.entries[0].error).toBe('second');
    });
  });

  describe('getSummary', () => {
    it('rolls up counts by class and by code with a sparkline', () => {
      log.record({ code: 'MAIN_WORKTREE_CROWDED' });
      log.record({ code: 'MAIN_WORKTREE_CROWDED' });
      log.record({ code: 'INTERNAL_ERROR' });

      const summary = log.getSummary(0, 12);
      expect(summary.total).toBe(3);
      expect(summary.byClass.crowded).toBe(2);
      expect(summary.byClass.internal).toBe(1);
      expect(summary.byCode.MAIN_WORKTREE_CROWDED).toBe(2);
      expect(Array.isArray(summary.sparkline)).toBe(true);
      expect(summary.sparkline.length).toBe(12);
      // All recent events land in the final bucket.
      expect(summary.sparkline.reduce((a, b) => a + b, 0)).toBe(3);
      expect(summary.lastSeen).not.toBeNull();
    });

    it('clamps the bucket count into a sane range', () => {
      log.record({ code: 'INTERNAL_ERROR' });
      expect(log.getSummary(0, 0).sparkline.length).toBe(1);
      expect(log.getSummary(0, 9999).sparkline.length).toBe(240);
    });

    it('returns an empty rollup when there is nothing in the window', () => {
      const summary = log.getSummary(0, 8);
      expect(summary.total).toBe(0);
      expect(summary.lastSeen).toBeNull();
      expect(summary.byClass).toEqual({});
    });
  });

  describe('stats + clear', () => {
    it('reports totals and clears', () => {
      log.record({ code: 'INTERNAL_ERROR' });
      log.record({ code: 'VALIDATION_ERROR' });
      expect(log.getStats().stats.totalEntries).toBe(2);
      log.clear();
      expect(log.getStats().stats.totalEntries).toBe(0);
      expect(log.getRecent().count).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('notifies subscribers on record and stops after unsubscribe', () => {
      const seen = [];
      const unsubscribe = log.subscribe((e) => seen.push(e));
      log.record({ code: 'MAIN_WORKTREE_CROWDED' });
      expect(seen.length).toBe(1);
      expect(seen[0].class).toBe('crowded');
      unsubscribe();
      log.record({ code: 'INTERNAL_ERROR' });
      expect(seen.length).toBe(1);
    });
  });
});
