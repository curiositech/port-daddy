import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  decodePublicationPackage,
  encodePublicationPackage,
} from './fleetbot-publication.mjs'
import {
  actionInputDigest,
  buildPublishRequest,
  buildRecoveryManifest,
  buildReceiptRecoveryEnvelope,
  hashHex,
  main,
  recoverPublisherReceipt,
  signDigestHex,
  stableJson,
  verifyPublicationSourceTree,
  verifyPublicationReadback,
  verifyPublisherReceiptEnvelope,
  workloadKey,
} from './fleetbot-workload.mjs'

const repository = 'curiositech/port-daddy'
const sourceBaseSha = '1'.repeat(40)
const sourceHeadSha = '2'.repeat(40)
const emptyTreeSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const relayKey = workloadKey('27'.repeat(32))
const workloadPrivateKeyHex = '19'.repeat(32)
const grantId = `pdg_${'ab'.repeat(16)}`
const scratch = []

function gitBlobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

function gitTreeSha(entries) {
  const body = Buffer.concat(entries
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(entry => Buffer.concat([Buffer.from(`${entry.mode === '040000' ? '40000' : entry.mode} ${entry.path}\0`), Buffer.from(entry.sha, 'hex')])))
  return createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex')
}

const publishedBytes = Buffer.from('published\n')
const publishedBlobSha = gitBlobSha(publishedBytes)
const sourceTreeSha = gitTreeSha([{ mode: '100644', path: 'README.md', sha: publishedBlobSha }])

function gitTreeResponse(sha, entries) {
  return response({ sha, truncated: false, tree: entries })
}

function publicationPackage(overrides = {}) {
  return {
    schema: 'port-daddy.fleetbot-publication.v1',
    repository,
    sourceBranch: 'codex/publication-flow',
    payload: {
      baseBranch: 'main',
      baseSha: sourceBaseSha,
      sourceHeadSha,
      sourceTreeSha,
      sourceCommittedAt: 1_700_000_000,
      commitMessage: 'publish the reviewed source tree',
      changes: [{ path: 'README.md', mode: '100644', contentBase64: publishedBytes.toString('base64') }],
      title: 'Reviewed publication',
      body: 'A reviewed publication.\n\nRoadmap-Item: fleetbot-pr-authorship',
      draft: false,
    },
    ...overrides,
  }
}

function snapshot(operations = ['pull-request.publish']) {
  return {
    grantId,
    grantEpoch: 8,
    signingKeyGeneration: 4,
    repositories: [repository],
    baseBranches: ['main'],
    operations,
  }
}

function requestFor(publication = publicationPackage(), options = {}) {
  return buildPublishRequest({
    key: workloadKey(workloadPrivateKeyHex),
    snapshot: snapshot(),
    repository,
    publicationPackage: publication,
    runId: '123',
    runAttempt: '1',
    now: 2_000_000_000,
    nonce: 'ef'.repeat(32),
    authorship: {
      actorId: 'github-user:42',
      agentId: 'Admiral/Reviewer',
      sessionId: 'gha-publication-1',
      purpose: 'Publish the reviewed source package.',
      roadmapItem: 'fleetbot-pr-authorship',
      sidequestReason: null,
      ...options.authorship,
    },
  })
}

function signedReceipt(request, overrides = {}) {
  const accountUserId = overrides.accountUserId ?? 'account-user-42'
  const agent = request.authorship.agentId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 44) || 'agent'
  const scope = hashHex(`${accountUserId}:${request.idempotencyKey}`).slice(0, 12)
  const resourceNumber = overrides.resourceNumber ?? 10401
  const githubHeadSha = overrides.githubHeadSha ?? '4'.repeat(40)
  const unsigned = {
    schema: 'port-daddy.fleetbot-receipt.v2',
    receiptId: `github_receipt_${request.idempotencyKey.slice('pd-gh-'.length, 'pd-gh-'.length + 32)}`,
    authority: 'port-daddy-relay-github-app',
    appSlug: 'port-daddy',
    operation: request.operation,
    repository: request.repository,
    idempotencyKey: request.idempotencyKey,
    accountUserId,
    accountGithubUserId: 42,
    authorizedBy: { grantId, grantEpoch: 8, surface: 'publisher' },
    admission: 'standing-publisher-grant',
    actorId: request.authorship.actorId,
    agentId: request.authorship.agentId,
    sessionId: request.sessionId,
    roadmapItem: request.authorship.roadmapItem,
    resourceUrl: `https://github.com/${repository}/pull/${resourceNumber}`,
    resourceNumber,
    publishedBranch: `pd-agent/${agent}-${scope}`,
    sourceHeadSha: request.payload.sourceHeadSha,
    githubHeadSha,
    result: 'created',
    verifiedAt: 2_000_000_100,
    relayPublicKey: relayKey.publicKeyHex,
    tokenCleanup: 'confirmed',
    ...overrides,
  }
  delete unsigned.signature
  return { code: 'OK', receipt: { ...unsigned, signature: signDigestHex(relayKey.privateKey, stableJson(unsigned)) } }
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function withFetch(fetchImpl, callback) {
  const previous = globalThis.fetch
  globalThis.fetch = fetchImpl
  try { return await callback() } finally { globalThis.fetch = previous }
}

