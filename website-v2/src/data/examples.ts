import pdTubeButtonHtml from '../../../examples/pd-tube/button-to-agent.html?raw'
import pdTubeReadme from '../../../examples/pd-tube/README.md?raw'
import testReporterReadme from '../../../examples/test-reporter/README.md?raw'
import testReporterSource from '../../../examples/test-reporter/test-failure-to-agent.ts?raw'
import editorLightbulbReadme from '../../../examples/editor-lightbulb/README.md?raw'
import editorLightbulbHtml from '../../../examples/editor-lightbulb/explain-selection.html?raw'
import webhookAdapterReadme from '../../../examples/webhook-adapter/README.md?raw'
import webhookAdapterSource from '../../../examples/webhook-adapter/local-webhook-to-agent.ts?raw'
import leaderElectionReadme from '../../../examples/leader-election/README.md?raw'
import leaderElectionSource from '../../../examples/leader-election/leader-election.ts?raw'
import ephemeralCiDbReadme from '../../../examples/ephemeral-ci-db/README.md?raw'
import ephemeralCiDbSource from '../../../examples/ephemeral-ci-db/ephemeral-postgres.sh?raw'
import p2pWebrtcReadme from '../../../examples/p2p-webrtc/README.md?raw'
import p2pWebrtcSource from '../../../examples/p2p-webrtc/webrtc-signaling.ts?raw'
import agentTopologiesReadme from '../../../examples/agent-topologies/README.md?raw'
import agentTopologiesSource from '../../../examples/agent-topologies/topology-pubsub.ts?raw'

export type ExampleLevel = 'Beginner' | 'Intermediate' | 'Advanced'
export type ExampleLanguage = 'cli' | 'text' | 'typescript'

export interface ExampleSourceFile {
  path: string
  language: ExampleLanguage
  code: string
}

export interface ExampleCommand {
  title: string
  command: string
  notes?: string[]
}

export interface ExampleSection {
  id: string
  label: string
  title: string
  paragraphs: string[]
}

export interface ExampleVisual {
  src: string
  webpSrc?: string
  alt: string
}

export interface ExampleUiScreenshot {
  src: string
  alt: string
  title: string
  caption: string
}

export interface ExampleDoc {
  slug: string
  title: string
  eyebrow: string
  level: ExampleLevel
  time: string
  summary: string
  surveyPlain: string
  builds: string
  whyItMatters: string
  lastReviewed: string
  tags: string[]
  visual: ExampleVisual
  uiScreenshots?: ExampleUiScreenshot[]
  prerequisites: string[]
  files: string[]
  commands: ExampleCommand[]
  sections: ExampleSection[]
  sourceFiles: ExampleSourceFile[]
  adapt: string[]
  related: Array<{ title: string; href: string }>
}

const EXAMPLE_VISUALS = {
  'pd-tube-button-to-agent': {
    src: '/img/generated/example-pd-tube-button-to-agent.jpg',
    webpSrc: '/img/generated/example-pd-tube-button-to-agent.webp',
    alt: 'A physical green button connected by a glowing message tube to a local terminal.',
  },
  'test-failure-to-agent': {
    src: '/img/generated/example-test-failure-to-agent.jpg',
    webpSrc: '/img/generated/example-test-failure-to-agent.webp',
    alt: 'A red failed-test signal and diagnostic cable feeding a local agent terminal.',
  },
  'editor-lightbulb-to-agent': {
    src: '/img/generated/example-editor-lightbulb-to-agent.jpg',
    webpSrc: '/img/generated/example-editor-lightbulb-to-agent.webp',
    alt: 'An editor selection connected through a bright lightbulb command to a local agent.',
  },
  'webhook-to-local-agent': {
    src: '/img/generated/example-webhook-to-local-agent.jpg',
    webpSrc: '/img/generated/example-webhook-to-local-agent.webp',
    alt: 'A local workstation switchboard routing webhook cards into an agent terminal.',
  },
  'leader-election': {
    src: '/img/generated/example-leader-election.jpg',
    webpSrc: '/img/generated/example-leader-election.webp',
    alt: 'Small agent modules racing for one illuminated lock that marks the elected leader.',
  },
  'p2p-webrtc': {
    src: '/img/generated/example-p2p-webrtc.jpg',
    webpSrc: '/img/generated/example-p2p-webrtc.webp',
    alt: 'Two local agent terminals exchange inbox packets before opening a direct peer link.',
  },
  'ephemeral-ci-db': {
    src: '/img/generated/example-ephemeral-ci-db.jpg',
    webpSrc: '/img/generated/example-ephemeral-ci-db.webp',
    alt: 'A temporary database container plugged into a single clean CI port socket.',
  },
  'agent-topologies': {
    src: '/img/generated/example-agent-archetypes.jpg',
    webpSrc: '/img/generated/example-agent-archetypes.webp',
    alt: 'A physical topology board showing star, ring, and arbiter message traces.',
  },
} satisfies Record<string, ExampleVisual>

