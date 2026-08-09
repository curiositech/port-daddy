// Pure tests for the relay migration gate (ADR-0119). Run with: node --test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ledgerFiles,
  missingFromLedger,
  recordMissing,
} from './check-migrations-gate.mjs'

const LEDGER = {
  applied: [
    { file: '2026-07-23-user-tokens.sql', appliedAt: '2026-08-04T00:00:00Z' },
  ],
}

test('gate passes when every migration is in the ledger', () => {
  assert.deepEqual(missingFromLedger(['2026-07-23-user-tokens.sql'], LEDGER), [])
})

test('gate passes trivially with zero migrations', () => {
  assert.deepEqual(missingFromLedger([], { applied: [] }), [])
  assert.deepEqual(missingFromLedger([], {}), []) // missing "applied" tolerated as empty
})

test('gate blocks a migration absent from the ledger (staging-first)', () => {
  const missing = missingFromLedger(
    ['2026-07-23-user-tokens.sql', '2026-08-10-add-widgets.sql'],
    LEDGER,
  )
  assert.deepEqual(missing, ['2026-08-10-add-widgets.sql'])
})

test('an extra ledger entry (deleted migration file) does not block the gate', () => {
  // The gate is one-directional: every FILE must be recorded; stale records
  // for files that no longer exist are harmless (migration hygiene forbids
  // deleting applied migrations anyway — see migrations/README.md).
  assert.deepEqual(missingFromLedger([], LEDGER), [])
})

test('a corrupt ledger THROWS (fail-closed) rather than passing the gate', () => {
  assert.throws(() => missingFromLedger(['a.sql'], null))
  assert.throws(() => missingFromLedger(['a.sql'], []))
  assert.throws(() => missingFromLedger(['a.sql'], { applied: 'nope' }))
  assert.throws(() => missingFromLedger(['a.sql'], { applied: [{ notFile: 'a.sql' }] }))
  assert.throws(() => missingFromLedger(['a.sql'], { applied: [null] }))
})

test('ledgerFiles extracts the recorded filename set', () => {
  const files = ledgerFiles(LEDGER)
  assert.ok(files.has('2026-07-23-user-tokens.sql'))
  assert.equal(files.size, 1)
})

test('recordMissing appends new files with an appliedAt timestamp', () => {
  const now = new Date('2026-08-11T12:34:56.789Z')
  const updated = recordMissing(
    ['2026-07-23-user-tokens.sql', '2026-08-10-add-widgets.sql', '2026-08-11-more.sql'],
    LEDGER,
    now,
  )
  assert.ok(updated !== null)
  assert.equal(updated.applied.length, 3)
  // Existing entries preserved, in place, untouched.
  assert.deepEqual(updated.applied[0], LEDGER.applied[0])
  assert.deepEqual(updated.applied[1], {
    file: '2026-08-10-add-widgets.sql',
    appliedAt: '2026-08-11T12:34:56Z',
  })
  assert.deepEqual(updated.applied[2], {
    file: '2026-08-11-more.sql',
    appliedAt: '2026-08-11T12:34:56Z',
  })
  // Pure: the input ledger was not mutated.
  assert.equal(LEDGER.applied.length, 1)
})

test('recordMissing is idempotent — returns null when nothing is new', () => {
  assert.equal(recordMissing(['2026-07-23-user-tokens.sql'], LEDGER), null)
  assert.equal(recordMissing([], { applied: [] }), null)
})

test('recordMissing output passes the gate it feeds', () => {
  const files = ['2026-07-23-user-tokens.sql', '2026-08-10-add-widgets.sql']
  const updated = recordMissing(files, LEDGER)
  assert.deepEqual(missingFromLedger(files, updated), [])
})
