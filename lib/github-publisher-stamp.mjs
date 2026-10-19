/** Runtime-neutral provenance formatting shared by Relay and the workload. */
const START = '<!-- port-daddy:fleetbot-provenance:start -->'
const END = '<!-- port-daddy:fleetbot-provenance:end -->'

function stripExistingProvenance(body) {
  const start = body.indexOf(START)
  if (start < 0) return body.trim()
  const end = body.indexOf(END, start)
  if (end < 0) return body.trim()
  return `${body.slice(0, start)}${body.slice(end + END.length)}`.trim()
}

export function fleetbotMutationMarker(receiptId) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(receiptId)) throw new Error('Fleetbot receipt id is invalid')
  return `<!-- port-daddy:fleetbot-mutation:${receiptId.toLowerCase()} -->`
}

function provenanceBlock({ authorship: a, receiptId, sourceHeadSha }) {
  const source = sourceHeadSha ? `\n> Source head: \`${sourceHeadSha}\`` : ''
  const roadmap = a.roadmapItem ? `Roadmap: \`${a.roadmapItem}\`` : 'Roadmap: explicit sidequest'
  return [
    START, fleetbotMutationMarker(receiptId), '> **Published by Port Daddy Fleetbot**',
    `> Verified dispatcher: \`${a.actorId}\``,
    `> Dispatcher-supplied agent label: \`${a.agentId}\``,
    `> Dispatcher-supplied session label: \`${a.sessionId}\` · ${roadmap}${source}`,
    `> Relay receipt: \`${receiptId}\``, END,
  ].join('\n')
}

/** Insert the exact provenance block before the roadmap trailer. */
export function stampPullRequestBody(input) {
  const clean = stripExistingProvenance(input.body)
  const lines = clean.split(/\r?\n/)
  const trailerIndex = lines.findIndex(line => /^Roadmap-Item\s*:/i.test(line.trim()))
  const block = provenanceBlock(input)
  if (trailerIndex < 0) return `${clean}\n\n${block}\n`
  const before = lines.slice(0, trailerIndex).join('\n').trimEnd()
  const after = lines.slice(trailerIndex).join('\n').trimStart()
  return `${before}\n\n${block}\n\n${after}\n`
}

export function stampFleetbotMessage(input) {
  return `${stripExistingProvenance(input.body)}\n\n${provenanceBlock(input)}\n`
}
