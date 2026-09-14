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

function fixture() {
  const work = mkdtempSync(join(target, 'case-'))
  const source = join(work, 'source')
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
  const authority = { decisionId: 'loss-audit-7', revision: '3', receiptSha256: 'a'.repeat(64) }
  const manifest = [
    { schemaVersion: 1, sourcePath: 'canonical.txt', disposition: 'copy-exact', successorPath: 'skills/canonical.txt', generatedFrom: null, authority },
    { schemaVersion: 1, sourcePath: 'alias.txt', disposition: 'regenerate-alias', successorPath: null, generatedFrom: 'canonical.txt', authority },
    { schemaVersion: 1, sourcePath: 'bin/keep.sh', disposition: 'copy-exact', successorPath: 'bin/keep.sh', generatedFrom: null, authority },
    { schemaVersion: 1, sourcePath: 'history/old.md', disposition: 'omit-approved', successorPath: null, generatedFrom: null, authority },
  ]
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
    limitations: ['Local exact-copy successor only.'],
  }
  const approvalBytes = json(approval)
  const lossAudit = {
    schemaVersion: 1,
    source: { sourceId: 'unrelated-project', revision: 'frozen-1', universeSha256: sha(universeBytes), pathCount: universe.length },
    manifest: { sha256: sha(manifestBytes), pathCount: manifest.length },
    authorization: { exportAuthorized: true, approvalSha256: sha(approvalBytes) },
    blockers: [],
  }
  return { work, source, universe, manifest, approval, lossAudit, universeBytes, manifestBytes, approvalBytes, lossAuditBytes: json(lossAudit) }
}

function audit(f) {
  return auditSuccessor({ sourceRoot: f.source, universeBytes: f.universeBytes, manifestBytes: f.manifestBytes, lossAuditBytes: f.lossAuditBytes, approvalBytes: f.approvalBytes })
}

test('exact complete approval verifies without writing', () => {
  const f = fixture()
  const result = audit(f)
  assert.equal(result.result.pass, true)
  assert.equal(result.result.status, 'verified-not-materialized')
  assert.deepEqual(result.result.counts, { 'copy-exact': 2, 'omit-approved': 1, 'regenerate-alias': 1 })
  assert.deepEqual(lstatSync(f.work).isDirectory(), true)
  assert.equal(existsSync(join(f.work, 'successor')), false)
})

test('materialization is a new exact tree with reverse evidence, leaving source intact', () => {
  const f = fixture()
  const output = join(f.work, 'successor')
  const result = materializeSuccessor(audit(f), { sourceRoot: f.source, universeBytes: f.universeBytes, manifestBytes: f.manifestBytes, lossAuditBytes: f.lossAuditBytes, approvalBytes: f.approvalBytes, outputPath: output })
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
})

test('materialization re-audits exact declarations instead of trusting a mutable prior result', () => {
  const f = fixture()
  const verified = audit(f)
  verified.rows.manifest[0].sourcePath = 'history/old.md'
  const output = join(f.work, 'successor-after-mutated-result')
  const result = materializeSuccessor(verified, { sourceRoot: f.source, universeBytes: f.universeBytes, manifestBytes: f.manifestBytes, lossAuditBytes: f.lossAuditBytes, approvalBytes: f.approvalBytes, outputPath: output })
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
  assert.throws(() => materializeSuccessor(verified, { sourceRoot: f.source, universeBytes: f.universeBytes, manifestBytes: f.manifestBytes, lossAuditBytes: f.lossAuditBytes, approvalBytes: f.approvalBytes, outputPath: join(f.source, 'nested') }), /separate/u)
  const existing = join(f.work, 'existing')
  mkdirSync(existing)
  assert.throws(() => materializeSuccessor(verified, { sourceRoot: f.source, universeBytes: f.universeBytes, manifestBytes: f.manifestBytes, lossAuditBytes: f.lossAuditBytes, approvalBytes: f.approvalBytes, outputPath: existing }), /must not already exist/u)
})

test('CLI verifies on stdout and materializes only with the explicit paired flags', () => {
  const f = fixture()
  const universe = join(f.work, 'universe.jsonl')
  const manifest = join(f.work, 'manifest.jsonl')
  const lossAudit = join(f.work, 'loss-audit.json')
  const approval = join(f.work, 'approval.json')
  writeFileSync(universe, f.universeBytes)
  writeFileSync(manifest, f.manifestBytes)
  writeFileSync(lossAudit, f.lossAuditBytes)
  writeFileSync(approval, f.approvalBytes)
  const args = ['--source', f.source, '--universe', universe, '--manifest', manifest, '--loss-audit', lossAudit, '--approval', approval]
  const verified = JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }))
  assert.equal(verified.pass, true)
  const bad = spawnSync(process.execPath, [cli, ...args, '--output', join(f.work, 'bad')], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /supplied together/u)
  const output = join(f.work, 'cli-successor')
  const created = JSON.parse(execFileSync(process.execPath, [cli, ...args, '--materialize', '--output', output], { encoding: 'utf8' }))
  assert.equal(created.status, 'materialized')
  assert.ok(existsSync(join(output, '.harbor-reconciliation/materialization-receipt.json')))
})

test('unknown declaration properties fail instead of being ignored', () => {
  const f = fixture()
  f.manifest[0].surprise = true
  assert.throws(() => auditSuccessor({ ...f, sourceRoot: f.source, manifestBytes: jsonl(f.manifest) }), /unknown or missing properties/u)
})
