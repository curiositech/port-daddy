// Pure-core tests for check-pr-comments-answered. Run with: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyThreads, decideCommentGate, hasExempt, OUTDATED_LIMIT } from './check-pr-comments-answered.mjs'

const AUTHOR = 'erichowens'
const BOT = 'github-actions[bot]'

const thread = (over = {}) => ({
  isResolved: false,
  isOutdated: false,
  path: 'src/x.ts',
  comments: [{ authorLogin: BOT }],
  ...over,
})

test('reviewer spoke last on an open thread → unanswered', () => {
  const r = classifyThreads([thread()], AUTHOR)
  assert.equal(r.unanswered.length, 1)
  assert.equal(r.answered, 0)
  assert.equal(r.total, 1)
})

test('author replied after the reviewer → answered', () => {
  const t = thread({ comments: [{ authorLogin: BOT }, { authorLogin: AUTHOR }] })
  assert.equal(classifyThreads([t], AUTHOR).unanswered.length, 0)
})

test('reviewer re-replied after the author → unanswered again', () => {
  const t = thread({ comments: [{ authorLogin: BOT }, { authorLogin: AUTHOR }, { authorLogin: BOT }] })
  assert.equal(classifyThreads([t], AUTHOR).unanswered.length, 1)
})

test('resolved threads are satisfied even if a reviewer spoke last', () => {
  assert.equal(classifyThreads([thread({ isResolved: true })], AUTHOR).unanswered.length, 0)
})

// The inverse of the assertion that used to live here. "Outdated" is set by the
// act of pushing to those lines, so it marks the threads the author is best
// placed to answer — the old skip made the guard congratulate itself on PRs
// where a reviewer had been silently force-pushed over.
test('outdated + reviewer spoke last + unresolved → still unanswered', () => {
  const r = classifyThreads([thread({ isOutdated: true })], AUTHOR)
  assert.equal(r.unanswered.length, 1)
  assert.equal(r.answered, 0)
  assert.equal(r.unanswered[0].isOutdated, true, 'the outdated flag must survive onto the entry')
})

test('outdated + resolved → answered (resolving is an answer, outdated is not)', () => {
  assert.equal(classifyThreads([thread({ isOutdated: true, isResolved: true })], AUTHOR).unanswered.length, 0)
})

test('outdated + author replied last → answered', () => {
  const t = thread({ isOutdated: true, comments: [{ authorLogin: BOT }, { authorLogin: AUTHOR }] })
  assert.equal(classifyThreads([t], AUTHOR).unanswered.length, 0)
})

test('a live thread carries isOutdated:false, so reporting can split the two groups', () => {
  assert.equal(classifyThreads([thread()], AUTHOR).unanswered[0].isOutdated, false)
})

test('empty threads / no comments → nothing to answer', () => {
  assert.equal(classifyThreads([thread({ comments: [] })], AUTHOR).unanswered.length, 0)
  assert.equal(classifyThreads([], AUTHOR).unanswered.length, 0)
  assert.equal(classifyThreads(null, AUTHOR).unanswered.length, 0)
})

test('a thread the author started and nobody answered is not "unanswered"', () => {
  // author has the last (only) word → ball is not in their court
  assert.equal(classifyThreads([thread({ comments: [{ authorLogin: AUTHOR }] })], AUTHOR).unanswered.length, 0)
})

test('mixed set counts only the open, reviewer-last threads', () => {
  const threads = [
    thread(), // unanswered
    thread({ isResolved: true }), // ok
    thread({ comments: [{ authorLogin: BOT }, { authorLogin: AUTHOR }] }), // ok
    thread({ path: 'src/y.ts' }), // unanswered
  ]
  const r = classifyThreads(threads, AUTHOR)
  assert.equal(r.unanswered.length, 2)
  assert.equal(r.total, 4)
})

// The invariant the old bug broke: an outdated-unanswered thread fell out of
// `unanswered` but was still credited to `answered`, so the two buckets summed
// to `total` while describing a thread nobody had answered. Assert the identity
// AND the bucket it lands in — the sum alone would have passed the buggy code.
test('answered + unanswered === total with an outdated thread in the set', () => {
  const threads = [
    thread(), // live, reviewer last → unanswered
    thread({ isOutdated: true, path: 'src/y.ts' }), // outdated, reviewer last → unanswered
    thread({ isOutdated: true, isResolved: true, path: 'src/z.ts' }), // resolved → answered
    thread({ comments: [{ authorLogin: AUTHOR }] }), // author last → answered
  ]
  const r = classifyThreads(threads, AUTHOR)
  assert.equal(r.total, 4)
  assert.equal(r.unanswered.length, 2)
  assert.equal(r.answered, 2)
  assert.equal(r.answered + r.unanswered.length, r.total)
  assert.deepEqual(r.unanswered.map((t) => t.path), ['src/x.ts', 'src/y.ts'])
  assert.deepEqual(r.unanswered.map((t) => t.isOutdated), [false, true])
})

