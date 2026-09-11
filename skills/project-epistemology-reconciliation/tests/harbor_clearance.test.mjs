import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import currentSnapshot from '../examples/port-daddy-open-pr-snapshot.json' with { type: 'json' }
import { installExternalEffectGuards } from './deny_external_effects.mjs'

installExternalEffectGuards()

const harbor = await import('../scripts/harbor_clearance.mjs')
const guardedChildProcess = (await import('node:child_process')).default
const guardedHttps = (await import('node:https')).default
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const scriptPath = fileURLToPath(new URL('../scripts/harbor_clearance.mjs', import.meta.url))
const snapshotPath = fileURLToPath(new URL('../examples/port-daddy-open-pr-snapshot.json', import.meta.url))

const claim = (id, overrides = {}) => ({
  id,
  scope: 'synthetic/scope',
  decisionKey: id,
  subject: id,
  predicate: 'uses',
  value: 'one',
  polarity: 'affirm',
  modality: 'target',
  status: 'verified',
  warrant: 'source',
  exclusive: false,
  requiresDecision: false,
  topicIds: ['main'],
  source: { kind: 'artifact', ref: `synthetic:${id}`, excerpt: `Synthetic fixture ${id}` },
  links: { duplicates: [], supersedes: [], implements: [] },
  salvage: { unique: false, destination: null },
  ...overrides,
})

const signals = (overrides = {}) => ({
  checks: 'unknown',
  review: 'unknown',
  mergeability: 'unknown',
  recovered: false,
  stale: false,
  historicalOnly: false,
  noUniqueClaimsVerified: false,
  suggestedDisposition: null,
  ...overrides,
})

const pr = (number, claimIds, signalOverrides = {}, overrides = {}) => ({
  number,
  title: `Synthetic PR ${number}`,
  state: 'open',
  draft: false,
  metadataCompleteness: 'full',
  topicIds: ['main'],
  claimIds,
  foldInto: null,
  signals: signals(signalOverrides),
  ...overrides,
})

function adversarialSnapshot() {
  const claims = [
    claim('dup-a', { decisionKey: 'duplicate', subject: 'duplicate', value: 'same', source: { kind: 'pr', ref: 'PR #1 fixture', excerpt: 'Duplicate A', prNumber: 1 } }),
    claim('dup-b', { decisionKey: 'duplicate', subject: 'duplicate', value: 'same', source: { kind: 'pr', ref: 'PR #2 fixture', excerpt: 'Duplicate B', prNumber: 2 } }),
    claim('superseded', { decisionKey: 'supersession' }),
    claim('successor', { decisionKey: 'supersession', value: 'two', links: { duplicates: [], supersedes: ['superseded'], implements: [] } }),
    claim('current', { decisionKey: 'timeline', subject: 'timeline', value: 'old', modality: 'current', exclusive: true }),
    claim('target', { decisionKey: 'timeline', subject: 'timeline', value: 'new', modality: 'target', exclusive: true }),
    claim('plan', { decisionKey: 'delivery', subject: 'delivery', value: 'exact', modality: 'plan' }),
    claim('implementation', { decisionKey: 'delivery', subject: 'delivery', value: 'exact', modality: 'implementation' }),
    claim('affirmed', { decisionKey: 'contradiction', subject: 'contradiction', value: 'enabled', modality: 'current', exclusive: true }),
    claim('denied', { decisionKey: 'contradiction', subject: 'contradiction', value: 'enabled', polarity: 'deny', modality: 'current', exclusive: true }),
    claim('fork-a', { decisionKey: 'fork', subject: 'fork', value: 'alpha', exclusive: true, requiresDecision: true }),
    claim('fork-b', { decisionKey: 'fork', subject: 'fork', value: 'beta', exclusive: true, requiresDecision: true }),
    claim('stranded', { topicIds: ['unique'], salvage: { unique: true, destination: 'PR #12 refit backlog' } }),
    claim('scuttle-preserved', { salvage: { unique: false, destination: 'docs/archive/synthetic-fate.md' } }),
    claim('lexical-one', { scope: 'negative/a', decisionKey: 'first', subject: 'same words', value: 'same words' }),
    claim('lexical-two', { scope: 'negative/b', decisionKey: 'second', subject: 'same words nearby', value: 'same words nearby' }),
  ]
  return {
    schemaVersion: 1,
    snapshot: {
      id: 'adversarial-fixture-v1',
      capturedAt: '2026-09-10T00:00:00Z',
      repository: 'synthetic/offline',
      sourceHead: 'fixture-head',
      completeness: 'complete',
      operatorHalt: true,
      source: 'deterministic injected fixture',
      limitations: ['Synthetic evidence is not repository truth.'],
    },
    topics: [
      { id: 'main', label: 'Main synthetic family' },
      { id: 'unique', label: 'Stranded idea control' },
    ],
    corpus: [{ path: 'skills/project-epistemology-reconciliation/examples/sample-input.json', kind: 'fixture', extensions: ['.json'] }],
    claims,
    pullRequests: [
      pr(1, ['dup-a'], { checks: 'pass', review: 'complete', mergeability: 'clean' }),
      pr(2, ['dup-b'], { suggestedDisposition: 'FOLD' }, { foldInto: 1 }),
      pr(3, ['superseded'], { suggestedDisposition: 'FOLD' }, { foldInto: 4 }),
      pr(4, ['successor'], { checks: 'pass', review: 'complete', mergeability: 'clean' }),
      pr(10, ['plan', 'implementation'], { checks: 'pass', review: 'complete', mergeability: 'clean' }),
      pr(11, ['current', 'target'], { checks: 'fail', review: 'complete', mergeability: 'clean' }),
      pr(12, ['stranded'], { recovered: true }),
      pr(13, ['affirmed', 'denied', 'fork-a', 'fork-b']),
      pr(14, ['scuttle-preserved'], { suggestedDisposition: 'SCUTTLE' }),
      pr(15, [], { historicalOnly: true, noUniqueClaimsVerified: true }),
      pr(16, ['lexical-one', 'lexical-two']),
    ],
  }
}

