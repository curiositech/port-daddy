#!/usr/bin/env npx tsx
/**
 * DB consolidation tool - ADR-0044 / ADR-0090 WS-0.
 *
 * Dry-run is the default. A real consolidation requires `--apply`, a valid
 * source database, no live daemon holding any candidate DB open, and either an
 * interactive confirmation or `--yes` / `--force`.
 */

import Database from '../lib/sqlite-runtime.js';
import { resolveDbPath } from '../lib/db.js';
import type { Dirent } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '..');
const DEFAULT_DB_FILE = 'port-registry.db';
const PROFILE_DB_FILE = 'port-daddy.db';

export interface ConsolidationConfig {
  homeDir: string;
  pdHome: string;
  repoRoot: string;
  canonicalDbPath: string;
  daemonPortFile: string;
  backupsDir: string;
  host: string;
}

export interface DbFragment {
  path: string;
  exists: boolean;
  size?: number;
  mtime?: number;
  tableCount?: number;
  lastTouched?: number;
  integrity?: boolean;
  error?: string;
}

export interface ConsolidationPlan {
  config: ConsolidationConfig;
  fragments: DbFragment[];
  valid: DbFragment[];
  empty: DbFragment[];
  corrupted: DbFragment[];
  missing: DbFragment[];
  source: DbFragment | null;
  liveOpenDbs: string[];
  archiveDir: string;
  stagedPath: string;
  toArchive: DbFragment[];
  currentCanonical: DbFragment | null;
  alreadyConsolidated: boolean;
  blockers: string[];
  warnings: string[];
}

export interface BuildPlanOptions {
  config?: ConsolidationConfig;
  candidatePaths?: string[];
  explicitSource?: string;
  liveOpenDbs?: string[];
  now?: () => number;
}

export interface ApplyConsolidationResult {
  canonicalDbPath: string;
  archiveDir: string;
  stagedPath: string;
  archivedPaths: string[];
  archivedCanonicalPaths: string[];
  warnings: string[];
}

interface ParsedArgs {
  apply: boolean;
  yes: boolean;
  json: boolean;
  explicitSource?: string;
  canonical?: string;
  backupsDir?: string;
  home?: string;
}

interface MovedPath {
  from: string;
  to: string;
}

type CommandRunner = (command: string, args: string[]) => string;

function log(...args: unknown[]): void {
  console.log(...args);
}

function info(msg: string): void {
  console.log(`[info] ${msg}`);
}

function warn(msg: string): void {
  console.log(`[warn] ${msg}`);
}

function ok(msg: string): void {
  console.log(`[ok] ${msg}`);
}

function fail(msg: string): void {
  console.error(`[error] ${msg}`);
}

function pathKey(path: string): string {
  return resolve(path);
}

function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

function pushPath(paths: string[], path: string | undefined | null): void {
  if (!path || !path.trim()) return;
  paths.push(resolve(path));
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(pathKey))).sort();
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function sqlQuote(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function isDbPath(path: string): boolean {
  return path.endsWith('.db') && !path.endsWith('-wal') && !path.endsWith('-shm');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(1)}${units[index]}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function archiveStamp(now: number): string {
  return new Date(now).toISOString().replace(/\.\d+Z$/, '').replace(/[:]/g, '-');
}

function hashPath(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 10);
}

function sanitizeArchiveLabel(path: string, config: ConsolidationConfig): string {
  const resolved = resolve(path);
  const home = resolve(config.homeDir);
  const label = resolved === home || resolved.startsWith(`${home}${sep}`)
    ? relative(home, resolved)
    : resolved;
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, '__').replace(/^_+|_+$/g, '');
  return safe.slice(-140) || basename(path);
}

function archiveTargetFor(path: string, archiveDir: string, config: ConsolidationConfig): string {
  const label = sanitizeArchiveLabel(path, config);
  const target = join(archiveDir, `${label}--${hashPath(path)}`);
  if (!existsSync(target)) return target;
  let i = 2;
  while (existsSync(`${target}.${i}`)) i++;
  return `${target}.${i}`;
}

function dbFamilyPaths(path: string): string[] {
  return [path, `${path}-wal`, `${path}-shm`];
}

function movePath(from: string, to: string): MovedPath | null {
  if (!existsSync(from)) return null;
  mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
  renameSync(from, to);
  return { from, to };
}

