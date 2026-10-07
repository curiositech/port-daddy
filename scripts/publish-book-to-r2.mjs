#!/usr/bin/env node
/**
 * Publish one Book release pointer without mutable PDF bytes.
 *
 * The PDF is stored once at its SHA-256 address. The only mutable object is
 * book/current.json, which names that immutable archive object. Promotion uses
 * the S3 API's documented conditional writes so an older run cannot replace a
 * newer manifest.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SyncError,
  readCredentials,
  signRequest,
} from './sync-r2-media.mjs'

export const BOOK_PUBLIC_BASE_URL = 'https://media.portdaddy.dev'
export const BOOK_ARCHIVE_PREFIX = 'book/archive/sha256/'
export const BOOK_RELEASE_MANIFEST_KEY = 'book/current.json'
export const BOOK_RELEASE_MANIFEST_URL = BOOK_PUBLIC_BASE_URL + '/' + BOOK_RELEASE_MANIFEST_KEY
export const BOOK_CACHE_CONTROL_ARCHIVE = 'public, max-age=31536000, immutable'
export const BOOK_CACHE_CONTROL_MANIFEST = 'public, no-cache'
export const BOOK_RELEASE_ACCEPTANCE_SCHEMA = 'port-daddy.book-release.acceptance.v1'
export const BOOK_RELEASE_REPOSITORY = 'curiositech/port-daddy'
export const BOOK_RELEASE_MAIN_REF = 'refs/heads/main'
export const BOOK_RELEASE_ENVIRONMENT = 'book-release'
export const BOOK_RELEASE_WORKFLOW_REF = 'curiositech/port-daddy/.github/workflows/whitepaper-build.yml@refs/heads/main'
const SHA256_RE = /^[0-9a-f]{64}$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const ETAG_RE = /^"[^"\r\n]+"$/

function fail(message, { exitCode = 1 } = {}) {
  throw new SyncError(message, { exitCode })
}

function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function equalBytes(left, right) {
  return left.length === right.length
    && timingSafeEqual(left, right)
}

function cloneAndFreeze(value, name) {
  let clone
  try {
    clone = structuredClone(value)
  } catch (error) {
    fail(name + ' must be a structured-cloneable JSON record: ' + (error instanceof Error ? error.message : String(error)), { exitCode: 2 })
  }
  const freeze = (current) => {
    if (!current || typeof current !== 'object' || Object.isFrozen(current)) return current
    Object.freeze(current)
    for (const child of Object.values(current)) freeze(child)
    return current
  }
  return freeze(clone)
}

function requireS3(config) {
  if (!config || config.transport !== 's3') {
    fail('Book release promotion requires the R2 S3 transport because only its documented conditional writes provide stale-run protection', { exitCode: 2 })
  }
}

function requireSha256(value, name) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) fail(name + ' must be a lowercase SHA-256 digest', { exitCode: 2 })
  return value
}

function requireCommit(value, name = 'sourceCommit') {
  if (typeof value !== 'string' || !COMMIT_RE.test(value)) fail(name + ' must be a 40-character Git SHA', { exitCode: 2 })
  return value
}

function requireTimestamp(value, name) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(name + ' must be an ISO timestamp', { exitCode: 2 })
  return value
}

function requireExpectedEtag(value) {
  if (value !== null && (typeof value !== 'string' || !ETAG_RE.test(value))) {
    fail('expectedManifestETag must be null for an absent pointer or a quoted ETag', { exitCode: 2 })
  }
  return value
}

function requirePages(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('pages must be a positive integer', { exitCode: 2 })
  return value
}

export function archiveKeyFor(sha256Hex) {
  return BOOK_ARCHIVE_PREFIX + requireSha256(sha256Hex, 'sha256Hex') + '.pdf'
}

export function buildReleaseManifest({ sha256Hex, bytes, pages, sourceCommit, sourceTree, sourceCommittedAt, publishedAt }) {
  const digest = requireSha256(sha256Hex, 'sha256Hex')
  if (!Number.isSafeInteger(bytes) || bytes < 1) fail('bytes must be a positive integer', { exitCode: 2 })
  requireTimestamp(publishedAt, 'publishedAt')
  return {
    schema: 'port-daddy.book-release.v1',
    sha256: digest,
    bytes,
    pages: requirePages(pages),
    sourceCommit: requireCommit(sourceCommit),
    sourceTree: requireCommit(sourceTree, 'sourceTree'),
    sourceCommittedAt: requireTimestamp(sourceCommittedAt, 'sourceCommittedAt'),
    publishedAt,
    archiveKey: archiveKeyFor(digest),
    archiveUrl: BOOK_PUBLIC_BASE_URL + '/' + archiveKeyFor(digest),
  }
}

export function validateAcceptedReleaseRecord(record, pdfBytes) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('accepted release record must be an object', { exitCode: 2 })
  }
  if (record.schema !== BOOK_RELEASE_ACCEPTANCE_SCHEMA) fail('accepted release record has an unsupported schema', { exitCode: 2 })
  if (record.repository !== BOOK_RELEASE_REPOSITORY) fail('accepted release record is bound to the wrong repository', { exitCode: 2 })
  if (record.ref !== BOOK_RELEASE_MAIN_REF || record.event !== 'push') {
    fail('accepted release record must be approved for a push to refs/heads/main', { exitCode: 2 })
  }
  if (record.environment !== BOOK_RELEASE_ENVIRONMENT || record.approved !== true) {
    fail('accepted release record lacks protected book-release approval', { exitCode: 2 })
  }
  if (!record.authority || record.authority.type !== 'protected-github-workflow' || record.authority.workflow !== BOOK_RELEASE_WORKFLOW_REF) {
    fail('accepted release record lacks the protected whitepaper workflow authority binding', { exitCode: 2 })
  }
  const artifact = record.artifact
  const source = record.source
  if (!artifact || !source || typeof artifact !== 'object' || typeof source !== 'object') {
    fail('accepted release record must include artifact and source records', { exitCode: 2 })
  }
  const digest = sha256Of(pdfBytes)
  if (artifact.sha256 !== digest) fail('accepted artifact SHA-256 does not match the PDF bytes', { exitCode: 2 })
  if (artifact.bytes !== pdfBytes.length) fail('accepted artifact byte count does not match the PDF bytes', { exitCode: 2 })
  const pages = requirePages(artifact.pages)
  const sourceCommit = requireCommit(source.commit)
  const sourceTree = requireCommit(source.tree, 'source.tree')
  const sourceCommittedAt = requireTimestamp(source.committedAt, 'source.committedAt')
  const expectedManifestETag = requireExpectedEtag(record.expectedManifestETag)
  return { digest, pages, sourceCommit, sourceTree, sourceCommittedAt, expectedManifestETag }
}

export function serializeReleaseManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n'
}

function header(response, name) {
  if (response && response.headers && typeof response.headers.get === 'function') return response.headers.get(name)
  if (response && response.headers && typeof response.headers === 'object') {
    return response.headers[name] ?? response.headers[name.toLowerCase()] ?? null
  }
  return null
}

async function bodyBytes(response, key) {
  if (response && typeof response.arrayBuffer === 'function') return Buffer.from(await response.arrayBuffer())
  if (response && Buffer.isBuffer(response.body)) return response.body
  if (response && response.body instanceof Uint8Array) return Buffer.from(response.body)
  fail('GET ' + key + ' returned no readable object body')
}

function requestHash(body) {
  return sha256Of(body)
}

async function headObject(key, config, { fetchImpl = fetch } = {}) {
  requireS3(config)
  const signed = signRequest({
    method: 'HEAD',
    key,
    headers: {},
    payloadHash: requestHash(Buffer.alloc(0)),
    config,
  })
  const response = await fetchImpl(signed.url, { method: 'HEAD', headers: signed.headers })
  if (response.status === 404) return { exists: false, etag: null }
  if (response.status !== 200) {
    fail('HEAD ' + key + ' answered ' + response.status + '; refusing to guess its release state')
  }
  const etag = header(response, 'etag')
  return { exists: true, etag: typeof etag === 'string' && etag.length > 0 ? etag : null }
}

async function getObject(key, config, { fetchImpl = fetch } = {}) {
  requireS3(config)
  const signed = signRequest({
    method: 'GET',
    key,
    headers: {},
    payloadHash: requestHash(Buffer.alloc(0)),
    config,
  })
  const response = await fetchImpl(signed.url, { method: 'GET', headers: signed.headers })
  if (response.status !== 200) fail('GET ' + key + ' answered ' + response.status + '; refusing to trust its release bytes')
  return bodyBytes(response, key)
}

async function conditionalPut(key, body, { contentType, cacheControl, condition }, config, { fetchImpl = fetch } = {}) {
  requireS3(config)
  const signed = signRequest({
    method: 'PUT',
    key,
    headers: {
      'content-type': contentType,
      'cache-control': cacheControl,
      ...condition,
    },
    payloadHash: requestHash(body),
    config,
  })
  const response = await fetchImpl(signed.url, { method: 'PUT', headers: signed.headers, body })
  if (response.status === 412) return false
  if (!response.ok) {
    fail('PUT ' + key + ' failed with ' + response.status + ' ' + response.statusText + '; existing release was preserved when the provider rejected the write')
  }
  return true
}

async function verifyArchive(pdfBytes, archiveKey, config, options) {
  const stored = await getObject(archiveKey, config, options)
  if (!equalBytes(stored, pdfBytes)) {
    fail('immutable archive ' + archiveKey + ' served bytes whose SHA-256 does not match its key; refusing release promotion')
  }
}

async function ensureArchive(pdfBytes, archiveKey, config, options) {
  const existing = await headObject(archiveKey, config, options)
  if (!existing.exists) {
    const created = await conditionalPut(
      archiveKey,
      pdfBytes,
      { contentType: 'application/pdf', cacheControl: BOOK_CACHE_CONTROL_ARCHIVE, condition: { 'if-none-match': '*' } },
      config,
      options,
    )
    if (!created) {
      await verifyArchive(pdfBytes, archiveKey, config, options)
      return
    }
  }
  await verifyArchive(pdfBytes, archiveKey, config, options)
}

export async function publishBook(pdfBytes, options = {}) {
  if (!Buffer.isBuffer(pdfBytes) || pdfBytes.length === 0) {
    fail('refusing to publish an empty Book PDF', { exitCode: 2 })
  }
  const pdfSnapshot = Buffer.from(pdfBytes)
  if (Object.hasOwn(options, 'pages') || Object.hasOwn(options, 'sourceCommit')) {
    fail('publishBook requires an accepted release record; arbitrary pages/sourceCommit claims are not accepted', { exitCode: 2 })
  }
  const {
    acceptedRecord,
    config,
    verifyAcceptance,
    now = () => new Date(),
    fetchImpl = fetch,
    log = () => {},
  } = options
  requireS3(config)
  const acceptedRecordSnapshot = cloneAndFreeze(acceptedRecord, 'accepted release record')
  const accepted = validateAcceptedReleaseRecord(acceptedRecordSnapshot, pdfSnapshot)
  if (typeof verifyAcceptance !== 'function') {
    fail('protected acceptance verifier is required; a caller-supplied JSON record is metadata, not authority', { exitCode: 2 })
  }
  if (await verifyAcceptance(acceptedRecordSnapshot) !== true) {
    fail('protected acceptance verifier rejected the Book release record', { exitCode: 2 })
  }
  const optionsWithFetch = { fetchImpl }
  const prior = await headObject(BOOK_RELEASE_MANIFEST_KEY, config, optionsWithFetch)
  if (accepted.expectedManifestETag === null) {
    if (prior.exists) fail('accepted release record expected an absent release manifest, but a pointer already exists; refusing stale promotion')
  } else if (!prior.exists || prior.etag !== accepted.expectedManifestETag) {
    fail('accepted release record expected manifest ETag ' + accepted.expectedManifestETag + ', but the live pointer has moved; refusing stale promotion')
  }
  const condition = accepted.expectedManifestETag === null
    ? { 'if-none-match': '*' }
    : { 'if-match': accepted.expectedManifestETag }
  const digest = accepted.digest
  const archiveKey = archiveKeyFor(digest)
  const publishedAt = now().toISOString()
  const manifest = buildReleaseManifest({
    sha256Hex: digest,
    bytes: pdfSnapshot.length,
    pages: accepted.pages,
    sourceCommit: accepted.sourceCommit,
    sourceTree: accepted.sourceTree,
    sourceCommittedAt: accepted.sourceCommittedAt,
    publishedAt,
  })
  await ensureArchive(pdfSnapshot, archiveKey, config, optionsWithFetch)
  log('verified immutable ' + archiveKey + ' (' + pdfSnapshot.length + ' bytes)')

  const manifestBytes = Buffer.from(serializeReleaseManifest(manifest), 'utf8')
  const promoted = await conditionalPut(
    BOOK_RELEASE_MANIFEST_KEY,
    manifestBytes,
    { contentType: 'application/json', cacheControl: BOOK_CACHE_CONTROL_MANIFEST, condition },
    config,
    optionsWithFetch,
  )
  if (!promoted) {
    fail('release manifest changed during promotion; this run is stale and the existing release was preserved')
  }
  const observed = await getObject(BOOK_RELEASE_MANIFEST_KEY, config, optionsWithFetch)
  if (!equalBytes(observed, manifestBytes)) {
    fail('release manifest readback did not match the promoted bytes; release state is untrusted')
  }
  log('promoted ' + BOOK_RELEASE_MANIFEST_URL)
  return manifest
}

function parseArgs(argv) {
  const options = { pdfPath: null, acceptedRecordPath: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--accepted-record') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail('--accepted-record needs a JSON file path', { exitCode: 2 })
      options.acceptedRecordPath = argv[i + 1]
      i += 1
    } else if (!options.pdfPath && !argv[i].startsWith('--')) {
      options.pdfPath = argv[i]
    } else {
      fail('unknown argument: ' + argv[i], { exitCode: 2 })
    }
  }
  if (!options.pdfPath || !options.acceptedRecordPath) fail('usage: publish-book-to-r2.mjs <path-to-book.pdf> --accepted-record <accepted-release.json>', { exitCode: 2 })
  return options
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv)
  const absolute = resolve(options.pdfPath)
  if (!existsSync(absolute)) fail('no file at ' + absolute, { exitCode: 2 })
  const acceptedRecordAbsolute = resolve(options.acceptedRecordPath)
  if (!existsSync(acceptedRecordAbsolute)) fail('no accepted release record at ' + acceptedRecordAbsolute, { exitCode: 2 })
  const pdfBytes = readFileSync(absolute)
  let acceptedRecord
  try {
    acceptedRecord = JSON.parse(readFileSync(acceptedRecordAbsolute, 'utf8'))
  } catch (error) {
    fail('accepted release record is not valid JSON: ' + (error instanceof Error ? error.message : String(error)), { exitCode: 2 })
  }
  const config = readCredentials(env)
  console.log('publishing ' + absolute + ' (' + pdfBytes.length + ' bytes) to r2://' + config.bucket + '/' + BOOK_RELEASE_MANIFEST_KEY)
  const manifest = await publishBook(pdfBytes, {
    acceptedRecord,
    config,
    log: console.log,
  })
  console.log('done: ' + manifest.archiveUrl + '; release manifest ' + BOOK_RELEASE_MANIFEST_URL)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('publish-book-to-r2: ' + (error instanceof Error ? error.message : String(error)))
    process.exit(error instanceof SyncError ? error.exitCode : 1)
  })
}
