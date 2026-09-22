import { createHash } from 'node:crypto'

import {
  BOOK_ARCHIVE_PREFIX,
  BOOK_CACHE_CONTROL_ARCHIVE,
  BOOK_CACHE_CONTROL_MANIFEST,
  BOOK_RELEASE_ACCEPTANCE_SCHEMA,
  BOOK_RELEASE_ENVIRONMENT,
  BOOK_RELEASE_MAIN_REF,
  BOOK_RELEASE_MANIFEST_KEY,
  BOOK_RELEASE_REPOSITORY,
  BOOK_RELEASE_WORKFLOW_REF,
  BOOK_RELEASE_MANIFEST_URL,
  archiveKeyFor,
  buildReleaseManifest,
  main,
  publishBook,
} from '../../scripts/publish-book-to-r2.mjs'
import { readCredentials, SyncError } from '../../scripts/sync-r2-media.mjs'

const ENV = {
  R2_ACCOUNT_ID: 'acct-1234',
  R2_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID',
  R2_SECRET_ACCESS_KEY: 'sUpErSeCrEtVaLuE-do-not-log-me',
  R2_BUCKET: 'port-daddy-media',
}
const SOURCE_COMMIT = 'a'.repeat(40)
const SOURCE_TREE = 'b'.repeat(40)

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function s3Config() {
  return readCredentials(ENV)
}

function acceptedRecord({ expectedManifestETag = null, sha256Hex = pdfSha, bytes = pdf.length, pages = 704 } = {}) {
  return {
    schema: BOOK_RELEASE_ACCEPTANCE_SCHEMA,
    repository: BOOK_RELEASE_REPOSITORY,
    ref: BOOK_RELEASE_MAIN_REF,
    event: 'push',
    environment: BOOK_RELEASE_ENVIRONMENT,
    approved: true,
    authority: { type: 'protected-github-workflow', workflow: BOOK_RELEASE_WORKFLOW_REF },
    expectedManifestETag,
    artifact: { sha256: sha256Hex, bytes, pages },
    source: {
      commit: SOURCE_COMMIT,
      tree: SOURCE_TREE,
      committedAt: '2026-09-19T23:00:00.000Z',
    },
  }
}

function fakeBucket({ preloaded = [], beforePut = () => {}, afterPut = () => {}, putFailure = null } = {}) {
  const objects = new Map()
  const etags = new Map()
  for (const [key, body] of preloaded) {
    const bytes = Buffer.from(body)
    objects.set(key, bytes)
    etags.set(key, '"' + sha256(bytes) + '"')
  }
  const requests = []
  const fetchImpl = async (url, init) => {
    const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'))
    const headers = init.headers ?? {}
    requests.push({ key, method: init.method, headers, body: init.body })
    if (init.method === 'HEAD') {
      return objects.has(key)
        ? { status: 200, ok: true, headers: { etag: etags.get(key) } }
        : { status: 404, ok: false, headers: {} }
    }
    if (init.method === 'GET') {
      if (!objects.has(key)) return { status: 404, ok: false, headers: {}, arrayBuffer: async () => new ArrayBuffer(0) }
      const bytes = objects.get(key)
      return { status: 200, ok: true, headers: { etag: etags.get(key) }, arrayBuffer: async () => bytes }
    }
    if (init.method !== 'PUT') throw new Error('unexpected method ' + init.method)
    beforePut(key, objects, etags)
    if (putFailure?.key === key) return { status: putFailure.status, ok: false, statusText: putFailure.statusText ?? 'failure' }
    if (headers['if-none-match'] === '*' && objects.has(key)) {
      return { status: 412, ok: false, statusText: 'Precondition Failed' }
    }
    if (headers['if-match'] && headers['if-match'] !== etags.get(key)) {
      return { status: 412, ok: false, statusText: 'Precondition Failed' }
    }
    const bytes = Buffer.from(init.body)
    objects.set(key, bytes)
    etags.set(key, '"' + sha256(bytes) + '"')
    afterPut(key, objects, etags)
    return { status: 200, ok: true, headers: { etag: etags.get(key) } }
  }
  return { objects, etags, requests, fetchImpl }
}

