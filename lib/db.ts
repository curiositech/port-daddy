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

import Database, { type DatabaseInstance } from './sqlite-runtime.js';
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'url';
import { resolveDistributionRoot } from '../shared/daemon-binary.js';
import { CLAIM_FOREST_SCHEMA_SQL } from './claim-forest.js';

const MODULE_DIR: string = dirname(fileURLToPath(import.meta.url));

export function resolveDefaultDbRoot(
  moduleDir: string = MODULE_DIR,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string {
  const resourceRoot = resolveDistributionRoot(moduleDir, env, execPath);
  return resourceRoot === moduleDir ? join(moduleDir, '..') : resourceRoot;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB path resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The machine-durable home for the registry. Survives brew upgrades, repo
 * checkouts, and worktrees — every daemon on this machine that does not
 * explicitly isolate itself (PORT_DADDY_DB, instance profiles, test DBs)
 * converges on this one file. Daemons must not own different truths.
 */
export function durableDbHomePath(): string {
  return join(homedir(), '.port-daddy', 'port-registry.db');
}

/**
 * Where the pre-durable-home default would have put the registry: next to the
 * distribution root. For a Homebrew install that is the VERSIONED Cellar
 * directory, which is deleted on every `brew upgrade` — the root cause of
 * repeated registry data loss (roadmap items, notes, receipts). Kept only so
 * boot can migrate data out of it.
 */
export function legacyDbPath(
  moduleDir: string = MODULE_DIR,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): string {
  return join(resolveDefaultDbRoot(moduleDir, env, execPath), 'port-registry.db');
}

/**
 * Resolve the path to the SQLite database file.
 * Priority:
 *   1. Explicit override (parameter)
 *   2. PORT_DADDY_DB environment variable
 *   3. Default: ~/.port-daddy/port-registry.db (durable home)
 *
 * The default deliberately does NOT depend on the binary location or the
 * current checkout: a version-pinned or checkout-relative default is how the
 * registry kept dying (Cellar wipe on brew upgrade, one truth per worktree).
 */
export function resolveDbPath(overridePath?: string): string {
  if (overridePath) return overridePath;
  if (process.env.PORT_DADDY_DB) return process.env.PORT_DADDY_DB;
  return durableDbHomePath();
}

/** True when a path sits inside a version-volatile install location (deleted on upgrade). */
export function isVersionVolatileDbPath(path: string): boolean {
  const p = resolvePath(path);
  return p.includes(`${sep}Cellar${sep}`) || p.includes(`${sep}homebrew${sep}Cellar${sep}`);
}

/**
 * Registries left behind in OTHER kegs of the same Homebrew formula.
 *
 * After `brew upgrade`, the running binary's own distribution root is the NEW
 * (empty) keg — the previous version's data sits in the old keg until
 * Homebrew's cleanup deletes it. Given any path inside a Cellar keg (the exec
 * path or a legacy DB path), return existing sibling-keg registries, newest
 * mtime first.
 */
export function siblingKegDbPaths(refPath: string): string[] {
  const p = resolvePath(refPath);
  const marker = `${sep}Cellar${sep}`;
  const idx = p.indexOf(marker);
  if (idx === -1) return [];
  // .../Cellar/<formula>/<version>/...
  const formula = p.slice(idx + marker.length).split(sep)[0];
  if (!formula) return [];
  const formulaDir = p.slice(0, idx + marker.length) + formula;
  let versions: string[];
  try {
    versions = readdirSync(formulaDir);
  } catch {
    return [];
  }
  const withMtime: Array<{ path: string; mtime: number }> = [];
  for (const v of versions) {
    const candidate = join(formulaDir, v, 'bin', 'port-registry.db');
    try {
      withMtime.push({ path: candidate, mtime: statSync(candidate).mtimeMs });
    } catch {
      /* keg has no registry */
    }
  }
  return withMtime.sort((a, b) => b.mtime - a.mtime).map((c) => c.path);
}

/**
 * All places a legacy registry could be, best candidate first: the current
 * distribution-root default, then sibling Homebrew kegs (newest first) —
 * because after `brew upgrade` the data lives in the PREVIOUS keg, not the
 * one the new binary resolves to.
 */
export function legacyDbCandidates(
  primary: string = legacyDbPath(),
  execPath: string = process.execPath,
): string[] {
  const candidates = [primary, ...siblingKegDbPaths(execPath), ...siblingKegDbPaths(primary)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const r = resolvePath(c);
    if (!seen.has(r)) {
      seen.add(r);
      out.push(c);
    }
  }
  return out;
}

/**
 * One-time rescue of a legacy registry into the durable home.
 *
 * Runs only when the destination does not exist yet and a legacy registry
 * does; takes the first existing candidate (current distribution root, then
 * sibling brew kegs newest-first). Uses `VACUUM INTO`, which produces a
 * consistent snapshot even while an old daemon still holds the legacy DB
 * open in WAL mode (a plain file copy of db+wal+shm would not be safe
 * there). Best-effort: a failed migration logs loudly and boot continues
 * with a fresh DB rather than crashing the daemon.
 *
 * @returns true when a migration was performed.
 */
export function migrateLegacyRegistry(
  destPath: string = durableDbHomePath(),
  sourcePaths: string | string[] = legacyDbCandidates(),
): boolean {
  if (existsSync(destPath)) return false;
  const candidates = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
  const sourcePath = candidates.find(
    (c) => resolvePath(c) !== resolvePath(destPath) && existsSync(c),
  );
  if (!sourcePath) return false;

  try {
    mkdirSync(dirname(destPath), { recursive: true });
    const legacy = new Database(sourcePath, { readonly: true });
    try {
      legacy.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
    } finally {
      legacy.close();
    }
    console.warn(
      `[port-daddy] Migrated registry from legacy location into the durable home:\n` +
        `  from: ${sourcePath}\n` +
        `  to:   ${destPath}\n` +
        `The legacy file was left in place (read-only rescue); it is no longer used.`,
    );
    return true;
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: could not migrate legacy registry from ${sourcePath}: ` +
        `${(err as Error).message}. Starting with a fresh database at ${destPath}.`,
    );
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed production-DB guard (Rails ProtectedEnvironment analogue)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether the current process is running under a test runner.
 *
 * The chokepoint guard refuses to open the live production database from a
 * test context. We treat any of the standard test markers as "this is a test":
 *   - NODE_ENV === 'test'        (generic)
 *   - JEST_WORKER_ID set         (jest worker subprocess)
 *   - BUN_TEST set               (bun:test runner)
 *   - PD_TEST set                (explicit Port Daddy test marker)
 */
export function isTestContext(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === 'test' ||
    env.JEST_WORKER_ID !== undefined ||
    env.BUN_TEST !== undefined ||
    env.PD_TEST !== undefined
  );
}

/** True when `child` is `parent` itself or nested anywhere beneath it. */
function isPathUnder(child: string, parent: string): boolean {
  const c = resolvePath(child);
  const p = resolvePath(parent);
  if (c === p) return true;
  const prefix = p.endsWith(sep) ? p : p + sep;
  return c.startsWith(prefix);
}

/**
 * A resolved DB path is an allowed scratch target in a test context when it is:
 *   - an in-memory DB (':memory:')
 *   - exactly the path named by PORT_DADDY_TEST_DB, or nested beneath its dir
 *   - anywhere under the OS temp dir (os.tmpdir() / mkdtemp output)
 * Anything else (the real production registry) is refused.
 */
export function isAllowedTestDbPath(
  resolvedPath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (resolvedPath === ':memory:' || resolvedPath === '') return true;

  const testDb = env.PORT_DADDY_TEST_DB;
  if (testDb) {
    if (resolvePath(resolvedPath) === resolvePath(testDb)) return true;
    // Allow sibling WAL/SHM files and a throwaway dir rooted at the test DB's dir.
    if (isPathUnder(resolvedPath, dirname(testDb))) return true;
  }

  if (isPathUnder(resolvedPath, tmpdir())) return true;

  return false;
}

/**
 * Fail-closed assertion run BEFORE the SQLite handle is opened.
 *
 * Throws when a test context is about to open a real, on-disk database that is
 * NOT an explicitly-allowed throwaway path. This is the analogue of Rails'
 * ProtectedEnvironmentError: it stops a stray CLI command or a misconfigured
 * test from writing to the live production registry.
 *
 * Exported so it can be unit-tested directly without opening a handle.
 */
export function assertNotProdInTest(
  resolvedPath: string,
  ctx: { isTest: boolean; inMemory?: boolean },
): void {
  if (!ctx.isTest) return;
  if (ctx.inMemory) return;
  if (isAllowedTestDbPath(resolvedPath)) return;

  throw new Error(
    `[port-daddy] Refusing to open the production database from a test context.\n` +
      `  path: ${resolvedPath}\n` +
      `Tests must not touch the live registry. Set PORT_DADDY_TEST_DB to a ` +
      `throwaway path (e.g. one created with fs.mkdtempSync) or use ` +
      `createTestDb() from tests/setup-unit.js for an in-memory database.`,
  );
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
    tags TEXT,
    last_scanned INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS harbors (
    name TEXT PRIMARY KEY,
    scope TEXT,
    capabilities TEXT NOT NULL DEFAULT '[]',
    channels TEXT NOT NULL DEFAULT '[]',
    agent_patterns TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_harbors_expires ON harbors(expires_at)
    WHERE expires_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_harbors_created ON harbors(created_at);

  CREATE TABLE IF NOT EXISTS harbor_members (
    harbor_name TEXT NOT NULL REFERENCES harbors(name) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    identity TEXT,
    capabilities TEXT,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (harbor_name, agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_harbor_members_agent ON harbor_members(agent_id);

  CREATE TABLE IF NOT EXISTS sessions (
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
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_worktree ON sessions(worktree_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_identity_project ON sessions(identity_project);

  CREATE TABLE IF NOT EXISTS session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    symbol TEXT,
    symbol_path TEXT,
    claimed_at INTEGER NOT NULL,
    released_at INTEGER
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

  ${CLAIM_FOREST_SCHEMA_SQL}

  CREATE TABLE IF NOT EXISTS graph_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    project_dir TEXT,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_graph_edges_scope ON graph_edges(scope);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_project ON graph_edges(project_dir, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_type, source_id);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_edges_unique
    ON graph_edges(scope, source_type, source_id, edge_type, target_type, target_id);

  -- Durable DB-of-record for roadmap items. Tuples (roadmap:upserted /
  -- roadmap:status / roadmap:touched) still fire for subscribers, but the
  -- row is the truth. Wiping the tuples table leaves roadmap state intact.
  CREATE TABLE IF NOT EXISTS roadmap_items (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    summary_md TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'backlog'
      CHECK(status IN ('now','backlog','parked','merge','done')),
    promoted_from_feedback_id TEXT,
    promoted_by_agent_id TEXT,
    promoted_at INTEGER,
    last_touched_at INTEGER NOT NULL,
    dependencies_json TEXT NOT NULL DEFAULT '[]',
    notes_json TEXT NOT NULL DEFAULT '[]',
    harbor TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    -- PD Planner (ADR-0086): Jira-like issue fields. kind is the fixed-ladder
    -- issue type; priority is urgency, ORTHOGONAL to status (the workflow lane).
    -- Hierarchy / dependencies / artifact links live in graph_edges, not here.
    -- Existing DBs get these via the PRAGMA-guarded ALTER in initDatabase.
    kind TEXT NOT NULL DEFAULT 'task'
      CHECK(kind IN ('project','epic','story','task','subtask','bug','chore')),
    priority INTEGER NOT NULL DEFAULT 3
      CHECK(priority BETWEEN 1 AND 5),
    assignee_id TEXT,
    description_md TEXT,
    started_at INTEGER,
    due_at INTEGER,
    estimate INTEGER,
    UNIQUE(slug, harbor)
  );
  CREATE INDEX IF NOT EXISTS idx_roadmap_items_harbor_status
    ON roadmap_items(harbor, status);
  CREATE INDEX IF NOT EXISTS idx_roadmap_items_last_touched
    ON roadmap_items(last_touched_at);

  -- Append-only audit of every status change. Mirrors the
  -- 'roadmap:status' tuple but durable.
  CREATE TABLE IF NOT EXISTS roadmap_item_status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    status TEXT NOT NULL
      CHECK(status IN ('now','backlog','parked','merge','done')),
    by_agent_id TEXT,
    at INTEGER NOT NULL,
    harbor TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_roadmap_status_events_item
    ON roadmap_item_status_events(item_id, at);
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
export function initDatabase(options: InitDbOptions = {}): DatabaseInstance {
  const path = options.inMemory ? ':memory:' : resolveDbPath(options.dbPath);

  // FAIL CLOSED: never open the live production registry from a test context.
  // Runs before the handle is opened so no write can leak into prod.
  assertNotProdInTest(path, {
    isTest: isTestContext(),
    inMemory: options.inMemory,
  });

  if (!options.inMemory) {
    // Only the durable-home default gets the legacy rescue; explicit
    // overrides (PORT_DADDY_DB, instance profiles, tests) mean isolation
    // was chosen on purpose.
    if (path === durableDbHomePath()) {
      migrateLegacyRegistry(path);
    } else if (isVersionVolatileDbPath(path)) {
      console.warn(
        `[port-daddy] WARNING: registry path ${path} sits inside a version-pinned ` +
          `install directory and WILL BE DELETED on the next upgrade. ` +
          `Point PORT_DADDY_DB at a durable location (default: ${durableDbHomePath()}).`,
      );
    }
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  // Tighten filesystem permissions so OTHER UNIX USERS cannot read the DB.
  // Best-effort: chmod failures (exotic filesystems, no-chmod mounts) are
  // logged, not fatal.
  //
  // SECURITY CONTEXT: this DB carries sensitive rows —
  //   • session notes and file claims (potentially PII, code paths, agent
  //     private reasoning)
  //   • the Harbor Card Ed25519 signing key (plaintext PEM — see
  //     harbor_token_signing_keys table). Anyone who can read this row
  //     can forge Harbor Cards that verify as authentic.
  // A 0644 default leaks all of this to every user on the machine. 0600
  // narrows to the owner. Does NOT protect against same-user process
  // adversaries; see docs/shipwright/SECURITY-ASSESSMENT.md for the full
  // threat model and follow-up items.
  if (!options.inMemory) {
    try {
      chmodSync(path, 0o600);
    } catch (err) {
      console.warn(
        `[port-daddy] WARNING: could not chmod DB to 0o600 (${(err as Error).message}). ` +
        `Other users on this machine may be able to read ${path}.`,
      );
    }
  }

  // WAL mode for concurrent read/write performance
  db.pragma('journal_mode = WAL');

  // Verify WAL mode actually took effect (it should unless the file is locked)
  const journalMode = db.pragma('journal_mode', { simple: true }) as string;
  if (journalMode !== 'wal' && journalMode !== 'memory') {
    console.warn(
      `[port-daddy] WARNING: journal_mode is '${journalMode}', expected 'wal'. ` +
      `Concurrent access may be degraded. Run: pd doctor --repair`
    );
  }

  // WAL + NORMAL keeps process-crash consistency while avoiding a full fsync
  // on every commit. It is not a power-loss durability guarantee; surfaces
  // that need stronger durability must add explicit checkpoint/fsync policy
  // or opt into FULL with a measured latency budget.
  db.pragma('synchronous = NORMAL');

  // Checkpoint every 200 pages instead of the default 1000.
  // Keeps the WAL file from growing unbounded between periodic cleanups.
  db.pragma('wal_autocheckpoint = 200');

  // Busy timeout: wait up to 5 seconds for locks instead of failing immediately
  // This is critical for concurrent CLI invocations sharing the same DB
  db.pragma('busy_timeout = 5000');

  // Foreign key enforcement (needed for CASCADE deletes on sessions)
  db.pragma('foreign_keys = ON');

  // Integrity check on real databases (skip in-memory test DBs)
  if (!options.inMemory) {
    try {
      const integrityResult = db.pragma('integrity_check', { simple: true }) as string;
      if (integrityResult !== 'ok') {
        console.warn(
          `[port-daddy] WARNING: SQLite integrity check failed: ${integrityResult}. ` +
          `Database may be corrupted. Run: pd doctor --repair`
        );
      }
    } catch (err) {
      console.warn(
        `[port-daddy] WARNING: Could not run integrity check: ${(err as Error).message}. ` +
        `Run: pd doctor --repair`
      );
    }
  }

  // Create core tables
  db.exec(CORE_SCHEMA_SQL);

  // Migrate legacy session_files tables before adding symbol_path indexes.
  // Older local databases may already have session_files without the new column,
  // and creating the index too early aborts daemon startup.
  try {
    const sessionFileColumns = db.prepare("PRAGMA table_info(session_files)").all() as Array<{ name: string }>;
    const hasSymbolPath = sessionFileColumns.some(column => column.name === 'symbol_path');
    if (!hasSymbolPath) {
      db.prepare('ALTER TABLE session_files ADD COLUMN symbol_path TEXT').run();
    }
    db.prepare('CREATE INDEX IF NOT EXISTS idx_session_files_symbol_path ON session_files(file_path, symbol_path)').run();
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: Could not migrate session_files symbol_path column: ${(err as Error).message}`
    );
  }

  try {
    const harborColumns = db.prepare("PRAGMA table_info(harbors)").all() as Array<{ name: string }>;
    const hasScope = harborColumns.some(column => column.name === 'scope');
    if (!hasScope) {
      db.prepare('ALTER TABLE harbors ADD COLUMN scope TEXT').run();
    }
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: Could not migrate harbors scope column: ${(err as Error).message}`
    );
  }

  // PD Planner (ADR-0086, migration 085): give roadmap_items the Jira-like issue
  // fields. Existing DBs predate the columns in CORE_SCHEMA_SQL above; add them
  // here (idempotent — guarded by PRAGMA inspection). `kind` is the sentinel:
  // if it's missing, all seven are. CHECK constraints can't be added by ALTER in
  // SQLite, so the app layer (lib/roadmap-items.ts) enforces kind/priority on
  // write; fresh DBs still get the CHECKs from CORE_SCHEMA_SQL.
  try {
    const roadmapColumns = db.prepare("PRAGMA table_info(roadmap_items)").all() as Array<{ name: string }>;
    const hasKind = roadmapColumns.some(column => column.name === 'kind');
    if (!hasKind) {
      db.prepare("ALTER TABLE roadmap_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'").run();
      db.prepare("ALTER TABLE roadmap_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 3").run();
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN assignee_id TEXT').run();
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN description_md TEXT').run();
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN started_at INTEGER').run();
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN due_at INTEGER').run();
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN estimate INTEGER').run();
    }
    db.prepare('CREATE INDEX IF NOT EXISTS idx_roadmap_items_kind_priority ON roadmap_items(kind, priority)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_roadmap_items_assignee ON roadmap_items(assignee_id)').run();
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: Could not migrate roadmap_items planner columns: ${(err as Error).message}`
    );
  }

  return db;
}

/**
 * Cleanly close the database, checkpointing WAL to the main file.
 * Call during daemon shutdown to merge WAL pages back and truncate.
 */
export function closeDatabase(db: DatabaseInstance): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: WAL checkpoint failed during shutdown: ${(err as Error).message}`
    );
  }
  db.close();
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
