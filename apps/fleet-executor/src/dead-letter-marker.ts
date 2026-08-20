/**
 * The sentinel that tells a dead-lettered gate apart from a decided one.
 *
 * Lives in its own dependency-free module because both ends of the contract
 * need it: `dlq.ts` (via `delivery-failure.ts`) stamps it when it fails a lost
 * run's check, and `execute.ts` reads it when deciding whether a completed
 * check is terminal. Putting it in either of those would make them import each
 * other in a cycle.
 *
 * WHY IT HAS TO EXIST. `execute.ts` treats a completed `success`/`failure`
 * check as a full stop — correct, because ships cannot change a finished gate
 * and re-running them is pure spend. But the DLQ handler ALSO completes as
 * `failure`, and a dead-lettered run reached no verdict at all: no ship ran,
 * nothing was reviewed. Counting that as "decided" makes the head SHA
 * permanently unreviewable — a redelivery, a reopen, a re-request all return
 * before even creating a check run, so no retry can ever produce a real
 * verdict and the only escape is a brand-new commit.
 *
 * Observed 2026-08-19 on PRs #7278, #7339 and #7344: each had one run lost to
 * a dead-letter, and every subsequent `reopened` delivery no-opped against
 * this guard. Full GitHub Actions CI re-ran on all three; the fleet check did
 * not reappear at all, because `executeFleet` returned at the guard 27 minutes
 * running. Three code-complete PRs were stranded by their own gate.
 *
 * An HTML comment rather than a prose match: the summary is human-facing text
 * that gets reworded, and a gate that unstrands PRs must not hinge on prose
 * surviving an edit. It renders invisibly in GitHub's checks UI.
 */

/** Machine-readable stamp on a check completed by the DLQ handler. */
export const DEAD_LETTER_MARKER = '<!-- pd-fleet:dead-lettered -->';

/**
 * Was this completed check failed by the DLQ handler rather than by ships?
 *
 * A dead-lettered failure is a real red gate — fail-closed is preserved — but
 * it is NOT a verdict, so a later delivery is allowed to run for real.
 */
export function isDeadLetteredSummary(summary: string | null | undefined): boolean {
  return typeof summary === 'string' && summary.includes(DEAD_LETTER_MARKER);
}
