export interface TerminalRecording {
  route: string
  title: string
  caption: string
  gifSrc: string
  castSrc: string
  commands: string[]
}

type RecordingSpec = Omit<TerminalRecording, 'route' | 'gifSrc' | 'castSrc'>

const tutorialRecordings: Record<string, RecordingSpec> = {
  harbors: {
    title: 'See harbor boundaries before work begins',
    caption:
      'This clip shows the harbor surface the rest of the tutorial assumes: the shared boundary that decides which project, agents, and channels belong together.',
    commands: ['pd harbors', 'pd harbor --help'],
  },
  'getting-started': {
    title: 'Watch the daemon answer first contact',
    caption:
      'This clip proves the local control plane is alive before the tutorial starts claiming names, opening the UI, or launching coordinated work.',
    commands: [
      'pd status',
      'pd claim docs-gif:api:main --json',
      'pd find docs-gif:api:main',
      'pd release docs-gif:api:main',
    ],
  },
  'semantic-identities': {
    title: 'Watch one semantic name resolve to the same service',
    caption:
      'This clip shows why the lesson exists: agents ask for a stable project:stack:context identity instead of guessing a raw port or memorizing whatever happened to boot last.',
    commands: ['pd status', 'pd services'],
  },
  'multi-agent': {
    title: 'See sessions leave notes other agents can trust',
    caption:
      'This clip shows the handoff surface behind the tutorial: one agent publishes intent, another can read it, and the shared timeline stays legible.',
    commands: ['pd status', 'pd note "recording multi-agent tutorial proof"', 'pd notes --limit 5'],
  },
  monorepo: {
    title: 'Watch one harbor describe more than one service',
    caption:
      'This clip shows the registry shape a monorepo needs: multiple named services, one coordination boundary, and enough structure to route work without collisions.',
    commands: ['pd status', 'pd services'],
  },
  debugging: {
    title: 'See coordination failures turn into inspectable state',
    caption:
      'This clip shows the status and health checks that let you debug stale claims, missing services, or wrong-daemon confusion instead of guessing.',
    commands: ['pd status', 'pd health', 'pd services'],
  },
  tunnel: {
    title: 'Watch a local service become reachable by name',
    caption:
      'This clip shows the tunnel surface the tutorial is teaching: expose a local process, keep the identity stable, and verify the route from the daemon side.',
    commands: ['pd tunnel --help', 'pd status'],
  },
  dns: {
    title: 'See name lookup replace manual port chasing',
    caption:
      'This clip shows the lookup flow behind the lesson: ask Port Daddy for a service by identity and let the daemon return the current address.',
    commands: ['pd dns --help', 'pd services'],
  },
  'session-phases': {
    title: 'Watch a session move through a clean lifecycle',
    caption:
      'This clip shows the session-state checks the tutorial is about: open work, durable notes, and clean completion instead of abandoned ambiguity.',
    commands: ['pd status', 'pd notes --limit 5'],
  },
  inbox: {
    title: 'See a direct agent message land in the right place',
    caption:
      'This clip shows the real inbox boundary: the human control layer sends one direct handoff, then the named agent reads that durable message from its own lane.',
    commands: [
      'AGENT_ID=RELEASE-LEAD pd inbox send QA-REVIEWER "Review migration 0142 on staging before release."',
      'pd inbox --agent QA-REVIEWER --unread --limit 1',
    ],
  },
  sugar: {
    title: 'Watch begin and done wrap the core coordination flow',
    caption:
      'This clip shows the convenience layer this lesson is about: sugar commands feel shorter, but they still create the same durable session state underneath.',
    commands: ['pd begin --help', 'pd done --help'],
  },
  'always-on': {
    title: 'See a watcher wake when the repo changes',
    caption:
      'This clip shows the event-triggered loop the tutorial is teaching: watch for a change, publish a signal, and let the right agent wake up.',
    commands: ['pd watch --help', 'pd pub docs:pipeline-recording'],
  },
  'pd-spawn': {
    title: 'Watch a one-shot agent launch with an explicit budget',
    caption:
      'This clip shows the launch surface behind the lesson: spawn a bounded agent, inspect the run, and keep spend and ownership visible.',
    commands: ['pd spawn --help', 'pd spawned'],
  },
  'time-travel': {
    title: 'See recent activity reconstruct what happened',
    caption:
      'This clip shows the ledger view the lesson relies on: notes and activity let a later agent reconstruct the story without reading minds.',
    commands: ['pd notes --limit 5', 'pd activity --limit 5'],
  },
  pipelines: {
    title: 'Watch one event hand off to the next step',
    caption:
      'This clip shows the reactive chain behind the tutorial: a watched event publishes once, the next stage consumes it, and the flow stays inspectable.',
    commands: ['pd watch --help', 'pd pub docs:pipeline-recording'],
  },
  watch: {
    title: 'See channels and watchers turn repo events into work',
    caption:
      'This clip shows how the watch surface turns a raw event into a named channel another agent can subscribe to.',
    commands: ['pd watch --help', 'pd channels discover docs'],
  },
  'remote-harbors': {
    title: 'See which primitives stay safe across machines',
    caption:
      'This clip shows the tunnel and status surfaces that matter when a second machine or teammate needs access without breaking the local coordination model.',
    commands: ['pd tunnel --help', 'pd status'],
  },
  fleet: {
    title: 'Watch the fleet validate before it wakes',
    caption:
      'This clip shows the guardrail behind the lesson: validate the fleet, inspect status, and only then let background agents keep running.',
    commands: ['pd fleet validate', 'pd fleet status'],
  },
  pheromone: {
    title: 'See attention signals decay into file heat',
    caption:
      'This clip shows the same loop the page explains: spray a signal, let it decay, and inspect where the fleet still thinks attention belongs.',
    commands: ['pd status', 'pd pheromone --help', 'pd pheromone files --path website-v2/src/pages/tutorials --depth 1'],
  },
  primitives: {
    title: 'Watch the preflight that ties the product together',
    caption:
      'This clip shows the control-plane checks behind the eleven primitives: status, briefing, and guard state before you lean on the rest of the system.',
    commands: ['pd status', 'pd briefing', 'pd guard status'],
  },
  'pd-tube': {
    title: 'Watch one channel carry a threaded agent handoff',
    caption:
      'This clip shows the core PD Tube contract: send a message, reply to the exact id, then read both rows back from durable channel history.',
    commands: [
      'printf "docs handoff ready" | pd tube docs:pd-tube-recording --send --sender docs',
      'printf "reply with the checked-in cast and GIF" | pd tube docs:pd-tube-recording --reply=<id> --sender codex',
      'pd tube docs:pd-tube-recording --once --no-history --limit=2',
    ],
  },
}

