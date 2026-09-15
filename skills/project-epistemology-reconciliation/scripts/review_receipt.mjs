#!/usr/bin/env node
/** Verify a textual semantic-review promotion against exact local source and contract bytes. */
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SHA256 = /^[a-f0-9]{64}$/u
const SOURCE_LIMIT = 16 * 1024 * 1024
const DECLARATION_LIMIT = 1024 * 1024
const AUDITOR = Object.freeze({ name: 'harbor-review-audit', version: '2' })
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

class DuplicateJsonKeyError extends SyntaxError {
  constructor(path, key) {
    super(`${path} contains duplicate object key ${JSON.stringify(key)}`)
  }
}

function assertUniqueJsonObjectKeys(text, label) {
  let offset = 0
  const fail = () => { throw new SyntaxError('invalid JSON') }
  const whitespace = () => {
    while (offset < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[offset])) offset += 1
  }
  const quotedString = () => {
    if (text[offset] !== '"') fail()
    const start = offset
    offset += 1
    while (offset < text.length) {
      const character = text[offset]
      offset += 1
      if (character === '"') return JSON.parse(text.slice(start, offset))
      if (character === '\\') {
        if (offset >= text.length) fail()
        const escape = text[offset]
        offset += 1
        if (escape === 'u') {
          if (!/^[a-fA-F0-9]{4}$/u.test(text.slice(offset, offset + 4))) fail()
          offset += 4
        } else if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) fail()
      } else if (character.charCodeAt(0) <= 0x1f) fail()
    }
    fail()
  }
  const value = (path) => {
    whitespace()
    if (text[offset] === '{') {
      offset += 1
      whitespace()
      const keys = new Set()
      if (text[offset] === '}') { offset += 1; return }
      while (true) {
        whitespace()
        const key = quotedString()
        if (keys.has(key)) throw new DuplicateJsonKeyError(path, key)
        keys.add(key)
        whitespace()
        if (text[offset] !== ':') fail()
        offset += 1
        value(`${path}.${key}`)
        whitespace()
        if (text[offset] === '}') { offset += 1; return }
        if (text[offset] !== ',') fail()
        offset += 1
      }
    }
    if (text[offset] === '[') {
      offset += 1
      whitespace()
      if (text[offset] === ']') { offset += 1; return }
      let index = 0
      while (true) {
        value(`${path}[${index}]`)
        index += 1
        whitespace()
        if (text[offset] === ']') { offset += 1; return }
        if (text[offset] !== ',') fail()
        offset += 1
      }
    }
    if (text[offset] === '"') { quotedString(); return }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return }
    }
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy
    number.lastIndex = offset
    const match = number.exec(text)
    if (!match) fail()
    offset = number.lastIndex
  }
  whitespace()
  value(label)
  whitespace()
  if (offset !== text.length) fail()
}

function decodeJson(bytes, path) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new TypeError(`${path} must be valid UTF-8 JSON`) }
  try {
    assertUniqueJsonObjectKeys(text, path)
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof DuplicateJsonKeyError) throw new TypeError(error.message)
    throw new TypeError(`${path} must be valid UTF-8 JSON`)
  }
}

function validateExpectedSourceIdentity(identity) {
  exactKeys(identity, ['sourceId', 'revision', 'path'], 'expectedSourceIdentity')
  for (const key of ['sourceId', 'revision', 'path']) string(identity[key], `expectedSourceIdentity.${key}`)
}

function validateContract(contract) {
  exactKeys(contract, ['schemaVersion', 'id', 'revision', 'requiredFields'], 'contract')
  if (contract.schemaVersion !== 1) throw new TypeError('contract.schemaVersion must equal 1')
  string(contract.id, 'contract.id')
  string(contract.revision, 'contract.revision')
  strings(contract.requiredFields, 'contract.requiredFields')
}

