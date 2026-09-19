#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { decodePublicationPackage, validatePublicationPackage } from './fleetbot-publication.mjs'

export const ACTION_SCHEMA = 'port-daddy.fleetbot-action.v1'
export const CAPABILITY_SCHEMA = 'port-daddy.fleetbot-publisher-capability.v2'
export const GRANT_READ_SCHEMA = 'port-daddy.publisher-grant-read.v1'
export const RECEIPT_READ_SCHEMA = 'port-daddy.publisher-receipt-read.v1'
export const RECEIPT_SCHEMA = 'port-daddy.fleetbot-receipt.v2'
export const RECOVERY_MANIFEST_SCHEMA = 'port-daddy.fleetbot-recovery-manifest.v1'
export const DEFAULT_AUDIENCE = 'https://github.com/curiositech'
export const RECEIPT_RECOVERY_PATH = '/v1/fleetbot/publisher-receipts/recover'
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

function verifyDigestHex(publicKey, preimage, signatureHex) {
  return typeof signatureHex === 'string'
    && /^[0-9a-f]{128}$/i.test(signatureHex)
    && verify(null, Buffer.from(hashHex(preimage), 'hex'), publicKey, Buffer.from(signatureHex, 'hex'))
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
      || !receiptMatchesTarget(receipt, request)
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

/** New publication receives a new App commit and branch, not the local SHA. */
function receiptMatchesTarget(receipt, request) {
  if (request.operation !== 'pull-request.publish') {
    return receipt.resourceNumber === request.payload.pullRequestNumber
      && receipt.githubHeadSha === request.payload.expectedGithubHeadSha
      && receipt.publishedBranch === request.authorship?.sourceBranch
  }
  const name = request.authorship.agentId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44) || 'agent'
  const scope = hashHex(`${receipt.accountUserId}:${request.idempotencyKey}`).slice(0, 12)
  return receipt.appSlug === 'port-daddy'
    && typeof receipt.accountUserId === 'string' && receipt.accountUserId.length > 0
    && Number.isSafeInteger(receipt.resourceNumber) && receipt.resourceNumber > 0
    && receipt.resourceUrl === `https://github.com/${request.repository}/pull/${receipt.resourceNumber}`
    && receipt.sourceHeadSha === request.payload.sourceHeadSha
    && /^[0-9a-f]{40}$/.test(receipt.githubHeadSha ?? '')
    && receipt.publishedBranch === `pd-agent/${name}-${scope}`
}

