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
import { getWorktreeId } from './worktree.js';
import { patternToSql } from './identity.js';
import { buildHumanReadableId } from './agent-names.js';
import type { NoteEncryption } from './note-encryption.js';
import type { SemanticIndex } from './semantic-index.js';
import type { EpisodicMemory } from './episodic-memory.js';
import type { Symbol as IndexedSymbol, SymbolIndex } from './symbol-index.js';
import { createClaimForest, type ClaimForestClaim } from './claim-forest.js';

const MAX_NOTES_PER_SESSION = 500;

// Optional activity logger interface — injected after creation via setActivityLog()
interface ActivityLogger {
  log(type: string, opts: {
    agentId?: string | null;
    targetId?: string | null;
    details: string;
    metadata: Record<string, unknown>;
  }): void;
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
  agent_node_id?: string | null;
  worktree_id: string | null;
  identity_project: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  metadata: string | null;
  is_durable?: number | null;
}

interface SessionFileRow {
  id: number;
  session_id: string;
  file_path: string;
  start_line: number | null;
  end_line: number | null;
  symbol: string | null;
  symbol_path: string | null;
  claimed_at: number;
  released_at: number | null;
}

interface FileRegion {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  symbolPath?: string;
}

interface ClaimFilesOptions {
  regions?: FileRegion[];
  force?: boolean;
  agentId?: string | null;
}

interface ReleaseFilesOptions {
  regions?: FileRegion[];
  agentId?: string | null;
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
  /** Durable sessions survive indefinitely without a live heartbeat process. */
  durable?: boolean;
}

interface EndOptions {
  note?: string;
  status?: string;
}

interface TakeoverOptions {
  agentId?: string | null;
  purpose?: string | null;
  note?: string | null;
  project?: string | null;
  worktreeId?: string | null;
  metadata?: Record<string, unknown> | null;
  durable?: boolean;
  claimFiles?: boolean;
}

interface AddNoteOptions {
  type?: string;
}

interface QuickNoteOptions {
  sessionId?: string | null;
  agentId?: string | null;
  type?: string;
  /**
   * Explicit caller worktree world. `null` means the caller has no Git world;
   * omission preserves legacy in-process cwd discovery only.
   */
  worktreeId?: string | null;
}

interface GetNotesOptions {
  limit?: number;
  type?: string;
  since?: number;
  agentId?: string | null;
  project?: string | null;
}

interface ListOptions {
  status?: string;
  agentId?: string | null;
  project?: string | null;
  purpose?: string | null;
  worktreeId?: string | null;
  allWorktrees?: boolean;
  includeNotes?: boolean;
  limit?: number;
}

interface CleanupOptions {
  olderThan?: number;
  status?: string;
}

interface AbandonOrphanedOptions {
  olderThan?: number;
}

interface FileConflict {
  filePath: string;
  sessionId: string;
  purpose: string;
  claimedAt: number;
  startLine?: number | null;
  endLine?: number | null;
  symbol?: string | null;
  symbolPath?: string | null;
}

// =============================================================================
// Module factory
// =============================================================================

/**
 * Initialize the sessions module with a database connection
 */
