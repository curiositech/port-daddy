export type MethodColor = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface CliCommand {
  cmd: string
  short?: string
  description: string
  flags?: string[]
  example: string
  output?: string
  group: string
}

export interface Endpoint {
  method: MethodColor
  path: string
  description: string
  group: string
}

export interface CapabilityScope {
  scope: string
  desc: string
}

export const METHOD_COLORS: Record<MethodColor, { bg: string; text: string }> = {
  GET:    { bg: 'var(--badge-green-bg)',   text: 'var(--badge-green-text)' },
  POST:   { bg: 'var(--badge-teal-bg)',  text: 'var(--badge-teal-text)' },
  PUT:    { bg: 'var(--badge-amber-bg)',  text: 'var(--badge-amber-text)' },
  DELETE: { bg: 'rgba(239, 68, 68, 0.12)',   text: 'var(--p-red-500)' },
  PATCH:  { bg: 'rgba(167, 139, 250, 0.12)', text: '#a78bfa' },
}

export const CLI_COMMANDS: CliCommand[] = [
  // Ports
  {
    group: 'Ports',
    cmd: 'pd claim <identity>',
    description: 'Claim a port for a service. Identity uses project:stack:context format. Returns the same port on repeat calls (idempotent).',
    flags: ['--quiet, -q   Output port number only', '--json, -j    Output full JSON'],
    example: 'pd claim myapp:api:main',
    output: 'Port 3001 assigned to myapp:api:main',
  },
  {
    group: 'Ports',
    cmd: 'pd release <identity>',
    description: 'Release a port claim. Safe to call even if the port is not claimed.',
    example: 'pd release myapp:api:main',
    output: 'Released myapp:api:main (port 3001)',
  },
  {
    group: 'Ports',
    cmd: 'pd find <identity>',
    description: 'Look up the port assigned to an identity without claiming a new one.',
    flags: ['--quiet, -q   Output port number only'],
    example: 'pd find myapp:api:main',
    output: '3001',
  },
  {
    group: 'Ports',
    cmd: 'pd services',
    description: 'List all active port claims. Shows identity, port, and last-seen timestamp.',
    flags: ['--json, -j    JSON output'],
    example: 'pd services',
    output: 'myapp:api:main       3001   5s ago\nmyapp:frontend:main  3000   2s ago',
  },
  {
    group: 'Ports',
    cmd: 'pd status',
    description: 'Daemon status: uptime, port count, SQLite path, and code hash.',
    example: 'pd status',
    output: '[pd] Port Daddy v3.13.0 — 3 services, uptime 4h 12m',
  },
  {
    group: 'Ports',
    cmd: 'pd scan [dir]',
    description: 'Deep-scan a directory for services. Detects 60+ frameworks and assigns ports. Registers all found services.',
    flags: ['--json, -j    Output JSON with full detection details'],
    example: 'pd scan ./services',
    output: 'Found 4 services:\n  myapp:api        → 3001  (express)\n  myapp:frontend   → 3000  (vite)\n  myapp:jobs       → 3002  (bullmq)\n  myapp:db-admin   → 3003  (adminer)',
  },
  {
    group: 'Ports',
    cmd: 'pd up',
    description: 'Start all registered services in the current project. Uses the detected start commands.',
    example: 'pd up',
    output: 'Starting 4 services...\n  ✓ myapp:api      (port 3001)\n  ✓ myapp:frontend (port 3000)',
  },
  {
    group: 'Ports',
    cmd: 'pd down',
    short: 'd',
    description: 'Stop all running services in the current project.',
    example: 'pd down',
    output: 'Stopped 4 services',
  },
  // Sessions
  {
    group: 'Sessions',
    cmd: 'pd begin',
    description: 'Start a session and register as an agent in one command. Writes slot-scoped local context under .portdaddy/contexts/ and updates .portdaddy/current.json as a compatibility pointer. The recommended way to start any coordinated work.',
    flags: [
      '--lifecycle <mode> Required: durable or ephemeral',
      '--identity <id>    Semantic identity for this agent (project:stack:context)',
      '--purpose <text>   What this agent is working on',
    ],
    example: 'pd begin --identity myapp:api --purpose "Fix auth bug" --lifecycle durable',
    output: '[pd] Session abc123 started · Agent myapp:api registered\n[pd] 2 dead agents in myapp:* — run: pd salvage --project myapp',
  },
  {
    group: 'Sessions',
    cmd: 'pd done',
    description: 'End the current session and unregister agent. Reads session ID from the current slot-scoped local context. Marks session as completed.',
    flags: ['--session <id>   Explicit session ID (skips local context lookup)'],
    example: 'pd done',
    output: '[pd] Session abc123 marked completed · Agent deregistered',
  },
  {
    group: 'Sessions',
    cmd: 'pd whoami',
    description: 'Show the current agent identity and session from the current slot-scoped local context.',
    example: 'pd whoami',
    output: 'Agent:   myapp:api\nSession: abc123\nPurpose: Fix auth bug\nStarted: 23m ago',
  },
  {
    group: 'Sessions',
    cmd: 'pd note <text>',
    short: 'n',
    description: 'Add a note to the current session. Notes are immutable — they are never edited or deleted. If scope is ambiguous, pass --session or --agent instead of relying on implicit targeting.',
    flags: ['--type <type>   Note type: progress | decision | milestone | warning (default: progress)'],
    example: 'pd note "Auth middleware updated — JWT shape changed" --type milestone',
    output: 'Note added to session abc123',
  },
  {
    group: 'Sessions',
    cmd: 'pd notes',
    description: 'Show recent notes. Without flags shows the last 10 notes across all sessions.',
    flags: [
      '--session <id>   Notes for a specific session',
      '--limit <n>      Number of notes to show (default 10)',
    ],
    example: 'pd notes --limit 5',
    output: '[milestone] Auth middleware updated — JWT shape changed   1m ago\n[progress]  Started JWT refactor                                  5m ago',
  },
  // Locks
  {
    group: 'Locks',
    cmd: 'pd lock acquire <name>',
    description: 'Acquire a distributed lock. Only one holder at a time. Returns immediately if lock is already held (non-blocking by default).',
    flags: [
      '--ttl <ms>        Lock timeout in ms (default 300000 = 5min)',
      '--wait            Block until lock becomes available',
    ],
    example: 'pd lock acquire db-migration --ttl 60000',
    output: 'Lock acquired: db-migration (expires in 60s)',
  },
  {
    group: 'Locks',
    cmd: 'pd lock release <name>',
    description: 'Release a distributed lock.',
    example: 'pd lock release db-migration',
    output: 'Lock released: db-migration',
  },
  {
    group: 'Locks',
    cmd: 'pd with-lock <name> -- <command>',
    description: 'Run a command inside a lock. Acquires lock, runs command, releases lock — even if the command fails.',
    example: 'pd with-lock db-migration -- npm run migrate',
    output: 'Acquired db-migration\n> npm run migrate\n  Migrating... done (3 migrations)\nReleased db-migration',
  },
  // Messaging
  {
    group: 'Messaging',
    cmd: 'pd msg <channel> publish <payload>',
    description: 'Publish a message to a pub/sub channel. All subscribers receive it.',
    example: "pd msg build:done publish '{\"sha\": \"abc123\"}'",
    output: 'Published to build:done',
  },
  {
    group: 'Messaging',
    cmd: 'pd msg <channel> get',
    description: 'Get all messages currently in a channel.',
    flags: ['--limit <n>   Max messages to return'],
    example: 'pd msg build:done get',
    output: '[{"sha":"abc123","timestamp":"2026-03-10T..."}]',
  },
  {
    group: 'Messaging',
    cmd: 'pd watch <channel>',
    description: 'Subscribe to a channel and run a script on every message. Uses SSE for real-time delivery. Auto-reconnects on disconnect. This is the "always-on agent" primitive.',
    flags: [
      '--exec <script>   Script to run on each message',
      '--once            Stop after the first message',
    ],
    example: 'pd watch build:done --exec ./scripts/deploy.sh',
    output: 'Watching build:done...\n  → Message received: {"sha":"abc123"}\n  → Running ./scripts/deploy.sh\n  → Exit 0',
  },
  {
    group: 'Messaging',
    cmd: 'pd tube <channel>',
    description: 'Open a durable conversation pipe over a message channel. Listen as a block-once prose handoff, send from stdin, reply by message id, and resume from an explicit cursor.',
    flags: [
      '--send           Read stdin and publish a top-level tube message',
      '--reply <body>   Reply inline to the most recent foreign event',
      '--reply-to <id>  Read stdin and publish a threaded reply',
      '--once           Perform one read pass and exit',
      '--tail           Keep polling for humans watching a terminal',
      '--wait-for <sec> Block for the first event before timing out',
      '--since <id>     Emit only messages after this id',
      '--json           Emit JSON lines',
      '--no-history     Do not read or update the local cursor file',
    ],
    example: 'printf "ready" | pd tube myapp:handoff --send --sender qa',
    output: 'tube: posted id=42 to myapp:handoff',
  },
  // Agents
  {
    group: 'Agents',
    cmd: 'pd spawn',
    description: 'Launch an AI agent with Port Daddy coordination pre-wired. The agent auto-registers, sends heartbeats, writes notes, and gets salvaged if it crashes.',
    flags: [
      '--backend <type>      AI backend: claude-cli | codex | cloudflare | claude | ollama | gemini | aider | custom. claude-cli and codex ride your Claude Max / ChatGPT Pro at $0 marginal.',
      "--model <name>        Model override (e.g. '@cf/zai-org/glm-4.7-flash', claude-haiku-4-5)",
      '--identity <id>       Semantic identity for this agent',
      '--purpose <text>      What this agent should do',
      '--harbor <name>       Run agent inside a harbor (scoped permissions)',
      '-- <prompt>           Prompt to send (last argument)',
    ],
    example: 'pd spawn --backend claude-cli \\\n  --identity myapp:reviewer \\\n  -- "Review src/auth/ for security vulnerabilities"',
    output: '[pd] Spawned agent myapp:reviewer (session def456)\n[pd] Backend: claude-cli · ride: your Claude Max seat · marginal: $0.00\n[pd] Running...',
  },
  {
    group: 'Agents',
    cmd: 'pd spawned',
    description: 'List all currently running spawned agents.',
    flags: ['--json, -j   JSON output'],
    example: 'pd spawned',
    output: 'myapp:reviewer   claude/claude-haiku-4-5   running   2m 14s',
  },
  {
    group: 'Agents',
    cmd: 'pd agent register',
    description: 'Register this process as an agent. Used by spawned agents internally, but also callable directly.',
    flags: [
      '--agent <id>       Agent ID (UUID recommended)',
      '--identity <id>    Semantic identity',
      '--purpose <text>   What this agent is doing',
    ],
    example: 'pd agent register --agent agent-001 --identity myapp:coder',
    output: '[pd] Agent agent-001 registered\n[pd] ⚠ 1 dead agent in myapp:* — run: pd salvage',
  },
  {
    group: 'Agents',
    cmd: 'pd salvage',
    description: 'Show agents in the resurrection queue — agents that died mid-task with active sessions. Allows a new agent to claim their work and continue.',
    flags: [
      '--project <name>   Filter by project identity prefix',
      '--json, -j         JSON output',
    ],
    example: 'pd salvage',
    output: 'SALVAGE QUEUE (2 agents)\n  agent-001  myapp:coder   died 8m ago   "Fix auth bug"\n  agent-002  myapp:tester  died 3m ago   "Run test suite"',
  },
  {
    group: 'Agents',
    cmd: 'pd salvage claim <agentId>',
    description: 'Claim a dead agent\'s work. Returns the full context: session ID, notes, file claims, and purpose.',
    example: 'pd salvage claim agent-001',
    output: 'Claimed agent-001\n  Session: abc123\n  Notes: 3 notes\n  Files: src/auth/login.ts (claimed)\n  Purpose: Fix auth bug',
  },
  // DNS
  {
    group: 'DNS',
    cmd: 'pd dns register <name> <port>',
    description: 'Register a human-readable name → port mapping. Other agents can resolve names instead of hardcoding ports.',
    example: 'pd dns register myapp-api 3001',
    output: 'DNS registered: myapp-api → 3001',
  },
  {
    group: 'DNS',
    cmd: 'pd dns lookup <name>',
    description: 'Resolve a name to a port number.',
    flags: ['--quiet, -q   Output port number only'],
    example: 'pd dns lookup myapp-api',
    output: '3001',
  },
  // Harbors
  {
    group: 'Harbors',
    cmd: 'pd harbor create <name>',
    description: 'Create a permission namespace for a group of agents. Agents inside a harbor receive a signed JWT that proves what they are allowed to do.',
    flags: [
      '--cap <scopes>    Comma-separated capability scopes',
      '--ttl <duration>  Token TTL (e.g. 2h, 30m). Default 2h',
    ],
    example: 'pd harbor create myapp:security-review \\\n  --cap "code:read,notes:write,tunnel:create" \\\n  --ttl 2h',
    output: 'Harbor created: myapp:security-review\n  Capabilities: code:read, notes:write, tunnel:create\n  Token TTL: 2h',
  },
  {
    group: 'Harbors',
    cmd: 'pd harbor enter <name>',
    description: 'Enter a harbor. Returns a signed JWT capability token. Pass this token to spawned agents or include it in API requests.',
    example: 'pd harbor enter myapp:security-review',
    output: 'Entered harbor: myapp:security-review\nToken: eyJhbGciOiJIUzI1NiJ9... (expires 2026-03-10T16:00:00Z)',
  },
  {
    group: 'Harbors',
    cmd: 'pd harbor leave <name>',
    description: 'Leave a harbor. Burns the JTI identifier so the token cannot be reused.',
    example: 'pd harbor leave myapp:security-review',
    output: 'Left harbor: myapp:security-review (token revoked)',
  },
  {
    group: 'Harbors',
    cmd: 'pd harbors',
    description: 'List all active harbors and their capabilities.',
    flags: ['--json, -j   JSON output'],
    example: 'pd harbors',
    output: 'myapp:security-review   code:read,notes:write   3 agents   exp 1h 44m',
  },
  // Tunnels
  {
    group: 'Tunnels',
    cmd: 'pd tunnel <identity>',
    description: 'Start an ngrok/cloudflared tunnel for a service. The public URL is registered as a note for other agents to discover.',
    flags: ['--harbor <name>   Require tunnel:create capability in this harbor'],
    example: 'pd tunnel myapp:api:main',
    output: 'Tunnel started: myapp:api:main\n  Local:  http://localhost:3001\n  Public: https://abc123.ngrok.io',
  },
  {
    group: 'Tunnels',
    cmd: 'pd tunnel stop <identity>',
    description: 'Stop a running tunnel.',
    example: 'pd tunnel stop myapp:api:main',
    output: 'Tunnel stopped: myapp:api:main',
  },
]

