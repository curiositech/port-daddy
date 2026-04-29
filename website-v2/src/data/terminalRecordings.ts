export interface TerminalRecording {
  route: string
  title: string
  caption: string
  gifSrc: string
  castSrc: string
  commands: string[]
}

const tutorialSlugs = [
  'harbors',
  'getting-started',
  'semantic-identities',
  'multi-agent',
  'monorepo',
  'debugging',
  'tunnel',
  'dns',
  'session-phases',
  'inbox',
  'sugar',
  'always-on',
  'pd-spawn',
  'time-travel',
  'pipelines',
  'watch',
  'remote-harbors',
  'fleet',
  'pheromone',
  'primitives',
] as const

const tutorialLabels: Record<(typeof tutorialSlugs)[number], string> = {
  harbors: 'harbor and boundary checks',
  'getting-started': 'local daemon and control-plane check',
  'semantic-identities': 'semantic identity lookup',
  'multi-agent': 'session and note coordination',
  monorepo: 'project scan and daemon status',
  debugging: 'port lookup and health check',
  tunnel: 'tunnel command surface',
  dns: 'DNS command surface',
  'session-phases': 'session lifecycle checks',
  inbox: 'message channel loop',
  sugar: 'sugar command surface',
  'always-on': 'watcher command surface',
  'pd-spawn': 'spawn command surface',
  'time-travel': 'recent activity inspection',
  pipelines: 'watch and pub/sub surface',
  watch: 'watch command surface',
  'remote-harbors': 'current remote-safe primitives',
  fleet: 'fleet validation and status',
  pheromone: 'pheromone trail inspection',
  primitives: 'primitive preflight',
}

const tutorialCommands: Record<(typeof tutorialSlugs)[number], string[]> = {
  harbors: ['pd harbors', 'pd harbor --help'],
  'getting-started': ['pd status', 'pd claim docs-gif:api:main --json', 'pd find docs-gif:api:main', 'pd release docs-gif:api:main'],
  'semantic-identities': ['pd status', 'pd services'],
  'multi-agent': ['pd status', 'pd note "recording multi-agent tutorial proof"', 'pd notes --limit 5'],
  monorepo: ['pd status', 'pd services'],
  debugging: ['pd status', 'pd health', 'pd services'],
  tunnel: ['pd tunnel --help', 'pd status'],
  dns: ['pd dns --help', 'pd services'],
  'session-phases': ['pd status', 'pd notes --limit 5'],
  inbox: ['pd tube docs:inbox-recording --send', 'pd tube docs:inbox-recording --once --no-history --limit=1'],
  sugar: ['pd begin --help', 'pd done --help'],
  'always-on': ['pd watch --help', 'pd pub docs:pipeline-recording'],
  'pd-spawn': ['pd spawn --help', 'pd spawned'],
  'time-travel': ['pd notes --limit 5', 'pd activity --limit 5'],
  pipelines: ['pd watch --help', 'pd pub docs:pipeline-recording'],
  watch: ['pd watch --help', 'pd channels discover docs'],
  'remote-harbors': ['pd tunnel --help', 'pd status'],
  fleet: ['pd fleet validate', 'pd fleet status'],
  pheromone: ['pd status', 'pd pheromone --help', 'pd pheromone files --path website-v2/src/pages/tutorials --depth 1'],
  primitives: ['pd status', 'pd briefing', 'pd guard status'],
}

export const TUTORIAL_RECORDINGS: TerminalRecording[] = tutorialSlugs.map((slug) => ({
  route: `/tutorials/${slug}`,
  title: `Real CLI recording: ${tutorialLabels[slug]}`,
  caption: `Recorded from this checkout with asciinema and agg while exercising ${tutorialLabels[slug]}.`,
  gifSrc: `/gifs/tutorials/${slug}.gif`,
  castSrc: `/casts/tutorials/${slug}.cast`,
  commands: tutorialCommands[slug],
}))

export const EXAMPLE_RECORDINGS: TerminalRecording[] = [
  'pd-tube-button-to-agent',
  'test-failure-to-agent',
  'editor-lightbulb-to-agent',
  'webhook-to-local-agent',
].map((slug) => ({
  route: `/examples/${slug}`,
  title: 'Real CLI recording: example loop',
  caption: 'Recorded from local Port Daddy commands that publish, listen, or inspect the agent-facing example flow.',
  gifSrc: `/gifs/examples/${slug}.gif`,
  castSrc: `/casts/examples/${slug}.cast`,
  commands: ['pd status', 'pd tube docs:example-recording --once --no-history --limit=1'],
}))

export const DOC_RECORDINGS: TerminalRecording[] = [
  {
    route: '/docs/cli',
    title: 'Real CLI recording: reference commands',
    caption: 'A current checkout recording of daemon status, pheromone help, and a real PD Tube send/listen loop.',
    gifSrc: '/gifs/docs/cli-overview.gif',
    castSrc: '/casts/docs/cli-overview.cast',
    commands: ['pd status', 'pd pheromone --help', 'pd tube docs:cli-recording --once --no-history --limit=1'],
  },
  {
    route: '/docs/features/pheromone',
    title: 'Real CLI recording: pheromone reference',
    caption: 'A current checkout recording that sprays a session signal, reads it back, and inspects file heat.',
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
