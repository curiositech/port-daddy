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
import { harvestSession } from '../../lib/session-harvest.js';
import { createSessions } from '../../lib/sessions.js';

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

  test('listExpired returns episodes past expiresAt', () => {
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

    const expired = memory.listExpired();
    expect(expired).toHaveLength(1);
    expect(expired[0].title).toBe('Old note');
  });

  test('archiveExpired marks expired episodes without deleting them', () => {
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
  });
});

describe('harvestSession — recall→precision idempotency', () => {
  let db;
  let memory;
  let sessions;

  beforeEach(() => {
    db = createTestDb();
    memory = createEpisodicMemory(db);
    sessions = createSessions(db);
  });

  afterEach(() => {
    db.close();
  });

  function seedSession(sessionId, notes) {
    // Insert session row directly
    db.prepare(
      `INSERT OR IGNORE INTO sessions (id, agent_id, purpose, status, identity_project, created_at, updated_at)
       VALUES (?, 'agent-test', 'test purpose', 'active', 'test-project', ?, ?)`
    ).run(sessionId, Date.now(), Date.now());

    for (const { content, type } of notes) {
      db.prepare(
        `INSERT INTO session_notes (session_id, content, type, created_at) VALUES (?, ?, ?, ?)`
      ).run(sessionId, content, type, Date.now());
    }
  }

  test('promotes all session notes to episodes', async () => {
    const sessionId = 'sess-harvest-1';
    seedSession(sessionId, [
      { content: 'Finding: auth tokens need rotation', type: 'finding' },
      { content: 'Handoff: resume from token rotation PR', type: 'handoff' },
    ]);

    const result = await harvestSession(sessionId, db, { episodicMemory: memory });
    expect(result.promoted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.episodeIds).toHaveLength(2);
  });

  test('idempotent — second harvest skips already-promoted notes', async () => {
    const sessionId = 'sess-harvest-2';
    seedSession(sessionId, [
      { content: 'Design decision: use FTS5 for search', type: 'finding' },
    ]);

    const r1 = await harvestSession(sessionId, db, { episodicMemory: memory });
    expect(r1.promoted).toBe(1);

    const r2 = await harvestSession(sessionId, db, { episodicMemory: memory });
    expect(r2.promoted).toBe(0);
    expect(r2.skipped).toBe(1);

    // Only one episode in DB
    const rows = db.prepare("SELECT COUNT(*) as n FROM episodic_memory").get();
    expect(rows.n).toBe(1);
  });

  test('large note (>10KB) goes to blob store with pointer stub in episode', async () => {
    const sessionId = 'sess-harvest-blob';
    const bigContent = 'A'.repeat(12_000);
    seedSession(sessionId, [{ content: bigContent, type: 'note' }]);

    const blobWrites = [];
    const blobs = {
      async store(content, opts) {
        blobWrites.push({ content, opts });
        return { id: 'blob-test-001' };
      },
    };

    const result = await harvestSession(sessionId, db, { episodicMemory: memory, blobs });
    expect(result.promoted).toBe(1);
    expect(blobWrites).toHaveLength(1);

    // Episode summary should be pointer stub
    const ep = db.prepare('SELECT summary, blob_id FROM episodic_memory WHERE 1=1').get();
    expect(ep.summary).toContain('blob-test-001');
    expect(ep.blob_id).toBe('blob-test-001');
  });

  test('small note does not go to blob store', async () => {
    const sessionId = 'sess-harvest-small';
    seedSession(sessionId, [{ content: 'Short note content', type: 'note' }]);

    const blobWrites = [];
    const blobs = {
      async store(content, opts) {
        blobWrites.push({ content, opts });
        return { id: 'blob-should-not-be-used' };
      },
    };

    await harvestSession(sessionId, db, { episodicMemory: memory, blobs });
    expect(blobWrites).toHaveLength(0);
  });

  test('blob store failure does not fail harvest — stores inline', async () => {
    const sessionId = 'sess-harvest-blobfail';
    const bigContent = 'B'.repeat(12_000);
    seedSession(sessionId, [{ content: bigContent, type: 'note' }]);

    const blobs = {
      async store() {
        throw new Error('blob store unavailable');
      },
    };

    const result = await harvestSession(sessionId, db, { episodicMemory: memory, blobs });
    expect(result.promoted).toBe(1);
  });

  test('derives title from first line of note content', async () => {
    const sessionId = 'sess-harvest-title';
    seedSession(sessionId, [
      { content: 'Auth system uses JWT tokens\nMore detail here\nAnd more', type: 'finding' },
    ]);

    await harvestSession(sessionId, db, { episodicMemory: memory });
    const ep = db.prepare('SELECT title FROM episodic_memory WHERE 1=1').get();
    expect(ep.title).toBe('Auth system uses JWT tokens');
  });

  test('falls back to session purpose for title when first line is too long', async () => {
    const sessionId = 'sess-harvest-longtitle';
    const longFirstLine = 'X'.repeat(200);
    seedSession(sessionId, [
      { content: `${longFirstLine}\nsecond line`, type: 'note' },
    ]);
    // Update purpose
    db.prepare("UPDATE sessions SET purpose = 'my-session-purpose', updated_at = ? WHERE id = ?").run(Date.now(), sessionId);

    await harvestSession(sessionId, db, { episodicMemory: memory });
    const ep = db.prepare('SELECT title FROM episodic_memory WHERE 1=1').get();
    expect(ep.title).toContain('my-session-purpose');
  });

  test('returns empty result for session with no notes', async () => {
    const sessionId = 'sess-harvest-empty';
    db.prepare(
      `INSERT OR IGNORE INTO sessions (id, agent_id, purpose, status, created_at, updated_at)
       VALUES (?, 'agent-test', 'empty', 'active', ?, ?)`
    ).run(sessionId, Date.now(), Date.now());

    const result = await harvestSession(sessionId, db, { episodicMemory: memory });
    expect(result.episodeIds).toHaveLength(0);
    expect(result.promoted).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