// ───────────────────────── the GATE's verdict (decideCommentGate) ──────────
// classifyThreads is a pure list-splitter; the GATE is what CI acts on. These
// tests pin the exit code + the two rendered groups so the #5437 bug cannot
// relocate into main() (a `.filter(t => !t.isOutdated)` there) and stay green.

test('GATE: an unanswered OUTDATED thread → exit 1, lands in the outdated group', () => {
  const d = decideCommentGate([thread({ isOutdated: true })], AUTHOR)
  assert.equal(d.exitCode, 1, 'outdated-unanswered must fail the gate, not pass it')
  assert.equal(d.clean, false)
  assert.equal(d.unansweredOutdated.length, 1)
  assert.equal(d.unansweredLive.length, 0)
  assert.equal(d.stdoutLine, '', 'no green "all answered" line when a thread is owed')
  assert.match(d.stderrText, /1 of 1 review thread\(s\) are unanswered/)
  assert.match(d.stderrText, /say what you changed, or resolve \(1\)/)
})

test('GATE: an unanswered LIVE thread → exit 1, lands in the live group', () => {
  const d = decideCommentGate([thread()], AUTHOR)
  assert.equal(d.exitCode, 1)
  assert.equal(d.unansweredLive.length, 1)
  assert.equal(d.unansweredOutdated.length, 0)
  assert.match(d.stderrText, /Reviewer spoke last \(1\)/)
})

test('GATE: all threads answered → exit 0 and the green line', () => {
  const d = decideCommentGate([thread({ isResolved: true })], AUTHOR)
  assert.equal(d.exitCode, 0)
  assert.equal(d.clean, true)
  assert.match(d.stdoutLine, /all 1 review thread\(s\) answered or resolved/)
  assert.equal(d.stderrText, '')
})

// Blocker 2: the old test asserted `Array.prototype.slice` works and called no
// production code. This asserts the ACTUAL rendered output caps the list while
// the headline COUNT stays uncapped — the real invariant the comment promises.
test('GATE render: outdated list is capped at OUTDATED_LIMIT with a tail, count stays uncapped', () => {
  const extra = 7
  const many = Array.from({ length: OUTDATED_LIMIT + extra }, (_, i) =>
    thread({ isOutdated: true, path: `src/f${i}.ts` }))
  const d = decideCommentGate(many, AUTHOR)
  // Headline count is honest, uncapped.
  assert.equal(d.exitCode, 1)
  assert.equal(d.unansweredOutdated.length, OUTDATED_LIMIT + extra)
  assert.match(d.stderrText, new RegExp(`say what you changed, or resolve \\(${OUTDATED_LIMIT + extra}\\)`))
  // Rendered bullets are capped to OUTDATED_LIMIT, with an "…and N more" tail.
  assert.equal(d.shownOutdated.length, OUTDATED_LIMIT)
  const bullets = d.stderrText.split('\n').filter((l) => l.includes(' • src/f'))
  assert.equal(bullets.length, OUTDATED_LIMIT, 'exactly OUTDATED_LIMIT bullets are rendered')
  assert.match(d.stderrText, new RegExp(`…and ${extra} more`))
  assert.match(d.summaryText, new RegExp(`…and ${extra} more`))
})

// Blocker 3: a truncated fetch (>100 threads, hasNextPage) must NOT go green,
// even when every VISIBLE thread is answered — an unseen thread is treated as
// unanswered. Pretending "all N answered" over a partial list is the #5437 bug.
test('GATE: truncated fetch never prints a green line, even with all visible threads answered', () => {
  const d = decideCommentGate([thread({ isResolved: true })], AUTHOR, { truncated: true })
  assert.equal(d.exitCode, 1, 'incomplete view must fail toward "you still owe replies"')
  assert.equal(d.clean, false)
  assert.equal(d.stdoutLine, '', 'no green "all answered" line on a truncated fetch')
  assert.doesNotMatch(d.stdoutLine + d.summaryText, /All \d+ review thread\(s\) answered or resolved/)
  assert.match(d.stderrText, /TRUNCATED/)
  assert.match(d.summaryText, /Incomplete/)
})

test('GATE: truncated fetch WITH unanswered threads still reports both the threads and the truncation', () => {
  const d = decideCommentGate([thread()], AUTHOR, { truncated: true })
  assert.equal(d.exitCode, 1)
  assert.match(d.stderrText, /Reviewer spoke last \(1\)/)
  assert.match(d.stderrText, /TRUNCATED/)
})

test('hasExempt only matches a real directive with a reason', () => {
  assert.equal(hasExempt('<!-- pr-comments-exempt: bot-only PR -->'), true)
  assert.equal(hasExempt('text <!-- pr-comments-exempt: x --> more'), true)
  assert.equal(hasExempt('<!-- pr-comments-exempt: -->'), false) // no reason
  assert.equal(hasExempt('no marker here'), false)
  assert.equal(hasExempt(''), false)
})
