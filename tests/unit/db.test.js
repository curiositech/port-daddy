/**
 * Port Daddy - lib/db.ts Unit Tests
 *
 * Tests for the shared database module used by both daemon and CLI direct mode.
 * Batch 5: Stateless/Direct-DB mode.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  initDatabase,
  resolveDbPath,
  resolveDefaultDbRoot,
  resolvePdHome,
  resolveCanonicalDbPath,
  legacyDbCandidates,
  pickLegacyDbToAdopt,
  isPortAvailable,
  CORE_SCHEMA_SQL,
  CANONICAL_DB_FILENAME,
} from '../../lib/db.js';
import { createServices } from '../../lib/services.js';
import { createLocks } from '../../lib/locks.js';
import { createSessions } from '../../lib/sessions.js';
import Database from 'better-sqlite3';
import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('lib/db.ts', () => {
  describe('resolveDbPath', () => {
    it('returns override path when provided', () => {
      const result = resolveDbPath('/custom/path/test.db');
      expect(result).toBe('/custom/path/test.db');
    });

    it('uses PORT_DADDY_DB environment variable', () => {
      const original = process.env.PORT_DADDY_DB;
      process.env.PORT_DADDY_DB = '/env/path/test.db';
      try {
        const result = resolveDbPath();
        expect(result).toBe('/env/path/test.db');
      } finally {
        if (original) {
          process.env.PORT_DADDY_DB = original;
        } else {
          delete process.env.PORT_DADDY_DB;
        }
      }
    });

    it('defaults to the canonical home port-registry.db when nothing else is set', () => {
      // Drive the resolver with an explicit, empty-of-DB scratch home so it is
      // deterministic and never touches the real machine's DBs.
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-canonical-'));
      try {
        const env = { PORT_DADDY_HOME: home };
        // Empty candidate list => no legacy adoption, deterministic regardless
        // of what real DBs happen to exist on the test machine.
        const result = resolveDbPath(undefined, env, []);
        expect(result).toBe(path.join(home, 'port-registry.db'));
        expect(result).toMatch(/port-registry\.db$/);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it('uses the distribution resource root when running from a compiled binary', () => {
      const result = resolveDefaultDbRoot(
        '/$bunfs/root/lib',
        {},
        '/opt/port-daddy/dist/daemon/port-daddy-daemon',
      );

      expect(result).toBe('/opt/port-daddy');
    });

    it('honors PORT_DADDY_RESOURCE_DIR for default DB placement', () => {
      const result = resolveDefaultDbRoot(
        '/$bunfs/root/lib',
        { PORT_DADDY_RESOURCE_DIR: '/srv/port-daddy' },
        '/tmp/port-daddy-daemon',
      );

      expect(result).toBe('/srv/port-daddy');
    });
  });

  describe('canonical home + DB path resolution', () => {
    it('resolvePdHome honors PORT_DADDY_HOME first', () => {
      expect(resolvePdHome({ PORT_DADDY_HOME: '/srv/pd', PORT_DADDY_PREFIX: '/dev/pd' }))
        .toBe('/srv/pd');
    });

    it('resolvePdHome falls back to PORT_DADDY_PREFIX', () => {
      expect(resolvePdHome({ PORT_DADDY_PREFIX: '/dev/pd' })).toBe('/dev/pd');
    });

    it('resolvePdHome defaults to ~/.port-daddy', () => {
      expect(resolvePdHome({})).toBe(path.join(os.homedir(), '.port-daddy'));
    });

    it('canonical path uses the single canonical filename under home', () => {
      expect(CANONICAL_DB_FILENAME).toBe('port-registry.db');
      expect(resolveCanonicalDbPath({ PORT_DADDY_HOME: '/srv/pd' }))
        .toBe('/srv/pd/port-registry.db');
    });

    it('legacyDbCandidates includes the dev-prefix port-daddy.db and brew var dir', () => {
      const cands = legacyDbCandidates({ PORT_DADDY_PREFIX: '/dev/pd' });
      expect(cands).toContain('/dev/pd/port-daddy.db');
      expect(cands).toContain('/opt/homebrew/var/port-daddy/port-registry.db');
    });
  });

  describe('resolveDbPath data-safety adoption', () => {
    let scratch;
    beforeEach(() => {
      scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-adopt-'));
    });
    afterEach(() => {
      fs.rmSync(scratch, { recursive: true, force: true });
    });

    const writeDb = (p, bytes) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.alloc(bytes, 1));
      return p;
    };

    it('explicit override wins over everything', () => {
      const env = { PORT_DADDY_HOME: scratch, PORT_DADDY_DB: '/env/x.db' };
      expect(resolveDbPath('/explicit/y.db', env)).toBe('/explicit/y.db');
    });

    it('PORT_DADDY_DB env wins over canonical + legacy', () => {
      const home = path.join(scratch, 'home');
      writeDb(path.join(home, 'port-registry.db'), 4096); // canonical present
      const env = { PORT_DADDY_HOME: home, PORT_DADDY_DB: '/env/win.db' };
      expect(resolveDbPath(undefined, env)).toBe('/env/win.db');
    });

    it('chooses the canonical path when it exists and is non-empty', () => {
      const home = path.join(scratch, 'home');
      const canonical = writeDb(path.join(home, 'port-registry.db'), 4096);
      const legacy = writeDb(path.join(scratch, 'brew', 'port-registry.db'), 999999);
      const env = { PORT_DADDY_HOME: home };
      // Canonical present => used even though legacy is bigger.
      expect(resolveDbPath(undefined, env, [legacy])).toBe(canonical);
    });

    it('ADOPTS a legacy DB when canonical is absent (no data loss)', () => {
      const home = path.join(scratch, 'home'); // no canonical file created
      const legacy = writeDb(path.join(scratch, 'brew', 'port-registry.db'), 999999);
      const env = { PORT_DADDY_HOME: home };
      expect(resolveDbPath(undefined, env, [legacy])).toBe(legacy);
    });

    it('ADOPTS the largest legacy DB (the live registry over a stale stub)', () => {
      const home = path.join(scratch, 'home');
      const small = writeDb(path.join(scratch, 'repo', 'port-registry.db'), 1024);
      const big = writeDb(path.join(scratch, 'brew', 'port-registry.db'), 5_000_000);
      const env = { PORT_DADDY_HOME: home };
      expect(resolveDbPath(undefined, env, [small, big])).toBe(big);
      expect(pickLegacyDbToAdopt(env, [small, big])).toBe(big);
    });

    it('treats a 0-byte canonical stub as absent and adopts legacy', () => {
      const home = path.join(scratch, 'home');
      writeDb(path.join(home, 'port-registry.db'), 0); // empty stub, like ~/.port-daddy was
      const legacy = writeDb(path.join(scratch, 'brew', 'port-registry.db'), 999999);
      const env = { PORT_DADDY_HOME: home };
      expect(resolveDbPath(undefined, env, [legacy])).toBe(legacy);
    });

    it('adopts a dev-prefix legacy port-daddy.db when canonical absent', () => {
      const prefix = path.join(scratch, 'prefix');
      const legacy = writeDb(path.join(prefix, 'port-daddy.db'), 8192);
      const env = { PORT_DADDY_PREFIX: prefix };
      // The dev-prefix port-daddy.db must be among the env-derived candidates...
      expect(legacyDbCandidates(env)).toContain(legacy);
      // ...and adopted when it is the only candidate present on disk. (We scope
      // to that one candidate so the test is deterministic regardless of any
      // real DBs that happen to exist on the machine running the suite.)
      expect(resolveDbPath(undefined, env, [legacy])).toBe(legacy);
    });

    it('no-op fresh install: canonical path when nothing exists anywhere', () => {
      const home = path.join(scratch, 'fresh');
      const env = { PORT_DADDY_HOME: home };
      expect(resolveDbPath(undefined, env, [])).toBe(path.join(home, 'port-registry.db'));
    });

    it('daemon and CLI resolve to the SAME path given the same env (parity)', () => {
      // Simulate the daemon (server.ts now calls resolveDbPath() with no manual
      // prefix override) and the CLI (also resolveDbPath()) under identical env.
      const home = path.join(scratch, 'home');
      const canonical = writeDb(path.join(home, 'port-registry.db'), 4096);
      const env = { PORT_DADDY_HOME: home };
      const daemonPath = resolveDbPath(undefined, env);
      const cliPath = resolveDbPath(undefined, env);
      expect(daemonPath).toBe(cliPath);
      expect(daemonPath).toBe(canonical);
    });

    it('prefix-mode daemon and CLI agree on canonical filename (no port-daddy.db split)', () => {
      const prefix = path.join(scratch, 'devprefix');
      // Fresh prefix, nothing on disk: both resolve <prefix>/port-registry.db.
      const env = { PORT_DADDY_PREFIX: prefix };
      const expected = path.join(prefix, 'port-registry.db');
      expect(resolveDbPath(undefined, env, [])).toBe(expected);
    });
  });

  describe('CORE_SCHEMA_SQL', () => {
    it('contains all required table definitions', () => {
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS services');
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS endpoints');
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS messages');
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS projects');
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS sessions');
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS session_files');
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS session_notes');
    });

    it('includes necessary indexes', () => {
      expect(CORE_SCHEMA_SQL).toContain('idx_services_port');
      expect(CORE_SCHEMA_SQL).toContain('idx_sessions_status');
      expect(CORE_SCHEMA_SQL).toContain('idx_session_notes_session');
    });
  });

  describe('initDatabase', () => {
    let db;

    afterEach(() => {
      if (db) {
        db.close();
        db = null;
      }
    });

    it('creates in-memory database with inMemory: true', () => {
      db = initDatabase({ inMemory: true });
      expect(db).toBeDefined();
      // Verify WAL mode is set (in-memory always returns "memory")
      const journalMode = db.pragma('journal_mode', { simple: true });
      expect(['wal', 'memory']).toContain(journalMode);
    });

    it('enables foreign keys', () => {
      db = initDatabase({ inMemory: true });
      const fkStatus = db.pragma('foreign_keys', { simple: true });
      expect(fkStatus).toBe(1);
    });

    it('creates all core tables', () => {
      db = initDatabase({ inMemory: true });

      const tables = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all().map(r => r.name);

      expect(tables).toContain('services');
      expect(tables).toContain('endpoints');
      expect(tables).toContain('messages');
      expect(tables).toContain('projects');
      expect(tables).toContain('sessions');
      expect(tables).toContain('session_files');
      expect(tables).toContain('session_notes');
    });

    it('is idempotent - can be called multiple times', () => {
      db = initDatabase({ inMemory: true });

      // Insert some data
      db.prepare('INSERT INTO services (id, port, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .run('test-svc', 3000, Date.now(), Date.now());

      // Re-run schema (should not error or lose data)
      db.exec(CORE_SCHEMA_SQL);

      const svc = db.prepare('SELECT id FROM services WHERE id = ?').get('test-svc');
      expect(svc).toBeDefined();
      expect(svc.id).toBe('test-svc');
    });

    it('migrates legacy session_files tables before creating symbol_path indexes', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'port-daddy-db-legacy-'));
      const dbPath = path.join(tempDir, 'port-registry.db');
      const legacyDb = new Database(dbPath);

      legacyDb.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          purpose TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          phase TEXT DEFAULT 'in_progress',
          agent_id TEXT,
          worktree_id TEXT,
          identity_project TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_sessions_status ON sessions(status);
        CREATE INDEX idx_sessions_agent ON sessions(agent_id);
        CREATE INDEX idx_sessions_worktree ON sessions(worktree_id);
        CREATE INDEX idx_sessions_identity_project ON sessions(identity_project);
        CREATE TABLE session_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          file_path TEXT NOT NULL,
          start_line INTEGER,
          end_line INTEGER,
          symbol TEXT,
          claimed_at INTEGER NOT NULL,
          released_at INTEGER
        );
        CREATE INDEX idx_session_files_path ON session_files(file_path);
      `);
      legacyDb.close();

      try {
        db = initDatabase({ dbPath });

        const columns = db.prepare("PRAGMA table_info(session_files)").all().map(r => r.name);
        const indexes = db.prepare("PRAGMA index_list(session_files)").all().map(r => r.name);

        expect(columns).toContain('symbol_path');
        expect(indexes).toContain('idx_session_files_symbol_path');
      } finally {
        db?.close();
        db = null;
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('isPortAvailable', () => {
    it('returns true for available port', async () => {
      // Port 59999 is unlikely to be in use
      const available = await isPortAvailable(59999);
      expect(available).toBe(true);
    });

    it('returns false for port in use', async () => {
      // Start a server on a random port
      const server = net.createServer();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      try {
        const available = await isPortAvailable(port);
        expect(available).toBe(false);
      } finally {
        server.close();
      }
    });

    it('completes quickly (< 100ms)', async () => {
      const start = Date.now();
      await isPortAvailable(59998);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });
});

describe('Direct-DB Mode: Tier 1 Operations', () => {
  let db;
  let services;
  let locks;
  let sessions;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    services = createServices(db);
    locks = createLocks(db);
    sessions = createSessions(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  describe('Services (claim/release/find)', () => {
    it('claim works without daemon', () => {
      const result = services.claim('direct-test:api');
      expect(result.success).toBe(true);
      expect(result.port).toBeGreaterThan(0);
      expect(result.id).toBe('direct-test:api');
    });

    it('release works without daemon', () => {
      services.claim('direct-release-test');
      const result = services.release('direct-release-test');
      expect(result.success).toBe(true);
    });

    it('find works without daemon', () => {
      services.claim('find-test-1');
      services.claim('find-test-2');

      // find() takes idOrPattern as first arg, '*' for all
      const result = services.find('*');
      expect(result.success).toBe(true);
      expect(result.services.length).toBe(2);
      expect(result.count).toBe(2);
    });

    it('claims persist across service reinitialization', () => {
      // Simulate CLI direct mode followed by daemon startup
      const result1 = services.claim('persist-test', { port: 4567 });
      expect(result1.port).toBe(4567);

      // Create new services instance (like daemon would)
      const services2 = createServices(db);
      const result2 = services2.find('persist-test');
      expect(result2.success).toBe(true);
      expect(result2.services.length).toBe(1);
      expect(result2.services[0].port).toBe(4567);
    });
  });

  describe('Locks', () => {
    it('acquire works without daemon', () => {
      const result = locks.acquire('direct-lock-test', { ttl: 10000 });
      expect(result.success).toBe(true);
      // Successful acquire returns name, owner, acquiredAt, expiresAt (not "acquired")
      expect(result.name).toBe('direct-lock-test');
    });

    it('release works without daemon', () => {
      locks.acquire('direct-lock-release', { ttl: 10000 });
      const result = locks.release('direct-lock-release');
      expect(result.success).toBe(true);
    });

    it('list works without daemon', () => {
      locks.acquire('lock-1', { ttl: 10000 });
      locks.acquire('lock-2', { ttl: 10000 });

      const result = locks.list();
      expect(result.locks.length).toBe(2);
    });
  });

  describe('Sessions', () => {
    it('start works without daemon', () => {
      const result = sessions.start('Direct mode testing');
      expect(result.success).toBe(true);
      // sessions.start returns 'id' not 'sessionId'
      expect(result.id).toMatch(/^session-/);
    });

    it('end works without daemon', () => {
      const start = sessions.start('Session to end');
      // use start.id (not sessionId)
      const result = sessions.end(start.id, { status: 'completed' });
      expect(result.success).toBe(true);
    });

    it('list works without daemon', () => {
      sessions.start('Session 1');
      sessions.start('Session 2');

      const result = sessions.list({ status: 'active' });
      expect(result.count).toBe(2);
    });
  });

  describe('Notes', () => {
    it('quickNote works without daemon when explicitly scoped to a session', () => {
      const started = sessions.start('Direct mode notes session');
      const result = sessions.quickNote('Testing direct mode notes', { sessionId: started.id });
      expect(result.success).toBe(true);
      expect(result.noteId).toBeDefined();
      expect(result.sessionId).toBe(started.id);
    });

    it('addNote works without daemon', () => {
      const start = sessions.start('Note testing session');
      // Use start.id (not sessionId)
      const result = sessions.addNote(start.id, 'Test note content');
      expect(result.success).toBe(true);
    });

    it('getNotes works without daemon', () => {
      const start = sessions.start('Get notes test');
      sessions.addNote(start.id, 'Note 1');
      sessions.addNote(start.id, 'Note 2');

      const result = sessions.getNotes(start.id);
      expect(result.notes.length).toBe(2);
    });
  });
});

describe('Direct-DB Mode: Concurrent Operations (WAL)', () => {
  let db1;
  let db2;
  let tempDbPath;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `port-daddy-wal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  });

  afterEach(() => {
    if (db1) {
      db1.close();
      db1 = null;
    }
    if (db2) {
      db2.close();
      db2 = null;
    }
    // Cleanup temp files
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(tempDbPath + '-wal')) fs.unlinkSync(tempDbPath + '-wal');
      if (fs.existsSync(tempDbPath + '-shm')) fs.unlinkSync(tempDbPath + '-shm');
    } catch {
      // Ignore cleanup errors
    }
  });

  it('two connections can write concurrently', () => {
    db1 = initDatabase({ dbPath: tempDbPath });
    db2 = initDatabase({ dbPath: tempDbPath });

    const services1 = createServices(db1);
    const services2 = createServices(db2);

    // Both connections write
    const result1 = services1.claim('concurrent-1', { port: 5001 });
    const result2 = services2.claim('concurrent-2', { port: 5002 });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Both can read each other's data
    const find1 = services1.find('*');
    const find2 = services2.find('*');

    expect(find1.services.length).toBe(2);
    expect(find2.services.length).toBe(2);
  });

  it('direct-mode claim is visible to daemon-mode', () => {
    // CLI direct mode writes
    db1 = initDatabase({ dbPath: tempDbPath });
    const cliServices = createServices(db1);
    cliServices.claim('cli-claim', { port: 6001 });
    db1.close();
    db1 = null;

    // Daemon mode reads
    db2 = initDatabase({ dbPath: tempDbPath });
    const daemonServices = createServices(db2);
    const result = daemonServices.find('cli-claim');

    expect(result.success).toBe(true);
    expect(result.services.length).toBe(1);
    expect(result.services[0].port).toBe(6001);
  });

  it('sessions from CLI are visible to daemon', () => {
    // CLI direct mode creates session and note
    db1 = initDatabase({ dbPath: tempDbPath });
    const cliSessions = createSessions(db1);
    const session = cliSessions.start('CLI direct mode session');
    cliSessions.addNote(session.id, 'Note from CLI');
    db1.close();
    db1 = null;

    // Daemon mode reads
    db2 = initDatabase({ dbPath: tempDbPath });
    const daemonSessions = createSessions(db2);

    const list = daemonSessions.list({});
    expect(list.count).toBe(1);
    expect(list.sessions[0].purpose).toBe('CLI direct mode session');

    const notes = daemonSessions.getNotes(session.id);
    expect(notes.notes.length).toBe(1);
    expect(notes.notes[0].content).toBe('Note from CLI');
  });

  it('locks from CLI are visible to daemon', () => {
    // CLI acquires lock
    db1 = initDatabase({ dbPath: tempDbPath });
    const cliLocks = createLocks(db1);
    cliLocks.acquire('cli-lock', { ttl: 60000 });
    db1.close();
    db1 = null;

    // Daemon sees the lock
    db2 = initDatabase({ dbPath: tempDbPath });
    const daemonLocks = createLocks(db2);

    const list = daemonLocks.list();
    expect(list.locks.length).toBe(1);
    expect(list.locks[0].name).toBe('cli-lock');

    // And cannot acquire the same lock (no 'acquired' field - check success is false)
    const acquire = daemonLocks.acquire('cli-lock');
    expect(acquire.success).toBe(false);
  });
});

describe('Direct-DB Mode: Edge Cases', () => {
  let db;

  afterEach(() => {
    if (db) {
      db.close();
      db = null;
    }
  });

  it('handles expired services gracefully', () => {
    db = initDatabase({ inMemory: true });
    const services = createServices(db);

    // Claim with immediate expiry (negative value relative to now)
    services.claim('expired-test', { expires: -1000 }); // expired 1 second ago

    // cleanup returns { cleaned } not { released }
    const cleanup = services.cleanup();
    expect(cleanup.cleaned).toBeGreaterThanOrEqual(1);

    // Should no longer be found
    const find = services.find('expired-test');
    expect(find.services.length).toBe(0);
  });

  it('handles expired locks gracefully', () => {
    db = initDatabase({ inMemory: true });
    const locks = createLocks(db);

    // Create lock directly in DB that's already expired
    // locks table has: name, owner, acquired_at, expires_at
    const now = Date.now();
    db.prepare(`
      INSERT INTO locks (name, owner, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run('expired-lock', 'old-owner', now - 10000, now - 5000);

    // cleanup should remove expired lock
    const cleanup = locks.cleanup();
    expect(cleanup.cleaned).toBeGreaterThanOrEqual(1);

    // New acquisition should succeed since lock expired
    const acquire = locks.acquire('expired-lock', { ttl: 10000 });
    expect(acquire.success).toBe(true);
  });

  it('cascade deletes work for sessions', () => {
    db = initDatabase({ inMemory: true });
    const sessions = createSessions(db);

    // Create session with files and notes
    const session = sessions.start('Cascade test');
    sessions.claimFiles(session.id, ['/path/to/file1.ts', '/path/to/file2.ts']);
    sessions.addNote(session.id, 'Note 1');
    sessions.addNote(session.id, 'Note 2');

    // Verify they exist (sessions.get returns { success, session, notes, files })
    const before = sessions.get(session.id);
    expect(before.success).toBe(true);
    expect(before.session).toBeDefined();
    expect(before.files.length).toBe(2);
    expect(before.notes.length).toBe(2);

    // Delete session
    sessions.remove(session.id);

    // Session and associated data should be gone
    const after = sessions.get(session.id);
    expect(after.success).toBe(false);

    // Direct DB check that orphans don't remain
    const orphanFiles = db.prepare('SELECT * FROM session_files WHERE session_id = ?').all(session.id);
    const orphanNotes = db.prepare('SELECT * FROM session_notes WHERE session_id = ?').all(session.id);
    expect(orphanFiles.length).toBe(0);
    expect(orphanNotes.length).toBe(0);
  });
});
