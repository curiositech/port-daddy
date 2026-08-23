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
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'url';
import { resolveDistributionRoot } from '../shared/daemon-binary.js';
import { CLAIM_FOREST_SCHEMA_SQL } from './claim-forest.js';
import { isCurrentDbIntegrityProof, type DbIntegrityProof } from './db-integrity.js';
import { assertNotProdInTest, isTestContext } from './db-open-guard.js';

export {
  assertNotProdInTest,
  isAllowedTestDbPath,
  isTestContext,
} from './db-open-guard.js';

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
    // Post-apply verification: a rescue that produced an unopenable or
    // tableless file must not become the registry. Quarantine it (rename,
    // never delete — it is evidence) and start fresh instead.
    if (!verifyRescuedRegistry(destPath)) {
      const quarantine = `${destPath}.failed-rescue-${Date.now()}`;
      renameSync(destPath, quarantine);
      console.warn(
        `[port-daddy] WARNING: rescued registry from ${sourcePath} failed post-apply ` +
          `verification; quarantined at ${quarantine}. Starting fresh at ${destPath}.`,
      );
      return false;
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

/**
 * Post-apply probe for a rescued registry file: it must open and contain at
 * least one table. Probes the real schema object, never bookkeeping — a
 * rescue is not "applied" because VACUUM INTO exited 0.
 */
export function verifyRescuedRegistry(path: string): boolean {
  try {
    const probe = new Database(path, { readonly: true });
    try {
      const row = probe
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
        .get() as { n: number };
      return row.n > 0;
    } finally {
      probe.close();
    }
  } catch {
    return false;
  }
}

/**
 * Post-apply verification of the boot migrations: probe the actual schema
 * objects the daemon is about to serve from — never trust that CREATE/ALTER
 * statements "ran" because no exception surfaced (the ALTER blocks above
 * warn-and-continue by design).
 *
 * Throws with remediation on failure: a daemon serving on a broken schema
 * silently corrupts coordination truth, which is worse than not starting.
 */
export function verifyCoreSchema(db: DatabaseInstance): void {
  const requiredTables = [
    'services',
    'sessions',
    'session_files',
    'session_notes',
    'roadmap_items',
    'roadmap_item_status_events',
  ];
  const missing: string[] = [];
  for (const table of requiredTables) {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { n: number };
    if (row.n === 0) missing.push(table);
  }
  // Column sentinels: the ALTER blocks are warn-and-continue, so probe their
  // target columns directly (ADR-0086 planner columns via `kind`; soft-delete
  // tombstones via `deleted_at`; Jira-grade item columns via `tags_json`;
  // derived-item provenance via `source_refs_json`). Each ALTER block has its
  // own sentinel, so each needs its own probe — `source_refs_json` landed
  // after the seven planner columns and is added by a separate guarded ALTER,
  // so `kind` being present proves nothing about it. Without this probe a DB
  // whose provenance ALTER failed boots "verified" and then fails EVERY
  // roadmap write with `no such column: source_refs_json`.
  if (!missing.includes('roadmap_items')) {
    const cols = db.prepare('PRAGMA table_info(roadmap_items)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'kind')) missing.push('roadmap_items.kind');
    if (!cols.some((c) => c.name === 'deleted_at')) missing.push('roadmap_items.deleted_at');
    if (!cols.some((c) => c.name === 'tags_json')) missing.push('roadmap_items.tags_json');
    if (!cols.some((c) => c.name === 'source_refs_json')) {
      missing.push('roadmap_items.source_refs_json');
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `[port-daddy] Schema verification failed after boot migrations — missing: ` +
        `${missing.join(', ')}. The registry is not safe to serve from. ` +
        `Run: pd doctor --repair (or restore a backup via pd restore).`,
    );
  }
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
    -- Jira-grade item fields (operator-mandated roadmap command-center,
    -- 2026-08-22). tags_json is a JSON array of free-form label strings
    -- (filterable via json_each). actual mirrors estimate's abstract effort
    -- units so planned-vs-actual is a same-unit subtraction. completed_at is
    -- stamped by the status transition into 'done' (and cleared on reopen) so
    -- cycle time is derivable without replaying the status-event audit trail.
    -- Existing DBs get these via the PRAGMA-guarded ALTER in initDatabase.
    tags_json TEXT NOT NULL DEFAULT '[]',
    actual INTEGER,
    completed_at INTEGER,
    -- Provenance of derived items (JSON array). Populated by ingestion paths
    -- (e.g. pd roadmap chomp) with the source documents + commit SHA a row
    -- was derived from, so an item outlives the planning doc it came from.
    -- Named to converge with the roadmap-item enrichment fields program.
    source_refs_json TEXT,
    -- Soft-delete tombstone. The registry is a multi-replica system reconciled
    -- by union-merge (scripts/registry-reunify.ts); a hard DELETE in one
    -- replica silently resurrects from any replica still carrying the row.
    -- Deletion is an UPDATE that sets deleted_at and bumps last_touched_at, so
    -- the tombstone wins last-write-wins merges. Existing DBs get the column
    -- via the PRAGMA-guarded ALTER in initDatabase.
    deleted_at INTEGER,
    UNIQUE(slug, harbor)
  );
  CREATE INDEX IF NOT EXISTS idx_roadmap_items_harbor_status
    ON roadmap_items(harbor, status);
  -- idx_roadmap_items_live (partial, WHERE deleted_at IS NULL) is created in
  -- initDatabase AFTER the PRAGMA-guarded ALTER adds deleted_at on legacy DBs —
  -- creating it here would fail on a pre-tombstone database.
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

/**
 * The Door — one enforced write-boundary (architecture-of-record seam 3).
 *
 * The daemon is the single legitimate WRITER of the registry: it IS the door.
 * Any other process that opens the DB directly and mutates it is a bypass — and
 * the dangerous one is the CLI's silent direct-DB fallback when the daemon is
 * down, because those writes are invisible to every other agent (the "two agents
 * one file 3am" failure). This class is thrown when a `role:'client'` handle
 * attempts a mutation, so a killed daemon HALTS the write loudly instead of
 * silently editing shared truth behind the dead daemon's back.
 *
 * HONESTY (b0): this boundary is ADVISORY. `role` is a plain option and the
 * `PD_DIRECT_DB_OK` env hatch is a plain env var; nothing here binds authorization
 * to the daemon's identity keystone (ADR-0040). It is defense-in-depth against
 * accidental/silent bypass — it converts "silently mutates a dead daemon's
 * registry" into "must consciously assert ownership" — NOT a cryptographic
 * guarantee against a hostile in-process actor. Binding to an identity-issued
 * capability is the follow-up that upgrades advisory → enforced.
 */
export class DaemonDoorError extends Error {
  constructor(sql: string) {
    super(
      'Port Daddy: direct SQLite WRITE refused — the daemon owns the write-boundary. ' +
        'Route this mutation through the daemon (pd / MCP). If the daemon is down, start it ' +
        '(brew services start port-daddy). Maintenance-only escape hatch: PD_DIRECT_DB_OK=1. ' +
        `Offending statement: ${sql.slice(0, 80)}`,
    );
    this.name = 'DaemonDoorError';
  }
}

/**
 * Strip string / quoted-identifier literals and comments so we scan SQL
 * *keywords*, never data. This is a STRUCTURED strip of SQL we author — not
 * keyword-NLP over free text — so a `SELECT` whose literal happens to contain the
 * word DELETE is not misread as a mutation.
 *
 * ORDER MATTERS: literals are stripped BEFORE comments. A line-comment regex
 * (`--` to end-of-line) can't tell a real `--` from one sitting inside a
 * `'string'` — if comments strip first, a literal like `'--'` in
 * `SELECT '--'; DELETE FROM foo;` gets misread as "the rest of the line is a
 * comment" and the regex eats the trailing `DELETE FROM foo;` right along
 * with the quote, hiding a real mutation from the scanner (a false NEGATIVE —
 * the dangerous direction for a fail-closed boundary) even though `db.exec`
 * would still literally execute it. Stripping balanced-quote literals first
 * removes the `'--'` token as a unit before the comment regex ever runs, so
 * it has nothing left to misfire on.
 */
function stripSqlNoise(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, ' ') // 'string literals'
    .replace(/"(?:""|[^"])*"/g, ' ') // "quoted identifiers"
    .replace(/--[^\n]*/g, ' ') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' '); // block comments
}

