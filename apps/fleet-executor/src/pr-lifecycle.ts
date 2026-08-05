/**
 * PR LIFECYCLE GATE — do not review a pull request that is already over.
 *
 * THE WASTE THIS EXISTS TO STOP. Observed live on 2026-08-05: `#5372` merged at
 * 06:25, and at 08:05 the purser opened `#5456` carrying five freshly-authored
 * adversarial test files for it. `#5451` did the same for `#5367`, merged at
 * 06:03. Those test PRs are structurally incapable of doing their job — the
 * purser's contract is that the reviewed PR merges THROUGH the tests, and a PR
 * already in the base branch cannot merge through anything. Each one cost two
 * model calls and left another PR open carrying `needs-roadmap-link`.
 *
 * WHY NEITHER EXISTING GUARD CATCHES IT. This is a third, orthogonal waste path:
 *
 *   - `classifyPrAuthorship` (src/fleet-identity.ts) skips PRs the FLEET wrote.
 *     `#5367` and `#5372` were human-authored, so it passes them through.
 *   - `decideRerun` (src/purser-rerun.ts) stops re-AUTHORING tests for the same
 *     PR across runs. It reasons about one PR's contract over time and has no
 *     concept of that PR ending.
 *
 * Neither one asks whether the PR is still open, because until now nothing did:
 * `PRContext` carried no lifecycle field at all.
 *
 * WHY A QUEUE CAN DELIVER A DEAD JOB AT ALL. The fleet is queue-driven. A job
 * enqueued while a PR was open can be delivered minutes or hours later — after
 * a retry, after a backlog drains, after an outage like the one that had the
 * executor dark for a day. The PR's state at ENQUEUE time is not its state at
 * EXECUTE time, and only the latter matters.
 *
 * FAIL-OPEN, DELIBERATELY. Every uncertain input resolves to "still open", which
 * means "review it". The failure modes are asymmetric: wrongly reviewing a
 * closed PR costs a few model calls, while wrongly skipping an open one silently
 * removes the review gate from a live PR and looks exactly like success. When
 * this module cannot tell, it spends the money.
 */

/** Why the fleet is declining to review — surfaced verbatim to the check run. */
export interface PrLifecycle {
  /** True only when the PR is provably finished and no ship should run. */
  over: boolean;
  /** Human-legible reason, shown in the neutral check-run summary. */
  reason: string;
  /** Coarse state for the transcript: 'open' | 'merged' | 'closed' | 'unknown'. */
  state: 'open' | 'merged' | 'closed' | 'unknown';
}

/**
 * Decide whether a PR is finished and therefore not worth reviewing.
 *
 * PURE — no I/O. The inputs come from the authoritative live PR fetch that
 * {@link fetchPRContext} already performs, so this gate adds no API call.
 *
 * `merged` is checked before `state` because GitHub reports a merged PR as
 * `state: 'closed'`, and "merged" is the more useful thing to say in a summary
 * than "closed".
 *
 * @param pr Lifecycle fields from the live PR.
 * @returns The verdict plus a reason a human can read and disagree with.
 */
export function classifyPrLifecycle(pr: { state?: string; merged?: boolean }): PrLifecycle {
  if (pr.merged === true) {
    return {
      over: true,
      state: 'merged',
      reason:
        'this pull request is already merged, so nothing can be stacked on it and no ' +
        'review of it can change what landed',
    };
  }

  const raw = typeof pr.state === 'string' ? pr.state.trim().toLowerCase() : '';
  if (raw === 'closed') {
    return {
      over: true,
      state: 'closed',
      reason: 'this pull request is closed, so a review of it has no addressee and no effect',
    };
  }
  if (raw === 'open') {
    return { over: false, state: 'open', reason: 'pull request is open' };
  }

  // Absent or unrecognised. Fail open — see the module header: the cost of
  // spending on a dead PR is money, the cost of skipping a live one is an
  // unreviewed merge that looks reviewed.
  return {
    over: false,
    state: 'unknown',
    reason: `pull request state was ${raw ? `unrecognised (${raw})` : 'absent'}; treating it as open`,
  };
}
