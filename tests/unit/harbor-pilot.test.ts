/**
 * Harbor Pilot decision-layer tests (apps/github-app-fleet/lib/harbor-pilot.ts).
 *
 * The pilot's rules encode hard-won incident lessons (#353: a semantically
 * superseded PR auto-merged and regressed retired work), so every rule and
 * every precedence between rules gets a test — especially the safety
 * defaults: uncertainty never demotes, drafts are never touched, operator
 * overrides are never re-overridden.
 */

import {
  PILOT_COMMENT_MARKER,
  SUPERSEDED_LABEL,
  conflictComment,
  decide,
  renderDigest,
  supersededComment,
  type PRSnapshot,
} from '../../apps/github-app-fleet/lib/harbor-pilot.js'

function snapshot(overrides: Partial<PRSnapshot> = {}): PRSnapshot {
  return {
    number: 100,
    title: 'feat: example',
    isDraft: false,
    mergeableState: 'clean',
    autoMergeEnabled: false,
    labels: [],
    fileParity: { total: 3, identical: 0 },
    ...overrides,
  }
}

describe('decide()', () => {
  test('drafts are always left alone, whatever else is true', () => {
    const pr = snapshot({
      isDraft: true,
      mergeableState: 'dirty',
      fileParity: { total: 2, identical: 2 }, // would otherwise demote
    })
    expect(decide(pr).kind).toBe('leave')
  })

  test('non-draft unarmed PR gets armed', () => {
    expect(decide(snapshot()).kind).toBe('arm')
  })

  test('armed, current, conflict-free PR is left alone', () => {
    const pr = snapshot({ autoMergeEnabled: true })
    expect(decide(pr).kind).toBe('leave')
  })

  test('conflicting PR is flagged, not armed', () => {
    const pr = snapshot({ mergeableState: 'dirty' })
    expect(decide(pr).kind).toBe('flag-conflict')
  })

  test('fully superseded PR is demoted', () => {
    const pr = snapshot({ fileParity: { total: 4, identical: 4 } })
    expect(decide(pr).kind).toBe('demote-superseded')
  })

  test('supersession outranks conflict flagging and arming', () => {
    const pr = snapshot({
      mergeableState: 'dirty',
      autoMergeEnabled: false,
      fileParity: { total: 1, identical: 1 },
    })
    expect(decide(pr).kind).toBe('demote-superseded')
  })

  test('partially superseded PR is NOT demoted', () => {
    const pr = snapshot({ fileParity: { total: 4, identical: 3 } })
    expect(decide(pr).kind).toBe('arm')
  })

  test('null parity (probe failed) never demotes — uncertainty degrades to arm/leave', () => {
    const pr = snapshot({ fileParity: null })
    expect(decide(pr).kind).toBe('arm')
    expect(decide({ ...pr, autoMergeEnabled: true }).kind).toBe('leave')
  })

  test('zero-file parity never demotes (empty diff is not evidence)', () => {
    const pr = snapshot({ fileParity: { total: 0, identical: 0 } })
    expect(decide(pr).kind).toBe('arm')
  })

  test('operator override: superseded label + re-readied PR is never re-demoted', () => {
    const pr = snapshot({
      labels: [SUPERSEDED_LABEL],
      fileParity: { total: 2, identical: 2 },
    })
    expect(decide(pr).kind).toBe('arm')
  })

  test('every action carries a human-readable reason', () => {
    const cases = [
      snapshot({ isDraft: true }),
      snapshot(),
      snapshot({ mergeableState: 'dirty' }),
      snapshot({ fileParity: { total: 1, identical: 1 } }),
    ]
    for (const pr of cases) {
      expect(decide(pr).reason.length).toBeGreaterThan(10)
    }
  })
})

describe('comment bodies', () => {
  test('both comment kinds embed the idempotency marker', () => {
    expect(supersededComment({ total: 2, identical: 2 })).toContain(PILOT_COMMENT_MARKER)
    expect(conflictComment()).toContain(PILOT_COMMENT_MARKER)
  })

  test('superseded comment states the parity counts and the demotion (not closure)', () => {
    const body = supersededComment({ total: 5, identical: 5 })
    expect(body).toContain('5/5')
    expect(body).toContain('draft')
    expect(body.toLowerCase()).not.toContain('closing')
  })
})

describe('renderDigest()', () => {
  test('summarizes counts and lists only non-leave actions', () => {
    const digest = renderDigest(
      'o/r',
      [
        { number: 1, title: 'a', action: { kind: 'arm', reason: 'r1' }, executed: true },
        { number: 2, title: 'b', action: { kind: 'leave', reason: 'r2' }, executed: false },
        {
          number: 3,
          title: 'c',
          action: { kind: 'demote-superseded', reason: 'r3' },
          executed: false,
          error: 'boom',
        },
      ],
      false,
    )
    expect(digest).toContain('1 armed')
    expect(digest).toContain('1 demoted as superseded')
    expect(digest).toContain('2 left alone'.replace('2', '1')) // 1 left alone
    expect(digest).toContain('#1')
    expect(digest).toContain('#3')
    expect(digest).toContain('FAILED (boom)')
    expect(digest).not.toContain('#2')
  })

  test('dry-run digest says "would", not "did"', () => {
    const digest = renderDigest(
      'o/r',
      [{ number: 9, title: 'x', action: { kind: 'arm', reason: 'r' }, executed: false }],
      true,
    )
    expect(digest).toContain('(dry-run)')
    expect(digest).toContain('would')
  })
})
