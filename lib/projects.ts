/**
 * Projects Module
 *
 * Central registry for projects known to Port Daddy.
 * Lightweight — the source of truth is still .portdaddyrc.
 * This table is one source of truth for "known projects".
 * The control plane also merges it with durable on-disk Port Daddy markers
 * and live runtime evidence so stale DB rows do not masquerade as active repos.
 */

import type Database from 'better-sqlite3';
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

interface ProjectRow {
  id: string;
  root: string;
  type: string;
  config: string | null;
  services: string | null;
  tags: string | null;
  last_scanned: number;
  created_at: number;
  metadata: string | null;
}

interface ProjectDeserialized {
  id: string;
  root: string;
  type: string;
  config: Record<string, unknown> | null;
  services: Record<string, unknown> | null;
  tags: string[] | null;
  last_scanned: number;
  created_at: number;
  metadata: Record<string, unknown> | null;
}

interface RegisterInput {
  id: string;
  root: string;
  type?: string;
  config?: Record<string, unknown> | null;
  services?: Record<string, unknown> | null;
  tags?: string[] | string | null;
  metadata?: Record<string, unknown> | null;
}

interface KnownProject extends ProjectDeserialized {
  displayName: string;
  signals: string[];
  sources: string[];
  exists: boolean;
}

interface ListKnownOptions {
  pattern?: string;
  discoveryRoots?: string[];
  runtimeRoots?: string[];
  serviceRoots?: string[];
  maxDepth?: number;
  fresh?: boolean;
}

const FLEET_MARKERS = ['pd-fleet.yml', 'pd-fleet.yaml', '.portdaddy/fleet.yml', '.portdaddy/fleet.yaml'] as const;
const CONFIG_MARKERS = ['.portdaddyrc', '.portdaddyrc.json', 'portdaddy.config.json'] as const;
const CONTEXT_MARKERS = ['.portdaddy'] as const;
const SEARCH_ROOT_HINTS = ['coding', 'worktrees', 'src', 'dev', 'Code'] as const;
const SKIP_DISCOVERY_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.yarn',
  '.pnpm-store',
  'node_modules',
  'coverage',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
]);
const TEMP_ROOT_PATTERNS = [
  /^\/tmp(?:\/|$)/,
  /^\/private\/tmp(?:\/|$)/,
  /^\/var\/folders\/.*\/T(?:\/|$)/,
];
const DISCOVERY_CACHE_TTL_MS = 15_000;

let discoveryCache:
  | {
      key: string;
      expiresAt: number;
      entries: Array<{ root: string; signals: string[] }>;
    }
  | null = null;