const pdf = Buffer.from('%PDF-1.7 immutable Book fixture')
const pdfSha = sha256(pdf)
const archiveKey = archiveKeyFor(pdfSha)
const verifyAcceptance = async () => true

describe('release manifest shape', () => {
  test('names one immutable archive and no mutable PDF pointer', () => {
    const manifest = buildReleaseManifest({
      sha256Hex: pdfSha,
      bytes: pdf.length,
      pages: 704,
      sourceCommit: SOURCE_COMMIT,
      sourceTree: SOURCE_TREE,
      sourceCommittedAt: '2026-09-19T23:00:00.000Z',
      publishedAt: '2026-09-20T00:00:00.000Z',
    })
    expect(manifest).toEqual({
      schema: 'port-daddy.book-release.v1',
      sha256: pdfSha,
      bytes: pdf.length,
      pages: 704,
      sourceCommit: SOURCE_COMMIT,
      sourceTree: SOURCE_TREE,
      sourceCommittedAt: '2026-09-19T23:00:00.000Z',
      publishedAt: '2026-09-20T00:00:00.000Z',
      archiveKey,
      archiveUrl: 'https://media.portdaddy.dev/' + archiveKey,
    })
    expect(Object.values(manifest).join(' ')).not.toContain('current.pdf')
  })

  test('rejects unbound or guessed source metadata', () => {
    expect(() => buildReleaseManifest({
      sha256Hex: pdfSha, bytes: pdf.length, pages: 0,
      sourceCommit: SOURCE_COMMIT, publishedAt: '2026-09-20T00:00:00.000Z',
    })).toThrow(SyncError)
    expect(() => buildReleaseManifest({
      sha256Hex: pdfSha, bytes: pdf.length, pages: 704,
      sourceCommit: 'not-a-commit', publishedAt: '2026-09-20T00:00:00.000Z',
    })).toThrow(SyncError)
  })
})

