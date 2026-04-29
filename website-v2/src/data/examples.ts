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
import p2pWebrtcReadme from '../../../examples/p2p-webrtc/README.md?raw'
import p2pWebrtcSource from '../../../examples/p2p-webrtc/webrtc-signaling.ts?raw'
import ephemeralCiDbReadme from '../../../examples/ephemeral-ci-db/README.md?raw'
import ephemeralCiDbSource from '../../../examples/ephemeral-ci-db/ephemeral-postgres.sh?raw'
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
  prerequisites: string[]
  files: string[]
  commands: ExampleCommand[]
  sections: ExampleSection[]
  sourceFiles: ExampleSourceFile[]
  adapt: string[]
  related: Array<{ title: string; href: string }>
}

export const EXAMPLE_DOCS: ExampleDoc[] = [
  {
    slug: 'pd-tube-button-to-agent',
    title: 'Build a button-to-agent loop with PD Tube',
    eyebrow: 'PD Tube',
    level: 'Intermediate',
    time: '18 min',
    summary:
      'Turn a plain HTML button into a local phone line to the agent session already running in your project.',
    surveyPlain:
      'Connect a localhost website button, or anything else you want, to a live Claude Code or ChatGPT session.',
    builds:
      'A browser page with three buttons that publish work requests into Port Daddy and render the local agent reply inline.',
    whyItMatters:
      'This is the lede: the app does not integrate with Claude, OpenAI, MCP, or a hosted webhook. It posts JSON to the local daemon, and the terminal agent already sitting in the repo becomes the worker.',
    lastReviewed: '2026-04-29',
    tags: ['tube', 'browser', 'agent loop', 'messages'],
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
        command: "$ printf '%s\\n' \"Deployed to staging. CI is green.\" | pd tube ui:clicks --reply <message-id> --sender claude-code",
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
      'Wrap a failing test command, publish the failure to the local agent, and print the diagnosis back in the terminal.',
    surveyPlain:
      'Turn red tests into a direct prompt for the agent that already has the repo open.',
    builds:
      'A TypeScript reporter you can run around npm test, Vitest, Jest, pytest, Playwright, or a pre-commit check.',
    whyItMatters:
      'A test runner is already the moment a developer wants help. This example turns that failure into a structured local event instead of copying logs into chat.',
    lastReviewed: '2026-04-29',
    tags: ['tube', 'tests', 'reporter', 'terminal'],
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
      'Select code in a local page, publish the file and range to the agent, and render the explanation inline.',
    surveyPlain:
      'This is the useful core of a VS Code or JetBrains extension without extension packaging.',
    builds:
      'A browser-based editor mock that sends selected code to editor:explain and waits for the local agent reply.',
    whyItMatters:
      'Editor integrations often get heavy because they try to host or authenticate the agent. This one only publishes a local event and lets the already-running agent do the work.',
    lastReviewed: '2026-04-29',
    tags: ['tube', 'editor', 'selection', 'dev tools'],
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
        command: "$ printf '%s\\n' \"This helper normalizes daemon URLs before fetch.\" | pd tube editor:explain --reply <message-id>",
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
      'Your actual workstation becomes the bot backend, with full repo access and no hosted agent service.',
    builds:
      'A local HTTP server with /webhook, /slack, /discord, and /linear endpoints that publish to chat:mentions and optionally wait for a reply.',
    whyItMatters:
      'Most bot demos hide the hard part behind cloud infrastructure. This one shows the small local bridge: POST JSON in, pd tube event out, threaded answer back to the caller.',
    lastReviewed: '2026-04-29',
    tags: ['tube', 'webhooks', 'bots', 'http'],
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
    title: 'Elect one leader from a local agent swarm',
    eyebrow: 'Locks',
    level: 'Intermediate',
    time: '18 min',
    summary:
      'Run identical workers that race for one Port Daddy lock so exactly one becomes the coordinator.',
    surveyPlain:
      'Build the "one agent owns the scarce role" pattern for swarms, batch coordinators, and rate-limited side effects.',
    builds:
      'A TypeScript swarm simulation where one worker acquires swarm:leader, does leader work, and releases the lock while the rest become followers.',
    whyItMatters:
      'A swarm should not need bespoke leader code per worker. Port Daddy locks let every worker run the same path while the daemon decides who owns the critical section right now.',
    lastReviewed: '2026-04-29',
    tags: ['locks', 'swarm', 'coordination', 'resilience'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript swarm simulation.',
      'Several local workers, agents, or processes that need one elected coordinator.',
    ],
    files: [
      'examples/leader-election/leader-election.ts',
      'examples/leader-election/README.md',
    ],
    commands: [
      {
        title: 'Check the daemon',
        command: '$ pd status',
        notes: ['The example uses the daemon lock endpoint behind the CLI.'],
      },
      {
        title: 'Run the default swarm',
        command: '$ npx tsx examples/leader-election/leader-election.ts',
        notes: ['Five workers race for swarm:leader; one leader wins and the rest continue as followers.'],
      },
      {
        title: 'Run a bigger swarm',
        command: '$ npx tsx examples/leader-election/leader-election.ts --workers 8 --hold-ms 2500',
        notes: ['Increase contention to make the single-winner behavior obvious.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A same-code-path swarm where one worker owns coordination.',
        paragraphs: [
          'Each worker attempts to acquire swarm:leader with a short TTL. The winner runs leader work inside try/finally and releases the lock. The losers print follower mode and continue without crashing.',
          'That is the practical leader-election primitive most local agent swarms need: one coordinator at a time, visible ownership, and recovery if the owner dies.',
        ],
      },
      {
        id: 'why-locks',
        label: 'Why locks',
        title: 'The lock is the authority boundary, not a social convention.',
        paragraphs: [
          'Without a shared lock, every agent has to infer whether it is safe to coordinate, summarize, deploy, or call a rate-limited API. That inference is brittle once several terminals are alive.',
          'Port Daddy makes the scarce role explicit. The current leader can be inspected, the TTL bounds failure, and every worker can use the same executable code.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/leader-election/leader-election.ts', language: 'typescript', code: leaderElectionSource },
      { path: 'examples/leader-election/README.md', language: 'text', code: leaderElectionReadme },
    ],
    adapt: [
      'Use one lock per scarce role, such as release:coordinator, issue:triage-lead, or api:openai-writer.',
      'Keep the leader work inside try/finally so the process releases cleanly when it finishes.',
      'Use TTL values that match the work; short enough to recover, long enough to avoid churn.',
    ],
    related: [
      { title: 'with-lock reference', href: '/docs/cli/with-lock' },
      { title: 'Sessions feature', href: '/docs/features/sessions' },
      { title: 'Agent roster', href: '/agents' },
    ],
  },
  {
    slug: 'p2p-webrtc',
    title: 'Build WebRTC signaling over agent inboxes',
    eyebrow: 'Inbox',
    level: 'Advanced',
    time: '22 min',
    summary:
      'Use durable Port Daddy inboxes to exchange offer and answer messages before two agents open a direct peer channel.',
    surveyPlain:
      'Build the signaling server part of a peer-to-peer agent connection without hosting a public WebSocket service.',
    builds:
      'A TypeScript handshake where Agent A sends an SDP offer to Agent B, Agent B answers through Agent A inbox, and both inboxes are cleaned up.',
    whyItMatters:
      'High-bandwidth streams should not flow through the coordination daemon. Port Daddy can authorize and record the handshake while WebRTC, WebTransport, or another peer path carries the heavy data.',
    lastReviewed: '2026-04-29',
    tags: ['inbox', 'webrtc', 'signaling', 'p2p'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript signaling demo.',
      'Two local agent identities that should exchange direct connection metadata.',
    ],
    files: [
      'examples/p2p-webrtc/webrtc-signaling.ts',
      'examples/p2p-webrtc/README.md',
    ],
    commands: [
      {
        title: 'Run the full exchange',
        command: '$ npx tsx examples/p2p-webrtc/webrtc-signaling.ts',
        notes: ['The demo registers agent-a and agent-b, exchanges offer/answer payloads, marks inboxes read, and unregisters both agents.'],
      },
      {
        title: 'Use explicit ids',
        command: '$ npx tsx examples/p2p-webrtc/webrtc-signaling.ts --caller camera-agent --receiver analysis-agent',
        notes: ['Use names that match the real roles in your system.'],
      },
      {
        title: 'Inspect inbox state',
        command: '$ pd inbox list agent-a\n$ pd inbox list agent-b',
        notes: ['The example marks messages read, but these commands show the same inbox surface a real app would use.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'The signaling half of a peer-to-peer connection.',
        paragraphs: [
          'The code registers two demo agents, sends a WEBRTC_OFFER object to the receiver inbox, reads it back, sends a WEBRTC_ANSWER to the caller inbox, and verifies the caller received it.',
          'It intentionally does not open a media connection. The example isolates the coordination layer that Port Daddy should own.',
        ],
      },
      {
        id: 'why-inbox',
        label: 'Why inbox',
        title: 'Inboxes are durable, targeted, and inspectable.',
        paragraphs: [
          'A public signaling server is another service to deploy and secure. A Port Daddy inbox is already scoped to an agent identity and survives the tab or terminal that created the message.',
          'That makes it a good fit for exchanging SDP, ICE candidates, rendezvous tokens, or any small connection metadata before the peers talk directly.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/p2p-webrtc/webrtc-signaling.ts', language: 'typescript', code: p2pWebrtcSource },
      { path: 'examples/p2p-webrtc/README.md', language: 'text', code: p2pWebrtcReadme },
    ],
    adapt: [
      'Replace the fake SDP strings with browser RTCPeerConnection offer and answer payloads.',
      'Keep authorization and audit in the inbox layer, then move media or data over the direct peer connection.',
      'Use one inbox message type per signaling event, such as webrtc.offer, webrtc.answer, and webrtc.ice.',
    ],
    related: [
      { title: 'Inbox tutorial', href: '/tutorials/inbox' },
      { title: 'Agent inbox reference', href: '/docs/sdk/register-agent' },
      { title: 'Remote coordination', href: '/docs/features/remote' },
    ],
  },
  {
    slug: 'ephemeral-ci-db',
    title: 'Claim a collision-free port for an ephemeral CI database',
    eyebrow: 'Ports',
    level: 'Intermediate',
    time: '14 min',
    summary:
      'Wrap a Postgres test database so parallel CI jobs get stable semantic ports instead of fighting over 5432.',
    surveyPlain:
      'Build the port-claiming part of a local or CI database harness that can run many test jobs on one host.',
    builds:
      'A Bash script that claims ci:postgres:<run-id>, constructs DATABASE_URL, prints the Docker command, and optionally runs the container.',
    whyItMatters:
      'Port collisions are boring until they waste an afternoon. A semantic claim lets the same CI run get the same port, different runs get different ports, and cleanup release the identity.',
    lastReviewed: '2026-04-29',
    tags: ['ports', 'ci', 'postgres', 'testing'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'bash and the pd CLI.',
      'Docker only if you pass --run.',
    ],
    files: [
      'examples/ephemeral-ci-db/ephemeral-postgres.sh',
      'examples/ephemeral-ci-db/README.md',
    ],
    commands: [
      {
        title: 'Dry-run the flow',
        command: '$ bash examples/ephemeral-ci-db/ephemeral-postgres.sh',
        notes: ['This claims a port, prints DATABASE_URL and the Docker command, then releases the claim.'],
      },
      {
        title: 'Run a real container',
        command: '$ bash examples/ephemeral-ci-db/ephemeral-postgres.sh --run',
        notes: ['Requires Docker. Cleanup removes the container and releases the Port Daddy claim.'],
      },
      {
        title: 'Use a CI run id',
        command: '$ GITHUB_RUN_ID=12345 bash examples/ephemeral-ci-db/ephemeral-postgres.sh --run',
        notes: ['The semantic id becomes ci:postgres:12345, which makes reruns stable.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'A test database harness that stops guessing ports.',
        paragraphs: [
          'The script claims a Port Daddy identity, turns the returned port into DATABASE_URL, and either prints or runs the matching Docker command.',
          'The default is dry-run so the example is safe on machines without Docker. The --run path is the production shape.',
        ],
      },
      {
        id: 'semantic-port',
        label: 'Semantic identity',
        title: 'The identity is the stable thing; the numeric port is an implementation detail.',
        paragraphs: [
          'A fixed port like 5432 only works when one process exists. A semantic id like ci:postgres:12345 lets Port Daddy choose a free local port while keeping the service name meaningful.',
          'That same shape works for Redis, Selenium, fake S3, local previews, or any test service that needs parallelism without collision.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/ephemeral-ci-db/ephemeral-postgres.sh', language: 'text', code: ephemeralCiDbSource },
      { path: 'examples/ephemeral-ci-db/README.md', language: 'text', code: ephemeralCiDbReadme },
    ],
    adapt: [
      'Replace Postgres with Redis, MinIO, Selenium, or any local dependency your tests need.',
      'Use the CI provider run id, job id, or matrix shard as part of the semantic service id.',
      'Always release the claim in a trap or finally block.',
    ],
    related: [
      { title: 'Port claims reference', href: '/docs/cli/claim' },
      { title: 'Testing practice', href: '/docs/best-practices/testing-and-promotion' },
      { title: 'Service discovery tutorial', href: '/tutorials/dns' },
    ],
  },
  {
    slug: 'agent-archetypes',
    title: 'Publish an agent topology trace',
    eyebrow: 'Swarm topology',
    level: 'Intermediate',
    time: '16 min',
    summary:
      'Turn star, ring, and arbiter coordination patterns into concrete Port Daddy channel events.',
    surveyPlain:
      'Build the event trace behind leader-worker, phase-relay, and quality-gate agent systems.',
    builds:
      'A TypeScript publisher that emits star topology assignments, ring handoffs, and arbiter review events into inspectable channels.',
    whyItMatters:
      'A topology diagram is not enough. Port Daddy makes each transition a message that an operator, watcher, or another agent can inspect after the orchestrator exits.',
    lastReviewed: '2026-04-29',
    tags: ['swarm', 'pubsub', 'arbiter', 'topology'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the topology publisher.',
      'Optional: pd channels or pd sub to inspect the emitted events.',
    ],
    files: [
      'examples/agent-topologies/topology-pubsub.ts',
      'examples/agent-topologies/README.md',
    ],
    commands: [
      {
        title: 'Publish the topology trace',
        command: '$ npx tsx examples/agent-topologies/topology-pubsub.ts',
        notes: ['The script publishes events to topology:star, topology:ring, and topology:arbiter.'],
      },
      {
        title: 'Inspect channels',
        command: '$ pd channels',
        notes: ['The emitted channels remain visible after the process exits.'],
      },
      {
        title: 'Watch one topology',
        command: '$ pd sub topology:arbiter',
        notes: ['Run this in another terminal before publishing to watch the quality-gate trace live.'],
      },
    ],
    sections: [
      {
        id: 'what-you-build',
        label: 'What you build',
        title: 'Three swarm topology traces backed by real messages.',
        paragraphs: [
          'The star trace shows one coordinator assigning work and summarizing results. The ring trace shows phase-to-phase handoffs. The arbiter trace shows a worker submitting work to a quality gate.',
          'Each transition is a Port Daddy message. That means a real implementation can attach agents, dashboards, tests, or watchers to the same channels later.',
        ],
      },
      {
        id: 'why-events',
        label: 'Why events',
        title: 'Topology should be inspectable, not only drawn.',
        paragraphs: [
          'Agent architecture often gets described in boxes and arrows, then implemented as hidden process state. This example keeps the arrows as durable channel events.',
          'That makes the topology easier to debug, replay, teach, and evolve into a real fleet template.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/agent-topologies/topology-pubsub.ts', language: 'typescript', code: agentTopologiesSource },
      { path: 'examples/agent-topologies/README.md', language: 'text', code: agentTopologiesReadme },
    ],
    adapt: [
      'Replace the sample payloads with your fleet roles, issue ids, artifacts, and acceptance checks.',
      'Use declared channels when several worktrees need scoped topology traffic.',
      'Attach pd tube, pd sub, or dashboard views to the same channels for live operator feedback.',
    ],
    related: [
      { title: 'Messaging reference', href: '/docs/cli/pub' },
      { title: 'Fleet tutorial', href: '/tutorials/fleet' },
      { title: 'Arbiter feature', href: '/docs/features/arbiter' },
    ],
  },
]

export const FEATURED_EXAMPLE = EXAMPLE_DOCS[0]
export const SECONDARY_EXAMPLES = EXAMPLE_DOCS.slice(1)

export function findExampleDoc(slug: string | undefined): ExampleDoc | undefined {
  return EXAMPLE_DOCS.find((example) => example.slug === slug)
}
