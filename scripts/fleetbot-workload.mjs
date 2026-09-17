#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto'
import { appendFileSync } from 'node:fs'

export const ACTION_SCHEMA = 'port-daddy.fleetbot-action.v1'
export const CAPABILITY_SCHEMA = 'port-daddy.fleetbot-publisher-capability.v2'
export const GRANT_READ_SCHEMA = 'port-daddy.publisher-grant-read.v1'
export const RECEIPT_SCHEMA = 'port-daddy.fleetbot-receipt.v2'
export const DEFAULT_AUDIENCE = 'https://github.com/curiositech'
const MAX_BODY_BYTES = 1_000_000
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/

export function stableJson(value) {
  function normalize(input) {
    if (Array.isArray(input)) return input.map(normalize)
    if (!input || typeof input !== 'object') return input
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    )
  }
  return JSON.stringify(normalize(value))
}

export function hashHex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function requireHex(value, bytes, name) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(value)) {
    throw new Error(`${name} must be exactly ${bytes} bytes of hex`)
  }
  return value.toLowerCase()
}

export function workloadKey(seedHex) {
  const seed = Buffer.from(requireHex(seedHex, 32, 'FLEETBOT_WORKLOAD_PRIVATE_KEY_HEX'), 'hex')
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex')
  const privateKey = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, seed]), format: 'der', type: 'pkcs8' })
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  const publicKeyHex = Buffer.from(spki).subarray(-32).toString('hex')
  return { privateKey, publicKeyHex, fingerprint: hashHex(Buffer.from(publicKeyHex, 'hex')) }
}

export function signDigestHex(privateKey, preimage) {
  const digest = createHash('sha256').update(preimage).digest()
  return sign(null, digest, privateKey).toString('hex')
}

function ed25519PublicKey(publicKeyHex) {
  const raw = Buffer.from(requireHex(publicKeyHex, 32, 'Relay receipt public key'), 'hex')
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex')
  return createPublicKey({ key: Buffer.concat([spkiPrefix, raw]), format: 'der', type: 'spki' })
}

export function verifyPublisherReceiptEnvelope(body, { request, snapshot, expectedRelayPublicKey }) {
  const trustedRelayPublicKey = requireHex(expectedRelayPublicKey, 32, 'FLEETBOT_RELAY_PUBLIC_KEY_HEX')
  const expectedReceiptId = `github_receipt_${request.idempotencyKey.slice('pd-gh-'.length, 'pd-gh-'.length + 32)}`
  const receipt = body && typeof body === 'object' && body.code === 'OK' ? body.receipt : null
  if (!receipt || typeof receipt !== 'object'
      || receipt.schema !== RECEIPT_SCHEMA
      || receipt.authority !== 'port-daddy-relay-github-app'
      || receipt.operation !== request.operation
      || receipt.repository !== request.repository
      || receipt.idempotencyKey !== request.idempotencyKey
      || receipt.sessionId !== request.sessionId
      || receipt.actorId !== request.authorship?.actorId
      || receipt.agentId !== request.authorship?.agentId
      || receipt.roadmapItem !== request.authorship?.roadmapItem
      || receipt.authorizedBy?.grantId !== snapshot.grantId
      || receipt.authorizedBy?.grantEpoch !== snapshot.grantEpoch
      || receipt.authorizedBy?.surface !== 'publisher'
      || receipt.admission !== 'standing-publisher-grant'
      || !expectedReceiptResults(request.operation).includes(receipt.result)
      || receipt.resourceNumber !== request.payload.pullRequestNumber
      || receipt.githubHeadSha !== request.payload.expectedGithubHeadSha
      || receipt.publishedBranch !== request.authorship?.sourceBranch
      || receipt.tokenCleanup !== 'confirmed'
      || receipt.relayPublicKey !== trustedRelayPublicKey
      || receipt.receiptId !== expectedReceiptId
      || typeof receipt.signature !== 'string'
      || !/^[0-9a-f]{128}$/i.test(receipt.signature)) {
    throw new Error('Relay returned a publisher receipt outside the requested authority scope')
  }
  const { signature, ...unsigned } = receipt
  const digest = Buffer.from(hashHex(stableJson(unsigned)), 'hex')
  if (!verify(null, digest, ed25519PublicKey(receipt.relayPublicKey), Buffer.from(signature, 'hex'))) {
    throw new Error('Relay publisher receipt signature is invalid')
  }
  return receipt
}

