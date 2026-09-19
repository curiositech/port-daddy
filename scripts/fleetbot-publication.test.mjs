import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  buildPublicationPackage,
  decodePublicationPackage,
  encodePublicationPackage,
  hydratePublicationPackage,
  MAX_ENCODED_CHARACTERS,
  MAX_UNCOMPRESSED_BYTES,
  validatePublicationPackage,
} from './fleetbot-publication.mjs'

const ROOT = join(homedir(), 'coding', 'tmp')
const GIT_ENV = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '--no-pager', '-C', cwd, ...args], { env: GIT_ENV, encoding: 'utf8' }).trim()
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function rawTransport(token) {
  const envelope = JSON.parse(token)
  return JSON.parse(gunzipSync(Buffer.from(envelope.data, 'base64')).toString('utf8'))
}

function transportToken(value) {
  return JSON.stringify({ encoding: 'gzip+base64', data: gzipSync(Buffer.from(stableJson(value), 'utf8')).toString('base64') })
}

function fixture() {
  mkdirSync(ROOT, { recursive: true })
  const cwd = mkdtempSync(join(ROOT, 'fleetbot-publication-test-'))
  git(cwd, 'init', '-b', 'main'); git(cwd, 'config', 'user.name', 'Publication Fixture'); git(cwd, 'config', 'user.email', 'fixture@example.invalid')
  writeFileSync(join(cwd, 'keep.txt'), 'base\n')
  writeFileSync(join(cwd, 'delete.txt'), 'delete me\n')
  writeFileSync(join(cwd, 'rename.txt'), 'rename me\n')
  writeFileSync(join(cwd, 'mode.sh'), '#!/bin/sh\necho base\n')
  writeFileSync(join(cwd, 'unchanged:colon.txt'), 'preserve this committed path\n')
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-m', 'fixture base')
  const baseSha = git(cwd, 'rev-parse', 'HEAD')
  git(cwd, 'switch', '-c', 'codex/publication-fixture')
  writeFileSync(join(cwd, 'keep.txt'), 'changed\n')
  writeFileSync(join(cwd, 'binary.bin'), Buffer.from([0, 255, 1, 2, 3]))
  chmodSync(join(cwd, 'mode.sh'), 0o755)
  symlinkSync('keep.txt', join(cwd, 'link'))
  unlinkSync(join(cwd, 'delete.txt'))
  git(cwd, 'mv', 'rename.txt', 'renamed.txt')
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-m', 'fixture publication')
  const headSha = git(cwd, 'rev-parse', 'HEAD')
  return { cwd, baseSha, headSha, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

function deltaCliFixture() {
  mkdirSync(ROOT, { recursive: true })
  const cwd = mkdtempSync(join(ROOT, 'fleetbot-publication-cli-delta-'))
  git(cwd, 'init', '-b', 'main'); git(cwd, 'config', 'user.name', 'Publication Fixture'); git(cwd, 'config', 'user.email', 'fixture@example.invalid')
  const base = Buffer.alloc(128 * 1024, 0x61)
  writeFileSync(join(cwd, 'large.bin'), base)
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'delta base')
  const baseSha = git(cwd, 'rev-parse', 'HEAD')
  git(cwd, 'switch', '-c', 'codex/publication-cli-delta')
  const target = Buffer.from(base); target.fill(0x62, 64 * 1024, 64 * 1024 + 32)
  writeFileSync(join(cwd, 'large.bin'), target)
  git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'delta publication')
  return { cwd, baseSha, cleanup: () => rmSync(cwd, { recursive: true, force: true }) }
}

