import assert from 'node:assert/strict'
import { verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  buildCommentRequest,
  buildInspectRequest,
  grantReadHeaders,
  hashHex,
  main,
  signDigestHex,
  stableJson,
  verifyPublisherReceiptEnvelope,
  workloadKey,
} from './fleetbot-workload.mjs'

const key = workloadKey('19'.repeat(32))
const grantId = `pdg_${'ab'.repeat(16)}`

describe('fleetbot workload client', () => {
  it('derives a stable Ed25519 identity from the protected seed', () => {
    assert.equal(key.publicKeyHex.length, 64)
    assert.equal(key.fingerprint, hashHex(Buffer.from(key.publicKeyHex, 'hex')))
  })

  it('signs the exact grant-read preimage without a bearer credential', () => {
    const signed = grantReadHeaders({ key, grantId, now: 2_000_000_000, nonce: 'cd'.repeat(32) })
    const preimage = stableJson({
      schema: 'port-daddy.publisher-grant-read.v1',
      method: 'GET',
      path: signed.path,
      fingerprint: key.fingerprint,
      issuedAt: 2_000_000_000,
      nonce: 'cd'.repeat(32),
    })
    assert.equal(signed.headers.Authorization, undefined)
    assert.equal(verify(null, Buffer.from(hashHex(preimage), 'hex'), key.privateKey, Buffer.from(signed.headers['X-PD-Workload-Signature'], 'hex')), true)
  })

  it('binds a read-only request and capability to the same exact PR state', () => {
    const request = buildInspectRequest({
      key,
      snapshot: {
        grantId,
        grantEpoch: 7,
        signingKeyGeneration: 3,
        repositories: ['curiositech/port-daddy'],
        operations: ['pull-request.inspect'],
      },
      repository: 'curiositech/port-daddy',
      pullRequest: {
        number: 10196,
        base: { ref: 'main', sha: '1'.repeat(40) },
        head: { ref: 'codex/oidc', sha: '2'.repeat(40) },
      },
      runId: '123',
      runAttempt: '2',
      now: 2_000_000_000,
      nonce: 'ef'.repeat(32),
    })
    assert.equal(request.idempotencyKey, `pd-gh-${request.capability.requestHash}`)
    assert.equal(request.capability.grantEpoch, 7)
    assert.equal(request.capability.signingKeyGeneration, 3)
    assert.equal(request.capability.headSha, '2'.repeat(40))
    assert.equal(request.authorship.sessionId, 'gha-123-2')
  })

  it('fails closed when repository or operation is outside the grant', () => {
    const common = {
      key,
      repository: 'curiositech/port-daddy',
      pullRequest: { number: 1, base: { ref: 'main', sha: '1'.repeat(40) }, head: { ref: 'x', sha: '2'.repeat(40) } },
      runId: '1',
      runAttempt: '1',
    }
    assert.throws(() => buildInspectRequest({ ...common, snapshot: { grantId, grantEpoch: 1, signingKeyGeneration: 1, repositories: [], operations: ['pull-request.inspect'] } }), /does not authorize curiositech/)
    assert.throws(() => buildInspectRequest({ ...common, snapshot: { grantId, grantEpoch: 1, signingKeyGeneration: 1, repositories: ['curiositech/port-daddy'], operations: [] } }), /does not authorize pull-request.inspect/)
  })

  it('binds an attributable comment to the exact PR head and grant operation', () => {
    const request = buildCommentRequest({
      key,
      snapshot: {
        grantId,
        grantEpoch: 8,
        signingKeyGeneration: 4,
        repositories: ['curiositech/port-daddy'],
        operations: ['pull-request.comment'],
      },
      repository: 'curiositech/port-daddy',
      pullRequest: {
        number: 10282,
        base: { ref: 'main', sha: '1'.repeat(40) },
        head: { ref: 'codex/comment', sha: '2'.repeat(40) },
      },
      body: 'The exact-head review finding is fixed and covered by a regression test.',
      authorship: {
        actorId: 'github-actions',
        agentId: 'admiral-reviewer',
        sessionId: 'codex-01abc',
        purpose: 'Answer an actionable review finding after exact-head validation.',
        roadmapItem: 'fleetbot-pr-authorship',
        sidequestReason: null,
        worktreeId: 'wt-42',
      },
      runId: '123',
      runAttempt: '2',
      now: 2_000_000_000,
      nonce: 'ef'.repeat(32),
    })
    assert.equal(request.operation, 'pull-request.comment')
    assert.equal(request.payload.body, 'The exact-head review finding is fixed and covered by a regression test.')
    assert.equal(request.authorship.agentId, 'admiral-reviewer')
    assert.equal(request.authorship.sessionId, 'codex-01abc')
    assert.equal(request.authorship.roadmapItem, 'fleetbot-pr-authorship')
    assert.equal(request.capability.operation, 'pull-request.comment')
    assert.equal(request.capability.headSha, '2'.repeat(40))
    assert.equal(request.capability.requestHash, request.idempotencyKey.slice('pd-gh-'.length))
  })

  it('rejects unbounded comments and malformed responsible-agent provenance before signing', () => {
    const common = {
      key,
      snapshot: {
        grantId,
        grantEpoch: 8,
        signingKeyGeneration: 4,
        repositories: ['curiositech/port-daddy'],
        operations: ['pull-request.comment'],
      },
      repository: 'curiositech/port-daddy',
      pullRequest: { number: 1, base: { ref: 'main', sha: '1'.repeat(40) }, head: { ref: 'x', sha: '2'.repeat(40) } },
      runId: '1',
      runAttempt: '1',
    }
    assert.throws(() => buildCommentRequest({ ...common, body: '' }), /must be non-empty/)
    assert.equal(buildCommentRequest({ ...common, body: 'x'.repeat(1_000_000) }).payload.body.length, 1_000_000)
    assert.throws(() => buildCommentRequest({ ...common, body: 'x'.repeat(1_000_001) }), /at most 1000000/)
    assert.throws(() => buildCommentRequest({
      ...common,
      body: 'hello',
      authorship: { agentId: 'not allowed spaces', roadmapItem: 'fleetbot-pr-authorship', sidequestReason: null },
    }), /authorship.agentId is missing or malformed/)
    assert.throws(() => buildCommentRequest({
      ...common,
      body: 'hello',
      authorship: { roadmapItem: 'fleetbot-pr-authorship', sidequestReason: 'cannot carry both' },
    }), /exactly one roadmap item or sidequest reason/)
    assert.throws(() => buildCommentRequest({
      ...common,
      body: 'hello',
      authorship: { roadmapItem: null, sidequestReason: null },
    }), /exactly one roadmap item or sidequest reason/)
  })

  it('runs the comment command from bounded environment fields through signed receipt verification', async () => {
    const relay = workloadKey('27'.repeat(32))
    const snapshot = {
      schema: 'port-daddy.publisher-grant-snapshot.v1',
      grantId,
      grantEpoch: 8,
      signingKeyGeneration: 4,
      repositories: ['curiositech/port-daddy'],
      operations: ['pull-request.comment'],
    }
    const pullRequest = {
      number: 10282,
      base: { ref: 'main', sha: '1'.repeat(40) },
      head: { ref: 'codex/comment', sha: '2'.repeat(40) },
    }
    const seen = []
    const originalFetch = globalThis.fetch
    const originalLog = console.log
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input)
      seen.push({ url, init })
      if (url.startsWith('https://oidc.example/token')) return Response.json({ value: 'header.payload.signature' })
      if (url === 'https://relay.example/v1/exchange') return Response.json({ code: 'OK' })
      if (url === `https://relay.example/v1/fleetbot/publisher-grants/${grantId}`) return Response.json(snapshot)
      if (url === 'https://api.github.com/repos/curiositech/port-daddy/pulls/10282') return Response.json(pullRequest)
      if (url === 'https://relay.example/v1/fleetbot/publish') {
        const request = JSON.parse(init.body)
        const unsigned = {
          schema: 'port-daddy.fleetbot-receipt.v2',
          receiptId: `github_receipt_${request.idempotencyKey.slice('pd-gh-'.length, 'pd-gh-'.length + 32)}`,
          authority: 'port-daddy-relay-github-app',
          appSlug: 'port-daddy',
          operation: request.operation,
          repository: request.repository,
          idempotencyKey: request.idempotencyKey,
          accountUserId: 'user-1',
          accountGithubUserId: 42,
          authorizedBy: { grantId, grantEpoch: 8, surface: 'publisher' },
          admission: 'standing-publisher-grant',
          actorId: request.authorship.actorId,
          agentId: request.authorship.agentId,
          sessionId: request.sessionId,
          roadmapItem: request.authorship.roadmapItem,
          resourceUrl: 'https://github.com/curiositech/port-daddy/pull/10282#issuecomment-1',
          resourceNumber: 10282,
          publishedBranch: 'codex/comment',
          sourceHeadSha: null,
          githubHeadSha: '2'.repeat(40),
          result: 'created',
          verifiedAt: 2_000_000_000,
          relayPublicKey: relay.publicKeyHex,
          tokenCleanup: 'confirmed',
        }
        return Response.json({ code: 'OK', receipt: { ...unsigned, signature: signDigestHex(relay.privateKey, stableJson(unsigned)) } })
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    console.log = () => {}
    try {
      await main(['comment'], {
        GITHUB_REPOSITORY: 'curiositech/port-daddy',
        GITHUB_TOKEN: 'read-only-actions-token',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '2',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-request-token',
        FLEETBOT_RELAY_URL: 'https://relay.example',
        FLEETBOT_RELAY_PUBLIC_KEY_HEX: relay.publicKeyHex,
        FLEETBOT_WORKLOAD_PRIVATE_KEY_HEX: '19'.repeat(32),
        FLEETBOT_PUBLISHER_GRANT_ID: grantId,
        FLEETBOT_PULL_REQUEST_NUMBER: '10282',
        FLEETBOT_COMMENT_BODY: 'The exact-head finding is fixed.',
        FLEETBOT_ACTOR_ID: 'github-user:42',
        FLEETBOT_AGENT_ID: 'admiral-reviewer',
        FLEETBOT_SESSION_ID: 'codex-01abc',
        FLEETBOT_PURPOSE: 'Answer the exact-head review finding.',
        FLEETBOT_ROADMAP_ITEM: 'fleetbot-pr-authorship',
      })
    } finally {
      globalThis.fetch = originalFetch
      console.log = originalLog
    }
    const publish = seen.find((entry) => entry.url === 'https://relay.example/v1/fleetbot/publish')
    const request = JSON.parse(publish.init.body)
    assert.equal(request.operation, 'pull-request.comment')
    assert.equal(request.authorship.actorId, 'github-user:42')
    assert.equal(request.authorship.agentId, 'admiral-reviewer')
    assert.equal(request.authorship.sessionId, 'codex-01abc')
    assert.equal(request.payload.body, 'The exact-head finding is fixed.')
    assert.equal(request.capability.headSha, '2'.repeat(40))
  })

  it('unwraps and verifies the exact Relay receipt envelope', () => {
    const relay = workloadKey('27'.repeat(32))
    const snapshot = {
      grantId,
      grantEpoch: 7,
      signingKeyGeneration: 3,
      repositories: ['curiositech/port-daddy'],
      operations: ['pull-request.inspect'],
    }
    const request = buildInspectRequest({
      key,
      snapshot,
      repository: 'curiositech/port-daddy',
      pullRequest: {
        number: 10196,
        base: { ref: 'main', sha: '1'.repeat(40) },
        head: { ref: 'codex/oidc', sha: '2'.repeat(40) },
      },
      runId: '123',
      runAttempt: '2',
      now: 2_000_000_000,
      nonce: 'ef'.repeat(32),
    })
    const unsigned = {
      schema: 'port-daddy.fleetbot-receipt.v2',
      receiptId: `github_receipt_${request.idempotencyKey.slice('pd-gh-'.length, 'pd-gh-'.length + 32)}`,
      authority: 'port-daddy-relay-github-app',
      appSlug: 'port-daddy',
      operation: request.operation,
      repository: request.repository,
      idempotencyKey: request.idempotencyKey,
      accountUserId: 'user-1',
      accountGithubUserId: 42,
      authorizedBy: { grantId, grantEpoch: 7, surface: 'publisher' },
      admission: 'standing-publisher-grant',
      actorId: request.authorship.actorId,
      agentId: request.authorship.agentId,
      sessionId: request.sessionId,
      roadmapItem: null,
      resourceUrl: 'https://github.com/curiositech/port-daddy/pull/10196',
      resourceNumber: 10196,
      publishedBranch: 'codex/oidc',
      sourceHeadSha: null,
      githubHeadSha: '2'.repeat(40),
      result: 'observed',
      verifiedAt: 2_000_000_000,
      relayPublicKey: relay.publicKeyHex,
      tokenCleanup: 'confirmed',
    }
    const receipt = { ...unsigned, signature: signDigestHex(relay.privateKey, stableJson(unsigned)) }
    const verification = { request, snapshot, expectedRelayPublicKey: relay.publicKeyHex }
    assert.equal(verifyPublisherReceiptEnvelope({ code: 'OK', receipt }, verification), receipt)
    assert.throws(
      () => verifyPublisherReceiptEnvelope({ code: 'OK', receipt: { ...receipt, githubHeadSha: '3'.repeat(40) } }, verification),
      /outside the requested authority scope/,
    )
    assert.throws(
      () => verifyPublisherReceiptEnvelope({ code: 'OK', receipt: { ...receipt, agentId: 'other-agent' } }, verification),
      /outside the requested authority scope/,
    )
    assert.throws(
      () => verifyPublisherReceiptEnvelope({ code: 'OK', receipt: { ...receipt, signature: '00'.repeat(64) } }, verification),
      /signature is invalid/,
    )
    assert.throws(
      () => verifyPublisherReceiptEnvelope({ code: 'OK', receipt }, { ...verification, expectedRelayPublicKey: '42'.repeat(32) }),
      /outside the requested authority scope/,
    )
  })

  it('accepts only operation-appropriate signed mutation outcomes', () => {
    const relay = workloadKey('27'.repeat(32))
    const snapshot = {
      grantId,
      grantEpoch: 8,
      signingKeyGeneration: 4,
      repositories: ['curiositech/port-daddy'],
      operations: ['pull-request.comment'],
    }
    const request = buildCommentRequest({
      key,
      snapshot,
      repository: 'curiositech/port-daddy',
      pullRequest: {
        number: 10282,
        base: { ref: 'main', sha: '1'.repeat(40) },
        head: { ref: 'codex/comment', sha: '2'.repeat(40) },
      },
      body: 'Reviewed at the exact head.',
      authorship: { roadmapItem: 'fleetbot-pr-authorship', sidequestReason: null },
      runId: '123',
      runAttempt: '2',
      now: 2_000_000_000,
      nonce: 'ef'.repeat(32),
    })
    const unsigned = {
      schema: 'port-daddy.fleetbot-receipt.v2',
      receiptId: `github_receipt_${request.idempotencyKey.slice('pd-gh-'.length, 'pd-gh-'.length + 32)}`,
      authority: 'port-daddy-relay-github-app',
      appSlug: 'port-daddy',
      operation: request.operation,
      repository: request.repository,
      idempotencyKey: request.idempotencyKey,
      accountUserId: 'user-1',
      accountGithubUserId: 42,
      authorizedBy: { grantId, grantEpoch: 8, surface: 'publisher' },
      admission: 'standing-publisher-grant',
      actorId: request.authorship.actorId,
      agentId: request.authorship.agentId,
      sessionId: request.sessionId,
      roadmapItem: 'fleetbot-pr-authorship',
      resourceUrl: 'https://github.com/curiositech/port-daddy/pull/10282#issuecomment-1',
      resourceNumber: 10282,
      publishedBranch: 'codex/comment',
      sourceHeadSha: null,
      githubHeadSha: '2'.repeat(40),
      result: 'created',
      verifiedAt: 2_000_000_000,
      relayPublicKey: relay.publicKeyHex,
      tokenCleanup: 'confirmed',
    }
    const signed = { ...unsigned, signature: signDigestHex(relay.privateKey, stableJson(unsigned)) }
    assert.equal(verifyPublisherReceiptEnvelope({ code: 'OK', receipt: signed }, {
      request,
      snapshot,
      expectedRelayPublicKey: relay.publicKeyHex,
    }), signed)
    const invalid = { ...unsigned, result: 'observed' }
    const invalidSigned = { ...invalid, signature: signDigestHex(relay.privateKey, stableJson(invalid)) }
    assert.throws(() => verifyPublisherReceiptEnvelope({ code: 'OK', receipt: invalidSigned }, {
      request,
      snapshot,
      expectedRelayPublicKey: relay.publicKeyHex,
    }), /outside the requested authority scope/)
  })

  it('keeps the smoke workflow manual, protected, bounded, and read-only', () => {
    const workflow = readFileSync(new URL('../.github/workflows/fleetbot-workload-smoke.yml', import.meta.url), 'utf8')
    assert.match(workflow, /workflow_dispatch:/)
    assert.match(workflow, /environment: fleetbot-workload/)
    assert.match(workflow, /main-ref-gate:/)
    assert.match(workflow, /if \[\[ "\$\{GITHUB_REF\}" != "refs\/heads\/main" \]\]/)
    assert.match(workflow, /exit 1/)
    assert.match(workflow, /needs: main-ref-gate/)
    assert.match(workflow, /id-token: write/)
    assert.match(workflow, /contents: read/)
    assert.match(workflow, /pull-requests: read/)
    assert.match(workflow, /timeout-minutes: 5/)
    assert.doesNotMatch(workflow, /^  (schedule|pull_request|push):/m)
    assert.match(workflow, /persist-credentials: false/)
    assert.doesNotMatch(workflow, /actions\/(checkout|setup-node)@v\d/)
    assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/)
    assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/)
    assert.match(workflow, /FLEETBOT_RELAY_PUBLIC_KEY_HEX:.*vars\.FLEETBOT_RELAY_PUBLIC_KEY_HEX/)
  })

  it('keeps the first write workflow manual, protected, typed, and credential-separated', () => {
    const workflow = readFileSync(new URL('../.github/workflows/fleetbot-actuator.yml', import.meta.url), 'utf8')
    assert.match(workflow, /workflow_dispatch:/)
    assert.match(workflow, /options:\n          - comment/)
    assert.match(workflow, /environment: fleetbot-workload/)
    assert.match(workflow, /main-ref-gate:/)
    assert.match(workflow, /needs: main-ref-gate/)
    assert.match(workflow, /id-token: write/)
    assert.match(workflow, /contents: read/)
    assert.match(workflow, /pull-requests: read/)
    assert.doesNotMatch(workflow, /pull-requests: write/)
    assert.doesNotMatch(workflow, /^  (schedule|pull_request|push):/m)
    assert.match(workflow, /persist-credentials: false/)
    assert.match(workflow, /FLEETBOT_AGENT_ID:.*inputs\.agent_id/)
    assert.match(workflow, /FLEETBOT_SESSION_ID:.*inputs\.session_id/)
    assert.match(workflow, /FLEETBOT_ACTOR_ID: github-user:\$\{\{ github\.actor_id \}\}/)
    assert.match(workflow, /node scripts\/fleetbot-workload\.mjs comment/)
    assert.doesNotMatch(workflow, /GH_TOKEN|pdu_/)
  })
})
