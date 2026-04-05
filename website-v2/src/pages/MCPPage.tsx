
import { useState } from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Footer } from '@/components/layout/Footer'
import {
  Terminal, Zap, Users, MessageSquare, Anchor,
  Activity, Database, Cpu, Search, Radio, GitBranch,
  ArrowRight, CheckCircle, Download, Layers, Globe
} from 'lucide-react'

/* -------------------------------------------------------------------------- */
/*  Data                                                                        */
/* -------------------------------------------------------------------------- */

const LLM_LOGOS = [
  { name: 'Claude', color: '#CC785C' },
  { name: 'OpenAI', color: '#10A37F' },
  { name: 'Gemini', color: '#4285F4' },
  { name: 'Ollama', color: '#3AADAD' },
  { name: 'Grok', color: '#1D9BF0' },
  { name: 'Aider', color: '#A78BFA' },
  { name: 'Cursor', color: '#3AADAD' },
  { name: 'Any LLM', color: '#6B7280' },
]

const MAGIC_TOOLS = [
  {
    name: 'fleet_init',
    tagline: 'One call deploys your entire agent fleet.',
    icon: Cpu,
    color: 'var(--brand-primary)',
    description: 'Creates pd-fleet.yml, installs the git commit hook, and starts background agents — all from a single MCP call.',
    example: `// One tool call. Fleet running in 10 seconds.
await fleet_init({
  project: "myapp",
  agents: ["qa", "documentarian", "cartographer"]
})
// → git hook installed
// → 3 agents listening for git:committed`,
  },
  {
    name: 'swarm_awareness',
    tagline: 'Who else is working here right now?',
    icon: Users,
    color: 'var(--brand-secondary)',
    description: 'A single call returns active agents, open sessions, file claims, and recently dead agents that need salvage.',
    example: `const { agents, sessions, fileClaims, deadAgents } =
  await swarm_awareness({ project: "myapp" })
// → "spider (myapp:fleet:spider) — active 2m ago"
// → "qa claimed: src/auth/*.ts"
// → "1 dead agent needs salvage"`,
  },
  {
    name: 'catch_me_up',
    tagline: 'What happened while I was away?',
    icon: Activity,
    color: 'var(--brand-primary)',
    description: 'Reconstructs swarm activity since a given timestamp — notes, commits, agent events, and any salvageable work.',
    example: `const briefing = await catch_me_up({
  since: "1h",
  project: "myapp"
})
// → "QA agent ran on 3 commits. 2 bugs filed."
// → "Documentarian updated 4 pages."
// → "spider found: trie+pubsub=routing (0.9 conf)"`,
  },
  {
    name: 'spawn_agent',
    tagline: 'Launch a background AI with one call.',
    icon: Radio,
    color: 'var(--brand-secondary)',
    description: 'Spawns an AI agent with full PD coordination — registration, heartbeat, session, and salvage on crash. Works with any backend.',
    example: `await spawn_agent({
  backend: "claude-cli",
  purpose: "Review auth changes for CVEs",
  identity: "myapp:security:scan",
  allowedTools: "Read,Grep,Glob"
})
// → agent registered + heartbeating
// → session started, notes immutable
// → auto-salvage if it dies`,
  },
  {
    name: 'file_heat',
    tagline: 'Which files are agents fighting over?',
    icon: GitBranch,
    color: 'var(--brand-primary)',
    description: 'Returns a heat map of file contention based on pheromone trail strength and active file claims.',
    example: `const heat = await file_heat({ project: "myapp" })
// → "src/auth/middleware.ts — 0.87 (3 agents)"
// → "src/routes/login.ts   — 0.62 (2 agents)"
// → "src/db/schema.ts      — 0.21 (1 agent)"`,
  },
  {
    name: 'fleet_status',
    tagline: 'What is the fleet doing right now?',
    icon: Search,
    color: 'var(--brand-secondary)',
    description: 'Full fleet snapshot: agent health, last run timestamps, recent notes, trigger channels, and respawn counts.',
    example: `const status = await fleet_status({ harbor: "myapp:fleet" })
// → "qa: running | last commit: 4m ago | 0 respawns"
// → "spark: idle  | next cron: 22m | 0 respawns"
// → "spider: running | connections found: 7 | 1 respawn"`,
  },
]