describe('publishBook', () => {
  test('refuses legacy arbitrary source-commit CLI claims', async () => {
    await expect(main(['book.pdf', '--source-commit', SOURCE_COMMIT])).rejects.toThrow(/unknown argument/)
  })

  test('refuses the undocumented REST transport before any network call', async () => {
    const requests = []
    const config = readCredentials({
      R2_ACCOUNT_ID: ENV.R2_ACCOUNT_ID,
      R2_BUCKET: ENV.R2_BUCKET,
      CLOUDFLARE_API_TOKEN: 'account-token',
    })
    await expect(publishBook(pdf, {
      acceptedRecord: acceptedRecord(), config, verifyAcceptance,
      fetchImpl: async () => { requests.push(true); throw new Error('network forbidden') },
    })).rejects.toThrow(/S3 transport/)
    expect(requests).toHaveLength(0)
  })

  test('requires protected authority verification instead of trusting caller JSON', async () => {
    const bucket = fakeBucket()
    await expect(publishBook(pdf, {
      acceptedRecord: acceptedRecord(), config: s3Config(), fetchImpl: bucket.fetchImpl,
    })).rejects.toThrow(/protected acceptance verifier/)
    expect(bucket.requests).toHaveLength(0)
    await expect(publishBook(pdf, {
      acceptedRecord: acceptedRecord({ sha256Hex: sha256(Buffer.from('forged')) }),
      config: s3Config(), verifyAcceptance, fetchImpl: bucket.fetchImpl,
    })).rejects.toThrow(/SHA-256/)
    expect(bucket.requests).toHaveLength(0)
  })

  test('snapshots mutable PDF and acceptance inputs across async verification', async () => {
    const callerPdf = Buffer.from(pdf)
    const callerRecord = acceptedRecord()
    const bucket = fakeBucket()
    let releaseVerification
    const verificationPending = new Promise((resolve) => { releaseVerification = resolve })
    const verifyMutableInputs = async (snapshot) => {
      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.source)).toBe(true)
      queueMicrotask(() => {
        callerPdf[0] = 0x58
        callerRecord.source.commit = 'c'.repeat(40)
        releaseVerification(true)
      })
      return verificationPending
    }
    const manifest = await publishBook(callerPdf, {
      acceptedRecord: callerRecord,
      config: s3Config(),
      verifyAcceptance: verifyMutableInputs,
      fetchImpl: bucket.fetchImpl,
    })
    expect(bucket.objects.get(archiveKey)).toEqual(pdf)
    expect(manifest.sha256).toBe(pdfSha)
    expect(manifest.sourceCommit).toBe(SOURCE_COMMIT)
    expect(JSON.parse(bucket.objects.get(BOOK_RELEASE_MANIFEST_KEY))).toEqual(manifest)
  })

  test('uploads the immutable archive, then conditionally promotes one manifest', async () => {
    const bucket = fakeBucket()
    const manifest = await publishBook(pdf, {
      acceptedRecord: acceptedRecord(),
      config: s3Config(),
      verifyAcceptance,
      now: () => new Date('2026-09-20T00:00:00.000Z'),
      fetchImpl: bucket.fetchImpl,
    })
    expect(manifest.archiveKey).toBe(archiveKey)
    expect(bucket.objects.get(archiveKey)).toEqual(pdf)
    expect(JSON.parse(bucket.objects.get(BOOK_RELEASE_MANIFEST_KEY))).toEqual(manifest)
    expect(bucket.requests.map(request => request.method + ' ' + request.key)).toEqual([
      'HEAD ' + BOOK_RELEASE_MANIFEST_KEY,
      'HEAD ' + archiveKey,
      'PUT ' + archiveKey,
      'GET ' + archiveKey,
      'PUT ' + BOOK_RELEASE_MANIFEST_KEY,
      'GET ' + BOOK_RELEASE_MANIFEST_KEY,
    ])
    const archivePut = bucket.requests.find(request => request.method === 'PUT' && request.key === archiveKey)
    const manifestPut = bucket.requests.find(request => request.method === 'PUT' && request.key === BOOK_RELEASE_MANIFEST_KEY)
    expect(archivePut.headers['if-none-match']).toBe('*')
    expect(archivePut.headers['cache-control']).toBe(BOOK_CACHE_CONTROL_ARCHIVE)
    expect(manifestPut.headers['if-none-match']).toBe('*')
    expect(manifestPut.headers['cache-control']).toBe(BOOK_CACHE_CONTROL_MANIFEST)
    expect(bucket.requests.every(request => request.key !== 'book/current.pdf')).toBe(true)
    expect(BOOK_RELEASE_MANIFEST_URL).toBe('https://media.portdaddy.dev/' + BOOK_RELEASE_MANIFEST_KEY)
  })

  test('verifies an existing archive before reusing it and conditionally replaces the manifest', async () => {
    const oldManifest = Buffer.from('old manifest')
    const bucket = fakeBucket({
      preloaded: [[archiveKey, pdf], [BOOK_RELEASE_MANIFEST_KEY, oldManifest]],
    })
    const manifest = await publishBook(pdf, {
      acceptedRecord: acceptedRecord({ expectedManifestETag: '"' + sha256(oldManifest) + '"' }), config: s3Config(), verifyAcceptance,
      now: () => new Date('2026-09-20T00:00:00.000Z'), fetchImpl: bucket.fetchImpl,
    })
    const manifestPut = bucket.requests.find(request => request.method === 'PUT' && request.key === BOOK_RELEASE_MANIFEST_KEY)
    expect(bucket.requests.some(request => request.method === 'PUT' && request.key === archiveKey)).toBe(false)
    expect(manifestPut.headers['if-match']).toBe('"' + sha256(oldManifest) + '"')
    expect(JSON.parse(bucket.objects.get(BOOK_RELEASE_MANIFEST_KEY))).toEqual(manifest)
  })

  test('rejects an archive key serving different bytes before touching the release manifest', async () => {
    const bucket = fakeBucket({ preloaded: [[archiveKey, Buffer.from('wrong bytes')]] })
    await expect(publishBook(pdf, {
      acceptedRecord: acceptedRecord(), config: s3Config(), verifyAcceptance, fetchImpl: bucket.fetchImpl,
    })).rejects.toThrow(/immutable archive/)
    expect(bucket.requests.some(request => request.method === 'PUT' && request.key === BOOK_RELEASE_MANIFEST_KEY)).toBe(false)
  })

  test('rejects a stale promotion after a newer manifest wins and preserves the newer manifest', async () => {
    const oldManifest = Buffer.from('old manifest')
    const newerManifest = Buffer.from('newer manifest')
    const bucket = fakeBucket({
      preloaded: [[archiveKey, pdf], [BOOK_RELEASE_MANIFEST_KEY, oldManifest]],
      beforePut: (key, objects, etags) => {
        if (key === BOOK_RELEASE_MANIFEST_KEY && objects.get(key).equals(oldManifest)) {
          objects.set(key, newerManifest)
          etags.set(key, '"' + sha256(newerManifest) + '"')
        }
      },
    })
    await expect(publishBook(pdf, {
      acceptedRecord: acceptedRecord({ expectedManifestETag: '"' + sha256(oldManifest) + '"' }), config: s3Config(), verifyAcceptance, fetchImpl: bucket.fetchImpl,
    })).rejects.toThrow(/stale/)
    expect(bucket.objects.get(BOOK_RELEASE_MANIFEST_KEY)).toEqual(newerManifest)
    expect(bucket.requests.filter(request => request.method === 'PUT' && request.key === BOOK_RELEASE_MANIFEST_KEY)).toHaveLength(1)
  })

  test('rejects an older accepted generation that starts after a newer winner, before archive writes', async () => {
    const oldManifest = Buffer.from('old manifest')
    const newerManifest = Buffer.from('newer manifest')
    const bucket = fakeBucket({ preloaded: [[archiveKey, pdf], [BOOK_RELEASE_MANIFEST_KEY, newerManifest]] })
    await expect(publishBook(pdf, {
      acceptedRecord: acceptedRecord({ expectedManifestETag: '"' + sha256(oldManifest) + '"' }),
      config: s3Config(), verifyAcceptance, fetchImpl: bucket.fetchImpl,
    })).rejects.toThrow(/live pointer has moved/)
    expect(bucket.objects.get(BOOK_RELEASE_MANIFEST_KEY)).toEqual(newerManifest)
    expect(bucket.requests).toEqual([
      expect.objectContaining({ method: 'HEAD', key: BOOK_RELEASE_MANIFEST_KEY }),
    ])
    expect(bucket.requests.some(request => request.method === 'PUT')).toBe(false)
  })

  test('preserves the existing manifest when the conditional write fails', async () => {
    const oldManifest = Buffer.from('old manifest')
    const bucket = fakeBucket({
      preloaded: [[archiveKey, pdf], [BOOK_RELEASE_MANIFEST_KEY, oldManifest]],
      putFailure: { key: BOOK_RELEASE_MANIFEST_KEY, status: 503, statusText: 'unavailable' },
    })
    await expect(publishBook(pdf, {
      acceptedRecord: acceptedRecord({ expectedManifestETag: '"' + sha256(oldManifest) + '"' }), config: s3Config(), verifyAcceptance, fetchImpl: bucket.fetchImpl,
    })).rejects.toThrow(/existing release was preserved/)
    expect(bucket.objects.get(BOOK_RELEASE_MANIFEST_KEY)).toEqual(oldManifest)
  })

  test('rejects a post-upload archive hash mismatch before manifest promotion', async () => {
    const bucket = fakeBucket({
      afterPut: (key, objects) => {
        if (key === archiveKey) objects.set(key, Buffer.from('tampered archive'))
      },
    })
    await expect(publishBook(pdf, {
      acceptedRecord: acceptedRecord(), config: s3Config(), verifyAcceptance, fetchImpl: bucket.fetchImpl,
    })).rejects.toThrow(/immutable archive/)
    expect(bucket.requests.some(request => request.method === 'PUT' && request.key === BOOK_RELEASE_MANIFEST_KEY)).toBe(false)
  })
})
