#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DOCUMENTARIAN_CONTEXT = 'port-daddy/documentarian'
export const GUIDE_REVIEW_CONTEXT = 'port-daddy/release-guide-review'
export const GUIDE_REVIEW_MARKER = 'port-daddy-release-guide-review:v1'
const FULL_GIT_COMMIT = /^[0-9a-f]{40}$/i
const REQUIRED_GUIDE_ROLES = ['adversarial', 'countercase', 'steelman']
const TRUSTED_COMMENT_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

function requireFullCommit(value, label = 'source SHA') {
  const sha = String(value ?? '').trim().toLowerCase()
  if (!FULL_GIT_COMMIT.test(sha)) throw new Error(`${label} must be a full 40-character Git commit`)
  return sha
}

function nonEmpty(value, label) {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${label} must be non-empty`)
  return normalized
}

export function validateGuideReviewEvidence(raw, expectedSha) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('guide review evidence must be an object')
  }
  if (raw.schemaVersion !== 1) throw new Error('guide review evidence schemaVersion must be 1')
  const sha = requireFullCommit(raw.sha, 'guide review SHA')
  if (sha !== requireFullCommit(expectedSha)) throw new Error('guide review evidence SHA does not match the release candidate')
  if (!Array.isArray(raw.reviews) || raw.reviews.length !== REQUIRED_GUIDE_ROLES.length) {
    throw new Error('guide review evidence must contain exactly three reviews')
  }

  const agentIds = new Set()
  const transcriptIds = new Set()
  const reviews = raw.reviews.map((review) => {
    const role = nonEmpty(review?.role, 'review role')
    const agentId = nonEmpty(review?.agentId, `${role} agentId`)
    const transcriptId = nonEmpty(review?.transcriptId, `${role} transcriptId`)
    const verdict = nonEmpty(review?.verdict, `${role} verdict`)
    const completedAt = nonEmpty(review?.completedAt, `${role} completedAt`)
    if (verdict !== 'SHIP') throw new Error(`${role} review must end in SHIP before stable release`)
    if (agentIds.has(agentId)) throw new Error('guide reviews must use three distinct agent ids')
    if (transcriptIds.has(transcriptId)) throw new Error('guide reviews must use three distinct transcript ids')
    agentIds.add(agentId)
    transcriptIds.add(transcriptId)
    return { role, agentId, transcriptId, verdict, completedAt }
  }).sort((a, b) => a.role.localeCompare(b.role))

  const roles = reviews.map((review) => review.role)
  if (JSON.stringify(roles) !== JSON.stringify(REQUIRED_GUIDE_ROLES)) {
    throw new Error(`guide reviews must cover exactly: ${REQUIRED_GUIDE_ROLES.join(', ')}`)
  }
  return { schemaVersion: 1, sha, reviews }
}

export function guideReviewDigest(evidence) {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
}

export function formatGuideReviewComment(evidence) {
  return `<!-- ${GUIDE_REVIEW_MARKER}\n${JSON.stringify(evidence)}\n-->`
}

export function parseGuideReviewComment(body, expectedSha) {
  const escapedMarker = GUIDE_REVIEW_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(body ?? '').match(new RegExp(`<!--\\s*${escapedMarker}\\s*\\n([\\s\\S]*?)\\n-->`))
  if (!match) return null
  return validateGuideReviewEvidence(JSON.parse(match[1]), expectedSha)
}

export function selectGuideReviewEvidence(comments, expectedSha) {
  const newestFirst = [...comments].sort((a, b) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')))
  for (const comment of newestFirst) {
    if (!TRUSTED_COMMENT_ASSOCIATIONS.has(comment?.author_association)) continue
    try {
      const evidence = parseGuideReviewComment(comment?.body, expectedSha)
      if (evidence) return { evidence, comment }
    } catch {
      // Keep looking for the latest valid marker; malformed comments never pass.
    }
  }
  throw new Error('no trusted exact-SHA three-agent guide review comment exists for this candidate')
}

function latestStatus(statuses, context) {
  return statuses
    .filter((status) => status?.context === context)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0]
}

export function validateSourceReviewStatuses(statuses, expectedSha, guideEvidence = null) {
  const sha = requireFullCommit(expectedSha)
  const documentarian = latestStatus(statuses, DOCUMENTARIAN_CONTEXT)
  if (!documentarian || documentarian.state !== 'success' || !String(documentarian.description ?? '').includes(sha)) {
    throw new Error(`missing successful ${DOCUMENTARIAN_CONTEXT} status bound to ${sha}`)
  }
  if (!guideEvidence) return { documentarian, guideReview: null }

  const digest = guideReviewDigest(guideEvidence)
  const guideReview = latestStatus(statuses, GUIDE_REVIEW_CONTEXT)
  const description = String(guideReview?.description ?? '')
  if (!guideReview || guideReview.state !== 'success' || !description.includes(sha) || !description.includes(digest.slice(0, 12))) {
    throw new Error(`missing successful ${GUIDE_REVIEW_CONTEXT} status bound to the exact evidence digest`)
  }
  return { documentarian, guideReview }
}

export async function resolveTagToCommit(tag, request) {
  const ref = await request(`/git/ref/tags/${encodeURIComponent(tag)}`)
  let object = ref.object
  for (let depth = 0; depth < 8 && object?.type === 'tag'; depth += 1) {
    const annotated = await request(`/git/tags/${object.sha}`)
    object = annotated.object
  }
  if (object?.type !== 'commit') throw new Error(`tag ${tag} does not resolve to a commit`)
  return requireFullCommit(object.sha, `tag ${tag} target`)
}

export async function assertCandidateOnDefaultBranch(sha, request) {
  const repository = await request('')
  const defaultBranch = nonEmpty(repository.default_branch, 'repository default branch')
  const comparison = await request(`/compare/${sha}...${encodeURIComponent(defaultBranch)}`)
  if (comparison?.merge_base_commit?.sha?.toLowerCase() !== sha.toLowerCase()) {
    throw new Error(`release candidate ${sha} is not reachable from ${defaultBranch}`)
  }
  return defaultBranch
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`)
    const equals = arg.indexOf('=')
    if (equals > 2) {
      options[arg.slice(2, equals)] = arg.slice(equals + 1)
    } else {
      options[arg.slice(2)] = rest[index + 1]
      index += 1
    }
  }
  return { command, options }
}

