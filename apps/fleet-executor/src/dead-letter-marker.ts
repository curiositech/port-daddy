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

/**
 * The sentence the DLQ handler wrote BEFORE the marker existed.
 *
 * The marker is the right mechanism and prose matching is normally the wrong
 * one — a human-facing summary gets reworded, and a gate that unstrands PRs
 * must not hinge on a sentence surviving an edit. This one exception is safe
 * because it matches only the PAST: checks completed before the marker
 * deployed on 2026-08-19. That text is frozen — it is already written into
 * check runs on GitHub and cannot be re-worded retroactively.
 *
 * WHY IT IS NEEDED AT ALL, which I got wrong the first time. The marker is
 * written going forward, so it recognises dead-letters created after deploy —
 * and every PR that was actually stranded had been stranded BEFORE it. #7278,
 * #7339 and #7344 each carried a completed `failure` with the bare sentence
 * and no marker, so the guard in execute.ts still read them as decided and
 * returned before creating a check run. A reopen produced full GitHub CI and
 * no fleet check, exactly as it had under the old executor. A forward-only
 * sentinel with no backfill path rescued none of the PRs it was written for.
 *
 * Matching a fragment rather than the whole sentence: the summary now carries
 * the recorded cause appended after it, so the full string is no longer an
 * equality test.
 */
const LEGACY_DEAD_LETTER_PHRASE = 'was lost (job exhausted retries / dead-lettered)';

/** Machine-readable stamp on a check completed by the DLQ handler. */
export const DEAD_LETTER_MARKER = '<!-- pd-fleet:dead-lettered -->';

/**
 * Was this completed check failed by the DLQ handler rather than by ships?
 *
 * A dead-lettered failure is a real red gate — fail-closed is preserved — but
 * it is NOT a verdict, so a later delivery is allowed to run for real.
 */
export function isDeadLetteredSummary(summary: string | null | undefined): boolean {
  if (typeof summary !== 'string') return false;
  return summary.includes(DEAD_LETTER_MARKER) || summary.includes(LEGACY_DEAD_LETTER_PHRASE);
}