function mainEnv(encodedPackage, paths = {}) {
  return {
    GITHUB_REPOSITORY: repository,
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW: 'Fleetbot actuator',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/fleetbot-actuator.yml@refs/heads/main`,
    GITHUB_SHA: '9'.repeat(40),
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_TOKEN: 'github-read-token',
    FLEETBOT_RELAY_URL: 'https://relay.example',
    FLEETBOT_RELAY_PUBLIC_KEY_HEX: relayKey.publicKeyHex,
    FLEETBOT_WORKLOAD_PRIVATE_KEY_HEX: workloadPrivateKeyHex,
    FLEETBOT_PUBLISHER_GRANT_ID: grantId,
    FLEETBOT_OPERATION: 'publish',
    FLEETBOT_PUBLICATION_PACKAGE: encodedPackage,
    FLEETBOT_ACTOR_ID: 'github-user:42',
    FLEETBOT_AGENT_ID: 'Admiral/Reviewer',
    FLEETBOT_SESSION_ID: 'gha-publication-1',
    FLEETBOT_PURPOSE: 'Publish the reviewed source package.',
    FLEETBOT_ROADMAP_ITEM: 'fleetbot-pr-authorship',
    FLEETBOT_MANIFEST_PATH: paths.manifestPath,
    FLEETBOT_REQUEST_PATH: paths.requestPath,
  }
}

function tempPaths() {
  const root = join(homedir(), 'coding', 'tmp')
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, 'fleetbot-publication-flow-'))
  scratch.push(dir)
  return { manifestPath: join(dir, 'manifest.json'), requestPath: join(dir, 'request.json') }
}

afterEach(() => {
  while (scratch.length) rmSync(scratch.pop(), { recursive: true, force: true })
})

test('builds a publish request under the grant scope with no PR selector', () => {
  const request = requestFor()
  assert.equal(request.operation, 'pull-request.publish')
  assert.equal(request.payload.pullRequestNumber, undefined)
  assert.equal(request.payload.baseSha, sourceBaseSha)
  assert.equal(request.payload.sourceHeadSha, sourceHeadSha)
  assert.equal(request.payload.sourceTreeSha, sourceTreeSha)
  assert.equal(request.authorship.sourceBranch, 'codex/publication-flow')
  assert.equal(request.capability.baseBranch, 'main')
  assert.equal(request.capability.headSha, sourceHeadSha)
  assert.equal(request.idempotencyKey, `pd-gh-${hashHex(stableJson({
    schema: request.schema,
    operation: request.operation,
    repository: request.repository,
    payload: request.payload,
    sessionId: request.sessionId,
    authorship: request.authorship,
  }))}`)
})

test('publication package injection and grant scope violations fail closed', () => {
  assert.throws(() => requestFor(publicationPackage({ repository: 'other/repo' })), /does not match the workload repository/)
  assert.throws(() => requestFor(publicationPackage({ payload: {
    ...publicationPackage().payload,
    body: 'forged body\n\nRoadmap-Item: fleetbot-pr-authorship',
    extra: 'injected',
  } })), /unsupported or missing fields/)
  assert.throws(() => requestFor(publicationPackage({ payload: {
    ...publicationPackage().payload,
    changes: [{ path: '.github/workflows/blocked.yml', mode: '100644', contentBase64: Buffer.from('name: blocked\n').toString('base64') }],
  } })), /Workflow-file publication requires verified protected Workflows write authority/)
  assert.throws(() => buildPublishRequest({
    key: workloadKey(workloadPrivateKeyHex),
    snapshot: snapshot(['pull-request.comment']),
    repository,
    publicationPackage: publicationPackage(),
    runId: '123', runAttempt: '1', now: 2_000_000_000, nonce: 'ef'.repeat(32),
    authorship: { actorId: 'github-user:42', agentId: 'agent', roadmapItem: 'fleetbot-pr-authorship', sidequestReason: null },
  }), /does not authorize pull-request.publish/)
  assert.throws(() => requestFor(publicationPackage(), {
    authorship: { roadmapItem: 'different-roadmap' },
  }), /roadmap trailer does not match/)
})

test('only accepts a signed publication receipt for the exact source, branch, URL, actor, and cleanup', () => {
  const request = requestFor()
  const verification = { request, snapshot: snapshot(), expectedRelayPublicKey: relayKey.publicKeyHex }
  const valid = signedReceipt(request)
  assert.equal(verifyPublisherReceiptEnvelope(valid, verification), valid.receipt)
  for (const field of ['sourceHeadSha', 'publishedBranch', 'resourceUrl', 'actorId']) {
    const bad = signedReceipt(request, { [field]: field === 'sourceHeadSha' ? '5'.repeat(40) : `wrong-${field}` })
    assert.throws(() => verifyPublisherReceiptEnvelope(bad, verification), /outside the requested authority scope/)
  }
  const badCleanup = signedReceipt(request, { tokenCleanup: 'pending' })
  assert.throws(() => verifyPublisherReceiptEnvelope(badCleanup, verification), /outside the requested authority scope/)
})

test('readback proves the new PR and commit and refuses every mismatch', async () => {
  const request = requestFor()
  const envelope = signedReceipt(request)
  const receipt = envelope.receipt
  const seen = []
  const pull = {
    number: receipt.resourceNumber,
    html_url: receipt.resourceUrl,
    state: 'open',
    draft: false,
    user: { login: 'port-daddy[bot]' },
    head: { repo: { full_name: repository }, ref: receipt.publishedBranch, sha: receipt.githubHeadSha },
    base: { repo: { full_name: repository }, ref: 'main', sha: sourceBaseSha },
    title: request.payload.title,
    body: `Published\n<!-- port-daddy:fleetbot-mutation:${receipt.receiptId} -->`,
  }
  const commit = { sha: receipt.githubHeadSha, tree: { sha: sourceTreeSha }, parents: [{ sha: sourceBaseSha }] }
  const fetchImpl = async (input) => {
    const url = String(input); seen.push(url)
    if (url.endsWith(`/pulls/${receipt.resourceNumber}`)) return response(pull)
    if (url.endsWith(`/git/commits/${receipt.githubHeadSha}`)) return response(commit)
    throw new Error(`unexpected read ${url}`)
  }
  assert.equal(await verifyPublicationReadback({ request, receipt, token: 'read-only', fetchImpl }), receipt)
  assert.deepEqual(seen, [
    `https://api.github.com/repos/${repository}/pulls/${receipt.resourceNumber}`,
    `https://api.github.com/repos/${repository}/git/commits/${receipt.githubHeadSha}`,
  ])
  for (const [changedPull, changedCommit] of [
    [{ ...pull, title: 'wrong' }, commit],
    [{ ...pull, state: 'closed' }, commit],
    [{ ...pull, draft: true }, commit],
    [{ ...pull, head: { ...pull.head, sha: '5'.repeat(40) } }, { ...commit, sha: '5'.repeat(40) }],
    [pull, { ...commit, tree: { sha: '5'.repeat(40) } }],
    [pull, { ...commit, parents: [] }],
  ]) {
    await assert.rejects(
      () => verifyPublicationReadback({ request, receipt, token: 'read-only', fetchImpl: async (input) => String(input).includes('/git/commits/') ? response(changedCommit) : response(changedPull) }),
      /exact approved source tree/,
    )
  }
})

