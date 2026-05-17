/**
 * Git Worktree Detection
 *
 * Detects which git worktree we're in and provides identity for session scoping.
 */

import { execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface WorktreeInfo {
  /** Absolute path to the worktree root */
  root: string;
  /** Short identifier (hash of root path) */
  id: string;
  /** Name derived from directory */
  name: string;
  /** Current branch */
  branch: string | null;
  /** Whether this is the main worktree or a linked one */
  isMain: boolean;
  /** Path to the common git directory (shared across worktrees) */
  commonDir: string;
}

function gitExecOptions(cwd?: string): ExecSyncOptionsWithStringEncoding {
  return {
    ...(cwd ? { cwd } : {}),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  };
}

/**
 * Get the current worktree info, or null if not in a git repo
 */
export function getWorktreeInfo(cwd?: string): WorktreeInfo | null {
  const opts = gitExecOptions(cwd);

  try {
    // Get worktree root
    const root = execSync('git rev-parse --show-toplevel', opts).toString().trim();
    
    // Get common git dir (shared across all worktrees of a repo)
    const commonDir = execSync('git rev-parse --git-common-dir', opts).toString().trim();
    
    // Get current git dir
    const gitDir = execSync('git rev-parse --git-dir', opts).toString().trim();
    
    // Determine if main or linked worktree
    const isMain = commonDir === gitDir || commonDir === '.git' || commonDir === '.';
    
    // Get current branch
    let branch: string | null = null;
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
      if (branch === 'HEAD') branch = null; // Detached HEAD
    } catch {
      branch = null;
    }

    // Generate short ID from root path
    const id = createHash('sha256').update(root).digest('hex').slice(0, 8);
    
    // Name from directory
    const name = root.split('/').pop() || 'unknown';

    return { root, id, name, branch, isMain, commonDir };
  } catch {
    return null;
  }
}

/**
 * Get all worktrees for the current repo
 */
export function listWorktrees(cwd?: string): WorktreeInfo[] {
  const opts = gitExecOptions(cwd);

  try {
    const output = execSync('git worktree list --porcelain', opts).toString();
    const worktrees: WorktreeInfo[] = [];
    
    let current: Partial<WorktreeInfo> = {};
    
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.root) {
          // Save previous worktree
          worktrees.push(current as WorktreeInfo);
        }
        const root = line.slice('worktree '.length);
        current = {
          root,
          id: createHash('sha256').update(root).digest('hex').slice(0, 8),
          name: root.split('/').pop() || 'unknown',
          isMain: false
        };
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch refs/heads/'.length);
      } else if (line === 'bare') {
        current.isMain = true;
      }
    }
    
    // Save last worktree
    if (current.root) {
      worktrees.push(current as WorktreeInfo);
    }

    // First worktree is always main
    if (worktrees.length > 0) {
      worktrees[0].isMain = true;
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Get worktree ID for the current directory, or null if not in a repo
 */
export function getWorktreeId(cwd?: string): string | null {
  const info = getWorktreeInfo(cwd);
  return info?.id ?? null;
}
