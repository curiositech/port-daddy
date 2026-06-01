import type { WorktreeInfo } from './worktree.js';

export interface SessionWorktreeContext {
  id: string;
  root: string;
  name: string;
  branch: string | null;
  isMain: boolean;
}

export interface SessionWorktreePolicyInput {
  worktree?: unknown;
  requireLinkedWorktree?: boolean;
  allowMainWorktree?: boolean;
}

export interface SessionWorktreePolicyResult {
  success: boolean;
  worktree: SessionWorktreeContext | null;
  code?: 'WORKTREE_REQUIRED' | 'MAIN_WORKTREE_SESSION_FORBIDDEN';
  error?: string;
  hint?: string;
}

export function toSessionWorktreeContext(info: WorktreeInfo): SessionWorktreeContext {
  return {
    id: info.id,
    root: info.root,
    name: info.name,
    branch: info.branch,
    isMain: info.isMain,
  };
}

export function normalizeSessionWorktreeContext(value: unknown): SessionWorktreeContext | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (typeof raw.root !== 'string' || !raw.root.trim()) return null;
  if (typeof raw.isMain !== 'boolean') return null;

  return {
    id: raw.id,
    root: raw.root,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : raw.root.split('/').pop() || 'unknown',
    branch: typeof raw.branch === 'string' && raw.branch.trim() ? raw.branch : null,
    isMain: raw.isMain,
  };
}

export function evaluateSessionWorktreePolicy(input: SessionWorktreePolicyInput): SessionWorktreePolicyResult {
  const requireLinkedWorktree = input.requireLinkedWorktree === true;
  const allowMainWorktree = input.allowMainWorktree === true;
  const worktree = normalizeSessionWorktreeContext(input.worktree);

  if (!requireLinkedWorktree) {
    return { success: true, worktree };
  }

  if (!worktree) {
    return {
      success: false,
      worktree: null,
      code: 'WORKTREE_REQUIRED',
      error: 'Port Daddy sessions must be started from a linked Git worktree.',
      hint: 'Create a session worktree with `git worktree add ../<name> -b <branch>` and run `pd begin` there.',
    };
  }

  if (worktree.isMain && !allowMainWorktree) {
    // Deliberately do NOT name the `--allow-main-worktree` escape hatch here.
    // An agent that hits this wall will take whatever exit the error hands it,
    // so advertising the bypass turns a guardrail into a suggestion and defeats
    // the policy. The flag stays discoverable for humans in `pd begin --help`;
    // the runtime refusal only points to the correct action.
    return {
      success: false,
      worktree,
      code: 'MAIN_WORKTREE_SESSION_FORBIDDEN',
      error: 'Port Daddy sessions refuse the main Git worktree by default.',
      hint: 'Create a linked worktree with `git worktree add ../<name> -b <branch>` and run `pd begin` there.',
    };
  }

  return { success: true, worktree };
}

export function mergeSessionWorktreeMetadata(
  metadata: Record<string, unknown> | null | undefined,
  worktree: SessionWorktreeContext | null,
  policy: { requireLinkedWorktree?: boolean; allowMainWorktree?: boolean },
): Record<string, unknown> | null {
  if (!worktree && !policy.requireLinkedWorktree && !policy.allowMainWorktree) {
    return metadata ?? null;
  }

  return {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    sessionWorktreePolicy: {
      requireLinkedWorktree: policy.requireLinkedWorktree === true,
      allowMainWorktree: policy.allowMainWorktree === true,
    },
    ...(worktree ? { worktree } : {}),
  };
}
