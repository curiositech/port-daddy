import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { auditSuccessor, materializeSuccessor } from '../scripts/successor_export.mjs'

const repoRoot = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)))
const target = join(repoRoot, 'core/target/successor-export-tests')
mkdirSync(target, { recursive: true })
const cli = fileURLToPath(new URL('../scripts/successor_export.mjs', import.meta.url))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = (value) => Buffer.from(`${JSON.stringify(value)}\n`)
const jsonl = (rows) => Buffer.from(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
const targetProfile = {
  schemaVersion: 1,
  profileId: 'portable-ascii-casefold-v1',
  encoding: 'US-ASCII',
  pathSyntax: 'relative POSIX slash-separated',
  allowedSegmentPattern: '^(?!.*\\.$)[A-Za-z0-9._-]{1,100}$',
  maxSegmentBytes: 100,
  maxPathBytes: 240,
  collisionKey: 'ASCII lowercase of the complete POSIX path',
  fileAncestorCollision: 'forbidden',
  reservedBasenames: ['aux', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'con', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9', 'nul', 'prn'],
}

function fixture() {
  const work = mkdtempSync(join(target, 'case-'))
  const source = join(work, 'source')
  const output = join(work, 'successor')
  mkdirSync(source)
  const files = [
    ['canonical.txt', Buffer.from('one canonical idea\n'), '100644'],
    ['alias.txt', Buffer.from('one canonical idea\n'), '100644'],
    ['bin/keep.sh', Buffer.from('#!/bin/sh\necho safe\n'), '100755'],
    ['history/old.md', Buffer.from('# Preserved only in source\n'), '100644'],
  ]
  for (const [path, bytes, mode] of files) {
    mkdirSync(join(source, path, '..'), { recursive: true })
    writeFileSync(join(source, path), bytes)
    chmodSync(join(source, path), mode === '100755' ? 0o755 : 0o644)
  }
  const universe = files.map(([path, bytes, mode]) => ({ schemaVersion: 1, path, sha256: sha(bytes), bytes: bytes.length, mode }))
  const manifestBase = [
    { schemaVersion: 1, sourcePath: 'canonical.txt', disposition: 'copy-exact', successorPath: 'skills/canonical.txt', generatedFrom: null },
    { schemaVersion: 1, sourcePath: 'alias.txt', disposition: 'regenerate-alias', successorPath: null, generatedFrom: 'canonical.txt' },
    { schemaVersion: 1, sourcePath: 'bin/keep.sh', disposition: 'copy-exact', successorPath: 'bin/keep.sh', generatedFrom: null },
    { schemaVersion: 1, sourcePath: 'history/old.md', disposition: 'omit-approved', successorPath: null, generatedFrom: null },
  ]
  const authorityReceipts = manifestBase.map((row, index) => ({
    schemaVersion: 1,
    decisionId: `loss-audit-${index + 1}`,
    revision: '3',
    scope: { sourceId: 'unrelated-project', revision: 'frozen-1', sourcePath: row.sourcePath },
    disposition: row.disposition,
    authorized: true,
    authorizerId: 'owner-a',
    limitations: [],
  }))
  const authorityRawRows = authorityReceipts.map((row) => Buffer.from(JSON.stringify(row)))
  const fixtureTargetProfile = structuredClone(targetProfile)
  const manifest = manifestBase.map((row, index) => ({
    ...row,
    authority: { decisionId: authorityReceipts[index].decisionId, revision: authorityReceipts[index].revision, receiptSha256: sha(authorityRawRows[index]) },
  }))
  const universeBytes = jsonl(universe)
  const manifestBytes = jsonl(manifest)
  const approval = {
    schemaVersion: 1,
    action: 'materialize-successor',
    decisionId: 'owner-decision-9',
    revision: '1',
    manifestSha256: sha(manifestBytes),
    universeSha256: sha(universeBytes),
    granted: true,
    approverId: 'owner-a',
    scope: { sourceId: 'unrelated-project', revision: 'frozen-1' },
    destination: { outputPath: output },
    limitations: [],
  }
  const approvalBytes = json(approval)
  const lossAudit = {
    schemaVersion: 1,
    source: { sourceId: 'unrelated-project', revision: 'frozen-1', universeSha256: sha(universeBytes), pathCount: universe.length },
    manifest: { sha256: sha(manifestBytes), pathCount: manifest.length },
    authorization: { exportAuthorized: true, approvalSha256: sha(approvalBytes) },
    blockers: [],
  }
  return {
    work,
    source,
    output,
    universe,
    manifest,
    approval,
    lossAudit,
    authorityReceipts,
    targetProfile: fixtureTargetProfile,
    universeBytes,
    manifestBytes,
    approvalBytes,
    lossAuditBytes: json(lossAudit),
    authorityReceiptsBytes: Buffer.concat(authorityRawRows.flatMap((row) => [row, Buffer.from('\n')])),
    targetProfileBytes: json(fixtureTargetProfile),
  }
}

function audit(f) {
  return auditSuccessor({ sourceRoot: f.source, universeBytes: f.universeBytes, manifestBytes: f.manifestBytes, lossAuditBytes: f.lossAuditBytes, approvalBytes: f.approvalBytes, authorityReceiptsBytes: f.authorityReceiptsBytes, targetProfileBytes: f.targetProfileBytes })
}

function materializeArgs(f, outputPath) {
  return { sourceRoot: f.source, universeBytes: f.universeBytes, manifestBytes: f.manifestBytes, lossAuditBytes: f.lossAuditBytes, approvalBytes: f.approvalBytes, authorityReceiptsBytes: f.authorityReceiptsBytes, targetProfileBytes: f.targetProfileBytes, outputPath }
}

function rebind(f) {
  f.universeBytes = jsonl(f.universe)
  f.manifestBytes = jsonl(f.manifest)
  f.approval.universeSha256 = sha(f.universeBytes)
  f.approval.manifestSha256 = sha(f.manifestBytes)
  f.approvalBytes = json(f.approval)
  f.lossAudit.source = { ...f.lossAudit.source, universeSha256: sha(f.universeBytes), pathCount: f.universe.length }
  f.lossAudit.manifest = { sha256: sha(f.manifestBytes), pathCount: f.manifest.length }
  f.lossAudit.authorization.approvalSha256 = sha(f.approvalBytes)
  f.lossAuditBytes = json(f.lossAudit)
}

function replaceAuthorityReceipt(f, index, update) {
  update(f.authorityReceipts[index])
  const rawRows = f.authorityReceipts.map((row) => Buffer.from(JSON.stringify(row)))
  f.authorityReceiptsBytes = Buffer.concat(rawRows.flatMap((row) => [row, Buffer.from('\n')]))
  f.manifest[index].authority.receiptSha256 = sha(rawRows[index])
  rebind(f)
}

test('exact complete approval verifies without writing', () => {
  const f = fixture()
  const result = audit(f)
  assert.equal(result.result.pass, true)
  assert.equal(result.result.status, 'verified-not-materialized')
  assert.deepEqual(result.result.counts, { 'copy-exact': 2, 'omit-approved': 1, 'regenerate-alias': 1 })
  assert.deepEqual(lstatSync(f.work).isDirectory(), true)
  assert.equal(existsSync(join(f.work, 'successor')), false)
  assert.match(result.result.limitations[0], /^TRUST BOUNDARY:.*trusted.*quiescent.*not descriptor-relative/iu)
  assert.equal(result.result.bindings.targetFilesystem.profileId, 'portable-ascii-casefold-v1')
  assert.equal(result.result.bindings.authorityReceipts.receipts, f.manifest.length)
})

test('materialization is a new exact tree with reverse evidence, leaving source intact', () => {
  const f = fixture()
  const output = f.output
  const result = materializeSuccessor(audit(f), materializeArgs(f, output))
  assert.equal(result.status, 'materialized')
  assert.equal(readFileSync(join(output, 'skills/canonical.txt'), 'utf8'), 'one canonical idea\n')
  assert.equal(readFileSync(join(output, 'bin/keep.sh'), 'utf8'), '#!/bin/sh\necho safe\n')
  assert.ok(lstatSync(join(output, 'bin/keep.sh')).mode & 0o111)
  assert.equal(existsSync(join(output, 'alias.txt')), false)
  assert.equal(existsSync(join(output, 'history/old.md')), false)
  assert.equal(readFileSync(join(f.source, 'history/old.md'), 'utf8'), '# Preserved only in source\n')
  assert.deepEqual(readFileSync(join(output, '.harbor-reconciliation/successor-manifest.jsonl')), f.manifestBytes)
  assert.deepEqual(readFileSync(join(output, '.harbor-reconciliation/universe.jsonl')), f.universeBytes)
  assert.deepEqual(readFileSync(join(output, '.harbor-reconciliation/approval.json')), f.approvalBytes)
  assert.deepEqual(readFileSync(join(output, '.harbor-reconciliation/authority-receipts.jsonl')), f.authorityReceiptsBytes)
  assert.deepEqual(readFileSync(join(output, '.harbor-reconciliation/target-filesystem-profile.json')), f.targetProfileBytes)
})

test('materialization re-audits exact declarations instead of trusting a mutable prior result', () => {
  const f = fixture()
  const verified = audit(f)
  verified.rows.manifest[0].sourcePath = 'history/old.md'
  const output = f.output
  const result = materializeSuccessor(verified, materializeArgs(f, output))
  assert.equal(result.status, 'materialized')
  assert.equal(readFileSync(join(output, 'skills/canonical.txt'), 'utf8'), 'one canonical idea\n')
})

test('unresolved blockers and absent authorization fail closed', () => {
  const f = fixture()
  f.lossAudit.authorization.exportAuthorized = false
  f.lossAudit.blockers = ['semantic review incomplete']
  f.lossAuditBytes = json(f.lossAudit)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.deepEqual(result.findings.map((entry) => entry.id), ['SE-AUTHORITY', 'SE-AUTHORITY'])
})

test('free-text approval and authority limitations remain held instead of being ignored', () => {
  const approvalLimited = fixture()
  approvalLimited.approval.limitations = ['Do not materialize until legal review.']
  approvalLimited.approvalBytes = json(approvalLimited.approval)
  approvalLimited.lossAudit.authorization.approvalSha256 = sha(approvalLimited.approvalBytes)
  approvalLimited.lossAuditBytes = json(approvalLimited.lossAudit)
  const approvalResult = audit(approvalLimited).result
  assert.equal(approvalResult.pass, false)
  assert.ok(approvalResult.findings.some((entry) => entry.id === 'SE-AUTHORITY' && entry.path === 'approval.limitations'))

  const rowLimited = fixture()
  replaceAuthorityReceipt(rowLimited, 0, (receipt) => { receipt.limitations = ['Do not copy until source owner confirms.'] })
  const rowResult = audit(rowLimited).result
  assert.equal(rowResult.pass, false)
  assert.ok(rowResult.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && entry.path === 'canonical.txt'))
})

test('manifest, universe and approval byte drift remain held', () => {
  const f = fixture()
  f.manifest[0].successorPath = 'moved/canonical.txt'
  f.manifestBytes = jsonl(f.manifest)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-BINDING' && entry.path === 'manifest'))
})

test('manifest must account for the independently supplied universe exactly', () => {
  const f = fixture()
  f.manifest.pop()
  f.manifestBytes = jsonl(f.manifest)
  f.approval.manifestSha256 = sha(f.manifestBytes)
  f.approvalBytes = json(f.approval)
  f.lossAudit.manifest = { sha256: sha(f.manifestBytes), pathCount: f.manifest.length }
  f.lossAudit.authorization.approvalSha256 = sha(f.approvalBytes)
  f.lossAuditBytes = json(f.lossAudit)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-COVERAGE'))
})

test('the independently supplied universe must account for the actual source tree', () => {
  const f = fixture()
  f.universe.pop()
  f.manifest.pop()
  f.universeBytes = jsonl(f.universe)
  f.manifestBytes = jsonl(f.manifest)
  f.approval.universeSha256 = sha(f.universeBytes)
  f.approval.manifestSha256 = sha(f.manifestBytes)
  f.approvalBytes = json(f.approval)
  f.lossAudit.source = { ...f.lossAudit.source, universeSha256: sha(f.universeBytes), pathCount: f.universe.length }
  f.lossAudit.manifest = { sha256: sha(f.manifestBytes), pathCount: f.manifest.length }
  f.lossAudit.authorization.approvalSha256 = sha(f.approvalBytes)
  f.lossAuditBytes = json(f.lossAudit)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-COVERAGE' && entry.path === 'universe'))
})

test('source byte drift is detected before any output exists', () => {
  const f = fixture()
  writeFileSync(join(f.source, 'canonical.txt'), 'changed\n')
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-SOURCE' && entry.path === 'canonical.txt'))
})

test('source executable-mode drift is detected', () => {
  const f = fixture()
  chmodSync(join(f.source, 'bin/keep.sh'), 0o644)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-SOURCE' && entry.path === 'bin/keep.sh'))
})

test('regenerated aliases must be exact copies of a retained canonical source', () => {
  const f = fixture()
  f.manifest[1].generatedFrom = 'bin/keep.sh'
  f.manifestBytes = jsonl(f.manifest)
  f.approval.manifestSha256 = sha(f.manifestBytes)
  f.approvalBytes = json(f.approval)
  f.lossAudit.manifest.sha256 = sha(f.manifestBytes)
  f.lossAudit.authorization.approvalSha256 = sha(f.approvalBytes)
  f.lossAuditBytes = json(f.lossAudit)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-ALIAS'))
})

test('portable case-folded output collisions are rejected', () => {
  const f = fixture()
  f.manifest[2].successorPath = 'SKILLS/CANONICAL.TXT'
  f.manifestBytes = jsonl(f.manifest)
  f.approval.manifestSha256 = sha(f.manifestBytes)
  f.approvalBytes = json(f.approval)
  f.lossAudit.manifest.sha256 = sha(f.manifestBytes)
  f.lossAudit.authorization.approvalSha256 = sha(f.approvalBytes)
  f.lossAuditBytes = json(f.lossAudit)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-COLLISION'))
})

test('case-folded Git metadata destinations are rejected', () => {
  const f = fixture()
  f.manifest[0].successorPath = '.GIT/config'
  assert.throws(() => auditSuccessor({ ...f, sourceRoot: f.source, manifestBytes: jsonl(f.manifest) }), /Git metadata/u)
})

test('materialization metadata and incomplete-marker namespaces are reserved', () => {
  for (const successorPath of ['.HARBOR-RECONCILIATION/forged', '.Harbor-Reconciliation-Incomplete', '.harbor-reconciliation-incomplete/child']) {
    const f = fixture()
    f.manifest[0].successorPath = successorPath
    assert.throws(
      () => auditSuccessor({ ...f, sourceRoot: f.source, manifestBytes: jsonl(f.manifest) }),
      /reserved successor metadata/u,
    )
  }
})

test('file and descendant output paths cannot collide', () => {
  const f = fixture()
  f.manifest[0].successorPath = 'bin'
  f.manifestBytes = jsonl(f.manifest)
  f.approval.manifestSha256 = sha(f.manifestBytes)
  f.approvalBytes = json(f.approval)
  f.lossAudit.manifest.sha256 = sha(f.manifestBytes)
  f.lossAudit.authorization.approvalSha256 = sha(f.approvalBytes)
  f.lossAuditBytes = json(f.lossAudit)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-COLLISION' && /nested beneath file/u.test(entry.message)))
})

test('every destination ancestor is checked even when another sibling sorts between it', () => {
  const f = fixture()
  f.manifest[0].successorPath = 'a'
  f.manifest[1] = { ...f.manifest[1], disposition: 'copy-exact', successorPath: 'a/x', generatedFrom: null }
  f.manifest[2].successorPath = 'a-b'
  f.manifestBytes = jsonl(f.manifest)
  f.approval.manifestSha256 = sha(f.manifestBytes)
  f.approvalBytes = json(f.approval)
  f.lossAudit.manifest.sha256 = sha(f.manifestBytes)
  f.lossAudit.authorization.approvalSha256 = sha(f.approvalBytes)
  f.lossAuditBytes = json(f.lossAudit)
  const result = audit(f).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-COLLISION' && entry.path === 'a/x'))
})

test('symlinked source files are not followed', () => {
  const f = fixture()
  const outside = join(f.work, 'outside.txt')
  writeFileSync(outside, 'one canonical idea\n')
  symlinkSync(outside, join(f.source, 'canonical-link.txt'))
  f.universe.push({ ...f.universe[0], path: 'canonical-link.txt' })
  f.manifest.push({ ...f.manifest[0], sourcePath: 'canonical-link.txt', successorPath: 'link.txt' })
  f.universeBytes = jsonl(f.universe)
  f.manifestBytes = jsonl(f.manifest)
  f.approval.universeSha256 = sha(f.universeBytes)
  f.approval.manifestSha256 = sha(f.manifestBytes)
  f.approvalBytes = json(f.approval)
  f.lossAudit.source = { ...f.lossAudit.source, universeSha256: sha(f.universeBytes), pathCount: f.universe.length }
  f.lossAudit.manifest = { sha256: sha(f.manifestBytes), pathCount: f.manifest.length }
  f.lossAudit.authorization.approvalSha256 = sha(f.approvalBytes)
  f.lossAuditBytes = json(f.lossAudit)
  assert.throws(() => audit(f), /unsupported symlink|regular non-symlink file/u)
})

test('output must be absent, separate and non-nested', () => {
  const f = fixture()
  const verified = audit(f)
  assert.throws(() => materializeSuccessor(verified, materializeArgs(f, join(f.source, 'nested'))), /separate/u)
  const existing = join(f.work, 'existing')
  mkdirSync(existing)
  assert.throws(() => materializeSuccessor(verified, materializeArgs(f, existing)), /must not already exist/u)
})

test('approval authorizes exactly one canonical output destination', () => {
  const f = fixture()
  const other = join(f.work, 'other-successor')
  assert.throws(() => materializeSuccessor(audit(f), materializeArgs(f, other)), /exact destination authorized/u)
  assert.equal(existsSync(other), false)
  assert.throws(() => auditSuccessor({ ...f, sourceRoot: f.source, approvalBytes: json({ ...f.approval, destination: { outputPath: `${f.work}/nested/../successor` } }) }), /normalized absolute path/u)
})

test('CLI verifies on stdout and materializes only with the explicit paired flags', () => {
  const f = fixture()
  const universe = join(f.work, 'universe.jsonl')
  const manifest = join(f.work, 'manifest.jsonl')
  const lossAudit = join(f.work, 'loss-audit.json')
  const approval = join(f.work, 'approval.json')
  const authorityReceipts = join(f.work, 'authority-receipts.jsonl')
  const targetProfilePath = join(f.work, 'target-filesystem-profile.json')
  writeFileSync(universe, f.universeBytes)
  writeFileSync(manifest, f.manifestBytes)
  writeFileSync(lossAudit, f.lossAuditBytes)
  writeFileSync(approval, f.approvalBytes)
  writeFileSync(authorityReceipts, f.authorityReceiptsBytes)
  writeFileSync(targetProfilePath, f.targetProfileBytes)
  const args = ['--source', f.source, '--universe', universe, '--manifest', manifest, '--loss-audit', lossAudit, '--approval', approval, '--authority-receipts', authorityReceipts, '--target-profile', targetProfilePath]
  const verified = JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }))
  assert.equal(verified.pass, true)
  const bad = spawnSync(process.execPath, [cli, ...args, '--output', join(f.work, 'bad')], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /supplied together/u)
  const duplicate = spawnSync(process.execPath, [cli, ...args, '--source', f.source], { encoding: 'utf8' })
  assert.equal(duplicate.status, 1)
  assert.match(duplicate.stderr, /duplicate argument: --source/u)
  const duplicateOutput = spawnSync(process.execPath, [cli, ...args, '--materialize', '--output', f.output, '--output', join(f.work, 'other')], { encoding: 'utf8' })
  assert.equal(duplicateOutput.status, 1)
  assert.match(duplicateOutput.stderr, /duplicate argument: --output/u)
  assert.equal(existsSync(f.output), false)
  const output = f.output
  const created = JSON.parse(execFileSync(process.execPath, [cli, ...args, '--materialize', '--output', output], { encoding: 'utf8' }))
  assert.equal(created.status, 'materialized')
  assert.ok(existsSync(join(output, '.harbor-reconciliation/materialization-receipt.json')))
})