function expectedReceiptResults(operation) {
  if (operation === 'pull-request.publish') return ['created', 'reused']
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

export function actionInputDigest(command, env) {
  return hashHex(stableJson({
    operation: command,
    pullRequest: env.FLEETBOT_PULL_REQUEST_NUMBER ?? '',
    commentBody: env.FLEETBOT_COMMENT_BODY ?? '',
    reviewCommentId: env.FLEETBOT_REVIEW_COMMENT_ID ?? '',
    reviewersJson: env.FLEETBOT_REVIEWERS_JSON ?? '[]',
    teamReviewersJson: env.FLEETBOT_TEAM_REVIEWERS_JSON ?? '[]',
    actorId: env.FLEETBOT_ACTOR_ID ?? 'github-actions',
    agentId: env.FLEETBOT_AGENT_ID ?? 'fleetbot-workload',
    sessionId: env.FLEETBOT_SESSION_ID ?? '',
    purpose: env.FLEETBOT_PURPOSE ?? `Perform ${command} through the protected Fleetbot workload.`,
    roadmapItem: env.FLEETBOT_ROADMAP_ITEM ?? '',
    sidequestReason: env.FLEETBOT_SIDEQUEST_REASON ?? '',
    worktreeId: env.FLEETBOT_WORKTREE_ID ?? '',
    // Bind the exact transported bytes, not a URL or a mutable artifact name.
    publicationPackage: env.FLEETBOT_PUBLICATION_PACKAGE ?? '',
  }))
}

export function buildRecoveryBinding(request) {
  return {
    grantId: request.capability.grantId,
    grantEpoch: request.capability.grantEpoch,
    repository: request.repository,
    operation: request.operation,
    baseBranch: request.capability.baseBranch,
    baseSha: request.capability.baseSha,
    headSha: request.capability.headSha,
    sessionId: request.sessionId,
    requestHash: request.capability.requestHash,
    idempotencyKey: request.idempotencyKey,
  }
}

function receiptVerificationRequest(request) {
  return {
    operation: request.operation,
    repository: request.repository,
    idempotencyKey: request.idempotencyKey,
    sessionId: request.sessionId,
    authorship: {
      actorId: request.authorship.actorId,
      agentId: request.authorship.agentId,
      roadmapItem: request.authorship.roadmapItem,
      sourceBranch: request.authorship.sourceBranch,
    },
    payload: {
      pullRequestNumber: request.payload.pullRequestNumber,
      expectedGithubHeadSha: request.payload.expectedGithubHeadSha,
      ...(request.operation === 'pull-request.publish' ? {
        sourceHeadSha: request.payload.sourceHeadSha,
        sourceTreeSha: request.payload.sourceTreeSha,
      } : {}),
    },
    capability: {
      grantId: request.capability.grantId,
      grantEpoch: request.capability.grantEpoch,
      baseBranch: request.capability.baseBranch,
      baseSha: request.capability.baseSha,
      headSha: request.capability.headSha,
      requestHash: request.capability.requestHash,
    },
  }
}

export function buildRecoveryManifest({ key, request, snapshot, repository, workflow, workflowRef, workflowSha, eventName, runId, command, pullRequestNumber, inputDigest, createdAt = Math.floor(Date.now() / 1000) }) {
  const unsigned = {
    schema: RECOVERY_MANIFEST_SCHEMA,
    repository,
    workflow: requireBoundedText(workflow, 'GITHUB_WORKFLOW', 255),
    workflowRef: requireBoundedText(workflowRef, 'GITHUB_WORKFLOW_REF', 1_024),
    workflowSha: requireHex(workflowSha, 20, 'GITHUB_SHA'),
    eventName: requireIdentifier(eventName, 'GITHUB_EVENT_NAME'),
    runId: requireIdentifier(runId, 'GITHUB_RUN_ID'),
    command,
    pullRequestNumber: request.operation === 'pull-request.publish'
      ? null : requirePositiveInteger(pullRequestNumber, 'FLEETBOT_PULL_REQUEST_NUMBER'),
    inputDigest: requireHex(inputDigest, 32, 'workflow input digest'),
    workloadFingerprint: key.fingerprint,
    signingKeyGeneration: snapshot.signingKeyGeneration,
    createdAt,
    binding: buildRecoveryBinding(request),
    receiptRequest: receiptVerificationRequest(request),
  }
  return { ...unsigned, manifestSignature: signDigestHex(key.privateKey, stableJson(unsigned)) }
}

export function verifyRecoveryManifest(manifest, { key, repository, workflow, workflowRef, workflowSha, eventName, runId, command, pullRequestNumber, inputDigest }) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Fleetbot recovery manifest is malformed')
  const { manifestSignature, ...unsigned } = manifest
  if (manifest.schema !== RECOVERY_MANIFEST_SCHEMA
      || manifest.repository !== repository
      || manifest.workflow !== workflow
      || manifest.workflowRef !== workflowRef
      || manifest.workflowSha !== workflowSha
      || manifest.eventName !== eventName
      || manifest.runId !== runId
      || manifest.command !== command
      || manifest.pullRequestNumber !== pullRequestNumber
      || manifest.inputDigest !== inputDigest
      || manifest.workloadFingerprint !== key.fingerprint
      || !Number.isSafeInteger(manifest.signingKeyGeneration)
      || !verifyDigestHex(createPublicKey(key.privateKey), stableJson(unsigned), manifestSignature)) {
    throw new Error('Fleetbot recovery manifest does not match this immutable workflow invocation')
  }
  if (stableJson(manifest.binding) !== stableJson(buildRecoveryBinding(manifest.receiptRequest))
      || manifest.receiptRequest.repository !== repository
      || (manifest.receiptRequest.payload?.pullRequestNumber ?? null) !== pullRequestNumber) {
    throw new Error('Fleetbot recovery manifest binding does not match its publish request')
  }
  return manifest
}