const emptyInventory = Object.freeze({ total: 0, countsByKind: {}, artifacts: [], skipped: [] })

test('current frozen snapshot inventories both historical research trees and links #10108 to #10123', () => {
  const snapshot = structuredClone(currentSnapshot)
  const before = structuredClone(snapshot)
  const report = harbor.analyzeSnapshot(repoRoot, snapshot)
  assert.ok(report.inventory.total >= 500)
  assert.ok(report.inventory.artifacts.some((artifact) => artifact.path.startsWith('docs/research/')))
  assert.ok(report.inventory.artifacts.some((artifact) => artifact.path.startsWith('docs/harbor-research/')))
  assert.ok(report.claims.normalized.every((item) => item.source.ref && item.source.excerpt))
  assert.equal(report.pullRequests.total, 16)
  assert.equal(report.pullRequests.source, 'frozen-input')
  assert.ok(report.claims.structuredStatusCandidates.every((item) => item.normalized.method === 'exact-structured-v1'))
  assert.ok(report.relations.some((relation) => relation.kind === 'implementation-vs-plan'
    && [relation.from, relation.to].includes('action-adjudication-plan')
    && [relation.from, relation.to].includes('pr-10123-action-adjudication')))
  const family = report.prFamilies.find((item) => item.pullRequests.includes(10108))
  assert.ok(family.pullRequests.includes(10123))
  assert.equal(report.clearancePlan.find((item) => item.pullRequest === 10123).proposedDisposition, 'HELD')
  assert.equal(report.canonical, false)
  assert.equal(report.actuation, 'none')
  assert.deepEqual(snapshot, before)
})

test('injected fixture produces all relation and disposition classes', () => {
  const snapshot = adversarialSnapshot()
  harbor.validateSnapshot(snapshot)
  const report = harbor.buildClearanceReport(snapshot, emptyInventory)
  assert.deepEqual(new Set(report.relations.map((relation) => relation.kind)), new Set(harbor.RELATION_KINDS))
  assert.deepEqual(new Set(report.clearancePlan.map((item) => item.proposedDisposition)), new Set(harbor.DISPOSITIONS))
  assert.equal(report.clearancePlan.find((item) => item.pullRequest === 2).lossAudit.complete, true)
  assert.equal(report.clearancePlan.find((item) => item.pullRequest === 14).lossAudit.complete, true)
  assert.equal(report.clearancePlan.find((item) => item.pullRequest === 15).lossAudit.noClaimsVerified, true)
})

test('negative control does not infer a relation from similar prose', () => {
  const relations = harbor.classifyRelations(adversarialSnapshot().claims)
  assert.equal(relations.some((relation) => [relation.from, relation.to].includes('lexical-one')
    && [relation.from, relation.to].includes('lexical-two')), false)
})