function validateReceipt(receipt) {
  exactKeys(receipt, ['schemaVersion', 'source', 'reviewContract', 'extraction', 'review', 'quality', 'rejectedAttempts'], 'receipt')
  if (receipt.schemaVersion !== 1) throw new TypeError('receipt.schemaVersion must equal 1')
  exactKeys(receipt.source, ['sourceId', 'revision', 'path', 'sha256', 'bytes'], 'receipt.source')
  for (const key of ['sourceId', 'revision', 'path']) string(receipt.source[key], `receipt.source.${key}`)
  if (!SHA256.test(receipt.source.sha256)) throw new TypeError('receipt.source.sha256 must be a lowercase SHA-256 digest')
  if (!Number.isSafeInteger(receipt.source.bytes) || receipt.source.bytes < 0) throw new TypeError('receipt.source.bytes must be a nonnegative safe integer')

  exactKeys(receipt.reviewContract, ['id', 'revision', 'sha256'], 'receipt.reviewContract')
  string(receipt.reviewContract.id, 'receipt.reviewContract.id')
  string(receipt.reviewContract.revision, 'receipt.reviewContract.revision')
  if (!SHA256.test(receipt.reviewContract.sha256)) throw new TypeError('receipt.reviewContract.sha256 must be a lowercase SHA-256 digest')

  exactKeys(receipt.extraction, ['producerId', 'method', 'artifactSha256'], 'receipt.extraction')
  string(receipt.extraction.producerId, 'receipt.extraction.producerId')
  string(receipt.extraction.method, 'receipt.extraction.method')
  if (!SHA256.test(receipt.extraction.artifactSha256)) throw new TypeError('receipt.extraction.artifactSha256 must be a lowercase SHA-256 digest')

  exactKeys(receipt.review, ['requestedStatus', 'reviewerId', 'method', 'sourceCoverage', 'fields', 'limitations'], 'receipt.review')
  if (receipt.review.requestedStatus !== 'agent-reviewed') throw new TypeError('receipt.review.requestedStatus must equal agent-reviewed')
  string(receipt.review.reviewerId, 'receipt.review.reviewerId')
  if (!['solo', 'independent'].includes(receipt.review.method)) throw new TypeError('receipt.review.method must be solo or independent')
  if (!['complete', 'partial'].includes(receipt.review.sourceCoverage)) throw new TypeError('receipt.review.sourceCoverage must be complete or partial')
  if (!Array.isArray(receipt.review.fields) || receipt.review.fields.length === 0) throw new TypeError('receipt.review.fields must be a non-empty array')
  strings(receipt.review.limitations, 'receipt.review.limitations')
  for (const [index, field] of receipt.review.fields.entries()) {
    const path = `receipt.review.fields[${index}]`
    exactKeys(field, ['name', 'disposition', 'summary', 'warrant', 'anchors', 'uncertainty'], path)
    string(field.name, `${path}.name`)
    if (!['present', 'source-omits-field'].includes(field.disposition)) throw new TypeError(`${path}.disposition is invalid`)
    string(field.summary, `${path}.summary`)
    if (!['source', 'observation', 'inference', 'missing'].includes(field.warrant)) throw new TypeError(`${path}.warrant is invalid`)
    string(field.uncertainty, `${path}.uncertainty`)
    if (!Array.isArray(field.anchors)) throw new TypeError(`${path}.anchors must be an array`)
    const anchorIds = new Set()
    for (const [anchorIndex, anchor] of field.anchors.entries()) {
      const anchorPath = `${path}.anchors[${anchorIndex}]`
      exactKeys(anchor, ['lineStart', 'lineEnd', 'excerptSha256'], anchorPath)
      if (!Number.isSafeInteger(anchor.lineStart) || !Number.isSafeInteger(anchor.lineEnd) || anchor.lineStart < 1 || anchor.lineEnd < anchor.lineStart) throw new TypeError(`${anchorPath} has an invalid line range`)
      if (!SHA256.test(anchor.excerptSha256)) throw new TypeError(`${anchorPath}.excerptSha256 must be a lowercase SHA-256 digest`)
      const id = `${anchor.lineStart}:${anchor.lineEnd}:${anchor.excerptSha256}`
      if (anchorIds.has(id)) throw new TypeError(`${path}.anchors must be unique`)
      anchorIds.add(id)
    }
  }

  exactKeys(receipt.quality, ['reviewerId', 'independentFrom', 'disposition', 'checkedFields', 'findings'], 'receipt.quality')
  string(receipt.quality.reviewerId, 'receipt.quality.reviewerId')
  strings(receipt.quality.independentFrom, 'receipt.quality.independentFrom')
  if (!['accepted', 'rejected'].includes(receipt.quality.disposition)) throw new TypeError('receipt.quality.disposition must be accepted or rejected')
  strings(receipt.quality.checkedFields, 'receipt.quality.checkedFields')
  strings(receipt.quality.findings, 'receipt.quality.findings', { allowEmpty: true })

  if (!Array.isArray(receipt.rejectedAttempts)) throw new TypeError('receipt.rejectedAttempts must be an array')
  const rejectedDigests = new Set()
  for (const [index, attempt] of receipt.rejectedAttempts.entries()) {
    const path = `receipt.rejectedAttempts[${index}]`
    exactKeys(attempt, ['receiptSha256', 'reason'], path)
    if (!SHA256.test(attempt.receiptSha256)) throw new TypeError(`${path}.receiptSha256 must be a lowercase SHA-256 digest`)
    string(attempt.reason, `${path}.reason`)
    if (rejectedDigests.has(attempt.receiptSha256)) throw new TypeError('receipt.rejectedAttempts must contain unique receipt digests')
    rejectedDigests.add(attempt.receiptSha256)
  }
}

