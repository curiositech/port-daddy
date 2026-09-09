/**
 * Backend binary resolver — discovers absolute paths to CLI tools (claude-code,
 * codex, aider, …) that the daemon needs to spawn agents.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The daemon runs under launchd (macOS) or systemd (Linux) with a minimal PATH:
 *   /usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
 *
 * User-installed tools live in ~/.local/bin, ~/.nvm/…/bin, pip's user-site bin,
 * etc. — none of which are in the launchd PATH. Using bare binary names at
 * spawn-time silently fails with ENOENT.
 *
 * The fix: run discovery ONCE at install/update time using the INSTALLING USER'S
 * full shell PATH, persist the absolute paths to a cache file, and inject those
 * parent directories into the daemon's PATH at plist-generation time. At spawn
 * time, prefer the cached absolute path over the bare name.
 *
 * This works for any user — no manual symlinks required.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Symbolic tool names understood by the spawner. */
export type CliToolName = 'claude-code' | 'codex' | 'aider';

/** Resolved cache entry for a single binary. */
export interface ResolvedBin {
  /** Absolute path to the binary, or null if not found. */
  path: string | null;
  /** The PATH that was searched when this entry was written. */
  searchedPath: string;
  /** Unix timestamp (ms) when the cache entry was written. */
  resolvedAt: number;
}

/** Full cache file shape. */
export interface BackendBinCache {
  schemaVersion: 1;
  /** Cache entries keyed by CliToolName. */
  bins: Partial<Record<CliToolName, ResolvedBin>>;
}

// ─── Catalog: what binaries to look for ──────────────────────────────────────

/** The bare binary names to search on PATH, per tool. */
export const TOOL_BINARY_NAMES: Record<CliToolName, string[]> = {
  'claude-code': ['claude'],
  codex: ['codex'],
  aider: ['aider'],
};

/** All tools the resolver knows about. */
export const ALL_TOOLS: CliToolName[] = ['claude-code', 'codex', 'aider'];

// ─── Cache file location ──────────────────────────────────────────────────────

export function backendBinCachePath(): string {
  return join(homedir(), '.port-daddy', 'backend-bins.json');
}

// ─── Core resolution logic ────────────────────────────────────────────────────

/**
 * Walk a PATH string and return the first absolute path where any of the
 * candidate binary names is an executable file. Returns null if none found.
 *
 * @param candidates  Bare binary names to search for (e.g. ['claude']).
 * @param searchPath  Colon-separated PATH string to walk.
 */
export function findBinOnPath(candidates: string[], searchPath: string): string | null {
  const dirs = searchPath.split(':').filter(Boolean);
  for (const candidate of candidates) {
    for (const dir of dirs) {
      const full = join(dir, candidate);
      if (!existsSync(full)) continue;
      try {
        const st = statSync(full);
        // Regular file with at least one execute bit set.
        if (st.isFile() && (st.mode & 0o111) !== 0) return full;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Resolve absolute paths for all known CLI tools.
 *
 * @param searchPath  PATH to search. Defaults to process.env.PATH (the
 *                    INSTALLING USER'S shell PATH, not the daemon's PATH).
 * @param tools       Subset of tools to resolve. Defaults to ALL_TOOLS.
 */
export function resolveBackendBins(
  searchPath?: string,
  tools: CliToolName[] = ALL_TOOLS,
): Partial<Record<CliToolName, ResolvedBin>> {
  const path = searchPath ?? process.env.PATH ?? '';
  const now = Date.now();
  const result: Partial<Record<CliToolName, ResolvedBin>> = {};
  for (const tool of tools) {
    const candidates = TOOL_BINARY_NAMES[tool];
    result[tool] = {
      path: findBinOnPath(candidates, path),
      searchedPath: path,
      resolvedAt: now,
    };
  }
  return result;
}

// ─── Cache I/O ────────────────────────────────────────────────────────────────

/** Write resolved bins to the cache file under ~/.port-daddy/. */
export function writeBackendBinCache(
  bins: Partial<Record<CliToolName, ResolvedBin>>,
  cachePath = backendBinCachePath(),
): void {
  const dir = dirname(cachePath);
  mkdirSync(dir, { recursive: true });
  const cache: BackendBinCache = { schemaVersion: 1, bins };
  writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf-8');
}

/** Read the cache file. Returns null if it does not exist or is malformed. */
export function readBackendBinCache(
  cachePath = backendBinCachePath(),
): BackendBinCache | null {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as BackendBinCache;
    if (parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Look up the cached absolute path for a tool. Returns null if not cached or
 * not found during the last resolution pass.
 */
export function getCachedBinPath(tool: CliToolName, cachePath?: string): string | null {
  const cache = readBackendBinCache(cachePath);
  return cache?.bins[tool]?.path ?? null;
}

// ─── Unique parent directories for plist PATH injection ──────────────────────

/**
 * Return the set of unique parent directories from the resolved bins, suitable
 * for inclusion in the launchd plist PATH. Only directories that actually exist
 * on disk are included.
 */
export function resolvedBinDirs(bins: Partial<Record<CliToolName, ResolvedBin>>): string[] {
  const dirs = new Set<string>();
  for (const entry of Object.values(bins)) {
    if (entry?.path) dirs.add(dirname(entry.path));
  }
  return [...dirs].filter(d => existsSync(d));
}

// ─── Install-time entry point ─────────────────────────────────────────────────

/**
 * Discover, cache, and return backend bins. Meant to be called during
 * `pd install` / `pd update` while the user's shell PATH is still in
 * scope (not from inside the daemon).
 *
 * Logs discoveries to stdout so the installer can report them.
 */
export function installTimeResolve(
  opts: { silent?: boolean; searchPath?: string } = {},
): { bins: Partial<Record<CliToolName, ResolvedBin>>; extraDirs: string[] } {
  const bins = resolveBackendBins(opts.searchPath);
  writeBackendBinCache(bins);

  if (!opts.silent) {
    for (const [tool, entry] of Object.entries(bins) as [CliToolName, ResolvedBin][]) {
      if (entry.path) {
        console.log(`  [backend-bins] ${tool}: ${entry.path}`);
      } else {
        console.log(`  [backend-bins] ${tool}: not found (CLI backend unavailable)`);
      }
    }
  }

  const extraDirs = resolvedBinDirs(bins);
  return { bins, extraDirs };
}

// ─── Shell `which`-style lookup (fallback for live PATH) ─────────────────────

/**
 * Fallback: ask the system `which` for a binary. Used when no cache exists and
 * we want a best-effort lookup at daemon start. Much slower than the cache path;
 * do not call this in a hot loop.
 */
export function whichBin(name: string): string | null {
  try {
    const result = spawnSync('which', [name], { encoding: 'utf-8', timeout: 3000 });
    if (result.status === 0) {
      const p = result.stdout.trim();
      return p || null;
    }
  } catch {
    // ignore
  }
  return null;
}
