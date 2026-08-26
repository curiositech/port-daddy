import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const PROOF_SCHEMA = 'pd.ast-suggestibility.visual-proof.v1'
export const REQUIRED_CONTROL_PANEL_STATES = [
  'active',
  'historical',
  'blocked',
  'stale',
  'gate',
  'interrupt',
  'receipt',
]
export const SOURCE_LABELS = new Set(['real', 'fixture', 'mock'])

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function transcriptHeadHash(events) {
  return sha256(canonicalJson(events))
}

export function exactCommit(repoRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim()
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function placeholder(value) {
  return /^(unknown|todo|tbd|placeholder)$/i.test(String(value).trim())
}

export function validateScenario(scenario) {
  const errors = []
  if (scenario?.schema !== 'pd.ast-suggestibility.voyage.v1') errors.push('unexpected scenario schema')
  for (const key of ['scenarioId', 'title', 'runId', 'agentNodeId']) {
    if (!nonEmptyString(scenario?.[key])) errors.push(`scenario missing ${key}`)
  }
  if (scenario?.sourceLabel !== 'fixture') {
    errors.push('the checked-in D0 reference scenario must be sourceLabel=fixture')
  }
  if (!Number.isInteger(scenario?.daemonPort) || scenario.daemonPort < 1024 || scenario.daemonPort > 65535) {
    errors.push('scenario daemonPort must be a non-privileged TCP port')
  }
  if (scenario?.motion?.fps !== 24) errors.push('scenario motion fps must be 24')
  if (JSON.stringify(scenario?.requiredControlPanelStates) !== JSON.stringify(REQUIRED_CONTROL_PANEL_STATES)) {
    errors.push('requiredControlPanelStates must preserve the canonical seven-state vocabulary')
  }
  const names = (scenario?.captureStates ?? []).map((state) => state.name)
  for (const required of ['baseline', 'active', 'blocked', 'gate', 'receipt']) {
    if (!names.includes(required)) errors.push(`scenario missing D0 state ${required}`)
  }
  if (new Set(names).size !== names.length) errors.push('capture state names must be unique')
  for (const beat of scenario?.motion?.timeline ?? []) {
    if (!names.includes(beat.state)) errors.push(`motion timeline references unknown state ${beat.state}`)
  }
  if (errors.length) throw new Error(errors.join('; '))
  return scenario
}

export function semanticSnapshot({ scenario, state, roster, events, blackboard, commands }) {
  return canonicalize({
    schema: 'pd.ast-suggestibility.semantic-state.v1',
    scenarioId: scenario.scenarioId,
    sourceLabel: scenario.sourceLabel,
    clock: scenario.clock,
    runId: scenario.runId,
    agentNodeId: scenario.agentNodeId,
    stateName: state.name,
    beat: state.beat,
    roster,
    events,
    blackboard,
    commands,
  })
}

export function semanticContract(manifest) {
  return canonicalize({
    schema: manifest.schema,
    scenarioId: manifest.scenarioId,
    sourceLabel: manifest.sourceLabel,
    daemonPort: manifest.daemonPort,
    runId: manifest.runId,
    agentNodeId: manifest.agentNodeId,
    commit: manifest.commit,
    requiredControlPanelStates: manifest.requiredControlPanelStates,
    stateNames: manifest.stateNames,
    dimensions: manifest.dimensions,
    captureCommand: manifest.captureCommand,
    transcriptHeadHash: manifest.transcriptHeadHash,
    stateTranscriptHeadHashes: manifest.stateTranscriptHeadHashes,
    semanticStateHashes: manifest.semanticStateHashes,
  })
}

export function isExactWindowCaptureCommand(command) {
  if (!nonEmptyString(command)) return false
  if (/screencapture\b/.test(command) && !/screencapture\s+[^\n]*-l(?:"?<windowid>"?|\$?[A-Za-z_][A-Za-z0-9_]*|[0-9]+)/.test(command)) {
    return false
  }
  if (/--display-id\b|full[_ -]?screen|CGDisplayCreateImage/i.test(command)) return false
  return /demos\/ast-suggestibility\/capture\.sh|core\/pd-console\/scripts\/proof\/capture-proof\.sh|screencapture\b/.test(command)
}

export function validateProofManifest(manifest, {
  expectedCommit,
  expectedScenario,
  requireMedia = false,
} = {}) {
  const errors = []
  if (manifest?.schema !== PROOF_SCHEMA) errors.push('unexpected proof schema')
  for (const field of [
    'scenarioId',
    'runId',
    'transcriptHeadHash',
    'agentNodeId',
    'commit',
    'sourceLabel',
    'captureCommand',
  ]) {
    if (!nonEmptyString(manifest?.[field]) || placeholder(manifest?.[field])) {
      errors.push(`missing or placeholder ${field}`)
    }
  }
  if (!Number.isInteger(manifest?.daemonPort)) errors.push('missing daemonPort')
  if (!SOURCE_LABELS.has(manifest?.sourceLabel)) errors.push('invalid sourceLabel')
  if (!Array.isArray(manifest?.stateNames) || manifest.stateNames.length < 4) errors.push('missing stateNames')
  if (!manifest?.dimensions || !Number.isInteger(manifest.dimensions.width) || !Number.isInteger(manifest.dimensions.height)) {
    errors.push('missing dimensions')
  }
  if (!isExactWindowCaptureCommand(manifest?.captureCommand)) errors.push('captureCommand is not exact-window safe')
  if (expectedCommit && manifest?.commit !== expectedCommit) errors.push('stale commit')
  if (expectedScenario) {
    if (manifest?.scenarioId !== expectedScenario.scenarioId) errors.push('wrong daemon/scenario binding')
    if (manifest?.daemonPort !== expectedScenario.daemonPort) errors.push('wrong daemonPort')
    if (manifest?.sourceLabel !== expectedScenario.sourceLabel) {
      errors.push(`sourceLabel ${manifest?.sourceLabel} mislabels ${expectedScenario.sourceLabel} scenario provenance`)
    }
    if (manifest?.runId !== expectedScenario.runId) errors.push('wrong runId')
    if (manifest?.agentNodeId !== expectedScenario.agentNodeId) errors.push('wrong agentNodeId')
  }
  if (!manifest?.receipt || !nonEmptyString(manifest.receipt.file) || !nonEmptyString(manifest.receipt.sha256)) {
    errors.push('missing receipt binding')
  }
  if (requireMedia) {
    if (!Array.isArray(manifest?.artifacts) || manifest.artifacts.length < 7) {
      errors.push('native proof is missing visual artifacts')
    }
    if (!manifest?.artifacts?.some((artifact) => artifact.file?.endsWith('.gif'))) {
      errors.push('native proof is missing a GIF motion artifact')
    }
    if (!manifest?.artifacts?.some((artifact) => /\.(?:mp4|mov)$/.test(artifact.file ?? ''))) {
      errors.push('native proof is missing a video motion artifact')
    }
  }
  for (const artifact of manifest?.artifacts ?? []) {
    for (const field of ['daemonPort', 'runId', 'transcriptHeadHash', 'agentNodeId', 'commit', 'sourceLabel', 'stateNames', 'dimensions', 'captureCommand']) {
      if (artifact?.manifest?.[field] === undefined || artifact?.manifest?.[field] === null || artifact?.manifest?.[field] === '') {
        errors.push(`${artifact.file ?? 'artifact'} missing manifest.${field}`)
      }
    }
    if (artifact?.manifest?.commit !== manifest?.commit) errors.push(`${artifact.file} has stale artifact commit`)
    if (artifact?.manifest?.sourceLabel !== manifest?.sourceLabel) errors.push(`${artifact.file} sourceLabel mismatch`)
    if (!isExactWindowCaptureCommand(artifact?.manifest?.captureCommand)) errors.push(`${artifact.file} capture command is unsafe`)
  }
  const serialized = JSON.stringify(manifest)
  for (const pattern of expectedScenario?.redaction?.forbiddenPatterns ?? []) {
    if (serialized.includes(pattern)) errors.push(`private/redacted pattern leaked: ${pattern}`)
  }
  if (errors.length) throw new Error(errors.join('; '))
  return true
}

export function pngDimensions(path) {
  const bytes = readFileSync(path)
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${path} is not PNG`)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

export function gifDimensions(path) {
  const bytes = readFileSync(path)
  const header = bytes.subarray(0, 6).toString('ascii')
  if (header !== 'GIF87a' && header !== 'GIF89a') throw new Error(`${path} is not GIF`)
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
}
