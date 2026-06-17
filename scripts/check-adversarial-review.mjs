#!/usr/bin/env node
/**
 * check-adversarial-review.mjs - machine gate for Port Daddy's PR review contract.
 *
 * A generic "review happened" status is not enough. This verifies a durable PR
 * artifact: an adversarial-review comment or PR review from someone other than
 * the PR author, tied to the current head SHA, with a final verdict of SHIP.
 *
 * Expected artifact:
 *
 *   Adversarial Review
 *   Reviewer: feature-dev:code-reviewer
 *   Head-SHA: <40-hex PR head sha>
 *   Verdict: SHIP
 *
 * The script can run as a normal failing check, or with --set-status to write a
 * commit status named "adversarial-review" to the PR head. Pair --set-status
 * with --soft-fail in the GitHub workflow so the workflow machinery stays green
 * while the dedicated commit status carries the actual block. That matters
 * because issue_comment / pull_request_review workflows run after the review
 * artifact is posted, and GitHub branch protection needs a status on the PR head
 * commit, not only on the workflow's default-branch run.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const STATUS_CONTEXT = 'adversarial-review'
export const PASSING_VERDICT = 'SHIP'
export const VERDICTS = ['SHIP-AFTER-FIX', 'DO-NOT-SHIP', 'SHIP']

const GENERIC_REVIEW_BOTS = new Set([
  'copilot-pull-request-reviewer[bot]',
  'github-actions[bot]',
  'cloudflare-pages[bot]',
  'dependabot[bot]',
])

function lower(value) {
  return String(value ?? '').trim().toLowerCase()
}

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => lower(item))
    .filter(Boolean)
}

function parseDate(value) {
  const time = Date.parse(value ?? '')
  return Number.isFinite(time) ? time : 0
}

function firstMatch(body, regex) {
  const match = body.match(regex)
  return match?.[1]?.trim() ?? null
}

export function parseReviewArtifact(body) {
  const text = String(body ?? '')
  if (!/\badversarial\s+review\b/i.test(text)) return null

  const verdict = firstMatch(
    text,
    /(?:^|\n)\s*(?:[-*]\s*)?(?:(?:adversarial\s+review\s+)?verdict|adversarial\s+review)\s*[:=-]\s*(SHIP-AFTER-FIX|DO-NOT-SHIP|SHIP)\b/i,
  ) ?? firstMatch(text, /(?:^|\n)\s*(?:[-*]\s*)?(SHIP-AFTER-FIX|DO-NOT-SHIP|SHIP)\b/i)

  const headSha = firstMatch(
    text,
    /(?:^|\n)\s*(?:[-*]\s*)?(?:head(?:\s+|-)?sha|pr(?:\s+|-)?head(?:\s+|-)?sha|head)\s*[:=-]\s*([a-f0-9]{40})\b/i,
  )

  const reviewerIdentity = firstMatch(
    text,
    /(?:^|\n)\s*(?:[-*]\s*)?reviewer(?:\s+identity)?\s*[:=-]\s*([^\n]+)/i,
  )

  if (!verdict && !headSha && !reviewerIdentity) return null
  return {
    verdict: verdict?.toUpperCase() ?? null,
    headSha: headSha?.toLowerCase() ?? null,
    reviewerIdentity: reviewerIdentity?.replace(/\s+#.*$/, '').trim() ?? null,
  }
}

export function normalizeReviewItems(issueComments = [], reviews = []) {
  const comments = issueComments
    .filter((comment) => comment?.body)
    .map((comment) => ({
      sourceType: 'issue-comment',
      sourceUrl: comment.html_url ?? comment.url ?? null,
      authorLogin: comment.user?.login ?? '',
      body: comment.body,
      createdAt: comment.updated_at ?? comment.created_at,
    }))

  const reviewItems = reviews
    .filter((review) => review?.body && review.state !== 'DISMISSED')
    .map((review) => ({
      sourceType: 'pull-request-review',
      sourceUrl: review.html_url ?? review.url ?? null,
      authorLogin: review.user?.login ?? '',
      body: review.body,
      createdAt: review.submitted_at ?? review.updated_at ?? review.created_at,
    }))

  return [...comments, ...reviewItems]
}

function approvalReason(artifact, item, options) {
  const author = lower(item.authorLogin)
  const prAuthor = lower(options.prAuthor)
  const reviewer = lower(artifact.reviewerIdentity)
  const allow = new Set(splitList(options.approvedReviewers))

  if (!author) return 'review artifact has no GitHub author'
  if (author === prAuthor && !options.allowPrAuthor) return 'review artifact was posted by the PR author'
  if (GENERIC_REVIEW_BOTS.has(author)) return `${item.authorLogin} is not an adversarial reviewer identity`
  if (allow.size > 0 && !allow.has(author) && !allow.has(reviewer)) {
    return `reviewer is not in ADVERSARIAL_REVIEW_APPROVERS (${[...allow].join(', ')})`
  }
  return null
}

export function evaluateAdversarialReview(input) {
  const headSha = lower(input.headSha)
  const prAuthor = lower(input.prAuthor)
  const artifacts = []

  for (const item of input.items ?? []) {
    const artifact = parseReviewArtifact(item.body)
    if (!artifact) continue
    const currentHead = artifact.headSha === headSha
    const rejection = currentHead ? approvalReason(artifact, item, {
      prAuthor,
      approvedReviewers: input.approvedReviewers,
      allowPrAuthor: input.allowPrAuthor,
    }) : null

    artifacts.push({
      ...artifact,
      sourceType: item.sourceType,
      sourceUrl: item.sourceUrl,
      authorLogin: item.authorLogin,
      createdAt: item.createdAt,
      currentHead,
      rejection,
    })
  }

  const current = artifacts.filter((artifact) => artifact.currentHead)
  const acceptable = current
    .filter((artifact) => !artifact.rejection)
    .sort((a, b) => parseDate(a.createdAt) - parseDate(b.createdAt))
  const latest = acceptable.at(-1) ?? null

  if (latest?.verdict === PASSING_VERDICT) {
    return {
      ok: true,
      summary: `adversarial review accepted from ${latest.authorLogin}: ${latest.verdict}`,
      latest,
      artifacts,
    }
  }

  let summary
  if (!artifacts.length) {
    summary = 'no adversarial-review artifact found'
  } else if (!current.length) {
    summary = 'adversarial-review artifact exists, but not for the current head SHA'
  } else if (!acceptable.length) {
    summary = `current-head adversarial-review artifact exists, but none came from an accepted reviewer`
  } else {
    summary = `latest accepted current-head verdict is ${latest.verdict}; required verdict is SHIP`
  }

  return { ok: false, summary, latest, artifacts }
}

function getEvent(env) {
  const path = env.GITHUB_EVENT_PATH
  if (!path) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function eventPrNumber(env, event) {
  if (env.PR_NUMBER) return Number(env.PR_NUMBER)
  if (event.pull_request?.number) return Number(event.pull_request.number)
  if (event.issue?.pull_request && event.issue?.number) return Number(event.issue.number)
  return null
}

function repoFromEnv(env) {
  const repo = env.GITHUB_REPOSITORY
  if (!repo || !repo.includes('/')) throw new Error('GITHUB_REPOSITORY is required (owner/repo)')
  return repo
}

function apiHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
    'user-agent': 'port-daddy-adversarial-review-gate',
  }
}

async function githubRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...apiHeaders(token), ...(options.headers ?? {}) },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub API ${response.status} for ${url}: ${text}`)
  }
  return response
}

async function githubPages(url, token) {
  const rows = []
  let next = url
  while (next) {
    const response = await githubRequest(next, token)
    rows.push(...await response.json())
    const link = response.headers.get('link') ?? ''
    next = null
    for (const part of link.split(',')) {
      const match = part.match(/<([^>]+)>;\s*rel="next"/)
      if (match) next = match[1]
    }
  }
  return rows
}

async function getPrReviewState({ repo, prNumber, token, apiUrl }) {
  const base = `${apiUrl}/repos/${repo}`
  const [prResponse, issueComments, reviews] = await Promise.all([
    githubRequest(`${base}/pulls/${prNumber}`, token),
    githubPages(`${base}/issues/${prNumber}/comments?per_page=100`, token),
    githubPages(`${base}/pulls/${prNumber}/reviews?per_page=100`, token),
  ])
  const pr = await prResponse.json()
  return {
    pr,
    items: normalizeReviewItems(issueComments, reviews),
  }
}

async function setCommitStatus({ repo, sha, token, apiUrl, state, description, targetUrl }) {
  const body = {
    state,
    context: STATUS_CONTEXT,
    description: description.slice(0, 140),
    ...(targetUrl ? { target_url: targetUrl } : {}),
  }
  await githubRequest(`${apiUrl}/repos/${repo}/statuses/${sha}`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function printFailure(result, headSha) {
  console.error(`\n✗ ${STATUS_CONTEXT}: ${result.summary}\n`)
  if (result.artifacts.length) {
    console.error('Seen adversarial-review artifacts:')
    for (const artifact of result.artifacts) {
      const bits = [
        artifact.currentHead ? 'current-head' : 'stale-head',
        artifact.rejection ? `rejected: ${artifact.rejection}` : 'accepted-reviewer',
        artifact.verdict ? `verdict=${artifact.verdict}` : 'missing-verdict',
        artifact.headSha ? `head=${artifact.headSha.slice(0, 12)}` : 'missing-head-sha',
        `author=${artifact.authorLogin}`,
      ]
      console.error(`  - ${bits.join('; ')}${artifact.sourceUrl ? ` (${artifact.sourceUrl})` : ''}`)
    }
    console.error('')
  }
  console.error('Post a PR comment or PR review with this exact shape after the final fixup commit:')
  console.error('')
  console.error('Adversarial Review')
  console.error('Reviewer: feature-dev:code-reviewer')
  console.error(`Head-SHA: ${headSha}`)
  console.error('Verdict: SHIP')
  console.error('')
  console.error('Copilot comments, generic Claude Code Review checks, self-authored comments, stale SHA comments,')
  console.error('SHIP-AFTER-FIX, and DO-NOT-SHIP do not satisfy this gate.\n')
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const env = process.env
  const eventName = env.GITHUB_EVENT_NAME ?? ''
  const event = getEvent(env)
  const apiUrl = env.GITHUB_API_URL ?? 'https://api.github.com'
  const setStatus = args.has('--set-status')
  const softFail = args.has('--soft-fail') || args.has('--no-fail')

  if (eventName === 'merge_group') {
    console.log(`${STATUS_CONTEXT}: merge_group pass-through; PR-head status is enforced before queue entry.`)
    if (setStatus && env.GITHUB_TOKEN && env.GITHUB_SHA) {
      await setCommitStatus({
        repo: repoFromEnv(env),
        sha: env.GITHUB_SHA,
        token: env.GITHUB_TOKEN,
        apiUrl,
        state: 'success',
        description: 'Adversarial review is enforced on the PR head before merge queue.',
      })
    }
    return
  }

  const prNumber = eventPrNumber(env, event)
  if (!prNumber) {
    console.log(`${STATUS_CONTEXT}: no pull request context; nothing to check.`)
    return
  }

  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN or GH_TOKEN is required for PR review verification')

  const repo = repoFromEnv(env)
  const { pr, items } = await getPrReviewState({ repo, prNumber, token, apiUrl })
  const headSha = lower(env.HEAD_SHA || pr.head?.sha)
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error(`Could not resolve 40-hex PR head SHA for PR #${prNumber}`)

  const result = evaluateAdversarialReview({
    headSha,
    prAuthor: pr.user?.login ?? '',
    items,
    approvedReviewers: env.ADVERSARIAL_REVIEW_APPROVERS,
    allowPrAuthor: env.ALLOW_PR_AUTHOR_ADVERSARIAL_REVIEW === 'true',
  })

  if (setStatus) {
    await setCommitStatus({
      repo,
      sha: headSha,
      token,
      apiUrl,
      state: result.ok ? 'success' : 'failure',
      description: result.ok ? result.summary : result.summary,
      targetUrl: `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/pull/${prNumber}`,
    })
  }

  if (!result.ok) {
    printFailure(result, headSha)
    if (softFail) return
    process.exit(1)
  }
  console.log(`✓ ${STATUS_CONTEXT}: ${result.summary}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n✗ ${STATUS_CONTEXT}: ${error.message}\n`)
    process.exit(1)
  })
}