function archiveDbFamily(path: string, archiveDir: string, config: ConsolidationConfig): MovedPath[] {
  const moved: MovedPath[] = [];
  for (const familyPath of dbFamilyPaths(path)) {
    const target = archiveTargetFor(familyPath, archiveDir, config);
    const result = movePath(familyPath, target);
    if (result) moved.push(result);
  }
  return moved;
}

function restoreMovedPaths(moved: MovedPath[]): void {
  for (const item of [...moved].reverse()) {
    if (!existsSync(item.to)) continue;
    mkdirSync(dirname(item.from), { recursive: true, mode: 0o700 });
    if (existsSync(item.from)) rmSync(item.from, { force: true });
    renameSync(item.to, item.from);
  }
}

function coerceTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function resolvePdHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): string {
  const explicit = env.PORT_DADDY_HOME?.trim();
  return explicit ? resolve(explicit) : join(homeDir, '.port-daddy');
}

export function buildConsolidationConfig(options: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pdHome?: string;
  repoRoot?: string;
  canonicalDbPath?: string;
  backupsDir?: string;
} = {}): ConsolidationConfig {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const pdHome = resolve(options.pdHome ?? resolvePdHome(env, homeDir));
  const canonicalDbPath = resolve(options.canonicalDbPath ?? join(pdHome, DEFAULT_DB_FILE));
  return {
    homeDir,
    pdHome,
    repoRoot: resolve(options.repoRoot ?? REPO_ROOT),
    canonicalDbPath,
    daemonPortFile: join(pdHome, 'daemon.port'),
    backupsDir: resolve(options.backupsDir ?? join(pdHome, 'backups')),
    host: hostname(),
  };
}

function scanForDbFiles(root: string, names: Set<string>, maxDepth: number): string[] {
  const found: string[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && names.has(entry.name)) {
        found.push(full);
      }
    }
  }
  walk(root, 0);
  return found;
}

export function discoverCandidateDbPaths(
  config: ConsolidationConfig = buildConsolidationConfig(),
  options: { env?: NodeJS.ProcessEnv; explicitSource?: string; liveOpenDbs?: string[] } = {},
): string[] {
  const env = options.env ?? process.env;
  const paths: string[] = [];

  pushPath(paths, env.PORT_DADDY_DB);
  pushPath(paths, options.explicitSource);
  pushPath(paths, config.canonicalDbPath);

  try {
    pushPath(paths, resolveDbPath());
  } catch {
    // Best-effort only; explicit candidates below carry the safety-critical set.
  }

  pushPath(paths, join(config.repoRoot, DEFAULT_DB_FILE));
  pushPath(paths, join(config.repoRoot, 'dist', DEFAULT_DB_FILE));

  const instancesDir = join(config.pdHome, 'instances');
  try {
    for (const entry of readdirSync(instancesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) pushPath(paths, join(instancesDir, entry.name, PROFILE_DB_FILE));
    }
  } catch {
    // No profile dir yet.
  }

  for (const prefix of ['/opt/homebrew', '/usr/local']) {
    pushPath(paths, join(prefix, 'var', 'port-daddy', DEFAULT_DB_FILE));
    pushPath(paths, join(prefix, 'opt', 'port-daddy', DEFAULT_DB_FILE));
    pushPath(paths, join(prefix, 'opt', 'port-daddy', 'libexec', DEFAULT_DB_FILE));
    paths.push(...scanForDbFiles(join(prefix, 'Cellar', 'port-daddy'), new Set([DEFAULT_DB_FILE]), 6));
  }

  for (const openDb of options.liveOpenDbs ?? []) {
    pushPath(paths, openDb);
  }

  return uniquePaths(paths);
}