/** Verify an original-run artifact from a distinct protected recovery run. */
export function verifyRecoveryManifestForRecovery(manifest, { key, repository, workflow, runId }) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Fleetbot recovery manifest is malformed')
  const { manifestSignature, ...unsigned } = manifest
  if (manifest.schema !== RECOVERY_MANIFEST_SCHEMA
      || manifest.repository !== repository
      || manifest.workflow !== workflow
      || manifest.runId !== runId
      || manifest.workloadFingerprint !== key.fingerprint
      || !Number.isSafeInteger(manifest.signingKeyGeneration)
      || !verifyDigestHex(createPublicKey(key.privateKey), stableJson(unsigned), manifestSignature)) {
    throw new Error('Fleetbot recovery manifest does not match the selected source run')
  }
  if (stableJson(manifest.binding) !== stableJson(buildRecoveryBinding(manifest.receiptRequest))
      || manifest.receiptRequest.repository !== repository
      || (manifest.receiptRequest.payload?.pullRequestNumber ?? null) !== manifest.pullRequestNumber) {
    throw new Error('Fleetbot recovery manifest binding does not match its publish request')
  }
  return manifest
}

export function buildReceiptRecoveryEnvelope({ key, manifest, now = Math.floor(Date.now() / 1000), nonce = randomBytes(32).toString('hex') }) {
  const proof = {
    schema: RECEIPT_READ_SCHEMA,
    method: 'POST',
    path: RECEIPT_RECOVERY_PATH,
    daemonFingerprint: key.fingerprint,
    signingKeyGeneration: manifest.signingKeyGeneration,
    issuedAt: now,
    nonce: requireHex(nonce, 32, 'receipt-read nonce'),
    binding: manifest.binding,
  }
  return { proof, proofSignature: signDigestHex(key.privateKey, stableJson(proof)) }
}

export async function recoverPublisherReceipt({ relayUrl, key, manifest, expectedRelayPublicKey, fetchImpl = fetch, now, nonce }) {
  const recoveryEnvelope = buildReceiptRecoveryEnvelope({ key, manifest, now, nonce })
  const envelope = await jsonFetch(new URL(RECEIPT_RECOVERY_PATH, relayUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recoveryEnvelope),
  }, fetchImpl)
  return verifyPublisherReceiptEnvelope(envelope, {
    request: manifest.receiptRequest,
    snapshot: { grantId: manifest.binding.grantId, grantEpoch: manifest.binding.grantEpoch },
    expectedRelayPublicKey,
  })
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

/** Sign a data-only source package with the existing protected workload identity. */
export function buildPublishRequest({ publicationPackage, ...options }) {
  const publication = validatePublicationPackage(publicationPackage)
  if (publication.repository !== options.repository) throw new Error('Publication repository does not match the workload repository')
  if (!options.snapshot?.baseBranches?.includes(publication.payload.baseBranch)) throw new Error('Publisher grant does not authorize the publication base branch')
  // Current Relay tokens omit workflows:write. No workload input may assert
  // that permission; its future admission requires a separately reviewed proof.
  if (publication.payload.changes.some(change => change.path.startsWith('.github/workflows/'))) {
    throw new Error('Workflow-file publication requires verified protected Workflows write authority; current Relay publication cannot dispatch this package')
  }
  const a = options.authorship
  const trailers = [...publication.payload.body.matchAll(/^Roadmap-Item\s*:\s*(.+)$/gim)].map(m => m[1].trim())
  const expectedTrailer = a?.roadmapItem || `none — ${a?.sidequestReason}`
  if (trailers.length !== 1 || trailers[0] !== expectedTrailer) throw new Error('Publication roadmap trailer does not match its authorship')
  // Reuse one canonical authority/signature builder; the synthetic PR selector
  // is removed before the publication preimage is signed.
  const request = buildExistingRequest({
    ...options,
    operation: 'pull-request.publish',
    pullRequest: { base: { ref: publication.payload.baseBranch, sha: publication.payload.baseSha }, head: { ref: publication.sourceBranch, sha: publication.payload.sourceHeadSha } },
  })
  request.payload = publication.payload
  const unsigned = { schema: request.schema, operation: request.operation, repository: request.repository, payload: request.payload, sessionId: request.sessionId, authorship: request.authorship }
  const requestHash = hashHex(stableJson(unsigned))
  request.idempotencyKey = `pd-gh-${requestHash}`
  request.capability.requestHash = requestHash
  request.capabilitySignature = signDigestHex(options.key.privateKey, stableJson(request.capability))
  return request
}