/**
 * Does this SQL mutate? Scans the WHOLE statement (post-strip) for a mutating
 * keyword as a whole word, so it catches fail-CLOSED:
 *   • leading INSERT/UPDATE/DELETE/REPLACE/CREATE/DROP/ALTER/TRUNCATE/VACUUM/REINDEX
 *   • `… RETURNING …` mutations (verb still leads, matches)
 *   • CTE writes:  WITH cte AS (…) DELETE/UPDATE/INSERT …
 *   • multi-statement scripts:  SELECT …; DELETE …   (exec only)
 * A read (SELECT/PRAGMA/EXPLAIN) never contains these as bare words, so the only
 * false positive is the rare unquoted reserved word used as an identifier — the
 * safe bias for a write boundary.
 */
export function isMutatingSql(sql: string): boolean {
  return /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|TRUNCATE|VACUUM|REINDEX)\b/i.test(
    stripSqlNoise(sql),
  );
}

/**
 * Wrap a handle so every MUTATION throws `DaemonDoorError` while reads pass.
 * Overrides `prepare` (guarding run/get/all/iterate — a `… RETURNING …` mutation
 * is executed via `.get()`/`.all()`, not `.run()`, so guarding only `.run` would
 * leave that bypass open) and `exec` (multi-statement scripts). Statements inside
 * a `db.transaction(fn)` go through the wrapped `prepare` and are refused too.
 */