function expectedReceiptResults(operation) {
  if (operation === 'pull-request.inspect') return ['observed']
  if (operation === 'pull-request.comment' || operation === 'pull-request.review-reply') return ['created', 'reused']
  if (operation === 'pull-request.ready'
      || operation === 'pull-request.request-reviewers'
      || operation === 'pull-request.enqueue') return ['updated', 'reused']
  return []
}

async function jsonFetch(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'error', ...options })
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = { error: text } }
  if (!response.ok) {
    const code = body && typeof body.code === 'string' ? ` ${body.code}` : ''
    throw new Error(`${options.method ?? 'GET'} ${new URL(url).pathname} failed (${response.status}${code})`)
  }
  return body
}

export async function githubOidcToken({ requestUrl, requestToken, audience = DEFAULT_AUDIENCE, fetchImpl = fetch }) {
  if (!requestUrl || !requestToken) throw new Error('GitHub Actions OIDC is unavailable; id-token: write is required')
  const url = new URL(requestUrl)
  url.searchParams.set('audience', audience)
  const body = await jsonFetch(url, { headers: { Authorization: `Bearer ${requestToken}` } }, fetchImpl)
  if (!body || typeof body.value !== 'string' || body.value.split('.').length !== 3) {
    throw new Error('GitHub Actions returned a malformed OIDC token')
  }
  return body.value
}

export async function enrollWorkload({ relayUrl, oidcToken, key, fetchImpl = fetch }) {
  return jsonFetch(new URL('/v1/exchange', relayUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oidc_token: oidcToken, pub_key: key.publicKeyHex, cap: [] }),
  }, fetchImpl)
}

export function grantReadHeaders({ key, grantId, now = Math.floor(Date.now() / 1000), nonce = randomBytes(32).toString('hex') }) {
  if (!/^pdg_[0-9a-f]{32}$/.test(grantId)) throw new Error('FLEETBOT_PUBLISHER_GRANT_ID is malformed')
  const path = `/v1/fleetbot/publisher-grants/${grantId}`
  const preimage = stableJson({
    schema: GRANT_READ_SCHEMA,
    method: 'GET',
    path,
    fingerprint: key.fingerprint,
    issuedAt: now,
    nonce: requireHex(nonce, 32, 'grant-read nonce'),
  })
  return {
    path,
    headers: {
      'X-PD-Workload-Fingerprint': key.fingerprint,
      'X-PD-Workload-Issued-At': String(now),
      'X-PD-Workload-Nonce': nonce,
      'X-PD-Workload-Signature': signDigestHex(key.privateKey, preimage),
    },
  }
}

export async function readGrantSnapshot({ relayUrl, key, grantId, fetchImpl = fetch }) {
  const signed = grantReadHeaders({ key, grantId })
  const body = await jsonFetch(new URL(signed.path, relayUrl), { headers: signed.headers }, fetchImpl)
  if (body?.schema !== 'port-daddy.publisher-grant-snapshot.v1'
      || body.grantId !== grantId
      || !Number.isSafeInteger(body.grantEpoch)
      || !Number.isSafeInteger(body.signingKeyGeneration)) {
    throw new Error('Relay returned a malformed publisher grant snapshot')
  }
  return body
}

function requireIdentifier(value, name) {
  if (typeof value !== 'string' || !IDENTIFIER_RE.test(value)) {
    throw new Error(`${name} is missing or malformed`)
  }
  return value
}

function requireBoundedText(value, name, maxBytes) {
  if (typeof value !== 'string' || value.trim().length === 0 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${name} must be non-empty and at most ${maxBytes} UTF-8 bytes`)
  }
  return value
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function requireReviewerNames(value, name) {
  if (!Array.isArray(value) || value.length > 20 || value.some((entry) => typeof entry !== 'string' || !IDENTIFIER_RE.test(entry))) {
    throw new Error(`${name} must be an array of at most 20 safe identifiers`)
  }
  return [...new Set(value.map((entry) => entry.toLowerCase()))].sort()
}

export function parseReviewerJson(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} must be a JSON array`)
  let parsed
  try { parsed = JSON.parse(value) } catch { throw new Error(`${name} must be a JSON array`) }
  return requireReviewerNames(parsed, name)
}

