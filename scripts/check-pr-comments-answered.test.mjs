// Pure-core tests for check-pr-comments-answered. Run with: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyThreads, hasExempt, OUTDATED_LIMIT } from './check-pr-comments-answered.mjs'

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

test('OUTDATED_LIMIT caps the rendered list, never the count', () => {
  const many = Array.from({ length: OUTDATED_LIMIT + 7 }, (_, i) =>
    thread({ isOutdated: true, path: `src/f${i}.ts` }))
  const r = classifyThreads(many, AUTHOR)
  assert.equal(r.unanswered.length, OUTDATED_LIMIT + 7, 'the count must stay honest')
  assert.equal(r.answered, 0)
  assert.equal(r.unanswered.slice(0, OUTDATED_LIMIT).length, OUTDATED_LIMIT)
})

test('hasExempt only matches a real directive with a reason', () => {
  assert.equal(hasExempt('<!-- pr-comments-exempt: bot-only PR -->'), true)
  assert.equal(hasExempt('text <!-- pr-comments-exempt: x --> more'), true)
  assert.equal(hasExempt('<!-- pr-comments-exempt: -->'), false) // no reason
  assert.equal(hasExempt('no marker here'), false)
  assert.equal(hasExempt(''), false)
})