function submoduleDeletionFixture() {
  mkdirSync(ROOT, { recursive: true })
  const cwd = mkdtempSync(join(ROOT, 'fleetbot-publication-submodule-'))
  const nested = mkdtempSync(join(ROOT, 'fleetbot-publication-nested-'))
  git(nested, 'init', '-b', 'main'); git(nested, 'config', 'user.name', 'Nested'); git(nested, 'config', 'user.email', 'nested@example.invalid')
  writeFileSync(join(nested, 'nested.txt'), 'nested\n'); git(nested, 'add', '.'); git(nested, 'commit', '-m', 'nested')
  const nestedSha = git(nested, 'rev-parse', 'HEAD')
  git(cwd, 'init', '-b', 'main'); git(cwd, 'config', 'user.name', 'Publication Fixture'); git(cwd, 'config', 'user.email', 'fixture@example.invalid')
  git(cwd, 'update-index', '--add', '--cacheinfo', `160000,${nestedSha},submodule`); git(cwd, 'commit', '-m', 'submodule base')
  const baseSha = git(cwd, 'rev-parse', 'HEAD'); git(cwd, 'switch', '-c', 'codex/submodule-delete')
  git(cwd, 'rm', 'submodule'); git(cwd, 'commit', '-m', 'delete submodule')
  return { cwd, baseSha, cleanup: () => { rmSync(cwd, { recursive: true, force: true }); rmSync(nested, { recursive: true, force: true }) } }
}