test('prepare reads the exact main ref, emits a null PR manifest, and publish-manifest never retries after readback failure', async () => {
  const encoded = encodePublicationPackage(publicationPackage())
  const paths = tempPaths()
  const env = mainEnv(encoded, paths)
  const seen = []
  const fetchImpl = async (input, init = {}) => {
    const url = String(input); seen.push({ url, init })
    if (url.endsWith(`/publisher-grants/${grantId}`)) return response({ ...snapshot(), schema: 'port-daddy.publisher-grant-snapshot.v1' })
    if (url === `https://api.github.com/repos/${repository}/git/ref/heads/main`) return response({ object: { sha: sourceBaseSha } })
    if (url === `https://api.github.com/repos/${repository}/git/commits/${sourceBaseSha}`) return response({ sha: sourceBaseSha, tree: { sha: emptyTreeSha } })
    if (url.startsWith(`https://api.github.com/repos/${repository}/git/trees/${emptyTreeSha}`)) return gitTreeResponse(emptyTreeSha, [])
    if (url === 'https://relay.example/v1/fleetbot/publish') {
      const actualRequest = JSON.parse(init.body)
      return response(signedReceipt(actualRequest))
    }
    if (url.includes('/pulls/')) return response({ number: 1, state: 'closed' })
    if (url.includes('/git/commits/')) return response({ sha: '4'.repeat(40), tree: { sha: '5'.repeat(40) }, parents: [{ sha: sourceBaseSha }] })
    throw new Error(`unexpected fetch ${url}`)
  }
  await withFetch(fetchImpl, async () => {
    await main(['prepare'], env)
    const manifest = JSON.parse(readFileSync(paths.manifestPath, 'utf8'))
    const prepared = JSON.parse(readFileSync(paths.requestPath, 'utf8'))
    const originalRequestBytes = readFileSync(paths.requestPath, 'utf8')
    assert.equal(manifest.pullRequestNumber, null)
    assert.equal(manifest.receiptRequest.payload.pullRequestNumber, undefined)
    assert.deepEqual(manifest.receiptRequest.payload.sourceHeadSha, sourceHeadSha)
    assert.deepEqual(manifest.receiptRequest.payload.sourceTreeSha, sourceTreeSha)
    assert.equal(manifest.receiptRequest.payload.commitMessage, undefined)
    assert.equal(manifest.receiptRequest.payload.title, undefined)

    prepared.payload.title = 'tampered after preparation'
    writeFileSync(paths.requestPath, `${JSON.stringify(prepared)}\n`, 'utf8')
    await assert.rejects(() => main(['publish-manifest'], env), /does not match the uploaded recovery manifest/)
    assert.equal(seen.filter(entry => entry.url === 'https://relay.example/v1/fleetbot/publish').length, 0)
    writeFileSync(paths.requestPath, originalRequestBytes, 'utf8')

    await assert.rejects(() => main(['publish-manifest'], env), /exact approved source tree/)
    assert.equal(seen.filter(entry => entry.url === 'https://relay.example/v1/fleetbot/publish').length, 1)
    const retryEnv = { ...env, GITHUB_RUN_ATTEMPT: '2' }
    await assert.rejects(() => main(['publish-manifest'], retryEnv), /first attempt.*recover lost responses/i)
    assert.equal(seen.filter(entry => entry.url === 'https://relay.example/v1/fleetbot/publish').length, 1)
  })
})

