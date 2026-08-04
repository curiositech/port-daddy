/**
 * Phase 2 episodic memory tests — new types, TTLs, expiresAt, blob linkage, harvest idempotency.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import {
  createEpisodicMemory,
  EPISODE_TYPES,
  EPISODE_TTLS,
  episodeExpiresAt,
  NOTE_TYPE_TO_EPISODE,
} from '../../lib/episodic-memory.js';

const DAY = 86_400_000;

describe('Phase 2 episode types and TTLs', () => {
  test('EPISODE_TYPES includes all new types', () => {
    const expected = ['idea', 'prototype', 'plan', 'want', 'worry', 'syllogism'];
    for (const t of expected) {
      expect(EPISODE_TYPES).toContain(t);
    }
  });

  test('permanent types return null expiresAt', () => {
    for (const t of ['finding', 'design', 'syllogism']) {
      expect(episodeExpiresAt(t)).toBeNull();
    }
  });

  test('expiring types return ISO string in the future', () => {
    const now = Date.now();
    for (const t of ['idea', 'prototype', 'plan', 'want', 'worry', 'handoff', 'note']) {
      const val = episodeExpiresAt(t);
      expect(typeof val).toBe('string');
      expect(new Date(val).getTime()).toBeGreaterThan(now + DAY);
    }
  });

  test('EPISODE_TTLS entries match episodeExpiresAt output', () => {
    const t = 'plan';
    const expiresAt = episodeExpiresAt(t);
    const expectedMs = EPISODE_TTLS[t];
    const diff = new Date(expiresAt).getTime() - Date.now();
    // within 5 seconds of expected TTL
    expect(Math.abs(diff - expectedMs)).toBeLessThan(5000);
  });

  test('NOTE_TYPE_TO_EPISODE maps all core note types', () => {
    for (const [, episodeType] of Object.entries(NOTE_TYPE_TO_EPISODE)) {
      expect(EPISODE_TYPES).toContain(episodeType);
    }
  });

  test('UNKNOWN types default to 30d expiry — unknown → forgettable, never → permanent', () => {
    // Sortie writers use types like blocked/completed/failed that are not in
    // EPISODE_TTLS. The old null default made them immortal.
    for (const t of ['blocked', 'completed', 'failed', 'some-future-type']) {
      const val = episodeExpiresAt(t);
      expect(typeof val).toBe('string');
      const diff = new Date(val).getTime() - Date.now();
      expect(Math.abs(diff - 30 * DAY)).toBeLessThan(5000);
    }
  });
});

describe('Phase 2 remember() — new columns', () => {
  let db;
  let memory;

  beforeEach(() => {
    db = createTestDb();
    memory = createEpisodicMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  test('remember stores worktreeId, branchName, expiresAt, blobId', () => {
    const ep = memory.remember({
      episodeType: 'plan',
      title: 'Test plan episode',
      summary: 'This is a plan.',
      sourceType: 'note',
      sourceId: 'note-42',
      worktreeId: 'wt-abc',
      branchName: 'feat/test',
      blobId: 'blob-xyz',
    });

    const row = db.prepare('SELECT * FROM episodic_memory WHERE id = ?').get(ep.id);
    expect(row.worktree_id).toBe('wt-abc');
    expect(row.branch_name).toBe('feat/test');
    expect(row.blob_id).toBe('blob-xyz');
    expect(row.expires_at).not.toBeNull();
  });

  test('remember auto-computes expiresAt from episode type (permanent type = null)', () => {
    const ep = memory.remember({
      episodeType: 'design',
      title: 'Design decision',
      summary: 'Permanent design note.',
      sourceType: 'note',
      sourceId: 'note-99',
    });
    const row = db.prepare('SELECT expires_at FROM episodic_memory WHERE id = ?').get(ep.id);
    expect(row.expires_at).toBeNull();
  });

  test('caller-supplied expiresAt overrides auto-computed', () => {
    const custom = new Date(Date.now() + 1000 * 60).toISOString();
    const ep = memory.remember({
      episodeType: 'plan',
      title: 'Short-lived plan',
      summary: 'Expires soon.',
      sourceType: 'note',
      sourceId: 'note-88',
      expiresAt: custom,
    });
    const row = db.prepare('SELECT expires_at FROM episodic_memory WHERE id = ?').get(ep.id);
    expect(row.expires_at).toBe(custom);
  });

  test('list() never serves expired episodes — TTL is read-enforced (P3)', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    memory.remember({
      episodeType: 'note',
      title: 'Old note',
      summary: 'Should be expired.',
      sourceType: 'note',
      sourceId: 'note-exp-1',
      expiresAt: past,
    });
    memory.remember({
      episodeType: 'design',
      title: 'Permanent design',
      summary: 'Not expired.',
      sourceType: 'note',
      sourceId: 'note-perm-1',
    });

    const listed = memory.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe('Permanent design');
    // The expired row still exists in the table — hidden, not deleted.
    const all = db.prepare('SELECT COUNT(*) as n FROM episodic_memory').get();
    expect(all.n).toBe(2);
  });

  test('archiveExpired marks expired episodes without deleting them, and is idempotent (P3)', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    memory.remember({
      episodeType: 'handoff',
      title: 'Old handoff',
      summary: 'Past TTL.',
      sourceType: 'note',
      sourceId: 'note-archive-1',
      expiresAt: past,
    });

    const count = memory.archiveExpired();
    expect(count).toBe(1);
    // Still in DB
    const all = db.prepare('SELECT COUNT(*) as n FROM episodic_memory').get();
    expect(all.n).toBe(1);
    // Marked archived
    const row = db.prepare('SELECT metadata FROM episodic_memory WHERE 1=1').get();
    const meta = JSON.parse(row.metadata || '{}');
    expect(meta.archived).toBe(1);

    // Second run must NOT re-mark the same rows (the old TTL theater: every
    // 6h duty reported phantom `changes` forever).
    expect(memory.archiveExpired()).toBe(0);
  });
});

// harvestSession tests moved to tests/unit/session-harvest.test.ts — the
// harvest now persists harbor MemoryEpisodes via persistEpisode (ADR-0097
// engine), not legacy episodic_memory rows.