function buildExistingRequest({
  key,
  snapshot,
  repository,
  pullRequest,
  operation,
  payload = {},
  authorship,
  runId,
  runAttempt,
  now = Math.floor(Date.now() / 1000),
  nonce = randomBytes(32).toString('hex'),
}) {
  if (!Array.isArray(snapshot.operations) || !snapshot.operations.includes(operation)) {
    throw new Error(`Grant ${snapshot.grantId} does not authorize ${operation}`)
  }
  if (!Array.isArray(snapshot.repositories) || !snapshot.repositories.includes(repository)) {
    throw new Error(`Grant ${snapshot.grantId} does not authorize ${repository}`)
  }
  const sessionId = requireIdentifier(authorship?.sessionId ?? `gha-${runId}-${runAttempt}`, 'authorship.sessionId')
  const roadmapItem = authorship?.roadmapItem ?? null
  const sidequestReason = authorship && Object.hasOwn(authorship, 'sidequestReason')
    ? authorship.sidequestReason
    : (roadmapItem ? null : 'Protected workload actuator operation')
  if ((roadmapItem === null) === (sidequestReason === null)) {
    throw new Error('authorship requires exactly one roadmap item or sidequest reason')
  }
  const request = {
    schema: ACTION_SCHEMA,
    operation,
    repository,
    payload: {
      ...payload,
      baseBranch: pullRequest.base.ref,
      baseSha: pullRequest.base.sha,
      pullRequestNumber: pullRequest.number,
      expectedGithubHeadSha: pullRequest.head.sha,
    },
    sessionId,
    authorship: {
      actorId: requireIdentifier(authorship?.actorId ?? 'github-actions', 'authorship.actorId'),
      agentId: requireIdentifier(authorship?.agentId ?? 'fleetbot-workload', 'authorship.agentId'),
      sessionId,
      purpose: requireBoundedText(authorship?.purpose ?? 'Exercise the standing publisher grant through the protected workload.', 'authorship.purpose', 2_000),
      identityProject: repository,
      roadmapItem: roadmapItem === null ? null : requireIdentifier(roadmapItem, 'authorship.roadmapItem'),
      sidequestReason: sidequestReason === null ? null : requireBoundedText(sidequestReason, 'authorship.sidequestReason', 1_000),
      worktreeId: authorship?.worktreeId ? requireIdentifier(authorship.worktreeId, 'authorship.worktreeId') : null,
      sourceBranch: pullRequest.head.ref,
    },
  }
  const requestHash = hashHex(stableJson(request))
  request.idempotencyKey = `pd-gh-${requestHash}`
  const capability = {
    schema: CAPABILITY_SCHEMA,
    grantId: snapshot.grantId,
    grantEpoch: snapshot.grantEpoch,
    daemonFingerprint: key.fingerprint,
    signingKeyGeneration: snapshot.signingKeyGeneration,
    sessionId,
    repository,
    operation,
    baseBranch: pullRequest.base.ref,
    baseSha: pullRequest.base.sha,
    headSha: pullRequest.head.sha,
    requestHash,
    issuedAt: now,
    expiresAt: now + 180,
    nonce: requireHex(nonce, 32, 'publisher nonce'),
  }
  request.capability = capability
  request.capabilitySignature = signDigestHex(key.privateKey, stableJson(capability))
  return request
}

export function buildInspectRequest(options) {
  return buildExistingRequest({
    ...options,
    operation: 'pull-request.inspect',
    authorship: {
      purpose: 'Verify the standing publisher grant with a read-only pull request inspection.',
      sidequestReason: 'Protected workload identity and publisher grant smoke test',
      ...options.authorship,
    },
  })
}

export function buildCommentRequest({ body, ...options }) {
  return buildExistingRequest({
    ...options,
    operation: 'pull-request.comment',
    payload: { body: requireBoundedText(body, 'FLEETBOT_COMMENT_BODY', MAX_BODY_BYTES) },
  })
}

export function buildReviewReplyRequest({ body, commentId, ...options }) {
  return buildExistingRequest({
    ...options,
    operation: 'pull-request.review-reply',
    payload: {
      body: requireBoundedText(body, 'FLEETBOT_COMMENT_BODY', MAX_BODY_BYTES),
      commentId: requirePositiveInteger(commentId, 'FLEETBOT_REVIEW_COMMENT_ID'),
    },
  })
}

export function buildReadyRequest(options) {
  return buildExistingRequest({ ...options, operation: 'pull-request.ready' })
}

export function buildRequestReviewersRequest({ reviewers, teamReviewers, ...options }) {
  const parsedReviewers = requireReviewerNames(reviewers, 'FLEETBOT_REVIEWERS_JSON')
  const parsedTeamReviewers = requireReviewerNames(teamReviewers, 'FLEETBOT_TEAM_REVIEWERS_JSON')
  if (parsedReviewers.length + parsedTeamReviewers.length === 0) {
    throw new Error('at least one reviewer or team reviewer is required')
  }
  return buildExistingRequest({
    ...options,
    operation: 'pull-request.request-reviewers',
    payload: { reviewers: parsedReviewers, teamReviewers: parsedTeamReviewers },
  })
}