export function guardWrites(db: DatabaseInstance): DatabaseInstance {
  const origPrepare = db.prepare.bind(db);
  const origExec = db.exec.bind(db);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).prepare = (sql: string) => {
    const stmt = origPrepare(sql);
    if (isMutatingSql(sql)) {
      const refuse = (): never => {
        throw new DaemonDoorError(sql);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = stmt as any;
      s.run = refuse;
      s.get = refuse;
      s.all = refuse;
      s.iterate = refuse;
    }
    return stmt;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).exec = (sql: string) => {
    if (isMutatingSql(sql)) throw new DaemonDoorError(sql);
    return origExec(sql);
  };
  return db;
}

export interface InitDbOptions {
  /** Override the default DB file path */
  dbPath?: string;
  /** Use ':memory:' for tests (ignores dbPath) */
  inMemory?: boolean;
  /** Who is opening the DB. The daemon is the sole authorized writer (it IS the
   *  write-boundary / door). A `client` open returns a write-guarded handle:
   *  reads pass, mutations throw `DaemonDoorError`. Default `daemon` so existing
   *  callers are unchanged; the CLI direct-DB fallback is migrated to `client`
   *  separately (a shipped integration test asserts today's direct-write feature,
   *  so flipping it is a staged product decision, not a drop-in). The
   *  `PD_DIRECT_DB_OK=1` env hatch restores owner semantics for maintenance. */
  role?: 'daemon' | 'client';
  /**
   * Content-bound result from the packaged daemon's read-only helper process.
   * It skips the duplicate in-process full scan only when the durable DB/WAL
   * stamps still match the successful scan. SHM is mutable reader-lock state.
   */
  integrityProof?: DbIntegrityProof;
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

