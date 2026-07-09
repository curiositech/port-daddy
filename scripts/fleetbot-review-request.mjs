#!/usr/bin/env node
/**
 * fleetbot-review-request.mjs
 *
 * Fleetbot is the required Port Daddy PR reviewer path. The live Fleetbot
 * identity is a GitHub App (`port-daddy-fleet`), and GitHub's review-request
 * endpoint accepts requestable users and teams, not app slugs. This script is
 * the honest bridge:
 *
 * - If FLEETBOT_REVIEWERS / FLEETBOT_TEAM_REVIEWERS are configured, request
 *   those real GitHub users/teams.
 * - Always stamp a durable Fleetbot request signal on non-draft PRs by adding
 *   the `fleetbot-review-requested` label and a single sticky PR comment.
 * - Treat an already-present Port Daddy Fleet check/review/comment as a valid
 *   Fleetbot signal, so reruns after Fleetbot has spoken stay green.
 *
 * The pure signal classifier is exported and unit-tested. The CLI wrapper uses
 * `gh` so it runs the same locally and in GitHub Actions.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export const FLEETBOT_APP_SLUG = 'port-daddy-fleet'
export const FLEETBOT_LABEL = 'fleetbot-review-requested'
export const FLEETBOT_COMMENT_MARKER = '<!-- fleetbot-review-request -->'
export const FLEETBOT_CHECK_NAME = 'Port Daddy Fleet'

const FLEETBOT_SHIP_COMMENT_RE = /<!--\s*pd-ship:(?:code-reviewer|qa|red-team|test-author|tautology|lookout|snipe|spider|spark)[^>]*-->/i
const FLEETBOT_REVIEW_AUTHOR_RE = /(?:^|\b)(?:port-daddy-fleet|pd-code-reviewer|pd-qa)(?:\[bot\])?$/i
const COPILOT_REVIEW_TARGETS = new Set([
  'copilot',
  'copilot[bot]',
  'copilot-pull-request-reviewer',
  'github-copilot',
  'github-copilot[bot]',
])

export function parseList(value) {
  if (!value) return []
  const seen = new Set()
  const out = []
  for (const item of String(value).split(/[,\s]+/)) {
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue
    seen.add(trimmed.toLowerCase())
    out.push(trimmed)
  }
  return out
}

export function configFromEnv(env = process.env) {
  return {
    appSlug: env.FLEETBOT_APP_SLUG || FLEETBOT_APP_SLUG,
    reviewers: sanitizeReviewTargets(parseList(env.FLEETBOT_REVIEWERS || env.PORT_DADDY_FLEET_REVIEWERS)),
    teamReviewers: sanitizeReviewTargets(parseList(env.FLEETBOT_TEAM_REVIEWERS || env.PORT_DADDY_FLEET_TEAM_REVIEWERS)),
  }
}

export function sanitizeReviewTargets(targets) {
  return (Array.isArray(targets) ? targets : []).filter(
    (target) => !COPILOT_REVIEW_TARGETS.has(String(target).toLowerCase()),
  )
}

function namesFrom(items, field = 'name') {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => (typeof item === 'string' ? item : item?.[field]))
    .filter((name) => typeof name === 'string' && name.trim())
}

function lowerSet(values) {
  return new Set(values.map((v) => String(v).toLowerCase()))
}

function bodyText(item) {
  return typeof item === 'string' ? item : item?.body ?? ''
}

function authorLogin(item) {
  return item?.authorLogin ?? item?.user?.login ?? item?.author?.login ?? ''
}

/**
 * Return the Fleetbot request/review signal state for a PR snapshot.
 *
 * @param {{
 *   draft?: boolean,
 *   labels?: Array<string|{name:string}>,
 *   comments?: Array<string|{body:string, user?:{login:string}}>,
 *   requestedReviewers?: { users?: Array<string|{login:string}>, teams?: Array<string|{slug:string}> },
 *   checkRuns?: Array<{name:string, status?:string, conclusion?:string}>,
 *   reviews?: Array<{body?:string, user?:{login:string}, authorLogin?:string}>
 * }} snapshot
 * @param {{appSlug?: string, reviewers?: string[], teamReviewers?: string[]}} config
 */
