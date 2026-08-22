// Pure-core tests for the purser janitor. Run with: node --test
//
// The janitor auto-closes PRs, which is exactly the kind of automation that
// eats real work when an edge case is wrong (the 2026-08-22 sweep closed a
// live carrier holding ~5k unlanded lines). Every rule in the decision table
// is pinned here, and the workflow runs this file before trusting a mutation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideJanitorActions, purserBranchFor } from './purser-janitor.mjs'

const gate = (n) => purserBranchFor(n)

const closed = (over = {}) => ({
  number: 7487,
  merged: false,
  headRef: 'feat/some-work',
  baseRef: 'main',
  ...over,
})

test('purser branch naming matches the fleet-executor contract', () => {
  assert.equal(purserBranchFor(42), 'purser/pr-42-tests')
})

test('reviewed PR closed unmerged → its gate PR is closed', () => {
  const actions = decideJanitorActions(closed(), [
    { number: 7628, headRef: gate(7487), baseRef: 'main' },
  ])
  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, 'close')
  assert.equal(actions[0].prNumber, 7628)
  assert.match(actions[0].body, /closed without merging/)
})

test('reviewed PR merged to main → gate PR closed as obsolete', () => {
  const actions = decideJanitorActions(closed({ merged: true }), [
    { number: 7628, headRef: gate(7487), baseRef: 'main' },
  ])
  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, 'close')
  assert.match(actions[0].body, /merged into `main`/)
})

test('CARRIER: reviewed PR merged INTO its own purser branch → never close, flag instead', () => {
  const actions = decideJanitorActions(
    closed({ merged: true, baseRef: gate(7487) }),
    [{ number: 7628, headRef: gate(7487), baseRef: 'main' }],
  )
  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, 'carrier')
  assert.equal(actions[0].prNumber, 7628)
  assert.match(actions[0].body, /carrier/)
  assert.doesNotMatch(actions[0].body, /Closing/)
})

test('a merged-unrelated-branch close does not masquerade as a carrier', () => {
  // Merging into someone ELSE's purser branch is not the carrier case.
  const actions = decideJanitorActions(
    closed({ merged: true, baseRef: gate(9999) }),
    [{ number: 7628, headRef: gate(7487), baseRef: 'main' }],
  )
  assert.equal(actions[0].type, 'close')
})

test('unmerged close orphans dependents that base on its head branch', () => {
  const actions = decideJanitorActions(closed(), [
    { number: 8001, headRef: 'feat/stacked-child', baseRef: 'feat/some-work' },
  ])
  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, 'orphan')
  assert.equal(actions[0].prNumber, 8001)
  assert.match(actions[0].body, /orphaned/)
})

test('merged close posts NO orphan notes — GitHub retargets dependents itself', () => {
  const actions = decideJanitorActions(closed({ merged: true }), [
    { number: 8001, headRef: 'feat/stacked-child', baseRef: 'feat/some-work' },
  ])
  assert.equal(actions.length, 0)
})

test('a purser PR closing is not treated as its own gate', () => {
  // The closed PR IS the gate PR (head purser/pr-7487-tests). The candidate
  // list may echo it back; it must never act on itself.
  const actions = decideJanitorActions(
    closed({ number: 7628, headRef: gate(7487) }),
    [{ number: 7628, headRef: gate(7487), baseRef: 'main' }],
  )
  assert.equal(actions.length, 0)
})

test('carrier close (unmerged) orphans the implementation PR stacked on it', () => {
  // The gate PR dies unmerged while the reviewed PR still bases on the gate
  // branch — the reviewed PR must be told its landing path is gone.
  const actions = decideJanitorActions(
    closed({ number: 7628, headRef: gate(7487), baseRef: 'main' }),
    [{ number: 7487, headRef: 'feat/some-work', baseRef: gate(7487) }],
  )
  assert.equal(actions.length, 1)
  assert.equal(actions[0].type, 'orphan')
  assert.equal(actions[0].prNumber, 7487)
})

test('unrelated open PRs produce no actions', () => {
  const actions = decideJanitorActions(closed(), [
    { number: 8002, headRef: 'feat/unrelated', baseRef: 'main' },
    { number: 8003, headRef: gate(1234), baseRef: 'main' },
  ])
  assert.equal(actions.length, 0)
})

test('multiple dependents each get their own orphan note', () => {
  const actions = decideJanitorActions(closed(), [
    { number: 8001, headRef: 'a', baseRef: 'feat/some-work' },
    { number: 8002, headRef: 'b', baseRef: 'feat/some-work' },
  ])
  assert.deepEqual(actions.map((a) => [a.type, a.prNumber]), [
    ['orphan', 8001],
    ['orphan', 8002],
  ])
})
