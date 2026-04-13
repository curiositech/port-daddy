import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { getWorktreeInfo } from './worktree.js';

const CHANNEL_NAME_REGEX = /^[a-zA-Z0-9._:*-]+$/;
const MAX_CHANNEL_LENGTH = 100;

export type ChannelScope = 'branch' | 'worktree' | 'repo' | 'global';

export interface ChannelContext {
  projectDir: string | null;
  repoAnchor: string | null;
  repoKey: string | null;
  worktreeId: string | null;
  branch: string | null;
  inGit: boolean;
}

export interface DeclaredChannel {
  logicalName: string;
  physicalName: string;
  description: string | null;
  aliases: string[];
  scope: ChannelScope;
  projectDir: string | null;
  repoAnchor: string | null;
  repoKey: string | null;
  worktreeId: string | null;
  branch: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
  activeCount: number;
  lastMessage: number | null;
  active: boolean;
  source: 'declared' | 'observed';
}

export interface EnsureChannelOptions {
  aliases?: string[] | null;
  description?: string | null;
  scope?: ChannelScope | string | null;
  projectDir?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DiscoverChannelsOptions {
  projectDir?: string | null;
  query?: string | null;
  includeObserved?: boolean;
}

export interface ResolveChannelOptions {
  projectDir?: string | null;
}

export interface CreateChannelRegistryOptions {
  resolveContext?: (projectDir?: string | null) => ChannelContext;
}

interface ChannelRegistryRow {
  physical_channel: string;
  logical_name: string;
  description: string | null;
  aliases_json: string;
  scope: ChannelScope;
  project_dir: string | null;
  repo_anchor: string | null;
  repo_key: string | null;
  worktree_id: string | null;
  branch: string | null;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

interface MessageStatsRow {
  channel: string;
  count: number;
  last_message: number | null;
}

interface ActiveStats {
  count: number;
  lastMessage: number | null;
}

function shortHash(input: string, length: number = 8): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

function normalizeBranch(branch: string | null | undefined): string | null {
  if (!branch) return null;
  const trimmed = branch.trim();
  return trimmed || null;
}

function normalizeChannelName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CHANNEL_LENGTH) return null;
  if (!CHANNEL_NAME_REGEX.test(trimmed)) return null;
  return trimmed;
}

function canonicalScope(scope: ChannelScope | string | null | undefined): ChannelScope {
  if (scope === 'global' || scope === 'repo' || scope === 'worktree' || scope === 'branch') {
    return scope;
  }
  return 'branch';
}

