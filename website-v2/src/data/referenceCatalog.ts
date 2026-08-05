export interface ReferenceItem {
  name: string
  description: string
  href?: string
  aliases?: string[]
  flags?: string[]
  source?: string
}

export interface ReferenceGroup {
  title: string
  description: string
  href?: string
  source: string
  items: ReferenceItem[]
}

export const PORT_DADDY_VERSION = '3.27.0'

export function referenceAnchor(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const PLACEHOLDER_TOKENS = new Set([
  'all',
  'agent',
  'channel',
  'cmd',
  'command',
  'content',
  'files',
  'goal',
  'id',
  'identity',
  'iterations',
  'message',
  'name',
  'path',
  'pattern',
  'project',
  'purpose',
  'service',
  'summary',
  'task',
  'topic',
])

function cliNameTokens(name: string): string[] {
  return name
    .replace(/^pd\s+/, '')
    .replace(/"[^"]+"/g, ' ')
    .match(/[a-zA-Z0-9-]+/g) ?? []
}

export function cliCommandSlug(command: ReferenceItem | string): string {
  if (typeof command === 'object' && command.href?.startsWith('/docs/cli/')) {
    return command.href.replace(/^\/docs\/cli\/?/, '').replace(/\/$/, '')
  }

  const name = typeof command === 'string' ? command : command.name
  const tokens = cliNameTokens(name)
  const meaningfulTokens = tokens.filter((token, index) => index === 0 || !PLACEHOLDER_TOKENS.has(token.toLowerCase()))
  return referenceAnchor(meaningfulTokens.join('-') || name)
}

export function cliCommandHref(command: ReferenceItem | string): string {
  return `/docs/cli/${cliCommandSlug(command)}`
}

export interface CliReferenceItem extends ReferenceItem {
  href: string
  slug: string
  groupTitle: string
  groupDescription: string
  groupSource: string
  generated: boolean
  aliasRoutes: Array<{
    name: string
    href: string
    slug: string
  }>
}

export const CLI_REFERENCE_GROUPS: ReferenceGroup[] = [
  {
    title: 'Setup, Runtime, And Diagnostics',
    description: 'Install Port Daddy, inspect the live daemon, launch the dashboard, and manage canonical or sidecar runtimes.',
    source: 'bin/port-daddy-cli.ts, cli/commands/setup.ts, cli/commands/daemon.ts, cli/commands/diagnostics.ts, cli/commands/mcp-install.ts',
    items: [
      { name: 'pd setup', description: 'Install daemon, MCP, FleetBar, shell hook, and project init in one operator path.', flags: ['--project', '--no-daemon', '--no-mcp', '--no-fleetbar', '--no-init', '--no-hook'] },
      { name: 'pd init', href: '/docs/cli/init', description: 'Initialize Port Daddy project config, fleet config, MCP files, and managed git hook pieces.' },
      { name: 'pd mcp', description: 'Start the stdio MCP server for model clients. Use `pd mcp install` to configure supported tools.' },
      { name: 'pd mcp install', href: '/docs/cli/mcp-install', description: 'Auto-detect supported tools, configure MCP, install the agent skill, and write Port Daddy Pilot definitions.' },
      { name: 'pd help <topic>', description: 'Print detailed topic help for setup, sessions, locks, agents, actors, ports, messaging, DNS, orchestration, sugar, semantic, advisor, guard, ideas, roadmap, daemon, and tutorial.' },
      { name: 'pd learn', description: 'Open the interactive tutorial.', aliases: ['pd tutorial'] },
      { name: 'pd status', href: '/docs/cli/status', description: 'Show daemon version, PID, uptime, fleet readiness, active ports, and Bosun state.' },
      { name: 'pd health', description: 'Check daemon health, optionally for one service identity.' },
      { name: 'pd version', description: 'Print package/runtime version and code hash.' },
      { name: 'pd hints', description: 'Show launch hints for the current folder, including salvage and first-run nudges.' },
      { name: 'pd doctor', description: 'Run startup diagnostics for daemon, socket, launchd, FleetBar, and local configuration.', aliases: ['pd diagnose'] },
      { name: 'pd dashboard', description: 'Open the local dashboard/control plane.' },
      { name: 'pd metrics', description: 'Print daemon metrics.' },
      { name: 'pd config', description: 'Print resolved daemon or project configuration.' },
      { name: 'pd bench [iterations]', description: 'Run daemon latency benchmarks for health checks and port assignment.', flags: ['iterations'] },
      { name: 'pd ci-gate', description: 'Run the CLI gate used by CI/promotion checks.' },
      { name: 'pd start', description: 'Start the canonical daemon.', aliases: ['pd stop', 'pd restart'] },
      { name: 'pd install', description: 'Install the canonical daemon service.', aliases: ['pd uninstall'] },
      { name: 'pd daemon <command>', description: 'Manage named sidecar daemon profiles: list, status, start, stop, and env.' },
      { name: 'pd dev <command>', description: 'Run an isolated development daemon on a sidecar port for checkout-local testing.' },
    ],
  },
  {
    title: 'Ports, Services, Projects, And Orchestration',
    description: 'Claim deterministic ports, discover services, manage project records, start stacks, and publish readiness.',
    source: 'cli/commands/services.ts, cli/commands/projects.ts, cli/commands/orchestration.ts, cli/commands/integration.ts, cli/commands/dns.ts',
    items: [
      { name: 'pd claim <id>', href: '/docs/cli/claim', description: 'Claim a deterministic service port by semantic identity.', aliases: ['pd c'], flags: ['--port', '--range', '--expires', '--export', '--json', '--quiet'] },
      { name: 'pd release <id>', href: '/docs/cli/release', description: 'Release a port claim or identity pattern.', aliases: ['pd r'], flags: ['--expired'] },
      { name: 'pd find [pattern]', href: '/docs/cli/find', description: 'List matching claimed services and their ports.', aliases: ['pd f', 'pd l', 'pd list', 'pd ps', 'pd services'] },
      { name: 'pd url <id>', description: 'Print the URL for a claimed service.' },
      { name: 'pd env [pattern]', description: 'Export environment variables for matching services.' },
      { name: 'pd ports', description: 'List active or system port assignments, and clean up stale claims.', flags: ['--system', 'cleanup'] },
      { name: 'pd scan [dir]', href: '/docs/cli/scan', description: 'Detect frameworks and service entries in a project directory.', aliases: ['pd s'], flags: ['--dry-run', '--dir', '--branch', '--json'] },
      { name: 'pd projects', description: 'List, inspect, or remove registered projects.', aliases: ['pd p'] },
      { name: 'pd up', href: '/docs/cli/up', description: 'Start configured or discovered services for the current project.', aliases: ['pd u'], flags: ['--service', '--no-health', '--branch'] },
      { name: 'pd down', href: '/docs/cli/down', description: 'Stop services started by Port Daddy orchestration.', aliases: ['pd d'] },
      { name: 'pd wait <service...>', description: 'Wait for one or more service identities to become healthy.', flags: ['--timeout'] },
      { name: 'pd integration <command>', description: 'Publish or inspect cross-agent ready/needs signals.', flags: ['ready', 'needs', 'list'] },
      { name: 'pd dns <command>', href: '/docs/cli/dns', description: 'Manage local DNS records, resolver setup, cleanup, status, and sync.' },
    ],
  },
  {
    title: 'Sessions, Notes, Recovery, And Evidence',
    description: 'Create the audit trail: sessions, file claims, notes, activity, briefing, salvage, and catch-up commands.',
    source: 'cli/commands/sugar.ts, cli/commands/sessions.ts, cli/commands/say.ts, cli/commands/look.ts, cli/commands/sitrep.ts, cli/commands/resurrection.ts',
    items: [
      { name: 'pd begin "purpose"', href: '/docs/cli/begin', description: 'Register an agent, start a session, and write local context in one command.', aliases: ['pd b'], flags: ['--lifecycle', '--identity', '--agent', '--type', '--files'] },
      { name: 'pd done "summary"', href: '/docs/cli/done', description: 'End the active session, leave a final note, and unregister the agent.' },
      { name: 'pd whoami', href: '/docs/cli/whoami', description: 'Show the current agent, active session, purpose, notes, and claimed files.', aliases: ['pd w'] },
      { name: 'pd session <command>', description: 'Manual session lifecycle: start, end, done, abandon, rm, and files add/rm.', flags: ['--agent', '--force', '--files'] },
      { name: 'pd sessions', description: 'List active or historical sessions.', flags: ['--all', '--status', '--all-worktrees', '--json'] },
      { name: 'pd note <content>', href: '/docs/cli/note', description: 'Append an immutable note to the active or targeted session.', aliases: ['pd n'], flags: ['--type', '--session', '--agent'] },
      { name: 'pd notes [session-id]', href: '/docs/cli/notes', description: 'Read recent notes globally or for one session.', flags: ['--limit', '--type', '--json'] },
      { name: 'pd say <content>', description: 'Fan one status message out to notes plus optional tuple, pheromone, inbox, or broadcast targets.' },
      { name: 'pd look', description: 'Show sitrep-style context, or file heat when used with `--heat`.' },
      { name: 'pd sitrep', description: 'Summarize recent activity, notes, and coordination signals for the current context.' },
      { name: 'pd activity', description: 'Read activity log entries and summaries.', aliases: ['pd log'] },
      { name: 'pd briefing', description: 'Generate `.portdaddy/briefing.md` and `.portdaddy/briefing.json` for the current project.' },
      { name: 'pd history', description: 'Read briefing history.' },
      { name: 'pd changelog <command>', description: 'Add and query changelog entries by identity, session, or agent.' },
      { name: 'pd snapshots <command>', description: 'List, show, restore, or prune claim-watcher snapshots for recoverable file evidence.', aliases: ['pd snapshot'], flags: ['list', 'show', 'restore', 'prune', '--session', '--path', '--limit', '--json', '--target', '--force', '--days', '--dry-run'] },
      { name: 'pd salvage', href: '/docs/cli/salvage', description: 'List stale/dead agents waiting for recovery.', aliases: ['pd resurrection'], flags: ['--project', '--stack', '--all', '--limit', '--summary'] },
      { name: 'pd salvage claim <agent>', href: '/docs/cli/salvage-claim', description: 'Claim a dead agent work record and retrieve its context.' },
      { name: 'pd salvage complete|abandon|dismiss', description: 'Resolve, return, or remove a salvage record after review.' },
    ],
  },
  {
    title: 'Messaging, Tube, Inbox, Tuples, Webhooks, And Tunnels',
    description: 'Move events between agents, local tools, editors, browsers, hooks, and external adapters.',
    source: 'cli/commands/messaging.ts, cli/commands/tube.ts, cli/commands/inbox.ts, cli/commands/tuples.ts, cli/commands/webhooks.ts, cli/commands/tunnel.ts',
    items: [
      { name: 'pd pub <channel> <message>', href: '/docs/cli/pub', description: 'Publish to a worktree-aware channel.', aliases: ['pd publish', 'pd broadcast'], flags: ['--sender', '--dir', '--raw-channel'] },
      { name: 'pd sub <channel>', description: 'Subscribe to a channel as an SSE stream.', aliases: ['pd subscribe', 'pd listen'], flags: ['--dir', '--raw-channel'] },
      { name: 'pd channels', description: 'List, discover, ensure, describe, or clear channels.', flags: ['discover', 'ensure', 'describe', 'clear', '--dir', '--observed', '--scope', '--aliases'] },
      { name: 'pd watch <channel>', href: '/docs/cli/watch', description: 'Subscribe to a channel and optionally run a command for each message.', flags: ['--exec', '--once', '--dir', '--raw-channel'] },
      { name: 'pd tube <channel>', description: 'Relay-independent conversational pipe over a Port Daddy channel with block-once handoffs and threaded replies.', flags: ['--send', '--reply', '--reply-to', '--since', '--once', '--tail', '--wait-for', '--no-history', '--limit', '--sender', '--json', '--raw', '--quiet'] },
      { name: 'pd inbox <command>', description: 'Read, send, mark, and clear durable direct messages for agents.' },
      { name: 'pd tuple <command>', description: 'Linda-style tuple space: out, rd/read, in/take, scan, and count.', flags: ['--harbor', '--ttl', '--as', '--limit'] },
      { name: 'pd webhook <command>', description: 'Create, list, inspect, update, remove, test, and read deliveries for webhook subscriptions.', aliases: ['pd webhooks'] },
      { name: 'pd tunnel <identity>', href: '/docs/cli/tunnel', description: 'Expose a local service through an available tunnel provider.', flags: ['--provider', '--harbor'] },
      { name: 'pd tunnel stop <identity>', href: '/docs/cli/tunnel-stop', description: 'Stop a running tunnel for a service.' },
    ],
  },
  {
    title: 'Agents, Actors, Fleets, And Spawn Control',
    description: 'Launch work, inspect bodies, talk to durable role actors, and run declarative fleets with budget gates.',
    source: 'cli/commands/agents.ts, cli/commands/actors.ts, cli/commands/spawn.ts, cli/commands/fleet.ts, cli/commands/quorum.ts',
    items: [
      { name: 'pd agent register', href: '/docs/cli/agent-register', description: 'Register this process as an agent.', flags: ['--agent', '--identity', '--purpose', '--type', '--skills', '--worktree'] },
      { name: 'pd agent heartbeat|unregister|inbox|<id>', description: 'Maintain agent liveness, inspect one agent, or use direct inbox commands.' },
      { name: 'pd agents', description: 'List registered agents.', aliases: ['pd swarm'], flags: ['--active', '--json'] },
      { name: 'pd actors', description: 'List durable maritime actors and live/salvage lease evidence.' },
      { name: 'pd actor <id>', description: 'Inspect or message a durable actor mailbox.', flags: ['--project', '--message', '--inbox', '--inbox-stats', '--unread', '--mark-read', '--wake'] },
      { name: 'pd spawn <task>', href: '/docs/cli/spawn', description: 'Launch a spawned agent with backend, model, identity, and required budget ceiling.', flags: ['--backend', '--model', '--tier', '--identity', '--budget', '--purpose', '--files', '--workdir', '--timeout'] },
      { name: 'pd spawn cancel <agent>', description: 'Cancel a running spawn and retain its evidence.' },
      { name: 'pd spawned', href: '/docs/cli/spawned', description: 'List active or recent spawned agents.' },
      { name: 'pd fleet init|up|down|status|validate|run', href: '/docs/cli/fleet', description: 'Create, validate, run, and inspect YAML-defined background agent fleets.' },
      { name: 'pd fleet panic|unpanic', description: 'Arm or disarm the fleet panic control with an audited reason.' },
      { name: 'pd shipwright survey', description: 'Survey the current project into a structured Shipwright intake record for app-native fleet planning.', flags: ['--root', '--llm', '--model', '--json', '--quiet'] },
      { name: 'pd cockpit missions', description: 'Read app-native development cockpit mission cards from roadmap and recovery truth.', flags: ['--project', '--status', '--limit', '--json'] },
      { name: 'pd quorum <command>', description: 'Run quorum-oriented coordination checks and summaries.' },
    ],
  },
  {
    title: 'Governance, Scope, Semantics, And Signal Layers',
    description: 'Coordinate scarce surfaces, protected work areas, budgets, bonds, roadmap memory, and low-friction signals.',
    source: 'cli/commands/advisor.ts, cli/commands/guard.ts, cli/commands/harbors.ts, cli/commands/wallet.ts, cli/commands/bond.ts, cli/commands/semantic.ts, cli/commands/ideas.ts, cli/commands/roadmap.ts, cli/commands/feedback.ts, cli/commands/pheromone.ts',
    items: [
      { name: 'pd advise [files...]', description: 'Run deterministic coordination preflight before edits.', aliases: ['pd preflight', 'pd compass'], flags: ['--task', '--session', '--agent', '--dir', '--channels', '--tuples', '--json'] },
      { name: 'pd guard <command>', description: 'Install, enable, disable, status-check, or enforce session plus file-claim discipline.', flags: ['status', 'check', 'enable', 'disable', 'install', '--staged', '--mode'] },
      { name: 'pd add [path...]', description: 'Stage files through the claim-aware git add wrapper so another active session does not get captured by accident.', flags: ['-A', '--all', '--dry-run', '--force', '--json', '--dir', '--quiet'] },
      { name: 'pd lock <name>', href: '/docs/cli/lock-acquire', description: 'Acquire a distributed lock with optional wait and TTL.', flags: ['--ttl', '--owner', '--wait', '--timeout'] },
      { name: 'pd unlock <name>', href: '/docs/cli/lock-release', description: 'Release a lock.', flags: ['--force'] },
      { name: 'pd locks', description: 'List active locks.' },
      { name: 'pd with-lock <name> -- <cmd>', href: '/docs/cli/with-lock', description: 'Run a command while Port Daddy acquires and releases a lock around it.' },
      { name: 'pd harbor create|enter|leave|show|destroy', href: '/docs/cli/harbor-create', description: 'Manage named permission namespaces and capability tokens.' },
      { name: 'pd harbors', href: '/docs/cli/harbors', description: 'List harbors and memberships.' },
      { name: 'pd wallet <command>', description: 'Show wallets, top up funds, inspect history, set daily budgets, list pending budget cancellations, and raise budgets.' },
      { name: 'pd bond <command>', description: 'List bond escrow rows or manually slash a bond with a reason.' },
      { name: 'pd graph edges|stats', description: 'Inspect semantic graph edges and aggregate graph counts.' },
      { name: 'pd memory episodes|stats', description: 'Inspect episodic memory entries and aggregate memory counts.' },
      { name: 'pd ideas list|search|show', description: 'Search curated ideas, local residue, notes, tuples, and repo markdown.' },
      { name: 'pd roadmap', href: '/docs/cli/roadmap', description: 'Print Cartographer curated next cuts, now items, dogfood feedback, and roadmap excerpts.' },
      { name: 'pd feedback <command>', description: 'Drop or summarize structured agentic feedback for Cartographer.' },
      { name: 'pd pheromone <command>', description: 'Spray, read, list, or map numeric coordination signals over files and entities.', aliases: ['pd ph'] },
      { name: 'pd who-owns <path>', description: 'Inspect current file ownership and claims for one path.' },
    ],
  },
]

export const CLI_REFERENCE_ITEMS: CliReferenceItem[] = CLI_REFERENCE_GROUPS.flatMap((group) =>
  group.items.map((item) => {
    const href = cliCommandHref(item)
    const slug = cliCommandSlug(item)
    const aliasRoutes = (item.aliases ?? []).map((alias) => ({
      name: alias,
      href: cliCommandHref(alias),
      slug: cliCommandSlug(alias),
    }))

    return {
      ...item,
      href,
      slug,
      groupTitle: group.title,
      groupDescription: group.description,
      groupSource: item.source ?? group.source,
      generated: !item.href,
      aliasRoutes,
    }
  }),
)

export function findCliReferenceItemBySlug(slug: string): CliReferenceItem | undefined {
  const normalizedSlug = slug.replace(/^\/+|\/+$/g, '')

  return CLI_REFERENCE_ITEMS.find((item) =>
    item.slug === normalizedSlug || item.aliasRoutes.some((alias) => alias.slug === normalizedSlug),
  )
}

export const CLI_COMMAND_TOTAL = CLI_REFERENCE_GROUPS.reduce((sum, group) => sum + group.items.length, 0)
export const CLI_ALIAS_TOTAL = CLI_REFERENCE_GROUPS.reduce(
  (sum, group) => sum + group.items.reduce((inner, item) => inner + (item.aliases?.length ?? 0), 0),
  0,
)

export const SDK_REFERENCE_GROUPS: ReferenceGroup[] = [
  {
    title: 'Connection',
    description: 'Constructor options, daemon reachability, and IPC lifecycle.',
    source: 'lib/client.ts, shared/types.ts',
    items: [
      { name: 'new PortDaddy(options)', description: 'Create a daemon client using auto-discovered Unix socket or TCP URL.', flags: ['url', 'socketPath', 'agentId', 'pid', 'timeout'] },
      { name: 'ping', description: 'Return true when the daemon is reachable.' },
      { name: 'destroyIpc', description: 'Close the SDK binary IPC client.' },
    ],
  },
  {
    title: 'Services And Ports',
    description: 'Claim ports, inspect services, wait for health, and clean stale assignments.',
    href: '/docs/sdk/ports',
    source: 'lib/client.ts service and port methods',
    items: [
      { name: 'claim', description: 'Claim a deterministic port for an identity.' },
      { name: 'release', description: 'Release a service identity or pattern.' },
      { name: 'getService', description: 'Read detail for one service.' },
      { name: 'listServices', description: 'List services by pattern, status, or port.' },
      { name: 'setEndpoint', description: 'Attach an environment endpoint URL to a service.' },
      { name: 'waitForService', description: 'Wait for one service to become healthy.' },
      { name: 'waitForServices', description: 'Wait for several services to become healthy.' },
      { name: 'checkServiceHealth', description: 'Check health for one service.' },
      { name: 'listServiceHealth', description: 'Check all registered services.' },
      { name: 'listActivePorts', description: 'List active raw port assignments.' },
      { name: 'getSystemPorts', description: 'List system or well-known port usage.' },
      { name: 'cleanup', description: 'Release stale port assignments.' },
    ],
  },
  {
    title: 'Messaging And Channels',
    description: 'Publish, poll, subscribe, discover, and resolve worktree-scoped channels.',
    href: '/docs/sdk/subscribe',
    source: 'lib/client.ts messaging methods',
    items: [
      { name: 'publish', description: 'Publish a payload to a channel.' },
      { name: 'getMessages', description: 'Read channel messages with limit/after options.' },
      { name: 'listChannels', description: 'List active channels.' },
      { name: 'discoverChannels', description: 'Discover declared and observed channels for a project.' },
      { name: 'resolveChannel', description: 'Resolve a logical or alias channel to the physical scoped channel.' },
      { name: 'ensureChannel', description: 'Declare or update a canonical channel.' },
      { name: 'poll', description: 'Long-poll for the next message.' },
      { name: 'subscribe', description: 'Subscribe via SSE and event handlers.' },
      { name: 'clearChannel', description: 'Clear messages from a channel.' },
    ],
  },
  {
    title: 'Locks',
    description: 'Coordinate scarce resources with TTL-backed locks.',
    href: '/docs/sdk/locks',
    source: 'lib/client.ts lock methods',
    items: [
      { name: 'lock', description: 'Acquire a lock.' },
      { name: 'unlock', description: 'Release a lock.' },
      { name: 'checkLock', description: 'Inspect one lock.' },
      { name: 'extendLock', description: 'Extend a lock TTL.' },
      { name: 'listLocks', description: 'List locks.' },
      { name: 'lockWithRetry', description: 'Retry lock acquisition until available or timeout.' },
    ],
  },
  {
    title: 'Agents, Sessions, Notes, And Recovery',
    description: 'Register agents, run the session ledger, claim files, and salvage interrupted work.',
    href: '/docs/sdk/sessions',
    source: 'lib/client.ts agent, session, note, and salvage methods',
    items: [
      { name: 'register', description: 'Register this client as an agent.' },
      { name: 'heartbeat', description: 'Send one heartbeat.' },
      { name: 'startHeartbeat', description: 'Start periodic heartbeats.' },
      { name: 'unregister', description: 'Unregister this client.' },
      { name: 'getAgent', description: 'Read one agent record.' },
      { name: 'listAgents', description: 'List agents.' },
      { name: 'startSession', description: 'Start a coordination session.' },
      { name: 'endSession', description: 'End a session.' },
      { name: 'abandonSession', description: 'Abandon a session.' },
      { name: 'removeSession', description: 'Delete a session.' },
      { name: 'note', description: 'Append a note.' },
      { name: 'notes', description: 'Read notes.' },
      { name: 'sessions', description: 'List sessions.' },
      { name: 'sessionDetails', description: 'Read one session in detail.' },
      { name: 'claimFiles', description: 'Claim files or regions for a session.' },
      { name: 'releaseFiles', description: 'Release file claims.' },
      { name: 'setSessionPhase', description: 'Set a session phase.' },
      { name: 'listFileClaims', description: 'List file claims.' },
      { name: 'whoOwnsFile', description: 'Inspect owners for a path.' },
      { name: 'begin', description: 'Sugar: register agent and start session atomically.' },
      { name: 'done', description: 'Sugar: close session and unregister atomically.' },
      { name: 'whoami', description: 'Sugar: show current agent/session context.' },
      { name: 'salvage', description: 'List salvage queue records.' },
      { name: 'salvageClaim', description: 'Claim dead agent work.' },
      { name: 'salvageComplete', description: 'Mark salvage complete.' },
      { name: 'salvageAbandon', description: 'Return claimed work to queue.' },
      { name: 'salvageDismiss', description: 'Dismiss reviewed salvage work.' },
    ],
  },
  {
    title: 'Actors And Inbox',
    description: 'Talk to durable maritime actors and direct agent inboxes.',
    source: 'lib/client.ts actor and inbox methods',
    items: [
      { name: 'listActors', description: 'List actor projections.' },
      { name: 'getActor', description: 'Read one actor by id or alias.' },
      { name: 'messageActor', description: 'Queue a message to a durable actor mailbox.' },
      { name: 'actorInboxList', description: 'Read actor mailbox messages.' },
      { name: 'actorInboxStats', description: 'Read actor mailbox counts.' },
      { name: 'inboxSend', description: 'Send a direct message to an agent.' },
      { name: 'inboxList', description: 'Read an agent inbox.' },
      { name: 'inboxStats', description: 'Read agent inbox counts.' },
      { name: 'inboxMarkRead', description: 'Mark one inbox message read.' },
      { name: 'inboxMarkAllRead', description: 'Mark all inbox messages read.' },
      { name: 'inboxClear', description: 'Clear an inbox.' },
      { name: 'inboxSubscribe', description: 'Subscribe to inbox messages.' },
    ],
  },
  {
    title: 'Spawn, Fleets, And Orchestration',
    description: 'Launch backend runs and start or stop service stacks.',
    href: '/docs/sdk/spawn',
    source: 'lib/client.ts spawn and orchestration methods',
    items: [
      { name: 'spawn', description: 'Launch a run with backend, identity, model, and budget.' },
      { name: 'listSpawned', description: 'List spawned agents.' },
      { name: 'cancelSpawned', description: 'Cancel a spawned agent.' },
      { name: 'cockpitMissions', description: 'Read typed cockpit mission cards from roadmap and recovery truth without mutating state.' },
      { name: 'up', description: 'Start configured services.' },
      { name: 'down', description: 'Stop configured services.' },
    ],
  },
  {
    title: 'Projects, Briefing, And Integration Signals',
    description: 'Detect projects, generate briefings, and publish ready/needs signals.',
    source: 'lib/client.ts project, briefing, and integration methods',
    items: [
      { name: 'scan', description: 'Scan a project directory.' },
      { name: 'listProjects', description: 'List projects.' },
      { name: 'getProject', description: 'Read one project.' },
      { name: 'deleteProject', description: 'Delete a project record.' },
      { name: 'integrationReady', description: 'Publish a ready signal.' },
      { name: 'integrationNeeds', description: 'Publish a needs signal.' },
      { name: 'generateBriefing', description: 'Generate `.portdaddy/briefing` files.' },
      { name: 'getBriefing', description: 'Read briefing content.' },
    ],
  },
  {
    title: 'Webhooks',
    description: 'Manage webhook subscriptions and delivery logs.',
    source: 'lib/client.ts webhook methods',
    items: [
      { name: 'addWebhook', description: 'Create a webhook.' },
      { name: 'listWebhooks', description: 'List webhooks.' },
      { name: 'getWebhook', description: 'Read one webhook.' },
      { name: 'updateWebhook', description: 'Update webhook config.' },
      { name: 'removeWebhook', description: 'Delete a webhook.' },
      { name: 'testWebhook', description: 'Send a test delivery.' },
      { name: 'getWebhookDeliveries', description: 'Read delivery records.' },
      { name: 'getWebhookEvents', description: 'List webhook event names.' },
    ],
  },
  {
    title: 'System And Activity',
    description: 'Read daemon health, config, metrics, and audit activity.',
    href: '/docs/sdk/status',
    source: 'lib/client.ts system and activity methods',
    items: [
      { name: 'health', description: 'Read daemon health.' },
      { name: 'version', description: 'Read version and code hash.' },
      { name: 'metrics', description: 'Read daemon metrics.' },
      { name: 'getConfig', description: 'Read resolved configuration.' },
      { name: 'getActivity', description: 'Read activity log entries.' },
      { name: 'getActivityRange', description: 'Read activity over a time range.' },
      { name: 'getActivitySummary', description: 'Summarize activity since a timestamp.' },
      { name: 'getActivityStats', description: 'Read aggregate activity stats.' },
    ],
  },
  {
    title: 'Changelog',
    description: 'Write and query per-agent, per-session, and per-identity changelog records.',
    source: 'lib/client.ts changelog methods',
    items: [
      { name: 'addChangelog', description: 'Add a changelog entry.' },
      { name: 'listChangelog', description: 'List changelog entries.' },
      { name: 'getChangelog', description: 'Read one changelog entry.' },
      { name: 'listChangelogByIdentity', description: 'List entries for an identity.' },
      { name: 'listChangelogTree', description: 'List identity tree entries.' },
      { name: 'listChangelogBySession', description: 'List entries for a session.' },
      { name: 'listChangelogByAgent', description: 'List entries for an agent.' },
      { name: 'changelogIdentities', description: 'List identities with changelog entries.' },
    ],
  },
  {
    title: 'DNS And Tunnels',
    description: 'Manage local DNS records and public tunnel lifecycle.',
    href: '/docs/sdk/dns-register',
    source: 'lib/client.ts DNS and tunnel methods',
    items: [
      { name: 'dnsRegister', description: 'Register a DNS record.' },
      { name: 'dnsUnregister', description: 'Remove a DNS record.' },
      { name: 'dnsList', description: 'List DNS records.' },
      { name: 'dnsGet', description: 'Resolve one DNS record.' },
      { name: 'dnsCleanup', description: 'Clean stale records.' },
      { name: 'dnsStatus', description: 'Read DNS status.' },
      { name: 'dnsSetup', description: 'Install/setup local resolver support.' },
      { name: 'dnsTeardown', description: 'Remove resolver support.' },
      { name: 'dnsSync', description: 'Sync records.' },
      { name: 'dnsResolverStatus', description: 'Read resolver status.' },
      { name: 'dnsRemove', description: 'Alias-compatible DNS removal.' },
      { name: 'dnsResolver', description: 'Alias-compatible resolver status.' },
      { name: 'tunnelStart', description: 'Start a tunnel for a service.' },
      { name: 'tunnelStop', description: 'Stop a tunnel.' },
      { name: 'tunnelStatus', description: 'Read tunnel status.' },
      { name: 'tunnelList', description: 'List tunnels.' },
      { name: 'tunnelProviders', description: 'List available tunnel providers.' },
    ],
  },
  {
    title: 'Harbors, Wallets, Bonds, And Panic',
    description: 'Manage protected scopes, admission cards, project wallets, bond escrow, and panic state.',
    href: '/docs/sdk/harbors',
    source: 'lib/client.ts harbor, wallet, bond, and panic methods',
    items: [
      { name: 'createHarbor', description: 'Create a harbor.' },
      { name: 'listHarbors', description: 'List harbors.' },
      { name: 'getHarbor', description: 'Read one harbor.' },
      { name: 'destroyHarbor', description: 'Destroy a harbor.' },
      { name: 'enterHarbor', description: 'Enter a harbor as an agent.' },
      { name: 'leaveHarbor', description: 'Leave a harbor.' },
      { name: 'harborMemberships', description: 'List harbors for an agent.' },
      { name: 'listBonds', description: 'List bond escrow records.' },
      { name: 'getBond', description: 'Read one bond.' },
      { name: 'slashBond', description: 'Manually slash a bond.' },
      { name: 'listWallets', description: 'List project wallets.' },
      { name: 'getWallet', description: 'Read one wallet.' },
      { name: 'topUpWallet', description: 'Credit a project wallet.' },
      { name: 'getPanicStatus', description: 'Read fleet panic status.' },
      { name: 'armPanic', description: 'Arm panic with a reason and optional confirmation.' },
      { name: 'disarmPanic', description: 'Disarm panic with a reason.' },
    ],
  },
  {
    title: 'Pheromones, Arbiter, And Tuple Space',
    description: 'Read coordination heat, inspect invariants, and share structured tuple facts.',
    source: 'lib/client.ts pheromone, arbiter, and tuple methods',
    items: [
      { name: 'pheromoneSpray', description: 'Spray a numeric signal onto an entity.' },
      { name: 'pheromoneSniff', description: 'Read signals for one entity.' },
      { name: 'pheromoneList', description: 'List non-zero trails.' },
      { name: 'fileHeatMap', description: 'Read file heat from claims and pheromones.' },
      { name: 'arbiterStatus', description: 'Read Arbiter status.' },
      { name: 'arbiterViolations', description: 'List invariant violations.' },
      { name: 'arbiterTestInvariant', description: 'Inject a test invariant violation.' },
      { name: 'tupleOut', description: 'Write a tuple.' },
      { name: 'tupleRd', description: 'Read matching tuples.' },
      { name: 'tupleIn', description: 'Take matching tuples.' },
      { name: 'tuplePoll', description: 'Poll for tuple matches.' },
      { name: 'tupleScan', description: 'List tuples.' },
      { name: 'tupleCount', description: 'Count tuples.' },
    ],
  },
]

export const SDK_METHOD_TOTAL = SDK_REFERENCE_GROUPS.reduce((sum, group) => sum + group.items.length, 0)