export function classifyFleetbotSignal(snapshot = {}, config = {}) {
  const cfg = {
    appSlug: config.appSlug || FLEETBOT_APP_SLUG,
    reviewers: sanitizeReviewTargets(config.reviewers),
    teamReviewers: sanitizeReviewTargets(config.teamReviewers),
  }

  if (snapshot.draft === true) {
    return {
      ok: true,
      skipped: true,
      reason: 'draft PRs do not require the Fleetbot signal until ready_for_review',
      signals: {},
    }
  }

  const labelNames = lowerSet(namesFrom(snapshot.labels))
  const comments = Array.isArray(snapshot.comments) ? snapshot.comments : []
  const commentBodies = comments.map(bodyText)
  const requestUsers = lowerSet(namesFrom(snapshot.requestedReviewers?.users, 'login'))
  const requestTeams = lowerSet(namesFrom(snapshot.requestedReviewers?.teams, 'slug'))
  const checkNames = lowerSet(namesFrom(snapshot.checkRuns))
  const reviews = Array.isArray(snapshot.reviews) ? snapshot.reviews : []

  const configuredReviewers = cfg.reviewers.map((r) => r.toLowerCase())
  const configuredTeams = cfg.teamReviewers.map((t) => t.toLowerCase())

  const directUserRequested =
    configuredReviewers.length > 0 && configuredReviewers.some((login) => requestUsers.has(login))
  const directTeamRequested =
    configuredTeams.length > 0 && configuredTeams.some((slug) => requestTeams.has(slug))
  const hasLabel = labelNames.has(FLEETBOT_LABEL)
  const hasStickyComment = commentBodies.some((body) => body.includes(FLEETBOT_COMMENT_MARKER))
  const hasShipComment = comments.some((comment) => {
    const login = authorLogin(comment)
    return FLEETBOT_REVIEW_AUTHOR_RE.test(login) && FLEETBOT_SHIP_COMMENT_RE.test(bodyText(comment))
  })
  const hasFleetCheck = checkNames.has(FLEETBOT_CHECK_NAME.toLowerCase())
  const hasFleetReview = reviews.some((review) => {
    const login = authorLogin(review)
    return FLEETBOT_REVIEW_AUTHOR_RE.test(login)
  })

  const requestTracked = (hasLabel && hasStickyComment) || directUserRequested || directTeamRequested
  const reviewObserved = hasFleetCheck || hasShipComment || hasFleetReview
  const ok = requestTracked || reviewObserved

  return {
    ok,
    skipped: false,
    requestTracked,
    reviewObserved,
    signals: {
      directUserRequested,
      directTeamRequested,
      hasLabel,
      hasStickyComment,
      hasFleetCheck,
      hasShipComment,
      hasFleetReview,
    },
    reason: ok
      ? 'Fleetbot review request/review signal present'
      : `Missing Fleetbot review signal: add ${FLEETBOT_LABEL}, ${FLEETBOT_COMMENT_MARKER}, a configured requestable reviewer/team, or the ${FLEETBOT_CHECK_NAME} check.`,
  }
}

export function buildStickyComment(config = {}, requestResult = {}) {
  const reviewers = config.reviewers?.length ? config.reviewers.join(', ') : 'none configured'
  const teams = config.teamReviewers?.length ? config.teamReviewers.join(', ') : 'none configured'
  const requestLine = requestResult.attempted
    ? requestResult.ok
      ? 'Direct GitHub reviewer request succeeded.'
      : `Direct GitHub reviewer request did not succeed; using the tracked Fleetbot signal instead. ${requestResult.error ?? ''}`.trim()
    : 'No requestable Fleetbot user/team is configured; using the tracked Fleetbot signal.'

  return [
    '### Fleetbot review requested',
    '',
    'Fleetbot is the required Port Daddy reviewer path for this PR.',
    '',
    `- GitHub App: \`${config.appSlug || FLEETBOT_APP_SLUG}\``,
    `- Requestable users: ${reviewers}`,
    `- Requestable teams: ${teams}`,
    `- Tracking label: \`${FLEETBOT_LABEL}\``,
    '- Required gate: `pr-requirements-guard` verifies this Fleetbot signal on non-draft PRs',
    `- Accepted Fleetbot evidence: this label/comment, a configured reviewer/team request, the \`${FLEETBOT_CHECK_NAME}\` check run, or Fleetbot review/comments`,
    `- Direct request status: ${requestLine}`,
    '',
    'GitHub review requests accept users and teams; the Port Daddy Fleet GitHub App itself is tracked through this label/comment until a requestable user or team is configured.',
    '',
    FLEETBOT_COMMENT_MARKER,
  ].join('\n')
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim()
}

function ghJson(args, opts = {}) {
  const out = gh(args, opts)
  return out ? JSON.parse(out) : null
}

function ghJsonOptional(args, fallback) {
  try {
    return ghJson(args)
  } catch {
    return fallback
  }
}

function resolvePrNumber() {
  const argNum = process.argv.slice(2).find((a) => /^\d+$/.test(a))
  if (argNum) return Number(argNum)
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return null
  try {
    const ev = JSON.parse(readFileSync(eventPath, 'utf8'))
    if (ev.pull_request?.number) return ev.pull_request.number
    if (ev.issue?.pull_request && ev.issue?.number) return ev.issue.number
  } catch {
    return null
  }
  return null
}

function repoParts() {
  const slug = process.env.GITHUB_REPOSITORY
  if (!slug) return null
  const [owner, repo] = slug.split('/')
  return owner && repo ? { owner, repo } : null
}

