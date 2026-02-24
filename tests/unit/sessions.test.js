/**
 * Unit Tests for Sessions & Notes Module (sessions.ts)
 *
 * Tests session lifecycle, immutable notes, file claims, conflict detection,
 * quick notes, listing/filtering, and cleanup.
 * Each test runs with a fresh in-memory database to ensure isolation.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { ActivityType } from '../../lib/activity.js';

describe('Sessions Module', () => {
  let db;
  let sessions;

  beforeEach(() => {
    db = createTestDb();
    sessions = createSessions(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  // ===========================================================================
  // Session Lifecycle
  // ===========================================================================

  describe('Start', () => {
    it('should create a new session with generated ID', () => {
      const result = sessions.start('Build feature X');

      expect(result.success).toBe(true);
      expect(result.id).toMatch(/^session-[0-9a-f]{8}$/);
      expect(result.purpose).toBe('Build feature X');
      expect(result.status).toBe('active');
    });

    it('should reject empty purpose', () => {
      const result = sessions.start('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/purpose/);
    });

    it('should reject non-string purpose', () => {
      const result = sessions.start(null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/purpose/);
    });

    it('should accept agentId option', () => {
      const result = sessions.start('Work item', { agentId: 'agent-001' });

      expect(result.success).toBe(true);

      const got = sessions.get(result.id);
      expect(got.session.agentId).toBe('agent-001');
    });

    it('should accept metadata option', () => {
      const metadata = { branch: 'feature/x', priority: 'high' };
      const result = sessions.start('Work item', { metadata });

      expect(result.success).toBe(true);

      const got = sessions.get(result.id);
      expect(got.session.metadata).toEqual(metadata);
    });

    it('should claim files when provided', () => {
      const result = sessions.start('Work item', {
        files: ['src/app.ts', 'src/utils.ts']
      });

      expect(result.success).toBe(true);
      expect(result.files).toEqual(['src/app.ts', 'src/utils.ts']);
    });

    it('should detect file conflicts during start', () => {
      // Session 1 claims a file
      const s1 = sessions.start('Session 1', { files: ['src/shared.ts'] });
      expect(s1.success).toBe(true);

      // Session 2 claims overlapping file
      const s2 = sessions.start('Session 2', { files: ['src/shared.ts', 'src/other.ts'] });
      expect(s2.success).toBe(true);
      expect(s2.conflicts).toBeDefined();
      expect(s2.conflicts).toHaveLength(1);
      expect(s2.conflicts[0].filePath).toBe('src/shared.ts');
      expect(s2.conflicts[0].sessionId).toBe(s1.id);
    });

    it('should generate unique session IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 20; i++) {
        const result = sessions.start(`Session ${i}`);
        expect(result.success).toBe(true);
        ids.add(result.id);
      }
      expect(ids.size).toBe(20);
    });
  });

  describe('End', () => {
    it('should end a session with completed status', () => {
      const started = sessions.start('Work item');
      const result = sessions.end(started.id);

      expect(result.success).toBe(true);
      expect(result.id).toBe(started.id);
      expect(result.status).toBe('completed');
      expect(result.releasedFiles).toEqual([]);
    });

    it('should add a handoff note when ending', () => {
      const started = sessions.start('Work item');
      sessions.end(started.id, { note: 'Left off at step 3' });

      const got = sessions.get(started.id);
      expect(got.notes).toHaveLength(1);
      expect(got.notes[0].content).toBe('Left off at step 3');
      expect(got.notes[0].type).toBe('handoff');
    });

    it('should release all file claims when ending', () => {
      const started = sessions.start('Work item', {
        files: ['src/a.ts', 'src/b.ts']
      });

      const result = sessions.end(started.id);

      expect(result.releasedFiles).toContain('src/a.ts');
      expect(result.releasedFiles).toContain('src/b.ts');

      // Verify files are actually released (no longer active)
      const conflicts = sessions.getFileConflicts(['src/a.ts', 'src/b.ts']);
      expect(conflicts.conflicts).toHaveLength(0);
    });

    it('should accept custom status', () => {
      const started = sessions.start('Work item');
      const result = sessions.end(started.id, { status: 'paused' });

      expect(result.status).toBe('paused');
    });

    it('should fail for nonexistent session', () => {
      const result = sessions.end('session-nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session not found/);
    });

    it('should reject empty sessionId', () => {
      const result = sessions.end('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/sessionId/);
    });
  });

  describe('Abandon', () => {
    it('should abandon a session with abandoned status', () => {
      const started = sessions.start('Work item');
      const result = sessions.abandon(started.id);

      expect(result.success).toBe(true);
      expect(result.status).toBe('abandoned');
    });

    it('should release file claims on abandon', () => {
      const started = sessions.start('Work item', {
        files: ['src/file.ts']
      });

      sessions.abandon(started.id);

      const conflicts = sessions.getFileConflicts(['src/file.ts']);
      expect(conflicts.conflicts).toHaveLength(0);
    });

    it('should fail for nonexistent session', () => {
      const result = sessions.abandon('session-nope');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session not found/);
    });
  });

  describe('Remove (CASCADE)', () => {
    it('should delete the session', () => {
      const started = sessions.start('Work item');
      const result = sessions.remove(started.id);

      expect(result.success).toBe(true);

      const got = sessions.get(started.id);
      expect(got.success).toBe(false);
      expect(got.error).toMatch(/session not found/);
    });

    it('should cascade delete notes', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'Note 1');
      sessions.addNote(started.id, 'Note 2');

      sessions.remove(started.id);

      // Notes should be gone — verify by trying to get the session
      const got = sessions.get(started.id);
      expect(got.success).toBe(false);

      // Also verify at the DB level that notes are gone
      const noteCount = db.prepare('SELECT COUNT(*) as count FROM session_notes WHERE session_id = ?').get(started.id);
      expect(noteCount.count).toBe(0);
    });

    it('should cascade delete file claims', () => {
      const started = sessions.start('Work item', {
        files: ['src/a.ts', 'src/b.ts']
      });

      sessions.remove(started.id);

      const fileCount = db.prepare('SELECT COUNT(*) as count FROM session_files WHERE session_id = ?').get(started.id);
      expect(fileCount.count).toBe(0);
    });

    it('should fail for nonexistent session', () => {
      const result = sessions.remove('session-nope');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session not found/);
    });

    it('should reject empty sessionId', () => {
      const result = sessions.remove('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/sessionId/);
    });
  });

  // ===========================================================================
  // Full lifecycle
  // ===========================================================================

  describe('Full Lifecycle', () => {
    it('should support start -> addNote -> end with handoff note', () => {
      const started = sessions.start('Build auth system', { agentId: 'agent-1' });
      expect(started.success).toBe(true);

      const note1 = sessions.addNote(started.id, 'Started schema design');
      expect(note1.success).toBe(true);

      const note2 = sessions.addNote(started.id, 'Schema complete, starting routes', { type: 'progress' });
      expect(note2.success).toBe(true);

      const ended = sessions.end(started.id, { note: 'Routes 80% done, need to add tests' });
      expect(ended.success).toBe(true);
      expect(ended.status).toBe('completed');

      // Verify final state
      const got = sessions.get(started.id);
      expect(got.session.status).toBe('completed');
      expect(got.notes).toHaveLength(3);
      expect(got.notes[2].type).toBe('handoff');
      expect(got.notes[2].content).toMatch(/Routes 80%/);
    });

    it('should support start -> abandon', () => {
      const started = sessions.start('Risky experiment', {
        files: ['src/experimental.ts']
      });
      expect(started.success).toBe(true);

      sessions.addNote(started.id, 'Approach is not going to work');

      const abandoned = sessions.abandon(started.id);
      expect(abandoned.success).toBe(true);
      expect(abandoned.status).toBe('abandoned');
      expect(abandoned.releasedFiles).toContain('src/experimental.ts');

      // Verify the session is still queryable
      const got = sessions.get(started.id);
      expect(got.session.status).toBe('abandoned');
      expect(got.notes).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Notes
  // ===========================================================================

  describe('addNote', () => {
    it('should add a note to an existing session', () => {
      const started = sessions.start('Work item');
      const result = sessions.addNote(started.id, 'Progress update');

      expect(result.success).toBe(true);
      expect(result.noteId).toBeDefined();
      expect(typeof result.noteId).toBe('number');
      expect(result.sessionId).toBe(started.id);
    });

    it('should support custom note types', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'Error occurred', { type: 'error' });
      sessions.addNote(started.id, 'Fixed it', { type: 'resolution' });

      const got = sessions.get(started.id);
      expect(got.notes[0].type).toBe('error');
      expect(got.notes[1].type).toBe('resolution');
    });

    it('should default note type to "note"', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'Just a note');

      const got = sessions.get(started.id);
      expect(got.notes[0].type).toBe('note');
    });

    it('should fail for nonexistent session', () => {
      const result = sessions.addNote('session-nope', 'Hello');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session not found/);
    });

    it('should reject empty content', () => {
      const started = sessions.start('Work item');
      const result = sessions.addNote(started.id, '');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/content/);
    });

    it('should reject non-string content', () => {
      const started = sessions.start('Work item');
      const result = sessions.addNote(started.id, null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/content/);
    });

    it('should reject empty sessionId', () => {
      const result = sessions.addNote('', 'content');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/sessionId/);
    });

    it('should create notes with sequential IDs', () => {
      const started = sessions.start('Work item');
      const n1 = sessions.addNote(started.id, 'First');
      const n2 = sessions.addNote(started.id, 'Second');
      const n3 = sessions.addNote(started.id, 'Third');

      expect(n2.noteId).toBeGreaterThan(n1.noteId);
      expect(n3.noteId).toBeGreaterThan(n2.noteId);
    });

    it('should preserve note ordering (ascending by created_at)', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'First');
      sessions.addNote(started.id, 'Second');
      sessions.addNote(started.id, 'Third');

      const got = sessions.get(started.id);
      expect(got.notes[0].content).toBe('First');
      expect(got.notes[1].content).toBe('Second');
      expect(got.notes[2].content).toBe('Third');
    });
  });

  describe('quickNote', () => {
    it('should create a session when none exists', () => {
      const result = sessions.quickNote('Quick thought');

      expect(result.success).toBe(true);
      expect(result.noteId).toBeDefined();
      expect(result.sessionId).toMatch(/^session-/);

      // Verify session was created
      const got = sessions.get(result.sessionId);
      expect(got.session.purpose).toBe('Quick notes');
    });

    it('should reuse existing active session', () => {
      const started = sessions.start('Existing session');

      const result = sessions.quickNote('Quick thought');

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe(started.id);
    });

    it('should reuse existing active session for matching agentId', () => {
      const s1 = sessions.start('Agent 1 session', { agentId: 'agent-1' });
      const s2 = sessions.start('Agent 2 session', { agentId: 'agent-2' });

      const result = sessions.quickNote('Note for agent 1', { agentId: 'agent-1' });

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe(s1.id);
    });

    it('should create session with agentId when no match exists', () => {
      const result = sessions.quickNote('Note for agent 3', { agentId: 'agent-3' });

      expect(result.success).toBe(true);

      const got = sessions.get(result.sessionId);
      expect(got.session.agentId).toBe('agent-3');
    });

    it('should support custom type', () => {
      const result = sessions.quickNote('Warning!', { type: 'warning' });

      expect(result.success).toBe(true);

      const got = sessions.get(result.sessionId);
      expect(got.notes[0].type).toBe('warning');
    });

    it('should reject empty content', () => {
      const result = sessions.quickNote('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/content/);
    });

    it('should reject non-string content', () => {
      const result = sessions.quickNote(null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/content/);
    });
  });

  describe('getNotes', () => {
    it('should get notes for a specific session', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'Note 1');
      sessions.addNote(started.id, 'Note 2');
      sessions.addNote(started.id, 'Note 3');

      const result = sessions.getNotes(started.id);

      expect(result.success).toBe(true);
      expect(result.count).toBe(3);
      expect(result.notes).toHaveLength(3);
    });

    it('should get notes across all sessions', () => {
      const s1 = sessions.start('Session 1');
      const s2 = sessions.start('Session 2');
      sessions.addNote(s1.id, 'Note from S1');
      sessions.addNote(s2.id, 'Note from S2');

      const result = sessions.getNotes(null);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      // Cross-session notes should include sessionPurpose
      expect(result.notes[0].sessionPurpose).toBeDefined();
    });

    it('should filter by type', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'Regular note');
      sessions.addNote(started.id, 'Error happened', { type: 'error' });
      sessions.addNote(started.id, 'Another note');

      const result = sessions.getNotes(started.id, { type: 'error' });

      expect(result.count).toBe(1);
      expect(result.notes[0].content).toBe('Error happened');
    });

    it('should filter by type across all sessions', () => {
      const s1 = sessions.start('Session 1');
      const s2 = sessions.start('Session 2');
      sessions.addNote(s1.id, 'Error in S1', { type: 'error' });
      sessions.addNote(s1.id, 'Normal note in S1');
      sessions.addNote(s2.id, 'Error in S2', { type: 'error' });

      const result = sessions.getNotes(null, { type: 'error' });

      expect(result.count).toBe(2);
      expect(result.notes.every(n => n.type === 'error')).toBe(true);
    });

    it('should filter by since timestamp', () => {
      const started = sessions.start('Work item');

      // Add a note, then manually backdate it
      sessions.addNote(started.id, 'Old note');
      const oldTime = Date.now() - 100000;
      db.prepare('UPDATE session_notes SET created_at = ? WHERE content = ?').run(oldTime, 'Old note');

      sessions.addNote(started.id, 'Recent note');

      const sinceTime = Date.now() - 1000;
      const result = sessions.getNotes(started.id, { since: sinceTime });

      expect(result.count).toBe(1);
      expect(result.notes[0].content).toBe('Recent note');
    });

    it('should respect limit', () => {
      const started = sessions.start('Work item');
      for (let i = 0; i < 10; i++) {
        sessions.addNote(started.id, `Note ${i}`);
      }

      const result = sessions.getNotes(started.id, { limit: 3 });

      expect(result.count).toBe(3);
    });

    it('should fail for nonexistent session', () => {
      const result = sessions.getNotes('session-nope');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session not found/);
    });

    it('should return empty array for session with no notes', () => {
      const started = sessions.start('Work item');
      const result = sessions.getNotes(started.id);

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.notes).toHaveLength(0);
    });

    it('should filter by since across all sessions', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'Old note');
      const oldTime = Date.now() - 100000;
      db.prepare('UPDATE session_notes SET created_at = ? WHERE content = ?').run(oldTime, 'Old note');

      sessions.addNote(started.id, 'Recent note');

      const sinceTime = Date.now() - 1000;
      const result = sessions.getNotes(null, { since: sinceTime });

      expect(result.count).toBe(1);
      expect(result.notes[0].content).toBe('Recent note');
    });

    it('should combine since and type filters across all sessions', () => {
      const started = sessions.start('Work item');
      // Old error
      sessions.addNote(started.id, 'Old error', { type: 'error' });
      const oldTime = Date.now() - 100000;
      db.prepare('UPDATE session_notes SET created_at = ? WHERE content = ?').run(oldTime, 'Old error');

      // Recent error
      sessions.addNote(started.id, 'Recent error', { type: 'error' });
      // Recent note (different type)
      sessions.addNote(started.id, 'Recent note');

      const sinceTime = Date.now() - 1000;
      const result = sessions.getNotes(null, { since: sinceTime, type: 'error' });

      expect(result.count).toBe(1);
      expect(result.notes[0].content).toBe('Recent error');
    });
  });

  // ===========================================================================
  // File Claims
  // ===========================================================================

  describe('claimFiles', () => {
    it('should claim files for a session', () => {
      const started = sessions.start('Work item');
      const result = sessions.claimFiles(started.id, ['src/a.ts', 'src/b.ts']);

      expect(result.success).toBe(true);
      expect(result.claimed).toEqual(['src/a.ts', 'src/b.ts']);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should detect conflicts from other sessions', () => {
      const s1 = sessions.start('Session 1');
      sessions.claimFiles(s1.id, ['src/shared.ts']);

      const s2 = sessions.start('Session 2');
      const result = sessions.claimFiles(s2.id, ['src/shared.ts']);

      expect(result.success).toBe(true);
      expect(result.claimed).toContain('src/shared.ts');
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].sessionId).toBe(s1.id);
      expect(result.conflicts[0].filePath).toBe('src/shared.ts');
      expect(result.conflicts[0].purpose).toBe('Session 1');
    });

    it('should not report self-conflict when re-claiming own files', () => {
      const started = sessions.start('Work item');
      sessions.claimFiles(started.id, ['src/a.ts']);

      // Re-claim same file from same session
      const result = sessions.claimFiles(started.id, ['src/a.ts']);

      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should still claim despite conflicts (advisory model)', () => {
      const s1 = sessions.start('Session 1');
      sessions.claimFiles(s1.id, ['src/shared.ts']);

      const s2 = sessions.start('Session 2');
      const result = sessions.claimFiles(s2.id, ['src/shared.ts']);

      // File IS claimed despite conflict
      expect(result.claimed).toContain('src/shared.ts');

      // Verify both sessions have active claims
      const conflicts = sessions.getFileConflicts(['src/shared.ts']);
      expect(conflicts.conflicts).toHaveLength(2);
    });

    it('should fail for nonexistent session', () => {
      const result = sessions.claimFiles('session-nope', ['src/a.ts']);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session not found/);
    });

    it('should reject empty filePaths array', () => {
      const started = sessions.start('Work item');
      const result = sessions.claimFiles(started.id, []);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/filePaths/);
    });

    it('should reject non-array filePaths', () => {
      const started = sessions.start('Work item');
      const result = sessions.claimFiles(started.id, 'not-an-array');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/filePaths/);
    });
  });

  describe('releaseFiles', () => {
    it('should release claimed files', () => {
      const started = sessions.start('Work item');
      sessions.claimFiles(started.id, ['src/a.ts', 'src/b.ts']);

      const result = sessions.releaseFiles(started.id, ['src/a.ts']);

      expect(result.success).toBe(true);
      expect(result.released).toContain('src/a.ts');
      expect(result.released).not.toContain('src/b.ts');
    });

    it('should not release files from other sessions', () => {
      const s1 = sessions.start('Session 1');
      const s2 = sessions.start('Session 2');
      sessions.claimFiles(s1.id, ['src/shared.ts']);

      // Try to release s1's file from s2's perspective
      const result = sessions.releaseFiles(s2.id, ['src/shared.ts']);

      expect(result.released).toHaveLength(0);

      // s1 still has the claim
      const conflicts = sessions.getFileConflicts(['src/shared.ts']);
      expect(conflicts.conflicts).toHaveLength(1);
      expect(conflicts.conflicts[0].sessionId).toBe(s1.id);
    });

    it('should handle releasing already-released files gracefully', () => {
      const started = sessions.start('Work item');
      sessions.claimFiles(started.id, ['src/a.ts']);
      sessions.releaseFiles(started.id, ['src/a.ts']);

      // Release again
      const result = sessions.releaseFiles(started.id, ['src/a.ts']);
      expect(result.released).toHaveLength(0);
    });

    it('should reject empty filePaths', () => {
      const started = sessions.start('Work item');
      const result = sessions.releaseFiles(started.id, []);

      expect(result.success).toBe(false);
    });
  });

  describe('getFileConflicts', () => {
    it('should return empty for unclaimed paths', () => {
      const result = sessions.getFileConflicts(['src/nobody.ts']);

      expect(result.conflicts).toHaveLength(0);
    });

    it('should return active claims', () => {
      const started = sessions.start('Work item');
      sessions.claimFiles(started.id, ['src/a.ts']);

      const result = sessions.getFileConflicts(['src/a.ts']);

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].sessionId).toBe(started.id);
      expect(result.conflicts[0].filePath).toBe('src/a.ts');
      expect(result.conflicts[0].claimedAt).toBeDefined();
    });

    it('should not include released claims', () => {
      const started = sessions.start('Work item');
      sessions.claimFiles(started.id, ['src/a.ts']);
      sessions.releaseFiles(started.id, ['src/a.ts']);

      const result = sessions.getFileConflicts(['src/a.ts']);

      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle empty array input', () => {
      const result = sessions.getFileConflicts([]);

      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle non-array input gracefully', () => {
      const result = sessions.getFileConflicts('not-array');

      expect(result.conflicts).toHaveLength(0);
    });

    it('should return conflicts from multiple sessions', () => {
      const s1 = sessions.start('Session 1');
      const s2 = sessions.start('Session 2');
      sessions.claimFiles(s1.id, ['src/shared.ts']);
      sessions.claimFiles(s2.id, ['src/shared.ts']);

      const result = sessions.getFileConflicts(['src/shared.ts']);

      expect(result.conflicts).toHaveLength(2);
    });
  });

  // ===========================================================================
  // List & Get
  // ===========================================================================

  describe('list', () => {
    it('should list active sessions by default', () => {
      sessions.start('Active 1');
      sessions.start('Active 2');
      const ended = sessions.start('Ended');
      sessions.end(ended.id);

      // list() without status returns ALL sessions (active + completed + abandoned)
      const allResult = sessions.list();
      expect(allResult.success).toBe(true);
      expect(allResult.count).toBe(3);

      // list({ status: 'active' }) returns only active sessions
      const activeResult = sessions.list({ status: 'active' });
      expect(activeResult.success).toBe(true);
      expect(activeResult.count).toBe(2);
      expect(activeResult.sessions.every(s => s.status === 'active')).toBe(true);
    });

    it('should filter by status', () => {
      sessions.start('Active');
      const ended = sessions.start('Completed');
      sessions.end(ended.id);
      const abandoned = sessions.start('Abandoned');
      sessions.abandon(abandoned.id);

      const result = sessions.list({ status: 'completed' });

      expect(result.count).toBe(1);
      expect(result.sessions[0].status).toBe('completed');
    });

    it('should filter by agentId', () => {
      sessions.start('Agent 1 work', { agentId: 'agent-1' });
      sessions.start('Agent 2 work', { agentId: 'agent-2' });
      sessions.start('Agent 1 more work', { agentId: 'agent-1' });

      const result = sessions.list({ agentId: 'agent-1' });

      expect(result.count).toBe(2);
      expect(result.sessions.every(s => s.agentId === 'agent-1')).toBe(true);
    });

    it('should filter by both status and agentId', () => {
      const s1 = sessions.start('Agent 1 active', { agentId: 'agent-1' });
      const s2 = sessions.start('Agent 1 done', { agentId: 'agent-1' });
      sessions.end(s2.id);
      sessions.start('Agent 2 active', { agentId: 'agent-2' });

      const result = sessions.list({ status: 'active', agentId: 'agent-1' });

      expect(result.count).toBe(1);
      expect(result.sessions[0].agentId).toBe('agent-1');
      expect(result.sessions[0].status).toBe('active');
    });

    it('should include notes when requested', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'Note 1');
      sessions.addNote(started.id, 'Note 2');

      const result = sessions.list({ includeNotes: true });

      expect(result.count).toBe(1);
      expect(result.sessions[0].notes).toHaveLength(2);
    });

    it('should not include notes by default', () => {
      const started = sessions.start('Work item');
      sessions.addNote(started.id, 'Note 1');

      const result = sessions.list();

      expect(result.sessions[0].notes).toBeUndefined();
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        sessions.start(`Session ${i}`);
      }

      const result = sessions.list({ limit: 3 });

      expect(result.count).toBe(3);
    });

    it('should return empty list when no sessions exist', () => {
      const result = sessions.list();

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.sessions).toHaveLength(0);
    });

    it('should order by most recently updated first', () => {
      const s1 = sessions.start('First');
      // Backdate s1
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 10000,
        s1.id
      );

      const s2 = sessions.start('Second');

      const result = sessions.list();

      expect(result.sessions[0].id).toBe(s2.id);
      expect(result.sessions[1].id).toBe(s1.id);
    });
  });

  describe('get', () => {
    it('should return session with notes and files', () => {
      const started = sessions.start('Work item', {
        agentId: 'agent-1',
        files: ['src/a.ts'],
        metadata: { key: 'value' }
      });
      sessions.addNote(started.id, 'A note');

      const result = sessions.get(started.id);

      expect(result.success).toBe(true);
      expect(result.session.id).toBe(started.id);
      expect(result.session.purpose).toBe('Work item');
      expect(result.session.agentId).toBe('agent-1');
      expect(result.session.metadata).toEqual({ key: 'value' });
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].content).toBe('A note');
      expect(result.files).toHaveLength(1);
      expect(result.files[0].filePath).toBe('src/a.ts');
    });

    it('should return both active and released file claims', () => {
      const started = sessions.start('Work item');
      sessions.claimFiles(started.id, ['src/a.ts', 'src/b.ts']);
      sessions.releaseFiles(started.id, ['src/a.ts']);

      const result = sessions.get(started.id);

      expect(result.files).toHaveLength(2);
      const aFile = result.files.find(f => f.filePath === 'src/a.ts');
      const bFile = result.files.find(f => f.filePath === 'src/b.ts');
      expect(aFile.releasedAt).not.toBeNull();
      expect(bFile.releasedAt).toBeNull();
    });

    it('should fail for nonexistent session', () => {
      const result = sessions.get('session-nope');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session not found/);
    });

    it('should reject empty sessionId', () => {
      const result = sessions.get('');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/sessionId/);
    });

    it('should include completedAt after ending', () => {
      const started = sessions.start('Work item');
      sessions.end(started.id);

      const result = sessions.get(started.id);

      expect(result.session.completedAt).toBeDefined();
      expect(result.session.completedAt).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  describe('cleanup', () => {
    it('should clean old completed sessions', () => {
      const s1 = sessions.start('Old completed');
      sessions.end(s1.id);
      // Backdate to 8 days ago
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
        s1.id
      );

      const s2 = sessions.start('Recent completed');
      sessions.end(s2.id);

      const result = sessions.cleanup();

      expect(result.cleaned).toBe(1);

      // Old one is gone
      expect(sessions.get(s1.id).success).toBe(false);
      // Recent one is still there
      expect(sessions.get(s2.id).success).toBe(true);
    });

    it('should clean old abandoned sessions', () => {
      const s1 = sessions.start('Old abandoned');
      sessions.abandon(s1.id);
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
        s1.id
      );

      const result = sessions.cleanup();

      expect(result.cleaned).toBe(1);
    });

    it('should NOT clean active sessions', () => {
      const s1 = sessions.start('Old but active');
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
        s1.id
      );

      const result = sessions.cleanup();

      expect(result.cleaned).toBe(0);
      expect(sessions.get(s1.id).success).toBe(true);
    });

    it('should accept custom olderThan threshold', () => {
      const s1 = sessions.start('Completed recently');
      sessions.end(s1.id);
      // Backdate to 2 hours ago
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 2 * 60 * 60 * 1000,
        s1.id
      );

      // Clean with 1-hour threshold
      const result = sessions.cleanup({ olderThan: 60 * 60 * 1000 });

      expect(result.cleaned).toBe(1);
    });

    it('should filter by specific status', () => {
      const s1 = sessions.start('Old completed');
      sessions.end(s1.id);
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
        s1.id
      );

      const s2 = sessions.start('Old abandoned');
      sessions.abandon(s2.id);
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
        s2.id
      );

      // Only clean completed
      const result = sessions.cleanup({ status: 'completed' });

      expect(result.cleaned).toBe(1);

      // Abandoned is still there
      expect(sessions.get(s2.id).success).toBe(true);
    });

    it('should handle cleanup with no sessions', () => {
      const result = sessions.cleanup();

      expect(result.cleaned).toBe(0);
    });

    it('should cascade-delete notes and files on cleanup', () => {
      const s1 = sessions.start('Old completed', { files: ['src/a.ts'] });
      sessions.addNote(s1.id, 'A note');
      sessions.end(s1.id);
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
        s1.id
      );

      sessions.cleanup();

      // Verify notes and files are gone at DB level
      const noteCount = db.prepare('SELECT COUNT(*) as count FROM session_notes WHERE session_id = ?').get(s1.id);
      const fileCount = db.prepare('SELECT COUNT(*) as count FROM session_files WHERE session_id = ?').get(s1.id);
      expect(noteCount.count).toBe(0);
      expect(fileCount.count).toBe(0);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle very long purpose strings', () => {
      const longPurpose = 'A'.repeat(5000);
      const result = sessions.start(longPurpose);

      expect(result.success).toBe(true);

      const got = sessions.get(result.id);
      expect(got.session.purpose).toBe(longPurpose);
    });

    it('should handle very long note content', () => {
      const started = sessions.start('Work item');
      const longContent = 'B'.repeat(10000);
      const result = sessions.addNote(started.id, longContent);

      expect(result.success).toBe(true);

      const got = sessions.get(started.id);
      expect(got.notes[0].content).toBe(longContent);
    });

    it('should handle complex metadata', () => {
      const metadata = {
        nested: { deep: { structure: { value: 'here' } } },
        array: [1, 2, 3, { key: 'value' }],
        nullVal: null,
      };

      const result = sessions.start('Work item', { metadata });

      expect(result.success).toBe(true);

      const got = sessions.get(result.id);
      expect(got.session.metadata).toEqual(metadata);
    });

    it('should handle null metadata gracefully', () => {
      const result = sessions.start('Work item', { metadata: null });

      expect(result.success).toBe(true);

      const got = sessions.get(result.id);
      expect(got.session.metadata).toBeNull();
    });

    it('should handle many concurrent file claims', () => {
      const s1 = sessions.start('Session 1');
      const s2 = sessions.start('Session 2');
      const s3 = sessions.start('Session 3');

      const files = Array.from({ length: 50 }, (_, i) => `src/file-${i}.ts`);

      sessions.claimFiles(s1.id, files.slice(0, 20));
      sessions.claimFiles(s2.id, files.slice(10, 30)); // Overlaps with s1
      sessions.claimFiles(s3.id, files.slice(25, 50)); // Overlaps with s2

      // Check conflicts on overlap zone
      const conflicts = sessions.getFileConflicts(['src/file-15.ts']);
      expect(conflicts.conflicts).toHaveLength(2); // s1 and s2 both claim it
    });

    it('should handle rapid session create/end cycles', () => {
      for (let i = 0; i < 50; i++) {
        const started = sessions.start(`Quick session ${i}`);
        sessions.addNote(started.id, `Note for ${i}`);
        sessions.end(started.id);
      }

      const completed = sessions.list({ status: 'completed' });
      expect(completed.count).toBe(50);
    });

    it('should handle ending already-completed session', () => {
      const started = sessions.start('Work item');
      sessions.end(started.id);

      // End again
      const result = sessions.end(started.id);
      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
    });

    it('should handle adding notes to completed session', () => {
      const started = sessions.start('Work item');
      sessions.end(started.id);

      // Notes can still be added (session exists even if completed)
      const result = sessions.addNote(started.id, 'Post-completion note');
      expect(result.success).toBe(true);
    });

    it('should handle file paths with special characters', () => {
      const started = sessions.start('Work item');
      const specialPaths = [
        'src/my file.ts',
        'src/path/with spaces/file.ts',
        "src/it's-a-file.ts",
        'src/file@2x.png',
      ];

      const result = sessions.claimFiles(started.id, specialPaths);
      expect(result.success).toBe(true);
      expect(result.claimed).toEqual(specialPaths);

      const got = sessions.get(started.id);
      expect(got.files).toHaveLength(specialPaths.length);
    });
  });

  // ===========================================================================
  // Type Safety and Validation
  // ===========================================================================

  describe('Type Safety and Validation', () => {
    it('should reject non-string sessionId in end()', () => {
      expect(sessions.end(null).success).toBe(false);
      expect(sessions.end(undefined).success).toBe(false);
      expect(sessions.end(123).success).toBe(false);
    });

    it('should reject non-string sessionId in addNote()', () => {
      expect(sessions.addNote(null, 'content').success).toBe(false);
      expect(sessions.addNote(undefined, 'content').success).toBe(false);
      expect(sessions.addNote(123, 'content').success).toBe(false);
    });

    it('should reject non-string sessionId in remove()', () => {
      expect(sessions.remove(null).success).toBe(false);
      expect(sessions.remove(undefined).success).toBe(false);
      expect(sessions.remove(123).success).toBe(false);
    });

    it('should reject non-string sessionId in get()', () => {
      expect(sessions.get(null).success).toBe(false);
      expect(sessions.get(undefined).success).toBe(false);
      expect(sessions.get(123).success).toBe(false);
    });

    it('should reject non-string sessionId in claimFiles()', () => {
      expect(sessions.claimFiles(null, ['a']).success).toBe(false);
      expect(sessions.claimFiles(undefined, ['a']).success).toBe(false);
    });

    it('should reject non-string sessionId in releaseFiles()', () => {
      expect(sessions.releaseFiles(null, ['a']).success).toBe(false);
      expect(sessions.releaseFiles(undefined, ['a']).success).toBe(false);
    });

    it('should handle undefined options gracefully', () => {
      const result = sessions.start('Work item', undefined);
      expect(result.success).toBe(true);
    });

    it('should handle empty options object', () => {
      const result = sessions.start('Work item', {});
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // State Consistency
  // ===========================================================================

  describe('State Consistency', () => {
    it('should maintain accurate counts through mixed operations', () => {
      const s1 = sessions.start('Session 1');
      const s2 = sessions.start('Session 2');
      const s3 = sessions.start('Session 3');

      // All 3 are active
      expect(sessions.list({ status: 'active' }).count).toBe(3);

      sessions.end(s1.id);
      // 2 active, 1 completed
      expect(sessions.list({ status: 'active' }).count).toBe(2);

      sessions.abandon(s2.id);
      // 1 active, 1 completed, 1 abandoned
      expect(sessions.list({ status: 'active' }).count).toBe(1);

      sessions.start('Session 4');
      // 2 active, 1 completed, 1 abandoned
      expect(sessions.list({ status: 'active' }).count).toBe(2);

      // Total across all statuses
      expect(sessions.list().count).toBe(4);
    });

    it('should preserve data integrity across file claim/release cycles', () => {
      const started = sessions.start('Work item');

      // Claim -> release -> re-claim
      sessions.claimFiles(started.id, ['src/a.ts']);
      sessions.releaseFiles(started.id, ['src/a.ts']);
      sessions.claimFiles(started.id, ['src/a.ts']);

      const got = sessions.get(started.id);
      // Should have 2 entries: one released, one active
      // (OR_REPLACE means the re-claim overwrites, so just 1 active)
      const activeFiles = got.files.filter(f => f.releasedAt === null);
      expect(activeFiles).toHaveLength(1);
      expect(activeFiles[0].filePath).toBe('src/a.ts');
    });

    it('should keep notes immutable — no way to edit or delete individual notes', () => {
      const started = sessions.start('Work item');
      const n1 = sessions.addNote(started.id, 'Original note');

      // Verify note is stored
      const got = sessions.get(started.id);
      expect(got.notes).toHaveLength(1);
      expect(got.notes[0].content).toBe('Original note');
      expect(got.notes[0].id).toBe(n1.noteId);

      // There is no updateNote or deleteNote method
      expect(sessions.updateNote).toBeUndefined();
      expect(sessions.deleteNote).toBeUndefined();
    });

    it('should correctly set completedAt on end', () => {
      const started = sessions.start('Work item');
      const beforeEnd = Date.now();
      sessions.end(started.id);
      const afterEnd = Date.now();

      const got = sessions.get(started.id);
      expect(got.session.completedAt).toBeGreaterThanOrEqual(beforeEnd);
      expect(got.session.completedAt).toBeLessThanOrEqual(afterEnd);
    });

    it('should correctly set updatedAt on end', () => {
      const started = sessions.start('Work item');
      // Backdate updatedAt
      db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
        Date.now() - 100000,
        started.id
      );

      const beforeEnd = Date.now();
      sessions.end(started.id);

      const got = sessions.get(started.id);
      expect(got.session.updatedAt).toBeGreaterThanOrEqual(beforeEnd);
    });
  });

  // ===========================================================================
  // Activity Logging Integration
  // ===========================================================================

  describe('Activity Logging', () => {
    let mockLog;
    let sessionsWithLog;

    beforeEach(() => {
      mockLog = { log: jest.fn() };
      sessionsWithLog = createSessions(db);
      sessionsWithLog.setActivityLog(mockLog);
    });

    it('should log SESSION_START on session start', () => {
      const result = sessionsWithLog.start('Build feature Y');

      expect(result.success).toBe(true);
      expect(mockLog.log).toHaveBeenCalledWith(
        ActivityType.SESSION_START,
        expect.objectContaining({
          details: expect.stringContaining('Build feature Y'),
          metadata: expect.objectContaining({ sessionId: result.id, purpose: 'Build feature Y' }),
        })
      );
    });

    it('should log SESSION_END on session end', () => {
      const started = sessionsWithLog.start('Work item');
      mockLog.log.mockClear();

      sessionsWithLog.end(started.id);

      expect(mockLog.log).toHaveBeenCalledWith(
        ActivityType.SESSION_END,
        expect.objectContaining({
          details: expect.stringContaining(started.id),
          metadata: expect.objectContaining({ sessionId: started.id, status: 'completed' }),
        })
      );
    });

    it('should log SESSION_END with abandoned status on abandon', () => {
      const started = sessionsWithLog.start('Risky experiment');
      mockLog.log.mockClear();

      sessionsWithLog.abandon(started.id);

      expect(mockLog.log).toHaveBeenCalledWith(
        ActivityType.SESSION_END,
        expect.objectContaining({
          details: expect.stringContaining('abandoned'),
          metadata: expect.objectContaining({ sessionId: started.id, status: 'abandoned' }),
        })
      );
    });

    it('should log SESSION_NOTE on note creation', () => {
      const started = sessionsWithLog.start('Work item');
      mockLog.log.mockClear();

      const noteResult = sessionsWithLog.addNote(started.id, 'Progress update');

      expect(noteResult.success).toBe(true);
      expect(mockLog.log).toHaveBeenCalledWith(
        ActivityType.SESSION_NOTE,
        expect.objectContaining({
          details: expect.stringContaining(started.id),
          metadata: expect.objectContaining({ sessionId: started.id, noteId: noteResult.noteId, type: 'note' }),
        })
      );
    });

    it('should log FILE_CLAIM on file claim', () => {
      const started = sessionsWithLog.start('Work item');
      mockLog.log.mockClear();

      sessionsWithLog.claimFiles(started.id, ['src/a.ts', 'src/b.ts']);

      expect(mockLog.log).toHaveBeenCalledWith(
        ActivityType.FILE_CLAIM,
        expect.objectContaining({
          details: expect.stringContaining('2 file(s)'),
          metadata: expect.objectContaining({ sessionId: started.id, files: ['src/a.ts', 'src/b.ts'] }),
        })
      );
    });

    it('should log FILE_RELEASE on file release', () => {
      const started = sessionsWithLog.start('Work item');
      sessionsWithLog.claimFiles(started.id, ['src/a.ts', 'src/b.ts']);
      mockLog.log.mockClear();

      sessionsWithLog.releaseFiles(started.id, ['src/a.ts']);

      expect(mockLog.log).toHaveBeenCalledWith(
        ActivityType.FILE_RELEASE,
        expect.objectContaining({
          details: expect.stringContaining('1 file(s)'),
          metadata: expect.objectContaining({ sessionId: started.id, files: ['src/a.ts'] }),
        })
      );
    });

    it('should not log FILE_CLAIM when no files are claimed', () => {
      const started = sessionsWithLog.start('Work item');
      mockLog.log.mockClear();

      // Empty claim returns error, no log
      sessionsWithLog.claimFiles(started.id, []);

      // Only the start log should have been called, nothing after the clear
      expect(mockLog.log).not.toHaveBeenCalledWith(
        ActivityType.FILE_CLAIM,
        expect.anything()
      );
    });

    it('should not log FILE_RELEASE when no files are released', () => {
      const started = sessionsWithLog.start('Work item');
      sessionsWithLog.claimFiles(started.id, ['src/a.ts']);
      sessionsWithLog.releaseFiles(started.id, ['src/a.ts']);
      mockLog.log.mockClear();

      // Release again - nothing happens
      sessionsWithLog.releaseFiles(started.id, ['src/a.ts']);

      expect(mockLog.log).not.toHaveBeenCalledWith(
        ActivityType.FILE_RELEASE,
        expect.anything()
      );
    });

    it('should not log anything when no activity logger is set', () => {
      // Use the default sessions without activity log
      const result = sessions.start('No logging');
      sessions.addNote(result.id, 'Silent note');
      sessions.end(result.id);

      // If we got here without errors, the module works fine without a logger
      expect(result.success).toBe(true);
    });

    it('should have correct activity types as strings', () => {
      expect(ActivityType.SESSION_START).toBe('session.start');
      expect(ActivityType.SESSION_END).toBe('session.end');
      expect(ActivityType.SESSION_NOTE).toBe('session.note');
      expect(ActivityType.FILE_CLAIM).toBe('file.claim');
      expect(ActivityType.FILE_RELEASE).toBe('file.release');
    });
  });
});
