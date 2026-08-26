#!/usr/bin/env node
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  PROOF_SCHEMA,
  canonicalJson,
  exactCommit,
  gifDimensions,
  pngDimensions,
  semanticContract,
  semanticSnapshot,
  sha256,
  transcriptHeadHash,
  validateProofManifest,
  validateScenario,
} from './provenance.mjs'

const demoRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(demoRoot, '../..')
const scenarioPath = join(demoRoot, 'scenario.fixture.json')
const scenario = validateScenario(JSON.parse(readFileSync(scenarioPath, 'utf8')))

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const mode = option('--mode', process.argv.includes('--native') ? 'native' : 'ci')
if (!['ci', 'native'].includes(mode)) throw new Error('--mode must be ci or native')
const repeat = Number(option('--repeat', '2'))
if (!Number.isInteger(repeat) || repeat < 2) throw new Error('--repeat must be an integer of at least 2')
const outputRoot = resolve(option('--output', join(repoRoot, 'core/pd-console/docs/artifacts/gpui/ast-suggestibility-d0')))
const daemonUrl = `http://127.0.0.1:${scenario.daemonPort}`
const commit = exactCommit(repoRoot)
const captureCommand = `demos/ast-suggestibility/capture.sh --${mode === 'native' ? 'native' : 'ci'} --repeat ${repeat}`

function assertOutputBoundary(path) {
  const relativeToRepo = relative(repoRoot, path)
  const codingScratch = resolve(process.env.HOME ?? '', 'coding/tmp')
  const relativeToScratch = relative(codingScratch, path)
  const inRepo = relativeToRepo !== '..' && !relativeToRepo.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  const inScratch = relativeToScratch !== '..' && !relativeToScratch.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  if (!inRepo && !inScratch) throw new Error('output must stay inside this worktree or ~/coding/tmp')
}

assertOutputBoundary(outputRoot)

