#!/usr/bin/env node

/**
 * Build a data-only publication package from committed Git objects.
 * This module deliberately has no credentials, network, hooks, or remote writes.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, gzipSync, inflateRawSync } from 'node:zlib'

export const PUBLICATION_SCHEMA = 'port-daddy.fleetbot-publication.v1'
export const MAX_ENCODED_CHARACTERS = 48_000
export const MAX_UNCOMPRESSED_BYTES = 12 * 1024 * 1024
const MAX_CHANGE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_CHANGE_BYTES = 8 * 1024 * 1024
const MAX_CHANGES = 100
const MAX_COMMIT_MESSAGE_BYTES = 8_000
const MAX_TITLE_BYTES = 256
const MAX_BODY_BYTES = 1_000_000
const SHA_RE = /^[0-9a-f]{40}$/
const REPOSITORY_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/
const MODES = new Set(['100644', '100755', '120000'])
const ROOT_KEYS = ['payload', 'repository', 'schema', 'sourceBranch']
const PAYLOAD_KEYS = ['baseBranch', 'baseSha', 'sourceHeadSha', 'sourceTreeSha', 'sourceCommittedAt', 'commitMessage', 'changes', 'title', 'body', 'draft']

const fail = (message) => { throw new Error(message) }

function exactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${name} contains unsupported or missing fields`)
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function byteLength(value) { return Buffer.byteLength(value, 'utf8') }

function boundedText(value, name, maxBytes, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)
      || value.includes('\0') || byteLength(value) > maxBytes) {
    fail(`${name} is empty, contains NUL, or exceeds ${maxBytes} UTF-8 bytes`)
  }
  return value
}

function boundedTitle(value) {
  boundedText(value, 'title', MAX_TITLE_BYTES)
  if (/[\r\n]/.test(value)) fail('title must be one line')
  return value
}

function safeRef(value, name) {
  boundedText(value, name, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value)
      || value.includes('..') || value.includes('//') || value.includes('@{')
      || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) {
    fail(`${name} is not a safe Git ref`)
  }
  return value
}

function safePath(value) {
  return typeof value === 'string' && byteLength(value) <= 1024
    && !/[\\\x00-\x1f\x7f:]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..')
}

function base64Bytes(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 === 1
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
      || Buffer.from(value, 'base64').toString('base64') !== value) {
    fail(`${name} must be canonical non-empty base64`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0) fail(`${name} must not encode an empty blob`)
  return bytes
}

function sha(value, name) {
  if (typeof value !== 'string' || !SHA_RE.test(value)) fail(`${name} must be one lowercase Git SHA-1`)
  return value
}

function gitObjectSha(type, bytes) {
  return createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex')
}

function validateChange(change, paths, totals) {
  if (!change || typeof change !== 'object' || Array.isArray(change) || !safePath(change.path) || paths.has(change.path)) {
    fail('changes contain an unsafe or duplicate path')
  }
  paths.add(change.path)
  if (change.delete === true) {
    exactKeys(change, ['path', 'delete'], 'deletion')
    return
  }
  exactKeys(change, ['path', 'mode', 'contentBase64'], 'blob change')
  if (!MODES.has(change.mode)) fail('changed file mode is unsupported')
  const bytes = base64Bytes(change.contentBase64, 'contentBase64')
  if (bytes.length > MAX_CHANGE_BYTES) fail('one changed blob exceeds 4 MiB')
  totals.value += bytes.length
  if (totals.value > MAX_TOTAL_CHANGE_BYTES) fail('changed blobs exceed 8 MiB total')
}

/** Validate the exact Relay-compatible package shape and return the same value. */
export function validatePublicationPackage(value, { now = Math.floor(Date.now() / 1000) } = {}) {
  exactKeys(value, ROOT_KEYS, 'publication package')
  if (value.schema !== PUBLICATION_SCHEMA || typeof value.repository !== 'string' || !REPOSITORY_RE.test(value.repository)) {
    fail('publication schema or repository is invalid')
  }
  safeRef(value.sourceBranch, 'sourceBranch')
  exactKeys(value.payload, PAYLOAD_KEYS, 'publication payload')
  const payload = value.payload
  safeRef(payload.baseBranch, 'baseBranch')
  sha(payload.baseSha, 'baseSha'); sha(payload.sourceHeadSha, 'sourceHeadSha'); sha(payload.sourceTreeSha, 'sourceTreeSha')
  if (!Number.isSafeInteger(payload.sourceCommittedAt) || payload.sourceCommittedAt <= 0
      || payload.sourceCommittedAt > now + 300) fail('sourceCommittedAt is outside the accepted time range')
  boundedText(payload.commitMessage, 'commitMessage', MAX_COMMIT_MESSAGE_BYTES)
  boundedTitle(payload.title)
  boundedText(payload.body, 'body', MAX_BODY_BYTES)
  if (payload.draft !== false) fail('publication payload must be non-draft')
  if (!Array.isArray(payload.changes) || payload.changes.length < 1 || payload.changes.length > MAX_CHANGES) {
    fail('changes must contain 1-100 entries')
  }
  const paths = new Set(); const totals = { value: 0 }
  for (const change of payload.changes) validateChange(change, paths, totals)
  return value
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function decodeGzipStrict(bytes) {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8 || bytes[3] !== 0) {
    fail('publication token is not one canonical gzip member')
  }
  const compressed = bytes.subarray(10)
  let inflated
  let consumed
  try {
    const result = inflateRawSync(compressed, {
      info: true,
      finishFlush: constants.Z_FINISH,
      maxOutputLength: MAX_UNCOMPRESSED_BYTES,
    })
    inflated = result.buffer
    consumed = result.engine.bytesWritten
  } catch {
    fail('publication token gzip data is truncated, invalid, or exceeds the output bound')
  }
  if (!Number.isSafeInteger(consumed) || consumed < 1 || 10 + consumed + 8 !== bytes.length) {
    fail('publication token contains trailing or concatenated gzip data')
  }
  const footer = bytes.subarray(10 + consumed)
  if (footer.readUInt32LE(0) !== crc32(inflated) || footer.readUInt32LE(4) !== (inflated.length >>> 0)) {
    fail('publication token gzip checksum is invalid')
  }
  return inflated
}