export const CLI_GROUPS = [...new Set(CLI_COMMANDS.map(c => c.group))]

export const ENDPOINTS: Endpoint[] = [
  { method: 'POST',   path: '/claim/:id',              description: 'Claim a port for a service identity',          group: 'Ports' },
  { method: 'DELETE', path: '/release/:id',             description: 'Release a service port',                       group: 'Ports' },
  { method: 'GET',    path: '/services',                description: 'List all active service claims',               group: 'Ports' },
  { method: 'GET',    path: '/ports/active',            description: 'List raw port assignments',                    group: 'Ports' },
  { method: 'GET',    path: '/ports/system',            description: 'List well-known system ports',                 group: 'Ports' },
  { method: 'POST',   path: '/ports/cleanup',           description: 'Release stale/orphaned ports',                 group: 'Ports' },
  { method: 'POST',   path: '/sessions',                description: 'Start a new agent session',                    group: 'Sessions' },
  { method: 'GET',    path: '/sessions',                description: 'List all sessions',                            group: 'Sessions' },
  { method: 'GET',    path: '/sessions/:id',            description: 'Get session details',                          group: 'Sessions' },
  { method: 'PUT',    path: '/sessions/:id',            description: 'Update session (phase, status, purpose)',      group: 'Sessions' },
  { method: 'DELETE', path: '/sessions/:id',            description: 'Delete session (cascades to notes)',           group: 'Sessions' },
  { method: 'GET',    path: '/sessions/:id/notes',      description: 'Get all notes for a session',                  group: 'Sessions' },
  { method: 'POST',   path: '/sessions/:id/files',      description: 'Claim files in a session',                    group: 'Sessions' },
  { method: 'DELETE', path: '/sessions/:id/files',      description: 'Release file claims',                         group: 'Sessions' },
  { method: 'GET',    path: '/sessions/:id/files',      description: 'List claimed files',                          group: 'Sessions' },
  { method: 'POST',   path: '/notes',                   description: 'Canonical note write path',                   group: 'Sessions' },
  { method: 'POST',   path: '/sessions/:id/notes',      description: 'Compatibility alias for POST /notes with sessionId', group: 'Sessions' },
  { method: 'GET',    path: '/notes',                   description: 'Get recent notes',                            group: 'Sessions' },
  { method: 'POST',   path: '/sugar/begin',             description: 'Register agent + start session in one call',  group: 'Sessions' },
  { method: 'POST',   path: '/sugar/done',              description: 'End session + unregister agent in one call',  group: 'Sessions' },
  { method: 'GET',    path: '/sugar/whoami',            description: 'Get current agent identity and session',      group: 'Sessions' },
  { method: 'POST',   path: '/agents/:id',              description: 'Register an agent',                           group: 'Agents' },
  { method: 'DELETE', path: '/agents/:id',              description: 'Unregister an agent',                         group: 'Agents' },
  { method: 'PUT',    path: '/agents/:id/heartbeat',    description: 'Send agent heartbeat',                        group: 'Agents' },
  { method: 'POST',   path: '/spawn',                   description: 'Launch an AI agent (Ollama, Claude, Aider)',  group: 'Agents' },
  { method: 'GET',    path: '/spawn',                   description: 'List active spawned agents',                  group: 'Agents' },
  { method: 'DELETE', path: '/spawn/:agentId',          description: 'Kill a spawned agent',                        group: 'Agents' },
  { method: 'GET',    path: '/salvage',                 description: 'List resurrection queue',                     group: 'Salvage' },
  { method: 'GET',    path: '/salvage/pending',         description: 'Dead agents pending salvage',                 group: 'Salvage' },
  { method: 'POST',   path: '/salvage/claim/:agentId',  description: 'Claim dead agent\'s work',                   group: 'Salvage' },
  { method: 'POST',   path: '/salvage/complete/:agentId', description: 'Mark salvage complete',                    group: 'Salvage' },
  { method: 'DELETE', path: '/salvage/:agentId',        description: 'Dismiss agent from queue',                   group: 'Salvage' },
  { method: 'POST',   path: '/locks/:name',             description: 'Acquire a distributed lock',                  group: 'Locks' },
  { method: 'PUT',    path: '/locks/:name',             description: 'Extend lock TTL',                             group: 'Locks' },
  { method: 'DELETE', path: '/locks/:name',             description: 'Release a lock',                              group: 'Locks' },
  { method: 'GET',    path: '/locks',                   description: 'List all active locks',                       group: 'Locks' },
  { method: 'POST',   path: '/msg/:channel',            description: 'Publish message to channel',                  group: 'Messaging' },
  { method: 'GET',    path: '/msg/:channel',            description: 'Read messages from channel',                  group: 'Messaging' },
  { method: 'DELETE', path: '/msg/:channel',            description: 'Clear all messages in channel',              group: 'Messaging' },
  { method: 'GET',    path: '/channels',                description: 'List pub/sub channels',                       group: 'Messaging' },
  { method: 'GET',    path: '/subscribe/:channel',      description: 'SSE real-time subscription',                  group: 'Messaging' },
  { method: 'GET',    path: '/watch/:channel',          description: 'SSE stream for pd watch (exec-enabled)',     group: 'Messaging' },
  { method: 'POST',   path: '/dns',                     description: 'Register a DNS name → port mapping',         group: 'DNS' },
  { method: 'GET',    path: '/dns',                     description: 'List all DNS records',                        group: 'DNS' },
  { method: 'GET',    path: '/dns/:name',               description: 'Resolve a DNS name to port',                 group: 'DNS' },
  { method: 'DELETE', path: '/dns/:name',               description: 'Remove a DNS record',                        group: 'DNS' },
  { method: 'POST',   path: '/tunnel/:id',              description: 'Start tunnel for service',                   group: 'Tunnels' },
  { method: 'DELETE', path: '/tunnel/:id',              description: 'Stop tunnel for service',                    group: 'Tunnels' },
  { method: 'GET',    path: '/tunnel/:id',              description: 'Get tunnel status',                          group: 'Tunnels' },
  { method: 'GET',    path: '/tunnels',                 description: 'List all active tunnels',                    group: 'Tunnels' },
  { method: 'GET',    path: '/tunnel/providers',        description: 'Check available tunnel providers',           group: 'Tunnels' },
  { method: 'POST',   path: '/harbor',                  description: 'Create a harbor',                            group: 'Harbors' },
  { method: 'GET',    path: '/harbor',                  description: 'List all harbors',                           group: 'Harbors' },
  { method: 'GET',    path: '/harbor/:name',            description: 'Get harbor details and agents',              group: 'Harbors' },
  { method: 'DELETE', path: '/harbor/:name',            description: 'Delete a harbor',                            group: 'Harbors' },
  { method: 'POST',   path: '/harbor/:name/enter',      description: 'Enter harbor — returns capability token',    group: 'Harbors' },
  { method: 'POST',   path: '/harbor/:name/leave',      description: 'Leave harbor — burns token JTI',            group: 'Harbors' },
  { method: 'POST',   path: '/webhooks',                description: 'Create a webhook subscription',              group: 'Webhooks' },
  { method: 'GET',    path: '/webhooks',                description: 'List all webhooks',                          group: 'Webhooks' },
  { method: 'GET',    path: '/webhooks/events',         description: 'List available webhook events',              group: 'Webhooks' },
  { method: 'GET',    path: '/webhooks/:id',            description: 'Get webhook details',                        group: 'Webhooks' },
  { method: 'PUT',    path: '/webhooks/:id',            description: 'Update webhook',                             group: 'Webhooks' },
  { method: 'DELETE', path: '/webhooks/:id',            description: 'Delete webhook',                             group: 'Webhooks' },
  { method: 'POST',   path: '/webhooks/:id/test',       description: 'Send test delivery',                         group: 'Webhooks' },
  { method: 'GET',    path: '/health',                  description: 'Daemon health check',                        group: 'System' },
  { method: 'GET',    path: '/version',                 description: 'Version and code hash',                      group: 'System' },
  { method: 'GET',    path: '/metrics',                 description: 'Daemon performance metrics',                 group: 'System' },
  { method: 'GET',    path: '/config',                  description: 'Resolved configuration',                     group: 'System' },
  { method: 'GET',    path: '/activity',                description: 'Activity log',                               group: 'System' },
]

export const API_GROUPS = [...new Set(ENDPOINTS.map(e => e.group))]

export const CAPABILITY_SCOPES: CapabilityScope[] = [
  { scope: 'code:read',       desc: 'Read source files and session notes within the harbor' },
  { scope: 'notes:write',     desc: 'Write session notes inside the harbor' },
  { scope: 'lock:acquire',    desc: 'Acquire distributed locks within the harbor' },
  { scope: 'tunnel:create',   desc: 'Create tunnels scoped to the harbor' },
  { scope: 'msg:publish',     desc: 'Publish to pub/sub channels in the harbor' },
  { scope: 'msg:subscribe',   desc: 'Subscribe to pub/sub channels in the harbor' },
  { scope: 'file:claim',      desc: 'Claim files in the harbor workspace' },
  { scope: 'spawn:agents',    desc: 'Spawn child agents inside the harbor' },
]