function normalizeRoot(root: string): string {
  return resolve(root);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function markerExists(root: string, relativePath: string): boolean {
  return existsSync(join(root, relativePath));
}

function detectProjectSignals(root: string): string[] {
  const normalizedRoot = normalizeRoot(root);
  const signals = new Set<string>();

  if (FLEET_MARKERS.some((marker) => markerExists(normalizedRoot, marker))) {
    signals.add('fleet');
  }
  if (CONFIG_MARKERS.some((marker) => markerExists(normalizedRoot, marker))) {
    signals.add('config');
  }
  if (CONTEXT_MARKERS.some((marker) => markerExists(normalizedRoot, marker) && isDirectory(join(normalizedRoot, marker)))) {
    signals.add('context');
  }

  return [...signals].sort();
}

function matchesPattern(candidate: string, pattern?: string): boolean {
  if (!pattern) return true;
  const normalizedPattern = pattern.includes('*') ? pattern.replace(/\*/g, '.*') : pattern;
  const regex = new RegExp(normalizedPattern, 'i');
  return regex.test(candidate);
}

function isEphemeralRoot(root: string): boolean {
  return TEMP_ROOT_PATTERNS.some((pattern) => pattern.test(root));
}

function findPortDaddyRoot(startPath: string): string | null {
  let current = normalizeRoot(startPath);

  while (true) {
    if (detectProjectSignals(current).length > 0) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function compressSearchRoots(roots: string[]): string[] {
  const ordered = [...new Set(roots.map(normalizeRoot).filter(isDirectory))].sort((a, b) => a.length - b.length);
  const compressed: string[] = [];

  for (const candidate of ordered) {
    if (compressed.some((root) => candidate === root || candidate.startsWith(`${root}/`))) {
      continue;
    }
    compressed.push(candidate);
  }

  return compressed;
}

function buildDiscoveryRoots(explicitRoots: string[] = []): string[] {
  const home = homedir();
  const hintedRoots = SEARCH_ROOT_HINTS.map((segment) => join(home, segment));
  const cwdRoots = [process.cwd(), dirname(process.cwd())];
  const parentRoots = explicitRoots.map((root) => dirname(normalizeRoot(root)));
  return compressSearchRoots([
    ...explicitRoots,
    ...parentRoots,
    ...cwdRoots,
    ...hintedRoots,
  ]);
}

function discoverProjectRoots(searchRoots: string[], maxDepth: number, fresh = false): Array<{ root: string; signals: string[] }> {
  const key = JSON.stringify([searchRoots, maxDepth]);
  if (!fresh && discoveryCache && discoveryCache.key === key && discoveryCache.expiresAt > Date.now()) {
    return discoveryCache.entries;
  }

  const discovered = new Map<string, Set<string>>();
  const visited = new Set<string>();

  function remember(root: string, signals: string[]): void {
    if (!signals.length) return;
    const normalizedRoot = normalizeRoot(root);
    const next = discovered.get(normalizedRoot) ?? new Set<string>();
    for (const signal of signals) next.add(signal);
    discovered.set(normalizedRoot, next);
  }

  function walk(dir: string, depth: number): void {
    const normalizedDir = normalizeRoot(dir);
    if (visited.has(normalizedDir) || depth > maxDepth || !isDirectory(normalizedDir)) return;
    visited.add(normalizedDir);

    const signals = detectProjectSignals(normalizedDir);
    if (signals.length > 0) {
      remember(normalizedDir, signals);
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(normalizedDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DISCOVERY_DIRS.has(entry.name)) continue;
      walk(join(normalizedDir, entry.name), depth + 1);
    }
  }

  for (const root of searchRoots) {
    walk(root, 0);
  }

  const entries = [...discovered.entries()].map(([root, signals]) => ({
    root,
    signals: [...signals].sort(),
  }));

  discoveryCache = {
    key,
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
    entries,
  };

  return entries;
}

/**
 * Initialize the projects module with a database connection.
 */
export function createProjects(db: Database.Database) {
  // Migrations
  try {
    db.exec('ALTER TABLE projects ADD COLUMN tags TEXT');
  } catch { /* already exists */ }

  // Prepared statements
  const stmts = {
    getById: db.prepare('SELECT * FROM projects WHERE id = ?'),
    getByPath: db.prepare('SELECT * FROM projects WHERE root = ?'),
    getAll: db.prepare('SELECT * FROM projects ORDER BY last_scanned DESC'),
    getByPattern: db.prepare(`
      SELECT * FROM projects 
      WHERE (id LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')
      ORDER BY last_scanned DESC
    `),
    upsert: db.prepare(`
      INSERT INTO projects (id, root, type, config, services, tags, last_scanned, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        root = excluded.root,
        type = excluded.type,
        config = excluded.config,
        services = excluded.services,
        tags = COALESCE(excluded.tags, tags),
        last_scanned = excluded.last_scanned,
        metadata = excluded.metadata
    `),
    deleteById: db.prepare('DELETE FROM projects WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) as count FROM projects')
  };

  /**
   * Register or update a project.
   */
  function register(project: RegisterInput): ProjectDeserialized | null {
    const now = Date.now();
    const normalizedRoot = normalizeRoot(project.root);
    const existing = stmts.getById.get(project.id) as ProjectRow | undefined;
    const tagsValue = Array.isArray(project.tags) ? project.tags.join(',') : (project.tags || null);

    stmts.upsert.run(
      project.id,
      normalizedRoot,
      project.type || 'single',
      project.config ? JSON.stringify(project.config) : null,
      project.services ? JSON.stringify(project.services) : null,
      tagsValue,
      now,
      existing?.created_at || now,
      project.metadata ? JSON.stringify(project.metadata) : null
    );

    return get(project.id);
  }

  /**
   * Get a project by ID.
   */
  function get(id: string): ProjectDeserialized | null {
    const row = stmts.getById.get(id) as ProjectRow | undefined;
    return row ? deserialize(row) : null;
  }

  /**
   * Get a project by its root directory path.
   */
  function getByPath(root: string): ProjectDeserialized | null {
    const row = stmts.getByPath.get(normalizeRoot(root)) as ProjectRow | undefined;
    return row ? deserialize(row) : null;
  }

  /**
   * List explicitly registered projects.
   */
  function list(options: { pattern?: string } = {}): ProjectDeserialized[] {
    const { pattern = null } = options;
    let rows: ProjectRow[];

    if (pattern) {
      const sqlPattern = pattern.includes('*') ? pattern.replace(/\*/g, '%') : `%${pattern}%`;
      rows = stmts.getByPattern.all(sqlPattern, sqlPattern) as ProjectRow[];
    } else {
      rows = stmts.getAll.all() as ProjectRow[];
    }

    return rows.map(deserialize);
  }

  function listKnown(options: ListKnownOptions = {}): KnownProject[] {
    const {
      pattern,
      runtimeRoots = [],
      serviceRoots = [],
      discoveryRoots = [],
      maxDepth = 4,
      fresh = false,
    } = options;

    const registered = list({ pattern });
    const known = new Map<string, {
      row: ProjectDeserialized | null;
      signals: Set<string>;
      sources: Set<string>;
    }>();

    const upsert = (root: string, source: string, row: ProjectDeserialized | null = null, signals?: string[]) => {
      const normalizedRoot = normalizeRoot(root);
      const entry = known.get(normalizedRoot) ?? {
        row: null,
        signals: new Set<string>(),
        sources: new Set<string>(),
      };
      if (row) entry.row = row;
      entry.sources.add(source);
      for (const signal of signals ?? detectProjectSignals(normalizedRoot)) {
        entry.signals.add(signal);
      }
      known.set(normalizedRoot, entry);
    };

    for (const row of registered) {
      upsert(row.root, 'registered', row);
    }

    for (const runtimeRoot of runtimeRoots) {
      if (runtimeRoot) upsert(runtimeRoot, 'runtime');
    }

    for (const serviceRoot of serviceRoots) {
      if (!serviceRoot) continue;
      const projectRoot = findPortDaddyRoot(serviceRoot) ?? normalizeRoot(serviceRoot);
      upsert(projectRoot, 'service');
    }

    const discoveredRoots = discoverProjectRoots(
      buildDiscoveryRoots([
        ...discoveryRoots,
        ...registered.map((entry) => entry.root),
        ...runtimeRoots,
        ...serviceRoots,
      ]),
      maxDepth,
      fresh,
    );

    for (const entry of discoveredRoots) {
      upsert(entry.root, 'discovered', null, entry.signals);
    }

    const projects = [...known.entries()]
      .map(([root, entry]) => {
        const exists = isDirectory(root);
        const signals = [...entry.signals].sort();
        const sources = [...entry.sources].sort();
        const shouldKeep = exists && (signals.length > 0 || sources.includes('runtime') || sources.includes('service'));
        if (!shouldKeep) return null;
        if (isEphemeralRoot(root) && !signals.length && !sources.includes('runtime')) return null;

        const displayName = entry.row?.id || basename(root) || root;
        const project: KnownProject = {
          id: entry.row?.id || displayName,
          root,
          type: entry.row?.type || (signals.includes('fleet') ? 'fleet' : 'single'),
          config: entry.row?.config ?? null,
          services: entry.row?.services ?? null,
          tags: entry.row?.tags ?? [],
          last_scanned: entry.row?.last_scanned ?? 0,
          created_at: entry.row?.created_at ?? 0,
          metadata: entry.row?.metadata ?? null,
          displayName,
          signals,
          sources,
          exists,
        };
        return project;
      })
      .filter((entry): entry is KnownProject => !!entry)
      .filter((entry) => {
        if (!pattern) return true;
        const haystack = [
          entry.id,
          entry.displayName,
          entry.root,
          ...entry.signals,
          ...entry.sources,
          ...(entry.tags ?? []),
        ].join(' ');
        return matchesPattern(haystack, pattern);
      })
      .sort((lhs, rhs) => {
        const lhsRuntime = lhs.sources.includes('runtime') ? 1 : 0;
        const rhsRuntime = rhs.sources.includes('runtime') ? 1 : 0;
        if (lhsRuntime !== rhsRuntime) return rhsRuntime - lhsRuntime;

        const lhsSignals = lhs.signals.length;
        const rhsSignals = rhs.signals.length;
        if (lhsSignals !== rhsSignals) return rhsSignals - lhsSignals;

        const lhsScanned = lhs.last_scanned ?? 0;
        const rhsScanned = rhs.last_scanned ?? 0;
        if (lhsScanned !== rhsScanned) return rhsScanned - lhsScanned;

        return lhs.displayName.localeCompare(rhs.displayName);
      });

    return projects;
  }

  /**
   * Remove a project by ID.
   */
  function remove(id: string): boolean {
    const result = stmts.deleteById.run(id);
    return result.changes > 0;
  }

  /**
   * Get the count of registered projects.
   */
  function count(): number {
    return (stmts.count.get() as { count: number }).count;
  }

  /**
   * Deserialize JSON fields from a database row.
   */
  function safeJsonParse(value: string | null): Record<string, unknown> | null {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function deserialize(row: ProjectRow): ProjectDeserialized {
    return {
      ...row,
      config: safeJsonParse(row.config),
      services: safeJsonParse(row.services),
      tags: row.tags ? row.tags.split(',').map(t => t.trim()) : [],
      metadata: safeJsonParse(row.metadata)
    };
  }

  return { register, get, getByPath, list, listKnown, remove, count };
}
