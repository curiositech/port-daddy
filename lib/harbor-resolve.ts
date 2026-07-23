/**
 * Harbor resolution — the git-worktree-aware canonicalizer for roadmap
 * writes.
 *
 * Extracted out of `cli/commands/roadmap.ts` (which still exports
 * `resolveRoadmapHarbor` as a thin CLIOptions-shaped wrapper around this)
 * so non-CLI callers — notably `scripts/roadmap-dedup.ts`, which needs to
 * pick a canonical harbor for a duplicate-slug group the same way a `pd
 * roadmap upsert` from this repo would — can reuse the EXACT same
 * resolution logic instead of reimplementing a parallel ranking heuristic.
 * Importing the full `cli/commands/roadmap.ts` module for one pure
 * function would drag in pdFetch/prompt/shell-quote machinery that has
 * nothing to do with harbor resolution.
 */
import { resolve, basename } from 'node:path';
import { getWorktreeInfo } from './worktree.js';

export interface HarborResolveOptions {
  /** Explicit harbor override, if any (e.g. a CLI `--harbor` flag). */
  harbor?: string;
  /** Directory to resolve from. Defaults to `process.cwd()`. */
  cwd?: string;
}

/**
 * Resolve the harbor a roadmap write should target. Precedence:
 *   explicit harbor, then $PD_HARBOR, then the canonical repo/project name
 *   (worktree-aware — a linked worktree resolves to the MAIN checkout's
 *   name, not the worktree directory's), then cwd basename, then undefined.
 */
export function resolveHarbor(options: HarborResolveOptions = {}): string | undefined {
  const explicit = options.harbor?.trim();
  if (explicit) return explicit;
  const env = process.env.PD_HARBOR?.trim();
  if (env) return env;
  const cwd = options.cwd ?? process.cwd();
  const worktree = getWorktreeInfo(cwd);
  if (worktree) {
    const commonDir = resolve(worktree.root, worktree.commonDir);
    const canonicalRoot = basename(commonDir) === '.git'
      ? resolve(commonDir, '..')
      : worktree.root;
    const projectName = basename(canonicalRoot);
    if (projectName) return projectName;
  }
  const cwdBase = basename(cwd);
  return cwdBase || undefined;
}
