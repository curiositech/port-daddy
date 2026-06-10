/**
 * The compulsion — coordination is the price of the sandbox (ADR-0050).
 *
 * The Coast Guard hands every voyage a sandboxed worktree. This module decides
 * whether the voyage is still paying *coordination rent* for it. It is the
 * mechanism-design keystone of the unified model: agents coordinate not out of
 * politeness but because the alternative is losing the live sandbox. The
 * Nash-equilibrium behavior becomes "communicate."
 *
 * Rent has three components, each a checkable fact:
 *   1. commit ⇒ note publish   — every commit must be matched by a coordination
 *                                note. You may not make a NEW commit while you
 *                                still owe a note for a PRIOR one. ("No note, no
 *                                commit" — the load-bearing rule.)
 *   2. stay rebased            — drift too far behind the live base AND go quiet
 *                                and the lease is stale → eligible for reclaim.
 *   3. feed suggestibility     — leave the inputs the cartographer needs (notes,
 *                                claims). A lease with zero signal past the grace
 *                                window is idle → eligible for reclaim.
 *
 * This file is PURE. It computes a verdict from facts; it never shells out,
 * never tears down a worktree, never touches git. Gathering the facts (git +
 * daemon) and acting on the verdict live in the caller. Critically, reclaim
 * applies ONLY to Coast-Guard-issued sandboxes — never the operator's live
 * main checkout (see `isReclaimableSandbox`).
 */

/** Where the lease stands on its rent. */
export type RentVerdict =
  | 'paid' // rent current — keep working
  | 'rent-due' // committed without publishing a note — owes coordination
  | 'stale' // drifted behind base and went quiet — should rebase or be reclaimed
  | 'idle'; // working in the dark — no notes, no claims — hoarding the sandbox

/** What the caller should do about the verdict. */
export type LeaseAction =
  | 'allow' // proceed
  | 'block-commit' // refuse the next commit until rent is paid (a note is published)
  | 'reclaim'; // the lease has lapsed; the sandbox is eligible for reclamation

/**
 * The facts a lease is judged on. All counts are non-negative integers; all
 * ages are milliseconds. The caller gathers these from git history + the daemon.
 */
export interface LeaseFacts {
  /** Commits on the lease branch that have NO coordination note published after
   *  them. > 0 means the voyage owes rent. */
  commitsSinceLastNote: number;
  /** Total commits made on the lease (ahead of base). */
  commitsTotal: number;
  /** Coordination notes the session has published. */
  notesTotal: number;
  /** File/region claims the session holds. */
  claimsTotal: number;
  /** How many commits the lease is behind its live base (origin/main or parent). */
  commitsBehindBase: number;
  /** Lease age. */
  ageMs: number;
  /** Time since the last coordination signal of any kind (note, claim, or commit). */
  lastSignalAgeMs: number;
}

/** Tunable thresholds. Defaults are deliberately lenient — rent should bite the
 *  hoarder, not the operator who walked away mid-thought (cold ≠ dead). */
export interface RentPolicy {
  /** Beyond this many commits behind base, a quiet lease is stale. */
  maxCommitsBehind: number;
  /** A lease with zero notes AND zero claims older than this is idle. */
  idleGraceMs: number;
  /** A lease must be silent at least this long before drift alone reclaims it. */
  staleSignalMs: number;
}

export const DEFAULT_RENT_POLICY: RentPolicy = {
  maxCommitsBehind: 20,
  // 30 min of total silence with no coordination signal at all → idle. Short
  // enough to reclaim an abandoned dark lease; long enough that a thinking
  // operator keeps their tree.
  idleGraceMs: 30 * 60 * 1000,
  // 2 h of silence on top of drift before drift reclaims. Matches the
  // session-state pass-over window — a cohort sibling cooling, not a corpse.
  staleSignalMs: 2 * 60 * 60 * 1000,
};

export interface RentEvaluation {
  verdict: RentVerdict;
  action: LeaseAction;
  /** Operator/agent-facing reason. Points only at the corrective action — never
   *  names a bypass (guardrails-never-advertise-bypass). */
  reason: string;
  /** How much rent is owed right now. */
  rentDue: { commitsWithoutNote: number };
}

/**
 * Evaluate a lease against its rent policy. Pure. Priority order matters:
 * owing a note (the active, blocking debt) outranks drift/idle (passive,
 * reclaim-eligible states).
 */
