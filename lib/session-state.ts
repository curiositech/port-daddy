/**
 * Session status — the full state machine for "what is each worktree, and should
 * I care about it right now?"
 *
 * Designed with the operator (2026-06-05). The mental model is a FRIDGE:
 *
 *   - While you're away, every session RESTS in the fridge, indefinitely, fine.
 *     Age in the fridge is NOT decay — a 3-week worktree is as healthy as a
 *     3-hour one. Nothing cools, because you're not there to neglect it.
 *   - The clock starts when you come back and WARM one up. Warming any session
 *     in a harbor opens an *engagement window* over that harbor's cohort — and
 *     starts the pass-over clock on the SIBLINGS you're not touching. Those are
 *     being actively passed over while you're demonstrably right there.
 *   - Wander off again (harbor goes quiet) → the window closes → everyone drops
 *     back to RESTING. Staleness only accrues while you're present and working.
 *
 * State is a STRUCT of independent axes (not one flattened enum) so no fact is
 * lost; the UI derives a single chip from it, worst-actionable-first.
 *
 * Axes:
 *   - lifecycle  : git truth (discriminated union)
 *   - attention  : cohort-relative heat (only meaningful while a window is open)
 *   - health     : git-computed flags, stackable
 *   - breadcrumb : the clear, summarized "what you were doing last time"
 *
 * Cohort = per harbor/project. Timers: engagement window 45m, pass-over 2h.
 */

// ── Tunables (operator-locked 2026-06-05) ───────────────────────────────────
/** Harbor-wide silence after which the engagement window closes (you wandered off). */
export const HARBOR_ENGAGEMENT_WINDOW_MS = 45 * 60 * 1000;
/** While a window is open, how long a sibling may be passed over before it's flagged cooling. */
export const HARBOR_PASS_OVER_MS = 2 * 60 * 60 * 1000;

// ── Axis 1: lifecycle (git truth) ───────────────────────────────────────────
export type Lifecycle = 'nascent' | 'open' | 'landed' | 'archived';

export interface LifecycleInputs {
  hasCommits: boolean;       // any work on the branch yet?
  worktreeExists: boolean;   // dir still on disk?
  branchMerged: boolean;     // merged into the canonical base?
  operatorClosed: boolean;   // operator ran `pd done`
}

/** PURE. Lifecycle is the durable spine — judged by the repo, never a clock. */
export function classifyLifecycle(i: LifecycleInputs): Lifecycle {
  if (!i.worktreeExists) return 'archived';
  if (i.branchMerged || i.operatorClosed) return 'landed';
  if (!i.hasCommits) return 'nascent';
  return 'open';
}

// ── Axis 2: attention (cohort-relative heat) ────────────────────────────────
export type Attention = 'resting' | 'engaged' | 'passed_over' | 'cooling';

export interface AttentionInputs {
  /** When THIS session was last touched (begin/commit/note), ms-epoch. */
  memberLastTouchedMs: number | null;
  /** Most recent activity across the WHOLE harbor cohort, ms-epoch. */
  harborLastActivityMs: number | null;
  nowMs: number;
  windowMs?: number;    // engagement-window idle (default 45m)
  passOverMs?: number;  // pass-over grace (default 2h)
}

/**
 * PURE. Cohort-relative heat. `resting` whenever the harbor's engagement window
 * is closed (you're away) — that's the safe, indefinite default. While the
 * window is open: a freshly-touched member is `engaged`; one you're skipping is
 * `passed_over`, then `cooling` once it's been passed over past the grace.
 */
export function classifyAttention(i: AttentionInputs): Attention {
  const windowMs = i.windowMs ?? HARBOR_ENGAGEMENT_WINDOW_MS;
  const passOverMs = i.passOverMs ?? HARBOR_PASS_OVER_MS;

  // No harbor activity at all, or it's gone quiet → window closed → fridge.
  if (i.harborLastActivityMs == null) return 'resting';
  if (i.nowMs - i.harborLastActivityMs > windowMs) return 'resting';

  // Window is OPEN. How long since YOU touched this particular member?
  const memberIdle = i.memberLastTouchedMs == null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, i.nowMs - i.memberLastTouchedMs);

  if (memberIdle <= windowMs) return 'engaged';      // you're on it right now
  if (memberIdle <= passOverMs) return 'passed_over'; // skipping it, still in grace
  return 'cooling';                                   // passed over too long — nudge
}

// ── Axis 3: health (git-computed flags, stackable) ──────────────────────────
export interface Health {
  behind: boolean;          // base moved ahead; clean rebase available
  conflicted: boolean;      // rebase/merge would conflict — cannot land as-is
  duplicative: string[];    // sibling worktrees touching overlapping files
}

export const CLEAN_HEALTH: Health = { behind: false, conflicted: false, duplicative: [] };

// ── Axis 4: breadcrumb (what you were doing last time) ──────────────────────
export interface Breadcrumb {
  /** One clear, summarized line: where you left off + the next move. */
  summary: string;
  updatedAt: number;
  source: 'note' | 'auto-summary' | 'commit';
}

/**
 * PURE. Pick the clearest breadcrumb from candidate session notes/summaries,
 * most-recent-informative-first. Deliberately NOT keyword NLP — it ranks by
 * the structured note prefixes Port Daddy already writes (`Result:`, `Scope:`,
 * `next:`) and recency. Richer summarization (a single Haiku call over the
 * recent notes) layers on top and feeds this the same shape.
 */
export function pickBreadcrumb(candidates: Breadcrumb[]): Breadcrumb | null {
  if (!candidates.length) return null;
  const rank = (b: Breadcrumb): number => {
    const s = b.summary.trimStart();
    if (/^result:/i.test(s)) return 3;   // an outcome + remaining is the best handoff
    if (/^next:/i.test(s)) return 2;     // an explicit next move
    if (/^scope:/i.test(s)) return 1;    // at least states what was being touched
    return 0;
  };
  return [...candidates].sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt)[0];
}

// ── The state struct + surfaced chip ────────────────────────────────────────
export interface SessionState {
  lifecycle: Lifecycle;
  attention: Attention;
  health: Health;
  breadcrumb: Breadcrumb | null;
  lastTouchedMs: number | null;
}

/** The single chip the UI shows. Worst-ACTIONABLE first, so one glance = the next move. */
export type SurfacedStatus =
  | 'archived' | 'landed'
  | 'conflicted' | 'duplicative'
  | 'cooling' | 'engaged' | 'passed_over'
  | 'behind' | 'resting' | 'nascent';

/** PURE. Flatten the struct to one chip without losing the struct itself. */
export function surfacedStatus(s: SessionState): SurfacedStatus {
  if (s.lifecycle === 'archived') return 'archived';
  if (s.lifecycle === 'landed') return 'landed';
  if (s.health.conflicted) return 'conflicted';       // can't land — top priority
  if (s.health.duplicative.length > 0) return 'duplicative';
  if (s.attention === 'cooling') return 'cooling';    // about to re-shelve — act now
  if (s.lifecycle === 'nascent' && s.attention === 'resting') return 'nascent';
  if (s.attention === 'engaged') return 'engaged';
  if (s.attention === 'passed_over') return 'passed_over';
  if (s.health.behind) return 'behind';
  return 'resting';
}
