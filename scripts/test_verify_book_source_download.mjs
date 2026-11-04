import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isProductionPagesBuild, verifySourceDownload } from './verify-book-source-download.mjs'
const body = Buffer.from('source archive fixture')
const sha256 = createHash('sha256').update(body).digest('hex')
const url = `https://media.portdaddy.dev/book/source/sha256/${sha256}.tar.gz`
const receipt = { archive: { sha256, bytes: body.length, url, contentType: 'application/gzip' } }
const reply = (data = body, type = 'application/gzip', destination = url) => ({ ok: true, status: 200, url: destination, headers: new Headers({ 'content-type': type }), body: [data] })
test('verifies the ordinary full-site redirect and complete public bytes', async () => {
  const result = await verifySourceDownload(receipt, { site: true, fetchImpl: async requested => {
    assert.equal(requested, 'https://portdaddy.dev/whitepaper/coordination-papers-mega-volume-source.tar.gz')
    return reply()
  } })
  assert.equal(result.sha256, sha256)
})
test('rejects SPA HTML, truncated or altered archives, and wrong destinations', async () => {
  for (const response of [reply(body, 'text/html'), reply(body.subarray(1)), reply(Buffer.alloc(body.length)), reply(body, 'application/gzip', 'https://example.com/wrong')]) {
    await assert.rejects(verifySourceDownload(receipt, { fetchImpl: async () => response }))
  }
})

test('native Pages production verifies public bytes while local builds stay offline', () => {
  assert.equal(isProductionPagesBuild({}), false)
  assert.equal(isProductionPagesBuild({ CF_PAGES: '1', CF_PAGES_BRANCH: 'preview' }), false)
  assert.equal(isProductionPagesBuild({ CF_PAGES: '1', CF_PAGES_BRANCH: 'main' }), true)
})
