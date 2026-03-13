import * as React from 'react'
import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'

/* ─── Types ──────────────────────────────────────────────────────────────── */

type MethodColor = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

const METHOD_COLORS: Record<MethodColor, { bg: string; text: string }> = {
  GET:    { bg: 'rgba(34, 197, 94, 0.12)',   text: 'var(--p-green-300)' },
  POST:   { bg: 'rgba(58, 173, 173, 0.15)',  text: 'var(--p-teal-300)' },
  PUT:    { bg: 'rgba(251, 191, 36, 0.12)',  text: 'var(--p-amber-300)' },
  DELETE: { bg: 'rgba(239, 68, 68, 0.12)',   text: '#fca5a5' },
  PATCH:  { bg: 'rgba(167, 139, 250, 0.12)', text: '#c4b5fd' },
}

/* ─── CLI Commands ───────────────────────────────────────────────────────── */

interface CliCommand {
  cmd: string
  short?: string
  description: string
  flags?: string[]
  example: string
  output?: string
  group: string
}

const CLI_COMMANDS: CliCommand[] = [
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
    output: '[pd] Port Daddy v3.7.0 — 3 services, uptime 4h 12m',
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
    description: 'Start a session and register as an agent in one command. Writes agent ID and session ID to .portdaddy/current.json for use by other pd commands. The recommended way to start any coordinated work.',
    flags: [
      '--identity <id>    Semantic identity for this agent (project:stack:context)',
      '--purpose <text>   What this agent is working on',
    ],
    example: 'pd begin --identity myapp:api --purpose "Fix auth bug"',
    output: '[pd] Session abc123 started · Agent myapp:api registered\n[pd] 2 dead agents in myapp:* — run: pd salvage --project myapp',
  },
  {
    group: 'Sessions',
    cmd: 'pd done',
    description: 'End the current session and unregister agent. Reads session ID from .portdaddy/current.json. Marks session as completed.',
    flags: ['--session <id>   Explicit session ID (skips current.json lookup)'],
    example: 'pd done',
    output: '[pd] Session abc123 marked completed · Agent deregistered',
  },
  {
    group: 'Sessions',
    cmd: 'pd whoami',
    description: 'Show the current agent identity and session from .portdaddy/current.json.',
    example: 'pd whoami',
    output: 'Agent:   myapp:api\nSession: abc123\nPurpose: Fix auth bug\nStarted: 23m ago',
  },
  {
    group: 'Sessions',
    cmd: 'pd note <text>',
    short: 'n',
    description: 'Add a note to the current session. Notes are immutable — they are never edited or deleted. Creates an implicit session if none exists.',
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
  // Agents
  {
    group: 'Agents',
    cmd: 'pd spawn',
    description: 'Launch an AI agent with Port Daddy coordination pre-wired. The agent auto-registers, sends heartbeats, writes notes, and gets salvaged if it crashes.',
    flags: [
      '--backend <type>      AI backend: ollama | claude | gemini | aider | custom',
      '--model <name>        Model to use (e.g. llama3, claude-haiku-4-5)',
      '--identity <id>       Semantic identity for this agent',
      '--purpose <text>      What this agent should do',
      '--harbor <name>       Run agent inside a harbor (scoped permissions)',
      '-- <prompt>           Prompt to send (last argument)',
    ],
    example: 'pd spawn --backend claude --model claude-haiku-4-5 \\\n  --identity myapp:reviewer \\\n  -- "Review src/auth/ for security vulnerabilities"',
    output: '[pd] Spawned agent myapp:reviewer (session def456)\n[pd] Backend: claude · Model: claude-haiku-4-5\n[pd] Running...',
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
    cmd: 'pd dns resolve <name>',
    description: 'Resolve a name to a port number.',
    flags: ['--quiet, -q   Output port number only'],
    example: 'pd dns resolve myapp-api',
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

const CLI_GROUPS = [...new Set(CLI_COMMANDS.map(c => c.group))]

/* ─── HTTP Endpoint table ────────────────────────────────────────────────── */

interface Endpoint {
  method: MethodColor
  path: string
  description: string
  group: string
}

const ENDPOINTS: Endpoint[] = [
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
  { method: 'POST',   path: '/sessions/:id/notes',      description: 'Add a note to a session',                     group: 'Sessions' },
  { method: 'GET',    path: '/sessions/:id/notes',      description: 'Get all notes for a session',                  group: 'Sessions' },
  { method: 'POST',   path: '/sessions/:id/files',      description: 'Claim files in a session',                    group: 'Sessions' },
  { method: 'DELETE', path: '/sessions/:id/files',      description: 'Release file claims',                         group: 'Sessions' },
  { method: 'GET',    path: '/sessions/:id/files',      description: 'List claimed files',                          group: 'Sessions' },
  { method: 'POST',   path: '/notes',                   description: 'Quick note (auto session)',                   group: 'Sessions' },
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

const API_GROUPS = [...new Set(ENDPOINTS.map(e => e.group))]

/* ─── Capability Scopes ──────────────────────────────────────────────────── */

const CAPABILITY_SCOPES = [
  { scope: 'code:read',       desc: 'Read source files and session notes within the harbor' },
  { scope: 'notes:write',     desc: 'Write session notes inside the harbor' },
  { scope: 'lock:acquire',    desc: 'Acquire distributed locks within the harbor' },
  { scope: 'tunnel:create',   desc: 'Create tunnels scoped to the harbor' },
  { scope: 'msg:publish',     desc: 'Publish to pub/sub channels in the harbor' },
  { scope: 'msg:subscribe',   desc: 'Subscribe to pub/sub channels in the harbor' },
  { scope: 'file:claim',      desc: 'Claim files in the harbor workspace' },
  { scope: 'spawn:agents',    desc: 'Spawn child agents inside the harbor' },
]

/* ─── Section flag marker ────────────────────────────────────────────────── */

function FlagMarker({ letter, color }: { letter: string; color: string }) {
  return (
    <div
      className="w-5 h-5 rounded flex items-center justify-center font-bold text-xs flex-shrink-0"
      style={{ background: color, color: '#0a0a0a' }}
    >
      {letter}
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export function DocsPage() {
  const [section, setSection] = React.useState<'cli' | 'api'>('cli')
  const [cliGroup, setCliGroup] = React.useState<string | null>(null)
  const [apiSearch, setApiSearch] = React.useState('')
  const [apiGroup, setApiGroup] = React.useState<string | null>(null)
  const [openCmd, setOpenCmd] = React.useState<string | null>(null)

  // CLI filtering
  const filteredCli = CLI_COMMANDS.filter(c => !cliGroup || c.group === cliGroup)
  const cliGrouped = CLI_GROUPS.reduce<Record<string, CliCommand[]>>((acc, g) => {
    const items = filteredCli.filter(c => c.group === g)
    if (items.length) acc[g] = items
    return acc
  }, {})

  // API filtering
  const filteredApi = ENDPOINTS.filter(ep => {
    const q = apiSearch.toLowerCase()
    const matchSearch = !q || ep.path.includes(q) || ep.description.toLowerCase().includes(q)
    const matchGroup = !apiGroup || ep.group === apiGroup
    return matchSearch && matchGroup
  })
  const apiGrouped = API_GROUPS.reduce<Record<string, Endpoint[]>>((acc, g) => {
    const items = filteredApi.filter(ep => ep.group === g)
    if (items.length) acc[g] = items
    return acc
  }, {})

  return (
    <div
      className="min-h-screen"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', paddingTop: 'var(--nav-height)' }}
    >
      {/* ── Header ── */}
      <div
        className="py-16 px-4 sm:px-6 lg:px-8 border-b"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="max-w-6xl mx-auto">
          <Link to="/"
            className="text-sm mb-6 inline-flex items-center gap-2 transition-colors no-underline"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--p-font-mono)' }}
          >
            ← port-daddy
          </Link>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <Badge variant="teal" className="mb-4">Documentation</Badge>
            <h1
              className="text-4xl font-bold mb-4"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--p-font-display)' }}
            >
              Port Daddy Reference
            </h1>
            <p className="text-xl max-w-2xl mb-6" style={{ color: 'var(--text-secondary)' }}>
              Full command reference, HTTP API, and capability scope definitions.
              Daemon runs on <code style={{ fontFamily: 'var(--p-font-mono)', color: 'var(--text-code)' }}>localhost:9876</code>.
            </p>

            {/* Section tabs */}
            <div className="flex gap-2">
              {[
                { id: 'cli', label: 'CLI Reference' },
                { id: 'api', label: 'HTTP API' },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id as typeof section)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: section === s.id ? 'var(--brand-primary)' : 'var(--bg-overlay)',
                    color: section === s.id ? '#0a0a0a' : 'var(--text-muted)',
                    border: '1px solid transparent',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* ── CLI Reference ── */}
        {section === 'cli' && (
          <div className="grid lg:grid-cols-[220px_1fr] gap-8">
            {/* Sidebar nav */}
            <nav className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
                Command Groups
              </p>
              <button
                onClick={() => setCliGroup(null)}
                className="text-left px-3 py-1.5 rounded-lg text-sm transition-all"
                style={{
                  background: !cliGroup ? 'var(--interactive-active)' : 'transparent',
                  color: !cliGroup ? 'var(--brand-primary)' : 'var(--text-muted)',
                }}
              >
                All Commands
              </button>
              {CLI_GROUPS.map(g => (
                <button
                  key={g}
                  onClick={() => setCliGroup(cliGroup === g ? null : g)}
                  className="text-left px-3 py-1.5 rounded-lg text-sm transition-all"
                  style={{
                    background: cliGroup === g ? 'var(--interactive-active)' : 'transparent',
                    color: cliGroup === g ? 'var(--brand-primary)' : 'var(--text-muted)',
                  }}
                >
                  {g}
                </button>
              ))}
            </nav>

            {/* Command cards */}
            <div className="flex flex-col gap-8">
              {Object.entries(cliGrouped).map(([group, cmds]) => (
                <section key={group}>
                  {/* Group header */}
                  <div className="flex items-center gap-3 mb-4">
                    <FlagMarker letter={group[0]} color="var(--brand-primary)" />
                    <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                      {group}
                    </h2>
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{ background: 'var(--bg-overlay)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                    >
                      {cmds.length} cmd{cmds.length !== 1 ? 's' : ''}
                    </span>

                    {/* Harbors section extra: capability table */}
                    {group === 'Harbors' && (
                      <span className="ml-auto">
                        <Badge variant="teal">v3.7</Badge>
                      </span>
                    )}
                  </div>

                  {/* Capability scope table for Harbors */}
                  {group === 'Harbors' && (
                    <div
                      className="rounded-xl p-4 mb-4"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                    >
                      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>
                        Capability Scopes — pass to --cap flag
                      </p>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {CAPABILITY_SCOPES.map(s => (
                          <div key={s.scope} className="flex gap-2">
                            <code
                              className="text-xs font-mono px-2 py-0.5 rounded flex-shrink-0"
                              style={{ background: 'rgba(58,173,173,0.12)', color: 'var(--p-teal-300)' }}
                            >
                              {s.scope}
                            </code>
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Command list */}
                  <div className="flex flex-col gap-2">
                    {cmds.map(cmd => {
                      const isOpen = openCmd === cmd.cmd
                      return (
                        <div
                          key={cmd.cmd}
                          className="rounded-xl overflow-hidden"
                          style={{ border: '1px solid var(--border-default)' }}
                        >
                          <button
                            className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 transition-colors"
                            style={{ background: 'var(--bg-surface)' }}
                            onClick={() => setOpenCmd(isOpen ? null : cmd.cmd)}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--interactive-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                          >
                            <div className="flex-1 min-w-0">
                              <code
                                className="text-sm font-mono font-semibold block mb-1"
                                style={{ color: 'var(--text-code)' }}
                              >
                                {cmd.cmd}
                              </code>
                              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {cmd.description}
                              </p>
                            </div>
                            <span style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>▾</span>
                          </button>

                          {isOpen && (
                            <div
                              className="px-5 py-4 flex flex-col gap-4"
                              style={{ background: 'var(--bg-base)', borderTop: '1px solid var(--border-subtle)' }}
                            >
                              {/* Flags */}
                              {cmd.flags && cmd.flags.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
                                    Flags
                                  </p>
                                  {cmd.flags.map(f => (
                                    <code key={f} className="block text-xs font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>
                                      {f}
                                    </code>
                                  ))}
                                </div>
                              )}

                              {/* Example */}
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
                                  Example
                                </p>
                                <div
                                  className="rounded-lg p-3 font-mono text-xs"
                                  style={{ background: 'var(--code-bg)', border: '1px solid var(--border-default)' }}
                                >
                                  {cmd.example.split('\n').map((line, i) => (
                                    <div key={i}>
                                      {line.startsWith('#') ? (
                                        <span style={{ color: 'var(--code-comment)' }}>{line}</span>
                                      ) : (
                                        <span>
                                          <span style={{ color: 'var(--code-prompt)' }}>$ </span>
                                          <span style={{ color: 'var(--text-primary)' }}>{line}</span>
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                  {cmd.output && (
                                    <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                      {cmd.output.split('\n').map((line, i) => (
                                        <div key={i} style={{ color: 'var(--code-output)' }}>{line}</div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {/* ── HTTP API ── */}
        {section === 'api' && (
          <>
            {/* Search + group filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
              <input
                type="text"
                placeholder="Search endpoints…"
                value={apiSearch}
                onChange={e => setApiSearch(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-mono"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setApiGroup(null)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={{
                    background: !apiGroup ? 'var(--brand-primary)' : 'var(--bg-overlay)',
                    color: !apiGroup ? '#0a0a0a' : 'var(--text-muted)',
                  }}
                >
                  All
                </button>
                {API_GROUPS.map(g => (
                  <button
                    key={g}
                    onClick={() => setApiGroup(apiGroup === g ? null : g)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: apiGroup === g ? 'var(--bg-overlay)' : 'transparent',
                      color: apiGroup === g ? 'var(--text-primary)' : 'var(--text-muted)',
                      border: '1px solid',
                      borderColor: apiGroup === g ? 'var(--border-default)' : 'transparent',
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Endpoint groups */}
            {Object.entries(apiGrouped).map(([group, endpoints], gi) => (
              <motion.div
                key={group}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: gi * 0.04 }}
                className="mb-10"
              >
                <div className="flex items-center gap-3 mb-4">
                  <FlagMarker letter={group[0]} color="var(--brand-primary)" />
                  <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{group}</h2>
                  <span className="text-xs font-mono px-2 py-0.5 rounded"
                    style={{ background: 'var(--bg-overlay)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                    {endpoints.length}
                  </span>
                  {group === 'Harbors' && <Badge variant="teal">v3.7</Badge>}
                  {group === 'Agents' && endpoints.some(e => e.path.includes('/spawn')) && <Badge variant="teal">v3.7</Badge>}
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
                  {endpoints.map((ep, i) => {
                    const colors = METHOD_COLORS[ep.method]
                    return (
                      <div
                        key={ep.path + ep.method}
                        className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-[var(--interactive-hover)]"
                        style={{ borderBottom: i < endpoints.length - 1 ? '1px solid var(--border-subtle)' : undefined }}
                      >
                        <span
                          className="text-xs font-mono font-bold px-2 py-1 rounded flex-shrink-0 w-16 text-center"
                          style={{ background: colors.bg, color: colors.text }}
                        >
                          {ep.method}
                        </span>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 flex-1 min-w-0">
                          <code className="text-sm font-mono flex-shrink-0" style={{ color: 'var(--text-code)' }}>
                            {ep.path}
                          </code>
                          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                            {ep.description}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            ))}

            {filteredApi.length === 0 && (
              <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
                <p className="text-lg">No endpoints match "{apiSearch}"</p>
              </div>
            )}

            {/* Base URL */}
            <div
              className="mt-8 p-4 rounded-xl font-mono text-sm"
              style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
            >
              <span style={{ color: 'var(--code-comment)' }}># Base URL</span>
              <br />
              <span style={{ color: 'var(--text-secondary)' }}>http://localhost:9876</span>
              <span style={{ color: 'var(--code-comment)' }}> — override with </span>
              <span style={{ color: 'var(--text-code)' }}>PORT_DADDY_PORT</span>
              <span style={{ color: 'var(--code-comment)' }}> env var</span>
            </div>
          </>
        )}

        {/* ── SDK Note ── */}
        <div
          className="mt-12 p-6 rounded-xl"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-start gap-3">
            <FlagMarker letter="S" color="var(--p-amber-400)" />
            <div>
              <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                JavaScript / TypeScript SDK
              </h3>
              <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                All HTTP endpoints are available via the typed SDK. Install with{' '}
                <code className="font-mono" style={{ color: 'var(--text-code)' }}>npm install port-daddy</code>.
              </p>
              <div
                className="font-mono text-xs rounded-lg p-3"
                style={{ background: 'var(--code-bg)', border: '1px solid var(--border-default)' }}
              >
                <div style={{ color: 'var(--code-comment)' }}># All pd commands available as typed methods</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>{"import { PortDaddy } from 'port-daddy'"}</span></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>{'const pd = new PortDaddy()'}</span></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>{'await pd.begin({ identity: "myapp:worker" })'}</span></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>{'const port = await pd.claim("myapp:api")'}</span></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>{'await pd.note("Starting work", { type: "progress" })'}</span></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>{'await pd.done()'}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