function exactSet(actual, expected) {
  const left = [...actual].sort(compare)
  const right = [...expected].sort(compare)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function exactLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/gu) ?? []
}

export function auditReviewReceipt(sourceBytes, contractBytes, receiptBytes, expectedSourceIdentity) {
  for (const [value, name] of [[sourceBytes, 'sourceBytes'], [contractBytes, 'contractBytes'], [receiptBytes, 'receiptBytes']]) {
    if (!(value instanceof Uint8Array)) throw new TypeError(`${name} must be a Uint8Array`)
  }
  validateExpectedSourceIdentity(expectedSourceIdentity)
  const contract = decodeJson(contractBytes, 'contractBytes')
  const receipt = decodeJson(receiptBytes, 'receiptBytes')
  validateContract(contract)
  validateReceipt(receipt)
  let sourceText
  try { sourceText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sourceBytes) } catch { throw new TypeError('sourceBytes must be valid UTF-8 text') }
  const lines = exactLines(sourceText)
  const findings = []
  const add = (id, path, message) => findings.push({ id, path, message })

  for (const key of ['sourceId', 'revision', 'path']) {
    if (receipt.source[key] !== expectedSourceIdentity[key]) add('RR-SOURCE-IDENTITY', `source.${key}`, `Receipt-declared ${key} does not exactly match the separately supplied expected source identity.`)
  }
  if (receipt.source.bytes !== sourceBytes.byteLength) add('RR-SOURCE', 'source.bytes', 'Declared byte length does not match the supplied source.')
  if (receipt.source.sha256 !== digest(sourceBytes)) add('RR-SOURCE', 'source.sha256', 'Declared digest does not match the supplied source.')
  const contractSha256 = digest(contractBytes)
  if (receipt.reviewContract.id !== contract.id || receipt.reviewContract.revision !== contract.revision || receipt.reviewContract.sha256 !== contractSha256) add('RR-CONTRACT', 'reviewContract', 'Receipt does not match the independently supplied review contract identity, revision and bytes.')

  const required = contract.requiredFields
  const fields = receipt.review.fields.map((field) => field.name)
  if (!exactSet(fields, required)) add('RR-COVERAGE', 'review.fields', 'Reviewed fields must match the independently supplied required-field set.')
  if (new Set(fields).size !== fields.length) add('RR-COVERAGE', 'review.fields', 'Reviewed field names must be unique.')
  if (receipt.review.sourceCoverage !== 'complete') add('RR-COVERAGE', 'review.sourceCoverage', 'Agent-reviewed promotion requires a complete-source review declaration.')

  for (const [fieldIndex, field] of receipt.review.fields.entries()) {
    const fieldPath = `review.fields[${fieldIndex}]`
    if (field.disposition === 'present' && field.anchors.length === 0) add('RR-COVERAGE', `${fieldPath}.anchors`, 'A present semantic field requires at least one exact source anchor.')
    if (field.disposition === 'source-omits-field' && field.warrant !== 'missing') add('RR-COVERAGE', `${fieldPath}.warrant`, 'An omitted field must retain a missing warrant.')
    if (field.disposition === 'present' && field.warrant === 'missing') add('RR-COVERAGE', `${fieldPath}.warrant`, 'A present field cannot carry a missing warrant.')
    for (const [anchorIndex, anchor] of field.anchors.entries()) {
      const anchorPath = `${fieldPath}.anchors[${anchorIndex}]`
      if (anchor.lineEnd > lines.length) {
        add('RR-SOURCE', anchorPath, 'Anchor line range exceeds the supplied source.')
        continue
      }
      const excerpt = Buffer.from(lines.slice(anchor.lineStart - 1, anchor.lineEnd).join(''), 'utf8')
      if (digest(excerpt) !== anchor.excerptSha256) add('RR-SOURCE', `${anchorPath}.excerptSha256`, 'Anchor digest does not match the exact source line bytes.')
    }
  }

  const identities = [receipt.extraction.producerId, receipt.review.reviewerId, receipt.quality.reviewerId]
  if (new Set(identities).size !== identities.length) add('RR-IDENTITY', 'quality.reviewerId', 'Extraction, semantic review and quality review require distinct declared identities.')
  if (!receipt.quality.independentFrom.includes(receipt.extraction.producerId) || !receipt.quality.independentFrom.includes(receipt.review.reviewerId)) add('RR-IDENTITY', 'quality.independentFrom', 'Quality review must declare independence from both producer and semantic reviewer.')
  if (receipt.quality.disposition !== 'accepted') add('RR-QUALITY', 'quality.disposition', 'A rejected quality review cannot promote the semantic result.')
  if (!exactSet(receipt.quality.checkedFields, required)) add('RR-QUALITY', 'quality.checkedFields', 'Quality review must cover the independently supplied required-field set.')

  return {
    schemaVersion: 1,
    auditor: AUDITOR,
    pass: findings.length === 0,
    eligibleStatus: findings.length === 0 ? 'agent-reviewed' : 'machine-semantic-extracted',
    bindings: {
      source: {
        expectedIdentity: { sourceId: expectedSourceIdentity.sourceId, revision: expectedSourceIdentity.revision, path: expectedSourceIdentity.path },
        receiptDeclaredIdentity: { sourceId: receipt.source.sourceId, revision: receipt.source.revision, path: receipt.source.path },
        identityExactMatch: ['sourceId', 'revision', 'path'].every((key) => receipt.source[key] === expectedSourceIdentity[key]),
        suppliedBytes: { sha256: digest(sourceBytes), bytes: sourceBytes.byteLength, lines: lines.length }
      },
      reviewContract: { id: contract.id, revision: contract.revision, sha256: contractSha256 },
      receiptSha256: digest(receiptBytes)
    },
    findings,
    limitations: [
      'The expected source identity is separately supplied by the caller and compared exactly; the auditor does not authenticate or derive it from source bytes.',
      'Reviewer identity and independence are declared, not authenticated.',
      'Matching anchors prove source binding, not that summaries are logically complete or correct.',
      'The independently supplied contract determines field coverage but does not prove that its field set is sufficient for every use.',
      'A passing receipt authorizes no deletion, publication, execution, or spend.'
    ]
  }
}

