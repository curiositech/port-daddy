#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { validateScenario } from './provenance.mjs'

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const command = process.argv[2]
const scenarioPath = resolve(option('--scenario', new URL('./scenario.fixture.json', import.meta.url).pathname))
const scenario = validateScenario(JSON.parse(readFileSync(scenarioPath, 'utf8')))
const daemonUrl = option('--url', `http://127.0.0.1:${scenario.daemonPort}`)

async function setState(state) {
  const response = await fetch(`${daemonUrl}/__proof/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId: scenario.scenarioId, state }),
  })
  const payload = await response.json()
  if (!response.ok || payload.proofState !== state || payload.sourceLabel !== 'fixture') {
    throw new Error(`fixture state transition refused: ${response.status} ${JSON.stringify(payload)}`)
  }
  return payload
}

if (command === 'set') {
  const state = process.argv[3]
  if (!state) throw new Error('usage: action-driver.mjs set <state> [--url URL] [--scenario FILE]')
  process.stdout.write(`${JSON.stringify(await setState(state))}\n`)
} else if (command === 'play') {
  let previous = 0
  for (const beat of scenario.motion.timeline) {
    await delay(Math.max(0, beat.atMs - previous))
    await setState(beat.state)
    process.stdout.write(`${String(beat.atMs).padStart(5)}ms ${beat.state}\n`)
    previous = beat.atMs
  }
} else if (command === 'probe') {
  const response = await fetch(`${daemonUrl}/health`)
  const health = await response.json()
  if (!response.ok || health.scenarioId !== scenario.scenarioId || health.daemonPort !== scenario.daemonPort || health.sourceLabel !== 'fixture') {
    throw new Error(`wrong daemon: ${JSON.stringify(health)}`)
  }
  process.stdout.write(`${JSON.stringify(health)}\n`)
} else {
  throw new Error('usage: action-driver.mjs <set STATE|play|probe> [--url URL] [--scenario FILE]')
}
