/**
 * Sessions & Notes Module
 *
 * Structured agent coordination: sessions (units of work),
 * immutable notes (timeline entries), and advisory file claims.
 * Pure SQLite-backed — no shell commands.
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { ActivityType } from './activity.js';

// Optional activity logger interface — injected after creation via setActivityLog()
interface ActivityLogger {
  log(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
}

// =============================================================================
// Types
// =============================================================================

interface SessionRow {
  id: string;
  purpose: string;
  status: string;
  agent_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  metadata: string | null;
}

interface SessionFileRow {
  session_id: string;
  file_path: string;
  claimed_at: number;
  released_at: number | null;
}

interface SessionNoteRow {
  id: number;
  session_id: string;
  content: string;
  type: string;
  created_at: number;
}

interface StartOptions {
  agentId?: string | null;
  files?: string[];
  metadata?: Record<string, unknown> | null;
}

interface EndOptions {
  note?: string;
  status?: string;
}

interface AddNoteOptions {
  type?: string;
}

interface QuickNoteOptions {
  agentId?: string | null;
  type?: string;
}

interface GetNotesOptions {
  limit?: number;
  type?: string;
  since?: number;
}

interface ListOptions {
  status?: string;
  agentId?: string | null;
  includeNotes?: boolean;
  limit?: number;
}

interface CleanupOptions {
  olderThan?: number;
  status?: string;
}

interface FileConflict {
  filePath: string;
  sessionId: string;
  purpose: string;
  claimedAt: number;
}

// =============================================================================
// Module factory
// =============================================================================

/**
 * Initialize the sessions module with a database connection
 */
