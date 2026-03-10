/**
 * Sessions & Notes Module
 *
 * Structured agent coordination: sessions (units of work),
 * immutable notes (timeline entries), and advisory file claims.
 * Pure SQLite-backed — no shell commands.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { ActivityType } from './activity.js';
import { getWorktreeId } from './worktree.js';

const MAX_NOTES_PER_SESSION = 500;

// Optional activity logger interface — injected after creation via setActivityLog()
interface ActivityLogger {
  log(type: string, opts: { details: string; metadata: Record<string, unknown> }): void;
}

// =============================================================================
// Types
// =============================================================================

// Valid session phases — more granular than status
const VALID_PHASES = ['planning', 'in_progress', 'testing', 'reviewing', 'completed', 'abandoned'] as const;
type SessionPhase = typeof VALID_PHASES[number];

interface SessionRow {
  id: string;
  purpose: string;
  status: string;
  phase: string | null;
  agent_id: string | null;
  worktree_id: string | null;
  identity_project: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  metadata: string | null;
}

interface SessionFileRow {
  id: number;
  session_id: string;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  symbol: string | null;
  claimed_at: number;
  released_at: number | null;
}

interface FileRegion {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
}

interface ClaimFilesOptions {
  regions?: FileRegion[];
  force?: boolean;
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
  worktreeId?: string | null;
  project?: string | null;
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
  worktreeId?: string | null;
  allWorktrees?: boolean;
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
  startLine?: number | null;
  endLine?: number | null;
  symbol?: string | null;
}

// =============================================================================
// Module factory
// =============================================================================

/**
 * Initialize the sessions module with a database connection
 */
