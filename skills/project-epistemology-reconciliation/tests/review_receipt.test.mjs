import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { auditReviewReceipt } from '../scripts/review_receipt.mjs'

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const source = Buffer.from('# Decision\n\nKeep one authority.\n', 'utf8')
const anchor = hash(Buffer.from('Keep one authority.\n', 'utf8'))
const attempt = 'a'.repeat(64)
const json = (value) => Buffer.from(JSON.stringify(value), 'utf8')
const expectedSourceIdentity = () => ({ sourceId: 'example', revision: '7', path: 'decision.md' })
const target = join(fileURLToPath(new URL('../../../', import.meta.url)), 'core/target/review-receipt-tests')
mkdirSync(target, { recursive: true })

function contract() {
  return { schemaVersion: 1, id: 'decision-review', revision: '1', requiredFields: ['decision', 'status'] }
}

function fixture(expectedContract = json(contract())) {
  return {
    schemaVersion: 1,
    source: { sourceId: 'example', revision: '7', path: 'decision.md', sha256: hash(source), bytes: source.length },
    reviewContract: { id: 'decision-review', revision: '1', sha256: hash(expectedContract) },
    extraction: { producerId: 'extractor-a', method: 'heading-parser-v1', artifactSha256: 'b'.repeat(64) },
    review: {
      requestedStatus: 'agent-reviewed', reviewerId: 'reviewer-b', method: 'solo', sourceCoverage: 'complete',
      fields: [
        { name: 'decision', disposition: 'present', summary: 'Keep one authority.', warrant: 'source', anchors: [{ lineStart: 3, lineEnd: 3, excerptSha256: anchor }], uncertainty: 'No implementation claim.' },
        { name: 'status', disposition: 'source-omits-field', summary: 'The source declares no status.', warrant: 'missing', anchors: [], uncertainty: 'Absence is a reviewer interpretation.' }
      ],
      limitations: ['Textual review only.']
    },
    quality: { reviewerId: 'quality-c', independentFrom: ['extractor-a', 'reviewer-b'], disposition: 'accepted', checkedFields: ['decision', 'status'], findings: [] },
    rejectedAttempts: [{ receiptSha256: attempt, reason: 'Earlier extraction promoted without independent quality review.' }]
  }
}

const audit = (receipt = fixture(), expectedContract = json(contract()), bytes = source, identity = expectedSourceIdentity()) => auditReviewReceipt(bytes, expectedContract, json(receipt), identity)

test('accepts an exact, independently quality-reviewed promotion receipt', () => {
  const receipt = fixture()
  const receiptBytes = json(receipt)
  const result = auditReviewReceipt(source, json(contract()), receiptBytes, expectedSourceIdentity())
  assert.equal(result.pass, true)
  assert.equal(result.eligibleStatus, 'agent-reviewed')
  assert.equal(result.bindings.receiptSha256, hash(receiptBytes))
  assert.equal(result.bindings.reviewContract.sha256, receipt.reviewContract.sha256)
  assert.deepEqual(result.bindings.source.expectedIdentity, expectedSourceIdentity())
  assert.deepEqual(result.bindings.source.receiptDeclaredIdentity, expectedSourceIdentity())
  assert.equal(result.bindings.source.identityExactMatch, true)
  assert.equal(result.bindings.source.suppliedBytes.sha256, hash(source))
})

test('requires a separately supplied source identity and compares every field exactly', () => {
  assert.throws(() => auditReviewReceipt(source, json(contract()), json(fixture())), /expectedSourceIdentity/u)
  for (const key of ['sourceId', 'revision', 'path']) {
    const identity = expectedSourceIdentity()
    identity[key] = `${identity[key]}-different`
    const result = audit(fixture(), json(contract()), source, identity)
    assert.equal(result.pass, false)
    assert.equal(result.bindings.source.identityExactMatch, false)
    assert.deepEqual(result.bindings.source.expectedIdentity, identity)
    assert.equal(result.findings.some((finding) => finding.id === 'RR-SOURCE-IDENTITY' && finding.path === `source.${key}`), true)
  }
})