function defaultCommandRunner(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function parseLsofPids(output: string): number[] {
  const pids = new Set<number>();
  for (const line of output.split('\n')) {
    if (!line.startsWith('p')) continue;
    const pid = Number.parseInt(line.slice(1), 10);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

export function parseLsofNames(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split('\n')) {
    if (!line.startsWith('n')) continue;
    const name = line.slice(1).trim();
    if (isDbPath(name)) names.push(resolve(name));
  }
  return uniquePaths(names);
}

export function getOpenDbsFromDaemon(
  config: ConsolidationConfig = buildConsolidationConfig(),
  runCommand: CommandRunner = defaultCommandRunner,
): string[] {
  if (!existsSync(config.daemonPortFile)) return [];
  let port = '';
  try {
    port = readFileSync(config.daemonPortFile, 'utf8').trim();
  } catch {
    return [];
  }
  if (!/^\d{2,5}$/.test(port)) return [];

  let pids: number[] = [];
  try {
    pids = parseLsofPids(runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']));
  } catch {
    return [];
  }

  const openDbs: string[] = [];
  for (const pid of pids) {
    try {
      openDbs.push(...parseLsofNames(runCommand('lsof', ['-nP', '-p', String(pid), '-Fn'])));
    } catch {
      // Process exited between probes.
    }
  }
  return uniquePaths(openDbs);
}

export function checkIntegrity(dbPath: string): boolean {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const result = db.pragma('integrity_check', { simple: true });
      return result === 'ok';
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

function tableCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'")
      .get() as { count?: number } | undefined;
    return row?.count ?? 0;
  } finally {
    db.close();
  }
}

function lastTouched(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const queries = [
      "SELECT MAX(last_seen) AS ts FROM services",
      "SELECT MAX(updated_at) AS ts FROM sessions",
      "SELECT MAX(updated_at) AS ts FROM roadmap_items",
      "SELECT MAX(created_at) AS ts FROM messages",
      "SELECT MAX(created_at) AS ts FROM session_notes",
    ];
    let newest = 0;
    for (const query of queries) {
      try {
        const row = db.prepare(query).get() as { ts?: unknown } | undefined;
        newest = Math.max(newest, coerceTimestamp(row?.ts));
      } catch {
        // Table or column may not exist in older fragments.
      }
    }
    return newest;
  } finally {
    db.close();
  }
}

export function scanDatabase(path: string): DbFragment {
  const fragment: DbFragment = { path: resolve(path), exists: existsSync(path) };
  if (!fragment.exists) return fragment;

  try {
    const stats = statSync(path);
    if (!stats.isFile()) {
      fragment.error = 'not a file';
      return fragment;
    }
    fragment.size = stats.size;
    fragment.mtime = stats.mtimeMs;
    if (stats.size === 0) return fragment;

    fragment.tableCount = tableCount(path);
    fragment.lastTouched = lastTouched(path);
    fragment.integrity = checkIntegrity(path);
    if (!fragment.integrity) fragment.error = 'integrity_check failed';
  } catch (err) {
    fragment.error = (err as Error).message;
  }
  return fragment;
}

export function scanDatabases(paths: string[]): DbFragment[] {
  return uniquePaths(paths).map((path) => scanDatabase(path));
}

export function getTableMetrics(dbPath: string): Map<string, number> {
  const metrics = new Map<string, number>();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    for (const { name } of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(name)}`).get() as { count?: number };
        metrics.set(name, row.count ?? 0);
      } catch {
        // Skip odd virtual tables or broken legacy fragments.
      }
    }
  } finally {
    db.close();
  }
  return metrics;
}

function classifyFragments(fragments: DbFragment[]): {
  valid: DbFragment[];
  empty: DbFragment[];
  corrupted: DbFragment[];
  missing: DbFragment[];
} {
  return {
    valid: fragments.filter((f) => f.exists && (f.size ?? 0) > 0 && f.integrity === true),
    empty: fragments.filter((f) => f.exists && (f.size ?? 0) === 0),
    corrupted: fragments.filter((f) => f.exists && (f.size ?? 0) > 0 && f.integrity !== true),
    missing: fragments.filter((f) => !f.exists),
  };
}

function chooseSource(
  valid: DbFragment[],
  explicitSource: string | undefined,
  liveOpenDbs: string[],
): DbFragment | null {
  if (valid.length === 0) return null;

  if (explicitSource) {
    const source = valid.find((f) => samePath(f.path, explicitSource));
    if (!source) {
      throw new Error(`explicit source is not a valid SQLite fragment: ${explicitSource}`);
    }
    return source;
  }

  for (const openDb of liveOpenDbs) {
    const live = valid.find((f) => samePath(f.path, openDb));
    if (live) return live;
  }

  return [...valid].sort((a, b) => {
    const aTs = a.lastTouched || a.mtime || 0;
    const bTs = b.lastTouched || b.mtime || 0;
    return bTs - aTs || (b.size ?? 0) - (a.size ?? 0) || a.path.localeCompare(b.path);
  })[0];
}

function buildBlockers(plan: Pick<ConsolidationPlan, 'fragments' | 'config' | 'liveOpenDbs'>): string[] {
  const existing = new Set(
    plan.fragments
      .filter((f) => f.exists)
      .flatMap((f) => dbFamilyPaths(f.path))
      .map(pathKey),
  );
  existing.add(pathKey(plan.config.canonicalDbPath));

  const blockers: string[] = [];
  for (const openDb of plan.liveOpenDbs) {
    if (existing.has(pathKey(openDb))) {
      blockers.push(`daemon has candidate DB open: ${openDb}`);
    }
  }
  return blockers;
}

export function buildConsolidationPlan(options: BuildPlanOptions = {}): ConsolidationPlan {
  const config = options.config ?? buildConsolidationConfig();
  const liveOpenDbs = options.liveOpenDbs ?? getOpenDbsFromDaemon(config);
  const candidatePaths = options.candidatePaths ?? discoverCandidateDbPaths(config, {
    explicitSource: options.explicitSource,
    liveOpenDbs,
  });
  const fragments = scanDatabases(candidatePaths);
  const { valid, empty, corrupted, missing } = classifyFragments(fragments);
  const source = chooseSource(valid, options.explicitSource, liveOpenDbs);
  const currentCanonical = fragments.find((f) => samePath(f.path, config.canonicalDbPath)) ?? null;
  const toArchive = fragments.filter((f) => f.exists && !samePath(f.path, config.canonicalDbPath));
  const now = (options.now ?? Date.now)();
  const archiveDir = join(config.backupsDir, `_pre-consolidation-${archiveStamp(now)}`);
  const stagedPath = `${config.canonicalDbPath}.consolidating-${archiveStamp(now)}-${process.pid}.tmp`;
  const alreadyConsolidated =
    !!source &&
    samePath(source.path, config.canonicalDbPath) &&
    toArchive.length === 0 &&
    corrupted.length === 0 &&
    empty.length === 0;

  const warnings: string[] = [];
  if (currentCanonical?.exists && source && !samePath(source.path, config.canonicalDbPath)) {
    warnings.push(`canonical DB will be replaced by selected source: ${source.path}`);
  }
  if (corrupted.length > 0) {
    warnings.push(`${corrupted.length} corrupted DB fragment(s) will be archived, not merged`);
  }
  if (empty.length > 0) {
    warnings.push(`${empty.length} empty DB fragment(s) will be archived`);
  }

  const plan: ConsolidationPlan = {
    config,
    fragments,
    valid,
    empty,
    corrupted,
    missing,
    source,
    liveOpenDbs,
    archiveDir,
    stagedPath,
    toArchive,
    currentCanonical,
    alreadyConsolidated,
    blockers: [],
    warnings,
  };
  plan.blockers = buildBlockers(plan);
  return plan;
}

function vacuumInto(sourcePath: string, destPath: string): void {
  if (existsSync(destPath)) rmSync(destPath, { force: true });
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    db['exec'](`VACUUM INTO ${sqlQuote(destPath)};`);
  } finally {
    db.close();
  }
}

export function applyConsolidationPlan(plan: ConsolidationPlan): ApplyConsolidationResult {
  if (!plan.source) {
    throw new Error('no valid source database found');
  }
  if (plan.alreadyConsolidated) {
    return {
      canonicalDbPath: plan.config.canonicalDbPath,
      archiveDir: plan.archiveDir,
      stagedPath: plan.stagedPath,
      archivedPaths: [],
      archivedCanonicalPaths: [],
      warnings: ['already consolidated; no mutation performed'],
    };
  }
  if (plan.blockers.length > 0) {
    throw new Error(
      `refusing to apply while a daemon has candidate DB files open:\n` +
      plan.blockers.map((b) => `  - ${b}`).join('\n') +
      `\nStop the stable/dev daemon first, then rerun with --apply.`,
    );
  }

  mkdirSync(plan.archiveDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(plan.config.canonicalDbPath), { recursive: true, mode: 0o700 });

  const archivedCanonical: MovedPath[] = [];
  const archivedFragments: MovedPath[] = [];
  const warnings: string[] = [];
  let installedCanonical = false;

  try {
    vacuumInto(plan.source.path, plan.stagedPath);
    if (!existsSync(plan.stagedPath)) {
      throw new Error(`VACUUM INTO did not produce staged DB: ${plan.stagedPath}`);
    }
    if (!checkIntegrity(plan.stagedPath)) {
      throw new Error(`staged DB failed integrity_check: ${plan.stagedPath}`);
    }
    try {
      chmodSync(plan.stagedPath, 0o600);
    } catch {
      // Best-effort; inherited umask is still user-owned.
    }

    archivedCanonical.push(...archiveDbFamily(plan.config.canonicalDbPath, plan.archiveDir, plan.config));
    renameSync(plan.stagedPath, plan.config.canonicalDbPath);
    installedCanonical = true;
    try {
      chmodSync(plan.config.canonicalDbPath, 0o600);
    } catch {
      // Best-effort.
    }

    for (const fragment of plan.toArchive) {
      try {
        archivedFragments.push(...archiveDbFamily(fragment.path, plan.archiveDir, plan.config));
      } catch (err) {
        warnings.push(`failed to archive ${fragment.path}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    if (existsSync(plan.stagedPath)) rmSync(plan.stagedPath, { force: true });
    if (installedCanonical && existsSync(plan.config.canonicalDbPath)) {
      rmSync(plan.config.canonicalDbPath, { force: true });
    }
    restoreMovedPaths(archivedCanonical);
    throw new Error(`consolidation failed; original canonical DB was rolled back: ${(err as Error).message}`);
  }

  if (!checkIntegrity(plan.config.canonicalDbPath)) {
    restoreMovedPaths(archivedCanonical);
    throw new Error('canonical DB failed integrity_check after install; original canonical DB was rolled back');
  }

  return {
    canonicalDbPath: plan.config.canonicalDbPath,
    archiveDir: plan.archiveDir,
    stagedPath: plan.stagedPath,
    archivedPaths: archivedFragments.map((m) => m.to),
    archivedCanonicalPaths: archivedCanonical.map((m) => m.to),
    warnings,
  };
}

