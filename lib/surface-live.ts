/**
 * Surface scan — the LIVE wiring that makes after-edit semantic conflict detection fire.
 *
 * `lib/surface-scan.ts` is the tested logic (real edits → predictConflicts → nudges); it
 * takes injected `sessions` (with worktree paths) and a `getDiff`. This module supplies
 * the real ones: it resolves each active session's `worktreeId` to its filesystem path via
 * `listWorktrees()` (the daemon's `git worktree list --porcelain` reader — `worktreeId` is
 * the hash of the worktree root, exactly `WorktreeInfo.id`), and reads each worktree's
 * working-tree diff with `git diff -U0` (zero context → precise hunk line numbers).
 *
 * Pure resolution (`resolveSurfaceSessions`) is split from the IO (`gitDiffReader`,
 * `runLiveSurfaceScan`) so the mapping is testable without a daemon or real worktrees.
 */

import { execFileSync } from 'node:child_process';
import { listWorktrees, type WorktreeInfo } from './worktree.js';
import { runSurfaceScan, type SurfaceScanSession, type SurfaceScanResult, type RunSurfaceScanDeps } from './surface-scan.js';

export interface ActiveSessionLite {
  id: string;
  agentId: string | null;
  purpose: string;
  worktreeId: string | null;
}

/**
 * PURE: map active sessions to surface-scan sessions, resolving each `worktreeId` to its
 * filesystem path. Sessions with no worktree, or whose worktree isn't currently checked
 * out, are dropped (nothing to diff).
 */
export function resolveSurfaceSessions(
  active: ActiveSessionLite[],
  worktrees: Array<Pick<WorktreeInfo, 'id' | 'root'>>,
): SurfaceScanSession[] {
  const rootById = new Map(worktrees.map((w) => [w.id, w.root]));
  const out: SurfaceScanSession[] = [];
  for (const s of active) {
    if (!s.worktreeId) continue;
    const root = rootById.get(s.worktreeId);
    if (!root) continue;
    out.push({ sessionId: s.id, agentId: s.agentId, purpose: s.purpose, worktreePath: root });
  }
  return out;
}

/** Real working-tree diff with zero context lines (precise hunk ranges). Fail-soft: a
 *  non-repo / git error yields no diff rather than throwing the whole scan. */
export function gitDiffReader(worktreePath: string): string {
  try {
    // execFileSync (no shell) with a fixed arg vector — the worktree path is the cwd,
    // never interpolated into a command string.
    return execFileSync('git', ['diff', '-U0'], {
      cwd: worktreePath,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15000,
    });
  } catch {
    return '';
  }
}

export interface RunLiveSurfaceScanDeps {
  listActiveSessions: () => ActiveSessionLite[];
  symbolIndex: RunSurfaceScanDeps['symbolIndex'];
  suggestions: RunSurfaceScanDeps['suggestions'];
  inbox: RunSurfaceScanDeps['inbox'];
  activityLog?: RunSurfaceScanDeps['activityLog'];
  /** Daemon's symbol-claims store — enables the claim guard (real edits vs other
   *  sessions' DECLARED claims). Optional: absent = diff-vs-diff prediction only. */
  symbolClaims?: RunSurfaceScanDeps['symbolClaims'];
  /** Overridable for tests; defaults to the real `listWorktrees()` / `git diff -U0`. */
  listWorktrees?: () => Array<Pick<WorktreeInfo, 'id' | 'root'>>;
  getDiff?: (worktreePath: string) => string;
}

/**
 * Resolve live sessions to their worktrees and run the real-edit semantic-conflict scan.
 * The on-demand trigger: a scan route or daemon tick calls this; it surfaces signature/
 * dependency/transitive conflicts between what agents have *actually edited* right now.
 */
export async function runLiveSurfaceScan(deps: RunLiveSurfaceScanDeps): Promise<SurfaceScanResult> {
  const worktrees = (deps.listWorktrees ?? listWorktrees)();
  const sessions = resolveSurfaceSessions(deps.listActiveSessions(), worktrees);
  return runSurfaceScan({
    sessions,
    getDiff: deps.getDiff ?? gitDiffReader,
    symbolIndex: deps.symbolIndex,
    suggestions: deps.suggestions,
    inbox: deps.inbox,
    activityLog: deps.activityLog,
    symbolClaims: deps.symbolClaims,
  });
}