test('source digest and byte drift fail closed', () => {
  const receipt = fixture()
  receipt.source.sha256 = 'c'.repeat(64)
  receipt.source.bytes += 1
  const result = audit(receipt)
  assert.equal(result.pass, false)
  assert.deepEqual(new Set(result.findings.map((finding) => finding.path)), new Set(['source.bytes', 'source.sha256']))
})

test('anchor drift fails closed', () => {
  const receipt = fixture()
  receipt.review.fields[0].anchors[0].excerptSha256 = 'd'.repeat(64)
  const result = audit(receipt)
  assert.equal(result.eligibleStatus, 'machine-semantic-extracted')
  assert.match(result.findings[0].message, /Anchor digest/u)
})

test('independent contract prevents receipt from deleting its own requirements', () => {
  const receipt = fixture()
  receipt.review.fields.pop()
  receipt.quality.checkedFields.pop()
  const result = audit(receipt)
  assert.equal(result.pass, false)
  assert.deepEqual(result.findings.map((finding) => finding.id), ['RR-COVERAGE', 'RR-QUALITY'])
})

test('invented contract identity or digest cannot replace the supplied contract', () => {
  const receipt = fixture()
  receipt.reviewContract.revision = '2'
  receipt.reviewContract.sha256 = 'e'.repeat(64)
  assert.equal(audit(receipt).findings.some((finding) => finding.id === 'RR-CONTRACT'), true)
})

test('partial source review cannot be promoted', () => {
  const receipt = fixture()
  receipt.review.sourceCoverage = 'partial'
  assert.equal(audit(receipt).eligibleStatus, 'machine-semantic-extracted')
})

test('producer, reviewer and quality reviewer must be distinct', () => {
  const receipt = fixture()
  receipt.quality.reviewerId = 'reviewer-b'
  assert.equal(audit(receipt).findings.some((finding) => finding.id === 'RR-IDENTITY'), true)
})

test('rejected quality disposition cannot promote', () => {
  const receipt = fixture()
  receipt.quality.disposition = 'rejected'
  assert.equal(audit(receipt).eligibleStatus, 'machine-semantic-extracted')
})

test('present fields require anchors and omitted fields require missing warrants', () => {
  const receipt = fixture()
  receipt.review.fields[0].anchors = []
  receipt.review.fields[1].warrant = 'source'
  assert.equal(audit(receipt).findings.filter((finding) => finding.id === 'RR-COVERAGE').length, 2)
})

test('UTF-8 BOM and CRLF remain part of exact first-line anchor bytes', () => {
  const bytes = Buffer.from('\ufeff# Decision\r\nKeep one authority.\r\n', 'utf8')
  const expectedContract = json({ schemaVersion: 1, id: 'decision-review', revision: '1', requiredFields: ['decision'] })
  const receipt = fixture(expectedContract)
  receipt.source = { sourceId: 'bom', revision: '1', path: 'bom.md', sha256: hash(bytes), bytes: bytes.length }
  receipt.review.fields = [{ name: 'decision', disposition: 'present', summary: 'Decision heading.', warrant: 'source', anchors: [{ lineStart: 1, lineEnd: 1, excerptSha256: hash(Buffer.from('\ufeff# Decision\r\n', 'utf8')) }], uncertainty: 'Heading only.' }]
  receipt.quality.checkedFields = ['decision']
  assert.equal(auditReviewReceipt(bytes, expectedContract, json(receipt), { sourceId: 'bom', revision: '1', path: 'bom.md' }).pass, true)
})

test('unknown and missing properties are malformed rather than ignored', () => {
  const receipt = fixture()
  receipt.review.confidence = 'high'
  assert.throws(() => audit(receipt), /unknown or missing properties/u)
  const expectedContract = contract()
  expectedContract.optional = true
  assert.throws(() => auditReviewReceipt(source, json(expectedContract), json(fixture()), expectedSourceIdentity()), /unknown or missing properties/u)
})

