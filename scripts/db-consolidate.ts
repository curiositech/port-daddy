#!/usr/bin/env npx tsx
/**
 * DB Consolidation Tool — ADR-0090 Phase 1
 *
 * Consolidates fragmented Port Daddy databases into a single canonical location.
 *
 * Problem: Port Daddy maintains 7+ database files in scattered locations:
 *   - ~/.port-daddy/port-registry.db (canonical, but often empty)
 *   - ~/.port-daddy/instances/<profile>/port-daddy.db (per-profile DBs, may be fresher)
 *   - ~/coding/port-daddy/port-registry.db (dev checkout)
 *   - /opt/homebrew/Cellar/... (installed binary, dies on brew upgrade)
 *   - Others
 *
 * This script:
 *   1. Scans all known locations and indexes metadata (size, mtime, table_count)
 *   2. Detects live truth via daemon.port → lsof -p <pid> (which DB is open?)
 *   3. Falls back to max(last_seen, updated_at) if daemon is down
 *   4. Shows per-table row-count diffs to help operator pick source
 *   5. Waits for operator approval
 *   6. VACUUM the chosen source into ~/.port-daddy/port-registry.db
 *   7. Archives all other fragments to ~/.port-daddy/backups/_pre-consolidation-<ts>/
 *
 * Safety:
 *   - Opens all DBs read-only (never mutates until VACUUM step)
 *   - Prints full inventory before any destructive op
 *   - Asks operator to approve pick before proceeding
 *   - Uses durable archive path (never /tmp)
 *   - Validates each DB with PRAGMA integrity_check before archiving
 *
 * Usage:
 *   npx tsx scripts/db-consolidate.ts [--force] [--source <path>]
 *   --force     Skip operator confirmation
 *   --source    Explicitly pick this DB as source (must exist, must be valid)
 */

import Database from '../lib/sqlite-runtime.js';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, hostname } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { execSync } from 'node:child_process';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const HOME = homedir();
const PD_PREFIX = join(HOME, '.port-daddy');
const CANONICAL_DB_PATH = join(PD_PREFIX, 'port-registry.db');
const DAEMON_PORT_FILE = join(PD_PREFIX, 'daemon.port');
const BACKUPS_DIR = join(PD_PREFIX, 'backups');

interface DbFragment {
  path: string;
  exists: boolean;
  size?: number;
  mtime?: number;
  tableCount?: number;
  lastSeen?: number;
  integrity?: boolean;
  error?: string;
}

