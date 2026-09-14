#!/usr/bin/env node
/** Verify and, only with a separate exact approval, materialize a loss-audited successor tree. */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, posix, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA256 = /^[a-f0-9]{64}$/u
const DECLARATION_LIMIT = 64 * 1024 * 1024
const ROW_LIMIT = 100_000
const FILE_LIMIT = 512 * 1024 * 1024
const TOTAL_LIMIT = 16 * 1024 * 1024 * 1024
const METADATA_DIR = '.harbor-reconciliation'
const INCOMPLETE_MARKER = '.harbor-reconciliation-incomplete'
const AUDITOR = Object.freeze({ name: 'harbor-successor-export', version: '1' })
const DISPOSITIONS = new Set(['copy-exact', 'regenerate-alias', 'omit-approved'])
const MODES = new Set(['100644', '100755'])
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const nonBlank = (value) => typeof value === 'string' && /\S/u.test(value)

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`)
  return value
}

function exactKeys(value, keys, path) {
  object(value, path)
  const actual = Object.keys(value).sort(compare)
  const expected = [...keys].sort(compare)
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${path} has unknown or missing properties`)
}

function string(value, path) {
  if (!nonBlank(value)) throw new TypeError(`${path} must be a non-blank string`)
}

function strings(value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new TypeError(`${path} must be ${allowEmpty ? 'an' : 'a non-empty'} array`)
  value.forEach((entry, index) => string(entry, `${path}[${index}]`))
  if (new Set(value).size !== value.length) throw new TypeError(`${path} must contain unique values`)
}

