/**
 * Berth DB seeding — ADR-0084 (daemon berths) + ADR-0090 (DB distribution).
 *
 * A non-stable daemon berth (`pd dev up`) runs against its own isolated SQLite
 * file at `<profile>/port-daddy.db` (server.ts derives `DB_PATH` from
 * `PORT_DADDY_PREFIX`). Created empty, that berth is useless for testing — it is
 * the surfacing bug ADR-0090 §1 names: stable daemon data being invisible to
 * routes served by a separate dev daemon. A dev daemon with an empty registry
 * can't be exercised against real board state.
 *
 * This module seeds a new berth's DB from a point-in-time copy of the
 * stable/prod registry so every berth starts with realistic data.
 *
 * Mechanism: SQLite `VACUUM INTO` — WAL-consistent and byte-identical across
 * better-sqlite3 and bun:sqlite (the same snapshot primitive `lib/backup.ts`
 * uses; ADR-0090 §6 phase-2 sanctions it as the seed path). After the copy we
 * scrub the tables ADR-0090 classifies LOCAL-ONLY — `services` (port claims),
 * `endpoints`, and `locks` — plus executable queue tables. A berth must never
 * inherit prod's machine-local port/lock bindings or a queued dispatch that its
 * worker could recover and launch a second time. Board history (roadmap,
 * sessions, notes, feedback, projects, harbors, messages, claim forest) is
 * preserved, while new executions must be explicitly proposed to this berth.
 *
 * This is a ONE-TIME seed, not ongoing sync. The berth diverges freely after
 * launch; cross-daemon federation is ADR-0090 phases 4–9 and out of scope here.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import Database from './sqlite-runtime.js';
import { resolveDbPath } from './db.js';
import { checkIntegrity } from './backup.js';

/**
 * Tables ADR-0090 classifies LOCAL-ONLY (never replicated): a port binding is
 * physically local; copying it into a berth would make the berth advertise
 * ports it does not own. Scrubbed after the snapshot copy.
 */
export const LOCAL_ONLY_TABLES = ['services', 'endpoints', 'locks'] as const;

/**
 * Durable control-plane rows that are meaningful only to the daemon that owns
 * them. Copying a proposed or interrupted dispatch into a feature berth lets
 * its eager worker recover and launch prod work without an operator command.
 */
export const EXECUTABLE_QUEUE_TABLES = ['dispatches'] as const;

export interface SeedBerthDbOptions {
  /** Where the berth will open its DB (`profile.dbPath`). Must not exist yet. */
  targetDbPath: string;
  /**
   * Source registry to copy. Defaults to {@link resolveProdDbPath}. `null`
   * forces the "no source" path (berth starts empty).
   */
  sourceDbPath?: string | null;
  /** Clear LOCAL-ONLY tables after the copy. Default true. */
  scrubLocalOnly?: boolean;
  env?: NodeJS.ProcessEnv;
}

export type SeedBerthDbReason =
  | 'seeded'
  | 'target-exists'
  | 'no-prod-db'
  | 'source-missing'
  | 'integrity-failed';

export interface SeedBerthDbResult {
  seeded: boolean;
  reason: SeedBerthDbReason;
  targetDbPath: string;
  sourceDbPath?: string;
  scrubbedTables?: string[];
  bytes?: number;
}

/** Escape a path into a SQLite single-quoted string literal for `VACUUM INTO`. */
function sqlQuote(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Resolve the canonical prod/stable registry to seed from. The stable daemon
 * runs with no `PORT_DADDY_PREFIX`, so its DB is `resolveDbPath()`'s default.
 * Because installs can fragment (see the db-fragmentation note / ADR-0044), we
 * accept an explicit override and otherwise pick the best existing candidate
 * (integrity-OK, then most recently modified). Returns `null` when there is no
 * usable prod DB yet (a genuinely fresh machine — the berth simply starts
 * empty).
 */
export function resolveProdDbPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.PORT_DADDY_PROD_DB?.trim();
  if (explicit) return fileSize(explicit) > 0 ? explicit : null;

  const candidates = [resolveDbPath(), join(homedir(), '.port-daddy', 'port-registry.db')];
  const present = [...new Set(candidates)].filter((p) => fileSize(p) > 0);
  if (present.length === 0) return null;

  const ranked = present
    .map((p) => ({ p, mtime: statSync(p).mtimeMs, ok: checkIntegrity(p) }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || b.mtime - a.mtime);
  return ranked[0].p;
}

/** Names of all user tables present in a SQLite file (read-only probe). */
function tablesIn(dbPath: string): Set<string> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    return new Set(rows.map((r) => r.name));
  } finally {
    db.close();
  }
}