export function encodePublicationPackage(value) {
  validatePublicationPackage(value)
  const plain = Buffer.from(stableJson(value), 'utf8')
  if (plain.length > MAX_UNCOMPRESSED_BYTES) fail('publication package exceeds the 12 MiB uncompressed bound')
  const token = JSON.stringify({ encoding: 'gzip+base64', data: gzipSync(plain).toString('base64') })
  if (token.length > MAX_ENCODED_CHARACTERS) fail('compressed publication token exceeds 48,000 characters')
  return token
}

export function decodePublicationPackage(encoded) {
  if (typeof encoded !== 'string' || encoded.length > MAX_ENCODED_CHARACTERS) fail('publication token is missing or exceeds 48,000 characters')
  let envelope
  try { envelope = JSON.parse(encoded) } catch { fail('publication token is not valid JSON') }
  exactKeys(envelope, ['encoding', 'data'], 'publication token envelope')
  if (envelope.encoding !== 'gzip+base64') fail('publication token encoding is unsupported')
  const compressed = base64Bytes(envelope.data, 'publication token data')
  const plain = decodeGzipStrict(compressed)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(plain) } catch { fail('publication package is not valid UTF-8') }
  let value
  try { value = JSON.parse(text) } catch { fail('publication package is not valid JSON') }
  validatePublicationPackage(value)
  if (stableJson(value) !== text) fail('publication package is not canonical or contains trailing data')
  return value
}

const GIT_ENV = {
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  LC_ALL: 'C', LANG: 'C', TZ: 'UTC',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_ALLOW_PROTOCOL: '',
}

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', [
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'credential.helper=',
      '-c', 'protocol.allow=never', '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never', '-c', 'filter.lfs.process=',
      '-c', 'filter.lfs.clean=', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false',
      '--no-pager', '-C', cwd, ...args,
    ], {
      env: GIT_ENV, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    if (allowFailure) return null
    fail(`Git could not read the committed source objects (${args[0]})`)
  }
}

function gitConfig(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', [
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'credential.helper=',
      '-c', 'protocol.allow=never', '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never',
      '--no-pager', '-C', cwd, ...args,
    ], { env: GIT_ENV, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    if (allowFailure) return null
    fail(`Git could not read repository configuration (${args[0]})`)
  }
}

function gitText(cwd, args) {
  const bytes = git(cwd, args)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { fail('Git returned non-UTF-8 metadata') }
}