export function buildEnqueueRequest(options) {
  return buildExistingRequest({ ...options, operation: 'pull-request.enqueue' })
}

async function githubPullRequest({ repository, number, token, fetchImpl = fetch }) {
  return jsonFetch(`https://api.github.com/repos/${repository}/pulls/${number}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'port-daddy-fleetbot-workload',
    },
  }, fetchImpl)
}

function appendOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8')
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0]
  const commands = ['enroll', 'inspect', 'comment', 'review-reply', 'ready', 'request-reviewers', 'enqueue']
  if (!commands.includes(command)) throw new Error(`usage: fleetbot-workload.mjs <${commands.join('|')}>`)
  const relayUrl = env.FLEETBOT_RELAY_URL ?? 'https://relay.portdaddy.dev'
  const repository = (env.GITHUB_REPOSITORY ?? '').toLowerCase()
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is missing or malformed')
  const key = workloadKey(env.FLEETBOT_WORKLOAD_PRIVATE_KEY_HEX)
  appendOutput('workload_fingerprint', key.fingerprint)
  if (command === 'enroll') {
    const oidcToken = await githubOidcToken({
      requestUrl: env.ACTIONS_ID_TOKEN_REQUEST_URL,
      requestToken: env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      audience: env.FLEETBOT_OIDC_AUDIENCE ?? DEFAULT_AUDIENCE,
    })
    await enrollWorkload({ relayUrl, oidcToken, key })
    console.log(`Workload enrolled for ${repository}. Fingerprint: ${key.fingerprint}`)
    console.log('An account administrator must now create a bounded publisher grant in Relay Ship controls.')
    return
  }
  const grantId = env.FLEETBOT_PUBLISHER_GRANT_ID
  const prNumber = requirePositiveInteger(Number(env.FLEETBOT_PULL_REQUEST_NUMBER), 'FLEETBOT_PULL_REQUEST_NUMBER')
  const snapshot = await readGrantSnapshot({ relayUrl, key, grantId })
  const pullRequest = await githubPullRequest({ repository, number: prNumber, token: env.GITHUB_TOKEN })
  const common = {
    key,
    snapshot,
    repository,
    pullRequest,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? '1',
  }
  const authorship = {
    actorId: env.FLEETBOT_ACTOR_ID ?? 'github-actions',
    agentId: env.FLEETBOT_AGENT_ID ?? 'fleetbot-workload',
    sessionId: env.FLEETBOT_SESSION_ID,
    purpose: env.FLEETBOT_PURPOSE ?? `Perform ${command} through the protected Fleetbot workload.`,
    roadmapItem: env.FLEETBOT_ROADMAP_ITEM || null,
    sidequestReason: env.FLEETBOT_ROADMAP_ITEM ? null : (env.FLEETBOT_SIDEQUEST_REASON ?? `Protected Fleetbot ${command} requested without a linked roadmap item`),
    worktreeId: env.FLEETBOT_WORKTREE_ID || null,
  }
  const builders = {
    inspect: () => buildInspectRequest(common),
    comment: () => buildCommentRequest({ ...common, authorship, body: env.FLEETBOT_COMMENT_BODY }),
    'review-reply': () => buildReviewReplyRequest({
      ...common,
      authorship,
      body: env.FLEETBOT_COMMENT_BODY,
      commentId: Number(env.FLEETBOT_REVIEW_COMMENT_ID),
    }),
    ready: () => buildReadyRequest({ ...common, authorship }),
    'request-reviewers': () => buildRequestReviewersRequest({
      ...common,
      authorship,
      reviewers: parseReviewerJson(env.FLEETBOT_REVIEWERS_JSON ?? '[]', 'FLEETBOT_REVIEWERS_JSON'),
      teamReviewers: parseReviewerJson(env.FLEETBOT_TEAM_REVIEWERS_JSON ?? '[]', 'FLEETBOT_TEAM_REVIEWERS_JSON'),
    }),
    enqueue: () => buildEnqueueRequest({ ...common, authorship }),
  }
  const request = builders[command]()
  const envelope = await jsonFetch(new URL('/v1/fleetbot/publish', relayUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  const receipt = verifyPublisherReceiptEnvelope(envelope, {
    request,
    snapshot,
    expectedRelayPublicKey: env.FLEETBOT_RELAY_PUBLIC_KEY_HEX,
  })
  console.log(`Publisher grant ${snapshot.grantId} epoch ${snapshot.grantEpoch} completed ${request.operation} on PR #${prNumber}.`)
  console.log(`Relay receipt: ${receipt.receiptId}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
