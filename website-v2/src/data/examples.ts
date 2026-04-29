import pdTubeButtonHtml from '../../../examples/pd-tube/button-to-agent.html?raw'
import pdTubeReadme from '../../../examples/pd-tube/README.md?raw'
import warRoomReadme from '../../../examples/war-room/README.md?raw'
import warRoomRun from '../../../examples/war-room/run.sh?raw'
import inboxReadme from '../../../examples/inbox/README.md?raw'
import inboxAgentDm from '../../../examples/inbox/agent-dm.sh?raw'
import inboxMonitor from '../../../examples/inbox/inbox-monitor.ts?raw'
import fileEditGuard from '../../../examples/coordination/file-edit-guard.ts?raw'
import agentProtocol from '../../../examples/coordination/agent-protocol.ts?raw'
import coordinationReadme from '../../../examples/coordination/README.md?raw'
import migrationGuard from '../../../examples/locks/migration-guard.ts?raw'
import serviceDiscovery from '../../../examples/dns/service-discovery.ts?raw'
import dnsReadme from '../../../examples/dns/README.md?raw'
import sessionLifecycle from '../../../examples/phases/session-lifecycle.sh?raw'
import phasesReadme from '../../../examples/phases/README.md?raw'

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
        notes: ['No SDK, no MCP server, no hosted webhook. The page uses fetch against the local daemon.'],
      },
      {
        title: 'Start the agent side',
        command: '$ pd tube ui:clicks',
        notes: ['Leave this running in Claude Code, Codex, Cursor, Aider, or any terminal-backed agent.'],
      },
      {
        title: 'Reply to an event',
        command: "$ printf '%s\\n' \"I handled it.\" | pd tube ui:clicks --reply <message-id> --sender claude-code",
        notes: ['The browser watches the same channel and renders replies whose envelope has inReplyTo set.'],
      },
    ],
    sections: [
      {
        id: 'overview',
        label: 'Overview',
        title: 'The local app does not integrate with Claude. It integrates with Port Daddy.',
        paragraphs: [
          'The browser publishes a JSON event to ui:clicks. The agent terminal is blocked in pd tube ui:clicks. When the event arrives, the agent sees the payload and handles the work in the same repo context it already has.',
          'The response travels back through the same channel as a threaded tube message. The browser matches the daemon message id through inReplyTo and renders the response inline.',
        ],
      },
      {
        id: 'why-it-matters',
        label: 'Why it matters',
        title: 'Any process that can POST JSON can summon the local agent session.',
        paragraphs: [
          'That is the useful primitive. Editor extensions, test reporters, browser extensions, notebook cells, chat adapters, local dev tools, and physical buttons can all become agent-facing controls without owning an agent runtime.',
          'The agent side stays CLI-first because CLI-in-a-loop is the interoperability layer every local coding agent already understands.',
        ],
      },
      {
        id: 'message-shape',
        label: 'Protocol shape',
        title: 'The browser publishes a tube envelope and waits for a correlated reply.',
        paragraphs: [
          'The daemon message row supplies the durable id. The tube envelope supplies the body and optional inReplyTo. This keeps threading cheap without requiring the publisher to speak a large protocol.',
          'The publisher is intentionally boring JavaScript. The product value is not a fancy SDK; it is a stable local substrate that lets ordinary tools reach the live agent.',
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
      { title: 'pd pub reference', href: '/docs/cli/pub' },
      { title: 'Messaging MCP tool', href: '/docs/mcp/publish-message' },
      { title: 'Inbox tutorial', href: '/tutorials/inbox' },
    ],
  },
  {
    slug: 'war-room-incident',
    title: 'Run a multi-agent incident war room',
    eyebrow: 'Swarm coordination',
    level: 'Advanced',
    time: '20 min',
    summary:
      'Simulate three agents investigating one production incident through sessions, notes, and a shared channel.',
    lastReviewed: '2026-04-29',
    tags: ['agents', 'notes', 'channels', 'incident'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'The pd CLI on PATH.',
      'A terminal that can run shell scripts from the repo root.',
    ],
    files: [
      'examples/war-room/run.sh',
      'examples/war-room/README.md',
    ],
    commands: [
      {
        title: 'Run the simulation',
        command: '$ ./examples/war-room/run.sh',
        notes: ['The script registers three agents, publishes findings, writes notes, and signs them off.'],
      },
      {
        title: 'Inspect the trail',
        command: '$ pd notes --limit 20\n$ pd msg get bridge:warroom:incident\n$ pd agents',
        notes: ['The notes and channel messages are the durable incident report. Agents should be gone after cleanup.'],
      },
    ],
    sections: [
      {
        id: 'overview',
        label: 'Overview',
        title: 'This is a social workflow encoded as daemon state.',
        paragraphs: [
          'The incident lead, database investigator, and log analyst each get a semantic identity. They publish discoveries to the same incident channel and leave durable notes as they narrow the root cause.',
          'The example demonstrates the difference between chat transcript coordination and substrate coordination: the useful facts survive the terminal session.',
        ],
      },
      {
        id: 'flow',
        label: 'Flow',
        title: 'Join, publish, narrow, resolve, sign off.',
        paragraphs: [
          'Act 1 registers the agents. Act 2 publishes the initial report and early evidence. Act 3 correlates the failure with a deployment. Act 4 records the fix. Act 5 leaves the operator with a reviewable trail.',
          'The cleanup trap matters. A good example proves that agents do not leak after the demo exits.',
        ],
      },
      {
        id: 'operator-proof',
        label: 'Operator proof',
        title: 'The observable result is not the colorful script output.',
        paragraphs: [
          'The proof is in pd notes, pd msg get, and pd agents. Those commands show the durable coordination state the daemon retained and the live-agent state it cleaned up.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/war-room/run.sh', language: 'text', code: warRoomRun },
      { path: 'examples/war-room/README.md', language: 'text', code: warRoomReadme },
    ],
    adapt: [
      'Swap the scripted findings for real agent tasks: log search, git bisect, failing-test analysis, or deploy inspection.',
      'Use one channel per incident or workstream so subscribers can join by convention.',
      'Keep the sign-off path in a trap or finally block so dead demo agents do not pollute fleet truth.',
    ],
    related: [
      { title: 'Multi-agent tutorial', href: '/tutorials/multi-agent' },
      { title: 'Notes reference', href: '/docs/cli/notes' },
      { title: 'Activity ledger tutorial', href: '/tutorials/time-travel' },
    ],
  },
  {
    slug: 'durable-inbox-lifecycle',
    title: 'Send durable direct messages between agents',
    eyebrow: 'Inbox',
    level: 'Beginner',
    time: '14 min',
    summary:
      'Register two agents, send a targeted handoff, inspect unread state, mark it read, clear it, and clean up.',
    lastReviewed: '2026-04-29',
    tags: ['inbox', 'handoff', 'SSE', 'agents'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'curl and python3 for the shell lifecycle script.',
      'tsx if you want to run the live inbox monitor.',
    ],
    files: [
      'examples/inbox/agent-dm.sh',
      'examples/inbox/inbox-monitor.ts',
      'examples/inbox/README.md',
    ],
    commands: [
      {
        title: 'Run the full lifecycle',
        command: '$ bash examples/inbox/agent-dm.sh',
        notes: ['The script exercises register, send, stats, list, mark-read, clear, and unregister.'],
      },
      {
        title: 'Run a live monitor',
        command: '$ npx tsx examples/inbox/inbox-monitor.ts bob',
        notes: ['Use this pattern for an operator pane, status tail, or agent-local notification feed.'],
      },
    ],
    sections: [
      {
        id: 'overview',
        label: 'Overview',
        title: 'Inbox messages are targeted and persistent.',
        paragraphs: [
          'Use pub/sub when many subscribers should hear an event. Use the inbox when a specific agent needs a handoff, blocker, or result and you need unread/read state.',
          'The shell script keeps the lifecycle explicit so the semantics are inspectable rather than hidden behind a framework.',
        ],
      },
      {
        id: 'state',
        label: 'State model',
        title: 'The important thing is the transition, not the POST.',
        paragraphs: [
          'The example sends one message and then reads the stats before and after the message is marked read and cleared. That makes the inbox useful for tooling because the unread count means something concrete.',
        ],
      },
      {
        id: 'monitor',
        label: 'Monitor',
        title: 'The TypeScript monitor is the seed of a real dev tool.',
        paragraphs: [
          'The monitor subscribes to inbox events, prints messages with attribution, and marks them read after receipt. That same shape can power an editor panel or native menu-bar surface.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/inbox/agent-dm.sh', language: 'text', code: inboxAgentDm },
      { path: 'examples/inbox/inbox-monitor.ts', language: 'typescript', code: inboxMonitor },
      { path: 'examples/inbox/README.md', language: 'text', code: inboxReadme },
    ],
    adapt: [
      'Use inbox messages for handoffs that have an owner.',
      'Use unread counts for UI badges and operator review queues.',
      'Pair inbox monitors with session notes so ephemeral notifications still leave durable context.',
    ],
    related: [
      { title: 'Inbox tutorial', href: '/tutorials/inbox' },
      { title: 'Agent register CLI', href: '/docs/cli/agent-register' },
      { title: 'MCP add-note tool', href: '/docs/mcp/add-note' },
    ],
  },
  {
    slug: 'file-edit-guard',
    title: 'Build a file edit guard for local agents',
    eyebrow: 'Dev tool',
    level: 'Intermediate',
    time: '22 min',
    summary:
      'Use Port Daddy locks, messages, and notes to build a guard that agents run before editing contested files.',
    lastReviewed: '2026-04-29',
    tags: ['locks', 'file claims', 'dev tools', 'coordination'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript scripts.',
      'An AGENT_ID environment variable if you want stable attribution.',
    ],
    files: [
      'examples/coordination/file-edit-guard.ts',
      'examples/coordination/agent-protocol.ts',
      'examples/coordination/README.md',
    ],
    commands: [
      {
        title: 'Claim before editing',
        command: '$ AGENT_ID=agent-a npx tsx examples/coordination/file-edit-guard.ts claim src/auth.ts "Add auth check"',
        notes: ['The guard acquires a lock and publishes a claim message.'],
      },
      {
        title: 'Check contention',
        command: '$ AGENT_ID=agent-b npx tsx examples/coordination/file-edit-guard.ts status src/auth.ts',
        notes: ['Another agent can inspect live ownership instead of guessing from chat.'],
      },
      {
        title: 'Release when done',
        command: '$ AGENT_ID=agent-a npx tsx examples/coordination/file-edit-guard.ts release src/auth.ts',
        notes: ['Release publishes a channel event and records a durable note.'],
      },
    ],
    sections: [
      {
        id: 'overview',
        label: 'Overview',
        title: 'This is the kind of dev tool Port Daddy should make boring to build.',
        paragraphs: [
          'The script is not a toy wrapper around one CLI command. It composes a file-specific channel, a lock name, status inspection, release behavior, and durable notes into a workflow agents can actually follow.',
          'That composition is what the examples section should teach: Port Daddy is a substrate for building local tools around agent work.',
        ],
      },
      {
        id: 'protocol',
        label: 'Protocol',
        title: 'Channel names are the discovery mechanism.',
        paragraphs: [
          'The file path becomes a predictable channel. Agents do not need a central registry to know where to watch for claims and releases. They need a naming convention that stays stable across tools.',
        ],
      },
      {
        id: 'guardrail',
        label: 'Guardrail',
        title: 'The lock is stronger than etiquette, and the note is stronger than memory.',
        paragraphs: [
          'The lock protects the scarce resource. The channel explains what is happening now. The note records what happened after the script exits. The example is useful because it uses all three surfaces deliberately.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/coordination/file-edit-guard.ts', language: 'typescript', code: fileEditGuard },
      { path: 'examples/coordination/agent-protocol.ts', language: 'typescript', code: agentProtocol },
      { path: 'examples/coordination/README.md', language: 'text', code: coordinationReadme },
    ],
    adapt: [
      'Replace whole-file lock names with symbol or region claims when the symbol index knows the file.',
      'Put the status command behind editor CodeLens, pre-edit hooks, or agent startup prompts.',
      'Keep release idempotent and noisy enough that stale ownership can be diagnosed later.',
    ],
    related: [
      { title: 'Locks reference', href: '/docs/cli/lock-acquire' },
      { title: 'Sessions and file claims', href: '/docs/features/sessions' },
      { title: 'Coordination discipline', href: '/docs/best-practices/coordination-discipline' },
    ],
  },
  {
    slug: 'migration-lock-guard',
    title: 'Protect a migration with one lock',
    eyebrow: 'Locks',
    level: 'Intermediate',
    time: '12 min',
    summary:
      'Simulate two agents racing for one migration resource and prove only one enters the critical section.',
    lastReviewed: '2026-04-29',
    tags: ['locks', 'critical section', 'migrations'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript script.',
      'A willingness to treat migrations as scarce infrastructure, not a social convention.',
    ],
    files: ['examples/locks/migration-guard.ts'],
    commands: [
      {
        title: 'Run the contention demo',
        command: '$ npx tsx examples/locks/migration-guard.ts',
        notes: ['Two actors attempt the same migration. One runs. The other exits with an operator-readable message.'],
      },
      {
        title: 'Use the same shape for real work',
        command: '$ pd with-lock db-migrations -- npm run migrate',
        notes: ['The example explains the primitive; with-lock is the ergonomic daily command.'],
      },
    ],
    sections: [
      {
        id: 'overview',
        label: 'Overview',
        title: 'The useful demo is the losing actor.',
        paragraphs: [
          'A lock demo that only shows success is not a coordination example. The migration guard matters because it shows the second actor getting a clear skip path instead of corrupting shared state.',
        ],
      },
      {
        id: 'critical-section',
        label: 'Critical section',
        title: 'The lock wraps exactly the part that cannot run twice.',
        paragraphs: [
          'The script acquires db-migrations, does the simulated work inside try/finally, and releases even if the critical section fails. That structure is the pattern to copy.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/locks/migration-guard.ts', language: 'typescript', code: migrationGuard },
    ],
    adapt: [
      'Use named locks for migrations, generated artifacts, release promotion, schema writes, and external side effects.',
      'Keep the protected region small so ordinary parallel work can keep moving.',
      'Make the losing path explicit. Operators should know whether work skipped, queued, or failed.',
    ],
    related: [
      { title: 'With-lock CLI', href: '/docs/cli/with-lock' },
      { title: 'Testing and promotion practice', href: '/docs/best-practices/testing-and-promotion' },
    ],
  },
  {
    slug: 'dns-service-discovery',
    title: 'Resolve services by semantic name',
    eyebrow: 'Discovery',
    level: 'Intermediate',
    time: '16 min',
    summary:
      'Register service records, list a namespace, look up the API endpoint, and clean up the records.',
    lastReviewed: '2026-04-29',
    tags: ['dns', 'services', 'semantic identity'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'tsx for the TypeScript script.',
      'Optional sudo access only for the /etc/hosts resolver script, not for the service-discovery example.',
    ],
    files: [
      'examples/dns/service-discovery.ts',
      'examples/dns/README.md',
    ],
    commands: [
      {
        title: 'Run the discovery pass',
        command: '$ npx tsx examples/dns/service-discovery.ts',
        notes: ['The script registers shop services, lists them, looks up shop:api, and removes the records.'],
      },
      {
        title: 'Inspect DNS state',
        command: '$ pd dns list',
        notes: ['Run this while adapting the example to see what service identities are currently registered.'],
      },
    ],
    sections: [
      {
        id: 'overview',
        label: 'Overview',
        title: 'Semantic service names remove port folklore from local systems.',
        paragraphs: [
          'Agents should not have to remember that the API happens to be on 3100 today. They should resolve shop:api and let the daemon answer with the current endpoint.',
          'The example keeps registration and cleanup together so the service namespace remains believable after the demo exits.',
        ],
      },
      {
        id: 'lookup',
        label: 'Lookup',
        title: 'List broadly, resolve specifically.',
        paragraphs: [
          'The script first lists all DNS records and filters the shop namespace. Then it performs a specific lookup for shop:api. Those are the two tool shapes most dev tools need: overview and direct resolution.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/dns/service-discovery.ts', language: 'typescript', code: serviceDiscovery },
      { path: 'examples/dns/README.md', language: 'text', code: dnsReadme },
    ],
    adapt: [
      'Use project-prefixed service identities so duplicate local stacks do not collide.',
      'Resolve dependencies at startup instead of hardcoding localhost ports.',
      'Clean up records in test fixtures and demo scripts so stale names do not become false truth.',
    ],
    related: [
      { title: 'DNS tutorial', href: '/tutorials/dns' },
      { title: 'pd dns reference', href: '/docs/cli/dns' },
      { title: 'More discovery examples', href: '/docs/features/dns' },
    ],
  },
  {
    slug: 'session-phase-lifecycle',
    title: 'Model a full session phase lifecycle',
    eyebrow: 'Sessions',
    level: 'Beginner',
    time: '15 min',
    summary:
      'Start a session, claim files, move through phases, leave phase notes, complete the session, and unregister the agent.',
    lastReviewed: '2026-04-29',
    tags: ['sessions', 'phases', 'file claims', 'notes'],
    prerequisites: [
      'A running Port Daddy daemon.',
      'curl and jq for the shell script.',
      'A clean mental model that session state is product state, not chat state.',
    ],
    files: [
      'examples/phases/session-lifecycle.sh',
      'examples/phases/README.md',
    ],
    commands: [
      {
        title: 'Run the lifecycle',
        command: '$ bash examples/phases/session-lifecycle.sh',
        notes: ['The script registers an agent, creates a session, claims files, advances phases, notes progress, and completes.'],
      },
      {
        title: 'Inspect recent sessions',
        command: '$ pd notes --limit 10\n$ pd sessions --all --limit 5',
        notes: ['The post-run proof is the phase-aware trail left in daemon state.'],
      },
    ],
    sections: [
      {
        id: 'overview',
        label: 'Overview',
        title: 'A session is the durable wrapper around one piece of work.',
        paragraphs: [
          'The example moves deliberately through setup, planning, implementing, testing, reviewing, cleanup, and completion. Each phase leaves evidence that another agent can recover from.',
          'That matters because multi-agent work fails when the plan lives only in a transient chat turn.',
        ],
      },
      {
        id: 'claims',
        label: 'File claims',
        title: 'File claims attach edit intent to the session.',
        paragraphs: [
          'The script claims two files during setup. In a real workflow, that claim would become narrower as symbol-level edit intent becomes clear.',
        ],
      },
    ],
    sourceFiles: [
      { path: 'examples/phases/session-lifecycle.sh', language: 'text', code: sessionLifecycle },
      { path: 'examples/phases/README.md', language: 'text', code: phasesReadme },
    ],
    adapt: [
      'Use phase notes as recovery checkpoints before long test runs, risky edits, or context handoffs.',
      'Keep the cleanup phase explicit. Release claims, summarize validation, and make the next owner obvious.',
      'Have agents read the current session before starting adjacent work.',
    ],
    related: [
      { title: 'Session phases tutorial', href: '/tutorials/session-phases' },
      { title: 'pd begin reference', href: '/docs/cli/begin' },
      { title: 'pd done reference', href: '/docs/cli/done' },
    ],
  },
]

export function findExampleDoc(slug: string | undefined): ExampleDoc | undefined {
  return EXAMPLE_DOCS.find((example) => example.slug === slug)
}
