#!/usr/bin/env node
/** Verify public source bytes before making a website release point at them. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const receiptPath = fileURLToPath(new URL('../website-v2/public/whitepaper/coordination-papers-mega-volume-source.json', import.meta.url))
// https://developers.cloudflare.com/pages/configuration/build-configuration/
export function isProductionPagesBuild(env = process.env) {
  return env.CF_PAGES === '1' && env.CF_PAGES_BRANCH === 'main'
}
export async function verifySourceDownload(receipt, { site = false, fetchImpl = fetch } = {}) {
  const artifact = receipt.archive
  if (!/^[a-f0-9]{64}$/.test(artifact?.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.bytes > 250 * 1024 * 1024) throw Error('Invalid source archive receipt')
  const expected = `https://media.portdaddy.dev/book/source/sha256/${artifact.sha256}.tar.gz`
  if (artifact.url !== expected || artifact.contentType !== 'application/gzip') throw Error('Unexpected source archive destination')
  const url = site ? 'https://portdaddy.dev/whitepaper/coordination-papers-mega-volume-source.tar.gz' : expected
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' })
  if (!response.ok || response.url !== expected) throw Error(`Source download returned unexpected status or destination: ${response.status}`)
  const type = response.headers.get('content-type')?.split(';')[0].trim()
  if (type !== 'application/gzip') throw Error(`Source download returned ${type}, expected application/gzip`)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > artifact.bytes) throw Error('Source download exceeds the receipted byte count')
    hash.update(chunk)
  }
  if (bytes !== artifact.bytes || hash.digest('hex') !== artifact.sha256) throw Error('Public source archive bytes do not match the accepted receipt')
  return { url, destination: response.url, bytes, sha256: artifact.sha256 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--site', '--pages-if-production'].includes(arg))) throw Error('Usage: node scripts/verify-book-source-download.mjs [--site] [--pages-if-production]')
  if (args.includes('--pages-if-production') && !isProductionPagesBuild()) process.exit(0)
  try { console.log(JSON.stringify(await verifySourceDownload(JSON.parse(readFileSync(receiptPath)), { site: args.includes('--site') }), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