async function jsonFetch(path, init) {
  const response = await fetch(`${daemonUrl}${path}`, init)
  const payload = await response.json()
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${JSON.stringify(payload)}`)
  return payload
}

async function waitForFixture() {
  let lastError
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const health = await jsonFetch('/health')
      if (
        health.scenarioId !== scenario.scenarioId ||
        health.sourceLabel !== 'fixture' ||
        health.daemonPort !== scenario.daemonPort
      ) {
        throw new Error(`wrong daemon on ${daemonUrl}: ${JSON.stringify(health)}`)
      }
      return health
    } catch (error) {
      lastError = error
      await delay(100)
    }
  }
  throw new Error(`fixture daemon did not become ready: ${lastError?.message}`)
}

async function setState(name) {
  const payload = await jsonFetch('/__proof/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId: scenario.scenarioId, state: name }),
  })
  if (payload.proofState !== name || payload.sourceLabel !== 'fixture') {
    throw new Error(`state transition ${name} lost provenance`)
  }
  return payload
}

async function collectState(state) {
  await setState(state.name)
  const roster = await jsonFetch('/agent-nodes')
  const blackboard = await jsonFetch('/blackboard?limit=50')
  const events = await jsonFetch('/sessions/sess-ast-suggest-d0/events?limit=200')
  const commands = await jsonFetch(`/agent-nodes/${scenario.agentNodeId}/control`)
  for (const payload of [roster, blackboard, events, commands]) {
    if (payload.scenarioId !== scenario.scenarioId || payload.sourceLabel !== 'fixture' || payload.proofState !== state.name) {
      throw new Error(`${state.name} response lost fixture provenance`)
    }
  }
  return semanticSnapshot({
    scenario,
    state,
    roster: roster.nodes,
    events: events.events,
    blackboard: blackboard.data,
    commands: commands.commands,
  })
}

function videoDimensions(path) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    path,
  ], { encoding: 'utf8' })
  if (probe.status !== 0) throw new Error(`ffprobe failed for ${path}: ${probe.stderr}`)
  const stream = JSON.parse(probe.stdout).streams?.[0]
  if (!Number.isInteger(stream?.width) || !Number.isInteger(stream?.height)) {
    throw new Error(`ffprobe found no video dimensions for ${path}`)
  }
  return { width: stream.width, height: stream.height }
}

function dimensionsFor(path) {
  if (path.endsWith('.png')) return pngDimensions(path)
  if (path.endsWith('.gif')) return gifDimensions(path)
  if (path.endsWith('.mp4') || path.endsWith('.mov')) return videoDimensions(path)
  throw new Error(`unsupported media file ${path}`)
}

function visualFiles(runDir) {
  if (!existsSync(runDir)) return []
  return readdirSync(runDir)
    .filter((name) => /^(state-.+\.png|proof(?:-window-fallback)?\.(?:gif|mp4|mov))$/.test(name))
    .sort()
}

function nativeCapture(runDir) {
  const captureScript = join(repoRoot, 'core/pd-console/scripts/proof/capture-proof.sh')
  const result = spawnSync(captureScript, [runDir], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT_DADDY_URL: daemonUrl,
      PD_PROOF_ALLOW_PRIMARY: '1',
      PD_PROOF_DURATION: String(scenario.motion.durationSeconds),
      PD_PROOF_FPS: String(scenario.motion.fps),
      PD_PROOF_SCENARIO_FILE: scenarioPath,
      PD_PROOF_SCENARIO_STATES: scenario.captureStates.map((state) => state.name).join(' '),
      PD_PROOF_SCENARIO_PANE: 'harbor',
      PD_PROOF_STATE_DRIVER: join(demoRoot, 'action-driver.mjs'),
      PD_PROOF_VIDEO_MODE: process.env.PD_PROOF_VIDEO_MODE ?? 'auto',
      PD_PROOF_STAMP: `ast-suggest-d0-${basename(runDir)}`,
    },
  })
  if (result.status !== 0) throw new Error(`native exact-window capture failed with status ${result.status}`)
}

async function writeRun(index) {
  const runDir = join(outputRoot, `run-${index}`)
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(runDir, { recursive: true })

  if (mode === 'native') nativeCapture(runDir)

  const semanticStateHashes = {}
  const stateTranscriptHeadHashes = {}
  for (const state of scenario.captureStates) {
    const snapshot = await collectState(state)
    const file = `semantic-${state.name}.json`
    const serialized = canonicalJson(snapshot)
    writeFileSync(join(runDir, file), serialized)
    semanticStateHashes[state.name] = sha256(serialized)
    stateTranscriptHeadHashes[state.name] = transcriptHeadHash(snapshot.events)
  }

  const finalHealth = await jsonFetch('/health')
  const receipt = {
    schema: 'pd.ast-suggestibility.capture-receipt.v1',
    scenarioId: scenario.scenarioId,
    sourceLabel: scenario.sourceLabel,
    daemonPort: scenario.daemonPort,
    runId: scenario.runId,
    transcriptHeadHash: finalHealth.transcriptHeadHash,
    agentNodeId: scenario.agentNodeId,
    commit,
    stateNames: scenario.captureStates.map((state) => state.name),
    dimensions: scenario.canvas,
    captureCommand,
    captureMode: mode,
    syntheticClock: scenario.clock,
  }
  const receiptBytes = canonicalJson(receipt)
  writeFileSync(join(runDir, 'RECEIPT.json'), receiptBytes)

  const artifacts = []
  for (const file of visualFiles(runDir)) {
    const filePath = join(runDir, file)
    const stateMatch = file.match(/^state-(.+)\.png$/)
    const stateNames = stateMatch ? [stateMatch[1]] : scenario.captureStates.map((state) => state.name)
    const stateHash = stateMatch
      ? semanticStateHashes[stateMatch[1]]
      : sha256(canonicalJson(semanticStateHashes))
    const sidecar = {
      schema: PROOF_SCHEMA,
      artifactFile: file,
      daemonPort: scenario.daemonPort,
      runId: scenario.runId,
      transcriptHeadHash: stateMatch
        ? stateTranscriptHeadHashes[stateMatch[1]]
        : finalHealth.transcriptHeadHash,
      agentNodeId: scenario.agentNodeId,
      commit,
      sourceLabel: scenario.sourceLabel,
      stateNames,
      semanticStateHash: stateHash,
      dimensions: dimensionsFor(filePath),
      captureCommand,
      exactWindowOnly: true,
      sha256: sha256(readFileSync(filePath)),
    }
    writeFileSync(`${filePath}.manifest.json`, canonicalJson(sidecar))
    artifacts.push({ file, manifest: sidecar })
  }

  const manifest = {
    schema: PROOF_SCHEMA,
    scenarioId: scenario.scenarioId,
    sourceLabel: scenario.sourceLabel,
    daemonPort: scenario.daemonPort,
    runId: scenario.runId,
    transcriptHeadHash: finalHealth.transcriptHeadHash,
    agentNodeId: scenario.agentNodeId,
    commit,
    captureMode: mode,
    captureCommand,
    exactWindowOnly: true,
    dimensions: scenario.canvas,
    stateNames: scenario.captureStates.map((state) => state.name),
    requiredControlPanelStates: scenario.requiredControlPanelStates,
    semanticStateHashes,
    stateTranscriptHeadHashes,
    receipt: { file: 'RECEIPT.json', sha256: sha256(receiptBytes) },
    artifacts,
  }
  validateProofManifest(manifest, {
    expectedCommit: commit,
    expectedScenario: scenario,
    requireMedia: mode === 'native',
  })
  writeFileSync(join(runDir, 'MANIFEST.json'), canonicalJson(manifest))
  return manifest
}

mkdirSync(outputRoot, { recursive: true })
const fixture = spawn(process.execPath, [join(demoRoot, 'fixture-daemon.mjs'), '--scenario', scenarioPath], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let fixtureOutput = ''
fixture.stdout.on('data', (chunk) => { fixtureOutput += chunk })
fixture.stderr.on('data', (chunk) => { fixtureOutput += chunk })

try {
  await waitForFixture()
  const manifests = []
  for (let index = 1; index <= repeat; index += 1) manifests.push(await writeRun(index))
  const reference = canonicalJson(semanticContract(manifests[0]))
  for (const manifest of manifests.slice(1)) {
    if (canonicalJson(semanticContract(manifest)) !== reference) {
      throw new Error('repeatability failure: semantic manifest contract drifted between captures')
    }
  }
  const repeatability = {
    schema: 'pd.ast-suggestibility.repeatability.v1',
    pass: true,
    captureCount: manifests.length,
    semanticContractHash: sha256(reference),
    mediaHashesCompared: false,
    reason: 'semantic states and provenance contract match; encoded media hashes are intentionally non-authoritative',
    runs: manifests.map((manifest, index) => ({
      directory: `run-${index + 1}`,
      manifest: 'MANIFEST.json',
      semanticStateHashes: manifest.semanticStateHashes,
    })),
  }
  writeFileSync(join(outputRoot, 'REPEATABILITY.json'), canonicalJson(repeatability))
  process.stdout.write(`D0 ${mode} proof: ${outputRoot}\n`)
  process.stdout.write(`repeatability: PASS (${repeat} consecutive captures, ${repeatability.semanticContractHash.slice(0, 16)})\n`)
} catch (error) {
  throw new Error(`${error.message}${fixtureOutput ? `\nfixture output:\n${fixtureOutput}` : ''}`)
} finally {
  fixture.kill('SIGTERM')
}