test('unknown declaration properties fail instead of being ignored', () => {
  const f = fixture()
  f.manifest[0].surprise = true
  assert.throws(() => auditSuccessor({ ...f, sourceRoot: f.source, manifestBytes: jsonl(f.manifest) }), /unknown or missing properties/u)
})

test('duplicate JSON object keys are rejected at depth after escape decoding', () => {
  const f = fixture()
  const approvalText = f.approvalBytes.toString('utf8').replace(
    '"scope":{"sourceId":"unrelated-project",',
    '"scope":{"sourceId":"unrelated-project","\\u0073ourceId":"forged",',
  )
  assert.throws(() => auditSuccessor({ ...f, sourceRoot: f.source, approvalBytes: Buffer.from(approvalText) }), /duplicate JSON object key "sourceId"/u)

  const manifestText = f.manifestBytes.toString('utf8').replace(
    '"authority":{"decisionId":',
    '"authority":{"decisionId":"forged","\\u0064ecisionId":',
  )
  assert.throws(() => auditSuccessor({ ...f, sourceRoot: f.source, manifestBytes: Buffer.from(manifestText) }), /duplicate JSON object key "decisionId"/u)

  const receiptText = f.authorityReceiptsBytes.toString('utf8').replace(
    '"scope":{"sourceId":"unrelated-project",',
    '"scope":{"sourceId":"unrelated-project","\\u0073ourceId":"forged",',
  )
  assert.throws(() => auditSuccessor({ ...f, sourceRoot: f.source, authorityReceiptsBytes: Buffer.from(receiptText) }), /duplicate JSON object key "sourceId"/u)
})