function printInventory(plan: ConsolidationPlan): void {
  log(`Found: ${plan.valid.length} valid | ${plan.empty.length} empty | ${plan.corrupted.length} corrupted | ${plan.missing.length} missing`);
  log('');
  for (const frag of plan.valid) {
    const ageMin = Math.round((Date.now() - (frag.mtime ?? 0)) / 60000);
    log(
      `  OK ${frag.path}\n` +
      `     size=${formatBytes(frag.size ?? 0)} tables=${frag.tableCount ?? 0} ` +
      `lastTouched=${frag.lastTouched ? formatDate(frag.lastTouched) : 'unknown'} mtimeAge=${ageMin}m`,
    );
  }
  for (const frag of plan.empty) log(`  EMPTY ${frag.path}`);
  for (const frag of plan.corrupted) log(`  BAD ${frag.path} (${frag.error ?? 'integrity failed'})`);
}

function printTableComparison(plan: ConsolidationPlan): void {
  if (plan.valid.length <= 1) return;
  const metricsByPath = new Map<string, Map<string, number>>();
  const tables = new Set<string>();
  for (const frag of plan.valid) {
    const metrics = getTableMetrics(frag.path);
    metricsByPath.set(frag.path, metrics);
    for (const table of metrics.keys()) tables.add(table);
  }
  if (tables.size === 0) return;

  info('Table row-count comparison:');
  const candidates = plan.valid;
  const header = ['table', ...candidates.map((c) => `${basename(c.path)}:${hashPath(c.path).slice(0, 4)}`)];
  log(`  ${header.map((h) => h.padEnd(24)).join('')}`);
  log(`  ${'-'.repeat(header.length * 24)}`);
  for (const table of [...tables].sort()) {
    const row = [table];
    for (const frag of candidates) {
      row.push(String(metricsByPath.get(frag.path)?.get(table) ?? 0));
    }
    log(`  ${row.map((c) => c.padEnd(24)).join('')}`);
  }
  log('');
}

