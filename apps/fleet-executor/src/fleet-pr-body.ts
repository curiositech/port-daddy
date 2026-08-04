/**
 * Fleet-authored PR body trailers — the deadlock fix.
 *
 * MOTIVATION (the bug this exists to kill). The purser opens a test PR on
 * `purser/pr-<n>-tests` and then RETARGETS the reviewed PR onto that branch.
 * The reviewed PR therefore merges THROUGH the test PR. But the repo's own PR
 * gates are written for HUMAN-authored PRs:
 *
 *   - `scripts/check-pr-requirements.mjs` demands a `## Summary` and a
 *     `## Test Plan` section (plus visual artifacts on visual surfaces),
 *   - `scripts/check-pr-comments-answered.mjs` labels a PR whose review
 *     threads the AUTHOR has not answered,
 *   - `lib/roadmap-link-core.ts` (via `scripts/check-roadmap-link.ts`) demands
 *     a `Roadmap-Item:` trailer and is a REQUIRED, fail-closed check.
 *
 * A machine-generated test-branch body satisfies none of them, so every purser
 * test PR came out `blocked` with `needs-roadmap-link` + `needs-comment-replies`
 * — and because the reviewed PR was stacked on top of it, the reviewed PR could
 * never merge either. The purser manufactured a deadlock for every PR it
 * reviewed (observed on #4792 → #4763).
 *
 * DESIGN. The escape hatches already existed; nothing here weakens a gate. Each
 * guard has an explicit, auditable, in-body marker, and each is emitted with a
 * SPECIFIC, HONEST reason rather than a blanket "bot" — a reason a human can
 * read and disagree with. The markers are emitted in exactly the syntax the
 * guards parse (see {@link REQUIREMENTS_EXEMPT_MARKER} for the strict form
 * `check-pr-requirements.mjs#hasMarker` requires); `tests/fleet-pr-body.test.ts`
 * runs the real guard scripts against a real generated body so the syntax can
 * never silently drift.
 *
 * PHILOSOPHY. An exemption is a claim, and a claim needs a reason. "bot" is not
 * a reason — it is a category. The reasons below say what is actually true about
 * a fleet-authored branch: nobody wrote prose to review, the human PR template's
 * sections describe work this branch did not do, and discussion belongs on the
 * PR being reviewed, not on the machine's test branch.
 */

/**
 * Repo-relative paths, one per line, that the fleet's own PR bodies must never
 * claim exemptions for. Not used here — kept adjacent as documentation of the
 * boundary — see `src/steward.ts#GUARDRAIL_PATTERNS`, which refuses to MERGE a
 * PR touching the gates. Exempting a body is cheap; merging a change to the
 * gate that granted the exemption is not, and that is a different guard.
 */
export const EXEMPTION_BOUNDARY_NOTE =
  'Exemptions cover the BODY contract only. Changes to the gates themselves are refused at merge time (see steward.ts GUARDRAIL_PATTERNS).';

/**
 * The requirements-gate exemption, in the strict form the guard parses.
 *
 * WHY THIS EXACT SHAPE: `check-pr-requirements.mjs#hasMarker` tests
 * `^<!--\s*pr-requirements-exempt\s*:\s*\S` against each HTML comment AFTER
 * trimming it. The directive must therefore BE the comment (not a mention
 * inside a larger comment) and must carry a non-empty reason — the original
 * bug was a loose substring match that let the PR template's own guidance
 * comment exempt every PR. One line, no nested `-->`.
 */
export const REQUIREMENTS_EXEMPT_MARKER =
  '<!-- pr-requirements-exempt: machine-generated body written to a fixed contract by the Port Daddy fleet; the human template\'s Test Plan and Visual Proof sections describe work a fleet-authored branch does not do (it adds test files or a stacked fix, and runs no UI). The obligations under test are stated in full below. -->';

/**
 * The review-comment gate's exemption, in the form
 * `check-pr-comments-answered.mjs#hasExempt` parses
 * (`/<!--\s*pr-comments-exempt\s*:\s*\S[\s\S]*?-->/i`, anywhere in the body).
 *
 * WHY: that gate asks "has the AUTHOR answered the reviewers?". No human
 * authored this PR, so there is no author to hold to that duty, and the
 * conversation that matters belongs on the PR under review. The fleet does not
 * get to ignore feedback because of this marker — `src/steward.ts` refuses to
 * merge over an unresolved dispute thread, which is a STRICTER rule than the
 * advisory label this marker suppresses.
 */
export const COMMENTS_EXEMPT_MARKER =
  '<!-- pr-comments-exempt: no human authored this PR, so the "author answers reviewers" duty has no addressee here; the reviewed PR is where discussion belongs. The fleet steward still refuses to merge this branch while any review thread on it is unresolved (apps/fleet-executor/src/steward.ts). -->';

/**
 * Build the `Roadmap-Item: none — <reason>` opt-out trailer.
 *
 * WHY AN OPT-OUT AND NOT A SLUG: the roadmap gate's purpose is "declare which
 * roadmap item this PR advances". A purser test branch or a stacked fix does
 * not advance a roadmap item — it is downstream machinery attached to whichever
 * item the REVIEWED PR advances. Claiming that PR's slug would double-count the
 * work and pollute the roadmap; inventing a slug would be a lie. `none` with a
 * specific reason is the honest declaration, and `lib/roadmap-link-core.ts`
 * accepts it as a `pass`.
 *
 * FORMAT: `parseRoadmapTrailer` matches `^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$` per
 * trimmed line, keys on `roadmap-item`, and treats the value as an opt-out when
 * its first token (split on whitespace/dashes) is `none`. The reason must
 * therefore be single-line and must not begin the line.
 *
 * @param reason Specific, human-readable justification. Newlines are collapsed
 *   because the trailer is parsed line-by-line and a wrapped reason would
 *   silently truncate.
 * @returns One line, e.g. `Roadmap-Item: none — adversarial tests for #12`.
 */
export function roadmapOptOutTrailer(reason: string): string {
  const oneLine = reason.replace(/\s+/g, ' ').trim() || 'fleet-authored branch';
  return `Roadmap-Item: none — ${oneLine}`;
}

/**
 * The complete trailer block every fleet-authored PR body ends with.
 *
 * DESIGN INTENT: one function, two call sites (the purser's test PR and the
 * ideation stack-proposal PR), so the two can never drift apart and a future
 * gate only has to be taught here. The markers come FIRST and the roadmap
 * trailer LAST because `parseRoadmapTrailer` takes the last matching trailer in
 * the body — putting it at the very end makes "the final word" unambiguous.
 *
 * @param roadmapReason Why this branch advances no roadmap item of its own.
 * @returns A newline-joined block to append to a PR body.
 */
export function fleetPrBodyTrailers(roadmapReason: string): string {
  return [
    REQUIREMENTS_EXEMPT_MARKER,
    COMMENTS_EXEMPT_MARKER,
    roadmapOptOutTrailer(roadmapReason),
  ].join('\n\n');
}