export function createSessions(
  db: Database.Database,
  noteEncryption?: NoteEncryption,
  options?: {
    semanticIndex?: SemanticIndex;
    episodicMemory?: EpisodicMemory;
    symbolIndex?: SymbolIndex;
    requireAgentForFileClaims?: boolean;
  },
) {
  const semanticIndex = options?.semanticIndex;
  const episodicMemory = options?.episodicMemory;
  const symbolIndex = options?.symbolIndex;
  const requireAgentForFileClaims = options?.requireAgentForFileClaims === true;
  // In-memory cache: sessionId → unwrapped session key (avoids re-unwrap on every read)
  const sessionKeyCache = new Map<string, Buffer>();
  // Ensure tables exist (base schema without worktree_id for migration compatibility)
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      phase TEXT DEFAULT 'in_progress',
      agent_id TEXT,
      agent_node_id TEXT,
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
      symbol_path TEXT,
      claimed_at INTEGER NOT NULL,
      released_at INTEGER,
      agent_node_id TEXT
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
    // Migration: add wrapped_session_key for note encryption (v3.8+)
    const hasWrappedKey = columns.some(c => c.name === 'wrapped_session_key');
    if (!hasWrappedKey) {
      db.prepare("ALTER TABLE sessions ADD COLUMN wrapped_session_key TEXT").run();
    }

    // Migration: add is_durable flag (v3.19+)
    // Durable sessions survive indefinitely without a live heartbeat process.
    // The orphan reaper skips them; whoami returns active=true regardless of
    // agent liveness. Only ended by pd done, worktree removal, or branch merge.
    const hasDurable = columns.some(c => c.name === 'is_durable');
    if (!hasDurable) {
      db.prepare("ALTER TABLE sessions ADD COLUMN is_durable INTEGER NOT NULL DEFAULT 0").run();
    }
    // Canonical durable principal for this replaceable session body.
    const hasAgentNodeId = columns.some(c => c.name === 'agent_node_id');
    if (!hasAgentNodeId) {
      db.prepare('ALTER TABLE sessions ADD COLUMN agent_node_id TEXT').run();
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
    const hasSymbolPath = fileColumns.some(c => c.name === 'symbol_path');
    if (!hasStartLine) {
      // Old schema uses composite PK (session_id, file_path) — need to recreate table
      db.prepare(`CREATE TABLE IF NOT EXISTS session_files_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        symbol TEXT,
        symbol_path TEXT,
        claimed_at INTEGER NOT NULL,
        released_at INTEGER,
        agent_node_id TEXT
      )`).run();
      if (fileColumns.some(c => c.name === 'agent_node_id')) {
        db.prepare(`INSERT INTO session_files_new (
          session_id, file_path, claimed_at, released_at, agent_node_id
        ) SELECT session_id, file_path, claimed_at, released_at, agent_node_id FROM session_files`).run();
      } else {
        db.prepare(`INSERT INTO session_files_new (session_id, file_path, claimed_at, released_at)
          SELECT session_id, file_path, claimed_at, released_at FROM session_files`).run();
      }
      db.prepare(`DROP TABLE session_files`).run();
      db.prepare(`ALTER TABLE session_files_new RENAME TO session_files`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_region ON session_files(file_path, start_line, end_line)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_symbol_path ON session_files(file_path, symbol_path)`).run();
    } else if (!hasSymbolPath) {
      db.prepare("ALTER TABLE session_files ADD COLUMN symbol_path TEXT").run();
    }
    if (!fileColumns.some(c => c.name === 'agent_node_id')) {
      const migratedColumns = db.prepare('PRAGMA table_info(session_files)').all() as Array<{ name: string }>;
      if (!migratedColumns.some(c => c.name === 'agent_node_id')) {
        db.prepare('ALTER TABLE session_files ADD COLUMN agent_node_id TEXT').run();
      }
    }
  } catch {
    // Table might not exist yet (fresh install) — that's fine, schema statements above handle it
  }

  // Create region indexes after migration ensures columns exist
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_region ON session_files(file_path, start_line, end_line)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_session_files_symbol_path ON session_files(file_path, symbol_path)`).run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_agent_node ON sessions(agent_node_id, status, updated_at)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_session_files_agent_node ON session_files(agent_node_id, released_at)').run();
  const claimForest = createClaimForest(db);
  claimForest.backfillFromSessionFiles();

  // Enable foreign key enforcement (needed for CASCADE)
  db.pragma('foreign_keys = ON');

  // Direct-DB test fixtures and older lightweight stores may create sessions
  // without the live agent registry. In that mode orphan reconciliation has no
  // authoritative body table to consult, so it must be an explicit no-op instead
  // of making every direct session operation fail at statement preparation time.
  const hasAgentsTable = Boolean(
    db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'agents'
      LIMIT 1
    `).get()
  );

  // Prepared statements
  const stmts = {
    // Sessions
    getById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    insert: db.prepare(`
      INSERT INTO sessions (id, purpose, status, agent_id, worktree_id, identity_project, created_at, updated_at, completed_at, metadata, is_durable)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateStatus: db.prepare(`
      UPDATE sessions SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
    `),
    setWrappedKey: db.prepare(`
      UPDATE sessions SET wrapped_session_key = ? WHERE id = ?
    `),
    getWrappedKey: db.prepare(`
      SELECT wrapped_session_key, identity_project FROM sessions WHERE id = ?
    `),
    abandonActiveByAgent: db.prepare(`
      UPDATE sessions SET status = 'abandoned', updated_at = ?, completed_at = ?
      WHERE status = 'active' AND agent_id = ?
    `),
    setMetadata: db.prepare(`
      UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?
    `),
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
    listByPattern: db.prepare(`
      SELECT * FROM sessions 
      WHERE (status = COALESCE(?, status))
        AND (agent_id LIKE COALESCE(?, agent_id) ESCAPE '\\')
        AND (identity_project LIKE COALESCE(?, identity_project) ESCAPE '\\')
        AND (purpose LIKE COALESCE(?, purpose) ESCAPE '\\')
        AND (worktree_id = COALESCE(?, worktree_id))
      ORDER BY updated_at DESC LIMIT ?
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
    mostRecentActiveByAgentWithoutWorktree: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' AND agent_id = ? AND worktree_id IS NULL ORDER BY updated_at DESC LIMIT 1
    `),
    listActiveWithoutWorktree: db.prepare(`
      SELECT * FROM sessions WHERE status = 'active' AND worktree_id IS NULL ORDER BY updated_at DESC LIMIT ?
    `),
    // Cleanup is intentionally non-destructive. Older builds physically
    // deleted completed/abandoned sessions here; that violated the note
    // monotonicity contract. These count the rows that would have been removed
    // so callers can surface archival pressure without destroying evidence.
    countCleanupOld: db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE status = ? AND updated_at < ?
    `),
    countCleanupOldAny: db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE status IN ('completed', 'abandoned') AND updated_at < ?
    `),
    listOrphanedActive: db.prepare(hasAgentsTable ? `
        SELECT s.*
        FROM sessions s
        LEFT JOIN agents a ON a.id = s.agent_id
        WHERE s.status = 'active'
          AND s.agent_id IS NOT NULL
          AND s.agent_id != ''
          AND a.id IS NULL
          AND s.updated_at < ?
          AND (s.is_durable IS NULL OR s.is_durable = 0)
        ORDER BY s.updated_at ASC
      ` : `
        SELECT *
        FROM sessions
        WHERE 0 AND updated_at < ?
      `),

    // Phase
    setPhase: db.prepare(`
      UPDATE sessions SET phase = ?, updated_at = ? WHERE id = ?
    `),

    // Files — global view
    listAllActiveClaims: db.prepare(`
      SELECT sf.session_id, sf.file_path, sf.start_line, sf.end_line, sf.symbol, sf.symbol_path,
             sf.claimed_at, s.purpose, s.agent_id, s.phase
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.released_at IS NULL AND s.status = 'active'
      ORDER BY sf.file_path ASC, sf.start_line ASC
    `),
    listActiveClaimsByPattern: db.prepare(`
      SELECT sf.session_id, sf.file_path, sf.start_line, sf.end_line, sf.symbol, sf.symbol_path,
             sf.claimed_at, s.purpose, s.agent_id, s.phase
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.released_at IS NULL AND s.status = 'active'
        AND (sf.file_path LIKE ? ESCAPE '\\' OR ? IS NULL)
        AND (sf.symbol LIKE ? ESCAPE '\\' OR ? IS NULL)
        AND (sf.symbol_path LIKE ? ESCAPE '\\' OR ? IS NULL)
        AND (s.agent_id LIKE ? ESCAPE '\\' OR ? IS NULL)
        AND (s.purpose LIKE ? ESCAPE '\\' OR ? IS NULL)
      ORDER BY sf.file_path ASC, sf.start_line ASC
    `),
    getClaimOwner: db.prepare(`
      SELECT sf.session_id, sf.file_path, sf.start_line, sf.end_line, sf.symbol, sf.symbol_path,
             sf.claimed_at, s.purpose, s.agent_id, s.phase
      FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.file_path = ? AND sf.released_at IS NULL AND s.status = 'active'
    `),

    // Files — whole-file claims
    claimFile: db.prepare(`
      INSERT INTO session_files (
        session_id, file_path, start_line, end_line, symbol, symbol_path,
        claimed_at, released_at, agent_node_id
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?, NULL, ?)
    `),
    // Files — region claims
    claimRegion: db.prepare(`
      INSERT INTO session_files (
        session_id, file_path, start_line, end_line, symbol, symbol_path,
        claimed_at, released_at, agent_node_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `),
    releaseFile: db.prepare(`
      UPDATE session_files SET released_at = ? WHERE session_id = ? AND file_path = ? AND released_at IS NULL
    `),
    releaseRegion: db.prepare(`
      UPDATE session_files SET released_at = ?
      WHERE session_id = ? AND file_path = ? AND start_line = ? AND end_line = ? AND released_at IS NULL
    `),
    releaseRegionBySymbolPath: db.prepare(`
      UPDATE session_files SET released_at = ?
      WHERE session_id = ? AND file_path = ? AND symbol_path = ? AND released_at IS NULL
    `),
    releaseAllFiles: db.prepare(`
      UPDATE session_files SET released_at = ? WHERE session_id = ? AND released_at IS NULL
    `),
    getActiveClaimsForPaths: db.prepare(`
      SELECT sf.*, s.purpose FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.file_path = ? AND sf.released_at IS NULL AND s.status = 'active'
    `),
    getActiveClaimsForFileExcludingSession: db.prepare(`
      SELECT sf.*, s.purpose, s.agent_id FROM session_files sf
      JOIN sessions s ON s.id = sf.session_id
      WHERE sf.file_path = ?
        AND sf.released_at IS NULL
        AND s.status = 'active'
        AND sf.session_id != ?
    `),
    // Range-filtered claim owner query
    getClaimOwnerRange: db.prepare(`
      SELECT sf.session_id, sf.file_path, sf.start_line, sf.end_line, sf.symbol, sf.symbol_path,
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
      SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id, s.identity_project as identity_project
      FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.session_id = ? ORDER BY sn.created_at ASC, sn.id ASC
    `),
    getNotesBySessionAndType: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id, s.identity_project as identity_project
      FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.session_id = ? AND sn.type = ? ORDER BY sn.created_at ASC, sn.id ASC
    `),
    getRecentNotesBySession: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id, s.identity_project as identity_project
      FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.session_id = ? ORDER BY sn.created_at DESC, sn.id DESC LIMIT ?
    `),
    countActiveFilesBySession: db.prepare(`
      SELECT COUNT(*) as count FROM session_files WHERE session_id = ? AND released_at IS NULL
    `),
    getRecentNotes: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id, s.identity_project as identity_project FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      ORDER BY sn.created_at DESC LIMIT ?
    `),
    getRecentNotesByType: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id, s.identity_project as identity_project FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.type = ?
      ORDER BY sn.created_at DESC LIMIT ?
    `),
    getNotesSince: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id, s.identity_project as identity_project FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.created_at >= ?
      ORDER BY sn.created_at DESC LIMIT ?
    `),
    getNotesSinceByType: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id, s.identity_project as identity_project FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE sn.created_at >= ? AND sn.type = ?
      ORDER BY sn.created_at DESC LIMIT ?
    `),
    getNotesByPattern: db.prepare(`
      SELECT sn.*, s.purpose as session_purpose, s.agent_id as session_agent_id, s.identity_project as identity_project FROM session_notes sn
      JOIN sessions s ON s.id = sn.session_id
      WHERE (s.agent_id LIKE ? ESCAPE '\\' OR ? IS NULL)
        AND (s.identity_project LIKE ? ESCAPE '\\' OR ? IS NULL)
        AND (sn.type = ? OR ? IS NULL)
        AND (sn.created_at >= ? OR ? IS NULL)
      ORDER BY sn.created_at DESC LIMIT ?
    `),
    countNotesBySession: db.prepare(`
      SELECT COUNT(*) as count FROM session_notes WHERE session_id = ?
    `),
  };

  // ─── Note Encryption Helpers ──────────────────────────────────────────────

  /**
   * Get the session key for a session (from cache or unwrap from DB).
   * Returns null if encryption is disabled or no key exists for this session.
   */
  function getSessionKey(sessionId: string): Buffer | null {
    if (!noteEncryption?.isEnabled()) return null;

    // Check cache first
    const cached = sessionKeyCache.get(sessionId);
    if (cached) return cached;

    // Unwrap from DB
    const row = stmts.getWrappedKey.get(sessionId) as {
      wrapped_session_key: string | null;
      identity_project: string | null;
    } | undefined;
    if (!row?.wrapped_session_key) return null;

    try {
      const key = noteEncryption.unwrapSessionKey(row.wrapped_session_key, noteEncryptionScope(row.identity_project));
      sessionKeyCache.set(sessionId, key);
      return key;
    } catch {
      return null;
    }
  }

  /**
   * Encrypt note content if encryption is enabled.
   * Returns plaintext unchanged if disabled or no session key.
   */
  function maybeEncrypt(sessionId: string, content: string): string {
    const key = getSessionKey(sessionId);
    if (!key || !noteEncryption) return content;
    return noteEncryption.encryptNote(content, key);
  }

  /**
   * Decrypt note content if it's encrypted.
   * Returns content unchanged if plaintext (backward compat).
   */
  function maybeDecrypt(sessionId: string, content: string): string {
    if (!noteEncryption?.isEnabled()) return content;
    if (!noteEncryption.isEncrypted(content)) return content;  // plaintext legacy note

    const key = getSessionKey(sessionId);
    if (!key) return content;  // no key available — return ciphertext as-is

    const decrypted = noteEncryption.decryptNote(content, key);
    return decrypted ?? content;  // if decryption fails, return raw content
  }

  function safeJsonParse(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function noteEncryptionScope(identityProject: string | null | undefined): string | null {
    return identityProject ? `${identityProject}:fleet` : null;
  }

  function matchesSqlLike(pattern: string, value: string | null | undefined): boolean {
    if (!value) return false;
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\?/g, '\\?')
      .replace(/\*/g, '\\*')
      .replace(/%/g, '.*')
      .replace(/_/g, '.');
    return new RegExp(`^${escaped}$`).test(value);
  }

  function generateSessionId(purpose?: string): string {
    return buildHumanReadableId('session', purpose, randomBytes(6).toString('hex'), 'work');
  }

  function formatSession(row: SessionRow) {
    const fileCount = (stmts.countActiveFilesBySession.get(row.id) as { count: number }).count;
    const noteCount = (stmts.countNotesBySession.get(row.id) as { count: number }).count;
    return {
      id: row.id,
      purpose: row.purpose,
      status: row.status,
      phase: row.phase || 'in_progress',
      agentId: row.agent_id,
      worktreeId: row.worktree_id,
      identityProject: row.identity_project,
      fileCount,
      noteCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      metadata: safeJsonParse(row.metadata),
      durable: row.is_durable === 1,
    };
  }

  function formatNote(row: SessionNoteRow & { session_purpose?: string; session_agent_id?: string; identity_project?: string }) {
    const note: Record<string, unknown> = {
      id: row.id,
      sessionId: row.session_id,
      content: maybeDecrypt(row.session_id, row.content),
      type: row.type,
      createdAt: row.created_at,
    };
    if (row.session_purpose !== undefined) {
      note.sessionPurpose = row.session_purpose;
    }
    if (row.session_agent_id !== undefined) {
      note.agentId = row.session_agent_id;
    }
    if (row.identity_project !== undefined) {
      note.identityProject = row.identity_project;
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
      symbolPath: row.symbol_path ?? null,
      claimedAt: row.claimed_at,
      releasedAt: row.released_at,
    };
  }

  function formatClaimForestFile(row: ClaimForestClaim) {
    return {
      sessionId: row.sessionId,
      filePath: row.filePath,
      startLine: row.startLine,
      endLine: row.endLine,
      symbol: row.symbol,
      symbolPath: row.symbolPath,
      claimedAt: row.claimedAt,
      releasedAt: row.releasedAt,
      repoId: row.repoId,
      worldKind: row.worldKind,
      worldId: row.worldId,
      nodeId: row.nodeId,
    };
  }

  function getIndexedSymbols(filePath: string): IndexedSymbol[] {
    if (!symbolIndex) return [];
    try {
      return symbolIndex.getSymbols(filePath);
    } catch {
      return [];
    }
  }

  function rangesOverlap(
    startA: number | null,
    endA: number | null,
    startB: number | null,
    endB: number | null,
  ): boolean {
    if (startA == null || endA == null || startB == null || endB == null) {
      return true;
    }
    return startA <= endB && endA >= startB;
  }

  function isWholeFileClaim(claim: { startLine: number | null; endLine: number | null }): boolean {
    return claim.startLine == null || claim.endLine == null;
  }

  function claimsConflict(
    existing: { startLine: number | null; endLine: number | null; symbolPath: string | null },
    requested: { startLine: number | null; endLine: number | null; symbolPath: string | null },
  ): boolean {
    if (isWholeFileClaim(existing) || isWholeFileClaim(requested)) {
      return true;
    }
    if (existing.symbolPath && requested.symbolPath) {
      return existing.symbolPath === requested.symbolPath;
    }
    return rangesOverlap(existing.startLine, existing.endLine, requested.startLine, requested.endLine);
  }

  function resolveRegionClaim(region: FileRegion) {
    const indexedSymbols = getIndexedSymbols(region.path);
    const resolvedSymbol = region.symbolPath
      ? indexedSymbols.find(symbol => symbol.symbolPath === region.symbolPath)
      : undefined;

    if (region.symbolPath && indexedSymbols.length > 0 && !resolvedSymbol) {
      return {
        success: false as const,
        error: `symbolPath "${region.symbolPath}" was not found in indexed symbols for ${region.path}`,
      };
    }

    if (resolvedSymbol) {
      return {
        success: true as const,
        claim: {
          path: region.path,
          startLine: resolvedSymbol.startLine,
          endLine: resolvedSymbol.endLine,
          symbol: resolvedSymbol.symbolName,
          symbolPath: resolvedSymbol.symbolPath,
        },
      };
    }

    if (region.symbolPath && (region.startLine === undefined || region.endLine === undefined)) {
      return {
        success: false as const,
        error: `symbolPath "${region.symbolPath}" requires indexed symbol data or an explicit startLine/endLine fallback`,
      };
    }

    return {
      success: true as const,
      claim: {
        path: region.path,
        startLine: region.startLine ?? null,
        endLine: region.endLine ?? null,
        symbol: region.symbol ?? null,
        symbolPath: region.symbolPath ?? null,
      },
    };
  }

  function sessionTarget(identityProject: string | null | undefined, sessionId: string): string {
    return identityProject ? `${identityProject}:session:${sessionId}` : sessionId;
  }

  function rememberEpisode(
    session: SessionRow,
    episodeType: string,
    sourceId: string,
    title: string,
    summary: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (!episodicMemory) return;
    const trimmedTitle = title.trim();
    const trimmedSummary = summary.trim();
    if (!trimmedTitle || !trimmedSummary) return;

    episodicMemory.remember({
      project: session.identity_project,
      agentId: session.agent_id,
      episodeType,
      title: trimmedTitle,
      summary: trimmedSummary,
      sourceType: 'session',
      sourceId,
      metadata,
    });
  }

  function normalizeAgentId(agentId: string | null | undefined): string | null {
    if (agentId == null) return null;
    return agentId.trim();
  }

  function authorizeFileMutation(
    session: SessionRow,
    callerAgentId: string | null | undefined,
    action: 'claiming' | 'releasing',
  ): { success: true; agentId: string | null } | { success: false; error: string; code: string } {
    if (callerAgentId !== null && callerAgentId !== undefined && typeof callerAgentId !== 'string') {
      return { success: false, error: 'agentId must be a string', code: 'VALIDATION_ERROR' };
    }

    const normalizedCaller = normalizeAgentId(callerAgentId);
    if (!requireAgentForFileClaims) {
      return { success: true, agentId: normalizedCaller };
    }

    const sessionAgentId = normalizeAgentId(session.agent_id);
    if (!sessionAgentId) {
      return {
        success: false,
        error: `agentId is required before ${action} files for a session`,
        code: 'SESSION_AGENT_REQUIRED',
      };
    }
    if (!normalizedCaller) {
      return {
        success: false,
        error: `agentId is required when ${action} files for a session`,
        code: 'SESSION_AGENT_REQUIRED',
      };
    }
    if (normalizedCaller !== sessionAgentId) {
      return {
        success: false,
        error: `agentId "${normalizedCaller}" cannot mutate file claims for session owned by "${sessionAgentId}"`,
        code: 'SESSION_AGENT_MISMATCH',
      };
    }

    return { success: true, agentId: normalizedCaller };
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
    const id = generateSessionId(trimmedPurpose);
    const hasExplicitWorktreeId = Object.prototype.hasOwnProperty.call(options, 'worktreeId');
    const {
      agentId = null,
      worktreeId = null,
      project = null,
      files = [],
      metadata = null,
      durable = false,
    } = options;

    // Only legacy in-process callers that omit worktreeId entirely may inherit
    // this process's cwd. HTTP/IPC admission always supplies the daemon-derived
    // id or an explicit null, so a daemon installed inside an unrelated Git
    // checkout cannot silently create a split-world session.
    const resolvedWorktreeId = hasExplicitWorktreeId
      ? (worktreeId ?? null)
      : (getWorktreeId() ?? null);
    const identityProject = project || null;

    // Validate agentId if provided
    if (agentId !== null && typeof agentId !== 'string') {
      return { success: false, error: 'agentId must be a string', code: 'VALIDATION_ERROR' };
    }
    const normalizedAgentId = normalizeAgentId(agentId);
    if (agentId !== null && !normalizedAgentId) {
      return { success: false, error: 'agentId must be a non-empty string when provided', code: 'VALIDATION_ERROR' };
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
    if (requireAgentForFileClaims && files.length > 0 && !normalizedAgentId) {
      return {
        success: false,
        error: 'agentId is required to start a session with file claims',
        code: 'SESSION_AGENT_REQUIRED',
      };
    }

    try {
      stmts.insert.run(
        id,
        trimmedPurpose,
        'active',
        normalizedAgentId,
        resolvedWorktreeId,
        identityProject,
        now,
        now,
        null,
        metadata ? JSON.stringify(metadata) : null,
        durable ? 1 : 0
      );
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    // Generate and store session encryption key (if encryption enabled)
    if (noteEncryption?.isEnabled()) {
      try {
        const sessionKey = noteEncryption.generateSessionKey();
        const wrappedKey = noteEncryption.wrapSessionKey(sessionKey, noteEncryptionScope(identityProject));
        stmts.setWrappedKey.run(wrappedKey, id);
        sessionKeyCache.set(id, sessionKey);
      } catch (err) {
        // Encryption key generation failed — session still works, notes will be plaintext
        console.error('[Sessions] Failed to generate session encryption key:', (err as Error).message);
      }
    }

    // Claim files if provided
    let claimedFiles: string[] | undefined;
    let conflicts: FileConflict[] | undefined;

    if (files.length > 0) {
      const claimResult = claimFiles(id, files, { agentId: normalizedAgentId });
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

    // Keep trie in sync (1:N via entryId = sessionId)
    if (semanticIndex && identityProject) {
      semanticIndex.index(identityProject, {
        type: 'session', id, identity: identityProject, status: 'active',
      }, id);
    }

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_START, {
        agentId: normalizedAgentId,
        targetId: sessionTarget(identityProject, id),
        details: `Session started: ${trimmedPurpose}`,
        metadata: {
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          sessionId: id,
          purpose: trimmedPurpose,
          agentId: normalizedAgentId || undefined,
          identityProject: identityProject || undefined,
          worktreeId: resolvedWorktreeId || undefined,
        } as unknown as Record<string, unknown>,
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

    // Add handoff note if provided, preserving the same encryption path as addNote().
    if (note) {
      const trimmedNote = note.trim();
      if (trimmedNote) {
        const storedNote = maybeEncrypt(sessionId, trimmedNote);
        const noteResult = stmts.insertNote.run(sessionId, storedNote, 'handoff', now);
        rememberEpisode(
          session,
          'handoff',
          `${sessionId}:note:${Number(noteResult.lastInsertRowid)}`,
          `${session.agent_id || 'agent'} handoff`,
          trimmedNote,
          {
            sessionId,
            noteType: 'handoff',
          },
        );
      }
    }

    // Release all active file claims
    const activeFiles = stmts.getActiveFilesBySession.all(sessionId) as SessionFileRow[];
    stmts.releaseAllFiles.run(now, sessionId);
    claimForest.releaseAllBySession(sessionId, now);
    const releasedFiles = activeFiles.map(f => f.file_path);

    // Keep the coarse lifecycle status and operator-facing phase coherent.
    if (status === 'completed' || status === 'abandoned') {
      stmts.setPhase.run(status, now, sessionId);
    }
    stmts.updateStatus.run(status, now, now, sessionId);

    // Remove from trie (targeted 1:N removal by entryId)
    if (semanticIndex && session.identity_project) {
      semanticIndex.unindexEntry(session.identity_project, sessionId);
    }

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_END, {
        agentId: session.agent_id,
        targetId: sessionTarget(session.identity_project, sessionId),
        details: `Session ended: ${sessionId} (${status})`,
        metadata: {
          sessionId,
          status,
          agentId: session.agent_id || undefined,
          identityProject: session.identity_project || undefined,
          releasedFiles: releasedFiles.length,
        } as unknown as Record<string, unknown>,
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

  // Ids of an agent's currently-active sessions. Read this BEFORE abandonByAgent so a
  // caller (e.g. the zombie-protocol death handler) can harvest each session's notes
  // while they are still queryable, then abandon them.
  function activeSessionIdsByAgent(agentId: string): string[] {
    const rows = db.prepare(
      `SELECT id FROM sessions WHERE status = 'active' AND agent_id = ?`
    ).all(agentId) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  function mergeMetadata(row: SessionRow, patch: Record<string, unknown>, now = Date.now()) {
    const existing = safeJsonParse(row.metadata) ?? {};
    const next = {
      ...existing,
      ...patch,
    };
    stmts.setMetadata.run(JSON.stringify(next), now, row.id);
    return next;
  }

  /**
   * Public metadata patch — shallow-merge `patch` into the session's metadata
   * JSON. Used by sugar.begin's rent-at-claim resume path to stamp a roadmap
   * link / sidequest reason onto an existing session record.
   */
  function updateMetadata(sessionId: string, patch: Record<string, unknown>) {
    const row = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!row) {
      return { success: false, error: `Session ${sessionId} not found` };
    }
    const metadata = mergeMetadata(row, patch);
    return { success: true, sessionId, metadata };
  }

  function splitTransferClaims(files: SessionFileRow[]) {
    const wholeFiles: string[] = [];
    const regions: FileRegion[] = [];

    for (const file of files) {
      if (file.start_line == null && file.end_line == null && !file.symbol && !file.symbol_path) {
        if (!wholeFiles.includes(file.file_path)) wholeFiles.push(file.file_path);
        continue;
      }

      regions.push({
        path: file.file_path,
        startLine: file.start_line ?? undefined,
        endLine: file.end_line ?? undefined,
        symbol: file.symbol ?? undefined,
        symbolPath: file.symbol_path ?? undefined,
      });
    }

    return { wholeFiles, regions };
  }

  /**
   * Archive a session without deleting its notes or claim history.
   *
   * Historical `rm` semantics physically deleted the session row and relied on
   * foreign-key cascades to erase notes. The coordination contract is now
   * append-only: removing a session means releasing any active claims, marking
   * active sessions abandoned, and writing a tombstone note.
   */
  function remove(sessionId: string) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }

    const now = Date.now();
    const activeFiles = stmts.getActiveFilesBySession.all(sessionId) as SessionFileRow[];
    if (activeFiles.length > 0) {
      stmts.releaseAllFiles.run(now, sessionId);
      claimForest.releaseAllBySession(sessionId, now);
    }

    const finalStatus = session.status === 'active' ? 'abandoned' : session.status;
    if (session.status === 'active') {
      stmts.setPhase.run('abandoned', now, sessionId);
      stmts.updateStatus.run('abandoned', now, now, sessionId);

      if (semanticIndex && session.identity_project) {
        semanticIndex.unindexEntry(session.identity_project, sessionId);
      }
    }

    mergeMetadata(session, {
      archivedAt: now,
      archivedBy: 'sessions.remove',
      removeIsNonDestructive: true,
    }, now);

    const noteResult = addNote(
      sessionId,
      'Session archived by pd session rm. Notes and claim history were preserved; active file claims were released.',
      { type: 'archive' },
    );

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_END, {
        agentId: session.agent_id,
        targetId: sessionTarget(session.identity_project, sessionId),
        details: `Session archived without deleting notes: ${sessionId}`,
        metadata: {
          sessionId,
          status: finalStatus,
          archived: true,
          notesPreserved: true,
          releasedFiles: activeFiles.length,
          agentId: session.agent_id || undefined,
          identityProject: session.identity_project || undefined,
        } as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      id: sessionId,
      status: finalStatus,
      archived: true,
      removed: false,
      notesPreserved: true,
      releasedFiles: activeFiles.map(file => file.file_path),
      noteId: noteResult.success ? noteResult.noteId : undefined,
      warning: noteResult.success ? undefined : noteResult.error,
    };
  }

  /**
   * Legacy primitive retained only as a typed refusal for old in-process
   * callers. Canonical takeover is exclusively DurableOwnershipService:
   * callers must prepare and consume an exact signed one-shot grant through
   * the authenticated HTTP/IPC boundary.
   */
  function takeover(sessionId: string, options: TakeoverOptions = {}): Record<string, any> {
    void sessionId;
    void options;
    return {
      success: false,
      code: 'RECOVERY_GRANT_REQUIRED',
      error: 'legacy in-process takeover is disabled; use the signed durable-ownership grant flow',
    };
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

    // Encrypt note content if encryption is enabled for this session
    const storedContent = maybeEncrypt(sessionId, trimmedContent);

    const result = stmts.insertNote.run(sessionId, storedContent, type, now);
    const noteId = Number(result.lastInsertRowid);

    rememberEpisode(
      session,
      type,
      `${sessionId}:note:${noteId}`,
      `${session.agent_id || 'agent'} ${type}`,
      trimmedContent,
      {
        sessionId,
        noteType: type,
      },
    );

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_NOTE, {
        agentId: session.agent_id,
        targetId: sessionTarget(session.identity_project, sessionId),
        details: `Note added to session ${sessionId}`,
        metadata: {
          sessionId,
          noteId,
          type,
          agentId: session.agent_id || undefined,
          identityProject: session.identity_project || undefined,
        } as unknown as Record<string, unknown>,
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

    const { sessionId: requestedSessionId = null, agentId = null, type = 'note' } = options;

    // HTTP/IPC callers pass an explicit world (including null). Only legacy
    // in-process callers that omit the field may inherit this process's cwd.
    const hasExplicitWorktreeId = Object.prototype.hasOwnProperty.call(options, 'worktreeId');
    const currentWorktreeId = hasExplicitWorktreeId
      ? (options.worktreeId ?? null)
      : (getWorktreeId() ?? null);

    let session: SessionRow | undefined;
    if (requestedSessionId) {
      session = stmts.getById.get(requestedSessionId) as SessionRow | undefined;
      if (!session) {
        return { success: false, error: `session ${requestedSessionId} not found`, code: 'SESSION_NOT_FOUND' };
      }
      if (session.status !== 'active') {
        return { success: false, error: `session ${requestedSessionId} is not active`, code: 'SESSION_NOT_ACTIVE' };
      }
    } else if (agentId && currentWorktreeId) {
      session = stmts.mostRecentActiveByAgentAndWorktree.get(agentId, currentWorktreeId) as SessionRow | undefined;
    } else if (agentId && hasExplicitWorktreeId) {
      session = stmts.mostRecentActiveByAgentWithoutWorktree.get(agentId) as SessionRow | undefined;
    } else if (agentId) {
      session = stmts.mostRecentActiveByAgent.get(agentId) as SessionRow | undefined;
    } else if (currentWorktreeId) {
      const sessionsInWorktree = stmts.listByStatusAndWorktree.all('active', currentWorktreeId, 2) as SessionRow[];
      if (sessionsInWorktree.length === 1) {
        session = sessionsInWorktree[0];
      } else if (sessionsInWorktree.length > 1) {
        return {
          success: false,
          error: 'multiple active sessions exist in this worktree; specify a sessionId or agentId',
          code: 'AMBIGUOUS_ACTIVE_SESSION',
        };
      }
    } else if (hasExplicitWorktreeId) {
      const sessionsWithoutWorktree = stmts.listActiveWithoutWorktree.all(2) as SessionRow[];
      if (sessionsWithoutWorktree.length === 1) {
        session = sessionsWithoutWorktree[0];
      } else if (sessionsWithoutWorktree.length > 1) {
        return {
          success: false,
          error: 'multiple active sessions exist without a Git worktree; specify a sessionId or agentId',
          code: 'AMBIGUOUS_ACTIVE_SESSION',
        };
      }
    }

    if (!session) {
      if (!agentId) {
        return {
          success: false,
          error: 'no active session found; run pd begin or pass --session/--agent',
          code: 'NO_ACTIVE_SESSION_SCOPE',
        };
      }

      const startResult = start('Quick notes', {
        agentId,
        ...(hasExplicitWorktreeId ? { worktreeId: currentWorktreeId } : {}),
      });
      if (!startResult.success) {
        return { success: false, error: 'failed to create session', code: 'SESSION_CREATE_FAILED' };
      }
      session = stmts.getById.get(startResult.id as string) as SessionRow | undefined;
      if (!session) {
        return { success: false, error: 'failed to resolve created session', code: 'SESSION_NOT_FOUND' };
      }
    }
    const sessionId = session.id;

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
    const { limit = 50, type, since, agentId, project } = options;
    const projectPattern = project ? (patternToSql(project) ?? project) : null;

    let notes: Array<SessionNoteRow & { session_purpose?: string }>;
    let total: number | null = null;

    if (sessionId) {
      // Get notes for specific session
      const session = stmts.getById.get(sessionId) as SessionRow | undefined;
      if (!session) {
        return { success: false, error: 'session not found' };
      }

      if (!type && !since && !agentId && !projectPattern) {
        // The common session-ledger and salvage path gets both an exact total
        // and a DB-bounded tail. Avoid materializing an entire long-running
        // session only to discard all but its newest few notes.
        total = (stmts.countNotesBySession.get(sessionId) as { count: number }).count;
        notes = (stmts.getRecentNotesBySession.all(sessionId, limit) as SessionNoteRow[]).reverse();
      } else if (type) {
        notes = stmts.getNotesBySessionAndType.all(sessionId, type) as SessionNoteRow[];
      } else {
        notes = stmts.getNotesBySession.all(sessionId) as SessionNoteRow[];
      }

      // Apply since/agent/project filters manually for session-specific queries if needed
      if (since) {
        notes = notes.filter(n => n.created_at >= since);
      }
      if (agentId) {
        // Simple exact match for session-specific query (usually agent matches session)
        if (session.agent_id !== agentId) notes = [];
      }
      if (projectPattern && !matchesSqlLike(projectPattern, session.identity_project)) {
        notes = [];
      }

      // Apply limit
      if (total === null) total = notes.length;
      if (notes.length > limit) {
        notes = notes.slice(Math.max(notes.length - limit, 0));
      }
    } else if (agentId || projectPattern) {
      // Get notes by agent/project pattern across sessions
      const agentPattern = agentId
        ? (patternToSql(agentId) ?? agentId.replace(/\*/g, '%'))
        : null;
      notes = stmts.getNotesByPattern.all(
        agentPattern,
        agentPattern,
        projectPattern,
        projectPattern,
        type ?? null,
        type ?? null,
        since ?? null,
        since ?? null,
        limit
      ) as Array<SessionNoteRow & { session_purpose?: string }>;
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
      total: total ?? notes.length,
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
    if (session.status !== 'active') {
      return {
        success: false,
        error: `session is ${session.status}; only active sessions can claim files`,
        code: 'SESSION_NOT_ACTIVE',
      };
    }
    const auth = authorizeFileMutation(session, options?.agentId, 'claiming');
    if (!auth.success) return auth;

    const now = Date.now();
    const claimed: string[] = [];
    const conflicts: FileConflict[] = [];
    const claimScope = claimForest.scopeForSession(session);

    // Process whole-file claims
    for (const filePath of filePaths) {
      const activeClaims = claimForest.getActiveClaimsForFileExcludingSession(filePath, sessionId, claimScope);

      for (const claim of activeClaims) {
        conflicts.push({
          filePath,
          sessionId: claim.sessionId,
          purpose: claim.purpose,
          claimedAt: claim.claimedAt,
          startLine: claim.startLine,
          endLine: claim.endLine,
          symbol: claim.symbol,
          symbolPath: claim.symbolPath,
        });
      }

      // Release any existing whole-file claim from this session first, then insert new
      stmts.releaseFile.run(now, sessionId, filePath);
      claimForest.releaseByFilePath(sessionId, filePath, now);
      const legacyResult = stmts.claimFile.run(sessionId, filePath, now, session.agent_node_id ?? null);
      claimForest.claim(claimForest.addressForSessionClaim(session, { path: filePath }), {
        sessionId,
        agentId: session.agent_id,
        agentNodeId: session.agent_node_id ?? null,
        claimedAt: now,
        observedBy: 'sessions.claimFiles',
        legacySessionFileId: Number(legacyResult.lastInsertRowid),
      });
      if (!claimed.includes(filePath)) claimed.push(filePath);
    }

    // Process region claims
    for (const region of regions) {
      const resolved = resolveRegionClaim(region);
      if (!resolved.success) {
        return { success: false, error: resolved.error, code: 'VALIDATION_ERROR' };
      }

      const { startLine, endLine, symbol, symbolPath } = resolved.claim;
      const activeClaims = claimForest.getActiveClaimsForFileExcludingSession(region.path, sessionId, claimScope);

      for (const claim of activeClaims) {
        if (!claimsConflict(
          {
            startLine: claim.startLine,
            endLine: claim.endLine,
            symbolPath: claim.symbolPath,
          },
          {
            startLine,
            endLine,
            symbolPath,
          },
        )) {
          continue;
        }
        conflicts.push({
          filePath: region.path,
          sessionId: claim.sessionId,
          purpose: claim.purpose,
          claimedAt: claim.claimedAt,
          startLine: claim.startLine,
          endLine: claim.endLine,
          symbol: claim.symbol,
          symbolPath: claim.symbolPath,
        });
      }

      const legacyResult = stmts.claimRegion.run(
        sessionId,
        region.path,
        startLine,
        endLine,
        symbol,
        symbolPath,
        now,
        session.agent_node_id ?? null,
      );
      claimForest.claim(claimForest.addressForSessionClaim(session, {
        path: region.path,
        startLine,
        endLine,
        symbol,
        symbolPath,
      }), {
        sessionId,
        agentId: session.agent_id,
        agentNodeId: session.agent_node_id ?? null,
        claimedAt: now,
        observedBy: 'sessions.claimFiles',
        legacySessionFileId: Number(legacyResult.lastInsertRowid),
      });
      if (!claimed.includes(region.path)) claimed.push(region.path);
    }

    if (activityLog && claimed.length > 0) {
      activityLog.log(ActivityType.FILE_CLAIM, {
        agentId: session.agent_id,
        targetId: sessionTarget(session.identity_project, sessionId),
        details: `Claimed ${claimed.length} file(s) for session ${sessionId}`,
        metadata: {
          sessionId,
          files: claimed,
          conflicts: conflicts.length,
          agentId: session.agent_id || undefined,
          identityProject: session.identity_project || undefined,
        } as unknown as Record<string, unknown>,
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
  function releaseFiles(sessionId: string, filePaths: string[], options?: ReleaseFilesOptions) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }

    const session = stmts.getById.get(sessionId) as SessionRow | undefined;
    if (!session) {
      return { success: false, error: 'session not found' };
    }
    if (session.status !== 'active') {
      return {
        success: false,
        error: `session is ${session.status}; only active sessions can release files`,
        code: 'SESSION_NOT_ACTIVE',
      };
    }

    const auth = authorizeFileMutation(session, options?.agentId, 'releasing');
    if (!auth.success) return auth;

    const regions = options?.regions ?? [];

    if ((!Array.isArray(filePaths) || filePaths.length === 0) && regions.length === 0) {
      return { success: false, error: 'filePaths must be a non-empty array' };
    }

    const now = Date.now();
    const released: string[] = [];

    // Release all claims for specified file paths (any region)
    for (const filePath of filePaths) {
      const result = stmts.releaseFile.run(now, sessionId, filePath);
      const forestReleased = claimForest.releaseByFilePath(sessionId, filePath, now);
      if (result.changes > 0 || forestReleased > 0) {
        released.push(filePath);
      }
    }

    // Release specific region claims
    for (const region of regions) {
      if (region.symbolPath) {
        const result = stmts.releaseRegionBySymbolPath.run(now, sessionId, region.path, region.symbolPath);
        const forestReleased = claimForest.releaseBySymbolPath(sessionId, region.path, region.symbolPath, now);
        if (result.changes > 0 || forestReleased > 0) {
          released.push(`${region.path}#${region.symbolPath}`);
        }
        continue;
      }
      const startLine = region.startLine ?? null;
      const endLine = region.endLine ?? null;
      if (startLine !== null && endLine !== null) {
        const result = stmts.releaseRegion.run(now, sessionId, region.path, startLine, endLine);
        const forestReleased = claimForest.releaseByRange(sessionId, region.path, startLine, endLine, now);
        if (result.changes > 0 || forestReleased > 0) {
          released.push(`${region.path}:${startLine}-${endLine}`);
        }
      }
    }

    if (activityLog && released.length > 0) {
      activityLog.log(ActivityType.FILE_RELEASE, {
        agentId: session.agent_id,
        targetId: sessionTarget(session.identity_project, sessionId),
        details: `Released ${released.length} file(s) from session ${sessionId}`,
        metadata: {
          sessionId,
          files: released,
          agentId: session.agent_id || undefined,
          identityProject: session.identity_project || undefined,
        } as unknown as Record<string, unknown>,
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
      const activeClaims = claimForest.getActiveClaimsForFile(filePath);
      for (const claim of activeClaims) {
        conflicts.push({
          filePath,
          sessionId: claim.sessionId,
          purpose: claim.purpose,
          claimedAt: claim.claimedAt,
          startLine: claim.startLine,
          endLine: claim.endLine,
          symbol: claim.symbol,
          symbolPath: claim.symbolPath,
        });
      }
    }

    return { conflicts };
  }

  /**
   * List sessions
   */
  function list(options: ListOptions = {}) {
    const { status, agentId, project, purpose, worktreeId, allWorktrees = false, includeNotes = false, limit = 50 } = options;

    // Auto-detect current worktree unless explicitly showing all
    const effectiveWorktreeId = allWorktrees ? null : (worktreeId ?? getWorktreeId());

    let sessions: SessionRow[];

    // Use pattern matching if wildcards are present or if multiple filters are used
    if (agentId?.includes('*') || project?.includes('*') || purpose?.includes('*') || (agentId && project) || (agentId && purpose) || (project && purpose)) {
      const agentPattern = agentId ? (agentId.includes('*') ? patternToSql(agentId) : agentId) : null;
      const projectPattern = project ? (project.includes('*') ? patternToSql(project) : project) : null;
      const purposePattern = purpose ? (purpose.includes('*') ? purpose.replace(/\*/g, '%') : '%' + purpose + '%') : null;
      
      sessions = stmts.listByPattern.all(
        status ?? null,
        agentPattern,
        projectPattern,
        purposePattern,
        effectiveWorktreeId,
        limit
      ) as SessionRow[];
    } else {
      // Fast paths for common exact matches
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
      } else if (project || purpose) {
        // Fallback to pattern matcher for project/purpose exact match
        sessions = stmts.listByPattern.all(status ?? null, null, project ?? null, purpose ?? null, effectiveWorktreeId, limit) as SessionRow[];
      } else {
        // No filter: return all sessions
        sessions = stmts.listAll.all(limit) as SessionRow[];
      }
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
    const files = claimForest.listClaimsForSession(sessionId, { includeReleased: true });

    return {
      success: true,
      session: formatSession(session),
      notes: notes.map(formatNote),
      files: files.map(formatClaimForestFile),
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
    if (session.status !== 'active' && normalizedPhase !== session.status) {
      return {
        success: false,
        error: `session is ${session.status}; terminal sessions cannot move to phase "${normalizedPhase}"`,
        code: 'SESSION_NOT_ACTIVE',
      };
    }

    const now = Date.now();
    stmts.setPhase.run(normalizedPhase, now, sessionId);

    // If phase is 'completed' or 'abandoned', also update session status
    if (normalizedPhase === 'completed' || normalizedPhase === 'abandoned') {
      stmts.updateStatus.run(normalizedPhase, now, now, sessionId);
      stmts.releaseAllFiles.run(now, sessionId);
      claimForest.releaseAllBySession(sessionId, now);
    }

    if (activityLog) {
      activityLog.log(ActivityType.SESSION_NOTE, {
        agentId: session.agent_id,
        targetId: sessionTarget(session.identity_project, sessionId),
        details: `Session ${sessionId} phase changed to ${normalizedPhase}`,
        metadata: {
          sessionId,
          phase: normalizedPhase,
          previousPhase: session.phase || 'in_progress',
          agentId: session.agent_id || undefined,
          identityProject: session.identity_project || undefined,
        } as unknown as Record<string, unknown>,
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
   * List active file claims across all sessions (global view)
   */
  function listAllActiveClaims(options: {
    path?: string;
    symbol?: string;
    symbolPath?: string;
    agentId?: string;
    purpose?: string;
    repoId?: string | null;
    worldKind?: 'worktree' | 'ref' | 'commit' | 'harbor' | null;
    worldId?: string | null;
  } = {}) {
    const { path, symbol, symbolPath, agentId, purpose, repoId, worldKind, worldId } = options;
    
    const rows = claimForest.listActiveClaims({ path, symbol, symbolPath, agentId, purpose, repoId, worldKind, worldId });

    return {
      success: true,
      claims: rows.map(r => ({
        filePath: r.filePath,
        sessionId: r.sessionId,
        purpose: r.purpose,
        agentId: r.agentId,
        phase: r.phase,
        claimedAt: r.claimedAt,
        startLine: r.startLine,
        endLine: r.endLine,
        symbol: r.symbol,
        symbolPath: r.symbolPath,
        repoId: r.repoId,
        worldKind: r.worldKind,
        worldId: r.worldId,
        nodeId: r.nodeId,
      })),
      count: rows.length,
    };
  }

  /**
   * Get who owns a specific file path, optionally filtered by line range
   */
  function getClaimOwner(filePath: string, range?: { startLine?: number; endLine?: number; symbolPath?: string }) {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'filePath must be a non-empty string', code: 'VALIDATION_ERROR' };
    }

    type ClaimOwnerRow = {
      session_id: string;
      file_path: string;
      start_line: number | null;
      end_line: number | null;
      symbol: string | null;
      symbol_path: string | null;
      claimed_at: number;
      purpose: string;
      agent_id: string | null;
      phase: string | null;
    };
    const rows = claimForest.getActiveClaimsForFile(filePath);
    const resolvedSymbol = range?.symbolPath
      ? getIndexedSymbols(filePath).find(symbol => symbol.symbolPath === range.symbolPath)
      : undefined;
    const queryStartLine = range?.startLine ?? resolvedSymbol?.startLine ?? null;
    const queryEndLine = range?.endLine ?? resolvedSymbol?.endLine ?? null;

    const owners = rows.filter(row => {
      if (!range?.symbolPath && queryStartLine == null && queryEndLine == null) {
        return true;
      }
      if (isWholeFileClaim({ startLine: row.startLine, endLine: row.endLine })) {
        return true;
      }
      if (range?.symbolPath && row.symbolPath) {
        return row.symbolPath === range.symbolPath;
      }
      if (queryStartLine != null && queryEndLine != null) {
        return rangesOverlap(row.startLine, row.endLine, queryStartLine, queryEndLine);
      }
      return false;
    });

    return {
      success: true,
      filePath,
      owners: owners.map(r => ({
        sessionId: r.sessionId,
        purpose: r.purpose,
        agentId: r.agentId,
        phase: r.phase,
        claimedAt: r.claimedAt,
        startLine: r.startLine,
        endLine: r.endLine,
        symbol: r.symbol,
        symbolPath: r.symbolPath,
        repoId: r.repoId,
        worldKind: r.worldKind,
        worldId: r.worldId,
        nodeId: r.nodeId,
      })),
      claimed: owners.length > 0,
    };
  }

  /**
   * Report old completed/abandoned sessions without deleting their evidence.
   */
  function cleanup(options: CleanupOptions = {}) {
    const { olderThan = 7 * 24 * 60 * 60 * 1000, status } = options;

    const cutoff = Date.now() - olderThan;
    let row: { count: number };

    if (status) {
      row = stmts.countCleanupOld.get(status, cutoff) as { count: number };
    } else {
      row = stmts.countCleanupOldAny.get(cutoff) as { count: number };
    }

    return {
      cleaned: 0,
      preserved: row.count,
      notesPreserved: true,
      message: 'cleanup is append-only; no sessions, notes, or claim history were deleted',
    };
  }

  /**
   * Abandon active sessions whose owning agent no longer exists in the registry.
   *
   * This repairs lifecycle drift after agent rows are deleted or lost before a
   * corresponding session end/abandon write happens.
   */
  function abandonOrphanedActive(options: AbandonOrphanedOptions = {}) {
    const { olderThan = 20 * 60 * 1000 } = options;
    const now = Date.now();
    const cutoff = now - olderThan;
    const orphaned = stmts.listOrphanedActive.all(cutoff) as SessionRow[];

    const abandoned: string[] = [];
    let releasedClaims = 0;

    for (const session of orphaned) {
      const activeFiles = stmts.getActiveFilesBySession.all(session.id) as SessionFileRow[];
      const forestReleased = claimForest.releaseAllBySession(session.id, now);
      if (activeFiles.length > 0) {
        stmts.releaseAllFiles.run(now, session.id);
      }
      const releasedFileCount = Math.max(activeFiles.length, forestReleased);
      releasedClaims += releasedFileCount;

      stmts.setPhase.run('abandoned', now, session.id);
      stmts.updateStatus.run('abandoned', now, now, session.id);

      if (semanticIndex && session.identity_project) {
        semanticIndex.unindexEntry(session.identity_project, session.id);
      }

      if (activityLog) {
        activityLog.log(ActivityType.SESSION_END, {
          agentId: session.agent_id,
          targetId: sessionTarget(session.identity_project, session.id),
          details: `Session orphaned by missing agent registry entry: ${session.id}`,
          metadata: {
            sessionId: session.id,
            status: 'abandoned',
            orphaned: true,
            orphanedAgentId: session.agent_id || undefined,
            identityProject: session.identity_project || undefined,
            releasedFiles: releasedFileCount,
          } as unknown as Record<string, unknown>,
        });
      }

      abandoned.push(session.id);
    }

    return {
      success: true,
      abandoned,
      count: abandoned.length,
      releasedClaims,
    };
  }

  /**
   * Flip an abandoned durable session back to active (called by whoami).
   *
   * Note: abandonment released the session's file claims, and resurrection
   * does NOT restore them — the agent must re-claim files it still needs.
   */
  function resurrect(sessionId: string): void {
    // Abandonment writes set phase='abandoned' and completed_at — reset both
    // so the resurrected session is coherent (active, in progress, not done).
    db.prepare(
      "UPDATE sessions SET status = 'active', phase = 'in_progress', completed_at = NULL, updated_at = ? WHERE id = ? AND is_durable = 1 AND status = 'abandoned'"
    ).run(Date.now(), sessionId);
  }

  return {
    start,
    end,
    abandon,
    abandonByAgent,
    activeSessionIdsByAgent,
    remove,
    takeover,
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
    abandonOrphanedActive,
    setActivityLog,
    resurrect,
    updateMetadata,
  };
}