/** Read the created PR and commit using a read-only token; never retry a write. */
export async function verifyPublicationReadback({ request, receipt, token, fetchImpl = fetch }) {
  const pull = await githubPullRequest({ repository: request.repository, number: receipt.resourceNumber, token, fetchImpl })
  const commit = await jsonFetch(`https://api.github.com/repos/${request.repository}/git/commits/${receipt.githubHeadSha}`, { headers: githubReadHeaders(token) }, fetchImpl)
  if (pull.number !== receipt.resourceNumber || pull.html_url !== receipt.resourceUrl
      || pull.state !== 'open' || pull.draft !== false
      || pull.user?.login !== 'port-daddy[bot]'
      || pull.head?.repo?.full_name?.toLowerCase() !== request.repository
      || pull.base?.repo?.full_name?.toLowerCase() !== request.repository
      || pull.head?.ref !== receipt.publishedBranch || pull.head?.sha !== receipt.githubHeadSha
      || pull.base?.ref !== request.payload.baseBranch || pull.base?.sha !== request.payload.baseSha
      || pull.title !== request.payload.title
      || !pull.body?.includes(`<!-- port-daddy:fleetbot-mutation:${receipt.receiptId.toLowerCase()} -->`)
      || commit.sha !== receipt.githubHeadSha || commit.tree?.sha !== request.payload.sourceTreeSha
      || commit.parents?.length !== 1 || commit.parents[0].sha !== request.payload.baseSha) {
    throw new Error('Published PR/commit did not read back at the exact approved source tree; recover the receipt, never retry publication')
  }
  return receipt
}