  const integrityPreverified = !options.inMemory
    && isCurrentDbIntegrityProof(path, options.integrityProof);
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
  if (!options.inMemory && !integrityPreverified) {
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

  // Incremental auto-vacuum so pruned rows actually return pages to the OS. Without this, retention
  // DELETEs free pages onto the freelist but the FILE never shrinks — the root cause of a 231 MB
  // registry DB that stayed 231 MB after pruning. INCREMENTAL (not FULL) keeps checkpoints cheap;
  // the RetentionRegistry.reclaim() step calls `PRAGMA incremental_vacuum` to hand pages back.
  // CAVEAT: on an ALREADY-POPULATED DB created with auto_vacuum=NONE this pragma is a no-op until a
  // one-time `VACUUM` rewrites the file — new per-instance DBs get it for free; existing DBs need
  // that one-time VACUUM (see the retention migration note). Setting it before schema creation makes
  // every fresh daemon DB incremental-vacuum-capable from birth.
  db.pragma('auto_vacuum = INCREMENTAL');

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
    // source_refs_json landed after the seven planner columns, so it needs its
    // own sentinel: a DB migrated by an older daemon has `kind` but not this.
    const hasSourceRefs = roadmapColumns.some(column => column.name === 'source_refs_json');
    if (!hasSourceRefs) {
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN source_refs_json TEXT').run();
    }
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: Could not migrate roadmap_items planner columns: ${(err as Error).message}`
    );
  }

  // Soft-delete tombstone (multi-replica union-merge cannot propagate hard
  // deletes — a row deleted in one replica resurrects from a stale one).
  // Idempotent, PRAGMA-guarded like the planner columns above; the partial
  // index is created here (not in CORE_SCHEMA_SQL) so legacy DBs get the
  // column first.
  try {
    const roadmapColumns = db.prepare("PRAGMA table_info(roadmap_items)").all() as Array<{ name: string }>;
    const hasDeletedAt = roadmapColumns.some(column => column.name === 'deleted_at');
    if (!hasDeletedAt) {
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN deleted_at INTEGER').run();
    }
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_roadmap_items_live ON roadmap_items(harbor, status) WHERE deleted_at IS NULL'
    ).run();
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: Could not migrate roadmap_items deleted_at tombstone column: ${(err as Error).message}`
    );
  }

  // Jira-grade roadmap items (operator-mandated roadmap command-center,
  // 2026-08-22; migration 087): tags, actual effort, and the completion stamp.
  // Same idempotent PRAGMA-guarded pattern as the ADR-0086 planner columns —
  // `tags_json` is the sentinel: if it's missing, all three are. SQLite ALTER
  // cannot add CHECKs, so the app layer (lib/roadmap-items.ts) normalizes tags
  // and effort on write; fresh DBs get the defaults from CORE_SCHEMA_SQL.
  try {
    const roadmapColumns = db.prepare("PRAGMA table_info(roadmap_items)").all() as Array<{ name: string }>;
    const hasTags = roadmapColumns.some(column => column.name === 'tags_json');
    if (!hasTags) {
      db.prepare("ALTER TABLE roadmap_items ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'").run();
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN actual INTEGER').run();
      db.prepare('ALTER TABLE roadmap_items ADD COLUMN completed_at INTEGER').run();
    }
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: Could not migrate roadmap_items Jira-grade columns: ${(err as Error).message}`
    );
  }

  // ADR-0086 §3 — dependencies_json retirement (data migration, idempotent).
  // Blocking relations move into graph_edges (scope planner:deps, edge_type
  // depends_on, roadmap:item → roadmap:item); the denormalized JSON column is
  // retired as a source of truth. This backfill copies any remaining legacy
  // JSON deps into edges (ON CONFLICT DO NOTHING — re-runs and old-replica
  // row arrivals converge instead of duplicating) and then clears the JSON to
  // the '[]' sentinel so the read-side bridge (edges ∪ JSON) can never
  // resurrect a dependency later removed through the edge-authoring write
  // path. The column itself stays for old-replica union-merge compatibility.
  try {
    const backfillAt = Date.now();
    db.prepare(`
      INSERT INTO graph_edges (
        scope, project_dir, source_type, source_id, edge_type, target_type, target_id,
        weight, metadata, created_at, updated_at
      )
      SELECT 'planner:deps', NULL, 'roadmap:item', r.slug, 'depends_on', 'roadmap:item', je.value,
             1, NULL, ?, ?
        FROM roadmap_items r, json_each(r.dependencies_json) je
       WHERE r.dependencies_json != '[]'
         AND json_valid(r.dependencies_json)
         AND je.type = 'text'
         AND je.value != ''
      ON CONFLICT(scope, source_type, source_id, edge_type, target_type, target_id) DO NOTHING
    `).run(backfillAt, backfillAt);
    db.prepare(
      `UPDATE roadmap_items SET dependencies_json = '[]'
        WHERE dependencies_json != '[]' AND json_valid(dependencies_json)`
    ).run();
  } catch (err) {
    console.warn(
      `[port-daddy] WARNING: Could not backfill roadmap dependencies into graph_edges: ${(err as Error).message}`
    );
  }

  // Post-apply verification: probe the real schema objects before handing the
  // handle out. The migration blocks above warn-and-continue; this is the
  // fail-closed gate that stops a daemon from serving a broken registry.
  verifyCoreSchema(db);

  // The Door: a non-daemon opener gets a write-guarded handle so a mutation
  // attempted while the daemon is down (or by any non-owner) throws loudly
  // instead of silently editing shared coordination truth. The daemon (default
  // role) and the explicit PD_DIRECT_DB_OK=1 maintenance hatch keep raw write
  // access. Idempotent schema DDL above runs on the raw handle during init and
  // is intentionally NOT gated — a client that bootstraps a fresh DB still needs
  // the schema; the door blocks the caller's subsequent coordination mutations,
  // which is the actual bypass.
  const role = options.role ?? 'daemon';
  const ownerSemantics = role === 'daemon' || options.inMemory || process.env.PD_DIRECT_DB_OK === '1';
  return ownerSemantics ? db : guardWrites(db);
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