test('unaccounted destructive proposal is downgraded to HELD with a loss audit', () => {
  const snapshot = adversarialSnapshot()
  const item = snapshot.pullRequests.find((candidate) => candidate.number === 14)
  snapshot.claims.find((candidate) => candidate.id === 'scuttle-preserved').salvage.destination = null
  const relations = harbor.classifyRelations(snapshot.claims)
  const result = harbor.proposeClearancePlan(snapshot, snapshot.claims.map(harbor.normalizeClaim), relations)
    .find((candidate) => candidate.pullRequest === item.number)
  assert.equal(result.proposedDisposition, 'HELD')
  assert.equal(result.candidateDisposition, 'SCUTTLE')
  assert.equal(result.lossAudit.complete, false)
  assert.deepEqual(result.lossAudit.unaccountedClaimIds, ['scuttle-preserved'])
})

test('normalization is idempotent for deterministic unicode and whitespace cases', () => {
  let seed = 0x10123
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed
  }
  const atoms = ['Alpha', 'BETA', 'caf\u00e9', 'cafe\u0301', '\uff21', '\t', '\n', '  ', '\u00a0', '\ud83e\udded']
  for (let index = 0; index < 500; index += 1) {
    const value = `Alpha ${Array.from({ length: 2 + (next() % 8) }, () => atoms[next() % atoms.length]).join(' ')}`
    const normalized = harbor.normalizeTerm(value)
    assert.equal(harbor.normalizeTerm(normalized), normalized)
  }
})

test('report is deterministic under claim, topic, and PR permutation', () => {
  const original = adversarialSnapshot()
  const reversed = structuredClone(original)
  reversed.claims.reverse()
  reversed.topics.reverse()
  reversed.pullRequests.reverse()
  assert.deepEqual(
    harbor.buildClearanceReport(original, emptyInventory),
    harbor.buildClearanceReport(reversed, emptyInventory),
  )
})

test('core imports are allowlisted and runtime guards deny external effects', () => {
  const source = readFileSync(scriptPath, 'utf8')
  const imports = [...source.matchAll(/from\s+['"](node:[^'"]+)['"]/gu)].map((match) => match[1]).sort()
  assert.deepEqual(imports, [...harbor.SAFETY_CONTRACT.imports].sort())
  assert.equal(source.includes('node:child_process'), false)
  assert.equal(source.includes('node:http'), false)
  assert.equal(source.includes('node:https'), false)
  assert.equal(source.includes('node:net'), false)
  assert.throws(() => globalThis.fetch('https://api.github.com'), /OFFLINE_HARNESS_BLOCKED:fetch/u)
  assert.throws(() => guardedHttps.request('https://api.github.com'), /OFFLINE_HARNESS_BLOCKED:http\.request/u)
  for (const command of ['pd', 'port-daddy', 'launchctl', 'codex']) {
    assert.throws(() => guardedChildProcess.spawnSync(command, ['--version']), /OFFLINE_HARNESS_BLOCKED:child_process\.spawnSync/u)
  }
})

test('CLI rejects URLs and canonical output paths before any effect', () => {
  const errors = []
  assert.equal(harbor.runCli(['--snapshot', 'https://example.invalid/snapshot.json'], {
    cwd: repoRoot,
    stdout: () => assert.fail('URL input must not write stdout'),
    stderr: (message) => errors.push(message),
  }), 1)
  assert.match(errors.join(''), /local path, not a URL/u)
  assert.throws(() => harbor.resolveOutputDir(repoRoot, 'docs/generated'), /must stay inside \.cache\/harbor-clearance/u)
})

test('CLI stdout mode produces a non-canonical report without creating output', () => {
  const output = []
  const errors = []
  const status = harbor.runCli(['--snapshot', snapshotPath, '--repo', repoRoot, '--stdout', '--format', 'json'], {
    cwd: repoRoot,
    stdout: (message) => output.push(message),
    stderr: (message) => errors.push(message),
  })
  assert.equal(status, 0)
  assert.deepEqual(errors, [])
  const report = JSON.parse(output.join(''))
  assert.equal(report.generatedArtifact, true)
  assert.equal(report.safety.mode, 'offline-non-actuating')
  assert.equal(report.safety.githubWrites, false)
  assert.equal(report.safety.externalModels, false)
})