describe('offline Fleetbot publication package', () => {
  it('packages the exact committed binary, mode, symlink, deletion, and A/D rename delta', () => {
    const f = fixture()
    try {
      const value = buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'Fixture publication', body: 'Roadmap-Item: fixture' })
      assert.equal(value.payload.baseBranch, 'main')
      assert.equal(value.payload.sourceHeadSha, f.headSha)
      assert.equal(value.sourceBranch, 'codex/publication-fixture')
      assert.equal(value.payload.draft, false)
      assert.equal(value.payload.changes.length, 7)
      assert.deepEqual(value.payload.changes.find(c => c.path === 'delete.txt'), { path: 'delete.txt', delete: true })
      assert.ok(value.payload.changes.some(c => c.path === 'rename.txt' && c.delete))
      assert.ok(value.payload.changes.some(c => c.path === 'renamed.txt' && c.contentBase64))
      assert.equal(value.payload.changes.find(c => c.path === 'mode.sh').mode, '100755')
      assert.equal(Buffer.from(value.payload.changes.find(c => c.path === 'binary.bin').contentBase64, 'base64')[1], 255)
      assert.equal(Buffer.from(value.payload.changes.find(c => c.path === 'link').contentBase64, 'base64').toString(), 'keep.txt')
      assert.equal(value.payload.changes.some(c => c.path === 'unchanged:colon.txt'), false)
      writeFileSync(join(f.cwd, 'changed:colon.txt'), 'unsafe changed path\n')
      git(f.cwd, 'add', 'changed:colon.txt'); git(f.cwd, 'commit', '-m', 'unsafe changed path')
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'Fixture publication', body: 'Roadmap-Item: fixture' }), /changed Git path/)
      const decoded = decodePublicationPackage(encodePublicationPackage(value))
      assert.deepEqual(decoded, value)
    } finally { f.cleanup() }
  })

  it('uses canonical UTF-8 transport text while retaining base64 for binary bytes', () => {
    const f = fixture()
    try {
      const value = buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' })
      const unicodeBytes = Buffer.from('héllo 世界\n', 'utf8')
      const unicodeValue = {
        ...value,
        payload: {
          ...value.payload,
          changes: value.payload.changes.map(change => change.path === 'keep.txt'
            ? { path: change.path, mode: change.mode, contentBase64: unicodeBytes.toString('base64') }
            : change),
        },
      }
      const unicodeRaw = rawTransport(encodePublicationPackage(unicodeValue))
      const unicodeChange = unicodeRaw.payload.changes.find(change => change.path === 'keep.txt')
      assert.equal(unicodeChange.contentUtf8, 'héllo 世界\n')
      assert.equal(Object.hasOwn(unicodeChange, 'contentBase64'), false)
      assert.deepEqual(decodePublicationPackage(transportToken(unicodeRaw)), unicodeValue)
      const binaryRaw = rawTransport(encodePublicationPackage(value))
      const binaryChange = binaryRaw.payload.changes.find(change => change.path === 'binary.bin')
      assert.equal(Object.hasOwn(binaryChange, 'contentUtf8'), false)
      assert.equal(typeof binaryChange.contentBase64, 'string')

      const base = Buffer.alloc(64 * 1024, 0x41)
      const invalidMiddle = Buffer.from(base)
      invalidMiddle[32 * 1024] = 0xff
      const invalidValue = {
        ...value,
        payload: {
          ...value.payload,
          changes: value.payload.changes.map(change => change.path === 'keep.txt'
            ? { path: change.path, mode: change.mode, contentBase64: invalidMiddle.toString('base64') }
            : change),
        },
      }
      const invalidRaw = rawTransport(encodePublicationPackage(invalidValue, { baseBlobs: new Map([['keep.txt', base]]) }))
      const invalidChange = invalidRaw.payload.changes.find(change => change.path === 'keep.txt')
      assert.equal(Object.hasOwn(invalidChange, 'contentUtf8'), false)
      assert.equal(Buffer.from(invalidChange.contentBase64, 'base64').toString('hex'), 'ff')

      const emptyTarget = Buffer.alloc(64 * 1024, 0x63)
      const emptyValue = {
        ...value,
        payload: {
          ...value.payload,
          changes: value.payload.changes.map(change => change.path === 'keep.txt'
            ? { path: change.path, mode: change.mode, contentBase64: emptyTarget.toString('base64') }
            : change),
        },
      }
      const emptyDeltaRaw = rawTransport(encodePublicationPackage(emptyValue, { baseBlobs: new Map([['keep.txt', emptyTarget]]) }))
      const emptyDelta = emptyDeltaRaw.payload.changes.find(change => change.path === 'keep.txt')
      assert.equal(emptyDelta.contentUtf8, '')
      assert.equal(decodePublicationPackage(transportToken(emptyDeltaRaw)).payload.changes.find(change => change.path === 'keep.txt').contentBase64, '')

      const duplicate = structuredClone(unicodeRaw)
      const duplicateChange = duplicate.payload.changes.find(change => change.path === 'keep.txt')
      duplicateChange.contentBase64 = unicodeBytes.toString('base64')
      assert.throws(() => decodePublicationPackage(transportToken(duplicate)), /unsupported|fields|representation/)
      const invalidText = structuredClone(unicodeRaw)
      const invalidTextChange = invalidText.payload.changes.find(change => change.path === 'keep.txt')
      delete invalidTextChange.contentBase64
      invalidTextChange.contentUtf8 = '\ud800'
      assert.throws(() => decodePublicationPackage(transportToken(invalidText)), /canonical UTF-8|representation/)
    } finally { f.cleanup() }
  })

  it('refuses empty changed blobs because Relay rejects zero-byte content', () => {
    const f = fixture()
    try {
      writeFileSync(join(f.cwd, 'empty.txt'), '')
      git(f.cwd, 'add', 'empty.txt'); git(f.cwd, 'commit', '-m', 'empty')
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' }), /zero-byte/)
    } finally { f.cleanup() }
  })

  it('uses bounded base-blob deltas and hydrates them only with the exact base hash', async () => {
    const f = fixture()
    try {
      const value = buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' })
      const target = Buffer.alloc(64 * 1024, 0x00)
      for (let index = 0; index < target.length; index += 257) target[index] = index % 256
      const base = Buffer.from(target)
      const changes = value.payload.changes.map(change => change.path === 'keep.txt'
        ? { path: change.path, mode: change.mode, contentBase64: target.toString('base64') }
        : change)
      const expanded = { ...value, payload: { ...value.payload, changes } }
      const token = encodePublicationPackage(expanded, { baseBlobs: new Map([['keep.txt', base]]) })
      const transport = decodePublicationPackage(token)
      const delta = transport.payload.changes.find(change => change.path === 'keep.txt')
      assert.equal(typeof delta.baseBlobSha, 'string')
      assert.equal(delta.contentBase64.length, 0)
      assert.deepEqual(transport.payload.changes.find(change => change.path === 'delete.txt'), { path: 'delete.txt', delete: true })
      const seen = []
      const hydrated = await hydratePublicationPackage(transport, {
        readBaseBlob: async (baseSha, path) => { seen.push([baseSha, path]); return base },
      })
      assert.deepEqual(hydrated, expanded)
      assert.deepEqual(seen, [[delta.baseBlobSha, 'keep.txt']])
      await assert.rejects(() => hydratePublicationPackage(transport, {
        readBaseBlob: async () => Buffer.from('wrong base'),
      }), /base blob hash mismatch/)

      const overlap = structuredClone(transport); overlap.payload.changes.find(change => change.path === 'keep.txt').prefixBytes = base.length + 1
      await assert.rejects(() => hydratePublicationPackage(overlap, { readBaseBlob: async () => base }), /overlap/)
      const fractional = structuredClone(transport); fractional.payload.changes.find(change => change.path === 'keep.txt').suffixBytes = 1.5
      await assert.rejects(() => hydratePublicationPackage(fractional, { readBaseBlob: async () => base }), /invalid/)
      const negative = structuredClone(transport); negative.payload.changes.find(change => change.path === 'keep.txt').prefixBytes = -1
      await assert.rejects(() => hydratePublicationPackage(negative, { readBaseBlob: async () => base }), /invalid/)
      const tooLarge = structuredClone(transport); tooLarge.payload.changes.find(change => change.path === 'keep.txt').prefixBytes = 4 * 1024 * 1024
      tooLarge.payload.changes.find(change => change.path === 'keep.txt').suffixBytes = 1
      const largeBase = Buffer.alloc(4 * 1024 * 1024 + 1, 8)
      tooLarge.payload.changes.find(change => change.path === 'keep.txt').baseBlobSha = createHash('sha1').update(`blob ${largeBase.length}\0`).update(largeBase).digest('hex')
      await assert.rejects(() => hydratePublicationPackage(tooLarge, { readBaseBlob: async () => largeBase }), /exceeds 4 MiB/)
      const aggregateBase = Buffer.alloc(4 * 1024 * 1024, 9)
      const aggregateSha = createHash('sha1').update(`blob ${aggregateBase.length}\0`).update(aggregateBase).digest('hex')
      const aggregate = structuredClone(transport)
      aggregate.payload.changes = ['a.bin', 'b.bin', 'c.bin'].map(path => ({ path, mode: '100644', baseBlobSha: aggregateSha, prefixBytes: aggregateBase.length, suffixBytes: 0, contentBase64: '' }))
      await assert.rejects(() => hydratePublicationPackage(aggregate, { readBaseBlob: async () => aggregateBase }), /8 MiB total/)
    } finally { f.cleanup() }
  })

  it('ignores untracked excluded files but rejects dirty, detached, base-branch, and stale source inputs', () => {
    const f = fixture()
    try {
      writeFileSync(join(f.cwd, 'dirty.txt'), 'uncommitted')
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' }), /clean/)
      unlinkSync(join(f.cwd, 'dirty.txt'))
      writeFileSync(join(f.cwd, '.gitignore'), 'ignored.txt\n'); git(f.cwd, 'add', '.gitignore'); git(f.cwd, 'commit', '-m', 'ignore')
      writeFileSync(join(f.cwd, 'ignored.txt'), 'ignored')
      assert.doesNotThrow(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' }))
      unlinkSync(join(f.cwd, 'ignored.txt')); unlinkSync(join(f.cwd, '.gitignore')); git(f.cwd, 'reset', '--hard', 'HEAD^')
      git(f.cwd, 'switch', 'main')
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' }), /development branch/)
      git(f.cwd, 'switch', 'codex/publication-fixture'); git(f.cwd, 'reset', '--hard', f.headSha)
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, headSha: f.baseSha, title: 'x', body: 'x' }), /HEAD/)
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.headSha, title: 'x', body: 'x' }), /committed changed/)
      git(f.cwd, 'switch', '--detach', f.headSha)
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' }), /sourceBranch/)
    } finally { f.cleanup() }
  })

  it('rejects hostile package structure, future dates, unsafe paths, and unsupported modes', () => {
    const f = fixture()
    try {
      const value = buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' })
      assert.throws(() => validatePublicationPackage({ ...value, extra: true }), /unsupported/)
      assert.throws(() => validatePublicationPackage({ ...value, payload: { ...value.payload, sourceCommittedAt: Math.floor(Date.now() / 1000) + 301 } }), /time range/)
      assert.throws(() => validatePublicationPackage({ ...value, payload: { ...value.payload, title: 'two\nlines' } }), /one line/)
      assert.throws(() => validatePublicationPackage({ ...value, payload: { ...value.payload, changes: [{ path: '../escape', delete: true }] } }), /unsafe/)
      assert.throws(() => validatePublicationPackage({ ...value, payload: { ...value.payload, changes: [{ path: 'x', mode: '160000', contentBase64: 'YQ==' }] } }), /unsupported/)
      const duplicate = value.payload.changes.concat(value.payload.changes[0])
      assert.throws(() => validatePublicationPackage({ ...value, payload: { ...value.payload, changes: duplicate } }), /duplicate/)
    } finally { f.cleanup() }
  })

  it('refuses deletion of a committed submodule entry', () => {
    const f = submoduleDeletionFixture()
    try {
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' }), /submodule/)
    } finally { f.cleanup() }
  })

  it('enforces changed-path and blob budgets and refuses configured helpers', () => {
    const f = fixture()
    try {
      const value = buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' })
      const many = Array.from({ length: 101 }, (_, index) => ({ path: `delete-${index}.txt`, delete: true }))
      assert.throws(() => validatePublicationPackage({ ...value, payload: { ...value.payload, changes: many } }), /1-100/)
      const large = Buffer.alloc(4 * 1024 * 1024 + 1, 7).toString('base64')
      assert.throws(() => validatePublicationPackage({ ...value, payload: { ...value.payload, changes: [{ path: 'large.bin', mode: '100644', contentBase64: large }] } }), /4 MiB/)
      const threeMeg = Buffer.alloc(3 * 1024 * 1024, 7).toString('base64')
      const aggregate = [1, 2, 3].map(index => ({ path: `large-${index}.bin`, mode: '100644', contentBase64: threeMeg }))
      assert.throws(() => validatePublicationPackage({ ...value, payload: { ...value.payload, changes: aggregate } }), /8 MiB/)
      const marker = join(ROOT, 'publication-filter-marker')
      writeFileSync(join(f.cwd, '.gitattributes'), 'keep.txt filter=marker\n')
      git(f.cwd, 'add', '.gitattributes'); git(f.cwd, 'commit', '-m', 'configure custom filter')
      rmSync(marker, { force: true }); git(f.cwd, 'config', 'filter.marker.clean', `touch ${marker}`)
      assert.throws(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' }), /filters or helpers/)
      assert.equal(existsSync(marker), false)
    } finally { f.cleanup() }
  })

  it('neutralizes the repository LFS filter keys without running their marker commands', () => {
    const f = fixture()
    try {
      const marker = join(ROOT, 'publication-lfs-marker')
      rmSync(marker, { force: true })
      git(f.cwd, 'config', 'filter.lfs.process', `touch ${marker}`)
      git(f.cwd, 'config', 'filter.lfs.clean', `touch ${marker}`)
      git(f.cwd, 'config', 'filter.lfs.smudge', `touch ${marker}`)
      git(f.cwd, 'config', 'filter.lfs.required', 'true')
      assert.doesNotThrow(() => buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' }))
      assert.equal(existsSync(marker), false)
    } finally { f.cleanup() }
  })

  it('rejects invalid, truncated, concatenated, and trailing token data', () => {
    const f = fixture()
    try {
      const value = buildPublicationPackage({ cwd: f.cwd, repository: 'curiositech/port-daddy', baseSha: f.baseSha, title: 'x', body: 'x' })
      const token = encodePublicationPackage(value); const envelope = JSON.parse(token); const compressed = Buffer.from(envelope.data, 'base64')
      assert.throws(() => decodePublicationPackage(`${token}x`), /JSON/)
      assert.throws(() => decodePublicationPackage(JSON.stringify({ encoding: 'gzip+base64', data: Buffer.concat([compressed, compressed]).toString('base64') })), /trailing|concatenated/)
      assert.throws(() => decodePublicationPackage(JSON.stringify({ encoding: 'gzip+base64', data: compressed.subarray(0, compressed.length - 1).toString('base64') })), /gzip|truncated/)
      assert.throws(() => decodePublicationPackage(JSON.stringify({ encoding: 'gzip+base64', data: '!!!!' })), /base64/)
      assert.throws(() => decodePublicationPackage(JSON.stringify({ encoding: 'gzip+base64', data: gzipSync(Buffer.from('{}')).toString('base64'), extra: true })), /unsupported|fields/)
      assert.throws(() => decodePublicationPackage(JSON.stringify({ encoding: 'gzip+base64', data: gzipSync(Buffer.alloc(MAX_UNCOMPRESSED_BYTES + 1)).toString('base64') })), /output bound/)
      const huge = JSON.stringify({ encoding: 'gzip+base64', data: 'A'.repeat(MAX_ENCODED_CHARACTERS + 1) })
      assert.throws(() => decodePublicationPackage(huge), /48,000/)
    } finally { f.cleanup() }
  })

  it('emits a token file and JSON summary without overwriting an existing file', () => {
    const f = fixture()
    const inputs = mkdtempSync(join(ROOT, 'fleetbot-publication-cli-'))
    try {
      const titlePath = join(inputs, 'title.txt'); const bodyPath = join(inputs, 'body.txt'); const output = join(inputs, 'package.token')
      writeFileSync(titlePath, 'CLI title\n'); writeFileSync(bodyPath, 'CLI body')
      const script = fileURLToPath(new URL('./fleetbot-publication.mjs', import.meta.url))
      const summary = execFileSync(process.execPath, [script, 'prepare', '--base', f.baseSha, '--repository', 'curiositech/port-daddy', '--title-file', titlePath, '--body-file', bodyPath, '--output', output], { cwd: f.cwd, env: GIT_ENV, encoding: 'utf8' })
      const parsed = JSON.parse(summary); const decoded = decodePublicationPackage(readFileSync(output, 'utf8').trim())
      assert.equal(parsed.output, output); assert.equal(decoded.repository, 'curiositech/port-daddy'); assert.equal(decoded.payload.title, 'CLI title')
      assert.match(parsed.sha256, /^[0-9a-f]{64}$/)
      assert.throws(() => execFileSync(process.execPath, [script, 'prepare', '--base', f.baseSha, '--repository', 'curiositech/port-daddy', '--title-file', titlePath, '--body-file', bodyPath, '--output', output], { cwd: f.cwd, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' }))
    } finally { f.cleanup(); rmSync(inputs, { recursive: true, force: true }) }
  })

  it('CLI prepares a compact delta token from committed base blobs', () => {
    const f = deltaCliFixture()
    const inputs = mkdtempSync(join(ROOT, 'fleetbot-publication-cli-delta-input-'))
    try {
      const titlePath = join(inputs, 'title.txt'); const bodyPath = join(inputs, 'body.txt'); const output = join(inputs, 'package.token')
      writeFileSync(titlePath, 'CLI delta\n'); writeFileSync(bodyPath, 'CLI delta body')
      const script = fileURLToPath(new URL('./fleetbot-publication.mjs', import.meta.url))
      execFileSync(process.execPath, [script, 'prepare', '--base', f.baseSha, '--repository', 'curiositech/port-daddy', '--title-file', titlePath, '--body-file', bodyPath, '--output', output], { cwd: f.cwd, env: GIT_ENV, encoding: 'utf8' })
      const transport = decodePublicationPackage(readFileSync(output, 'utf8').trim())
      assert.equal(transport.payload.changes.length, 1)
      assert.equal(typeof transport.payload.changes[0].baseBlobSha, 'string')
      assert.equal(transport.payload.changes[0].contentBase64.length, 44)
    } finally { f.cleanup(); rmSync(inputs, { recursive: true, force: true }) }
  })
})