interface DbMetrics {
  table: string;
  rowCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function log(...args: unknown[]): void {
  console.log(...args);
}

function info(msg: string): void {
  console.log(`\x1b[36mℹ\x1b[0m ${msg}`);
}

function warn(msg: string): void {
  console.log(`\x1b[33m⚠\x1b[0m ${msg}`);
}

function success(msg: string): void {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

function error(msg: string): void {
  console.log(`\x1b[31m✗\x1b[0m ${msg}`);
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
    return ans === 'y' || ans === 'yes';
  } finally {
    rl.close();
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

// ─────────────────────────────────────────────────────────────────────────────
// Database scanning
// ─────────────────────────────────────────────────────────────────────────────

function getAllDbPaths(): string[] {
  const paths: string[] = [
    CANONICAL_DB_PATH,
    join(HOME, 'coding', 'port-daddy', 'port-registry.db'),
    join(HOME, 'coding', 'port-daddy', 'dist', 'port-registry.db'),
  ];

  // Scan instances/ directory
  const instancesDir = join(PD_PREFIX, 'instances');
  if (existsSync(instancesDir)) {
    try {
      const entries = readdirSync(instancesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          paths.push(join(instancesDir, entry.name, 'port-daddy.db'));
        }
      }
    } catch (err) {
      warn(`Could not scan ${instancesDir}: ${(err as Error).message}`);
    }
  }

  // Check for homebrew-installed binary
  const brewInstallPaths = [
    `/opt/homebrew/Cellar/port-daddy/*/bin/port-registry.db`,
    `/usr/local/Cellar/port-daddy/*/bin/port-registry.db`,
  ];
  for (const pattern of brewInstallPaths) {
    try {
      const matches = execSync(`find $(dirname ${pattern}) -name "port-registry.db" 2>/dev/null || true`, {
        encoding: 'utf8',
      }).trim().split('\n').filter(Boolean);
      paths.push(...matches);
    } catch {
      // ignore
    }
  }

  // Remove duplicates and sort
  return Array.from(new Set(paths)).sort();
}

function checkIntegrity(dbPath: string): boolean {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const result = db.pragma('integrity_check', { simple: true });
      return typeof result === 'string' && result === 'ok';
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

function getTableCount(dbPath: string): number {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").all();
      return (rows[0] as { count: number }).count;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

function getLastTouched(dbPath: string): number {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      // Try to find the most recent timestamp in the DB (last_seen, updated_at, created_at, etc.)
      const queries = [
        "SELECT MAX(last_seen) as ts FROM services",
        "SELECT MAX(updated_at) as ts FROM sessions",
        "SELECT MAX(updated_at) as ts FROM roadmap_items",
        "SELECT MAX(created_at) as ts FROM messages",
      ];

      let maxTs = 0;
      for (const query of queries) {
        try {
          const result = db.prepare(query).all();
          const ts = (result[0] as { ts: number | null })?.ts;
          if (ts) maxTs = Math.max(maxTs, ts);
        } catch {
          // Table may not exist
        }
      }
      return maxTs;
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

function scanDatabases(): DbFragment[] {
  const paths = getAllDbPaths();
  const fragments: DbFragment[] = [];

  for (const path of paths) {
    const fragment: DbFragment = { path, exists: existsSync(path) };

    if (!fragment.exists) {
      fragments.push(fragment);
      continue;
    }

    try {
      const stats = statSync(path);
      fragment.size = stats.size;
      fragment.mtime = stats.mtimeMs;

      // Skip empty files
      if (fragment.size === 0) {
        fragments.push(fragment);
        continue;
      }

      fragment.tableCount = getTableCount(path);
      fragment.lastSeen = getLastTouched(path);
      fragment.integrity = checkIntegrity(path);

      if (!fragment.integrity) {
        fragment.error = 'integrity_check failed';
      }
    } catch (err) {
      fragment.error = (err as Error).message;
    }

    fragments.push(fragment);
  }

  return fragments;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live daemon detection
// ─────────────────────────────────────────────────────────────────────────────

function getOpenDbFromDaemon(): string | null {
  try {
    if (!existsSync(DAEMON_PORT_FILE)) {
      return null;
    }

    const port = readFileSync(DAEMON_PORT_FILE, 'utf-8').trim();
    const pid = execSync(`lsof -i :${port} 2>/dev/null | grep -oE 'node|bun' | head -1 | xargs -I {} lsof -c {} | grep '\.db$' | awk '{print $NF}' || true`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    return pid ? pid : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Table comparison
// ─────────────────────────────────────────────────────────────────────────────

function getTableMetrics(dbPath: string): Map<string, number> {
  const metrics = new Map<string, number>();
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as Array<{ name: string }>;

      for (const { name } of tables) {
        try {
          const result = db.prepare(`SELECT COUNT(*) as count FROM "${name}"`).all();
          metrics.set(name, (result[0] as { count: number }).count);
        } catch {
          // Table may have odd structure, skip
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // ignore
  }
  return metrics;
}

function printTableComparison(candidates: DbFragment[]): void {
  if (candidates.length <= 1) return;

  info('Table row-count comparison:');
  const allTables = new Set<string>();
  const metricsMap = new Map<string, Map<string, number>>();

  for (const frag of candidates) {
    if (!frag.exists || frag.size === 0 || !frag.integrity) continue;
    const metrics = getTableMetrics(frag.path);
    metricsMap.set(frag.path, metrics);
    metrics.forEach((_, table) => allTables.add(table));
  }

  if (allTables.size === 0) {
    info('  (no tables to compare)');
    return;
  }

  // Print header
  const header = ['Table', ...candidates.filter(c => c.exists && c.size && c.integrity).map(c => {
    const filename = c.path.split('/').pop() || c.path;
    return filename.slice(0, 20);
  })];
  console.log('\n  ' + header.map(h => h.padEnd(20)).join(' '));
  console.log('  ' + '─'.repeat(header.length * 21));

  // Print rows
  for (const table of Array.from(allTables).sort()) {
    const row = [table];
    for (const frag of candidates) {
      if (!frag.exists || frag.size === 0 || !frag.integrity) {
        row.push('-');
        continue;
      }
      const metrics = metricsMap.get(frag.path);
      const count = metrics?.get(table) ?? 0;
      row.push(String(count));
    }
    console.log('  ' + row.map((cell, i) => String(cell).padEnd(20)).join(''));
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main flow
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const sourceIdx = args.indexOf('--source');
  let explicitSource: string | undefined;
  if (sourceIdx >= 0 && sourceIdx + 1 < args.length) {
    explicitSource = resolve(args[sourceIdx + 1]);
  }

  log('\x1b[1mPort Daddy Database Consolidation\x1b[0m\n');

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 1: Scan all fragments
  // ─────────────────────────────────────────────────────────────────────────────

  info('Scanning database fragments...');
  const fragments = scanDatabases();

  const valid = fragments.filter(f => f.exists && f.size && f.size > 0 && f.integrity);
  const empty = fragments.filter(f => f.exists && (!f.size || f.size === 0));
  const corrupted = fragments.filter(f => f.exists && f.size && f.size > 0 && !f.integrity);
  const missing = fragments.filter(f => !f.exists);

  log(`\n  Found: ${valid.length} valid | ${empty.length} empty | ${corrupted.length} corrupted | ${missing.length} missing\n`);

  // Print inventory
  log('Inventory:');
  for (const frag of valid) {
    const ago = Date.now() - (frag.mtime || 0);
    const agoMin = Math.round(ago / 60000);
    log(
      `  ✓ ${frag.path}\n` +
      `    Size: ${formatBytes(frag.size || 0)} | Tables: ${frag.tableCount} | ` +
      `Last touched: ${frag.lastSeen ? formatDate(frag.lastSeen) : 'unknown'} ` +
      `(${agoMin}m ago)`
    );
  }

  for (const frag of empty) {
    log(`  ◦ ${frag.path} (empty)`);
  }

  for (const frag of corrupted) {
    log(`  ✗ ${frag.path} (integrity check failed)`);
  }

  if (missing.length > 0 && missing.length <= 3) {
    for (const frag of missing) {
      log(`  - ${frag.path} (not found)`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 2: Pick source
  // ─────────────────────────────────────────────────────────────────────────────

  let source: DbFragment | null = null;

  if (explicitSource) {
    info(`Using explicit source: ${explicitSource}`);
    source = fragments.find(f => f.path === explicitSource) || null;
    if (!source) {
      error(`Explicit source not found: ${explicitSource}`);
      process.exitCode = 1;
      return;
    }
    if (!source.integrity) {
      error(`Explicit source failed integrity check: ${explicitSource}`);
      process.exitCode = 1;
      return;
    }
  } else {
    // Detect live daemon DB
    const daemonDb = getOpenDbFromDaemon();
    if (daemonDb) {
      source = valid.find(f => f.path === daemonDb);
      if (source) {
        info(`Detected live daemon using: ${source.path}`);
      }
    }

    // Fallback: pick by max(last_seen, updated_at)
    if (!source) {
      source = valid.reduce((best, curr) => {
        const currTs = curr.lastSeen || curr.mtime || 0;
        const bestTs = best.lastSeen || best.mtime || 0;
        return currTs > bestTs ? curr : best;
      });
      if (source) {
        info(`Daemon not detected; using freshest by timestamp: ${source.path}`);
      }
    }
  }

  if (!source) {
    error('No valid source database found. Cannot proceed.');
    process.exitCode = 1;
    return;
  }

  log(`\n✓ Source of truth: ${source.path}`);
  log(`  Size: ${formatBytes(source.size || 0)} | Tables: ${source.tableCount}\n`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 3: Show diffs and wait for approval
  // ─────────────────────────────────────────────────────────────────────────────

  printTableComparison(valid);

  const others = valid.filter(f => f.path !== source!.path);
  if (others.length > 0) {
    warn(`This will consolidate ${others.length} other database(s) into the canonical location and archive them.`);
    log(`\nCanonical destination: ${CANONICAL_DB_PATH}`);
    log(`Archive location: ${BACKUPS_DIR}/_pre-consolidation-<timestamp>/`);
    log(`\nTo consolidate:\n  1. VACUUM source DB into ${CANONICAL_DB_PATH}`);
    log(`  2. Archive all other fragments to backups/`);
    log(`  3. Operator must stop the daemon before consolidation completes`);
  } else {
    success('Already consolidated! No other fragments found.');
    return;
  }

  if (!force) {
    const ok = await confirm('\nProceed with consolidation?');
    if (!ok) {
      log('Aborted.');
      return;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 4: Perform consolidation
  // ─────────────────────────────────────────────────────────────────────────────

  log('\nConsolidating...\n');

  // 4a. Create archive directory
  const archiveTs = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const archiveDir = join(BACKUPS_DIR, `_pre-consolidation-${archiveTs}`);
  mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
  success(`Created archive directory: ${archiveDir}`);

  // 4b. VACUUM source into canonical
  info(`VACUUM-ing source into ${CANONICAL_DB_PATH}...`);
  try {
    const sourceDb = new Database(source.path, { readonly: false, fileMustExist: true });
    try {
      // Close any WAL files first
      sourceDb.pragma('wal_checkpoint(TRUNCATE)');

      // Ensure destination dir exists
      mkdirSync(dirname(CANONICAL_DB_PATH), { recursive: true, mode: 0o700 });

      // VACUUM INTO the canonical path
      const srcQuoted = source.path.replace(/'/g, "''");
      const destQuoted = CANONICAL_DB_PATH.replace(/'/g, "''");
      sourceDb['exec'](`VACUUM INTO '${destQuoted}';`);
    } finally {
      sourceDb.close();
    }
  } catch (err) {
    error(`VACUUM failed: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(CANONICAL_DB_PATH)) {
    error(`VACUUM INTO did not produce ${CANONICAL_DB_PATH}`);
    process.exitCode = 1;
    return;
  }

  success(`✓ Consolidated into ${CANONICAL_DB_PATH} (${formatBytes(statSync(CANONICAL_DB_PATH).size)})`);

  // Verify integrity of consolidated DB
  if (!checkIntegrity(CANONICAL_DB_PATH)) {
    error(`Consolidated DB failed integrity_check!`);
    process.exitCode = 1;
    return;
  }
  success(`Integrity check passed`);

  // 4c. Archive all other fragments
  info(`\nArchiving ${others.length} fragment(s)...`);
  for (const frag of others) {
    if (!frag.exists || !frag.path) continue;

    const basename = frag.path.split('/').pop() || 'unknown.db';
    const archivePath = join(archiveDir, basename);

    try {
      renameSync(frag.path, archivePath);
      success(`  Archived: ${frag.path}`);
    } catch (err) {
      warn(`  Failed to archive ${frag.path}: ${(err as Error).message}`);
    }
  }

  // 4d. Archive empty/corrupted files
  for (const frag of [...empty, ...corrupted]) {
    if (!frag.exists || !frag.path) continue;

    const basename = frag.path.split('/').pop() || 'unknown.db';
    const archivePath = join(archiveDir, basename);

    try {
      renameSync(frag.path, archivePath);
      const tag = corrupted.includes(frag) ? '(corrupted)' : '(empty)';
      success(`  Archived: ${frag.path} ${tag}`);
    } catch (err) {
      warn(`  Failed to archive ${frag.path}: ${(err as Error).message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Success
  // ─────────────────────────────────────────────────────────────────────────────

  log('\n' + '═'.repeat(60));
  success(`Consolidation complete!`);
  log(`\n  Canonical DB: ${CANONICAL_DB_PATH}`);
  log(`  Archived fragments: ${archiveDir}`);
  log(`\nNext steps:`);
  log(`  1. Verify the daemon starts cleanly: pd daemon start`);
  log(`  2. Check coordination: pd sitrep`);
  log(`  3. Once verified, you can safely delete the archive directory`);
  log(`\nREMINDER: If the daemon was running during consolidation,`);
  log(`it may still have the old DB file open. Stop and restart it.`);
  log('');
}

main().catch(err => {
  error((err as Error).message);
  process.exitCode = 1;
});