function readBoundedRegular(path, limit, label) {
  if (!nonBlank(path)) throw new TypeError(`${label} path must be a non-blank string`)
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

function usage() {
  return 'Usage: harbor-review-audit --source /absolute/source.txt --source-id ID --source-revision REVISION --source-path PATH --contract /absolute/contract.json --receipt /absolute/review.json'
}

function run(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (['--source', '--source-id', '--source-revision', '--source-path', '--contract', '--receipt'].includes(value)) {
      const key = value.slice(2)
      if (Object.hasOwn(options, key)) throw new TypeError(`duplicate argument: ${value}`)
      options[key] = argv[++index]
    }
    else if (value === '--help' || value === '-h') { process.stdout.write(`${usage()}\n`); return 0 }
    else throw new TypeError(`unknown argument: ${value}`)
  }
  if (['source', 'source-id', 'source-revision', 'source-path', 'contract', 'receipt'].some((key) => !nonBlank(options[key]))) throw new TypeError(usage())
  const source = readBoundedRegular(options.source, SOURCE_LIMIT, 'source')
  const contract = readBoundedRegular(options.contract, DECLARATION_LIMIT, 'contract')
  const receipt = readBoundedRegular(options.receipt, DECLARATION_LIMIT, 'receipt')
  const expectedSourceIdentity = { sourceId: options['source-id'], revision: options['source-revision'], path: options['source-path'] }
  const result = auditReviewReceipt(source, contract, receipt, expectedSourceIdentity)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result.pass ? 0 : 2
}

let direct = false
try { direct = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url) } catch { /* importing module has no CLI path */ }
if (direct) {
  try { process.exitCode = run(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