test('duplicate object keys in contract and receipt bytes are malformed, including nested escaped equivalents', () => {
  const duplicateContract = Buffer.from('{"schemaVersion":1,"id":"first","id":"second","revision":"1","requiredFields":["decision","status"]}')
  assert.throws(() => auditReviewReceipt(source, duplicateContract, json(fixture()), expectedSourceIdentity()), /contractBytes contains duplicate object key "id"/u)

  const escapedContract = Buffer.from('{"schemaVersion":1,"id":"first","\\u0069d":"second","revision":"1","requiredFields":["decision","status"]}')
  assert.throws(() => auditReviewReceipt(source, escapedContract, json(fixture()), expectedSourceIdentity()), /contractBytes contains duplicate object key "id"/u)

  const nestedReceipt = Buffer.from(JSON.stringify(fixture()).replace('"sourceId":"example"', '"sourceId":"example","sourceId":"other"'))
  assert.throws(() => auditReviewReceipt(source, json(contract()), nestedReceipt, expectedSourceIdentity()), /receiptBytes.source contains duplicate object key "sourceId"/u)

  const nestedEscapedReceipt = Buffer.from(JSON.stringify(fixture()).replace('"reviewerId":"quality-c"', '"reviewerId":"quality-c","\\u0072eviewerId":"quality-d"'))
  assert.throws(() => auditReviewReceipt(source, json(contract()), nestedEscapedReceipt, expectedSourceIdentity()), /receiptBytes.quality contains duplicate object key "reviewerId"/u)
})

test('CLI distinguishes policy failure, malformed input and non-regular files', () => {
  const dir = mkdtempSync(join(target, 'case-'))
  const sourcePath = join(dir, 'source.md')
  const contractPath = join(dir, 'contract.json')
  const receiptPath = join(dir, 'receipt.json')
  const expectedContract = json(contract())
  writeFileSync(sourcePath, source)
  writeFileSync(contractPath, expectedContract)
  writeFileSync(receiptPath, json(fixture(expectedContract)))
  const cli = fileURLToPath(new URL('../scripts/review_receipt.mjs', import.meta.url))
  const identityArgs = ['--source-id', 'example', '--source-revision', '7', '--source-path', 'decision.md']
  const args = ['--source', sourcePath, ...identityArgs, '--contract', contractPath, '--receipt', receiptPath]
  assert.equal(JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' })).pass, true)

  assert.equal(spawnSync(process.execPath, [cli, '--source', sourcePath, '--contract', contractPath, '--receipt', receiptPath], { encoding: 'utf8' }).status, 1)
  assert.equal(spawnSync(process.execPath, [cli, ...args, '--source-id', 'other'], { encoding: 'utf8' }).status, 1)

  const wrongIdentity = spawnSync(process.execPath, [cli, '--source', sourcePath, '--source-id', 'other', '--source-revision', '7', '--source-path', 'decision.md', '--contract', contractPath, '--receipt', receiptPath], { encoding: 'utf8' })
  assert.equal(wrongIdentity.status, 2)
  assert.equal(JSON.parse(wrongIdentity.stdout).findings.some((finding) => finding.id === 'RR-SOURCE-IDENTITY'), true)

  const rejected = fixture(expectedContract)
  rejected.quality.disposition = 'rejected'
  writeFileSync(receiptPath, json(rejected))
  assert.equal(spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }).status, 2)
  writeFileSync(receiptPath, '{')
  assert.equal(spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }).status, 1)
  mkdirSync(join(dir, 'not-a-file'))
  assert.equal(spawnSync(process.execPath, [cli, '--source', join(dir, 'not-a-file'), '--contract', contractPath, '--receipt', receiptPath], { encoding: 'utf8' }).status, 1)
})