function resolveCommit(cwd, ref) {
  const output = gitText(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  sha(output, 'resolved commit')
  return output
}

function parseTree(cwd, commit, wantedPaths) {
  const bytes = git(cwd, ['ls-tree', '-r', '-z', '--full-tree', commit])
  const entries = new Map()
  let start = 0
  for (let end = 0; end <= bytes.length; end += 1) {
    if (end !== bytes.length && bytes[end] !== 0) continue
    const row = bytes.subarray(start, end); start = end + 1
    if (row.length === 0) continue
    const tab = row.indexOf(9); if (tab < 0) fail('Git tree entry is malformed')
    let header
    try { header = new TextDecoder('utf-8', { fatal: true }).decode(row.subarray(0, tab)) } catch { fail('Git tree metadata is not valid UTF-8') }
    const rawPath = row.subarray(tab + 1)
    if (wantedPaths && !wantedPaths.has(rawPath.toString('hex'))) continue
    let path
    try { path = new TextDecoder('utf-8', { fatal: true }).decode(rawPath) } catch { fail('changed Git path is not valid UTF-8') }
    if (!safePath(path)) fail('changed Git path cannot be represented safely in publication JSON')
    const [mode, type, objectSha] = header.split(' ')
    if (!mode || !type || !SHA_RE.test(objectSha ?? '')) fail('Git tree entry is malformed')
    entries.set(path, { mode, type, sha: objectSha })
  }
  return entries
}

function parseDiff(cwd, base, head) {
  const bytes = git(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', base, head])
  const fields = []; let start = 0
  for (let end = 0; end <= bytes.length; end += 1) {
    if (end !== bytes.length && bytes[end] !== 0) continue
    const field = bytes.subarray(start, end); start = end + 1
    if (field.length === 0) continue
    fields.push(field)
  }
  const changes = []
  for (let index = 0; index < fields.length; index += 2) {
    let status; let path
    try {
      status = new TextDecoder('utf-8', { fatal: true }).decode(fields[index])
      path = new TextDecoder('utf-8', { fatal: true }).decode(fields[index + 1])
    } catch { fail('changed Git path is not valid UTF-8') }
    if (!path || !/^[A-Z]$/.test(status) || !safePath(path)) fail('changed Git path cannot be represented safely in publication JSON')
    const rawPathHex = fields[index + 1].toString('hex')
    if (status === 'D') changes.push({ path, rawPathHex, delete: true })
    else if (status === 'A' || status === 'M' || status === 'T') changes.push({ path, rawPathHex, _status: status })
    else fail('Git diff contains a rename, copy, or unresolved path')
  }
  if (fields.length % 2 !== 0) fail('Git diff output is malformed')
  return changes
}

function rejectConfiguredFilters(cwd) {
  const configured = gitConfig(cwd, ['config', '--null', '--get-regexp', '^filter\\..+\\.(process|clean|smudge|required)$'], { allowFailure: true })
  if (!configured || configured.length === 0) return
  const records = configured.toString('utf8').split('\0').filter(Boolean)
  const allowed = new Set(['filter.lfs.process', 'filter.lfs.clean', 'filter.lfs.smudge', 'filter.lfs.required'])
  for (const record of records) {
    const key = record.split('\n', 1)[0]?.toLowerCase()
    if (!allowed.has(key)) fail('publication refuses repositories with configured Git filters or helpers')
  }
}

function buildChange(cwd, baseTree, headTree, item) {
  if (item.delete) {
    if (!baseTree.has(item.path) || headTree.has(item.path)) fail('Git diff and committed trees disagree')
    if (baseTree.get(item.path).type !== 'blob') fail('changed submodule paths cannot be deleted')
    return { path: item.path, delete: true }
  }
  const before = baseTree.get(item.path); const after = headTree.get(item.path)
  if (!after || (item._status !== 'A' && !before) || (item._status === 'A' && before)) fail('Git diff and committed trees disagree')
  if (after.type !== 'blob' || !MODES.has(after.mode)) fail('changed submodules or unsupported file modes cannot be published')
  if (before?.type === 'commit' || before?.type === 'tree') fail('changed submodule or tree path cannot be published')
  const blob = git(cwd, ['cat-file', 'blob', after.sha])
  if (blob.length === 0) fail('zero-byte changed files are not supported by Relay')
  if (blob.length > MAX_CHANGE_BYTES) fail('one changed blob exceeds 4 MiB')
  return { path: item.path, mode: after.mode, contentBase64: blob.toString('base64') }
}

export function buildPublicationPackage({ cwd, repository, baseBranch = 'main', baseSha, headSha = 'HEAD', title, body }) {
  if (typeof cwd !== 'string' || cwd.length === 0) fail('cwd is required')
  if (typeof repository !== 'string' || !REPOSITORY_RE.test(repository)) fail('repository must be lowercase owner/name')
  safeRef(baseBranch, 'baseBranch'); sha(baseSha, 'baseSha')
  if (headSha !== 'HEAD') sha(headSha, 'headSha')
  const actualHead = resolveCommit(cwd, 'HEAD')
  const resolvedHead = resolveCommit(cwd, headSha)
  if (resolvedHead !== actualHead) fail('headSha must match the worktree HEAD')
  const sourceBranchBytes = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })
  if (!sourceBranchBytes) fail('sourceBranch must be a named development branch; detached HEAD is not publishable')
  let sourceBranch
  try { sourceBranch = new TextDecoder('utf-8', { fatal: true }).decode(sourceBranchBytes).trim() } catch { fail('sourceBranch is not valid UTF-8') }
  safeRef(sourceBranch, 'sourceBranch')
  if (sourceBranch === baseBranch) fail('sourceBranch must be a development branch')
  if (git(cwd, ['merge-base', '--is-ancestor', baseSha, actualHead], { allowFailure: true }) !== null) {
    // A successful --is-ancestor has no output; failures are represented by null.
  } else fail('baseSha must be an ancestor of headSha')
  rejectConfiguredFilters(cwd)
  if (gitText(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).length > 0) {
    fail('publication requires a clean tracked and untracked worktree')
  }
  const diff = parseDiff(cwd, baseSha, actualHead)
  if (diff.length === 0) fail('publication requires at least one committed changed path')
  if (diff.length > MAX_CHANGES) fail('publication contains more than 100 changed paths')
  const changedPaths = new Set(diff.map(item => item.rawPathHex))
  const baseTree = parseTree(cwd, baseSha, changedPaths); const headTree = parseTree(cwd, actualHead, changedPaths)
  const changes = diff.map(item => buildChange(cwd, baseTree, headTree, item))
  const sourceCommittedAt = Number(gitText(cwd, ['show', '-s', '--format=%ct', actualHead]).trim())
  const commitMessage = gitText(cwd, ['show', '-s', '--format=%B', actualHead]).trim()
  const value = {
    schema: PUBLICATION_SCHEMA,
    repository,
    sourceBranch,
    payload: {
      baseBranch, baseSha, sourceHeadSha: actualHead,
      sourceTreeSha: gitText(cwd, ['rev-parse', `${actualHead}^{tree}`]).trim(),
      sourceCommittedAt, commitMessage, changes, title, body, draft: false,
    },
  }
  validatePublicationPackage(value)
  const finalHead = resolveCommit(cwd, 'HEAD')
  const finalBranchBytes = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })
  const finalBranch = finalBranchBytes ? new TextDecoder('utf-8', { fatal: true }).decode(finalBranchBytes).trim() : ''
  if (finalHead !== actualHead || finalBranch !== sourceBranch
      || gitText(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).length > 0) {
    fail('source worktree changed while packaging')
  }
  return value
}