function compactToken(input: string | null | undefined, fallback: string): string {
  const base = (input || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
  const slug = base.slice(0, 12);
  return `${slug}-${shortHash(input || fallback, 6)}`;
}

function buildPhysicalChannelCandidate(logicalName: string, context: ChannelContext, scope: ChannelScope): string {
  if (scope === 'global') return logicalName;

  const repoKey = context.repoKey || shortHash(context.projectDir || logicalName, 8);
  if (scope === 'repo') {
    return `repo:${repoKey}:${logicalName}`;
  }

  const worktreeId = context.worktreeId || shortHash(context.projectDir || logicalName, 8);
  if (scope === 'worktree') {
    return `wt:${repoKey}:${worktreeId}:${logicalName}`;
  }

  const branchToken = compactToken(context.branch, context.inGit ? 'detached' : 'nogit');
  return `br:${repoKey}:${worktreeId}:${branchToken}:${logicalName}`;
}

export function buildPhysicalChannelName(logicalName: string, context: ChannelContext, scope: ChannelScope): string {
  const candidate = buildPhysicalChannelCandidate(logicalName, context, scope);
  if (candidate.length <= MAX_CHANNEL_LENGTH) return candidate;

  const logicalToken = compactToken(logicalName, 'channel');
  const fallback = buildPhysicalChannelCandidate(logicalToken, context, scope);
  if (fallback.length <= MAX_CHANNEL_LENGTH) return fallback;

  const repoKey = context.repoKey || shortHash(context.projectDir || logicalName, 8);
  const worktreeId = context.worktreeId || shortHash(context.projectDir || logicalName, 8);
  const branchToken = compactToken(context.branch, context.inGit ? 'detached' : 'nogit');
  if (scope === 'repo') return `repo:${repoKey}:${shortHash(logicalName, 16)}`;
  if (scope === 'worktree') return `wt:${repoKey}:${worktreeId}:${shortHash(logicalName, 16)}`;
  if (scope === 'global') return `global:${shortHash(logicalName, 16)}`;
  return `br:${repoKey}:${worktreeId}:${branchToken}:${shortHash(logicalName, 16)}`;
}

function normalizeAliases(aliases: string[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const alias of aliases || []) {
    const normalized = normalizeChannelName(alias);
    if (normalized) set.add(normalized);
  }
  return [...set].sort();
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return normalizeAliases(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function matchesQuery(entry: DeclaredChannel, query: string | null): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [
    entry.logicalName,
    entry.physicalName,
    entry.description || '',
    ...entry.aliases,
  ].some((value) => value.toLowerCase().includes(needle));
}

function matchesContext(entry: DeclaredChannel, context: ChannelContext): boolean {
  if (entry.source === 'observed') return true;
  if (entry.scope === 'global') return true;
  if (!context.repoKey || entry.repoKey !== context.repoKey) return false;
  if (entry.scope === 'repo') return true;
  if (!context.worktreeId || entry.worktreeId !== context.worktreeId) return false;
  if (entry.scope === 'worktree') return true;
  return normalizeBranch(entry.branch) === normalizeBranch(context.branch);
}

function scopeRank(scope: ChannelScope): number {
  switch (scope) {
    case 'branch':
      return 4;
    case 'worktree':
      return 3;
    case 'repo':
      return 2;
    case 'global':
    default:
      return 1;
  }
}

function resolveRepoAnchor(root: string, commonDir: string): string {
  return commonDir.startsWith('/') ? commonDir : resolve(root, commonDir);
}

export function defaultResolveChannelContext(projectDir?: string | null): ChannelContext {
  const resolvedProjectDir = projectDir ? resolve(projectDir) : resolve(process.cwd());
  const info = getWorktreeInfo(resolvedProjectDir);
  if (!info) {
    const stableKey = shortHash(resolvedProjectDir, 8);
    return {
      projectDir: resolvedProjectDir,
      repoAnchor: resolvedProjectDir,
      repoKey: stableKey,
      worktreeId: stableKey,
      branch: null,
      inGit: false,
    };
  }

  const repoAnchor = resolveRepoAnchor(info.root, info.commonDir);
  return {
    projectDir: info.root,
    repoAnchor,
    repoKey: shortHash(repoAnchor, 8),
    worktreeId: info.id,
    branch: normalizeBranch(info.branch),
    inGit: true,
  };
}

export function createChannelRegistry(db: Database.Database, options: CreateChannelRegistryOptions = {}) {
  const resolveContext = options.resolveContext || defaultResolveChannelContext;

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_registry (
      physical_channel TEXT PRIMARY KEY,
      logical_name TEXT NOT NULL,
      description TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'branch',
      project_dir TEXT,
      repo_anchor TEXT,
      repo_key TEXT,
      worktree_id TEXT,
      branch TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_registry_logical ON channel_registry(logical_name);
    CREATE INDEX IF NOT EXISTS idx_channel_registry_repo_scope ON channel_registry(repo_key, worktree_id, branch, scope);
    CREATE INDEX IF NOT EXISTS idx_channel_registry_project_dir ON channel_registry(project_dir);
  `);

  const stmts = {
    selectAll: db.prepare('SELECT * FROM channel_registry'),
    selectByPhysical: db.prepare('SELECT * FROM channel_registry WHERE physical_channel = ?'),
    upsert: db.prepare(`
      INSERT INTO channel_registry (
        physical_channel, logical_name, description, aliases_json, scope,
        project_dir, repo_anchor, repo_key, worktree_id, branch,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(physical_channel) DO UPDATE SET
        logical_name = excluded.logical_name,
        description = excluded.description,
        aliases_json = excluded.aliases_json,
        scope = excluded.scope,
        project_dir = excluded.project_dir,
        repo_anchor = excluded.repo_anchor,
        repo_key = excluded.repo_key,
        worktree_id = excluded.worktree_id,
        branch = excluded.branch,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `),
    activeStats: db.prepare(`
      SELECT channel, COUNT(*) AS count, MAX(created_at) AS last_message
      FROM messages
      GROUP BY channel
    `),
  };

  function activeStatsMap(): Map<string, ActiveStats> {
    const rows = stmts.activeStats.all() as MessageStatsRow[];
    return new Map(
      rows.map((row) => [row.channel, { count: row.count, lastMessage: row.last_message }])
    );
  }

  function hydrate(row: ChannelRegistryRow, stats?: ActiveStats, source: 'declared' | 'observed' = 'declared'): DeclaredChannel {
    const active = stats || { count: 0, lastMessage: null };
    return {
      logicalName: row.logical_name,
      physicalName: row.physical_channel,
      description: row.description,
      aliases: parseJsonArray(row.aliases_json),
      scope: canonicalScope(row.scope),
      projectDir: row.project_dir,
      repoAnchor: row.repo_anchor,
      repoKey: row.repo_key,
      worktreeId: row.worktree_id,
      branch: normalizeBranch(row.branch),
      metadata: parseJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      activeCount: active.count,
      lastMessage: active.lastMessage,
      active: active.count > 0,
      source,
    };
  }

  function ensureChannel(name: string, opts: EnsureChannelOptions = {}) {
    const logicalName = normalizeChannelName(name);
    if (!logicalName) {
      return { success: false, error: 'channel name must be a non-empty string with only alphanumeric, dot, dash, underscore, colon, or star characters' };
    }

    const scope = canonicalScope(opts.scope);
    const context = resolveContext(opts.projectDir ?? null);
    const physicalName = buildPhysicalChannelName(logicalName, context, scope);
    const now = Date.now();
    const existing = stmts.selectByPhysical.get(physicalName) as ChannelRegistryRow | undefined;
    const existingAliases = existing ? parseJsonArray(existing.aliases_json) : [];
    const aliases = normalizeAliases([...existingAliases, ...(opts.aliases || [])].filter((alias) => alias !== logicalName));
    const description = typeof opts.description === 'string'
      ? opts.description.trim() || null
      : existing?.description ?? null;
    const metadata = opts.metadata === undefined
      ? parseJsonObject(existing?.metadata_json)
      : opts.metadata;

    stmts.upsert.run(
      physicalName,
      logicalName,
      description,
      JSON.stringify(aliases),
      scope,
      context.projectDir,
      context.repoAnchor,
      context.repoKey,
      context.worktreeId,
      context.branch,
      JSON.stringify(metadata || {}),
      existing?.created_at || now,
      now
    );

    const stats = activeStatsMap().get(physicalName);
    return {
      success: true,
      created: !existing,
      channel: hydrate({
        physical_channel: physicalName,
        logical_name: logicalName,
        description,
        aliases_json: JSON.stringify(aliases),
        scope,
        project_dir: context.projectDir,
        repo_anchor: context.repoAnchor,
        repo_key: context.repoKey,
        worktree_id: context.worktreeId,
        branch: context.branch,
        metadata_json: JSON.stringify(metadata || {}),
        created_at: existing?.created_at || now,
        updated_at: now,
      }, stats)
    };
  }

  function discoverChannels(opts: DiscoverChannelsOptions = {}) {
    const context = resolveContext(opts.projectDir ?? null);
    const query = opts.query ? opts.query.trim() : null;
    const stats = activeStatsMap();
    const declared = (stmts.selectAll.all() as ChannelRegistryRow[])
      .map((row) => hydrate(row, stats.get(row.physical_channel)))
      .filter((entry) => matchesContext(entry, context))
      .filter((entry) => matchesQuery(entry, query));

    const seen = new Set(declared.map((entry) => entry.physicalName));
    const observed: DeclaredChannel[] = [];
    if (opts.includeObserved) {
      for (const [channel, activity] of stats.entries()) {
        if (seen.has(channel)) continue;
        const observedEntry: DeclaredChannel = {
          logicalName: channel,
          physicalName: channel,
          description: null,
          aliases: [],
          scope: 'global',
          projectDir: null,
          repoAnchor: null,
          repoKey: null,
          worktreeId: null,
          branch: null,
          metadata: null,
          createdAt: activity.lastMessage || Date.now(),
          updatedAt: activity.lastMessage || Date.now(),
          activeCount: activity.count,
          lastMessage: activity.lastMessage,
          active: activity.count > 0,
          source: 'observed',
        };
        if (!matchesQuery(observedEntry, query)) continue;
        observed.push(observedEntry);
      }
    }

    const channels = [...declared, ...observed].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.source !== b.source) return a.source === 'declared' ? -1 : 1;
      const rankDelta = scopeRank(b.scope) - scopeRank(a.scope);
      if (rankDelta !== 0) return rankDelta;
      const timeDelta = (b.lastMessage || 0) - (a.lastMessage || 0);
      if (timeDelta !== 0) return timeDelta;
      return a.logicalName.localeCompare(b.logicalName);
    });

    return { success: true, context, channels };
  }

  function resolveChannel(name: string, opts: ResolveChannelOptions = {}) {
    const normalized = normalizeChannelName(name);
    if (!normalized) {
      return { success: false, error: 'channel name must be a non-empty string with only alphanumeric, dot, dash, underscore, colon, or star characters' };
    }

    const stats = activeStatsMap();
    const exact = stmts.selectByPhysical.get(normalized) as ChannelRegistryRow | undefined;
    if (exact) {
      return { success: true, channel: hydrate(exact, stats.get(exact.physical_channel)) };
    }

    const context = resolveContext(opts.projectDir ?? null);
    const candidates = discoverChannels({
      projectDir: context.projectDir,
      includeObserved: true,
    }).channels.filter((entry) =>
      entry.logicalName === normalized ||
      entry.physicalName === normalized ||
      entry.aliases.includes(normalized)
    );

    if (candidates.length === 0) {
      return { success: false, error: `No declared channel found for "${normalized}" in the current repo/worktree context` };
    }

    const channel = [...candidates].sort((a, b) => {
      const aExact = a.logicalName === normalized || a.physicalName === normalized ? 1 : 0;
      const bExact = b.logicalName === normalized || b.physicalName === normalized ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      if (a.source !== b.source) return a.source === 'declared' ? -1 : 1;
      const rankDelta = scopeRank(b.scope) - scopeRank(a.scope);
      if (rankDelta !== 0) return rankDelta;
      return b.updatedAt - a.updatedAt;
    })[0];

    return { success: true, channel };
  }

  return {
    ensureChannel,
    resolveChannel,
    discoverChannels,
  };
}
