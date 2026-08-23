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
  durableDbHomePath,
  legacyDbPath,
  legacyDbCandidates,
  siblingKegDbPaths,
  isVersionVolatileDbPath,
  migrateLegacyRegistry,
  verifyRescuedRegistry,
  verifyCoreSchema,
  isPortAvailable,
  CORE_SCHEMA_SQL,
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

    it('defaults to the durable home ~/.port-daddy/port-registry.db, never a checkout- or binary-relative path', () => {
      const original = process.env.PORT_DADDY_DB;
      delete process.env.PORT_DADDY_DB;
      try {
        const result = resolveDbPath();
        expect(result).toBe(path.join(os.homedir(), '.port-daddy', 'port-registry.db'));
        expect(result).toBe(durableDbHomePath());
      } finally {
        if (original) {
          process.env.PORT_DADDY_DB = original;
        }
      }
    });

    it('flags version-volatile (Homebrew Cellar) paths', () => {
      expect(isVersionVolatileDbPath('/opt/homebrew/Cellar/port-daddy/3.24.1_1/bin/port-registry.db')).toBe(true);
      expect(isVersionVolatileDbPath(durableDbHomePath())).toBe(false);
      expect(isVersionVolatileDbPath('/srv/port-daddy/port-registry.db')).toBe(false);
    });

    it('legacyDbPath anchors on the distribution root', () => {
      const result = legacyDbPath(
        '/$bunfs/root/lib',
        {},
        '/opt/port-daddy/dist/daemon/port-daddy-daemon',
      );
      expect(result).toBe('/opt/port-daddy/port-registry.db');
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

  describe('migrateLegacyRegistry', () => {
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-migrate-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    function makeLegacyDb(dbPath) {
      const db = new Database(dbPath);
      db.exec('CREATE TABLE marker (v TEXT)');
      db.prepare('INSERT INTO marker (v) VALUES (?)').run('legacy-truth');
      db.close();
    }

    it('rescues a legacy registry into the durable home', () => {
      const source = path.join(dir, 'cellar', 'port-registry.db');
      const dest = path.join(dir, 'home', 'port-registry.db');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      makeLegacyDb(source);

      expect(migrateLegacyRegistry(dest, source)).toBe(true);
      expect(fs.existsSync(dest)).toBe(true);
      const db = new Database(dest, { readonly: true });
      expect(db.prepare('SELECT v FROM marker').get().v).toBe('legacy-truth');
      db.close();
      // Legacy file is left in place (read-only rescue).
      expect(fs.existsSync(source)).toBe(true);
    });

    it('is a no-op when the destination already exists', () => {
      const source = path.join(dir, 'port-registry.db');
      const dest = path.join(dir, 'existing.db');
      makeLegacyDb(source);
      fs.writeFileSync(dest, '');
      expect(migrateLegacyRegistry(dest, source)).toBe(false);
    });

    it('is a no-op when there is no legacy registry', () => {
      expect(migrateLegacyRegistry(path.join(dir, 'dest.db'), path.join(dir, 'missing.db'))).toBe(false);
    });

    it('is a no-op when source and destination are the same file', () => {
      const p = path.join(dir, 'same.db');
      makeLegacyDb(p);
      expect(migrateLegacyRegistry(p, p)).toBe(false);
    });

    it('rescues from a sibling brew keg when the primary legacy path is empty (post-upgrade)', () => {
      // Simulate: new keg 3.25.0 (no registry, where the new binary resolves),
      // old keg 3.24.1_1 still holding the data.
      const cellar = path.join(dir, 'Cellar', 'port-daddy');
      const newKegDb = path.join(cellar, '3.25.0', 'bin', 'port-registry.db');
      const oldKegDb = path.join(cellar, '3.24.1_1', 'bin', 'port-registry.db');
      const dest = path.join(dir, 'home', 'port-registry.db');
      fs.mkdirSync(path.dirname(newKegDb), { recursive: true });
      fs.mkdirSync(path.dirname(oldKegDb), { recursive: true });
      makeLegacyDb(oldKegDb);

      const execPath = path.join(cellar, '3.25.0', 'bin', 'port-daddy-daemon');
      const candidates = legacyDbCandidates(newKegDb, execPath);
      expect(candidates[0]).toBe(newKegDb); // primary first
      expect(candidates).toContain(oldKegDb); // sibling keg discovered

      expect(migrateLegacyRegistry(dest, candidates)).toBe(true);
      const db = new Database(dest, { readonly: true });
      expect(db.prepare('SELECT v FROM marker').get().v).toBe('legacy-truth');
      db.close();
    });

    it('quarantines a rescue that fails post-apply verification', () => {
      // A source that VACUUMs into a file with no tables cannot exist in
      // practice, so exercise the probe directly plus the corrupt-source path.
      const garbage = path.join(dir, 'garbage.db');
      fs.writeFileSync(garbage, 'this is not a sqlite database, not even close');
      const dest = path.join(dir, 'home', 'port-registry.db');
      expect(migrateLegacyRegistry(dest, garbage)).toBe(false);
      expect(fs.existsSync(dest)).toBe(false);
    });

    it('verifyRescuedRegistry accepts a real registry and rejects garbage', () => {
      const good = path.join(dir, 'good.db');
      makeLegacyDb(good);
      expect(verifyRescuedRegistry(good)).toBe(true);

      const garbage = path.join(dir, 'bad.db');
      fs.writeFileSync(garbage, 'nope');
      expect(verifyRescuedRegistry(garbage)).toBe(false);
      expect(verifyRescuedRegistry(path.join(dir, 'missing.db'))).toBe(false);
    });

    it('verifyCoreSchema passes on a freshly initialized DB and throws on a gutted one', () => {
      const db = initDatabase({ inMemory: true });
      expect(() => verifyCoreSchema(db)).not.toThrow();
      db.exec('DROP TABLE roadmap_item_status_events');
      expect(() => verifyCoreSchema(db)).toThrow(/roadmap_item_status_events/);
      db.close();

      const bare = new Database(':memory:');
      bare.exec('CREATE TABLE services (id TEXT); CREATE TABLE sessions (id TEXT)');
      expect(() => verifyCoreSchema(bare)).toThrow(/Schema verification failed/);
      bare.close();
    });

    it('verifyCoreSchema catches a missing deleted_at tombstone column specifically', () => {
      const db = initDatabase({ inMemory: true });
      db.exec('DROP INDEX idx_roadmap_items_live');
      db.exec('ALTER TABLE roadmap_items DROP COLUMN deleted_at');
      expect(() => verifyCoreSchema(db)).toThrow(/roadmap_items\.deleted_at/);
      db.close();
    });

    // Each guarded ALTER block has its OWN sentinel, so each needs its own
    // probe. `source_refs_json` is added by a separate ALTER from the seven
    // ADR-0086 planner columns, so `kind` being present proves nothing about
    // it. Without this probe a DB whose provenance ALTER failed (the block is
    // warn-and-continue) boots "verified" and then fails every roadmap write
    // with `no such column: source_refs_json`.
    it('verifyCoreSchema catches a missing source_refs_json provenance column specifically', () => {
      const db = initDatabase({ inMemory: true });
      expect(() => verifyCoreSchema(db)).not.toThrow();
      db.exec('ALTER TABLE roadmap_items DROP COLUMN source_refs_json');
      expect(() => verifyCoreSchema(db)).toThrow(/roadmap_items\.source_refs_json/);
      db.close();
    });

    it('initDatabase runs the PRAGMA-guarded ALTER on a legacy (pre-tombstone) DB file', () => {
      // A DB created from the OLD schema — no deleted_at, no live index.
      const legacyPath = path.join(dir, 'legacy-schema.db');
      const legacy = new Database(legacyPath);
      legacy.exec(`
        CREATE TABLE roadmap_items (
          id TEXT PRIMARY KEY, slug TEXT NOT NULL, summary_md TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'backlog',
          promoted_from_feedback_id TEXT, promoted_by_agent_id TEXT, promoted_at INTEGER,
          last_touched_at INTEGER NOT NULL, dependencies_json TEXT NOT NULL DEFAULT '[]',
          notes_json TEXT NOT NULL DEFAULT '[]', harbor TEXT NOT NULL,
          created_at INTEGER NOT NULL, UNIQUE(slug, harbor)
        );
      `);
      legacy.prepare(
        "INSERT INTO roadmap_items (id, slug, summary_md, last_touched_at, harbor, created_at) VALUES ('x', 's', 'm', 1, 'fleet', 1)",
      ).run();
      legacy.close();

      const migrated = initDatabase({ dbPath: legacyPath });
      const cols = migrated.prepare('PRAGMA table_info(roadmap_items)').all().map((c) => c.name);
      expect(cols).toContain('deleted_at');
      const idx = migrated
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_roadmap_items_live'")
        .get();
      expect(idx).toBeDefined();
      // Pre-existing row survives with a NULL tombstone (still live).
      expect(migrated.prepare("SELECT deleted_at FROM roadmap_items WHERE id = 'x'").get().deleted_at).toBeNull();
      migrated.close();
    });

    it('siblingKegDbPaths returns newest-first and [] outside a Cellar', () => {
      const cellar = path.join(dir, 'Cellar', 'port-daddy');
      const a = path.join(cellar, '3.23.0', 'bin', 'port-registry.db');
      const b = path.join(cellar, '3.24.0', 'bin', 'port-registry.db');
      fs.mkdirSync(path.dirname(a), { recursive: true });
      fs.mkdirSync(path.dirname(b), { recursive: true });
      makeLegacyDb(a);
      makeLegacyDb(b);
      const past = new Date(Date.now() - 60_000);
      fs.utimesSync(a, past, past);

      const found = siblingKegDbPaths(path.join(cellar, '3.25.0', 'bin', 'pd'));
      expect(found).toEqual([b, a]);
      expect(siblingKegDbPaths('/srv/port-daddy/bin/pd')).toEqual([]);
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
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS claim_forest_nodes');
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS claim_forest_edges');
      expect(CORE_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS claim_forest_claims');
    });

    it('includes necessary indexes', () => {
      expect(CORE_SCHEMA_SQL).toContain('idx_services_port');
      expect(CORE_SCHEMA_SQL).toContain('idx_sessions_status');
      expect(CORE_SCHEMA_SQL).toContain('idx_session_notes_session');
      expect(CORE_SCHEMA_SQL).toContain('idx_claim_forest_nodes_repo_world');
      expect(CORE_SCHEMA_SQL).toContain('idx_claim_forest_claims_node_active');
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
      expect(tables).toContain('claim_forest_nodes');
      expect(tables).toContain('claim_forest_edges');
      expect(tables).toContain('claim_forest_claims');
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

  it('archives sessions without deleting notes or claim history', () => {
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

    // Archive session
    const removed = sessions.remove(session.id);
    expect(removed.success).toBe(true);
    expect(removed.archived).toBe(true);
    expect(removed.removed).toBe(false);
    expect(removed.notesPreserved).toBe(true);
    expect(removed.releasedFiles).toEqual(['/path/to/file1.ts', '/path/to/file2.ts']);

    // Session and associated data should be preserved as append-only evidence.
    const after = sessions.get(session.id);
    expect(after.success).toBe(true);
    expect(after.session.status).toBe('abandoned');

    // Direct DB check that notes and historical file claims remain, but active
    // claims were released.
    const preservedFiles = db.prepare('SELECT * FROM session_files WHERE session_id = ?').all(session.id);
    const activeFiles = db.prepare('SELECT * FROM session_files WHERE session_id = ? AND released_at IS NULL').all(session.id);
    const preservedNotes = db.prepare('SELECT * FROM session_notes WHERE session_id = ?').all(session.id);
    expect(preservedFiles.length).toBe(2);
    expect(activeFiles.length).toBe(0);
    expect(preservedNotes.length).toBe(3);
  });
});