export function createSessions(db: Database.Database) {
  // Ensure tables exist
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      agent_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      metadata TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id)`,

    `CREATE TABLE IF NOT EXISTS session_files (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      released_at INTEGER,
      PRIMARY KEY (session_id, file_path)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path)`,

    `CREATE TABLE IF NOT EXISTS session_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'note',
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_session_notes_session ON session_notes(session_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_session_notes_type ON session_notes(type)`,
  ];

  for (const sql of schemaStatements) {
    db.prepare(sql).run();
  }

  // Enable foreign key enforcement (needed for CASCADE)
  db.pragma('foreign_keys = ON');

  // Prepared statements
  const stmts = {
    // Sessions
    getById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    insert: db.prepare(`
      INSERT INTO sessions (id, purpose, status, agent_id, created_at, updated_at, completed_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateStatus: db.prepare(`
      UPDATE sessions SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
    `),
    deleteById: db.prepare('DELETE FROM sessions WHERE id = ?'),
    listActive: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT ?
    `),
    listByStatus: db.prepare(`
      SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC LIMIT ?
    `),
    listByAgent: db.prepare(`
      SELECT * FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?
    `),
    listByStatusAndAgent: db.prepare(`
      SELECT * FROM sessions WHERE status = ? AND agent_id = ? ORDER BY updated_at DESC LIMIT ?
    `),
    listAll: db.prepare(`
      SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?
    `),
    mostRecentActive: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1
    `),
    mostRecentActiveByAgent: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' AND agent_id = ? ORDER BY updated_at DESC LIMIT 1
    `),
    cleanupOld: db.prepare(`
      DELETE FROM sessions WHERE status = ? AND updated_at < ?
    `),
    cleanupOldAny: db.prepare(`
      DELETE FROM sessions WHERE status IN ('completed', 'abandoned') AND updated_at < ?
    `),

    // Files
    claimFile: db.prepare(`
      INSERT OR REPLACE INTO session_files (session_id, file_path, claimed_at, released_at)
      VALUES (?, ?, ?, NULL)
    `),
    releaseFile: db.prepare(`
      UPDATE session_files SET released_at = ? WHERE session_id = ? AND file_path = ? AND released_at IS NULL
    `),
    releaseAllFiles: db.prepare(`
      UPDATE session_files SET released_at = ? WHERE session_id = ? AND released_at IS NULL
    `),
    getActiveClaimsForPaths: db.prepare(`
      SELECT sf.*, s.purpose FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.file_path = ? AND sf.released_at IS NULL
    `),
    getFilesBySession: db.prepare(`
      SELECT * FROM session_files WHERE session_id = ? ORDER BY claimed_at
    `),
    getActiveFilesBySession: db.prepare(`
      SELECT * FROM session_files WHERE session_id = ? AND released_at IS NULL ORDER BY claimed_at
    `),

    // Notes
    insertNote: db.prepare(`
      INSERT INTO session_notes (session_id, content, type, created_at)
      VALUES (?, ?, ?, ?)
    `),
    getNotesBySession: db.prepare(`
      SELECT * FROM session_notes WHERE session_id = ? ORDER BY created_at ASC
    `),
    getNotesBySessionAndType: db.prepare(`
      SELECT * FROM session_notes WHERE session_id = ? AND type = ? ORDER BY created_at ASC
    `),
    getRecentNotes: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      ORDER BY sn.created_at DESC LIMIT ?
    `),
    getRecentNotesByType: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.type = ?
      ORDER BY sn.created_at DESC LIMIT ?
    `),
    getNotesSince: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.created_at >= ?
      ORDER BY sn.created_at DESC LIMIT ?
    `),
    getNotesSinceByType: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.created_at >= ? AND sn.type = ?
      ORDER BY sn.created_at DESC LIMIT ?
    `),
  };

  function safeJsonParse(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function generateSessionId(): string {
    return 'session-' + randomBytes(4).toString('hex');
  }

  function formatSession(row: SessionRow) {
    return {
      id: row.id,
      purpose: row.purpose,
      status: row.status,
      agentId: row.agent_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      metadata: safeJsonParse(row.metadata),
    };
  }

  function formatNote(row: SessionNoteRow & { session_purpose?: string }) {
    const note: Record<string, unknown> = {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      type: row.type,
      createdAt: row.created_at,
    };
    if (row.session_purpose !== undefined) {
      note.sessionPurpose = row.session_purpose;
    }
    return note;
  }

  function formatFile(row: SessionFileRow) {
    return {
      sessionId: row.session_id,
      filePath: row.file_path,
      claimedAt: row.claimed_at,
      releasedAt: row.released_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Activity logging (optional — injected via setActivityLog)
  // ---------------------------------------------------------------------------

  let activityLog: ActivityLogger | null = null;

  function setActivityLog(logger: ActivityLogger): void {
    activityLog = logger;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start a new session
   */
  function start(purpose: string, options: StartOptions = {}) {
    if (!purpose || typeof purpose !== 'string') {
      return { success: false, error: 'purpose must be a non-empty string' };
    }

    const now = Date.now();
    const id = generateSessionId();
    const {
      agentId = null,
      files = [],
      metadata = null,
    } = options;

    try {
      stmts.insert.run(
        id,
        purpose,
        'active',
        agentId,
        now,
        now,
        null,
        metadata ? JSON.stringify(metadata) : null
      );
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    // Claim files if provided
    let claimedFiles: string[] | undefined;
    let conflicts: FileConflict[] | undefined;

    if (files.length > 0) {
      const claimResult = claimFiles(id, files);
      claimedFiles = claimResult.claimed;
      if (claimResult.conflicts && claimResult.conflicts.length > 0) {
        conflicts = claimResult.conflicts;
      }
    }

    const result: Record<string, unknown> = {
      success: true,
      id,
      purpose,
      status: 'active',
    };

    if (claimedFiles !== undefined) {
      result.files = claimedFiles;
    }
    if (conflicts !== undefined) {
      result.conflicts = conflicts;
    }

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_START, {
        details: `Session started: ${purpose}`,
        metadata: { sessionId: id, purpose, agentId: agentId || undefined } as unknown as Record<string, unknown>,
      });
    }

    return result;
  }

  /**
   * End a session (set status to completed or custom)
   */
  function end(sessionId: string, options: EndOptions = {}) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    const now = Date.now();
    const { note, status = 'completed' } = options;

    // Add handoff note if provided
    if (note) {
      stmts.insertNote.run(sessionId, note, 'handoff', now);
    }

    // Release all active file claims
    const activeFiles = stmts.getActiveFilesBySession.all(sessionId) as SessionFileRow[];
    stmts.releaseAllFiles.run(now, sessionId);
    const releasedFiles = activeFiles.map(f => f.file_path);

    // Update session status
    stmts.updateStatus.run(status, now, now, sessionId);

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_END, {
        details: `Session ended: ${sessionId} (${status})`,
        metadata: { sessionId, status, releasedFiles: releasedFiles.length } as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      id: sessionId,
      status,
      releasedFiles,
    };
  }

  /**
   * Abandon a session
   */
  function abandon(sessionId: string) {
    return end(sessionId, { status: 'abandoned' });
  }

  /**
   * Remove a session entirely (CASCADE deletes notes and file claims)
   */
  function remove(sessionId: string) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    stmts.deleteById.run(sessionId);

    return { success: true };
  }

  /**
   * Add a note to a session (immutable — create only)
   */
  function addNote(sessionId: string, content: string, options: AddNoteOptions = {}) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }
    if (!content || typeof content !== 'string') {
      return { success: false, error: 'content must be a non-empty string' };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    const now = Date.now();
    const { type = 'note' } = options;

    const result = stmts.insertNote.run(sessionId, content, type, now);
    const noteId = Number(result.lastInsertRowid);

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_NOTE, {
        details: `Note added to session ${sessionId}`,
        metadata: { sessionId, noteId, type } as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      noteId,
      sessionId,
    };
  }

  /**
   * Quick note — find or create a session, add a note to it
   */
  function quickNote(content: string, options: QuickNoteOptions = {}) {
    if (!content || typeof content !== 'string') {
      return { success: false, error: 'content must be a non-empty string' };
    }

    const { agentId = null, type = 'note' } = options;

    // Find most recent active session (optionally by agent)
    let session: SessionRow | undefined;
    if (agentId) {
      session = stmts.mostRecentActiveByAgent.get(agentId) as SessionRow | undefined;
    } else {
      session = stmts.mostRecentActive.get() as SessionRow | undefined;
    }

    let sessionId: string;

    if (!session) {
      // Create an anonymous session
      const startResult = start('Quick notes', { agentId });
      if (!startResult.success) {
        return { success: false, error: 'failed to create session' };
      }
      sessionId = startResult.id as string;
    } else {
      sessionId = session.id;
    }

    const noteResult = addNote(sessionId, content, { type });
    if (!noteResult.success) {
      return noteResult;
    }

    return {
      success: true,
      noteId: noteResult.noteId,
      sessionId,
    };
  }

  /**
   * Get notes — by session, or across all sessions
   */
  function getNotes(sessionId?: string | null, options: GetNotesOptions = {}) {
    const { limit = 50, type, since } = options;

    let notes: Array<SessionNoteRow & { session_purpose?: string }>;

    if (sessionId) {
      // Get notes for specific session
      const session = stmts.getById.get(sessionId) as SessionRow | undefined;
      if (!session) {
        return { success: false, error: 'session not found' };
      }

      if (type) {
        notes = stmts.getNotesBySessionAndType.all(sessionId, type) as SessionNoteRow[];
      } else {
        notes = stmts.getNotesBySession.all(sessionId) as SessionNoteRow[];
      }

      // Apply since filter manually for session-specific queries
      if (since) {
        notes = notes.filter(n => n.created_at >= since);
      }

      // Apply limit
      if (notes.length > limit) {
        notes = notes.slice(0, limit);
      }
    } else {
      // Get recent notes across all sessions
      if (since && type) {
        notes = stmts.getNotesSinceByType.all(since, type, limit) as Array<SessionNoteRow & { session_purpose?: string }>;
      } else if (since) {
        notes = stmts.getNotesSince.all(since, limit) as Array<SessionNoteRow & { session_purpose?: string }>;
      } else if (type) {
        notes = stmts.getRecentNotesByType.all(type, limit) as Array<SessionNoteRow & { session_purpose?: string }>;
      } else {
        notes = stmts.getRecentNotes.all(limit) as Array<SessionNoteRow & { session_purpose?: string }>;
      }
    }

    return {
      success: true,
      notes: notes.map(formatNote),
      count: notes.length,
    };
  }

  /**
   * Claim files for a session (advisory — conflicts are warnings, not blockers)
   */
  function claimFiles(sessionId: string, filePaths: string[]) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: 'filePaths must be a non-empty array' };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    const now = Date.now();
    const claimed: string[] = [];
    const conflicts: FileConflict[] = [];

    for (const filePath of filePaths) {
      // Check for active claims from other sessions
      const activeClaims = stmts.getActiveClaimsForPaths.all(filePath) as Array<SessionFileRow & { purpose: string }>;
      const otherClaims = activeClaims.filter(c => c.session_id !== sessionId);

      for (const claim of otherClaims) {
        conflicts.push({
          filePath,
          sessionId: claim.session_id,
          purpose: claim.purpose,
          claimedAt: claim.claimed_at,
        });
      }

      // Claim the file regardless of conflicts (advisory model)
      stmts.claimFile.run(sessionId, filePath, now);
      claimed.push(filePath);
    }

    if (activityLog && claimed.length > 0) {
      activityLog.log(ActivityType.FILE_CLAIM, {
        details: `Claimed ${claimed.length} file(s) for session ${sessionId}`,
        metadata: { sessionId, files: claimed, conflicts: conflicts.length } as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      claimed,
      conflicts,
    };
  }

  /**
   * Release file claims for a session
   */
  function releaseFiles(sessionId: string, filePaths: string[]) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: 'filePaths must be a non-empty array' };
    }

    const now = Date.now();
    const released: string[] = [];

    for (const filePath of filePaths) {
      const result = stmts.releaseFile.run(now, sessionId, filePath);
      if (result.changes > 0) {
        released.push(filePath);
      }
    }

    if (activityLog && released.length > 0) {
      activityLog.log(ActivityType.FILE_RELEASE, {
        details: `Released ${released.length} file(s) from session ${sessionId}`,
        metadata: { sessionId, files: released } as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      released,
    };
  }

  /**
   * Get active file conflicts for given paths
   */
  function getFileConflicts(filePaths: string[]) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { conflicts: [] };
    }

    const conflicts: FileConflict[] = [];

    for (const filePath of filePaths) {
      const activeClaims = stmts.getActiveClaimsForPaths.all(filePath) as Array<SessionFileRow & { purpose: string }>;
      for (const claim of activeClaims) {
        conflicts.push({
          filePath,
          sessionId: claim.session_id,
          purpose: claim.purpose,
          claimedAt: claim.claimed_at,
        });
      }
    }

    return { conflicts };
  }

  /**
   * List sessions
   */
  function list(options: ListOptions = {}) {
    const { status, agentId, includeNotes = false, limit = 50 } = options;

    let sessions: SessionRow[];

    if (status && agentId) {
      sessions = stmts.listByStatusAndAgent.all(status, agentId, limit) as SessionRow[];
    } else if (status) {
      sessions = stmts.listByStatus.all(status, limit) as SessionRow[];
    } else if (agentId) {
      sessions = stmts.listByAgent.all(agentId, limit) as SessionRow[];
    } else {
      // No filter: return all sessions
      sessions = stmts.listAll.all(limit) as SessionRow[];
    }

    const formatted = sessions.map(s => {
      const sessionData: Record<string, unknown> = formatSession(s);
      if (includeNotes) {
        const notes = stmts.getNotesBySession.all(s.id) as SessionNoteRow[];
        sessionData.notes = notes.map(formatNote);
      }
      return sessionData;
    });

    return {
      success: true,
      sessions: formatted,
      count: formatted.length,
    };
  }

  /**
   * Get a single session with its notes and file claims
   */
  function get(sessionId: string) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    const notes = stmts.getNotesBySession.all(sessionId) as SessionNoteRow[];
    const files = stmts.getFilesBySession.all(sessionId) as SessionFileRow[];

    return {
      success: true,
      session: formatSession(session),
      notes: notes.map(formatNote),
      files: files.map(formatFile),
    };
  }

  /**
   * Cleanup old completed/abandoned sessions
   */
  function cleanup(options: CleanupOptions = {}) {
    const { olderThan = 7 * 24 * 60 * 60 * 1000, status } = options;

    const cutoff = Date.now() - olderThan;
    let result;

    if (status) {
      result = stmts.cleanupOld.run(status, cutoff);
    } else {
      result = stmts.cleanupOldAny.run(cutoff);
    }

    return { cleaned: result.changes };
  }

  return {
    start,
    end,
    abandon,
    remove,
    addNote,
    quickNote,
    getNotes,
    claimFiles,
    releaseFiles,
    getFileConflicts,
    list,
    get,
    cleanup,
    setActivityLog,
  };
}