const PUBSUB_SURFACES = [
  {
    id: 'cli',
    label: 'CLI',
    icon: Terminal,
    subscribe: `# Subscribe (blocks, streams events)
pd watch git:committed

# Publish
pd pub git:committed '{"sha":"abc123"}'

# Auto-trigger a script on each message
pd watch git:committed --exec './fleet/qa.sh'`,
    note: 'Works in any shell. Great for composing with grep, jq, or custom scripts.',
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: Cpu,
    subscribe: `// Subscribe (returns next message)
await subscribe({ channel: "git:committed" })

// Publish
await publish_message({
  channel: "git:committed",
  content: JSON.stringify({ sha: "abc123" })
})`,
    note: 'Perfect for agents that chain: QA publishes to qa:findings, notifier reacts.',
  },
  {
    id: 'sdk',
    label: 'SDK',
    icon: Layers,
    subscribe: `import { PortDaddy } from 'port-daddy'
const pd = new PortDaddy()

// Subscribe (SSE stream)
for await (const msg of pd.subscribe('git:committed')) {
  console.log(msg.content)
}

// Publish
await pd.publish('git:committed', { sha: 'abc123' })`,
    note: 'Full TypeScript types. Async iterators for streaming. Promise-based publish.',
  },
  {
    id: 'api',
    label: 'REST API',
    icon: Globe,
    subscribe: `# Subscribe (SSE stream)
curl -N http://localhost:9876/msg/git:committed/subscribe

# Long-poll (waits for next message, then returns)
curl http://localhost:9876/msg/git:committed/poll

# Publish
curl -X POST http://localhost:9876/msg/git:committed \\
  -H 'Content-Type: application/json' \\
  -d '{"content":{"sha":"abc123"}}'`,
    note: 'Standard SSE. Works from any language, any runtime, any agent.',
  },
]

const ESSENTIAL_TOOLS = [
  { name: 'begin_session', desc: 'Register identity, claim files, start session — atomically.' },
  { name: 'end_session_full', desc: 'Release files, end session, unregister agent.' },
  { name: 'claim_port', desc: 'Deterministic port assignment for your semantic identity.' },
  { name: 'add_note', desc: 'Append to the immutable swarm ledger.' },
  { name: 'acquire_lock', desc: 'Distributed lock with TTL and auto-release.' },
  { name: 'list_services', desc: 'Query all registered services and their ports.' },
  { name: 'swarm_awareness', desc: 'Who is working here? Agents, sessions, dead agents.' },
  { name: 'catch_me_up', desc: 'What happened since I was last here?' },
]

