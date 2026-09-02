import { isAbsolute, resolve } from 'node:path';
import { getWorktreeInfo, type WorktreeInfo } from './worktree.js';

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
  code?: SessionWorktreePolicyCode;
  error?: string;
  hint?: string;
}

export type SessionWorktreePolicyCode =
  | 'WORKTREE_REQUIRED'
  | 'MAIN_WORKTREE_SESSION_FORBIDDEN'
  | 'WORKTREE_PROVENANCE_INVALID'
  | 'WORKTREE_CONTEXT_MISMATCH'
  | 'VALIDATION_ERROR';

export interface SessionWorktreeAdmissionInput extends SessionWorktreePolicyInput {
  metadata?: unknown;
}

export interface SessionWorktreeAdmissionResult extends SessionWorktreePolicyResult {
  /** Explicit null means "no caller worktree" and must not fall back to daemon cwd. */
  worktreeId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SessionWorktreeAdmissionDeps {
  /** Production re-probes the caller-named root; tests may inject a hermetic probe. */
  probeWorktree?: (root: string) => WorktreeInfo | null;
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

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sameAuthorityContext(a: SessionWorktreeContext, b: SessionWorktreeContext): boolean {
  return a.id === b.id
    && resolve(a.root) === resolve(b.root)
    && a.branch === b.branch
    && a.isMain === b.isMain;
}

function admissionFailure(
  code: SessionWorktreePolicyCode,
  error: string,
  worktree: SessionWorktreeContext | null = null,
): SessionWorktreeAdmissionResult {
  return { success: false, code, error, worktree, worktreeId: null, metadata: null };
}

/**
 * Resolve one daemon-trusted session/worktree admission fact.
 *
 * HTTP and IPC both call this boundary. A caller may name a worktree root, but
 * the daemon re-probes that root and derives the id/branch/main-worktree bit.
 * Conflicting metadata is rejected rather than silently creating a session
 * whose column and evidence name different worlds. When the caller has no Git
 * world, the explicit null result prevents sessions.start() from borrowing the
 * daemon process cwd (which may itself happen to be inside an unrelated repo).
 */
export function resolveSessionWorktreeAdmission(
  input: SessionWorktreeAdmissionInput,
  deps: SessionWorktreeAdmissionDeps = {},
): SessionWorktreeAdmissionResult {
  const metadata = input.metadata === undefined || input.metadata === null
    ? null
    : record(input.metadata);
  if (input.metadata !== undefined && input.metadata !== null && !metadata) {
    return admissionFailure('VALIDATION_ERROR', 'metadata must be a JSON object');
  }

  const requested = normalizeSessionWorktreeContext(input.worktree);
  if (input.worktree !== undefined && input.worktree !== null && !requested) {
    return admissionFailure('WORKTREE_PROVENANCE_INVALID', 'worktree context is incomplete or malformed');
  }

  let canonical: SessionWorktreeContext | null = null;
  if (requested) {
    if (!isAbsolute(requested.root) || resolve(requested.root) !== requested.root || requested.root.includes('\0')) {
      return admissionFailure('WORKTREE_PROVENANCE_INVALID', 'worktree root must be a canonical absolute path');
    }
    let live: WorktreeInfo | null = null;
    try {
      live = (deps.probeWorktree ?? getWorktreeInfo)(requested.root);
    } catch {
      live = null;
    }
    if (!live) {
      return admissionFailure('WORKTREE_PROVENANCE_INVALID', 'daemon could not verify the requested Git worktree');
    }
    canonical = toSessionWorktreeContext(live);
    if (!sameAuthorityContext(requested, canonical)) {
      return admissionFailure(
        'WORKTREE_CONTEXT_MISMATCH',
        'caller worktree id/root/branch/main status does not match the daemon probe',
        canonical,
      );
    }
  }

  const policy = evaluateSessionWorktreePolicy({
    worktree: canonical,
    requireLinkedWorktree: input.requireLinkedWorktree,
    allowMainWorktree: input.allowMainWorktree,
  });
  if (!policy.success) {
    return {
      ...policy,
      worktreeId: policy.worktree?.id ?? null,
      metadata: null,
    };
  }

  if (metadata && Object.prototype.hasOwnProperty.call(metadata, 'worktree')) {
    const metadataWorktree = normalizeSessionWorktreeContext(metadata.worktree);
    if (!metadataWorktree || !canonical || !sameAuthorityContext(metadataWorktree, canonical)) {
      return admissionFailure(
        'WORKTREE_CONTEXT_MISMATCH',
        'metadata.worktree does not match the daemon-verified session worktree',
        canonical,
      );
    }
  }

  if (metadata && Object.prototype.hasOwnProperty.call(metadata, 'sessionWorktreePolicy')) {
    const metadataPolicy = record(metadata.sessionWorktreePolicy);
    if (
      !metadataPolicy
      || metadataPolicy.requireLinkedWorktree !== (input.requireLinkedWorktree === true)
      || metadataPolicy.allowMainWorktree !== (input.allowMainWorktree === true)
    ) {
      return admissionFailure(
        'WORKTREE_CONTEXT_MISMATCH',
        'metadata.sessionWorktreePolicy does not match the admitted policy',
        canonical,
      );
    }
  }

  return {
    success: true,
    worktree: canonical,
    worktreeId: canonical?.id ?? null,
    metadata: mergeSessionWorktreeMetadata(metadata, canonical, {
      requireLinkedWorktree: input.requireLinkedWorktree,
      allowMainWorktree: input.allowMainWorktree,
    }),
  };
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