function fetchSnapshot(owner, repo, number) {
  const pr = ghJsonOptional(['api', `repos/${owner}/${repo}/pulls/${number}`], {})
  const labels = ghJsonOptional(['api', `repos/${owner}/${repo}/issues/${number}/labels?per_page=100`], [])
  const comments = ghJsonOptional(['api', `repos/${owner}/${repo}/issues/${number}/comments?per_page=100`], [])
  const requestedReviewers = ghJsonOptional(
    ['api', `repos/${owner}/${repo}/pulls/${number}/requested_reviewers`],
    { users: [], teams: [] },
  )
  const reviews = ghJsonOptional(['api', `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`], [])
  const headSha = pr?.head?.sha
  const checkRuns = headSha
    ? ghJsonOptional(
        [
          'api',
          '--method',
          'GET',
          `repos/${owner}/${repo}/commits/${headSha}/check-runs`,
          '-f',
          `check_name=${FLEETBOT_CHECK_NAME}`,
          '-f',
          'per_page=100',
        ],
        { check_runs: [] },
      )?.check_runs ?? []
    : []

  return {
    draft: pr?.draft === true,
    labels,
    comments,
    requestedReviewers,
    checkRuns,
    reviews,
  }
}

function ensureLabel(owner, repo, number) {
  try {
    gh([
      'api',
      '--method',
      'POST',
      `repos/${owner}/${repo}/labels`,
      '-f',
      `name=${FLEETBOT_LABEL}`,
      '-f',
      'color=0E7490',
      '-f',
      'description=Fleetbot review request has been tracked for this PR',
    ])
  } catch {
    // Existing label or insufficient label-create permission. Adding it below
    // is the read-back proof that matters.
  }
  gh([
    'api',
    '--method',
    'POST',
    `repos/${owner}/${repo}/issues/${number}/labels`,
    '-f',
    `labels[]=${FLEETBOT_LABEL}`,
  ])
}

function upsertStickyComment(owner, repo, number, comments, body) {
  const existing = (Array.isArray(comments) ? comments : []).find((comment) =>
    String(comment?.body ?? '').includes(FLEETBOT_COMMENT_MARKER),
  )
  if (existing?.id) {
    gh(['api', '--method', 'PATCH', `repos/${owner}/${repo}/issues/comments/${existing.id}`, '-f', `body=${body}`])
    return
  }
  gh(['api', '--method', 'POST', `repos/${owner}/${repo}/issues/${number}/comments`, '-f', `body=${body}`])
}

function requestDirectReviewers(owner, repo, number, config) {
  if (!config.reviewers.length && !config.teamReviewers.length) {
    return { attempted: false, ok: false }
  }
  try {
    gh(
      ['api', '--method', 'POST', `repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, '--input', '-'],
      {
        input: JSON.stringify({
          reviewers: config.reviewers,
          team_reviewers: config.teamReviewers,
        }),
      },
    )
    return { attempted: true, ok: true }
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      error: err instanceof Error ? err.message.split('\n')[0] : String(err),
    }
  }
}

function printState(prefix, state) {
  const enabled = Object.entries(state.signals ?? {})
    .filter(([, value]) => value)
    .map(([name]) => name)
  console.log(`${prefix}: ${state.reason}`)
  if (enabled.length) console.log(`${prefix}: signals=${enabled.join(',')}`)
}

function checkCommand(owner, repo, number, config) {
  const snapshot = fetchSnapshot(owner, repo, number)
  const state = classifyFleetbotSignal(snapshot, config)
  printState('fleetbot-review-request', state)
  if (!state.ok) process.exitCode = 1
}

function ensureCommand(owner, repo, number, config) {
  const before = fetchSnapshot(owner, repo, number)
  if (before.draft === true) {
    printState('fleetbot-review-request', classifyFleetbotSignal(before, config))
    return
  }

  const requestResult = requestDirectReviewers(owner, repo, number, config)
  const commentBody = buildStickyComment(config, requestResult)

  try {
    ensureLabel(owner, repo, number)
  } catch (err) {
    console.warn(`fleetbot-review-request: label sync failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    upsertStickyComment(owner, repo, number, before.comments, commentBody)
  } catch (err) {
    console.warn(`fleetbot-review-request: sticky comment sync failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const after = fetchSnapshot(owner, repo, number)
  const state = classifyFleetbotSignal(after, config)
  printState('fleetbot-review-request', state)
  if (!state.ok) process.exitCode = 1
}

function main() {
  const command = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : 'check'
  const number = resolvePrNumber()
  if (!number) {
    console.log('fleetbot-review-request: no PR context; skipping.')
    return
  }
  const repo = repoParts()
  if (!repo) {
    console.log('fleetbot-review-request: GITHUB_REPOSITORY unset; skipping.')
    return
  }

  const config = configFromEnv()
  if (command === 'ensure') {
    ensureCommand(repo.owner, repo.repo, number, config)
  } else if (command === 'check') {
    checkCommand(repo.owner, repo.repo, number, config)
  } else {
    console.error(`fleetbot-review-request: unknown command ${command}`)
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
}
