/**
 * page-count-policy.ts — the one place that decides what a page count may do.
 *
 * THE POLICY, in the author's words:
 *
 *   "No page number tests, changes will happen. Make sure it's at least some
 *    floor, and have it break and tell if it changes a wild amount in a PR.
 *    That will force us to change the rest if it's intended or take a look if
 *    it's a bug."
 *
 * Three rules, not one.
 *
 * 1. NO EXACT PIN. `expect(pages).toBe(553)` is forbidden. Page counts move on
 *    every real change to the manuscript — a paragraph lands, a figure resizes,
 *    a float moves — and a pin turns routine work into a red build. Worse, it
 *    teaches whoever hits it to edit the number without looking at why it moved.
 *
 * 2. A FLOOR. The count must be at least some absolute minimum. This catches the
 *    catastrophic case and nothing else: a LaTeX run that died and rendered an
 *    error page, a truncated PDF, a placeholder committed over the real file, a
 *    build that emitted front matter only. See `floorPages` in
 *    page-count-policy.json for the numbers and the evidence behind them.
 *
 * 3. A WIDE DRIFT BAND, measured against a single recorded baseline. Inside the
 *    band: silence. Outside it: fail, and say which of the two things happened —
 *    an intended move whose baseline must be updated in the same pull request,
 *    or a build that is wrong and wants a human. The message is the deliverable
 *    as much as the assertion is. "expected 553, got 604" teaches nobody
 *    anything.
 *
 * The band is `max(driftBandPct, driftMinPages)` — a relative tolerance with an
 * absolute minimum, the same shape as the sizeKb tolerance in
 * check-whitepaper-metadata.ts, so that a 21-page chapter is not held to a
 * tighter absolute tolerance than a 553-page book. Page counts move roughly two
 * and a half times more than bytes do in relative terms, which is why the band
 * is 5% where sizeKb's is 2%.
 *
 * WHERE THE NUMBERS COME FROM. Every parent -> child edge in this repository's
 * git history that changed a declared page count (277 such edges across the Book
 * and the eight chapters) was measured. Restricted to the current regime — the
 * Book above 500 pages, each chapter within 20% of its present length — 150
 * edges remain, and `max(5%, 4 pages)` admits 143 of them. The seven it stops
 * are every move of 7.9% or more, the Book's 553 -> 604 two-sided recut among
 * them. The largest routine Book move in that regime is 2.36% (551 -> 564); the
 * largest routine chapter move is 4.7%. The band therefore has better than
 * two-to-one headroom over normal work and still stops the deliberate recut
 * cold, which is the behaviour asked for.
 */

import { readFileSync } from 'node:fs'
import policy from './page-count-policy.json'

export const PAGE_DRIFT_BAND_PCT = policy.driftBandPct
export const PAGE_DRIFT_MIN_PAGES = policy.driftMinPages
export const DEFAULT_PAGE_FLOOR = policy.defaultFloorPages
export const PAGE_FLOORS: Readonly<Record<string, number>> = policy.floorPages

/** The Book's id in whitePapers.ts — the one document with its own floor. */
export const BOOK_ID = 'coordination-papers-mega-volume'

/** The Book's floor. 400 pages. */
export const BOOK_PAGE_FLOOR = PAGE_FLOORS[BOOK_ID]

/**
 * The absolute minimum page count for a document, below which the artifact is
 * treated as broken rather than short.
 *
 * The Book: 400. The smallest Book ever committed in the current regime is 529
 * pages, so the floor sits 24% below any real build. The largest single chapter
 * ever committed is 69 pages, so even "only one chapter rendered" lands at least
 * 5.7x under the floor, and a LaTeX error page is one or two pages. There is no
 * plausible broken artifact above 400 and no plausible real one below it.
 *
 * Everything else — chapters, research papers: 8. The shortest chapter ever
 * committed is 12 pages (Sealed Harbor and the Anchor Protocol, early on);
 * today's shortest is 21. A floor of 8 is a third below the all-time shortest
 * real document and several times above any error-page render.
 */
export function pageFloorFor(id: string): number {
  return PAGE_FLOORS[id] ?? DEFAULT_PAGE_FLOOR
}

/** How many pages a document may move from its recorded baseline in silence. */
export function pageDriftAllowance(baseline: number): number {
  return Math.max(baseline * PAGE_DRIFT_BAND_PCT, PAGE_DRIFT_MIN_PAGES)
}

export function pagesWithinBand(actual: number, baseline: number): boolean {
  return Math.abs(actual - baseline) <= pageDriftAllowance(baseline)
}

export function pagesAboveFloor(actual: number, id: string): boolean {
  return actual >= pageFloorFor(id)
}

/** Human-readable band, e.g. "max(5%, 4 pages)". */
export function describeBand(): string {
  return `max(${(PAGE_DRIFT_BAND_PCT * 100).toFixed(0)}%, ${PAGE_DRIFT_MIN_PAGES} pages)`
}

export interface PageCountSubject {
  /** The record's id, e.g. 'coordination-papers-mega-volume'. */
  id: string
  /** What a human calls it, e.g. 'The Book'. */
  label: string
  /**
   * Repo-relative `file:line` of the recorded baseline, so the message can name
   * the exact line to edit. Use `locateBaseline()` to compute it.
   */
  baselineLocation: string
  /** Optional one-command resync, named in the message when present. */
  resyncCommand?: string
  /** Directory the resync command is run from, e.g. 'website-v2/'. */
  resyncCommandCwd?: string
}