export function createSessions(db: Database.Database) {
  // Ensure tables exist (base schema without worktree_id for migration compatibility)
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      phase TEXT DEFAULT 'in_progress',
      agent_id TEXT,
      worktree_id TEXT,
      identity_project TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      metadata TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id)`,
    // Composite index for the common "list active sessions ordered by recency" query
    `CREATE INDEX IF NOT EXISTS idx_sessions_status_updated ON sessions(status, updated_at DESC)`,
    // NOTE: idx_sessions_worktree created after migration below

    `CREATE TABLE IF NOT EXISTS session_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      symbol TEXT,
      claimed_at INTEGER NOT NULL,
      released_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path)`,
    // NOTE: idx_session_files_session and idx_session_files_region created after migration below

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

  // Migration: add worktree_id column to existing databases that don't have it
  try {
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const hasWorktreeId = columns.some(c => c.name === 'worktree_id');
    if (!hasWorktreeId) {
      db.prepare("ALTER TABLE sessions ADD COLUMN worktree_id TEXT").run();
    }
    // Migration: add phase column
    const hasPhase = columns.some(c => c.name === 'phase');
    if (!hasPhase) {
      db.prepare("ALTER TABLE sessions ADD COLUMN phase TEXT DEFAULT 'in_progress'").run();
    }
    // Migration: add identity_project column for project-scoped queries
    const hasIdentityProject = columns.some(c => c.name === 'identity_project');
    if (!hasIdentityProject) {
      db.prepare("ALTER TABLE sessions ADD COLUMN identity_project TEXT").run();
    }
  } catch {
    // Column already exists or table doesn't exist yet
  }

  // Create indexes after migration ensures columns exist
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_worktree ON sessions(worktree_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_identity_project ON sessions(identity_project)`).run();

  // Migration: add region columns to session_files (start_line, end_line, symbol, id PK)
  try {
    const fileColumns = db.prepare("PRAGMA table_info(session_files)").all() as Array<{ name: string; pk: number }>;
    const hasStartLine = fileColumns.some(c => c.name === 'start_line');
    if (!hasStartLine) {
      // Old schema uses composite PK (session_id, file_path) — need to recreate table
      db.prepare(`CREATE TABLE IF NOT EXISTS session_files_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        symbol TEXT,
        claimed_at INTEGER NOT NULL,
        released_at INTEGER
      )`).run();
      db.prepare(`INSERT INTO session_files_new (session_id, file_path, claimed_at, released_at)
        SELECT session_id, file_path, claimed_at, released_at FROM session_files`).run();
      db.prepare(`DROP TABLE session_files`).run();
      db.prepare(`ALTER TABLE session_files_new RENAME TO session_files`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_region ON session_files(file_path, start_line, end_line)`).run();
    }
  } catch {
    // Table might not exist yet (fresh install) — that's fine, schema statements above handle it
  }

  // Create region indexes after migration ensures columns exist
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_region ON session_files(file_path, start_line, end_line)`).run();

  // Enable foreign key enforcement (needed for CASCADE)
  db.pragma('foreign_keys = ON');

  // Prepared statements
  const stmts = {
    // Sessions
    getById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    insert: db.prepare(`
      INSERT INTO sessions (id, purpose, status, agent_id, worktree_id, identity_project, created_at, updated_at, completed_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateStatus: db.prepare(`
      UPDATE sessions SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
    `),
    abandonActiveByAgent: db.prepare(`
      UPDATE sessions SET status = 'abandoned', updated_at = ?, completed_at = ?
      WHERE status = 'active' AND agent_id = ?
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
    // Worktree-filtered queries
    listByWorktree: db.prepare(`
      SELECT * FROM sessions WHERE worktree_id = ? ORDER BY updated_at DESC LIMIT ?
    `),
    listByStatusAndWorktree: db.prepare(`
      SELECT * FROM sessions WHERE status = ? AND worktree_id = ? ORDER BY updated_at DESC LIMIT ?
    `),
    listByAgentAndWorktree: db.prepare(`
      SELECT * FROM sessions WHERE agent_id = ? AND worktree_id = ? ORDER BY updated_at DESC LIMIT ?
    `),
    listByStatusAgentAndWorktree: db.prepare(`
      SELECT * FROM sessions WHERE status = ? AND agent_id = ? AND worktree_id = ? ORDER BY updated_at DESC LIMIT ?
    `),
    mostRecentActive: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1
    `),
    mostRecentActiveByAgent: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' AND agent_id = ? ORDER BY updated_at DESC LIMIT 1
    `),
    mostRecentActiveByWorktree: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' AND worktree_id = ? ORDER BY updated_at DESC LIMIT 1
    `),
    mostRecentActiveByAgentAndWorktree: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' AND agent_id = ? AND worktree_id = ? ORDER BY updated_at DESC LIMIT 1
    `),
    cleanupOld: db.prepare(`
      DELETE FROM sessions WHERE status = ? AND updated_at < ?
    `),
    cleanupOldAny: db.prepare(`
      DELETE FROM sessions WHERE status IN ('completed', 'abandoned') AND updated_at < ?
    `),

    // Phase
    setPhase: db.prepare(`
      UPDATE sessions SET phase = ?, updated_at = ? WHERE id = ?
    `),

    // Files — global view
    listAllActiveClaims: db.prepare(`
      SELECT sf.session_id, sf.file_path, sf.start_line, sf.end_line, sf.symbol,
             sf.claimed_at, s.purpose, s.agent_id, s.phase
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.released_at IS NULL AND s.status = 'active'
      ORDER BY sf.file_path ASC, sf.start_line ASC
    `),
    getClaimOwner: db.prepare(`
      SELECT sf.session_id, sf.file_path, sf.start_line, sf.end_line, sf.symbol,
             sf.claimed_at, s.purpose, s.agent_id, s.phase
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.file_path = ? AND sf.released_at IS NULL AND s.status = 'active'
    `),

    // Files — whole-file claims
    claimFile: db.prepare(`
      INSERT INTO session_files (session_id, file_path, start_line, end_line, symbol, claimed_at, released_at)
      VALUES (?, ?, NULL, NULL, NULL, ?, NULL)
    `),
    // Files — region claims
    claimRegion: db.prepare(`
      INSERT INTO session_files (session_id, file_path, start_line, end_line, symbol, claimed_at, released_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `),
    releaseFile: db.prepare(`
      UPDATE session_files SET released_at = ? WHERE session_id = ? AND file_path = ? AND released_at IS NULL
    `),
    releaseRegion: db.prepare(`
      UPDATE session_files SET released_at = ?
      WHERE session_id = ? AND file_path = ? AND start_line = ? AND end_line = ? AND released_at IS NULL
    `),
    releaseAllFiles: db.prepare(`
      UPDATE session_files SET released_at = ? WHERE session_id = ? AND released_at IS NULL
    `),
    getActiveClaimsForPaths: db.prepare(`
      SELECT sf.*, s.purpose FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.file_path = ? AND sf.released_at IS NULL
    `),
    // Overlap detection: finds claims on the same file from OTHER sessions that overlap a given region
    getOverlappingClaims: db.prepare(`
      SELECT sf.*, s.purpose, s.agent_id FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.file_path = ?
        AND sf.released_at IS NULL
        AND s.status = 'active'
        AND sf.session_id != ?
        AND (
          sf.start_line IS NULL
          OR ? IS NULL
          OR (sf.start_line <= ? AND sf.end_line >= ?)
        )
    `),
    // Range-filtered claim owner query
    getClaimOwnerRange: db.prepare(`
      SELECT sf.session_id, sf.file_path, sf.start_line, sf.end_line, sf.symbol,
             sf.claimed_at, s.purpose, s.agent_id, s.phase
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.file_path = ? AND sf.released_at IS NULL AND s.status = 'active'
        AND (
          sf.start_line IS NULL
          OR (sf.start_line <= ? AND sf.end_line >= ?)
        )
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
    countNotesBySession: db.prepare(`
      SELECT COUNT(*) as count FROM session_notes WHERE session_id = ?
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
    return 'session-' + randomUUID();
  }

  function formatSession(row: SessionRow) {
    return {
      id: row.id,
      purpose: row.purpose,
      status: row.status,
      phase: row.phase || 'in_progress',
      agentId: row.agent_id,
      worktreeId: row.worktree_id,
      identityProject: row.identity_project,
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
      startLine: row.start_line ?? null,
      endLine: row.end_line ?? null,
      symbol: row.symbol ?? null,
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
      return { success: false, error: 'purpose must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    const trimmedPurpose = purpose.trim();
    if (!trimmedPurpose) {
      return { success: false, error: 'purpose must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const now = Date.now();
    const id = generateSessionId();
    const {
      agentId = null,
      worktreeId = null,
      project = null,
      files = [],
      metadata = null,
    } = options;

    // Auto-detect worktree if not explicitly provided
    const resolvedWorktreeId = worktreeId ?? getWorktreeId() ?? null;
    const identityProject = project || null;

    // Validate agentId if provided
    if (agentId !== null && typeof agentId !== 'string') {
      return { success: false, error: 'agentId must be a string', code: 'VALIDATION_ERROR' };
    }

    // Validate files array contents
    if (!Array.isArray(files)) {
      return { success: false, error: 'files must be an array', code: 'VALIDATION_ERROR' };
    }
    for (const file of files) {
      if (typeof file !== 'string' || !file.trim()) {
        return { success: false, error: 'files must contain non-empty strings', code: 'VALIDATION_ERROR' };
      }
    }

    try {
      stmts.insert.run(
        id,
        trimmedPurpose,
        'active',
        agentId,
        resolvedWorktreeId,
        identityProject,
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
      purpose: trimmedPurpose,
      status: 'active',
      worktreeId: resolvedWorktreeId,
    };

    if (claimedFiles !== undefined) {
      result.files = claimedFiles;
    }
    if (conflicts !== undefined) {
      result.conflicts = conflicts;
    }

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_START, {
        details: `Session started: ${trimmedPurpose}`,
        metadata: { sessionId: id, purpose: trimmedPurpose, agentId: agentId || undefined, worktreeId: resolvedWorktreeId || undefined } as unknown as Record<string, unknown>,
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
   * Zombie protocol: abandon all active sessions owned by a dead agent.
   * Called when the resurrection reaper marks an agent as dead.
   */
  function abandonByAgent(agentId: string): number {
    const now = Date.now();
    const result = stmts.abandonActiveByAgent.run(now, now, agentId);
    return result.changes;
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
      return { success: false, error: 'sessionId must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    if (!content || typeof content !== 'string') {
      return { success: false, error: 'content must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return { success: false, error: 'content must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    // Enforce max notes per session
    const noteCount = (stmts.countNotesBySession.get(sessionId) as { count: number }).count;
    if (noteCount >= MAX_NOTES_PER_SESSION) {
      return {
        success: false,
        error: `session has reached the maximum of ${MAX_NOTES_PER_SESSION} notes`,
        code: 'NOTES_LIMIT_EXCEEDED',
      };
    }

    const now = Date.now();
    const { type = 'note' } = options;

    const result = stmts.insertNote.run(sessionId, trimmedContent, type, now);
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
      return { success: false, error: 'content must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return { success: false, error: 'content must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const { agentId = null, type = 'note' } = options;

    // Auto-detect current worktree for session scoping
    const currentWorktreeId = getWorktreeId();

    // Find most recent active session (scoped to worktree + agent)
    let session: SessionRow | undefined;
    if (agentId && currentWorktreeId) {
      session = stmts.mostRecentActiveByAgentAndWorktree.get(agentId, currentWorktreeId) as SessionRow | undefined;
    } else if (currentWorktreeId) {
      session = stmts.mostRecentActiveByWorktree.get(currentWorktreeId) as SessionRow | undefined;
    } else if (agentId) {
      session = stmts.mostRecentActiveByAgent.get(agentId) as SessionRow | undefined;
    } else {
      session = stmts.mostRecentActive.get() as SessionRow | undefined;
    }

    let sessionId: string;

    if (!session) {
      // Create an anonymous session (worktreeId auto-detected in start())
      const startResult = start('Quick notes', { agentId });
      if (!startResult.success) {
        return { success: false, error: 'failed to create session' };
      }
      sessionId = startResult.id as string;
    } else {
      sessionId = session.id;
    }

    const noteResult = addNote(sessionId, trimmedContent, { type });
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
   *
   * @param sessionId - Session to claim files for
   * @param filePaths - Whole-file claims (backward compat)
   * @param options - Optional: region claims, force flag
   */
  function claimFiles(sessionId: string, filePaths: string[], options?: ClaimFilesOptions) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const regions = options?.regions ?? [];

    // filePaths can be empty if regions are provided; otherwise it's a validation error
    if (!Array.isArray(filePaths)) {
      return { success: false, error: 'filePaths must be an array', code: 'VALIDATION_ERROR' };
    }
    if (filePaths.length === 0 && regions.length === 0) {
      // No regions either — reject as validation error (backward compat)
      return { success: false, error: 'filePaths must be a non-empty array', code: 'VALIDATION_ERROR' };
    }

    // Validate all filePaths are non-empty strings
    for (const filePath of filePaths) {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return { success: false, error: 'filePaths must contain non-empty strings', code: 'VALIDATION_ERROR' };
      }
    }

    // Validate regions
    for (const region of regions) {
      if (!region.path || typeof region.path !== 'string' || !region.path.trim()) {
        return { success: false, error: 'region path must be a non-empty string', code: 'VALIDATION_ERROR' };
      }
      if (region.startLine !== undefined) {
        if (typeof region.startLine !== 'number' || region.startLine < 1) {
          return { success: false, error: 'startLine must be a positive integer (1-indexed)', code: 'VALIDATION_ERROR' };
        }
      }
      if (region.endLine !== undefined) {
        if (typeof region.endLine !== 'number' || region.endLine < 1) {
          return { success: false, error: 'endLine must be a positive integer (1-indexed)', code: 'VALIDATION_ERROR' };
        }
        if (region.startLine !== undefined && region.endLine < region.startLine) {
          return { success: false, error: 'endLine must be >= startLine', code: 'VALIDATION_ERROR' };
        }
      }
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    const now = Date.now();
    const claimed: string[] = [];
    const conflicts: FileConflict[] = [];

    // Process whole-file claims
    for (const filePath of filePaths) {
      // Check for overlapping claims from other sessions (whole-file = NULL startLine)
      const overlapping = stmts.getOverlappingClaims.all(
        filePath, sessionId, null, null, null
      ) as Array<SessionFileRow & { purpose: string; agent_id: string | null }>;

      for (const claim of overlapping) {
        conflicts.push({
          filePath,
          sessionId: claim.session_id,
          purpose: claim.purpose,
          claimedAt: claim.claimed_at,
          startLine: claim.start_line,
          endLine: claim.end_line,
          symbol: claim.symbol,
        });
      }

      // Release any existing whole-file claim from this session first, then insert new
      stmts.releaseFile.run(now, sessionId, filePath);
      stmts.claimFile.run(sessionId, filePath, now);
      if (!claimed.includes(filePath)) claimed.push(filePath);
    }

    // Process region claims
    for (const region of regions) {
      const startLine = region.startLine ?? null;
      const endLine = region.endLine ?? null;
      const symbol = region.symbol ?? null;

      // Check for overlapping claims from other sessions
      const overlapping = stmts.getOverlappingClaims.all(
        region.path, sessionId, startLine, endLine, startLine
      ) as Array<SessionFileRow & { purpose: string; agent_id: string | null }>;

      for (const claim of overlapping) {
        conflicts.push({
          filePath: region.path,
          sessionId: claim.session_id,
          purpose: claim.purpose,
          claimedAt: claim.claimed_at,
          startLine: claim.start_line,
          endLine: claim.end_line,
          symbol: claim.symbol,
        });
      }

      stmts.claimRegion.run(sessionId, region.path, startLine, endLine, symbol, now);
      if (!claimed.includes(region.path)) claimed.push(region.path);
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
   *
   * @param sessionId - Session to release files from
   * @param filePaths - Release all claims (any region) for these paths
   * @param options - Optional: release specific region claims
   */
  function releaseFiles(sessionId: string, filePaths: string[], options?: { regions?: FileRegion[] }) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }

    const regions = options?.regions ?? [];

    if ((!Array.isArray(filePaths) || filePaths.length === 0) && regions.length === 0) {
      return { success: false, error: 'filePaths must be a non-empty array' };
    }

    const now = Date.now();
    const released: string[] = [];

    // Release all claims for specified file paths (any region)
    for (const filePath of filePaths) {
      const result = stmts.releaseFile.run(now, sessionId, filePath);
      if (result.changes > 0) {
        released.push(filePath);
      }
    }

    // Release specific region claims
    for (const region of regions) {
      const startLine = region.startLine ?? null;
      const endLine = region.endLine ?? null;
      if (startLine !== null && endLine !== null) {
        const result = stmts.releaseRegion.run(now, sessionId, region.path, startLine, endLine);
        if (result.changes > 0) {
          released.push(`${region.path}:${startLine}-${endLine}`);
        }
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
          startLine: claim.start_line,
          endLine: claim.end_line,
          symbol: claim.symbol,
        });
      }
    }

    return { conflicts };
  }

  /**
   * List sessions
   */
  function list(options: ListOptions = {}) {
    const { status, agentId, worktreeId, allWorktrees = false, includeNotes = false, limit = 50 } = options;

    // Auto-detect current worktree unless explicitly showing all
    const effectiveWorktreeId = allWorktrees ? null : (worktreeId ?? getWorktreeId());

    let sessions: SessionRow[];

    // Choose the right query based on filters
    if (status && agentId && effectiveWorktreeId) {
      sessions = stmts.listByStatusAgentAndWorktree.all(status, agentId, effectiveWorktreeId, limit) as SessionRow[];
    } else if (status && effectiveWorktreeId) {
      sessions = stmts.listByStatusAndWorktree.all(status, effectiveWorktreeId, limit) as SessionRow[];
    } else if (agentId && effectiveWorktreeId) {
      sessions = stmts.listByAgentAndWorktree.all(agentId, effectiveWorktreeId, limit) as SessionRow[];
    } else if (effectiveWorktreeId) {
      sessions = stmts.listByWorktree.all(effectiveWorktreeId, limit) as SessionRow[];
    } else if (status && agentId) {
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
      worktreeId: effectiveWorktreeId,
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
   * Set the phase of a session
   */
  function setPhase(sessionId: string, phase: string) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string', code: 'VALIDATION_ERROR' };
    }
    if (!phase || typeof phase !== 'string') {
      return { success: false, error: 'phase must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    const normalizedPhase = phase.toLowerCase().trim();
    if (!VALID_PHASES.includes(normalizedPhase as SessionPhase)) {
      return {
        success: false,
        error: `Invalid phase: "${phase}". Valid phases: ${VALID_PHASES.join(', ')}`,
        code: 'VALIDATION_ERROR'
      };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    const now = Date.now();
    stmts.setPhase.run(normalizedPhase, now, sessionId);

    // If phase is 'completed' or 'abandoned', also update session status
    if (normalizedPhase === 'completed' || normalizedPhase === 'abandoned') {
      stmts.updateStatus.run(normalizedPhase, now, now, sessionId);
      stmts.releaseAllFiles.run(now, sessionId);
    }

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_NOTE, {
        details: `Session ${sessionId} phase changed to ${normalizedPhase}`,
        metadata: { sessionId, phase: normalizedPhase, previousPhase: session.phase || 'in_progress' } as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      id: sessionId,
      phase: normalizedPhase,
      previousPhase: session.phase || 'in_progress',
    };
  }

  /**
   * List all active file claims across all sessions (global view)
   */
  function listAllActiveClaims() {
    const rows = stmts.listAllActiveClaims.all() as Array<{
      session_id: string;
      file_path: string;
      start_line: number | null;
      end_line: number | null;
      symbol: string | null;
      claimed_at: number;
      purpose: string;
      agent_id: string | null;
      phase: string | null;
    }>;

    return {
      success: true,
      claims: rows.map(r => ({
        filePath: r.file_path,
        sessionId: r.session_id,
        purpose: r.purpose,
        agentId: r.agent_id,
        phase: r.phase || 'in_progress',
        claimedAt: r.claimed_at,
        startLine: r.start_line,
        endLine: r.end_line,
        symbol: r.symbol,
      })),
      count: rows.length,
    };
  }

  /**
   * Get who owns a specific file path, optionally filtered by line range
   */
  function getClaimOwner(filePath: string, range?: { startLine?: number; endLine?: number }) {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'filePath must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    type ClaimOwnerRow = {
      session_id: string;
      file_path: string;
      start_line: number | null;
      end_line: number | null;
      symbol: string | null;
      claimed_at: number;
      purpose: string;
      agent_id: string | null;
      phase: string | null;
    };

    let rows: ClaimOwnerRow[];

    if (range?.startLine != null && range?.endLine != null) {
      // Range-filtered query: find claims that overlap the requested range
      rows = stmts.getClaimOwnerRange.all(filePath, range.endLine, range.startLine) as ClaimOwnerRow[];
    } else {
      rows = stmts.getClaimOwner.all(filePath) as ClaimOwnerRow[];
    }

    return {
      success: true,
      filePath,
      owners: rows.map(r => ({
        sessionId: r.session_id,
        purpose: r.purpose,
        agentId: r.agent_id,
        phase: r.phase || 'in_progress',
        claimedAt: r.claimed_at,
        startLine: r.start_line,
        endLine: r.end_line,
        symbol: r.symbol,
      })),
      claimed: rows.length > 0,
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
    abandonByAgent,
    remove,
    addNote,
    quickNote,
    getNotes,
    claimFiles,
    releaseFiles,
    getFileConflicts,
    setPhase,
    listAllActiveClaims,
    getClaimOwner,
    list,
    get,
    cleanup,
    setActivityLog,
  };
}