test('authority receipt bundle must be complete, exact and contain no extras', () => {
  const missing = fixture()
  missing.authorityReceiptsBytes = jsonl(missing.authorityReceipts.slice(1))
  let result = audit(missing).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && /missing/u.test(entry.message)))

  const extra = fixture()
  const extraReceipt = { ...extra.authorityReceipts[0], decisionId: 'unreferenced-decision' }
  extra.authorityReceiptsBytes = Buffer.concat([extra.authorityReceiptsBytes, Buffer.from(`${JSON.stringify(extraReceipt)}\n`)])
  result = audit(extra).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && /unreferenced/u.test(entry.message)))

  const byteDrift = fixture()
  byteDrift.authorityReceiptsBytes = Buffer.from(byteDrift.authorityReceiptsBytes.toString('utf8').replace('"schemaVersion":1', '"schemaVersion" : 1'))
  result = audit(byteDrift).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && /missing/u.test(entry.message)))
  assert.ok(result.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && /unreferenced/u.test(entry.message)))

  const bomDrift = fixture()
  bomDrift.authorityReceiptsBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bomDrift.authorityReceiptsBytes])
  result = audit(bomDrift).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && /missing/u.test(entry.message)))
  assert.ok(result.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && /unreferenced/u.test(entry.message)))

  const reused = fixture()
  reused.manifest[1].authority = { ...reused.manifest[0].authority }
  rebind(reused)
  result = audit(reused).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && /reuses/u.test(entry.message)))
})

