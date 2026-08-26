#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { validateProofManifest, validateScenario } from './provenance.mjs'

const demoRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(demoRoot, '../..')
const scratch = join(repoRoot, '.scratch', 'ast-suggestibility-e2e')
const output = join(scratch, 'proof')
const scenario = validateScenario(JSON.parse(readFileSync(join(demoRoot, 'scenario.fixture.json'), 'utf8')))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test.before(() => {
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  execFileSync(process.execPath, [
    join(demoRoot, 'run-voyage.mjs'),
    '--mode', 'ci',
    '--repeat', '2',
    '--output', output,
  ], { cwd: repoRoot, stdio: 'pipe' })
})

test.after(() => rmSync(scratch, { recursive: true, force: true }))

test('two consecutive CI-safe captures preserve semantic state and manifest contract', () => {
  const repeatability = JSON.parse(readFileSync(join(output, 'REPEATABILITY.json'), 'utf8'))
  assert.equal(repeatability.pass, true)
  assert.equal(repeatability.captureCount, 2)
  assert.deepEqual(repeatability.runs[0].semanticStateHashes, repeatability.runs[1].semanticStateHashes)

  for (const index of [1, 2]) {
    const manifest = JSON.parse(readFileSync(join(output, `run-${index}`, 'MANIFEST.json'), 'utf8'))
    assert.equal(validateProofManifest(manifest, { expectedCommit: commit, expectedScenario: scenario }), true)
  }
})

test('provenance validation fails closed on missing and stale fields', () => {
  const valid = JSON.parse(readFileSync(join(output, 'run-1', 'MANIFEST.json'), 'utf8'))
  const cases = [
    ['missing daemonPort', (value) => { delete value.daemonPort }],
    ['stale commit', (value) => { value.commit = '0'.repeat(40) }],
    ['wrong daemon', (value) => { value.daemonPort += 1 }],
    ['missing receipt', (value) => { delete value.receipt }],
    ['fixture mislabeled real', (value) => { value.sourceLabel = 'real' }],
    ['private path', (value) => { value.captureCommand += ' /Users/operator/private' }],
    ['broad capture', (value) => { value.captureCommand = 'screencapture broad.png' }],
  ]
  for (const [label, mutate] of cases) {
    const candidate = clone(valid)
    mutate(candidate)
    assert.throws(
      () => validateProofManifest(candidate, { expectedCommit: commit, expectedScenario: scenario }),
      undefined,
      label,
    )
  }
})

test('artifact provenance is checked independently from the bundle', () => {
  const valid = JSON.parse(readFileSync(join(output, 'run-1', 'MANIFEST.json'), 'utf8'))
  valid.artifacts = [{
    file: 'state-active.png',
    manifest: {
      daemonPort: scenario.daemonPort,
      runId: scenario.runId,
      transcriptHeadHash: valid.transcriptHeadHash,
      agentNodeId: scenario.agentNodeId,
      commit: 'f'.repeat(40),
      sourceLabel: 'fixture',
      stateNames: ['active'],
      dimensions: scenario.canvas,
      captureCommand: valid.captureCommand,
    },
  }]
  assert.throws(
    () => validateProofManifest(valid, { expectedCommit: commit, expectedScenario: scenario }),
    /stale artifact commit/,
  )
})
