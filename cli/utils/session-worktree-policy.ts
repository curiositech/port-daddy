import type { CLIOptions } from '../types.js';
import { getWorktreeInfo } from '../../lib/worktree.js';
import {
  evaluateSessionWorktreePolicy,
  mergeSessionWorktreeMetadata,
  toSessionWorktreeContext,
  type SessionWorktreeContext,
} from '../../lib/worktree-policy.js';

interface CliSessionWorktreePolicy {
  success: boolean;
  requireLinkedWorktree: boolean;
  allowMainWorktree: boolean;
  worktree: SessionWorktreeContext | null;
  error?: string;
  hint?: string;
  code?: string;
}

function optionEnabled(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function envAllowsMainWorktree(): boolean {
  const value = process.env.PORT_DADDY_ALLOW_MAIN_WORKTREE_SESSION;
  return value === '1' || value === 'true' || value === 'yes';
}

export function resolveCliSessionWorktreePolicy(
  options: CLIOptions,
  cwd: string = process.cwd(),
): CliSessionWorktreePolicy {
  const allowMainWorktree = optionEnabled(options['allow-main-worktree']) || envAllowsMainWorktree();
  const info = getWorktreeInfo(cwd);

  if (!info) {
    return {
      success: true,
      requireLinkedWorktree: false,
      allowMainWorktree,
      worktree: null,
    };
  }

  const worktree = toSessionWorktreeContext(info);
  const result = evaluateSessionWorktreePolicy({
    worktree,
    requireLinkedWorktree: true,
    allowMainWorktree,
  });

  return {
    success: result.success,
    requireLinkedWorktree: true,
    allowMainWorktree,
    worktree: result.worktree,
    error: result.error,
    hint: result.hint,
    code: result.code,
  };
}

export function attachCliSessionWorktreePolicy(
  body: Record<string, unknown>,
  policy: CliSessionWorktreePolicy,
): void {
  if (policy.worktree) body.worktree = policy.worktree;
  if (policy.requireLinkedWorktree) body.requireLinkedWorktree = true;
  if (policy.allowMainWorktree) body.allowMainWorktree = true;
  body.metadata = mergeSessionWorktreeMetadata(
    body.metadata as Record<string, unknown> | null | undefined,
    policy.worktree,
    {
      requireLinkedWorktree: policy.requireLinkedWorktree,
      allowMainWorktree: policy.allowMainWorktree,
    },
  );
}