function githubClient(repo, token, fetchImpl = fetch) {
  const repository = nonEmpty(repo, 'GitHub repository')
  const authToken = nonEmpty(token, 'GitHub token')
  return async (path, init = {}) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${authToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`)
    return response.status === 204 ? null : response.json()
  }
}

function writeOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  appendFileSync(outputPath, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
}

async function verifyCommand(options) {
  const repo = options.repo ?? process.env.GITHUB_REPOSITORY
  const tag = nonEmpty(options.tag, 'release tag')
  const request = githubClient(repo, process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN)
  const sha = await resolveTagToCommit(tag, request)
  const defaultBranch = await assertCandidateOnDefaultBranch(sha, request)
  const release = await request(`/releases/tags/${encodeURIComponent(tag)}`)
  const prerelease = release.prerelease === true
  const statusResponse = await request(`/commits/${sha}/status`)
  let guide = null
  let commentUrl = null
  if (!prerelease) {
    const comments = await request(`/commits/${sha}/comments?per_page=100`)
    const selected = selectGuideReviewEvidence(comments, sha)
    guide = selected.evidence
    commentUrl = selected.comment.html_url ?? null
  }
  validateSourceReviewStatuses(statusResponse.statuses ?? [], sha, guide)

  const result = { tag, candidateSha: sha, defaultBranch, prerelease, guideReviewCommentUrl: commentUrl }
  writeOutputs({ candidate_sha: sha, tag, prerelease: String(prerelease) })
  console.log(JSON.stringify(result, null, 2))
}

async function recordDocumentarianCommand(options) {
  const repo = options.repo ?? process.env.GITHUB_REPOSITORY
  const sha = requireFullCommit(options.sha)
  const verdict = nonEmpty(options.verdict, 'Documentarian verdict').toUpperCase()
  if (!['CLEAN', 'DRIFT'].includes(verdict)) throw new Error('Documentarian verdict must be CLEAN or DRIFT')
  const request = githubClient(repo, process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN)
  await request(`/statuses/${sha}`, {
    method: 'POST',
    body: JSON.stringify({
      state: verdict === 'CLEAN' ? 'success' : 'failure',
      context: DOCUMENTARIAN_CONTEXT,
      description: `Documentarian ${verdict} ${sha}`,
      ...(options['target-url'] ? { target_url: options['target-url'] } : {}),
    }),
  })
}

async function recordGuideCommand(options) {
  const repo = options.repo ?? process.env.GITHUB_REPOSITORY
  const sha = requireFullCommit(options.sha)
  const evidencePath = resolve(nonEmpty(options['evidence-file'], 'evidence file'))
  const evidence = validateGuideReviewEvidence(JSON.parse(readFileSync(evidencePath, 'utf8')), sha)
  const request = githubClient(repo, process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN)
  const comment = await request(`/commits/${sha}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: formatGuideReviewComment(evidence) }),
  })
  const digest = guideReviewDigest(evidence)
  await request(`/statuses/${sha}`, {
    method: 'POST',
    body: JSON.stringify({
      state: 'success',
      context: GUIDE_REVIEW_CONTEXT,
      description: `Guide review ${sha} ${digest.slice(0, 12)}`,
      target_url: comment.html_url,
    }),
  })
  console.log(JSON.stringify({ sha, digest, commentUrl: comment.html_url }, null, 2))
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (command === 'verify') return verifyCommand(options)
  if (command === 'record-documentarian') return recordDocumentarianCommand(options)
  if (command === 'record-guide') return recordGuideCommand(options)
  throw new Error('usage: release-review-gate.mjs <verify|record-documentarian|record-guide> [options]')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