/**
 * Seed `targetDbPath` from a copy of the prod registry. Idempotent and safe:
 *   - never clobbers an existing berth DB (skips when the target exists),
 *   - skips cleanly when there is no prod DB to copy (fresh machine),
 *   - verifies the copy's integrity before returning,
 *   - scrubs LOCAL-ONLY tables so the berth owns a clean port/lock slate.
 *
 * Synchronous (mirrors `lib/backup.ts`): SQLite work is CPU-bound and the
 * caller (`pd dev up`) runs it once, before spawning the berth.
 */
export function seedBerthDbFromProd(opts: SeedBerthDbOptions): SeedBerthDbResult {
  const { targetDbPath } = opts;
  const env = opts.env ?? process.env;
  const scrubLocalOnly = opts.scrubLocalOnly ?? true;

  // Respect an existing berth DB — seeding is a create-time bootstrap only.
  if (fileSize(targetDbPath) > 0) {
    return { seeded: false, reason: 'target-exists', targetDbPath };
  }

  const sourceDbPath =
    opts.sourceDbPath === undefined ? resolveProdDbPath(env) : opts.sourceDbPath;
  if (!sourceDbPath) {
    return { seeded: false, reason: 'no-prod-db', targetDbPath };
  }
  if (fileSize(sourceDbPath) === 0) {
    return { seeded: false, reason: 'source-missing', targetDbPath, sourceDbPath };
  }

  mkdirSync(dirname(targetDbPath), { recursive: true });

  // WAL-consistent snapshot copy. VACUUM INTO requires the target not exist;
  // the size guard above guarantees that.
  const reader = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
  try {
    reader.exec(`VACUUM INTO ${sqlQuote(targetDbPath)}`);
  } finally {
    reader.close();
  }

  if (!checkIntegrity(targetDbPath)) {
    return { seeded: false, reason: 'integrity-failed', targetDbPath, sourceDbPath };
  }

  const scrubbedTables: string[] = [];
  if (scrubLocalOnly) {
    const present = tablesIn(targetDbPath);
    const writer = new Database(targetDbPath);
    try {
      for (const table of [...LOCAL_ONLY_TABLES, ...EXECUTABLE_QUEUE_TABLES]) {
        if (present.has(table)) {
          writer.exec(`DELETE FROM ${table}`);
          scrubbedTables.push(table);
        }
      }
    } finally {
      writer.close();
    }
  }

  return {
    seeded: true,
    reason: 'seeded',
    targetDbPath,
    sourceDbPath,
    scrubbedTables,
    bytes: fileSize(targetDbPath),
  };
}

/** One-line operator summary of a seed result, for `pd dev up` output. */
export function describeSeedResult(r: SeedBerthDbResult): string {
  switch (r.reason) {
    case 'seeded': {
      const kb = Math.max(1, Math.round((r.bytes ?? 0) / 1024));
      const scrub = r.scrubbedTables?.length
        ? ` (cleared ${r.scrubbedTables.join(', ')})`
        : '';
      return `seeded from prod registry — ${kb} KB${scrub}`;
    }
    case 'target-exists':
      return 'kept existing berth DB (not re-seeded)';
    case 'no-prod-db':
      return 'no prod registry found — berth starts empty';
    case 'source-missing':
      return 'prod registry unreadable — berth starts empty';
    case 'integrity-failed':
      return 'seed copy failed integrity_check — berth starts empty';
  }
}