test('base movement and protected workflow context reject publication before mutation', async () => {
  const paths = tempPaths()
  const env = mainEnv(encodePublicationPackage(publicationPackage()), paths)
  const seen = []
  await withFetch(async (input) => {
    seen.push(String(input))
    if (String(input).endsWith(`/publisher-grants/${grantId}`)) return response({ ...snapshot(), schema: 'port-daddy.publisher-grant-snapshot.v1' })
    if (String(input).includes('/git/ref/heads/main')) return response({ object: { sha: '9'.repeat(40) } })
    throw new Error(`unexpected mutation ${input}`)
  }, async () => {
    await assert.rejects(() => main(['prepare'], env), /Publication base moved/)
  })
  assert.equal(seen.some(url => url === 'https://relay.example/v1/fleetbot/publish'), false)
  await assert.rejects(() => main(['prepare'], { ...env, GITHUB_REF: 'refs/heads/feature' }), /first attempt.*protected main workflow/i)
})

test('prepare hydrates a base delta into the exact full Relay blob and rejects a mismatched base blob before publish', async () => {
  const baseBlob = Buffer.from(`${'A'.repeat(2048)}old-middle${'Z'.repeat(2048)}`)
  const fullBlob = Buffer.from(`${'A'.repeat(2048)}new-middle${'Z'.repeat(2048)}`)
  const baseBlobSha = gitBlobSha(baseBlob)
  const baseTreeSha = gitTreeSha([{ mode: '100644', path: 'README.md', sha: baseBlobSha }])
  const fullTreeSha = gitTreeSha([{ mode: '100644', path: 'README.md', sha: gitBlobSha(fullBlob) }])
  const publication = publicationPackage({
    payload: {
      ...publicationPackage().payload,
      sourceTreeSha: fullTreeSha,
      changes: [{ path: 'README.md', mode: '100644', contentBase64: fullBlob.toString('base64') }],
    },
  })
  const encoded = encodePublicationPackage(publication, { baseBlobs: new Map([['README.md', baseBlob]]) })
  const transport = decodePublicationPackage(encoded)
  assert.equal(transport.payload.changes[0].baseBlobSha, baseBlobSha)
  assert.equal(transport.payload.changes[0].prefixBytes, 2048)
  assert.equal(transport.payload.changes[0].suffixBytes, 2055)

  const paths = tempPaths()
  const env = mainEnv(encoded, paths)
  const seen = []
  await withFetch(async (input, init = {}) => {
    const url = String(input); seen.push({ url, init })
    if (url.endsWith(`/publisher-grants/${grantId}`)) return response({ ...snapshot(), schema: 'port-daddy.publisher-grant-snapshot.v1' })
    if (url === `https://api.github.com/repos/${repository}/git/ref/heads/main`) return response({ object: { sha: sourceBaseSha } })
    if (url === `https://api.github.com/repos/${repository}/git/commits/${sourceBaseSha}`) return response({ sha: sourceBaseSha, tree: { sha: baseTreeSha } })
    if (url.startsWith(`https://api.github.com/repos/${repository}/git/trees/${baseTreeSha}`)) {
      return gitTreeResponse(baseTreeSha, [{ path: 'README.md', mode: '100644', type: 'blob', sha: baseBlobSha }])
    }
    if (url === `https://api.github.com/repos/${repository}/git/blobs/${baseBlobSha}`) {
      return response({ sha: baseBlobSha, encoding: 'base64', size: baseBlob.length, content: baseBlob.toString('base64') })
    }
    throw new Error(`unexpected fetch ${url}`)
  }, async () => {
    await main(['prepare'], env)
    const prepared = JSON.parse(readFileSync(paths.requestPath, 'utf8'))
    assert.deepEqual(prepared.payload.changes, [{ path: 'README.md', mode: '100644', contentBase64: fullBlob.toString('base64') }])
    assert.equal(seen.some(entry => entry.url === 'https://relay.example/v1/fleetbot/publish'), false)
  })

  const badPaths = tempPaths()
  const badEnv = mainEnv(encoded, badPaths)
  const badSeen = []
  const wrongPathTreeSha = gitTreeSha([{ mode: '100644', path: 'README.md', sha: 'e'.repeat(40) }])
  await withFetch(async (input, init = {}) => {
    const url = String(input); badSeen.push({ url, init })
    if (url.endsWith(`/publisher-grants/${grantId}`)) return response({ ...snapshot(), schema: 'port-daddy.publisher-grant-snapshot.v1' })
    if (url === `https://api.github.com/repos/${repository}/git/ref/heads/main`) return response({ object: { sha: sourceBaseSha } })
    if (url === `https://api.github.com/repos/${repository}/git/commits/${sourceBaseSha}`) return response({ sha: sourceBaseSha, tree: { sha: wrongPathTreeSha } })
    if (url.startsWith(`https://api.github.com/repos/${repository}/git/trees/${wrongPathTreeSha}`)) {
      return gitTreeResponse(wrongPathTreeSha, [{ path: 'README.md', mode: '100644', type: 'blob', sha: 'e'.repeat(40) }])
    }
    if (url === `https://api.github.com/repos/${repository}/git/blobs/${baseBlobSha}`) {
      return response({ sha: 'f'.repeat(40), encoding: 'base64', size: baseBlob.length, content: baseBlob.toString('base64') })
    }
    throw new Error(`unexpected fetch ${url}`)
  }, async () => {
    await assert.rejects(() => main(['prepare'], badEnv), /does not belong to its admitted base path/i)
    assert.equal(badSeen.some(entry => entry.url === 'https://relay.example/v1/fleetbot/publish'), false)
  })

  const forgedPublication = publicationPackage({
    payload: {
      ...publication.payload,
      sourceTreeSha: 'f'.repeat(40),
    },
  })
  const forgedEnv = mainEnv(encodePublicationPackage(forgedPublication, { baseBlobs: new Map([['README.md', baseBlob]]) }), tempPaths())
  const forgedSeen = []
  await withFetch(async (input, init = {}) => {
    const url = String(input); forgedSeen.push({ url, init })
    if (url.endsWith(`/publisher-grants/${grantId}`)) return response({ ...snapshot(), schema: 'port-daddy.publisher-grant-snapshot.v1' })
    if (url === `https://api.github.com/repos/${repository}/git/ref/heads/main`) return response({ object: { sha: sourceBaseSha } })
    if (url === `https://api.github.com/repos/${repository}/git/commits/${sourceBaseSha}`) return response({ sha: sourceBaseSha, tree: { sha: baseTreeSha } })
    if (url.startsWith(`https://api.github.com/repos/${repository}/git/trees/${baseTreeSha}`)) {
      return gitTreeResponse(baseTreeSha, [{ path: 'README.md', mode: '100644', type: 'blob', sha: baseBlobSha }])
    }
    if (url === `https://api.github.com/repos/${repository}/git/blobs/${baseBlobSha}`) {
      return response({ sha: baseBlobSha, encoding: 'base64', size: baseBlob.length, content: baseBlob.toString('base64') })
    }
    throw new Error(`unexpected fetch ${url}`)
  }, async () => {
    await assert.rejects(() => main(['prepare'], forgedEnv), /Reconstructed publication tree does not match the approved source tree/i)
    assert.equal(forgedSeen.some(entry => entry.url === 'https://relay.example/v1/fleetbot/publish'), false)
  })
})