export const EXAMPLE_DOCS: ExampleDoc[] = [
  {
    slug: 'pd-tube-button-to-agent',
    title: 'Build a button-to-agent loop with PD Tube',
    eyebrow: 'PD Tube',
    level: 'Intermediate',
    time: '18 min',
    summary:
      'Turn a plain HTML button into a phone line to the coding agent already running in your repo.',
    surveyPlain:
      'Connect a localhost button — or anything else you want — to a live Claude Code, ChatGPT, Codex, or Cursor session.',
    builds:
      'A browser page with three buttons that publish work into Port Daddy and render the agent\'s threaded reply inline.',
    whyItMatters:
      'This is the lede. The page does not integrate with Claude, OpenAI, MCP, or a hosted webhook. It POSTs JSON to the local daemon, and the terminal agent already sitting in the repo becomes the worker.',
    lastReviewed: '2026-04-29',
    tags: ['tube', 'browser', 'agent loop', 'messages'],
    visual: EXAMPLE_VISUALS['pd-tube-button-to-agent'],
    uiScreenshots: [
      {
        src: '/img/examples/pd-tube-button-to-agent-ui.webp',
        alt: 'Screenshot of the PD Tube button-to-agent HTML demo with daemon URL, three action buttons, and the waiting tube command.',
        title: 'The local button publisher.',
        caption:
          'This is the actual HTML file in examples/pd-tube: three browser buttons, one daemon URL, and a log that tells the operator to keep an agent blocked in pd tube ui:clicks.',
      },
    ],
    prerequisites: [
      'A running Port Daddy daemon.',
      'A browser that can open a local HTML file.',
      'An agent runtime that can run shell commands in the project terminal.',
    ],
    files: [
      'examples/pd-tube/button-to-agent.html',
      'examples/pd-tube/README.md',
    ],
    commands: [
      {
        title: 'Start the daemon',
        command: '$ pd start',
        notes: ['The browser publishes to the daemon message channel. The agent listens through the CLI.'],
      },
      {
        title: 'Open the publisher',
        command: '$ open examples/pd-tube/button-to-agent.html',
        notes: ['No SDK, no MCP server, no hosted callback. The page uses plain fetch against the local daemon.'],
      },
      {
        title: 'Start the agent side',
        command: '$ pd tube ui:clicks',
        notes: ['Leave this running in Claude Code, ChatGPT, Codex, Cursor, Aider, or any terminal-backed agent.'],
      },
      {
        title: 'Reply to an event',
        command: "$ printf '%s\\n' \"Deployed to staging. CI is green.\" | pd tube ui:clicks --reply-to <message-id> --sender claude-code",
        notes: ['The browser watches the same channel and renders replies whose envelope has inReplyTo set.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A real local control that can summon the coding agent already in the repo.',
        paragraphs: [
          'The page has ordinary HTML buttons: deploy staging, run tests, summarize PR. Each click posts a tube envelope to ui:clicks and remembers the daemon message id.',
          'The agent is blocked in pd tube ui:clicks. When the event arrives, the terminal prints the payload plus the exact reply command. The agent does normal repo work, then posts a threaded reply that the browser renders.',
        ],
      },
      {
        id: 'why-it-matters',
        label: 'Why it matters',
        title: 'Any process that can POST JSON can now reach the local agent session.',
        paragraphs: [
          'That is the primitive. Editor extensions, test reporters, browser extensions, notebook cells, chat adapters, local admin panels, and physical buttons can all become agent-facing controls without owning an agent runtime.',
          'The agent side stays CLI-first because CLI-in-a-loop is the interoperability layer every local coding agent already understands.',
        ],
      },
      {
        id: 'message-shape',
        label: 'Protocol shape',
        title: 'The browser publishes one envelope and waits for a correlated reply.',
        paragraphs: [
          'The daemon message row supplies the durable id. The tube envelope supplies the body and optional inReplyTo. This keeps threading cheap without requiring the publisher to speak a large protocol.',
          'The publisher is intentionally boring JavaScript. The product value is a stable local substrate that lets ordinary tools reach the live agent.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/pd-tube/button-to-agent.html', language: 'text', code: pdTubeButtonHtml },
      { path: 'examples/pd-tube/README.md', language: 'text', code: pdTubeReadme },
    ],
    adapt: [
      'Replace the demo buttons with editor commands, CI reporter actions, notebook exceptions, or Stream Deck actions.',
      'Keep the publisher dumb: POST the event, remember the daemon message id, and watch for inReplyTo.',
      'Keep the agent runtime swappable: anything that can run pd tube can service the event stream.',
    ],
    related: [
      { title: 'Messaging reference', href: '/docs/cli/pub' },
      { title: 'Messaging MCP tool', href: '/docs/mcp/publish-message' },
      { title: 'Inbox tutorial', href: '/tutorials/inbox' },
    ],
  },
  {
    slug: 'test-failure-to-agent',
    title: 'Build a test reporter that asks the agent for help',
    eyebrow: 'Test runner',
    level: 'Intermediate',
    time: '20 min',
    summary:
      'Wrap a failing test command, publish the failure to the local agent, and print the diagnosis back in the same terminal.',
    surveyPlain:
      'Red tests become a direct prompt for the agent that already has the repo open. No log-paste, no chat tab.',
    builds:
      'A TypeScript reporter you can run around npm test, Vitest, Jest, pytest, Playwright, or a pre-commit check.',
    whyItMatters:
      'A test runner is already the moment a developer wants help. This example turns that failure into a structured local event instead of copying logs into chat.',
    lastReviewed: '2026-04-29',
    tags: ['tube', 'tests', 'reporter', 'terminal'],
    visual: EXAMPLE_VISUALS['test-failure-to-agent'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript reporter.',
      'An agent terminal that can run pd tube dev:test-failed.',
    ],
    files: [
      'examples/test-reporter/test-failure-to-agent.ts',
      'examples/test-reporter/README.md',
    ],
    commands: [
      {
        title: 'Start the agent side',
        command: '$ pd tube dev:test-failed',
        notes: ['Leave this running in the coding agent that should investigate failures.'],
      },
      {
        title: 'Run the built-in failing demo',
        command: '$ npx tsx examples/test-reporter/test-failure-to-agent.ts',
        notes: ['The default command fails on purpose so you can see the tube event immediately.'],
      },
      {
        title: 'Wrap a real test command',
        command: '$ npx tsx examples/test-reporter/test-failure-to-agent.ts -- npm test -- --runInBand',
        notes: ['Anything after -- is executed as the test command and captured if it fails.'],
      },
      {
        title: 'Use non-blocking mode for hooks',
        command: '$ npx tsx examples/test-reporter/test-failure-to-agent.ts --no-wait -- npm test',
        notes: ['This publishes the failure and exits with the failing command status.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A local reporter that turns failures into agent work requests.',
        paragraphs: [
          'The script runs a command, streams stdout and stderr like a normal terminal wrapper, and only publishes to Port Daddy when the command fails.',
          'The published event includes cwd, command, exit code, stdout, stderr, and the exact ask: investigate this failure in the current repo and reply with cause, changed files, and the next command.',
        ],
      },
      {
        id: 'loop',
        label: 'The loop',
        title: 'The test runner does not need to know which agent runtime you use.',
        paragraphs: [
          'The reporter posts to dev:test-failed. Claude Code, ChatGPT, Codex, Cursor, Aider, or another shell-running agent can sit in pd tube dev:test-failed and service the same event stream.',
          'That separation is the point. Test tools publish events. Agents consume events. Port Daddy is the local bus in the middle.',
        ],
      },
      {
        id: 'product-version',
        label: 'Product version',
        title: 'A real reporter would call the same publish function from inside the test framework.',
        paragraphs: [
          'The example is a wrapper so it is easy to run, but the function boundary is the important part: publishTube(body) is the piece a Jest reporter, Vitest plugin, pytest hook, or Playwright reporter would reuse.',
          'You can choose whether to block for an answer, return immediately, or surface the reply in a desktop notification, editor panel, or CI annotation.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/test-reporter/test-failure-to-agent.ts', language: 'typescript', code: testReporterSource },
      { path: 'examples/test-reporter/README.md', language: 'text', code: testReporterReadme },
    ],
    adapt: [
      'Move publishTube into a Jest, Vitest, pytest, or Playwright reporter hook.',
      'Use one channel per project or test suite when several repos are running locally.',
      'Keep --no-wait mode for hooks that must preserve the original test command exit code.',
    ],
    related: [
      { title: 'Messaging reference', href: '/docs/cli/pub' },
      { title: 'Testing practice', href: '/docs/best-practices/testing-and-promotion' },
      { title: 'MCP add-note tool', href: '/docs/mcp/add-note' },
    ],
  },
  {
    slug: 'editor-lightbulb-to-agent',
    title: 'Build an editor lightbulb that asks the local agent',
    eyebrow: 'Editor extension',
    level: 'Beginner',
    time: '16 min',
    summary:
      'Select code in a page, publish the file and range to the agent, and render the explanation right next to the selection.',
    surveyPlain:
      'The useful core of a VS Code or JetBrains extension — without the packaging, the marketplace, or the extension host.',
    builds:
      'A browser-based editor mock that sends selected code to editor:explain and waits for the local agent reply.',
    whyItMatters:
      'Editor integrations often get heavy because they try to host or authenticate the agent. This one only publishes a local event and lets the already-running agent do the work.',
    lastReviewed: '2026-04-29',
    tags: ['tube', 'editor', 'selection', 'dev tools'],
    visual: EXAMPLE_VISUALS['editor-lightbulb-to-agent'],
    uiScreenshots: [
      {
        src: '/img/examples/editor-lightbulb-to-agent-ui.webp',
        alt: 'Screenshot of the editor lightbulb HTML demo with daemon URL, file path, range, selected code, and an ask-agent button.',
        title: 'The extension-shaped publisher.',
        caption:
          'This is the actual HTML file in examples/editor-lightbulb: a file/range/code selection form that publishes the selected snippet to editor:explain.',
      },
    ],
    prerequisites: [
      'A running Port Daddy daemon.',
      'A browser that can open a local HTML file.',
      'An agent terminal listening on editor:explain.',
    ],
    files: [
      'examples/editor-lightbulb/explain-selection.html',
      'examples/editor-lightbulb/README.md',
    ],
    commands: [
      {
        title: 'Start the agent side',
        command: '$ pd tube editor:explain',
        notes: ['The agent receives selected code plus file/range context.'],
      },
      {
        title: 'Open the lightbulb publisher',
        command: '$ open examples/editor-lightbulb/explain-selection.html',
        notes: ['Edit the file, range, and selected code fields, then press the button.'],
      },
      {
        title: 'Reply with an explanation',
        command: "$ printf '%s\\n' \"This helper normalizes daemon URLs before fetch.\" | pd tube editor:explain --reply-to <message-id>",
        notes: ['The browser renders the threaded reply inline.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A working sketch of the editor command developers actually want.',
        paragraphs: [
          'The page collects a file path, a line range, and selected code. Pressing the button publishes a selection.explain event to editor:explain and waits for an inReplyTo response.',
          'The agent can use the real project checkout to answer. It is not a detached chatbot guessing from a pasted snippet.',
        ],
      },
      {
        id: 'extension-shape',
        label: 'Extension shape',
        title: 'The HTML is standing in for a VS Code, JetBrains, or browser-extension publisher.',
        paragraphs: [
          'The extension version would replace the textarea with editor.selection, activeTextEditor.document.fileName, and range metadata. The Port Daddy part stays the same.',
          'That makes the SDK question smaller: publishers need convenient helpers, but the agent side can stay CLI-only.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/editor-lightbulb/explain-selection.html', language: 'text', code: editorLightbulbHtml },
      { path: 'examples/editor-lightbulb/README.md', language: 'text', code: editorLightbulbReadme },
    ],
    adapt: [
      'Replace the textarea with VS Code, JetBrains, browser-extension, or Neovim selection APIs.',
      'Send file path and range metadata so the agent can inspect neighboring code before answering.',
      'Render replies as inline comments, hover cards, diagnostics, or a side panel.',
    ],
    related: [
      { title: 'Messaging reference', href: '/docs/cli/pub' },
      { title: 'Semantic identities', href: '/tutorials/semantic-identities' },
      { title: 'MCP tools', href: '/docs/mcp' },
    ],
  },
  {
    slug: 'webhook-to-local-agent',
    title: 'Build a webhook adapter backed by your workstation',
    eyebrow: 'Bot adapter',
    level: 'Advanced',
    time: '24 min',
    summary:
      'Accept Slack, Discord, Linear, or generic webhook JSON and route it to the local agent through PD Tube.',
    surveyPlain:
      'Your workstation becomes the bot backend — full repo access, real credentials, no hosted agent service in the middle.',
    builds:
      'A local HTTP server with /webhook, /slack, /discord, and /linear endpoints that publish to chat:mentions and optionally wait for a reply.',
    whyItMatters:
      'Most bot demos hide the hard part behind cloud infrastructure. This one shows the small local bridge: POST JSON in, pd tube event out, threaded answer back to the caller.',
    lastReviewed: '2026-04-29',
    tags: ['tube', 'webhooks', 'bots', 'http'],
    visual: EXAMPLE_VISUALS['webhook-to-local-agent'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the local HTTP adapter.',
      'An agent terminal listening on chat:mentions.',
    ],
    files: [
      'examples/webhook-adapter/local-webhook-to-agent.ts',
      'examples/webhook-adapter/README.md',
    ],
    commands: [
      {
        title: 'Start the agent side',
        command: '$ pd tube chat:mentions',
        notes: ['The agent receives webhook payloads as local work requests.'],
      },
      {
        title: 'Start the adapter',
        command: '$ npx tsx examples/webhook-adapter/local-webhook-to-agent.ts',
        notes: ['The server listens on 127.0.0.1:8787 by default.'],
      },
      {
        title: 'Send a webhook',
        command: "$ curl -sS http://127.0.0.1:8787/webhook -H 'Content-Type: application/json' -d '{\"source\":\"linear\",\"issue\":\"PD-42\",\"text\":\"Can you inspect the release check?\"}'",
        notes: ['The adapter publishes the JSON into chat:mentions and waits for the agent reply.'],
      },
      {
        title: 'Fire and forget',
        command: "$ curl -sS 'http://127.0.0.1:8787/webhook?wait=0' -H 'Content-Type: application/json' -d '{\"source\":\"slack\",\"text\":\"Please inspect the current branch\"}'",
        notes: ['Use wait=0 when the upstream bot should acknowledge quickly and receive the answer elsewhere.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A local bot backend whose worker is the agent terminal.',
        paragraphs: [
          'The HTTP server accepts webhook-shaped JSON, wraps it in a webhook.mention event, publishes to chat:mentions, and tells the caller which message id was created.',
          'If wait=0 is not set, the adapter waits up to two minutes for the agent to reply through pd tube and returns that answer as JSON.',
        ],
      },
      {
        id: 'why-local',
        label: 'Why local',
        title: 'The bot does not need cloud agent infrastructure to be useful.',
        paragraphs: [
          'A Slack or Linear adapter can be thin because the developer already has the expensive context locally: repo checkout, shell, credentials, tests, and the active coding agent session.',
          'Port Daddy gives the webhook a neutral event bus and gives the agent a one-line loop.',
        ],
      },
      {
        id: 'security-boundary',
        label: 'Security boundary',
        title: 'The example is local-first on purpose.',
        paragraphs: [
          'The server binds to 127.0.0.1 and does not implement Slack or Linear signature verification. That keeps the executable example focused on the PD shape.',
          'A real adapter should verify upstream signatures, authorize channels, redact sensitive payloads, and decide whether replies are synchronous or pushed back through the upstream API.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/webhook-adapter/local-webhook-to-agent.ts', language: 'typescript', code: webhookAdapterSource },
      { path: 'examples/webhook-adapter/README.md', language: 'text', code: webhookAdapterReadme },
    ],
    adapt: [
      'Add Slack, Discord, Linear, GitHub, or Jira signature verification before exposing the adapter beyond localhost.',
      'Use per-source channels like slack:mentions or linear:assigned if the agent should triage streams separately.',
      'Return immediately with wait=0 when the upstream platform requires fast acknowledgements.',
    ],
    related: [
      { title: 'Messaging reference', href: '/docs/cli/pub' },
      { title: 'Agent inbox tutorial', href: '/tutorials/inbox' },
      { title: 'MCP overview', href: '/docs/mcp' },
    ],
  },
  {
    slug: 'leader-election',
    title: 'Build a one-leader worker loop with Port Daddy locks',
    eyebrow: 'Locks',
    level: 'Intermediate',
    time: '14 min',
    summary:
      'Run a swarm of identical workers where exactly one becomes leader and the rest keep working as followers.',
    surveyPlain:
      'The small, useful version of leader election: one local process gets the coordinator role without a bespoke consensus system.',
    builds:
      'A TypeScript worker swarm that races for the swarm:leader lock, holds it briefly, releases it in finally, and reports which worker won.',
    whyItMatters:
      'AI tools often need exactly one process to write the final summary, run the deploy, call a rate-limited API, or mutate a generated artifact. A Port Daddy lock is enough for that local coordination job.',
    lastReviewed: '2026-04-29',
    tags: ['locks', 'swarm', 'leader election', 'workers'],
    visual: EXAMPLE_VISUALS['leader-election'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript worker script.',
      'Several local workers, agents, or scheduled jobs that might start at the same time.',
    ],
    files: [
      'examples/leader-election/leader-election.ts',
      'examples/leader-election/README.md',
    ],
    commands: [
      {
        title: 'Check the daemon',
        command: '$ pd status',
        notes: ['The example talks to the local daemon lock API.'],
      },
      {
        title: 'Run the default swarm',
        command: '$ npx tsx examples/leader-election/leader-election.ts',
        notes: ['Five workers start from the same code path; one acquires swarm:leader.'],
      },
      {
        title: 'Run a larger contention demo',
        command: '$ npx tsx examples/leader-election/leader-election.ts --workers 8 --hold-ms 2500',
        notes: ['Increase worker count and hold time to see followers observe the held lock.'],
      },
      {
        title: 'Tune crash recovery',
        command: '$ npx tsx examples/leader-election/leader-election.ts --ttl-ms 5000',
        notes: ['The TTL is the safety valve if a leader process dies before releasing the lock.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A same-code worker swarm with one elected coordinator.',
        paragraphs: [
          'Each worker sleeps for a small stagger, tries to acquire swarm:leader, and either enters leader mode or logs the holder and continues as a follower.',
          'The leader uses a try/finally block so the lock is released even if leader work throws. The TTL keeps a crashed worker from owning the role forever.',
        ],
      },
      {
        id: 'where-to-use-it',
        label: 'Where it fits',
        title: 'Use the lock for the scarce side effect, not for the whole system.',
        paragraphs: [
          'This is useful when several agents can do discovery in parallel but only one should publish the final decision, modify a migration file, update a generated bundle, or call a costly external API.',
          'You do not need a full coordinator service. The local daemon already knows who holds the lock and when it expires.',
        ],
      },
      {
        id: 'production-shape',
        label: 'Product version',
        title: 'The product version wraps real work in the leader branch.',
        paragraphs: [
          'Replace the demo sleep with the work only one process may do. Keep follower work separate so losing the election is not an error.',
          'Use a purpose-specific lock name like release:notarize, docs:og-cards, or ci:postgres:run-123 so unrelated work can proceed independently.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/leader-election/leader-election.ts', language: 'typescript', code: leaderElectionSource },
      { path: 'examples/leader-election/README.md', language: 'text', code: leaderElectionReadme },
    ],
    adapt: [
      'Wrap deploys, generated artifacts, migrations, and rate-limited API calls in a named lock.',
      'Let non-leader workers keep doing read-only discovery or follower tasks.',
      'Set TTLs short enough to recover from crashes and long enough for the critical section.',
    ],
    related: [
      { title: 'Lock command', href: '/docs/cli/lock' },
      { title: 'with-lock command', href: '/docs/cli/with-lock' },
      { title: 'Sessions tutorial', href: '/tutorials/session-phases' },
    ],
  },
  {
    slug: 'ephemeral-ci-db',
    title: 'Build an ephemeral CI database port claim',
    eyebrow: 'CI services',
    level: 'Beginner',
    time: '12 min',
    summary:
      'Claim a semantic port for a throwaway Postgres test database, then print the DATABASE_URL your tests should use.',
    surveyPlain:
      'The practical fix for parallel local and CI runs fighting over the same database port at three in the morning.',
    builds:
      'A shell wrapper that claims ci:postgres:<run-id>, constructs DATABASE_URL, prints a safe dry-run Docker command, and releases the claim on exit.',
    whyItMatters:
      'Test services are boring until two agents or CI jobs start them at once. Port Daddy gives each run a named local service identity and a collision-free port.',
    lastReviewed: '2026-04-29',
    tags: ['ports', 'ci', 'database', 'docker'],
    visual: EXAMPLE_VISUALS['ephemeral-ci-db'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'bash for the wrapper script.',
      'Docker only if you pass --run; the default mode is a safe dry-run.',
    ],
    files: [
      'examples/ephemeral-ci-db/ephemeral-postgres.sh',
      'examples/ephemeral-ci-db/README.md',
    ],
    commands: [
      {
        title: 'Dry-run the port claim',
        command: '$ bash examples/ephemeral-ci-db/ephemeral-postgres.sh',
        notes: ['Default mode claims a port, prints DATABASE_URL and Docker command, then releases the claim.'],
      },
      {
        title: 'Use a CI run id',
        command: '$ GITHUB_RUN_ID=12345 bash examples/ephemeral-ci-db/ephemeral-postgres.sh',
        notes: ['The semantic identity becomes ci:postgres:12345 so repeated steps can resolve the same service id.'],
      },
      {
        title: 'Start a real container',
        command: '$ bash examples/ephemeral-ci-db/ephemeral-postgres.sh --run',
        notes: ['Requires Docker and starts postgres:alpine on the claimed Port Daddy port.'],
      },
      {
        title: 'Inspect or release manually',
        command: '$ pd find ci:postgres:12345 && pd release ci:postgres:12345',
        notes: ['The script traps EXIT, but these are the operator commands when you are debugging.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A repeatable database identity for one local or CI test run.',
        paragraphs: [
          'The script derives a service id from GITHUB_RUN_ID or the current timestamp, claims a port with pd claim, and builds a DATABASE_URL that points at 127.0.0.1 on that claimed port.',
          'Dry-run mode prints the exact Docker command instead of starting a container. That makes the example safe to run on machines without Docker or without permission to start services.',
        ],
      },
      {
        id: 'why-semantic',
        label: 'Why semantic ids',
        title: 'The test runner should depend on ci:postgres:run-id, not a magic number.',
        paragraphs: [
          'Hardcoded 5432 is fine until a second test job, local agent, or developer service is already using it. The semantic id makes the intended service stable while the actual port stays negotiable.',
          'The same pattern works for Redis, Selenium, fake S3, Playwright preview servers, and any service that needs a local TCP slot during tests.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/ephemeral-ci-db/ephemeral-postgres.sh', language: 'cli', code: ephemeralCiDbSource },
      { path: 'examples/ephemeral-ci-db/README.md', language: 'text', code: ephemeralCiDbReadme },
    ],
    adapt: [
      'Swap postgres:alpine for Redis, MinIO, Selenium, or a preview server.',
      'Use the claimed port to populate DATABASE_URL or service-specific env vars for tests.',
      'Keep trap cleanup even in dry-run-friendly wrappers so crashed tests leave less residue.',
    ],
    related: [
      { title: 'Claim command', href: '/docs/cli/claim' },
      { title: 'Service discovery tutorial', href: '/tutorials/dns' },
      { title: 'Testing practice', href: '/docs/best-practices/testing-and-promotion' },
    ],
  },
  {
    slug: 'p2p-webrtc',
    title: 'Build WebRTC signaling over agent inboxes',
    eyebrow: 'P2P signaling',
    level: 'Advanced',
    time: '22 min',
    summary:
      'Use durable agent inboxes to exchange an SDP offer and answer before two peers open their direct channel.',
    surveyPlain:
      'Port Daddy is the rendezvous; the heavy stream moves over WebRTC, WebTransport, or any other peer path you prefer.',
    builds:
      'A TypeScript signaling exchange that registers two agents, sends an SDP offer through one inbox, sends the answer back, marks inboxes read, and unregisters both agents.',
    whyItMatters:
      'P2P tools still need a rendezvous layer. Agent inboxes give local peers durable, inspectable signaling without inventing a signaling server for every prototype.',
    lastReviewed: '2026-04-29',
    tags: ['inbox', 'webrtc', 'p2p', 'agents'],
    visual: EXAMPLE_VISUALS['p2p-webrtc'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript signaling script.',
      'Two local peer identities that need a durable offer/answer handoff.',
    ],
    files: [
      'examples/p2p-webrtc/webrtc-signaling.ts',
      'examples/p2p-webrtc/README.md',
    ],
    commands: [
      {
        title: 'Run the exchange',
        command: '$ npx tsx examples/p2p-webrtc/webrtc-signaling.ts',
        notes: ['Registers agent-a and agent-b, exchanges offer and answer, marks messages read, and unregisters them.'],
      },
      {
        title: 'Use explicit peer ids',
        command: '$ npx tsx examples/p2p-webrtc/webrtc-signaling.ts --caller camera-agent --receiver analysis-agent',
        notes: ['Use names that match the real peer roles in your local tool.'],
      },
      {
        title: 'Inspect inboxes while debugging',
        command: '$ pd agent camera-agent --inbox && pd agent analysis-agent --inbox',
        notes: ['The messages are durable enough to inspect if the peer flow breaks.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A durable rendezvous for two peers.',
        paragraphs: [
          'The caller sends a WEBRTC_OFFER into the receiver inbox. The receiver reads unread inbox messages, extracts the offer, and posts a WEBRTC_ANSWER back to the caller inbox.',
          'The example uses fake SDP strings because the point is the coordination layer, not browser media bindings. Replace those strings with real RTCPeerConnection descriptions in a browser or native app.',
        ],
      },
      {
        id: 'why-inbox',
        label: 'Why inbox',
        title: 'Signaling needs durability more than throughput.',
        paragraphs: [
          'Offers, answers, and ICE candidates are small control messages. If one side restarts, you want to inspect what happened instead of losing the handshake in a transient process.',
          'Once the peers connect, the high-bandwidth stream should leave Port Daddy and move directly over the peer channel.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/p2p-webrtc/webrtc-signaling.ts', language: 'typescript', code: p2pWebrtcSource },
      { path: 'examples/p2p-webrtc/README.md', language: 'text', code: p2pWebrtcReadme },
    ],
    adapt: [
      'Replace fake SDP payloads with browser RTCPeerConnection offer and answer objects.',
      'Add candidate trickle by sending additional inbox messages with kind WEBRTC_ICE.',
      'Use Port Daddy only for rendezvous; send video, audio, or bulk data over the peer channel.',
    ],
    related: [
      { title: 'Inbox tutorial', href: '/tutorials/inbox' },
      { title: 'Agent command', href: '/docs/cli/agent' },
      { title: 'Remote harbors', href: '/tutorials/remote-harbors' },
    ],
  },
  {
    slug: 'agent-topologies',
    title: 'Build an inspectable agent topology trace',
    eyebrow: 'Swarm patterns',
    level: 'Beginner',
    time: '15 min',
    summary:
      'Publish concrete event traces for star, ring, and arbiter coordination patterns, so a workflow can be inspected after it runs.',
    surveyPlain:
      'A runnable sketch of how agents coordinate across channels — before you commit to a full orchestrator.',
    builds:
      'A TypeScript publisher that emits star delegation, ring handoff, and arbiter review events into Port Daddy message channels.',
    whyItMatters:
      'Topology diagrams are cheap. Event traces are useful. This example makes each edge a real message you can inspect with the daemon after the process exits.',
    lastReviewed: '2026-04-29',
    tags: ['swarm', 'messages', 'topologies', 'workflow'],
    visual: EXAMPLE_VISUALS['agent-topologies'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript publisher.',
      'A workflow or fleet template where you want visible coordination edges.',
    ],
    files: [
      'examples/agent-topologies/topology-pubsub.ts',
      'examples/agent-topologies/README.md',
    ],
    commands: [
      {
        title: 'Publish the topology trace',
        command: '$ npx tsx examples/agent-topologies/topology-pubsub.ts',
        notes: ['Emits star, ring, and arbiter events to topology:* channels.'],
      },
      {
        title: 'Inspect the channel catalogue',
        command: '$ pd channels',
        notes: ['Use the channel list to see the topology channels created by the run.'],
      },
      {
        title: 'Read one topology stream',
        command: '$ pd sub topology:star --once --no-history --limit=5',
        notes: ['Swap topology:star for topology:ring or topology:arbiter.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'Three coordination shapes as actual Port Daddy messages.',
        paragraphs: [
          'The star trace shows a coordinator assigning work and receiving completion events. The ring trace shows phase-to-phase handoff. The arbiter trace shows a worker submitting a change to a quality gate.',
          'Each event includes topology, actor, action, payload, and timestamp. That is enough for a dashboard, tutorial, or fleet runner to reconstruct what happened.',
        ],
      },
      {
        id: 'why-events',
        label: 'Why events',
        title: 'A topology is only useful if operators can inspect the edges.',
        paragraphs: [
          'If every transition stays inside one process log, the operator cannot tell which agent handed off to whom. Publishing the edges gives the local daemon durable coordination evidence.',
          'This example does not spawn agents. It shows the message shape a real orchestrator or fleet template should emit while agents do the work.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/agent-topologies/topology-pubsub.ts', language: 'typescript', code: agentTopologiesSource },
      { path: 'examples/agent-topologies/README.md', language: 'text', code: agentTopologiesReadme },
    ],
    adapt: [
      'Use star when one coordinator owns assignment and summary.',
      'Use ring when phases should hand off in order without a permanent coordinator.',
      'Use arbiter when work needs an explicit quality gate before it becomes accepted state.',
    ],
    related: [
      { title: 'Messaging reference', href: '/docs/cli/pub' },
      { title: 'Fleet tutorial', href: '/tutorials/fleet' },
      { title: 'Agents view', href: '/agents' },
    ],
  },
]

export const FEATURED_EXAMPLE = EXAMPLE_DOCS[0]
export const SECONDARY_EXAMPLES = EXAMPLE_DOCS.slice(1)

export function findExampleDoc(slug: string | undefined): ExampleDoc | undefined {
  return EXAMPLE_DOCS.find((example) => example.slug === slug)
}