const DISCOVER_CATEGORIES = [
  { id: 'session-lifecycle', label: 'Session Lifecycle', count: 6, icon: Activity },
  { id: 'ports', label: 'Port Management', count: 5, icon: Anchor },
  { id: 'messaging', label: 'Pub/Sub Radio', count: 4, icon: Radio },
  { id: 'agents', label: 'Fleet & Agents', count: 8, icon: Cpu },
  { id: 'locks', label: 'Distributed Locks', count: 3, icon: Database },
  { id: 'tuples', label: 'Tuple Space', count: 5, icon: Layers },
  { id: 'dns', label: 'Local DNS', count: 4, icon: Globe },
  { id: 'tunnels', label: 'Tunnels', count: 3, icon: Zap },
]

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function LLMStrip() {
  return (
    <div
      className="border-y py-5 px-6 overflow-hidden relative"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-sunken)' }}
    >
      <p className="text-center text-[10px] font-black uppercase tracking-[0.3em] mb-4"
        style={{ color: 'var(--text-muted)' }}>
        Works with any LLM backend
      </p>
      <div className="flex items-center justify-center gap-6 flex-wrap">
        {LLM_LOGOS.map((llm) => (
          <span
            key={llm.name}
            className="text-sm font-black px-4 py-2 rounded-xl"
            style={{
              background: `${llm.color}12`,
              border: `1px solid ${llm.color}30`,
              color: llm.color,
            }}
          >
            {llm.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function MagicToolCard({ tool, index }: { tool: typeof MAGIC_TOOLS[0], index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.05, duration: 0.5 }}
    >
      <Surface depth="raised" radius="2xl" padding="none"
        className="p-6 flex flex-col gap-5 h-full group transition-all">
        <div className="flex items-start gap-4">
          <Surface depth="inset" radius="xl" padding="none"
            className="w-12 h-12 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"
            style={{ background: `${tool.color}12` }}>
            <tool.icon size={24} style={{ color: tool.color }} />
          </Surface>
          <div>
            <code className="text-lg font-black font-mono" style={{ color: tool.color }}>
              {tool.name}
            </code>
            <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {tool.tagline}
            </p>
          </div>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {tool.description}
        </p>
        <CodeBlock language="typescript">{tool.example}</CodeBlock>
      </Surface>
    </motion.div>
  )
}

function PubSubSection() {
  const [active, setActive] = useState('cli')
  const surface = PUBSUB_SURFACES.find(s => s.id === active)!

  return (
    <section className="py-20 px-6 lg:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <Badge variant="teal" className="mb-4 px-5 py-2 text-[10px] font-black uppercase tracking-widest">
            Pub/Sub
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-4"
            style={{ color: 'var(--text-primary)' }}>
            The same channel.<br />
            <span style={{ color: 'var(--brand-primary)' }}>Every surface.</span>
          </h2>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            A message published from the CLI lands in the MCP, the SDK, and the REST API simultaneously.
            Pick whichever surface your agent can reach.
          </p>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-2 justify-center mb-6">
          {PUBSUB_SURFACES.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all"
              style={{
                background: active === s.id ? 'var(--brand-primary)' : 'var(--surface-raised)',
                color: active === s.id ? '#fff' : 'var(--text-secondary)',
                boxShadow: active === s.id ? 'var(--shadow-md)' : 'var(--shadow-sm)',
                border: `1px solid ${active === s.id ? 'var(--brand-primary)' : 'var(--border-subtle)'}`,
              }}
            >
              <s.icon size={14} />
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Surface depth="raised" radius="2xl" padding="none" className="overflow-hidden">
            <div className="p-6">
              <CodeBlock language="bash">{surface.subscribe}</CodeBlock>
              <p className="text-xs font-semibold mt-4 px-1" style={{ color: 'var(--text-muted)' }}>
                {surface.note}
              </p>
            </div>
          </Surface>
        </motion.div>

        {/* Trigger hint */}
        <Surface depth="inset" radius="xl" padding="none"
          className="mt-6 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <Zap size={20} className="shrink-0" style={{ color: 'var(--brand-primary)' }} />
          <div>
            <p className="text-sm font-black mb-1" style={{ color: 'var(--text-primary)' }}>
              git commit → fleet fires automatically
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Install the post-commit hook and every commit publishes to <code
                className="font-mono px-1 py-0.5 rounded"
                style={{ background: 'var(--surface-base)', color: 'var(--brand-primary)' }}>
                git:committed
              </code>. QA, docs, and cartographer agents subscribe and run in parallel.
            </p>
          </div>
          <code className="text-xs font-black font-mono whitespace-nowrap px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--surface-base)', color: 'var(--brand-primary)', border: '1px solid var(--border-subtle)' }}>
            pd fleet init
          </code>
        </Surface>
      </div>
    </section>
  )
}

function RespawnSection() {
  return (
    <section className="py-20 px-6 lg:px-12"
      style={{ background: 'var(--surface-raised)' }}>
      <div className="max-w-5xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Badge variant="default" className="mb-4 px-5 py-2 text-[10px] font-black uppercase tracking-widest"
              style={{ background: 'var(--surface-sunken)', color: 'var(--text-primary)' }}>
              Auto-Respawn
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-5"
              style={{ color: 'var(--text-primary)' }}>
              Background agents<br />
              <span style={{ color: 'var(--brand-primary)' }}>that never die.</span>
            </h2>
            <p className="text-lg mb-6" style={{ color: 'var(--text-secondary)' }}>
              Fleet agents with <code className="font-mono text-sm px-1.5 py-0.5 rounded"
                style={{ background: 'var(--surface-sunken)', color: 'var(--brand-primary)' }}>
                respawn: true
              </code> automatically recover from crashes. Port Daddy subscribes to the resurrection
              channel, claims the dead agent's salvage context, and re-launches with the same
              identity.
            </p>
            <div className="space-y-3">
              {[
                'Crash detected via heartbeat gap',
                'Session context preserved in salvage queue',
                'Circuit breaker after max_respawns',
                'New agent inherits dead agent\'s notes',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <CheckCircle size={16} style={{ color: 'var(--brand-primary)' }} className="shrink-0" />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <CodeBlock language="yaml">{`# pd-fleet.yml
fleet:
  name: myapp
  agents:
    qa:
      trigger: git:committed
      backend: claude-cli
      respawn: true        # Auto-restart on death
      max_respawns: 3      # Circuit breaker
      prompt: |
        Review the last commit. Find bugs.

    spark:
      schedule: "*/30 * * * *"
      backend: claude-cli
      respawn: true
      prompt: |
        Propose one codebase improvement.`}
            </CodeBlock>

            <Surface depth="inset" radius="xl" padding="none" className="p-4">
              <p className="text-[10px] font-black uppercase tracking-widest mb-3"
                style={{ color: 'var(--text-muted)' }}>
                Respawn lifecycle
              </p>
              <div className="flex items-center gap-2 text-xs font-mono overflow-x-auto">
                {['running', '→', 'crash', '→', 'salvage', '→', 'respawn', '→', 'running'].map((step, i) => (
                  <span key={i}
                    className="px-2 py-1 rounded-lg whitespace-nowrap"
                    style={{
                      background: step === '→' ? 'transparent' : 'var(--surface-raised)',
                      color: step === 'running' ? 'var(--brand-primary)' :
                        step === 'crash' ? 'var(--status-error)' :
                          step === 'salvage' ? 'var(--brand-secondary)' :
                            step === 'respawn' ? 'var(--status-warning)' :
                              'var(--text-muted)',
                      border: step === '→' ? 'none' : '1px solid var(--border-subtle)',
                    }}>
                    {step}
                  </span>
                ))}
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </section>
  )
}

function TupleSection() {
  return (
    <section className="py-20 px-6 lg:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-start">
          <div>
            <Badge variant="teal" className="mb-4 px-5 py-2 text-[10px] font-black uppercase tracking-widest">
              Tuple Space
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-5"
              style={{ color: 'var(--text-primary)' }}>
              Shared memory<br />
              <span style={{ color: 'var(--brand-primary)' }}>for swarms.</span>
            </h2>
            <p className="text-lg mb-4" style={{ color: 'var(--text-secondary)' }}>
              Based on Linda (Gelernter, 1985). Agents write typed tuples to a shared space.
              Other agents query by pattern. Harbor-scoped so your fleet's knowledge stays
              isolated from other fleets.
            </p>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              Spider writes connections. Spark reads high-confidence ones. QA writes bug
              findings. You read them all. The tuple space is the swarm's working memory.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { op: 'tuple_out', desc: 'Write a tuple' },
                { op: 'tuple_rd', desc: 'Read without removing' },
                { op: 'tuple_in', desc: 'Take + remove' },
                { op: 'tuple_scan', desc: 'List all tuples' },
                { op: 'tuple_count', desc: 'Count by pattern' },
                { op: 'pd tuple', desc: 'CLI access' },
              ].map(item => (
                <Surface key={item.op} depth="inset" radius="lg" padding="none"
                  className="p-3 text-center">
                  <code className="text-[11px] font-black font-mono block mb-1"
                    style={{ color: 'var(--brand-primary)' }}>
                    {item.op}
                  </code>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {item.desc}
                  </span>
                </Surface>
              ))}
            </div>
          </div>
          <CodeBlock language="typescript">{`// Spider (fleet agent) writes a discovery
await tuple_out({
  tuple: ["connection", "trie+pubsub=routing", "spider", 0.9],
  harbor: "myapp:fleet"
})

// Spark reads connections with confidence > 0.7
const finds = await tuple_rd({
  pattern: ["connection", "*", "*", ">0.7"],
  harbor: "myapp:fleet"
})
// → [["connection","trie+pubsub=routing","spider",0.9]]

// QA claims and removes a pending task
const task = await tuple_in({
  pattern: ["task", "*", "pending"],
  harbor: "myapp:fleet"
})

// CLI access
// pd tuple out '["bug","null-deref","qa",0.95]'
// pd tuple rd  '["bug","*","*",">0.8"]'
// pd tuple scan --harbor myapp:fleet`}
          </CodeBlock>
        </div>
      </div>
    </section>
  )
}

function ProgressiveDisclosure() {
  return (
    <section className="py-20 px-6 lg:px-12"
      style={{ background: 'var(--surface-sunken)' }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <Badge variant="default" className="mb-4 px-5 py-2 text-[10px] font-black uppercase tracking-widest"
            style={{ background: 'var(--surface-raised)', color: 'var(--text-primary)' }}>
            Agent Experience
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-4"
            style={{ color: 'var(--text-primary)' }}>
            8 tools by default.<br />
            <span style={{ color: 'var(--brand-primary)' }}>60+ when you need them.</span>
          </h2>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Agents shouldn't be overwhelmed by tool lists. Port Daddy exposes 8 essential tools
            by default and lets agents unlock categories on demand.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr,auto,1fr] gap-8 items-start">
          {/* Essential 8 */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest mb-4"
              style={{ color: 'var(--text-muted)' }}>
              Always loaded
            </p>
            <div className="space-y-2">
              {ESSENTIAL_TOOLS.map(tool => (
                <Surface key={tool.name} depth="raised" radius="xl" padding="none"
                  className="p-4 flex items-start gap-3">
                  <CheckCircle size={14} className="mt-0.5 shrink-0"
                    style={{ color: 'var(--brand-primary)' }} />
                  <div>
                    <code className="text-sm font-black font-mono"
                      style={{ color: 'var(--brand-primary)' }}>
                      {tool.name}
                    </code>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {tool.desc}
                    </p>
                  </div>
                </Surface>
              ))}
            </div>
          </div>

          {/* Arrow */}
          <div className="hidden lg:flex flex-col items-center pt-16 gap-3">
            <div className="w-px h-24" style={{ background: 'var(--border-subtle)' }} />
            <Surface depth="raised" radius="xl" padding="none"
              className="px-4 py-2 text-center">
              <code className="text-xs font-black font-mono"
                style={{ color: 'var(--brand-primary)' }}>
                pd_discover
              </code>
            </Surface>
            <ArrowRight size={20} style={{ color: 'var(--brand-primary)' }} />
            <div className="w-px h-24" style={{ background: 'var(--border-subtle)' }} />
          </div>

          {/* Categories */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest mb-4"
              style={{ color: 'var(--text-muted)' }}>
              Unlocked on demand
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DISCOVER_CATEGORIES.map(cat => (
                <Surface key={cat.id} depth="raised" radius="xl" padding="none"
                  className="p-4 group transition-all">
                  <div className="flex items-center gap-2 mb-1">
                    <cat.icon size={14} style={{ color: 'var(--brand-primary)' }} className="opacity-60 group-hover:opacity-100 transition-opacity" />
                    <span className="text-xs font-black"
                      style={{ color: 'var(--text-primary)' }}>
                      {cat.label}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
                    style={{ background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}>
                    {cat.count} tools
                  </span>
                </Surface>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function InstallSection() {
  return (
    <section className="py-20 px-6 lg:px-12"
      style={{ background: 'var(--surface-raised)' }}>
      <div className="max-w-3xl mx-auto text-center">
        <Badge variant="teal" className="mb-4 px-5 py-2 text-[10px] font-black uppercase tracking-widest">
          Get Started
        </Badge>
        <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-4"
          style={{ color: 'var(--text-primary)' }}>
          Three commands.
        </h2>
        <p className="text-lg mb-10" style={{ color: 'var(--text-secondary)' }}>
          Install the daemon, wire up MCP, and start coordinating.
        </p>

        <div className="space-y-4">
          {[
            { step: '1', label: 'Install', cmd: 'brew install port-daddy  # or: npm install -g port-daddy', icon: Download },
            { step: '2', label: 'Start + wire MCP', cmd: 'pd start && pd mcp install', icon: Terminal },
            { step: '3', label: 'Initialize fleet (optional)', cmd: 'pd fleet init', icon: Cpu },
          ].map(({ step, label, cmd, icon: Icon }) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, x: -16 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: Number(step) * 0.1 }}
            >
              <Surface depth="raised" radius="2xl" padding="none"
                className="p-5 flex items-center gap-5">
                <Surface depth="inset" radius="xl" padding="none"
                  className="w-10 h-10 flex items-center justify-center shrink-0">
                  <span className="text-base font-black" style={{ color: 'var(--brand-primary)' }}>
                    {step}
                  </span>
                </Surface>
                <div className="flex-1 text-left">
                  <p className="text-xs font-black uppercase tracking-widest mb-1"
                    style={{ color: 'var(--text-muted)' }}>
                    {label}
                  </p>
                  <code className="text-sm font-mono font-black"
                    style={{ color: 'var(--text-primary)' }}>
                    $ {cmd}
                  </code>
                </div>
                <Icon size={18} style={{ color: 'var(--brand-primary)' }} className="shrink-0 opacity-40" />
              </Surface>
            </motion.div>
          ))}
        </div>

        <p className="mt-8 text-xs" style={{ color: 'var(--text-muted)' }}>
          Supports Claude Code, Cursor, and Continue.dev.
          Works on macOS and Linux. Node 18+ required.
        </p>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function McpPage() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col pt-[var(--nav-height)] font-sans"
      style={{ background: 'var(--surface-base)' }}
    >
      {/* Progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[3px] z-[100] origin-left"
        style={{ scaleX, top: 'var(--nav-height)', background: 'var(--brand-primary)' }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Hero                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative py-20 sm:py-28 px-6 lg:px-12 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[120px] opacity-[0.06] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary), transparent 70%)' }} />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <Badge variant="teal" className="mb-6 px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.3em]">
            Model Context Protocol
          </Badge>

          <motion.h1
            className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tighter leading-[0.9] mb-6"
            style={{ color: 'var(--text-primary)' }}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            One handshake.
            <br />
            <span style={{ color: 'var(--brand-primary)' }}>Infinite coordination.</span>
          </motion.h1>

          <motion.p
            className="text-xl sm:text-2xl max-w-3xl mx-auto leading-relaxed mb-10"
            style={{ color: 'var(--text-secondary)' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            One install gives your AI agents 60+ production-grade coordination tools —
            background fleets, auto-respawn, shared memory, and real-time pub/sub.
            Works with every LLM.
          </motion.p>

          <motion.div
            className="inline-flex flex-col sm:flex-row items-center gap-4"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Surface depth="raised" radius="2xl" padding="none"
              className="flex items-center gap-4 px-8 py-5 group">
              <Terminal size={24} style={{ color: 'var(--brand-primary)' }} />
              <code className="text-xl font-black font-mono"
                style={{ color: 'var(--text-primary)' }}>
                pd mcp install
              </code>
              <span className="hidden sm:block text-xs font-black uppercase tracking-widest"
                style={{ color: 'var(--text-muted)' }}>
                One command
              </span>
            </Surface>
          </motion.div>
        </div>
      </section>

      {/* LLM compatibility strip */}
      <LLMStrip />

      {/* ------------------------------------------------------------------ */}
      {/* Magic Tools                                                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-20 px-6 lg:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <Badge variant="default" className="mb-4 px-5 py-2 text-[10px] font-black uppercase tracking-widest"
              style={{ background: 'var(--surface-raised)', color: 'var(--text-primary)' }}>
              Magic Tools
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-4"
              style={{ color: 'var(--text-primary)' }}>
              High-level primitives<br />
              <span style={{ color: 'var(--brand-primary)' }}>for vibe coders.</span>
            </h2>
            <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
              These tools do a lot in one call. You don't need to know the internals —
              just call the right magic tool and Port Daddy handles the orchestration.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {MAGIC_TOOLS.map((tool, i) => (
              <MagicToolCard key={tool.name} tool={tool} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* Pub/Sub section */}
      <PubSubSection />

      {/* Auto-respawn section */}
      <RespawnSection />

      {/* Tuple space section */}
      <TupleSection />

      {/* Progressive disclosure */}
      <ProgressiveDisclosure />

      {/* Install */}
      <InstallSection />

      {/* Final CTA */}
      <section className="py-20 px-6 lg:px-12">
        <div className="max-w-3xl mx-auto">
          <Surface depth="raised" radius="2xl" padding="none"
            className="p-10 text-center overflow-hidden relative">
            <div className="absolute top-0 right-0 opacity-[0.03] pointer-events-none">
              <MessageSquare size={400} />
            </div>
            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-4"
                style={{ color: 'var(--text-primary)' }}>
                Your agents are ready.
              </h2>
              <p className="text-lg mb-8" style={{ color: 'var(--text-secondary)' }}>
                Schedule background agents for anything. Auto-respawn on crash.
                Leave notes that survive context resets. Works with every LLM.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <Surface depth="raised" radius="xl" padding="none"
                  className="flex items-center gap-3 px-6 py-3">
                  <code className="text-base font-black font-mono"
                    style={{ color: 'var(--brand-primary)' }}>
                    brew install port-daddy
                  </code>
                </Surface>
                <a
                  href="/docs/mcp"
                  className="flex items-center gap-2 text-sm font-black no-underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Read the MCP docs
                  <ArrowRight size={14} />
                </a>
              </div>
            </div>
          </Surface>
        </div>
      </section>

      <Footer />
    </motion.div>
  )
}