function readTextFile(path, name, { trimTrailingNewline = false } = {}) {
  const bytes = readFileSync(path)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { fail(`${name} is not valid UTF-8`) }
  return trimTrailingNewline ? text.replace(/\r?\n$/, '') : text
}

function cli() {
  const args = process.argv.slice(2)
  if (args[0] !== 'prepare') fail('usage: prepare --base SHA --repository owner/name --title-file PATH --body-file PATH --output PATH')
  const allowed = new Set(['--base', '--repository', '--title-file', '--body-file', '--output'])
  const options = new Map()
  for (let i = 1; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || options.has(args[i])) fail('unknown, repeated, or missing CLI argument')
    options.set(args[i], args[i + 1])
  }
  if (options.size !== allowed.size) fail('all publication CLI arguments are required')
  const publication = buildPublicationPackage({ cwd: process.cwd(), repository: options.get('--repository'), baseSha: options.get('--base'), title: readTextFile(options.get('--title-file'), 'title file', { trimTrailingNewline: true }), body: readTextFile(options.get('--body-file'), 'body file') })
  const encoded = encodePublicationPackage(publication)
  writeFileSync(options.get('--output'), `${encoded}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  process.stdout.write(`${JSON.stringify({ output: options.get('--output'), repository: publication.repository, sourceBranch: publication.sourceBranch, baseSha: publication.payload.baseSha, sourceHeadSha: publication.payload.sourceHeadSha, sourceTreeSha: publication.payload.sourceTreeSha, encodedCharacters: encoded.length, sha256: createHash('sha256').update(encoded).digest('hex') })}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { cli() } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
