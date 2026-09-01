/**
 * GitHub repo → projectDir registry.
 *
 * Closes the per-project routing gap in the inbound webhook path
 * (routes/github-webhook.ts). Without this, the route publishes only the
 * unscoped (`global:`) GitHub channels, so EVERY project whose fleet
 * subscribes to `global:github:webhook:<event>` fires on EVERY installed
 * repo's webhook — a fan-out.
 *
 * With a `repo → projectDir` mapping, the route can additionally publish a
 * project-scoped channel (`project:<slug>:<hash>:github:webhook:<event>`,
 * via lib/fleet-channels.ts::resolveFleetChannel). A ship in the matching
 * project then declares a *bare* trigger — `trigger: github:webhook:pull_request`
 * — which the fleet channel resolver project-scopes by default, so it fires
 * ONLY for its own repository.
 *
 * How a repo claims a project:
 *
 *   1. Explicit (preferred) — declare it in the project's pd-fleet.yml:
 *
 *        github:
 *          repo: curiositech/port-daddy
 *          # or several:
 *          # repos: [curiositech/port-daddy, curiositech/example-service]
 *
 *      The block may sit at the root or nested under `fleet:`.
 *
 *   2. Inferred — the project's git `origin` remote, parsed to `owner/name`.
 *      Used only when no explicit declaration exists, so an operator can
 *      always override the inferred value.
 *
 * This module is deliberately pure of daemon internals: it takes the list of
 * candidate project directories (the daemon's fleet supervisor already tracks
 * these) and a small set of injectable readers, so it is unit-testable with
 * fixtures and never reaches for a live daemon, network, or shell.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { getProjectScope } from './fleet-channels.js';

const FLEET_CONFIG_NAMES = ['pd-fleet.yml', 'pd-fleet.yaml', '.pd-fleet.yml'];

/** Normalize an `owner/name` (or full GitHub URL) to lowercase `owner/name`. */
export function normalizeRepoFullName(value: string): string | null {
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (!s) return null;

  // Strip a GitHub URL or git remote down to owner/name.
  //   https://github.com/owner/name(.git)
  //   git@github.com:owner/name(.git)
  //   ssh://git@github.com/owner/name(.git)
  s = s.replace(/^https?:\/\/github\.com\//i, '');
  s = s.replace(/^ssh:\/\/git@github\.com\//i, '');
  s = s.replace(/^git@github\.com:/i, '');
  s = s.replace(/\.git$/i, '');
  s = s.replace(/\/+$/g, '');

  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  // Take the last two segments so trailing path noise (e.g. a deep URL) is dropped.
  const owner = parts[parts.length - 2];
  const name = parts[parts.length - 1];
  if (!owner || !name) return null;
  return `${owner.toLowerCase()}/${name.toLowerCase()}`;
}

interface FleetGithubBlock {
  repo?: unknown;
  repos?: unknown;
}

interface FleetRootish {
  github?: FleetGithubBlock;
  fleet?: { github?: FleetGithubBlock };
}

/** Pull declared repo full-names out of a parsed pd-fleet.yml object. */
function declaredReposFromConfig(root: FleetRootish): string[] {
  const block = root.github ?? root.fleet?.github;
  if (!block || typeof block !== 'object') return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    const n = typeof v === 'string' ? normalizeRepoFullName(v) : null;
    if (n) out.push(n);
  };
  push(block.repo);
  if (Array.isArray(block.repos)) for (const r of block.repos) push(r);
  return out;
}

export interface RepoRegistryReaders {
  /** Returns the first existing fleet-config path in a project dir, or null. */
  findFleetConfigPath?: (projectDir: string) => string | null;
  /** Reads a file as UTF-8; returns null if it cannot be read. */
  readFile?: (path: string) => string | null;
  /** Returns the git `origin` remote URL for a project dir, or null. */
  readGitOrigin?: (projectDir: string) => string | null;
}

function defaultFindFleetConfigPath(projectDir: string): string | null {
  for (const name of FLEET_CONFIG_NAMES) {
    const p = join(projectDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function defaultReadGitOrigin(projectDir: string): string | null {
  try {
    const out = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export interface RepoMapEntry {
  repo: string;       // normalized owner/name
  projectDir: string;
  scope: string;      // project:<slug>:<hash> (from lib/fleet-channels.ts)
  source: 'declared' | 'inferred';
}

/**
 * Build a `repo → projectDir` map from a set of candidate project directories.
 *
 * Declared mappings (from pd-fleet.yml `github.repo(s)`) win over inferred
 * ones (git origin). If two projects declare the same repo, the first one in
 * `projectDirs` order wins and the collision is recorded in `conflicts` so the
 * caller can surface it — silently dropping a duplicate would hide a real
 * misconfiguration.
 */
export function buildRepoRegistry(
  projectDirs: string[],
  readers: RepoRegistryReaders = {},
): { map: Map<string, RepoMapEntry>; conflicts: Array<{ repo: string; kept: string; dropped: string }> } {
  const findFleetConfigPath = readers.findFleetConfigPath ?? defaultFindFleetConfigPath;
  const readFile = readers.readFile ?? defaultReadFile;
  const readGitOrigin = readers.readGitOrigin ?? defaultReadGitOrigin;

  const map = new Map<string, RepoMapEntry>();
  const conflicts: Array<{ repo: string; kept: string; dropped: string }> = [];

  const add = (repo: string, projectDir: string, source: RepoMapEntry['source']) => {
    const existing = map.get(repo);
    if (existing) {
      // Declared beats inferred; otherwise first-wins.
      if (existing.source === 'inferred' && source === 'declared') {
        map.set(repo, { repo, projectDir, scope: getProjectScope(projectDir), source });
        return;
      }
      if (existing.projectDir !== projectDir) {
        conflicts.push({ repo, kept: existing.projectDir, dropped: projectDir });
      }
      return;
    }
    map.set(repo, { repo, projectDir, scope: getProjectScope(projectDir), source });
  };

  // Pass 1: explicit declarations (authoritative).
  const declaredDirs = new Set<string>();
  for (const projectDir of projectDirs) {
    const cfgPath = findFleetConfigPath(projectDir);
    if (!cfgPath) continue;
    const text = readFile(cfgPath);
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const repos = declaredReposFromConfig(parsed as FleetRootish);
    if (repos.length) declaredDirs.add(projectDir);
    for (const repo of repos) add(repo, projectDir, 'declared');
  }

  // Pass 2: git-origin inference — only for projects that did not declare.
  for (const projectDir of projectDirs) {
    if (declaredDirs.has(projectDir)) continue;
    const origin = readGitOrigin(projectDir);
    if (!origin) continue;
    const repo = normalizeRepoFullName(origin);
    if (repo) add(repo, projectDir, 'inferred');
  }

  return { map, conflicts };
}

/**
 * A lazily-refreshed registry suitable for the daemon. The daemon supplies a
 * `getProjectDirs` callback (its fleet supervisor already tracks these); the
 * registry caches the built map and rebuilds on a TTL so newly-installed
 * projects are picked up without a daemon restart.
 */
export interface RepoRegistry {
  /** Resolve a normalized `owner/name` to its project entry, or null. */
  resolve(repoFullName: string): RepoMapEntry | null;
  /** Force a rebuild on the next resolve(). */
  invalidate(): void;
  /** Current entries (rebuilds if stale). For diagnostics / `pd` surfaces. */
  entries(): RepoMapEntry[];
}

export interface CreateRepoRegistryDeps {
  getProjectDirs: () => string[];
  readers?: RepoRegistryReaders;
  /** Cache TTL in ms (default 30s). */
  ttlMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Optional logger for conflict surfacing. */
  logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
}

export function createRepoRegistry(deps: CreateRepoRegistryDeps): RepoRegistry {
  const ttlMs = deps.ttlMs ?? 30_000;
  const now = deps.now ?? Date.now;
  let cache: Map<string, RepoMapEntry> | null = null;
  let builtAt = 0;

  function ensure(): Map<string, RepoMapEntry> {
    if (cache && now() - builtAt < ttlMs) return cache;
    const { map, conflicts } = buildRepoRegistry(deps.getProjectDirs(), deps.readers);
    if (conflicts.length && deps.logger) {
      for (const c of conflicts) {
        deps.logger.warn('github_repo_registry_conflict', {
          repo: c.repo,
          kept: c.kept,
          dropped: c.dropped,
        });
      }
    }
    cache = map;
    builtAt = now();
    return cache;
  }

  return {
    resolve(repoFullName: string): RepoMapEntry | null {
      const norm = normalizeRepoFullName(repoFullName);
      if (!norm) return null;
      return ensure().get(norm) ?? null;
    },
    invalidate() {
      cache = null;
      builtAt = 0;
    },
    entries() {
      return [...ensure().values()];
    },
  };
}
