/**
 * Port Daddy - Shared Database Module
 *
 * Centralizes DB initialization logic so both the daemon (server.ts) and
 * the CLI's direct-DB mode can open the same database with identical schema.
 *
 * Schema creation uses CREATE TABLE IF NOT EXISTS throughout, so it's safe
 * to call multiple times (idempotent).  Individual modules (locks, agents,
 * sessions, etc.) also self-initialize their own tables, but this module
 * ensures the "server-owned" tables (services, endpoints, messages, projects,
 * sessions, session_files, session_notes) exist before any module is loaded.
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname: string = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// DB path resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the path to the SQLite database file.
 * Priority:
 *   1. Explicit override (parameter)
 *   2. PORT_DADDY_DB environment variable
 *   3. Default: <project-root>/port-registry.db
 */
export function resolveDbPath(overridePath?: string): string {
  if (overridePath) return overridePath;
  if (process.env.PORT_DADDY_DB) return process.env.PORT_DADDY_DB;
  // lib/ is one level below the project root
  return join(__dirname, '..', 'port-registry.db');
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema SQL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The complete schema DDL for the core tables that server.ts owns.
 * Individual modules (locks, agents, webhooks, activity) create their own
 * tables when they initialize — this covers the rest.
 */
export const CORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY,
    port INTEGER UNIQUE,
    pid INTEGER,
    cmd TEXT,
    cwd TEXT,
    status TEXT DEFAULT 'assigned',
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER,
    restart_policy TEXT DEFAULT 'never',
    health_url TEXT,
    tunnel_provider TEXT,
    tunnel_url TEXT,
    paired_with TEXT,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_services_port ON services(port);
  CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);

  CREATE TABLE IF NOT EXISTS endpoints (
    service_id TEXT NOT NULL,
    env TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (service_id, env)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL,
    sender TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, created_at);

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    root TEXT NOT NULL,
    type TEXT DEFAULT 'single',
    config TEXT,
    services TEXT,
    last_scanned INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    agent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);

  CREATE TABLE IF NOT EXISTS session_files (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    claimed_at INTEGER NOT NULL,
    released_at INTEGER,
    PRIMARY KEY (session_id, file_path)
  );
  CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(file_path);

  CREATE TABLE IF NOT EXISTS session_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'note',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_session_notes_session ON session_notes(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_session_notes_type ON session_notes(type);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Database initialization
// ─────────────────────────────────────────────────────────────────────────────

export interface InitDbOptions {
  /** Override the default DB file path */
  dbPath?: string;
  /** Use ':memory:' for tests (ignores dbPath) */
  inMemory?: boolean;
}

/**
 * Open (or create) the SQLite database with WAL mode and full schema.
 *
 * This is the single entry point for obtaining a database handle.
 * Both server.ts and the CLI's direct-DB mode use this.
 */
export function initDatabase(options: InitDbOptions = {}): Database.Database {
  const path = options.inMemory ? ':memory:' : resolveDbPath(options.dbPath);
  const db = new Database(path);

  // WAL mode for concurrent read/write performance
  db.pragma('journal_mode = WAL');

  // Reduce fsync calls: NORMAL is safe with WAL (data survives process crash,
  // only at risk during OS crash — acceptable for a local dev tool)
  db.pragma('synchronous = NORMAL');

  // Checkpoint WAL more frequently (default 1000 pages ≈ 4MB).
  // 200 pages ≈ 800KB keeps WAL compact and prevents unbounded growth.
  db.pragma('wal_autocheckpoint = 200');

  // Busy timeout: wait up to 5 seconds for locks instead of failing immediately
  // This is critical for concurrent CLI invocations sharing the same DB
  db.pragma('busy_timeout = 5000');

  // Foreign key enforcement (needed for CASCADE deletes on sessions)
  db.pragma('foreign_keys = ON');

  // Create core tables
  db.exec(CORE_SCHEMA_SQL);

  return db;
}

/**
 * Check whether a port is free at the OS level by attempting a quick bind().
 * Returns true if the port is available, false if it's in use.
 *
 * Used in direct-DB mode where the daemon's systemPorts check isn't available.
 * The bind() test takes ~1-5ms, well within acceptable latency.
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Lazy import to keep module lightweight for non-direct-mode usage
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    import('net').then(({ createServer }) => {
      const server = createServer();
      server.once('error', () => {
        resolve(false);
      });
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  });
}