/**
 * Finds the `pages:` line that records a document's baseline and returns it as
 * `<repoRelativePath>:<line>`. Scans for the record's `id: '<id>'` property and
 * takes the first `pages: <n>` that follows it, which is the same anchor
 * rewriteMetadata() uses. Falls back to naming the file alone if the shape ever
 * changes — a slightly vaguer message is better than a crash inside a failure
 * path.
 */
export function locateBaseline(absSourcePath: string, id: string, displayPath: string): string {
  try {
    const lines = readFileSync(absSourcePath, 'utf8').split('\n')
    let seenId = false
    for (let i = 0; i < lines.length; i += 1) {
      if (!seenId) {
        if (new RegExp(`\\bid:\\s*'${id}'`).test(lines[i])) seenId = true
        continue
      }
      if (/^\s*pages:\s*\d+\s*,?\s*$/.test(lines[i])) return `${displayPath}:${i + 1}`
    }
  } catch {
    /* fall through to the file-only form */
  }
  return `${displayPath} (the \`pages:\` line of the \`${id}\` record)`
}

/**
 * The message a reader sees when a document falls under its floor. Says what is
 * almost certainly broken, and does not invite anyone to lower the floor.
 */
export function formatFloorFailure(subject: PageCountSubject, actual: number): string {
  const floor = pageFloorFor(subject.id)
  return [
    '',
    `PAGE-COUNT FLOOR: ${subject.label} (${subject.id}) came out at ${actual} page${actual === 1 ? '' : 's'}.`,
    `The floor is ${floor}.`,
    '',
    'A count this low is not a manuscript that got shorter — it is a broken artifact.',
    'Look for:',
    '  • a LaTeX run that died and rendered an error page',
    '  • a truncated or half-written PDF',
    '  • a placeholder or stub committed over the real file',
    '  • a build that emitted front matter and stopped',
    '',
    `The floor sits far below any real build of this document and far above any broken`,
    `one, so it should never fire on ordinary work. If ${subject.label} genuinely became`,
    `a ${actual}-page document, change its entry in website-v2/scripts/page-count-policy.json`,
    'and say why in the pull request. Do not lower it to get a green build.',
    '',
  ].join('\n')
}

/**
 * The message a reader sees when a document leaves its drift band. Names the old
 * count, the new count, the delta in pages and percent, and the exact line to
 * edit — then lays out both readings, because the test cannot know which one is
 * true and the reader can.
 */
export function formatDriftFailure(
  subject: PageCountSubject,
  baseline: number,
  actual: number,
): string {
  const delta = actual - baseline
  const pct = baseline === 0 ? 0 : (delta / baseline) * 100
  const allowance = pageDriftAllowance(baseline)
  const from = subject.resyncCommandCwd ? ` from ${subject.resyncCommandCwd}` : ''
  const resync = subject.resyncCommand
    ? ['', `     Or run \`${subject.resyncCommand}\`${from}, which writes that line for you.`]
    : []
  return [
    '',
    `PAGE-COUNT DRIFT: ${subject.label} (${subject.id}) moved ${baseline} → ${actual} pages.`,
    `That is ${delta >= 0 ? '+' : ''}${delta} page${Math.abs(delta) === 1 ? '' : 's'}, ` +
      `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%, against a band of ` +
      `±${describeBand()} = ±${allowance.toFixed(1)} pages.`,
    '',
    'A move this large is not a routine reflow. One of two things is true, and only',
    'you can say which:',
    '',
    '  1. THIS CHANGE WAS MEANT TO MOVE THE PAGE COUNT — a chapter landed, the page',
    '     geometry was recut, a figure set went in, an appendix was cut. Then the',
    '     baseline is stale, and you update it IN THIS SAME PULL REQUEST:',
    '',
    `         ${subject.baselineLocation}`,
    `         pages: ${baseline}   →   pages: ${actual}`,
    ...resync,
    '',
    '     The point of making you edit that line is that the move then shows up in',
    '     the diff, where a reviewer sees it.',
    '',
    '  2. NOTHING IN THIS CHANGE SHOULD HAVE MOVED IT — then the build is wrong and',
    '     the baseline is right. Look before you touch the number: a chapter that',
    '     silently dropped out of the manifest, a stale artifact committed over a',
    '     good one, a font or geometry change nobody intended, a half-finished',
    '     LaTeX pass.',
    '',
    `Do not widen the band to make this pass. ±${describeBand()} already admits every`,
    "routine rebuild in this repository's recorded history; see the derivation at the",
    'top of website-v2/scripts/page-count-policy.ts.',
    '',
  ].join('\n')
}

/**
 * Runs both rules against one document. Returns the message to fail with, or
 * null when the count is fine. The floor is checked first: a broken artifact
 * should be reported as broken, not as drift.
 */
export function checkPageCount(
  subject: PageCountSubject,
  baseline: number,
  actual: number,
): string | null {
  if (!pagesAboveFloor(actual, subject.id)) return formatFloorFailure(subject, actual)
  if (!pagesWithinBand(actual, baseline)) return formatDriftFailure(subject, baseline, actual)
  return null
}
