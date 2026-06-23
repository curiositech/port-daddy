/**
 * Harbor Pilot — pure decision logic for repo-wide PR custody.
 *
 * **Harbor pilot** (maritime): the local expert who boards any inbound vessel
 * and guides it to berth. This module decides, for every open PR, which of
 * four actions the pilot takes. It is deliberately separate from
 * `lib/harbormaster.ts` at the repo root (ADR-0037), which owns merges of
 * *dispatched agent work* only and never touches operator-authored PRs. The
 * pilot covers the rest of the harbor: every open PR, regardless of author.
 *
 * Division of labor:
 *   - GitHub's merge queue (native) owns mechanical correctness: a PR merges
 *     only after required checks pass on latest-main-plus-the-PR. No stale
 *     merge is possible once the queue is active.
 *   - The pilot owns the judgment calls the queue cannot make:
 *       1. ARM        — non-draft PRs get merge-when-ready enabled so they
 *                       enter the queue the moment checks go green.
 *       2. SUPERSEDED — a PR whose entire diff already exists on main (its
 *                       content landed via other PRs) is DEMOTED to draft
 *                       with an explanatory comment. Never closed — demotion
 *                       is reversible, deletion is an operator decision.
 *                       This is the failure mode no GitHub setting catches
 *                       (the #353 incident: semantically-redundant PR landed
 *                       by a merge bot and regressed retired work).
 *       3. CONFLICT   — conflicted PRs get flagged once (idempotent) so they
 *                       do not silently rot while armed.
 *       4. LEAVE      — drafts are the gate; armed-and-current PRs need
 *                       nothing.
 *
 * This module is pure: no network, no octokit, no env. The runner
 * (`bin/harbor-pilot.ts`) gathers `PRSnapshot`s and executes the returned
 * actions. That split keeps every rule unit-testable.
 */

import type { ShipMeta } from './post-as.js'

export const HARBOR_PILOT_SHIP: ShipMeta = {
  handle: 'harbor-pilot',
  role: 'guides every open PR to berth; demotes ghosts, flags fouled anchors',
  mark: '◯',
}

/** Label the pilot applies when it demotes a superseded PR. */
export const SUPERSEDED_LABEL = 'pd-superseded'

/** Marker embedded in pilot comments so re-runs edit in place, never stack. */
export const PILOT_COMMENT_MARKER = '<!-- pd-harbor-pilot -->'

/**
 * Per-file parity between the PR head and the base branch head, computed by
 * the runner from git blob SHAs (equal blob SHA = byte-identical content;
 * a file the PR deletes counts as identical when it is absent on base).
 */
export interface FileParity {
  /** Number of files the PR changes (from the PR's file list). */
  total: number
  /** Of those, how many are already byte-identical on the base branch head. */
  identical: number
}

export interface PRSnapshot {
  number: number
  title: string
  isDraft: boolean
  /** REST `mergeable_state`: clean | dirty | blocked | behind | unstable | draft | unknown. */
  mergeableState: string
  autoMergeEnabled: boolean
  labels: string[]
  /**
   * Null when the runner could not compute parity (file list truncated,
   * binary-only diff probe failed, API error). Null parity NEVER produces a
   * demotion — uncertainty always degrades toward "leave it alone".
   */
  fileParity: FileParity | null
}

export type PilotAction =
  | { kind: 'leave'; reason: string }
  | { kind: 'arm'; reason: string }
  | { kind: 'flag-conflict'; reason: string }
  | { kind: 'demote-superseded'; reason: string }

export function decide(pr: PRSnapshot): PilotAction {
  if (pr.isDraft) {
    return { kind: 'leave', reason: 'draft is the gate; pilot never arms or judges drafts' }
  }

  // Supersession outranks everything else: an armed, superseded PR is the
  // most dangerous object in the harbor (it merges a semantic no-op at best,
  // a regression of follow-up work at worst). Exception: a PR carrying the
  // superseded label that is nonetheless non-draft was re-readied by the
  // operator after a demotion — that is an explicit human override, and the
  // pilot never re-demotes over it.
  if (
    !pr.labels.includes(SUPERSEDED_LABEL) &&
    pr.fileParity !== null &&
    pr.fileParity.total > 0 &&
    pr.fileParity.identical === pr.fileParity.total
  ) {
    return {
      kind: 'demote-superseded',
      reason: `all ${pr.fileParity.total} changed file(s) already byte-identical on base — content landed elsewhere`,
    }
  }

  if (pr.mergeableState === 'dirty') {
    return { kind: 'flag-conflict', reason: 'merge conflict with base; cannot enter the queue until resolved' }
  }

  if (!pr.autoMergeEnabled) {
    return { kind: 'arm', reason: 'non-draft and unarmed; enable merge-when-ready' }
  }

  return { kind: 'leave', reason: 'armed and unobstructed' }
}

export interface PilotResult {
  number: number
  title: string
  action: PilotAction
  /** Whether the runner actually executed (false in dry-run or on execution error). */
  executed: boolean
  error?: string
}

/** Render the end-of-run digest (stdout + `pd note` payload). */
export function renderDigest(repo: string, results: PilotResult[], dryRun: boolean): string {
  const byKind = (k: PilotAction['kind']) => results.filter((r) => r.action.kind === k)
  const lines: string[] = []
  lines.push(
    `harbor-pilot ${dryRun ? '(dry-run) ' : ''}swept ${results.length} open PR(s) in ${repo}: ` +
      `${byKind('arm').length} armed, ${byKind('demote-superseded').length} demoted as superseded, ` +
      `${byKind('flag-conflict').length} conflict-flagged, ${byKind('leave').length} left alone.`,
  )
  for (const r of results) {
    if (r.action.kind === 'leave') continue
    const status = dryRun ? 'would' : r.executed ? 'did' : `FAILED (${r.error ?? 'unknown'})`
    lines.push(`  #${r.number} ${r.action.kind}: ${status} — ${r.action.reason} [${r.title}]`)
  }
  return lines.join('\n')
}

/** Body of the comment posted when a PR is demoted as superseded. */
export function supersededComment(parity: FileParity): string {
  return [
    PILOT_COMMENT_MARKER,
    `Every file this PR changes (${parity.identical}/${parity.total}) is already byte-identical on the base branch — this PR's content has landed through other PRs.`,
    '',
    'Converted to **draft** so it cannot auto-merge as a semantic no-op (or worse, regress follow-up work — see the #353 incident). Nothing was closed or deleted: if this PR still carries intent the diff does not show, mark it ready for review again and the pilot will not demote it twice while the label is present.',
  ].join('\n')
}

/** Body of the comment posted when a PR is conflict-flagged. */
export function conflictComment(): string {
  return [
    PILOT_COMMENT_MARKER,
    'This PR conflicts with its base branch, so it cannot enter the merge queue. It will sit here indefinitely until the conflict is resolved — rebase or merge the base in.',
  ].join('\n')
}