function githubReadHeaders(token) {
  if (!token) throw new Error('A read-only Actions token is required for provider readback')
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'port-daddy-fleetbot-workload' }
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
  const commands = ['enroll', 'inspect', 'comment', 'review-reply', 'ready', 'request-reviewers', 'enqueue', 'prepare', 'publish-manifest', 'recover-manifest']
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
  const manifestPath = env.FLEETBOT_MANIFEST_PATH ?? 'fleetbot-recovery-manifest.json'
  const requestPath = env.FLEETBOT_REQUEST_PATH ?? 'fleetbot-publish-request.json'
  const workflow = env.GITHUB_WORKFLOW ?? 'Fleetbot actuator'
  if (command === 'recover-manifest') {
    const sourceRunId = requireIdentifier(env.FLEETBOT_SOURCE_RUN_ID, 'FLEETBOT_SOURCE_RUN_ID')
    const sourceWorkflow = requireBoundedText(
      env.FLEETBOT_SOURCE_WORKFLOW ?? 'Fleetbot actuator',
      'FLEETBOT_SOURCE_WORKFLOW',
      255,
    )
    const manifest = verifyRecoveryManifestForRecovery(JSON.parse(readFileSync(manifestPath, 'utf8')), {
      key,
      repository,
      workflow: sourceWorkflow,
      runId: sourceRunId,
    })
    const receipt = await recoverPublisherReceipt({
      relayUrl,
      key,
      manifest,
      expectedRelayPublicKey: env.FLEETBOT_RELAY_PUBLIC_KEY_HEX,
    })
    console.log(`Recovered Relay receipt: ${receipt.receiptId}`)
    return
  }
  const usesRecoveryManifest = command === 'prepare' || command === 'publish-manifest'
  const workflowRef = usesRecoveryManifest
    ? requireBoundedText(env.GITHUB_WORKFLOW_REF, 'GITHUB_WORKFLOW_REF', 1_024)
    : ''
  const workflowSha = usesRecoveryManifest ? requireHex(env.GITHUB_SHA, 20, 'GITHUB_SHA') : ''
  const eventName = usesRecoveryManifest ? requireIdentifier(env.GITHUB_EVENT_NAME, 'GITHUB_EVENT_NAME') : ''
  const runId = requireIdentifier(env.GITHUB_RUN_ID, 'GITHUB_RUN_ID')
  const dispatchedCommand = env.FLEETBOT_OPERATION ?? command
  const publishing = dispatchedCommand === 'publish'
  if (publishing && (!usesRecoveryManifest || env.GITHUB_RUN_ATTEMPT !== '1'
      || env.GITHUB_REF !== 'refs/heads/main' || eventName !== 'workflow_dispatch'
      || workflowRef !== `${repository}/.github/workflows/fleetbot-actuator.yml@refs/heads/main`)) {
    throw new Error('Publication requires the first attempt of the protected main workflow; recover lost responses without rerunning')
  }
  const prNumber = publishing ? null : requirePositiveInteger(Number(env.FLEETBOT_PULL_REQUEST_NUMBER), 'FLEETBOT_PULL_REQUEST_NUMBER')
  if (publishing && env.FLEETBOT_PULL_REQUEST_NUMBER) throw new Error('New publication must not select an existing PR')
  if (publishing) {
    requireHex(env.FLEETBOT_RELAY_PUBLIC_KEY_HEX, 32, 'FLEETBOT_RELAY_PUBLIC_KEY_HEX')
    githubReadHeaders(env.GITHUB_TOKEN)
  }
  const inputDigest = actionInputDigest(dispatchedCommand, env)
  if (command === 'publish-manifest') {
    const manifest = verifyRecoveryManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), {
      key,
      repository,
      workflow,
      workflowRef,
      workflowSha,
      eventName,
      runId,
      command: dispatchedCommand,
      pullRequestNumber: prNumber,
      inputDigest,
    })
    const publishRequest = JSON.parse(readFileSync(requestPath, 'utf8'))
    const requestHash = hashHex(stableJson({
      schema: publishRequest.schema,
      operation: publishRequest.operation,
      repository: publishRequest.repository,
      payload: publishRequest.payload,
      sessionId: publishRequest.sessionId,
      authorship: publishRequest.authorship,
    }))
    if (stableJson(buildRecoveryBinding(publishRequest)) !== stableJson(manifest.binding)
        || stableJson(receiptVerificationRequest(publishRequest)) !== stableJson(manifest.receiptRequest)
        || requestHash !== publishRequest.capability?.requestHash
        || publishRequest.idempotencyKey !== `pd-gh-${requestHash}`) {
      throw new Error('Fleetbot publish request does not match the uploaded recovery manifest')
    }
    const envelope = await jsonFetch(new URL('/v1/fleetbot/publish', relayUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(publishRequest),
    })
    const receipt = verifyPublisherReceiptEnvelope(envelope, {
      request: publishRequest,
      snapshot: { grantId: manifest.binding.grantId, grantEpoch: manifest.binding.grantEpoch },
      expectedRelayPublicKey: env.FLEETBOT_RELAY_PUBLIC_KEY_HEX,
    })
    if (publishing) await verifyPublicationReadback({ request: publishRequest, receipt, token: env.GITHUB_TOKEN })
    console.log(`Relay receipt: ${receipt.receiptId}`)
    if (publishing) console.log(`Published ${receipt.resourceUrl} at ${receipt.githubHeadSha} (source tree ${publishRequest.payload.sourceTreeSha}).`)
    return
  }
  const grantId = env.FLEETBOT_PUBLISHER_GRANT_ID
  const snapshot = await readGrantSnapshot({ relayUrl, key, grantId })
  const publicationPackage = publishing ? decodePublicationPackage(env.FLEETBOT_PUBLICATION_PACKAGE) : null
  if (publishing) {
    if (publicationPackage.repository !== repository) throw new Error('Publication repository does not match the workload repository')
    const base = await jsonFetch(`https://api.github.com/repos/${repository}/git/ref/heads/${encodeURIComponent(publicationPackage.payload.baseBranch)}`, { headers: githubReadHeaders(env.GITHUB_TOKEN) })
    if (base.object?.sha !== publicationPackage.payload.baseSha) throw new Error('Publication base moved; rebuild the package from the current base')
  }
  const pullRequest = publishing ? null : await githubPullRequest({ repository, number: prNumber, token: env.GITHUB_TOKEN })
  const common = {
    key,
    snapshot,
    repository,
    pullRequest,
    runId,
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
    publish: () => buildPublishRequest({ ...common, authorship, publicationPackage }),
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
  const requestBuilder = builders[command === 'prepare' ? dispatchedCommand : command]
  if (!requestBuilder) throw new Error('FLEETBOT_OPERATION is not a publishable Fleetbot operation')
  const request = requestBuilder()
  if (command === 'prepare') {
    const manifest = buildRecoveryManifest({
      key,
      request,
      snapshot,
      repository,
      workflow,
      workflowRef,
      workflowSha,
      eventName,
      runId,
      command: dispatchedCommand,
      pullRequestNumber: prNumber,
      inputDigest,
    })
    writeFileSync(manifestPath, `${stableJson(manifest)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    writeFileSync(requestPath, `${stableJson(request)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    console.log(`Prepared immutable Fleetbot recovery manifest for ${request.operation}${publishing ? ` from source ${request.payload.sourceHeadSha}` : ` on PR #${prNumber}`}.`)
    return
  }
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
