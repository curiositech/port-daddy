#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canonicalJson, transcriptHeadHash, validateScenario } from './provenance.mjs'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const scenarioPath = resolve(argument('--scenario', new URL('./scenario.fixture.json', import.meta.url).pathname))
const scenario = validateScenario(JSON.parse(readFileSync(scenarioPath, 'utf8')))
const port = Number(argument('--port', String(scenario.daemonPort)))
if (port !== scenario.daemonPort) {
  throw new Error(`fixture port ${port} disagrees with scenario daemonPort ${scenario.daemonPort}`)
}

const states = new Map(scenario.captureStates.map((state, index) => [state.name, { state, index }]))
let currentName = scenario.captureStates[0].name

function current() {
  return states.get(currentName)
}

function through(field) {
  const { index } = current()
  return scenario.captureStates.slice(0, index + 1).flatMap((state) => state[field] ?? [])
}

function envelope(extra = {}) {
  return {
    scenarioId: scenario.scenarioId,
    sourceLabel: scenario.sourceLabel,
    proofState: currentName,
    syntheticNow: scenario.clock.epoch,
    ...extra,
  }
}

function send(response, status, payload) {
  const body = canonicalJson(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-port-daddy-proof-source': 'fixture',
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  if (request.method === 'GET' && url.pathname === '/health') {
    const events = through('events')
    send(response, 200, envelope({
      ok: true,
      daemonPort: port,
      runId: scenario.runId,
      agentNodeId: scenario.agentNodeId,
      transcriptHeadHash: transcriptHeadHash(events),
    }))
    return
  }
  if (request.method === 'POST' && url.pathname === '/__proof/state') {
    const payload = await body(request)
    if (payload.scenarioId !== scenario.scenarioId) {
      send(response, 409, { error: 'wrong scenarioId' })
      return
    }
    if (!states.has(payload.state)) {
      send(response, 422, { error: `unknown fixture state ${payload.state}` })
      return
    }
    currentName = payload.state
    send(response, 200, envelope({
      ok: true,
      eventCount: through('events').length,
      transcriptHeadHash: transcriptHeadHash(through('events')),
    }))
    return
  }
  if (request.method === 'GET' && url.pathname === '/agent-nodes') {
    send(response, 200, envelope({ nodes: current().state.nodes }))
    return
  }
  if (request.method === 'GET' && url.pathname === '/blackboard') {
    send(response, 200, envelope({ data: current().state.blackboard, droppedInvalid: 0 }))
    return
  }
  if (request.method === 'GET' && /^\/sessions\/[^/]+\/events$/.test(url.pathname)) {
    send(response, 200, envelope({ events: through('events') }))
    return
  }
  if (request.method === 'GET' && /^\/agent-nodes\/[^/]+\/control$/.test(url.pathname)) {
    send(response, 200, envelope({ commands: through('commands') }))
    return
  }
  if (request.method === 'POST' && /^\/agent-nodes\/[^/]+\/control$/.test(url.pathname)) {
    const payload = await body(request)
    send(response, 200, envelope({
      schema: 'pd.agent-harbor.control-command.v0',
      commandId: 'cmd-d0-fixture-interaction',
      agentNodeId: scenario.agentNodeId,
      kind: payload.kind ?? 'unknown',
      status: 'queued',
      idempotencyKey: payload.idempotencyKey ?? '',
      createdAt: scenario.clock.epoch,
    }))
    return
  }
  send(response, 404, envelope({ error: 'fixture route not found' }))
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`D0 fixture daemon http://127.0.0.1:${port} sourceLabel=fixture scenario=${scenario.scenarioId}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
