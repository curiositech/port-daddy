/**
 * Session liveness — a session is a DURABLE WORK CONTEXT, not a process lifetime.
 *
 * Closing your laptop (or 12 Claude Codes) must NOT kill your work. A session
 * with no live process is DORMANT — parked, intact, waiting to be picked back
 * up — not dead. The only thing that makes a session DONE is the operator
 * finishing it, or the WORK ITSELF being gone (worktree removed / branch merged
 * into the canonical base). Idle time on the clock is irrelevant; `.gitignored`
 * churn is irrelevant. This is what lets `pd begin` re-attach two-day-old work.
 *
 * Modeled as a discriminated-union state machine so the resume decision is a
 * pure, exhaustively-checked function (no daemon, no git needed to test it).
 */

/** Why a session is finished. `completed` = operator said so; the others = the work is gone. */
export type SessionDoneReason = 'completed' | 'worktree-removed' | 'branch-merged';

/** The durable lifecycle state of a work session. The OS process is a guest. */
export type SessionLiveness =
  | { state: 'active'; attachedAgentId: string | null; idleMs: number }
  | { state: 'dormant'; idleMs: number }
  | { state: 'done'; reason: SessionDoneReason };

export interface SessionLivenessInputs {
  /** The session row's status, e.g. 'active' | 'completed'. */
  status: string;
  /** Agent currently associated with the session (for the active warn message). */
  attachedAgentId?: string | null;
  /** Freshest heartbeat of the owning agent in ms-epoch; null if it never beat / is gone. */
  lastHeartbeatMs: number | null;
  nowMs: number;
  /** How recent a heartbeat counts as "a process is driving this RIGHT NOW". */
  liveTtlMs: number;
  /**
   * Ground truth about the work itself. `null` means "not checked" — then we
   * never reap on worktree grounds (dormancy is preserved, which is the safe,
   * work-preserving default).
   */
  worktree?: { exists: boolean; branchMerged: boolean } | null;
}

/** PURE. Classify a session against the WORK's reality, not a clock. Never throws. */
export function classifySessionLiveness(i: SessionLivenessInputs): SessionLiveness {
  // 1. Operator explicitly finished it.
  if (i.status === 'completed' || i.status === 'done') {
    return { state: 'done', reason: 'completed' };
  }
  // 2. The work itself is gone — this, not the clock, is what "dead" means.
  if (i.worktree) {
    if (!i.worktree.exists) return { state: 'done', reason: 'worktree-removed' };
    if (i.worktree.branchMerged) return { state: 'done', reason: 'branch-merged' };
  }
  // 3. A live process is driving it right now?
  const idleMs = i.lastHeartbeatMs == null ? Number.POSITIVE_INFINITY : Math.max(0, i.nowMs - i.lastHeartbeatMs);
  if (i.lastHeartbeatMs != null && idleMs <= i.liveTtlMs) {
    return { state: 'active', attachedAgentId: i.attachedAgentId ?? null, idleMs };
  }
  // 4. Otherwise: parked, intact, waiting. NOT dead — dormant.
  return { state: 'dormant', idleMs };
}

/** The decision `pd begin` makes when an existing session matches (identity, worktree). */
export type BeginResumeDecision =
  | { action: 'resume'; warn: 'driven-elsewhere' | null }
  | { action: 'create' };

function assertNever(x: never): never {
  throw new Error(`Unhandled session liveness state: ${JSON.stringify(x)}`);
}

/**
 * PURE. Given the matched session's liveness, decide whether `begin` resumes it
 * or starts fresh. Dormant → resume (the come-back path). Active → resume too,
 * but warn that another process is driving (worktree isolation is the hard
 * guard; we attach rather than lock the operator out). Done → create.
 */
export function decideBeginResume(liveness: SessionLiveness): BeginResumeDecision {
  switch (liveness.state) {
    case 'active':
      return { action: 'resume', warn: 'driven-elsewhere' };
    case 'dormant':
      return { action: 'resume', warn: null };
    case 'done':
      return { action: 'create' };
    default:
      return assertNever(liveness);
  }
}