export function evaluateLeaseRent(
  facts: LeaseFacts,
  policy: RentPolicy = DEFAULT_RENT_POLICY,
): RentEvaluation {
  const commitsWithoutNote = Math.max(0, facts.commitsSinceLastNote);
  const rentDue = { commitsWithoutNote };

  // 1. Commit ⇒ note publish. The load-bearing rule. If you committed and have
  //    not published the note for it, you may not commit again until you do.
  if (commitsWithoutNote > 0) {
    return {
      verdict: 'rent-due',
      action: 'block-commit',
      reason:
        `${commitsWithoutNote} commit(s) on this sandbox have no coordination note. ` +
        `Publish a note describing the change (pd note "...") before the next commit — ` +
        `every commit pays its coordination rent.`,
      rentDue,
    };
  }

  // 2. Feed suggestibility. A lease that has produced zero notes and holds zero
  //    claims past the grace window is working in the dark — hoarding a live
  //    sandbox while giving the fleet nothing. Reclaim-eligible.
  const noSignalEver = facts.notesTotal === 0 && facts.claimsTotal === 0;
  if (noSignalEver && facts.ageMs > policy.idleGraceMs) {
    return {
      verdict: 'idle',
      action: 'reclaim',
      reason:
        `This sandbox has run ${Math.round(facts.ageMs / 60000)}m with no notes and no claims. ` +
        `Leave the inputs the fleet needs (a scope note, a file claim) to keep it.`,
      rentDue,
    };
  }

  // 3. Stay rebased. Drift alone does not reclaim — drift PLUS prolonged silence
  //    does. A busy, coordinating lease that happens to be behind is fine; a
  //    quiet one that has fallen far behind is abandoned.
  if (
    facts.commitsBehindBase > policy.maxCommitsBehind &&
    facts.lastSignalAgeMs > policy.staleSignalMs
  ) {
    return {
      verdict: 'stale',
      action: 'reclaim',
      reason:
        `This sandbox is ${facts.commitsBehindBase} commits behind the live base and has been ` +
        `silent for ${Math.round(facts.lastSignalAgeMs / 60000)}m. Rebase and check in to keep it.`,
      rentDue,
    };
  }

  return { verdict: 'paid', action: 'allow', reason: 'Coordination rent is current.', rentDue };
}

/**
 * The reclaim safety gate. Reclaim may NEVER touch the operator's live main
 * checkout — that tree carries uncommitted, untracked, shared work and is sacred
 * (never-destructive-git-on-the-main-checkout). A lease is reclaimable ONLY when
 * it is a Coast-Guard-issued disposable sandbox: a worktree path strictly under
 * the scratch root that is not the main worktree. The gate is path-based by
 * design (a sandbox can be on any branch); `branch` is carried for the caller's
 * logging/auditing, not consulted by the gate.
 */
export interface SandboxIdentity {
  /** Absolute worktree path. */
  worktreePath: string;
  /** True iff this is the repository's primary (main) worktree. */
  isMainWorktree: boolean;
  /** The branch the sandbox is on. Informational (logging/audit) — the reclaim
   *  gate is path-based and does not consult this. */
  branch: string;
}

export interface ReclaimGate {
  /** Disposable scratch root sandboxes must live under (e.g. ~/coding/tmp). */
  scratchRoot: string;
}

export function isReclaimableSandbox(sandbox: SandboxIdentity, gate: ReclaimGate): boolean {
  if (sandbox.isMainWorktree) return false; // the live tree is never reclaimable
  if (!gate.scratchRoot) return false;
  const path = sandbox.worktreePath.replace(/\/+$/, '');
  const root = gate.scratchRoot.replace(/\/+$/, '');
  // Must be strictly *inside* the scratch root, not the root itself.
  return path.startsWith(root + '/');
}

/**
 * Convenience: a lease is safe to actually reclaim only when BOTH the rent
 * verdict says reclaim AND the sandbox passes the safety gate. Verdict alone is
 * advisory; this conjunction is the only thing a reaper may act on destructively.
 */
export function shouldReclaim(
  evaluation: RentEvaluation,
  sandbox: SandboxIdentity,
  gate: ReclaimGate,
): boolean {
  return evaluation.action === 'reclaim' && isReclaimableSandbox(sandbox, gate);
}