test('each authority receipt is bound to decision, revision, source scope and disposition', () => {
  const mutations = [
    (row) => { row.decisionId = 'different-decision' },
    (row) => { row.revision = 'different-revision' },
    (row) => { row.scope.sourceId = 'different-source' },
    (row) => { row.scope.revision = 'different-source-revision' },
    (row) => { row.scope.sourcePath = 'alias.txt' },
    (row) => { row.disposition = 'omit-approved' },
  ]
  for (const mutation of mutations) {
    const f = fixture()
    replaceAuthorityReceipt(f, 0, mutation)
    const result = audit(f).result
    assert.equal(result.pass, false)
    assert.ok(result.findings.some((entry) => entry.id === 'SE-AUTHORITY-RECEIPT' && entry.path === 'canonical.txt'))
  }
})

test('target filesystem profile is exact and enforces ASCII alphabet and byte ceilings', () => {
  const changedProfile = fixture()
  changedProfile.targetProfile.maxPathBytes = 4096
  changedProfile.targetProfileBytes = json(changedProfile.targetProfile)
  assert.throws(() => audit(changedProfile), /must exactly match supported profile/u)

  for (const successorPath of ['skills/café.txt', `${'a'.repeat(101)}.txt`, `${'a'.repeat(90)}/${'b'.repeat(90)}/${'c'.repeat(90)}.txt`]) {
    const f = fixture()
    f.manifest[0].successorPath = successorPath
    rebind(f)
    assert.throws(() => audit(f), /target profile portable-ascii-casefold-v1/u)
  }
})

test('source census skips only exact top-level .git and accounts for case variants', () => {
  const exact = fixture()
  mkdirSync(join(exact.source, '.git'))
  writeFileSync(join(exact.source, '.git/ignored'), 'git metadata\n')
  assert.equal(audit(exact).result.pass, true)

  const caseVariant = fixture()
  mkdirSync(join(caseVariant.source, '.GIT'))
  writeFileSync(join(caseVariant.source, '.GIT/not-ignored'), 'ordinary source content\n')
  const result = audit(caseVariant).result
  assert.equal(result.pass, false)
  assert.ok(result.findings.some((entry) => entry.id === 'SE-COVERAGE' && entry.path === 'universe'))
})

test('source census uses bounded directory iteration rather than whole-directory reads', () => {
  const implementation = readFileSync(cli, 'utf8')
  assert.match(implementation, /opendirSync/u)
  assert.doesNotMatch(implementation, /readdirSync/u)
})
