/**
 * Unit Test Setup - In-memory SQLite for fast, isolated tests
 *
 * Each test gets a fresh database instance to prevent cross-test pollution.
 * No network calls, no filesystem operations.
 */

import Database from 'better-sqlite3';

/**
 * Create an in-memory database with Port Daddy schema
 * @returns {Database.Database} SQLite database instance
 */
export function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // V1 schema (for backwards compatibility)
  db.exec(`
    CREATE TABLE IF NOT EXISTS port_assignments (
      port INTEGER PRIMARY KEY,
      project TEXT NOT NULL,
      pid INTEGER NOT NULL,
      started INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project ON port_assignments(project);
    CREATE INDEX IF NOT EXISTS idx_pid ON port_assignments(pid);
  `);

  // V2 schema - Services
  db.exec(`
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
  `);

  // V2 schema - Messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      payload TEXT NOT NULL,
      sender TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, created_at);
  `);

  // V2 schema - Locks
  db.exec(`
    CREATE TABLE IF NOT EXISTS locks (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      pid INTEGER,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_locks_owner ON locks(owner);
    CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at);
  `);

  // V2 schema - Agents
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      pid INTEGER,
      type TEXT DEFAULT 'cli',
      registered_at INTEGER NOT NULL,
      last_heartbeat INTEGER NOT NULL,
      max_services INTEGER DEFAULT 10,
      max_locks INTEGER DEFAULT 5,
      metadata TEXT,
      worktree_id TEXT,
      identity_project TEXT,
      identity_stack TEXT,
      identity_context TEXT,
      purpose TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(last_heartbeat);
    CREATE INDEX IF NOT EXISTS idx_agents_worktree ON agents(worktree_id);
    CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(identity_project);
  `);

  // V2 schema - Activity Log
  // NOTE: activity.js creates its own table with `timestamp` column.
  // We intentionally omit it here so createActivityLog(db) can create it
  // with the correct schema. Other modules don't depend on this table.

  // V2 schema - Webhooks
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT,
      events TEXT NOT NULL,
      filter_pattern TEXT,
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_triggered INTEGER,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_attempt INTEGER,
      response_status INTEGER,
      response_body TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(status);
  `);

  // V2 schema - Projects
  db.exec(`
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
  `);

  // V2 schema - Sessions & Notes
  // NOTE: sessions.ts creates its own tables via createSessions(db).
  // We pre-create them here so tests that use createSessions don't
  // double-create, and so the schema is visible in one place.
  db.pragma('foreign_keys = ON');
  db.exec(`
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
  `);

  return db;
}

/**
 * Create a mock logger for tests
 * @returns {Object} Mock logger with all standard methods
 */
export function createMockLogger() {
  const logs = {
    info: [],
    warn: [],
    error: [],
    debug: []
  };

  return {
    info: (...args) => logs.info.push(args),
    warn: (...args) => logs.warn.push(args),
    error: (...args) => logs.error.push(args),
    debug: (...args) => logs.debug.push(args),
    getLogs: () => logs,
    clear: () => {
      logs.info = [];
      logs.warn = [];
      logs.error = [];
      logs.debug = [];
    }
  };
}

/**
 * Create mock fetch for webhook tests
 * @param {Object} options - Response options
 * @returns {Function} Mock fetch function
 */
export function createMockFetch(options = {}) {
  const {
    status = 200,
    body = 'OK',
    shouldFail = false,
    failMessage = 'Network error'
  } = options;

  const calls = [];

  const mockFetch = async (url, opts) => {
    calls.push({ url, opts });

    if (shouldFail) {
      throw new Error(failMessage);
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: async () => body
    };
  };

  mockFetch.calls = calls;
  mockFetch.getCalls = () => calls;
  mockFetch.reset = () => { calls.length = 0; };

  return mockFetch;
}

/**
 * Wait for a condition to be true
 * @param {Function} condition - Function that returns boolean
 * @param {number} timeout - Max wait time in ms
 * @param {number} interval - Check interval in ms
 */
export async function waitFor(condition, timeout = 1000, interval = 10) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