const exampleRecordings: Record<string, RecordingSpec> = {
  'pd-tube-button-to-agent': {
    title: 'Watch a browser event become agent work',
    caption:
      'This clip shows the exact loop the example teaches: a UI event enters PD Tube, the agent-side listener receives it, and the reply comes back on the same thread.',
    commands: ['pd status', 'pd tube docs:example-recording --once --no-history --limit=1'],
  },
  'test-failure-to-agent': {
    title: 'See a failing test turn into an agent request',
    caption:
      'This clip shows how a red test becomes a structured work request for the local agent, without copying logs into chat by hand.',
    commands: ['pd status', 'pd tube docs:example-recording --once --no-history --limit=1'],
  },
  'editor-lightbulb-to-agent': {
    title: 'Watch a code selection become an explanation request',
    caption:
      'This clip shows the editor-side pattern from the page: publish a selection, let the local agent answer it, and keep the integration lightweight.',
    commands: ['pd status', 'pd tube docs:example-recording --once --no-history --limit=1'],
  },
  'webhook-to-local-agent': {
    title: 'See a local webhook enter the agent loop',
    caption:
      'This clip shows the webhook adapter pattern the example teaches: accept an incoming event, publish it once, and let the local agent own the response.',
    commands: ['pd status', 'pd tube docs:example-recording --once --no-history --limit=1'],
  },
}

export const TUTORIAL_RECORDINGS: TerminalRecording[] = Object.entries(tutorialRecordings).map(([slug, spec]) => ({
  route: `/tutorials/${slug}`,
  title: spec.title,
  caption: spec.caption,
  gifSrc: `/gifs/tutorials/${slug}.gif`,
  castSrc: `/casts/tutorials/${slug}.cast`,
  commands: spec.commands,
}))

export const EXAMPLE_RECORDINGS: TerminalRecording[] = Object.entries(exampleRecordings).map(([slug, spec]) => ({
  route: `/examples/${slug}`,
  title: spec.title,
  caption: spec.caption,
  gifSrc: `/gifs/examples/${slug}.gif`,
  castSrc: `/casts/examples/${slug}.cast`,
  commands: spec.commands,
}))

export const DOC_RECORDINGS: TerminalRecording[] = [
  {
    route: '/docs/cli',
    title: 'See the command surfaces this reference keeps in play',
    caption:
      'This clip shows the daemon health check, command discovery, and message-loop patterns that recur across the CLI reference.',
    gifSrc: '/gifs/docs/cli-overview.gif',
    castSrc: '/casts/docs/cli-overview.cast',
    commands: ['pd status', 'pd pheromone --help', 'pd tube docs:cli-recording --once --no-history --limit=1'],
  },
  {
    route: '/docs/features/pheromone',
    title: 'Watch a signal decay and show up as file heat',
    caption:
      'This clip shows the actual pheromone loop from the page: spray a signal, read it back, then inspect which files the fleet is treating as hot.',
    gifSrc: '/gifs/docs/pheromone.gif',
    castSrc: '/casts/docs/pheromone.cast',
    commands: ['pd status', 'pd pheromone --help', 'pd pheromone files --path website-v2/src --depth 1'],
  },
]

export const CLI_REFERENCE_RECORDING: TerminalRecording = DOC_RECORDINGS[0]

export const TERMINAL_RECORDINGS = [
  ...TUTORIAL_RECORDINGS,
  ...EXAMPLE_RECORDINGS,
  ...DOC_RECORDINGS,
]

export function findTerminalRecording(route: string) {
  return TERMINAL_RECORDINGS.find((recording) => recording.route === route)
}
