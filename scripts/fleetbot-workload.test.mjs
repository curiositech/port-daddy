import assert from 'node:assert/strict'
import { verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  buildInspectRequest,
  grantReadHeaders,
  hashHex,
  stableJson,
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

  it('keeps the smoke workflow manual, protected, bounded, and read-only', () => {
    const workflow = readFileSync(new URL('../.github/workflows/fleetbot-workload-smoke.yml', import.meta.url), 'utf8')
    assert.match(workflow, /workflow_dispatch:/)
    assert.match(workflow, /environment: fleetbot-workload/)
    assert.match(workflow, /id-token: write/)
    assert.match(workflow, /contents: read/)
    assert.match(workflow, /pull-requests: read/)
    assert.match(workflow, /timeout-minutes: 5/)
    assert.doesNotMatch(workflow, /^  (schedule|pull_request|push):/m)
    assert.match(workflow, /persist-credentials: false/)
  })
})
