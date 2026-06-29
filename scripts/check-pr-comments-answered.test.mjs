// Pure-core tests for check-pr-comments-answered. Run with: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyThreads, hasExempt } from './check-pr-comments-answered.mjs'

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

test('outdated threads are skipped (code moved on)', () => {
  assert.equal(classifyThreads([thread({ isOutdated: true })], AUTHOR).unanswered.length, 0)
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

test('hasExempt only matches a real directive with a reason', () => {
  assert.equal(hasExempt('<!-- pr-comments-exempt: bot-only PR -->'), true)
  assert.equal(hasExempt('text <!-- pr-comments-exempt: x --> more'), true)
  assert.equal(hasExempt('<!-- pr-comments-exempt: -->'), false) // no reason
  assert.equal(hasExempt('no marker here'), false)
  assert.equal(hasExempt(''), false)
})
