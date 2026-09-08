/**
 * The Steward's priority function — pure, deterministic, printed in every
 * deck-log entry (THE_FULL_WHEEL.md §1: "a published, deterministic priority
 * function — never vibes").
 *
 * DESIGN INTENT: the seat handles ONE PR at a time, so *which* PR is a
 * governance decision, and governance decisions must be auditable. This module
 * is therefore a pure function from PR snapshots to an ordered docket with a
 * per-PR rationale string — no I/O, no clock reads beyond the injected `now`,
 * no randomness. The tick prints the docket verbatim into the deck log, so an
 * operator reading "why did it pick #12 over #9" finds the answer already
 * written down, in tier language, not model prose.
 */

/** One open PR as the survey adapter snapshots it (see survey.ts). */
export interface PrSnapshot {
  /** PR number. */
  number: number;
  /** PR title, for legible deck-log rationale lines. */
  title: string;
  /** True when the PR is a draft — drafts are never docketed. */
  draft: boolean;
  /** Combined state of the REQUIRED checks on the head. */
  checks: 'green' | 'red' | 'pending';
  /** True when at least one approving review stands and none requests changes. */
  approved: boolean;
  /** True when a human review explicitly requests changes. */
  changesRequested: boolean;
  /** True when the operator asked for this PR directly (label or explicit request). */
  operatorRequested: boolean;
  /** True when the fleet/agents authored or drive this PR. */
  fleetOwned: boolean;
  /** GitHub's mergeable read: false = conflict, null = still computing. */
  mergeable: boolean | null;
  /** Epoch ms of the last update — drives the staleness tier. */
  updatedAt: number;
}

/** The five tiers, in authority order. Lower number = handled first. */
export type PriorityTier = 1 | 2 | 3 | 4 | 5;

/** One docket row: a PR, its tier, and the human-readable why. */
export interface DocketEntry {
  pr: PrSnapshot;
  tier: PriorityTier;
  /** One line an operator can read cold, e.g. "tier 2: approved + green — one action from merge". */
  rationale: string;
}

/**
 * Classify one PR into its tier.
 *
 * WHY THESE TIERS, IN THIS ORDER (§1 of the plan, verbatim policy):
 *  1. operator direct requests — the human outranks every heuristic;
 *  2. approved + green — one action from merge; the standing order "review IS
 *     the gate" makes leaving these unlanded the worst kind of idle;
 *  3. red required checks on fleet-owned PRs — the fleet cleans up after
 *     itself before it asks anything of humans;
 *  4. review-complete PRs needing a verdict;
 *  5. everything else by staleness, oldest first.
 *
 * @param pr - The snapshot to classify.
 * @returns The tier and its rationale line.
 */
export function classifyPr(pr: PrSnapshot): { tier: PriorityTier; rationale: string } {
  if (pr.operatorRequested) {
    return { tier: 1, rationale: 'tier 1: operator direct request' };
  }
  if (pr.approved && pr.checks === 'green' && pr.mergeable === true) {
    return { tier: 2, rationale: 'tier 2: approved + green + mergeable — one action from merge' };
  }
  if (pr.fleetOwned && pr.checks === 'red') {
    return { tier: 3, rationale: 'tier 3: red required checks on a fleet-owned PR' };
  }
  if ((pr.approved || pr.changesRequested) && pr.checks !== 'pending') {
    return { tier: 4, rationale: 'tier 4: review complete — needs a verdict' };
  }
  return { tier: 5, rationale: 'tier 5: staleness queue' };
}

/**
 * Build the full docket: classify, order, and explain every open PR.
 *
 * ORDERING RATIONALE: tier ascending, then oldest-updated first within a tier
 * — staleness is the universal tiebreak because "the PR nobody has touched
 * longest" is both the fairest and the most reproducible ordering; PR number
 * breaks exact-timestamp ties so the sort is total and the docket is stable
 * across runs on identical input. Drafts are excluded before classification:
 * a draft is its author's declaration that no verdict is wanted yet.
 *
 * @param prs - Snapshots of the open PRs.
 * @returns The ordered docket, first entry = the PR the tick handles.
 */
export function buildDocket(prs: PrSnapshot[]): DocketEntry[] {
  return prs
    .filter(pr => !pr.draft)
    .map(pr => ({ pr, ...classifyPr(pr) }))
    .sort(
      (a, b) =>
        a.tier - b.tier || a.pr.updatedAt - b.pr.updatedAt || a.pr.number - b.pr.number,
    );
}

/**
 * Render the docket as the deck-log audit block.
 *
 * PURPOSE: §1 promises "the scoring is … printed in every deck-log entry so
 * you can audit why it chose what it chose". This is that printout — compact,
 * one line per PR, exact tier language.
 *
 * @param docket - The ordered docket from {@link buildDocket}.
 * @returns One line per PR, or a single honest line for an empty docket.
 */
export function renderDocket(docket: DocketEntry[]): string {
  if (docket.length === 0) return 'docket empty: no open non-draft PRs';
  return docket
    .map((d, i) => `${i === 0 ? '→' : ' '} #${d.pr.number} ${d.rationale}`)
    .join('\n');
}