function sha(value, path) {
  if (!SHA256.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`)
}

function integer(value, path, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new TypeError(`${path} must be a ${positive ? 'positive' : 'nonnegative'} safe integer`)
}

function decodeJson(bytes, path) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new TypeError(`${path} must be valid UTF-8 JSON`) }
}

function decodeJsonl(bytes, path) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new TypeError(`${path} must be valid UTF-8 JSONL`) }
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length === 0 || lines.some((line) => line.trim() === '')) throw new TypeError(`${path} must contain non-blank JSON lines`)
  if (lines.length > ROW_LIMIT) throw new TypeError(`${path} exceeds ${ROW_LIMIT} rows`)
  return lines.map((line, index) => {
    try { return JSON.parse(line) } catch { throw new TypeError(`${path} line ${index + 1} must be valid JSON`) }
  })
}

function relativePath(value, path, { portable = false } = {}) {
  string(value, path)
  if (value.includes('\\') || value.includes('\0') || isAbsolute(value) || posix.isAbsolute(value)) throw new TypeError(`${path} must be a relative POSIX path`)
  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new TypeError(`${path} contains an empty or traversal segment`)
  if (parts[0].toLowerCase() === '.git') throw new TypeError(`${path} may not target Git metadata`)
  if (portable) {
    if (value !== value.normalize('NFC')) throw new TypeError(`${path} must use NFC Unicode normalization`)
    for (const part of parts) {
      if (/[\u0000-\u001f<>:"|?*]/u.test(part) || /[ .]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)) throw new TypeError(`${path} is not portable across common filesystems`)
    }
    if ([METADATA_DIR, INCOMPLETE_MARKER].includes(parts[0].toLowerCase())) throw new TypeError(`${path} collides with reserved successor metadata`)
  }
  return parts
}

function validateUniverse(rows) {
  const paths = new Set()
  rows.forEach((row, index) => {
    const path = `universe[${index}]`
    exactKeys(row, ['schemaVersion', 'path', 'sha256', 'bytes', 'mode'], path)
    if (row.schemaVersion !== 1) throw new TypeError(`${path}.schemaVersion must equal 1`)
    relativePath(row.path, `${path}.path`)
    sha(row.sha256, `${path}.sha256`)
    integer(row.bytes, `${path}.bytes`)
    if (!MODES.has(row.mode)) throw new TypeError(`${path}.mode must be 100644 or 100755`)
    if (paths.has(row.path)) throw new TypeError(`universe contains duplicate path ${row.path}`)
    paths.add(row.path)
  })
}

function validateAuthority(authority, path) {
  exactKeys(authority, ['decisionId', 'revision', 'receiptSha256'], path)
  string(authority.decisionId, `${path}.decisionId`)
  string(authority.revision, `${path}.revision`)
  sha(authority.receiptSha256, `${path}.receiptSha256`)
}

function validateManifest(rows) {
  const sources = new Set()
  rows.forEach((row, index) => {
    const path = `manifest[${index}]`
    exactKeys(row, ['schemaVersion', 'sourcePath', 'disposition', 'successorPath', 'generatedFrom', 'authority'], path)
    if (row.schemaVersion !== 1) throw new TypeError(`${path}.schemaVersion must equal 1`)
    relativePath(row.sourcePath, `${path}.sourcePath`)
    if (!DISPOSITIONS.has(row.disposition)) throw new TypeError(`${path}.disposition is invalid`)
    validateAuthority(row.authority, `${path}.authority`)
    if (row.disposition === 'copy-exact') {
      relativePath(row.successorPath, `${path}.successorPath`, { portable: true })
      if (row.generatedFrom !== null) throw new TypeError(`${path}.generatedFrom must be null for copy-exact`)
    } else if (row.disposition === 'regenerate-alias') {
      if (row.successorPath !== null) throw new TypeError(`${path}.successorPath must be null for regenerate-alias`)
      relativePath(row.generatedFrom, `${path}.generatedFrom`)
    } else if (row.successorPath !== null || row.generatedFrom !== null) {
      throw new TypeError(`${path} omit-approved paths cannot name successor content`)
    }
    if (sources.has(row.sourcePath)) throw new TypeError(`manifest contains duplicate sourcePath ${row.sourcePath}`)
    sources.add(row.sourcePath)
  })
}

function validateLossAudit(value) {
  exactKeys(value, ['schemaVersion', 'source', 'manifest', 'authorization', 'blockers'], 'lossAudit')
  if (value.schemaVersion !== 1) throw new TypeError('lossAudit.schemaVersion must equal 1')
  exactKeys(value.source, ['sourceId', 'revision', 'universeSha256', 'pathCount'], 'lossAudit.source')
  string(value.source.sourceId, 'lossAudit.source.sourceId')
  string(value.source.revision, 'lossAudit.source.revision')
  sha(value.source.universeSha256, 'lossAudit.source.universeSha256')
  integer(value.source.pathCount, 'lossAudit.source.pathCount', { positive: true })
  exactKeys(value.manifest, ['sha256', 'pathCount'], 'lossAudit.manifest')
  sha(value.manifest.sha256, 'lossAudit.manifest.sha256')
  integer(value.manifest.pathCount, 'lossAudit.manifest.pathCount', { positive: true })
  exactKeys(value.authorization, ['exportAuthorized', 'approvalSha256'], 'lossAudit.authorization')
  if (typeof value.authorization.exportAuthorized !== 'boolean') throw new TypeError('lossAudit.authorization.exportAuthorized must be boolean')
  sha(value.authorization.approvalSha256, 'lossAudit.authorization.approvalSha256')
  strings(value.blockers, 'lossAudit.blockers', { allowEmpty: true })
}

function validateApproval(value) {
  exactKeys(value, ['schemaVersion', 'action', 'decisionId', 'revision', 'manifestSha256', 'universeSha256', 'granted', 'approverId', 'scope', 'limitations'], 'approval')
  if (value.schemaVersion !== 1) throw new TypeError('approval.schemaVersion must equal 1')
  if (value.action !== 'materialize-successor') throw new TypeError('approval.action must equal materialize-successor')
  for (const key of ['decisionId', 'revision', 'approverId']) string(value[key], `approval.${key}`)
  sha(value.manifestSha256, 'approval.manifestSha256')
  sha(value.universeSha256, 'approval.universeSha256')
  if (value.granted !== true) throw new TypeError('approval.granted must equal true')
  exactKeys(value.scope, ['sourceId', 'revision'], 'approval.scope')
  string(value.scope.sourceId, 'approval.scope.sourceId')
  string(value.scope.revision, 'approval.scope.revision')
  strings(value.limitations, 'approval.limitations')
}

function readBoundedRegular(path, limit, label) {
  string(path, `${label} path`)
  const before = lstatSync(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new TypeError(`${label} must be a regular non-symlink file`)
  if (before.size > limit) throw new TypeError(`${label} exceeds ${limit} bytes`)
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new TypeError(`${label} changed before read`)
    const bytes = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null)
      if (count === 0) break
      offset += count
    }
    const after = fstatSync(fd)
    const named = lstatSync(path)
    if (offset !== bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || named.dev !== after.dev || named.ino !== after.ino) throw new TypeError(`${label} changed during read`)
    return bytes
  } finally { closeSync(fd) }
}

function checkSourceAncestors(root, sourcePath) {
  let cursor = root
  const parts = relativePath(sourcePath, `source path ${sourcePath}`)
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = join(cursor, parts[index])
    const stat = lstatSync(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError(`source ancestor is not a regular directory: ${sourcePath}`)
  }
  return join(root, ...parts)
}

function censusSource(root) {
  const paths = []
  const stack = [{ absolute: root, relative: '' }]
  let entriesSeen = 0
  while (stack.length > 0) {
    const current = stack.pop()
    for (const name of readdirSync(current.absolute).sort(compare).reverse()) {
      if (current.relative === '' && name.toLowerCase() === '.git') continue
      entriesSeen += 1
      if (entriesSeen > ROW_LIMIT * 2) throw new TypeError(`source tree exceeds ${ROW_LIMIT * 2} entries`)
      const relative = current.relative ? `${current.relative}/${name}` : name
      relativePath(relative, `source entry ${relative}`)
      const absolute = join(current.absolute, name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new TypeError(`source tree contains unsupported symlink: ${relative}`)
      if (stat.isDirectory()) stack.push({ absolute, relative })
      else if (stat.isFile()) {
        paths.push(relative)
        if (paths.length > ROW_LIMIT) throw new TypeError(`source tree exceeds ${ROW_LIMIT} files`)
      } else throw new TypeError(`source tree contains unsupported special entry: ${relative}`)
    }
  }
  return paths.sort(compare)
}

function hashSource(root, row, { destination = null } = {}) {
  const path = checkSourceAncestors(root, row.path)
  const before = lstatSync(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new TypeError(`source must be a regular non-symlink file: ${row.path}`)
  if (before.size > FILE_LIMIT) throw new TypeError(`source exceeds ${FILE_LIMIT} bytes: ${row.path}`)
  const input = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  let output = null
  try {
    const opened = fstatSync(input)
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new TypeError(`source changed before read: ${row.path}`)
    if (destination) output = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let bytes = 0
    while (true) {
      const count = readSync(input, buffer, 0, buffer.length, null)
      if (count === 0) break
      const chunk = buffer.subarray(0, count)
      hash.update(chunk)
      if (output !== null) {
        let offset = 0
        while (offset < count) offset += writeSync(output, chunk, offset, count - offset, null)
      }
      bytes += count
    }
    const after = fstatSync(input)
    const named = lstatSync(path)
    if (bytes !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || named.dev !== after.dev || named.ino !== after.ino) throw new TypeError(`source changed during read: ${row.path}`)
    if (output !== null) {
      fchmodSync(output, row.mode === '100755' ? 0o755 : 0o644)
      fsyncSync(output)
    }
    return { bytes, sha256: hash.digest('hex'), mode: (before.mode & 0o111) === 0 ? '100644' : '100755' }
  } finally {
    if (output !== null) closeSync(output)
    closeSync(input)
  }
}

function sameSet(left, right) {
  const a = [...left].sort(compare)
  const b = [...right].sort(compare)
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function auditSuccessor({ sourceRoot, universeBytes, manifestBytes, lossAuditBytes, approvalBytes }) {
  const rootStat = lstatSync(sourceRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new TypeError('source must be a regular non-symlink directory')
  const root = realpathSync(sourceRoot)
  const universe = decodeJsonl(universeBytes, 'universeBytes')
  const manifest = decodeJsonl(manifestBytes, 'manifestBytes')
  const lossAudit = decodeJson(lossAuditBytes, 'lossAuditBytes')
  const approval = decodeJson(approvalBytes, 'approvalBytes')
  validateUniverse(universe)
  validateManifest(manifest)
  validateLossAudit(lossAudit)
  validateApproval(approval)

  const universeSha256 = digest(universeBytes)
  const manifestSha256 = digest(manifestBytes)
  const approvalSha256 = digest(approvalBytes)
  const findings = []
  const add = (id, path, message) => findings.push({ id, path, message })
  if (lossAudit.source.universeSha256 !== universeSha256 || approval.universeSha256 !== universeSha256) add('SE-BINDING', 'universe', 'Universe bytes do not match the loss audit and approval.')
  if (lossAudit.manifest.sha256 !== manifestSha256 || approval.manifestSha256 !== manifestSha256) add('SE-BINDING', 'manifest', 'Manifest bytes do not match the loss audit and approval.')
  if (lossAudit.authorization.approvalSha256 !== approvalSha256) add('SE-BINDING', 'approval', 'Approval bytes do not match the loss audit.')
  if (lossAudit.source.pathCount !== universe.length || lossAudit.manifest.pathCount !== manifest.length) add('SE-COVERAGE', 'pathCount', 'Declared path counts do not match the supplied rows.')
  if (!sameSet(universe.map((row) => row.path), manifest.map((row) => row.sourcePath))) add('SE-COVERAGE', 'manifest', 'Manifest source paths must exactly equal the independently supplied universe.')
  if (!lossAudit.authorization.exportAuthorized) add('SE-AUTHORITY', 'lossAudit.authorization.exportAuthorized', 'Loss audit does not authorize export.')
  if (lossAudit.blockers.length > 0) add('SE-AUTHORITY', 'lossAudit.blockers', 'Loss audit retains unresolved blockers.')
  if (approval.scope.sourceId !== lossAudit.source.sourceId || approval.scope.revision !== lossAudit.source.revision) add('SE-AUTHORITY', 'approval.scope', 'Approval scope does not match the loss-audit source identity and revision.')

  const bySource = new Map(universe.map((row) => [row.path, row]))
  const manifestBySource = new Map(manifest.map((row) => [row.sourcePath, row]))
  const successorKeys = new Map()
  for (const row of manifest) {
    const source = bySource.get(row.sourcePath)
    if (!source) continue
    if (row.disposition === 'regenerate-alias') {
      const canonical = bySource.get(row.generatedFrom)
      const canonicalManifest = manifestBySource.get(row.generatedFrom)
      if (!canonical || !canonicalManifest || canonicalManifest.disposition !== 'copy-exact') add('SE-ALIAS', row.sourcePath, 'Regenerated alias must name a copy-exact source in the same complete manifest.')
      else if (canonical.sha256 !== source.sha256 || canonical.bytes !== source.bytes) add('SE-ALIAS', row.sourcePath, 'Regenerated alias and canonical source must be byte-identical.')
    }
    if (row.disposition === 'copy-exact') {
      const key = row.successorPath.normalize('NFC').toLowerCase()
      const prior = successorKeys.get(key)
      if (prior) add('SE-COLLISION', row.successorPath, `Successor path collides portably with ${prior}.`)
      else successorKeys.set(key, row.successorPath)
    }
  }
  for (const current of successorKeys.keys()) {
    const segments = current.split('/')
    for (let end = 1; end < segments.length; end += 1) {
      const ancestor = segments.slice(0, end).join('/')
      if (successorKeys.has(ancestor)) add('SE-COLLISION', successorKeys.get(current), `Successor path is nested beneath file ${successorKeys.get(ancestor)}.`)
    }
  }

  const actualPaths = censusSource(root)
  if (!sameSet(actualPaths, universe.map((row) => row.path))) add('SE-COVERAGE', 'universe', 'Universe paths must exactly equal every regular source file except top-level Git metadata.')

  let sourceBytes = 0
  for (const row of universe) {
    const actual = hashSource(root, row)
    sourceBytes += actual.bytes
    if (sourceBytes > TOTAL_LIMIT) throw new TypeError(`source universe exceeds ${TOTAL_LIMIT} bytes`)
    if (actual.bytes !== row.bytes || actual.sha256 !== row.sha256 || actual.mode !== row.mode) add('SE-SOURCE', row.path, 'Source bytes or executable mode do not match the independently supplied universe row.')
  }

  const counts = Object.fromEntries([...DISPOSITIONS].sort(compare).map((kind) => [kind, manifest.filter((row) => row.disposition === kind).length]))
  return {
    result: {
      schemaVersion: 1,
      auditor: AUDITOR,
      pass: findings.length === 0,
      status: findings.length === 0 ? 'verified-not-materialized' : 'held',
      bindings: {
        source: { sourceId: lossAudit.source.sourceId, revision: lossAudit.source.revision, root, paths: universe.length, bytes: sourceBytes, universeSha256 },
        manifest: { sha256: manifestSha256, paths: manifest.length },
        lossAuditSha256: digest(lossAuditBytes),
        approval: { sha256: approvalSha256, decisionId: approval.decisionId, revision: approval.revision, approverId: approval.approverId },
      },
      counts,
      outputFiles: counts['copy-exact'],
      findings,
      limitations: [
        'Approval identity and authority are declared, not cryptographically authenticated by this local v1 tool.',
        'Exact copying and omission receipts do not prove the successor is useful, buildable, or behaviorally equivalent.',
        'Regenerated aliases are recorded but not installed into the successor tree.',
        'Materialization reserves an absent output directory without clobbering; a failed write remains visibly incomplete and is not crash-durable.',
      ],
    },
    rows: { universe, manifest, lossAudit, approval },
  }
}

function ensureSeparateOutput(sourceRoot, outputPath) {
  if (!isAbsolute(outputPath)) throw new TypeError('output must be an absolute path')
  const output = resolve(outputPath)
  const parent = dirname(output)
  const parentStat = lstatSync(parent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new TypeError('output parent must be a regular non-symlink directory')
  const realParent = realpathSync(parent)
  const normalizedOutput = join(realParent, basename(output))
  const source = realpathSync(sourceRoot)
  if (normalizedOutput === source || normalizedOutput.startsWith(`${source}${sep}`) || source.startsWith(`${normalizedOutput}${sep}`)) throw new TypeError('output and source must be separate, non-nested trees')
  try { lstatSync(normalizedOutput); throw new TypeError('output must not already exist') } catch (error) {
    if (error instanceof TypeError) throw error
    if (!error || error.code !== 'ENOENT') throw error
  }
  return { output: normalizedOutput, parent: realParent }
}

function writeExclusive(path, bytes, mode = 0o644) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  try {
    let offset = 0
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset, null)
    fchmodSync(fd, mode)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}

export function materializeSuccessor(audit, { sourceRoot, universeBytes, manifestBytes, lossAuditBytes, approvalBytes, outputPath }) {
  if (!audit.result.pass) throw new TypeError('refusing to materialize a successor whose audit is held')
  // Do not trust a caller-retained result or its mutable row objects. Rebuild
  // the decision from the exact declaration bytes immediately before writing.
  const verified = auditSuccessor({ sourceRoot, universeBytes, manifestBytes, lossAuditBytes, approvalBytes })
  if (!verified.result.pass) throw new TypeError('refusing to materialize a successor whose declarations no longer pass')
  const { output } = ensureSeparateOutput(sourceRoot, outputPath)
  const universeByPath = new Map(verified.rows.universe.map((row) => [row.path, row]))
  mkdirSync(output, { mode: 0o700 })
  const incomplete = join(output, INCOMPLETE_MARKER)
  writeExclusive(incomplete, Buffer.from(`${randomUUID()}\n`), 0o600)
  try {
    for (const row of verified.rows.manifest) {
      if (row.disposition !== 'copy-exact') continue
      const destination = join(output, ...relativePath(row.successorPath, 'successorPath', { portable: true }))
      mkdirSync(dirname(destination), { recursive: true, mode: 0o755 })
      const source = universeByPath.get(row.sourcePath)
      const actual = hashSource(realpathSync(sourceRoot), source, { destination })
      if (actual.bytes !== source.bytes || actual.sha256 !== source.sha256 || actual.mode !== source.mode) throw new TypeError(`source changed after verification: ${row.sourcePath}`)
    }
    const metadata = join(output, METADATA_DIR)
    mkdirSync(metadata, { mode: 0o755 })
    writeExclusive(join(metadata, 'universe.jsonl'), universeBytes)
    writeExclusive(join(metadata, 'successor-manifest.jsonl'), manifestBytes)
    writeExclusive(join(metadata, 'loss-audit.json'), lossAuditBytes)
    writeExclusive(join(metadata, 'approval.json'), approvalBytes)
    const receipt = {
      ...verified.result,
      status: 'materialized',
      output,
      metadataDirectory: METADATA_DIR,
    }
    writeExclusive(join(metadata, 'materialization-receipt.json'), Buffer.from(JSON.stringify(receipt, null, 2) + '\n'))
    unlinkSync(incomplete)
    return receipt
  } catch (error) {
    throw error
  }
}

function usage() {
  return 'Usage: harbor-successor-export --source /absolute/source-tree --universe /absolute/universe.jsonl --manifest /absolute/manifest.jsonl --loss-audit /absolute/loss-audit.json --approval /absolute/approval.json [--materialize --output /absolute/new-tree]'
}

function run(argv) {
  const paths = {}
  let materialize = false
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (['--source', '--universe', '--manifest', '--loss-audit', '--approval', '--output'].includes(value)) paths[value.slice(2)] = argv[++index]
    else if (value === '--materialize') materialize = true
    else if (value === '--help' || value === '-h') { process.stdout.write(`${usage()}\n`); return 0 }
    else throw new TypeError(`unknown argument: ${value}`)
  }
  for (const required of ['source', 'universe', 'manifest', 'loss-audit', 'approval']) if (!nonBlank(paths[required])) throw new TypeError(usage())
  if (materialize !== nonBlank(paths.output)) throw new TypeError('--materialize and --output must be supplied together')
  const universeBytes = readBoundedRegular(paths.universe, DECLARATION_LIMIT, 'universe')
  const manifestBytes = readBoundedRegular(paths.manifest, DECLARATION_LIMIT, 'manifest')
  const lossAuditBytes = readBoundedRegular(paths['loss-audit'], DECLARATION_LIMIT, 'loss audit')
  const approvalBytes = readBoundedRegular(paths.approval, DECLARATION_LIMIT, 'approval')
  const audit = auditSuccessor({ sourceRoot: paths.source, universeBytes, manifestBytes, lossAuditBytes, approvalBytes })
  if (!audit.result.pass) {
    process.stdout.write(`${JSON.stringify(audit.result, null, 2)}\n`)
    return 2
  }
  const result = materialize
    ? materializeSuccessor(audit, { sourceRoot: paths.source, universeBytes, manifestBytes, lossAuditBytes, approvalBytes, outputPath: paths.output })
    : audit.result
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return 0
}

let direct = false
try { direct = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) } catch { /* importing module has no CLI path */ }
if (direct) {
  try { process.exitCode = run(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
