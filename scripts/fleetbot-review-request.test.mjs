import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLEETBOT_CHECK_NAME,
  FLEETBOT_COMMENT_MARKER,
  FLEETBOT_LABEL,
  buildStickyComment,
  classifyFleetbotSignal,
  configFromEnv,
  parseList,
  sanitizeReviewTargets,
} from './fleetbot-review-request.mjs'

test('Copilot-only review evidence does not satisfy the Fleetbot requirement', () => {
  const state = classifyFleetbotSignal(
    {
      labels: ['copilot-review-requested'],
      requestedReviewers: { users: [{ login: 'copilot-pull-request-reviewer' }], teams: [] },
      comments: [
        { body: 'Copilot reviewed this pull request.' },
        { body: '<!-- copilot-review-request -->' },
      ],
      checkRuns: [{ name: 'Copilot code review' }],
      reviews: [{ user: { login: 'Copilot' }, body: 'Looks good.' }],
    },
    { reviewers: ['copilot-pull-request-reviewer'], teamReviewers: [] },
  )

  assert.equal(state.ok, false)
  assert.equal(state.requestTracked, false)
  assert.equal(state.reviewObserved, false)
})

test('fallback label plus sticky comment satisfies Fleetbot request tracking', () => {
  const body = `Fleetbot requested\n\n${FLEETBOT_COMMENT_MARKER}`
  const state = classifyFleetbotSignal({
    labels: [{ name: FLEETBOT_LABEL }],
    comments: [{ body }],
    requestedReviewers: { users: [], teams: [] },
    checkRuns: [],
    reviews: [],
  })

  assert.equal(state.ok, true)
  assert.equal(state.requestTracked, true)
  assert.equal(state.signals.hasLabel, true)
  assert.equal(state.signals.hasStickyComment, true)
})

test('configured requestable user or team counts only when that exact target is requested', () => {
  const missing = classifyFleetbotSignal(
    { requestedReviewers: { users: [{ login: 'someone-else' }], teams: [] } },
    { reviewers: ['fleetbot-reviewer'], teamReviewers: ['port-daddy-fleet-reviewers'] },
  )
  assert.equal(missing.ok, false)

  const user = classifyFleetbotSignal(
    { requestedReviewers: { users: [{ login: 'fleetbot-reviewer' }], teams: [] } },
    { reviewers: ['fleetbot-reviewer'], teamReviewers: [] },
  )
  assert.equal(user.ok, true)
  assert.equal(user.signals.directUserRequested, true)

  const team = classifyFleetbotSignal(
    { requestedReviewers: { users: [], teams: [{ slug: 'port-daddy-fleet-reviewers' }] } },
    { reviewers: [], teamReviewers: ['port-daddy-fleet-reviewers'] },
  )
  assert.equal(team.ok, true)
  assert.equal(team.signals.directTeamRequested, true)
})

test('Fleetbot check run, ship comment, or review satisfies already-spoken PRs', () => {
  assert.equal(
    classifyFleetbotSignal({ checkRuns: [{ name: FLEETBOT_CHECK_NAME, status: 'in_progress' }] }).ok,
    true,
  )
  assert.equal(
    classifyFleetbotSignal({ comments: [{ body: '<!-- pd-ship:code-reviewer -->' }] }).ok,
    true,
  )
  assert.equal(
    classifyFleetbotSignal({ reviews: [{ user: { login: 'port-daddy-fleet[bot]' }, body: 'Review.' }] }).ok,
    true,
  )
})

test('draft PRs skip until ready_for_review', () => {
  const state = classifyFleetbotSignal({ draft: true })
  assert.equal(state.ok, true)
  assert.equal(state.skipped, true)
})

test('config parsing is explicit and does not invent a requestable app reviewer', () => {
  assert.deepEqual(parseList(' fleet-a, fleet-b\nfleet-a  fleet-c '), ['fleet-a', 'fleet-b', 'fleet-c'])
  const cfg = configFromEnv({
    FLEETBOT_REVIEWERS: 'copilot-pull-request-reviewer,fleetbot-reviewer',
    FLEETBOT_TEAM_REVIEWERS: 'port-daddy-fleet-reviewers',
  })
  assert.deepEqual(cfg.reviewers, ['fleetbot-reviewer'])
  assert.deepEqual(cfg.teamReviewers, ['port-daddy-fleet-reviewers'])
  assert.deepEqual(sanitizeReviewTargets(['Copilot', 'github-copilot[bot]', 'fleetbot-reviewer']), ['fleetbot-reviewer'])
})

test('sticky comment records the fallback when no requestable target exists', () => {
  const body = buildStickyComment({ appSlug: 'port-daddy-fleet', reviewers: [], teamReviewers: [] })
  assert.match(body, /No requestable Fleetbot user\/team is configured/)
  assert.match(body, /Required gate: `pr-requirements-guard` verifies this Fleetbot signal/)
  assert.doesNotMatch(body, /Required review gate: `Port Daddy Fleet` check run/)
  assert.match(body, new RegExp(FLEETBOT_LABEL))
  assert.match(body, new RegExp(FLEETBOT_COMMENT_MARKER))
})
