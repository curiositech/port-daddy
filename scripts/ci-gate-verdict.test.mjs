// Pure-decision tests for ci-gate-verdict. Run with: node --test
//
// The negative cases carry the weight here. ci-gate is the single required
// check, so a wrongly-passing verdict lets untested code through branch
// protection — every test below that asserts `ok === false` is guarding that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideGate, resolveStale } from './ci-gate-verdict.mjs'

const needs = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { result: v }]))

test('passes when everything succeeded or skipped', () => {
  const v = decideGate(needs({ lint: 'success', fleetbar: 'skipped' }), false)
  assert.equal(v.ok, true)
  assert.match(v.message, /ci-gate OK/)
})

test('fails on a real failure', () => {
  const v = decideGate(needs({ lint: 'failure', 'unit-tests': 'success' }), false)
  assert.equal(v.ok, false)
  assert.match(v.message, /these jobs failed: lint/)
})

test('a failure still fails on a superseded run — staleness never excuses one', () => {
  // The code that produced it is usually still in the branch, so the author
  // needs to see it even though this commit is no longer the head.
  const v = decideGate(needs({ lint: 'failure' }), true)
  assert.equal(v.ok, false)
})

test('names cancelled jobs alongside a failure without hiding the failure', () => {
  const v = decideGate(needs({ lint: 'failure', 'unit-tests': 'cancelled' }), false)
  assert.equal(v.ok, false)
  assert.match(v.message, /these jobs failed: lint/)
  assert.match(v.message, /also cancelled: unit-tests/)
})

test('FAILS on cancellation when this commit is still the PR head', () => {
  // Nothing superseded the run, so no successor is coming with a verdict. This
  // is the manual-cancel / infra-kill case and it must stay red.
  const v = decideGate(needs({ 'unit-tests': 'cancelled', lint: 'success' }), false)
  assert.equal(v.ok, false)
  assert.match(v.message, /cancelled on the current head commit/)
})

test('PASSES on cancellation once a newer commit has taken over', () => {
  // The regression this whole file exists for: a push superseding an in-flight
  // run produced a red required check on a commit nobody was waiting on.
  const v = decideGate(
    needs({ 'unit-tests': 'cancelled', 'integration-tests': 'cancelled', lint: 'success' }),
    true,
  )
  assert.equal(v.ok, true)
  assert.match(v.message, /SUPERSEDED/)
  assert.match(v.message, /integration-tests, unit-tests/)
})

test('sorts the named jobs so the message is stable across runs', () => {
  const v = decideGate(needs({ zebra: 'failure', alpha: 'failure' }), false)
  assert.match(v.message, /alpha, zebra/)
})

test('an empty needs context passes rather than throwing', () => {
  assert.equal(decideGate({}, false).ok, true)
  assert.equal(decideGate(undefined, false).ok, true)
})

// --- resolveStale: every uncertain path must fail closed --------------------

const okResponse = sha => ({ ok: true, json: async () => ({ head: { sha } }) })
const base = {
  eventName: 'pull_request',
  repo: 'o/r',
  prNumber: '1',
  runHeadSha: 'aaaaaaa',
  token: 't',
}

test('stale when the live PR head has moved past this run', async () => {
  assert.equal(await resolveStale({ ...base, fetchImpl: async () => okResponse('bbbbbbb') }), true)
})

test('not stale when the live PR head is still this run', async () => {
  assert.equal(await resolveStale({ ...base, fetchImpl: async () => okResponse('aaaaaaa') }), false)
})

test('not stale for push / merge_group — those are never superseded', async () => {
  // Their concurrency group is per-SHA with cancel-in-progress off, so a
  // cancellation there is always real. No API call should even be attempted.
  let called = false
  const fetchImpl = async () => {
    called = true
    return okResponse('bbbbbbb')
  }
  assert.equal(await resolveStale({ ...base, eventName: 'push', fetchImpl }), false)
  assert.equal(await resolveStale({ ...base, eventName: 'merge_group', fetchImpl }), false)
  assert.equal(called, false)
})

test('not stale when the API errors — a blip must never open the gate', async () => {
  assert.equal(await resolveStale({ ...base, fetchImpl: async () => ({ ok: false }) }), false)
  assert.equal(
    await resolveStale({
      ...base,
      fetchImpl: async () => {
        throw new Error('network')
      },
    }),
    false,
  )
})

test('not stale when the response is malformed', async () => {
  const cases = [{}, { head: {} }, { head: { sha: 42 } }, { head: { sha: 'abc' } }]
  for (const body of cases) {
    const stale = await resolveStale({
      ...base,
      fetchImpl: async () => ({ ok: true, json: async () => body }),
    })
    assert.equal(stale, false, `expected fail-closed for ${JSON.stringify(body)}`)
  }
})

test('not stale when any input is missing', async () => {
  const fetchImpl = async () => okResponse('bbbbbbb')
  for (const missing of ['repo', 'prNumber', 'runHeadSha', 'token']) {
    assert.equal(await resolveStale({ ...base, [missing]: '', fetchImpl }), false, missing)
  }
})