function printPlan(plan: ConsolidationPlan, apply: boolean): void {
  log('Port Daddy DB Consolidation');
  log('');
  log(`Canonical destination: ${plan.config.canonicalDbPath}`);
  log(`Archive directory:      ${plan.archiveDir}`);
  log(`Mode:                   ${apply ? 'APPLY' : 'DRY-RUN (default)'}`);
  log('');
  printInventory(plan);

  if (!plan.source) {
    fail('No valid source database found.');
    return;
  }
  log('');
  ok(`Source of truth: ${plan.source.path}`);
  log(`  size=${formatBytes(plan.source.size ?? 0)} tables=${plan.source.tableCount ?? 0}`);
  log('');
  printTableComparison(plan);

  if (plan.warnings.length > 0) {
    for (const item of plan.warnings) warn(item);
    log('');
  }
  if (plan.blockers.length > 0) {
    for (const item of plan.blockers) warn(item);
    log('');
  }
  if (plan.alreadyConsolidated) {
    ok('Already consolidated; no fragments need archiving.');
    return;
  }

  log('Planned mutation:');
  log(`  1. VACUUM source into staged DB: ${plan.stagedPath}`);
  log(`  2. Verify staged DB with PRAGMA integrity_check`);
  log(`  3. Archive current canonical DB family, if present`);
  log(`  4. Rename staged DB into canonical destination`);
  log(`  5. Archive ${plan.toArchive.length} non-canonical DB fragment(s) plus sidecars`);
  log('');
  if (!apply) {
    info('Dry-run only. Re-run with --apply after stopping daemon berths that hold these DBs open.');
  }
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

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { apply: false, yes: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--apply':
        args.apply = true;
        break;
      case '--dry-run':
        args.apply = false;
        break;
      case '--yes':
      case '-y':
      case '--force':
        args.yes = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--source':
        args.explicitSource = resolve(argv[++i] ?? '');
        break;
      case '--canonical':
        args.canonical = resolve(argv[++i] ?? '');
        break;
      case '--backups-dir':
        args.backupsDir = resolve(argv[++i] ?? '');
        break;
      case '--home':
        args.home = resolve(argv[++i] ?? '');
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage(): void {
  log(`Usage: npx tsx scripts/db-consolidate.ts [options]

Options:
  --dry-run              Print inventory and mutation plan (default)
  --apply                Perform the staged replace and archive fragments
  --yes, --force         Skip interactive confirmation for --apply
  --source <path>        Select a specific source DB
  --canonical <path>     Override canonical destination (tests/dev only)
  --backups-dir <path>   Override archive root (tests/dev only)
  --home <path>          Resolve ~/.port-daddy under this home (tests/dev only)
  --json                 Emit plan/result JSON
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const config = buildConsolidationConfig({
    homeDir: args.home,
    canonicalDbPath: args.canonical,
    backupsDir: args.backupsDir,
  });
  const plan = buildConsolidationPlan({
    config,
    explicitSource: args.explicitSource,
  });

  if (args.json) {
    log(JSON.stringify({ plan }, null, 2));
  } else {
    printPlan(plan, args.apply);
  }

  if (!args.apply || plan.alreadyConsolidated) return;
  if (plan.blockers.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (!args.yes) {
    const proceed = await confirm('Apply consolidation now?');
    if (!proceed) {
      info('Aborted before mutation.');
      return;
    }
  }

  const result = applyConsolidationPlan(plan);
  if (args.json) {
    log(JSON.stringify({ success: true, result }, null, 2));
  } else {
    ok(`Consolidated into ${result.canonicalDbPath}`);
    ok(`Archive directory: ${result.archiveDir}`);
    if (result.archivedCanonicalPaths.length > 0) {
      info(`Archived previous canonical family: ${result.archivedCanonicalPaths.length} file(s)`);
    }
    if (result.archivedPaths.length > 0) {
      info(`Archived fragments: ${result.archivedPaths.length} file(s)`);
    }
    for (const item of result.warnings) warn(item);
    log('');
    info('Restart the daemon/berth after consolidation so it opens the canonical DB.');
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1] ? resolve(process.argv[1]) : '';
  return entry === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  main().catch((err) => {
    fail((err as Error).message);
    process.exitCode = 1;
  });
}