test('rebuilds nested directory hashes after a committed child changes', () => {
  const oldBytes = Buffer.from('old\n')
  const newBytes = Buffer.from('new\n')
  const oldBlobSha = gitBlobSha(oldBytes)
  const newBlobSha = gitBlobSha(newBytes)
  const oldSrcTreeSha = gitTreeSha([{ mode: '100644', path: 'old.txt', sha: oldBlobSha }])
  const newSrcTreeSha = gitTreeSha([{ mode: '100644', path: 'old.txt', sha: newBlobSha }])
  const sourceTree = gitTreeSha([{ mode: '040000', path: 'src', sha: newSrcTreeSha }])
  const publication = publicationPackage({
    payload: {
      ...publicationPackage().payload,
      sourceTreeSha: sourceTree,
      changes: [{ path: 'src/old.txt', mode: '100644', contentBase64: newBytes.toString('base64') }],
    },
  })
  const baseEntries = new Map([
    ['src', { mode: '040000', type: 'tree', sha: oldSrcTreeSha }],
    ['src/old.txt', { mode: '100644', type: 'blob', sha: oldBlobSha }],
  ])
  assert.doesNotThrow(() => verifyPublicationSourceTree(publication, baseEntries))
})

test('recovery contacts only receipt recovery and carries sanitized source proof', async () => {
  const request = requestFor()
  const key = workloadKey(workloadPrivateKeyHex)
  const manifest = buildRecoveryManifest({
    key,
    request,
    snapshot: snapshot(),
    repository,
    workflow: 'Fleetbot actuator',
    workflowRef: `${repository}/.github/workflows/fleetbot-actuator.yml@refs/heads/main`,
    workflowSha: '9'.repeat(40),
    eventName: 'workflow_dispatch',
    runId: '123',
    command: 'publish',
    pullRequestNumber: null,
    inputDigest: actionInputDigest('publish', { FLEETBOT_PUBLICATION_PACKAGE: 'encoded' }),
    createdAt: 2_000_000_000,
  })
  const seen = []
  const receipt = signedReceipt(request).receipt
  await recoverPublisherReceipt({
    relayUrl: 'https://relay.example',
    key,
    manifest,
    expectedRelayPublicKey: relayKey.publicKeyHex,
    now: 2_000_000_100,
    nonce: 'ad'.repeat(32),
    fetchImpl: async (input, init) => {
      const url = String(input); seen.push(url)
      assert.equal(url, 'https://relay.example/v1/fleetbot/publisher-receipts/recover')
      const body = JSON.parse(init.body)
      const serialized = JSON.stringify(body)
      assert.doesNotMatch(serialized, /title|commitMessage|contentBase64|Roadmap-Item/)
      return response({ code: 'OK', recovered: true, receipt })
    },
  })
  assert.deepEqual(seen, ['https://relay.example/v1/fleetbot/publisher-receipts/recover'])
  assert.equal(buildReceiptRecoveryEnvelope({ key, manifest, now: 2_000_000_100, nonce: 'ad'.repeat(32) }).proof.binding.headSha, sourceHeadSha)
})

test('publication package transport round-trips the canonical object and rejects malformed injection', () => {
  const original = publicationPackage()
  const encoded = encodePublicationPackage(original)
  assert.deepEqual(decodePublicationPackage(encoded), original)
  assert.throws(() => decodePublicationPackage(encoded.slice(0, -2)), /malformed|base64|JSON|publication/i)
  assert.throws(() => decodePublicationPackage(JSON.stringify({ encoding: 'plain', data: encoded })), /encoding|unsupported/i)
})
