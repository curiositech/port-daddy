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
  /**
   * True when allowMainWorktree was triggered by the env var
   * (PORT_DADDY_ALLOW_MAIN_WORKTREE_SESSION), not by the explicit
   * --allow-main-worktree CLI flag. The daemon uses this to skip the
   * crowded-main-worktree collision check for CI / single-user setups
   * while still enforcing it against interactive opt-in.
   */
  bypassCrowdedGate: boolean;
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
  const flagAllow = optionEnabled(options['allow-main-worktree']);
  const envAllow = envAllowsMainWorktree();
  const allowMainWorktree = flagAllow || envAllow;
  // Env-only allow = long-standing config (CI / single-user) — bypass
  // the crowded-main collision gate. Explicit --allow-main-worktree from
  // a human interactively still gets the gate.
  const bypassCrowdedGate = envAllow && !flagAllow;
  const info = getWorktreeInfo(cwd);

  if (!info) {
    return {
      success: true,
      requireLinkedWorktree: false,
      allowMainWorktree,
      bypassCrowdedGate,
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
    bypassCrowdedGate,
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
  if (policy.bypassCrowdedGate) body.bypassCrowdedGate = true;
  body.metadata = mergeSessionWorktreeMetadata(
    body.metadata as Record<string, unknown> | null | undefined,
    policy.worktree,
    {
      requireLinkedWorktree: policy.requireLinkedWorktree,
      allowMainWorktree: policy.allowMainWorktree,
    },
  );
}
