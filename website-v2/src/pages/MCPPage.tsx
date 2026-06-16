import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Activity,
  Anchor,
  ArrowRight,
  Bot,
  Check,
  Cpu,
  Database,
  GitBranch,
  Globe,
  Layers,
  LifeBuoy,
  Radio,
  Search,
  Terminal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { ALL_CATEGORIES, MCP_DEFAULT_TOOL_TOTAL, MCP_TOOL_TOTAL } from '@/data/mcp'
import {
  BracketLink,
  DocsCodeBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

type Tone = 'paper' | 'blue' | 'accent'
type ToolLanguage = 'cli' | 'typescript' | 'text'

interface ProofMetric {
  value: string
  label: string
  tone: Tone
}

interface RuntimeBackend {
  name: string
  tier: string
  surface: string
}

interface MagicTool {
  name: string
  tagline: string
  description: string
  icon: LucideIcon
  tone: Tone
  example: string
}

interface ChannelSurface {
  id: string
  label: string
  icon: LucideIcon
  language: ToolLanguage
  code: string
  note: string
}

const PROOF_METRICS: ProofMetric[] = [
  { value: `${MCP_TOOL_TOTAL}`, label: 'MCP functions registered by the server', tone: 'blue' },
  { value: `${MCP_DEFAULT_TOOL_TOTAL}`, label: 'loaded by default, the rest on request', tone: 'accent' },
  { value: '1', label: 'local app holding the shared state', tone: 'paper' },
]

const PROCEDURAL_KNOWLEDGE_URL = 'https://windags.ai/blog/why-declarative-knowledge-isnt-enough'

const RUNTIME_BACKENDS: RuntimeBackend[] = [
  { name: 'Codex', tier: 'low / mid / high', surface: 'runs through codex exec' },
  { name: 'Claude SDK', tier: 'haiku / sonnet / opus', surface: 'reports token usage per run' },
  { name: 'Claude CLI', tier: 'haiku / sonnet / opus', surface: 'uses your local CLI login' },
  { name: 'Gemini', tier: 'flash / flash / pro', surface: 'runs through the Google SDK' },
  { name: 'Ollama', tier: 'small / medium / large', surface: 'runs offline, on your machine' },
  { name: 'Aider', tier: 'mini / standard / high', surface: 'lets Aider make the edits' },
]

const MAGIC_TOOLS: MagicTool[] = [
  {
    name: 'fleet_init',
    tagline: 'fleet_init — stand up a group of agents in one call.',
    icon: Cpu,
    tone: 'blue',
    description:
      'Writes the fleet config, installs a commit hook scoped to this project, and starts the background agents. One call, and the group is running and tracked.',
    example: `await fleet_init({
  project: "myapp",
  agents: ["qa", "documentarian", "cartographer"]
})

// hook installed
// scoped git:committed channel ready
// background agents tracked by session`,
  },
  {
    name: 'swarm_awareness',
    tagline: 'swarm_awareness — ask who else is active before editing.',
    icon: Users,
    tone: 'paper',
    description:
      'Returns who is working right now, which files they have claimed, and which sessions died mid-task. An agent checks this before it touches a file two others are already in.',
    example: `const state = await swarm_awareness({ project: "myapp" })

// active: qa, cartographer
// claimed: src/auth/*.ts
// salvage: 1 abandoned session`,
  },
  {
    name: 'catch_me_up',
    tagline: 'catch_me_up — read what happened while you were gone.',
    icon: Activity,
    tone: 'accent',
    description:
      'Summarizes the notes, commits, and agent activity since a point in time. An agent starting fresh, or a person back from lunch, gets the same short briefing.',
    example: `const briefing = await catch_me_up({
  since: "1h",
  project: "myapp"
})

// 3 commits reviewed
// 2 findings filed
// 1 route changed by a live agent`,
  },
  {
    name: 'spawn_agent',
    tagline: 'spawn_agent — start one background agent with a spending cap.',
    icon: Bot,
    tone: 'blue',
    description:
      'Starts a single agent in the background with a name, a job, and a dollar ceiling it cannot exceed. It checks in on a heartbeat, so a stall shows up instead of going quiet.',
    example: `await spawn_agent({
  backend: "codex",
  model_tier: "low",
  budget_usd: 0.5,
  identity: "myapp:security:scan",
  purpose: "Review auth changes"
})`,
  },
  {
    name: 'file_heat',
    tagline: 'file_heat — see which files are crowded right now.',
    icon: GitBranch,
    tone: 'paper',
    description:
      'Scores each file by how many agents are working in or near it. A high score is a hint to route the next agent elsewhere, before two edits collide.',
    example: `const heat = await file_heat({ project: "myapp" })

// src/auth/middleware.ts  0.87
// src/routes/login.ts    0.62
// src/db/schema.ts       0.21`,
  },
  {
    name: 'fleet_status',
    tagline: 'fleet_status — check the whole group without opening logs.',
    icon: Search,
    tone: 'accent',
    description:
      'Returns each agent in the group, what it last did, when it last ran, and how many times it has restarted. The state you would otherwise piece together from log files.',
    example: `const status = await fleet_status({ harbor: "myapp:fleet" })

// qa: running, last commit 4m ago
// spark: idle, next cron 22m
// spider: running, 7 findings`,
  },
]

const CHANNEL_SURFACES: ChannelSurface[] = [
  {
    id: 'cli',
    label: 'CLI',
    icon: Terminal,
    language: 'cli',
    code: `pd watch git:committed
pd pub git:committed '{"sha":"abc123"}'
pd watch git:committed --exec './fleet/qa.sh'`,
    note: 'Reach for the shell in git hooks and local scripts. The commands are plain text, so you can read back later what fired and when.',
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: Cpu,
    language: 'typescript',
    code: `await subscribe({ channel: "git:committed" })

await publish_message({
  channel: "git:committed",
  content: JSON.stringify({ sha: "abc123" })
})`,
    note: 'An AI client calls MCP directly, so it can subscribe and publish without shelling out and parsing text.',
  },
  {
    id: 'sdk',
    label: 'SDK',
    icon: Layers,
    language: 'typescript',
    code: `import { PortDaddy } from "port-daddy"

const pd = new PortDaddy()

for await (const msg of pd.subscribe("git:committed")) {
  console.log(msg.content)
}`,
    note: 'The SDK fits typed apps and long-running tools that want an async stream instead of polling.',
  },
  {
    id: 'api',
    label: 'REST API',
    icon: Globe,
    language: 'cli',
    code: `curl -N http://localhost:9876/msg/git:committed/subscribe
curl http://localhost:9876/msg/git:committed/poll
curl -X POST http://localhost:9876/msg/git:committed \\
  -H 'Content-Type: application/json' \\
  -d '{"content":{"sha":"abc123"}}'`,
    note: 'Plain HTTP keeps tools in any language — Python, Go, a shell one-liner — on the same Port Daddy state.',
  },
]

const SKILL_BUNDLE_ITEMS = [
  ['SKILL.md', 'The lean operating loop: status, briefing, session, note, claims, validation, handoff.'],
  ['references/', 'Procedural doctrine for coordination theory, FleetBar proof, salvage, distribution, and install surfaces.'],
  ['diagrams/', 'Flowchart, sequence, and lifecycle diagrams that make multi-agent coordination teachable.'],
  ['schemas/', 'Machine-checkable coordination notes, agent handoffs, and validation reports.'],
  ['scripts/', 'Validators and context diagnostics so agents can prove the skill is installed and usable.'],
  ['examples/', 'Concrete builds that connect buttons, tests, webhooks, FleetBar, and the local console.'],
] as const

const SKILL_INSTALL_SURFACES = [
  ['Package', 'skills/port-daddy-agent-skill ships beside the Port Daddy binaries.'],
  ['Codex', '.codex/skills/port-daddy-agent-skill mirrors the same operating manual.'],
  ['Claude', '.claude/skills/port-daddy-agent-skill keeps Claude Code on the same doctrine.'],
  ['Agents', '.agents/skills/port-daddy-agent-skill gives AGENTS-aware tools the same contract.'],
  ['Gemini', '.gemini/extensions/port-daddy/skills/port-daddy-agent-skill keeps extension installs aligned.'],
] as const

const ESSENTIAL_TOOLS = [
  ['begin_session', 'Register identity, claim files, and start a recoverable session.'],
  ['end_session_full', 'Release files, close the session, and unregister the agent.'],
  ['whoami', 'Confirm the current agent, session, notes, and file claims.'],
  ['coordination_preflight', 'Check context, claims, symbols, salvage, tuples, channels, and locks before edits.'],
  ['claim_port', 'Get a deterministic port for a semantic identity.'],
  ['release_port', 'Release a semantic port claim.'],
  ['add_note', 'Append durable context to the session ledger.'],
  ['acquire_lock', 'Hold a TTL-protected distributed lock for critical sections.'],
  ['list_services', 'Inspect active service registrations and owners.'],
  ['fleet_init', 'Create a coordinated project fleet.'],
  ['swarm_awareness', 'Check live agents, sessions, file claims, and salvage.'],
  ['sitrep', 'Summarize what happened since the last active context.'],
  ['catch_me_up', 'Back-compatible alias for sitrep.'],
  ['spawn_agent', 'Launch a background agent with identity, budget, and heartbeat tracking.'],
  ['run_sortie', 'Launch and track a sortie mission record.'],
  ['drop_feedback', 'Record structured feedback for Cartographer to harvest.'],
  ['pd_discover', 'List categories, counts, names, and full schemas for more tools.'],
] as const

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  magic: Cpu,
  'session-lifecycle': Activity,
  advisor: Search,
  discovery: Search,
  ports: Anchor,
  sessions: Activity,
  notes: Terminal,
  locks: Database,
  messaging: Radio,
  agents: Users,
  actors: Users,
  inbox: Terminal,
  webhooks: Globe,
  integration: Layers,
  dns: Globe,
  briefing: LifeBuoy,
  tunnels: Globe,
  projects: Layers,
  changelog: GitBranch,
  activity: Activity,
  sorties: Bot,
  system: Database,
  tuples: Layers,
  'fleet-control': Cpu,
  semantic: GitBranch,
  feedback: LifeBuoy,
}

function SectionBand({
  id,
  children,
  tone = 'paper',
}: {
  id?: string
  children: ReactNode
  tone?: 'paper' | 'sunken' | 'raised'
}) {
  const toneClass =
    tone === 'sunken'
      ? 'bg-[var(--surface-sunken)]'
      : tone === 'raised'
        ? 'bg-[var(--surface-raised)]'
        : 'bg-[var(--surface-base)]'

  return (
    <section
      id={id}
      className={`${toneClass} border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]`}
    >
      {children}
    </section>
  )
}

function MetricStrip() {
  return (
    <div className="grid border-2 border-[var(--border-strong)] md:grid-cols-3">
      {PROOF_METRICS.map((metric, index) => (
        <SurfacePanel
          key={metric.label}
          tone={metric.tone}
          elevation="quiet"
          className={index < PROOF_METRICS.length - 1 ? 'border-b-2 md:border-b-0 md:border-r-2' : ''}
        >
          <PanelTitle
            as="p"
            size="card"
            tone={metric.tone === 'blue' ? 'primary' : metric.tone === 'accent' ? 'accent' : 'default'}
          >
            {metric.value}
          </PanelTitle>
          <PanelEyebrow
            tone={metric.tone === 'blue' ? 'primary' : metric.tone === 'accent' ? 'accent' : 'default'}
            className="mt-[var(--space-2)]"
          >
            {metric.label}
          </PanelEyebrow>
        </SurfacePanel>
      ))}
    </div>
  )
}

function RuntimeTable() {
  return (
    <SurfacePanel className="overflow-hidden p-0">
      <div className="grid border-b-2 border-[var(--border-strong)] bg-[var(--surface-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
        <span>Backend</span>
        <span className="hidden sm:block">Tier ladder</span>
        <span className="hidden sm:block">Launch path</span>
      </div>
      {RUNTIME_BACKENDS.map((backend) => (
        <div
          key={backend.name}
          className="grid gap-[var(--space-2)] border-b border-[var(--border-subtle)] px-[var(--space-4)] py-[var(--space-3)] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]"
        >
          <PanelTitle as="p" size="nav">
            {backend.name}
          </PanelTitle>
          <PanelBody size="compact" className="max-w-none">
            {backend.tier}
          </PanelBody>
          <PanelBody size="compact" className="max-w-none">
            {backend.surface}
          </PanelBody>
        </div>
      ))}
    </SurfacePanel>
  )
}

function ToolCard({ tool }: { tool: MagicTool }) {
  const panelTone = tool.tone === 'blue' ? 'primary' : tool.tone === 'accent' ? 'accent' : 'default'

  return (
    <article className="min-w-0">
      <SurfacePanel tone={tool.tone} className="flex h-full flex-col gap-[var(--panel-gap)]">
        <div className="flex items-start gap-[var(--panel-gap-tight)]">
          <div className="flex h-[var(--space-7)] w-[var(--space-7)] shrink-0 items-center justify-center border-2 border-current">
            <tool.icon aria-hidden="true" className="h-[var(--space-5)] w-[var(--space-5)]" />
          </div>
          <div className="space-y-[var(--space-1)]">
            <PanelEyebrow tone={panelTone}>MCP tool</PanelEyebrow>
            <PanelTitle as="h3" size="nav" tone={panelTone}>
              {tool.name}
            </PanelTitle>
          </div>
        </div>
        <PanelBody size="compact" tone={tool.tone === 'blue' ? 'primary' : tool.tone === 'accent' ? 'accent' : 'default'} className="max-w-none">
          {tool.description}
        </PanelBody>
        <DocsCodeBlock code={tool.example} language="typescript" label={tool.tagline} />
      </SurfacePanel>
    </article>
  )
}

function ChannelTabs() {
  const [active, setActive] = useState(CHANNEL_SURFACES[0].id)
  const surface = CHANNEL_SURFACES.find((item) => item.id === active) ?? CHANNEL_SURFACES[0]
  const activeIndex = CHANNEL_SURFACES.findIndex((item) => item.id === active)
  const focusTab = (index: number) => {
    const next = CHANNEL_SURFACES[index]
    if (!next) return
    document.getElementById(`mcp-channel-tab-${next.id}`)?.focus()
    setActive(next.id)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault()
      focusTab((index + 1) % CHANNEL_SURFACES.length)
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTab((index - 1 + CHANNEL_SURFACES.length) % CHANNEL_SURFACES.length)
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusTab(0)
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusTab(CHANNEL_SURFACES.length - 1)
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-[var(--space-5)] lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div role="tablist" aria-label="Pub/sub access path" aria-orientation="vertical" className="grid min-w-0 gap-[var(--space-2)]">
        {CHANNEL_SURFACES.map((item, index) => (
          <button
            key={item.id}
            id={`mcp-channel-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={active === item.id}
            aria-controls={`mcp-channel-panel-${item.id}`}
            tabIndex={activeIndex === index ? 0 : -1}
            onClick={() => setActive(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className="group flex w-full items-center justify-between border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--space-3)] text-left text-[var(--text-primary)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] aria-selected:bg-[var(--brand-primary)] aria-selected:text-[var(--brand-primary-foreground)]"
          >
            <span className="flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]">
              <item.icon aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)]" />
              {item.label}
            </span>
            <ArrowRight aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)] opacity-60 transition-transform group-hover:translate-x-1" />
          </button>
        ))}
      </div>
      <div id={`mcp-channel-panel-${surface.id}`} role="tabpanel" aria-labelledby={`mcp-channel-tab-${surface.id}`} className="min-w-0">
        <SurfacePanel className="space-y-[var(--panel-gap)]">
          <div className="space-y-[var(--space-2)]">
            <PanelEyebrow>{surface.label}</PanelEyebrow>
            <PanelTitle as="h3" size="card">
              One channel, reached four ways.
            </PanelTitle>
            <PanelBody size="compact" className="max-w-[42rem]">
              {surface.note}
            </PanelBody>
          </div>
          <DocsCodeBlock code={surface.code} language={surface.language} label={`${surface.label} example`} />
        </SurfacePanel>
      </div>
    </div>
  )
}

function LifecycleDiagram() {
  const steps = [
    ['missed check-in', 'The agent stops sending heartbeats'],
    ['salvage', 'Its notes and file claims are kept'],
    ['budget check', 'Restart only if money is left'],
    ['respawn', 'Same identity comes back up'],
  ] as const

  return (
    <div className="grid gap-[var(--space-3)] sm:grid-cols-4">
      {steps.map(([label, description], index) => (
        <div key={label} className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
          <PanelEyebrow>{String(index + 1).padStart(2, '0')}</PanelEyebrow>
          <PanelTitle as="h3" size="nav" className="mt-[var(--space-2)]">
            {label}
          </PanelTitle>
          <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
            {description}
          </PanelBody>
        </div>
      ))}
    </div>
  )
}

function EssentialTools() {
  return (
    <div className="grid gap-[var(--space-3)] md:grid-cols-2">
      {ESSENTIAL_TOOLS.map(([name, description]) => (
        <SurfacePanel key={name} elevation="quiet" padding="compact" className="flex gap-[var(--space-3)]">
          <Check aria-hidden="true" className="mt-[var(--space-1)] h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary)]" />
          <div>
            <PanelTitle as="h3" size="nav">
              {name}
            </PanelTitle>
            <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
              {description}
            </PanelBody>
          </div>
        </SurfacePanel>
      ))}
    </div>
  )
}

function DiscoverGrid() {
  return (
    <div className="grid gap-[var(--space-3)] md:grid-cols-2 xl:grid-cols-3">
      {ALL_CATEGORIES.map((category) => {
        const Icon = CATEGORY_ICONS[category.id] ?? Cpu

        return (
          <SurfacePanel key={category.id} padding="compact" elevation="quiet" className="space-y-[var(--space-3)]">
            <div className="flex items-start justify-between gap-[var(--space-3)]">
              <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                <Icon aria-hidden="true" className="h-[var(--space-5)] w-[var(--space-5)] shrink-0 text-[var(--brand-primary)]" />
                <PanelTitle as="h3" size="nav">
                  {category.label}
                </PanelTitle>
              </div>
              <PanelEyebrow className="shrink-0">{category.tools.length} tools</PanelEyebrow>
            </div>
            <PanelBody size="compact" className="max-w-none">
              {category.description}
            </PanelBody>
            <div className="flex flex-wrap gap-[var(--space-1)]">
              {category.tools.map((tool) => (
                <code
                  id={tool}
                  key={tool}
                  className="scroll-mt-[calc(var(--space-10)+var(--space-6))] border border-[var(--border-subtle)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]"
                >
                  {tool}
                </code>
              ))}
            </div>
          </SurfacePanel>
        )
      })}
    </div>
  )
}

export default function McpPage() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 })

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans text-[var(--text-primary)]"
    >
      <motion.div
        aria-hidden="true"
        className="fixed left-0 right-0 top-[var(--nav-height)] z-[100] h-[3px] origin-left bg-[var(--brand-primary)]"
        style={{ scaleX }}
      />

      <main id="main-content">
        <header className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
          <PageContainer
            width="wide"
            className="pb-[var(--space-8)] pt-[var(--section-space-y)] lg:pb-[var(--space-9)] lg:pt-[var(--space-8)]"
          >
            <SwissGrid className="items-start">
              <SwissGridItem span="wide" className="space-y-[var(--space-6)]">
                <PanelEyebrow>Skills + MCP</PanelEyebrow>
                <div className="space-y-[var(--space-5)]">
                  <PanelTitle as="h1" size="hero" className="max-w-[16ch]">
                    Run a fleet of coding agents without losing track.
                  </PanelTitle>
                  <PanelBody className="max-w-[48rem]">
                    Two parts work together. The Port Daddy agent skill teaches an AI agent how to work alongside others. The MCP server gives it the tools to do so: claim a file, leave a note, take a lock, ask who else is active. Both run through one local app on your machine.
                  </PanelBody>
                  <PanelBody className="max-w-[48rem]">
                    The skill is the instruction manual. The MCP server is the set of controls. Any tool that speaks MCP — Claude, Cursor, Windsurf, Codex — can pick up the controls and read from the same shared memory. Nothing happens silently.
                  </PanelBody>
                </div>
                <div className="flex flex-wrap gap-[var(--space-3)]">
                  <BracketLink to="/docs/mcp" tone="blue">
                    Read MCP docs
                  </BracketLink>
                  <BracketLink to="/docs/guides/prompting-agents" tone="accent">
                    Prompt agents
                  </BracketLink>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <SurfacePanel tone="blue" className="space-y-[var(--panel-gap-loose)]">
                  <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                    <picture>
                      <source srcSet="/img/generated/control-plane-og.webp" type="image/webp" />
                      <img
                        src="/img/generated/control-plane-og.jpg"
                        alt="Diagram of agents connected through one local app, sharing file claims, locks, ports, and recovery paths"
                        className="block aspect-[16/9] w-full object-cover"
                      />
                    </picture>
                  </figure>
                  <div className="space-y-[var(--space-2)]">
                    <PanelEyebrow tone="primary">Install path</PanelEyebrow>
                    <PanelTitle as="p" size="display" tone="primary">
                      pd mcp install
                    </PanelTitle>
                    <PanelBody tone="primary" className="max-w-none">
                      One local app. Any MCP client connects. Sessions are written down, so they survive a crash.
                    </PanelBody>
                  </div>
                  <DocsCodeBlock
                    code={`pd install
pd mcp install
python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill
pd begin --identity myapp:agent --purpose "coordinate through Skills + MCP"`}
                    language="cli"
                    label="Setup"
                  />
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </header>

        <SectionBand id="agent-skill">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="rail">
                <SectionIntro
                  eyebrow="Agent skill"
                  title="The instruction manual, written for agents."
                  description="The skill ships with the Port Daddy binaries and copies itself into the folders each tool reads from. So an agent in Claude, Cursor, or Codex starts with the same playbook for working next to other agents."
                  titleSize="display"
                />
              </SwissGridItem>
              <SwissGridItem span="body" className="space-y-[var(--panel-gap)]">
                <div className="grid gap-[var(--panel-gap)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <SurfacePanel tone="blue" className="space-y-[var(--panel-gap)]">
                    <PanelEyebrow tone="primary">What ships</PanelEyebrow>
                    <PanelTitle as="h2" size="card" tone="primary">
                      A step-by-step manual, not a one-line hint.
                    </PanelTitle>
                    <PanelBody tone="primary" className="max-w-none">
                      The skill teaches what to do, not just what exists: when to claim a file, when to take a lock,
                      when to leave a note for the next agent. WinDAGs explains the difference in{' '}
                      <a
                        href={PROCEDURAL_KNOWLEDGE_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold underline underline-offset-4"
                      >
                        why declarative knowledge is not enough
                      </a>
                      .
                    </PanelBody>
                    <div className="grid gap-[var(--space-2)]">
                      {SKILL_BUNDLE_ITEMS.map(([name, body]) => (
                        <div key={name} className="border-2 border-current bg-transparent p-[var(--space-3)]">
                          <PanelTitle as="h3" size="nav" tone="primary">
                            {name}
                          </PanelTitle>
                          <PanelBody size="compact" tone="primary" className="mt-[var(--space-1)] max-w-none">
                            {body}
                          </PanelBody>
                        </div>
                      ))}
                    </div>
                  </SurfacePanel>

                  <SurfacePanel className="space-y-[var(--panel-gap)]">
                    <PanelEyebrow>Install surfaces</PanelEyebrow>
                    <PanelTitle as="h2" size="card">
                      Same manual, every agent tool.
                    </PanelTitle>
                    <PanelBody className="max-w-none">
                      Port Daddy copies one source skill into the folder each tool reads from, so no two clients drift apart. At runtime, the MCP server hands those same clients the tools the manual describes.
                    </PanelBody>
                    <div className="grid gap-[var(--space-2)]">
                      {SKILL_INSTALL_SURFACES.map(([label, body]) => (
                        <div key={label} className="grid gap-[var(--space-1)] border-2 border-[var(--border-default)] bg-[var(--surface-base)] p-[var(--space-3)]">
                          <PanelEyebrow>{label}</PanelEyebrow>
                          <PanelBody size="compact" className="max-w-none">
                            {body}
                          </PanelBody>
                        </div>
                      ))}
                    </div>
                    <DocsCodeBlock
                      code={`pd status
pd briefing
pd mcp install
python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill
bash skills/port-daddy-agent-skill/scripts/diagnose_port_daddy_agent_context.sh`}
                      language="cli"
                      label="Skills + MCP readiness"
                    />
                  </SurfacePanel>
                </div>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </SectionBand>

        <SectionBand tone="raised">
          <PageContainer width="wide" className="space-y-[var(--space-6)]">
            <MetricStrip />
            <RuntimeTable />
          </PageContainer>
        </SectionBand>

      <SectionBand id="tools">
        <PageContainer width="wide">
          <SwissGrid>
            <SwissGridItem span="rail">
              <SectionIntro
                eyebrow="Core MCP tools"
                title="A handful of calls do most of the coordinating."
                description="These are not thin wrappers around shell commands. Each call carries who the agent is, what it is allowed to spend, which files it holds, and what to keep if it dies."
                titleSize="display"
              />
            </SwissGridItem>
            <SwissGridItem span="body">
              <div className="grid gap-[var(--space-5)] md:grid-cols-2 xl:grid-cols-3">
                {MAGIC_TOOLS.map((tool) => (
                  <ToolCard key={tool.name} tool={tool} />
                ))}
              </div>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </SectionBand>

      <SectionBand id="channels" tone="sunken">
        <PageContainer width="wide">
          <SwissGrid>
            <SwissGridItem span="rail">
              <SectionIntro
                eyebrow="Pub/sub channels"
                title="One channel, reached four ways."
                description="A git hook, an AI client, a typed app, and a curl command can all publish to and read from the same channel. So a background agent and the agent you are talking to see the same events."
                titleSize="display"
              />
            </SwissGridItem>
            <SwissGridItem span="body">
              <ChannelTabs />
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </SectionBand>

      <SectionBand id="fleet">
        <PageContainer width="wide">
          <SwissGrid className="items-start">
            <SwissGridItem span="wide" className="space-y-[var(--section-intro-gap)]">
            <SectionIntro
              eyebrow="Fleet recovery"
              title="When an agent dies, its work is still on the table."
              description="A crashed agent can restart on its own. What matters more is what survives the crash: its notes, its unfinished work, and its spending limit all stay visible, so a restart picks up where it stopped instead of starting blind."
              titleSize="display"
            />
            <LifecycleDiagram />
            </SwissGridItem>
            <SwissGridItem span="narrow">
              <SurfacePanel className="space-y-[var(--panel-gap)]">
                <PanelEyebrow>pd-fleet.yml</PanelEyebrow>
                <DocsCodeBlock
                  code={`fleet:
  name: myapp
  agents:
    qa:
      trigger: git:committed
      backend: cloudflare
      model: '@cf/qwen/qwen3-30b-a3b-fp8'
      respawn: true
      max_respawns: 3
      prompt: |
        Review the last commit. File bugs.

    spark:
      schedule: "*/30 * * * *"
      backend: codex
      model_tier: low
      budget_usd_per_day: 1.00
      prompt: |
        Propose one codebase improvement.`}
                  language="text"
                  label="Fleet config"
                />
              </SurfacePanel>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </SectionBand>

      <SectionBand id="memory" tone="raised">
        <PageContainer width="wide">
          <SwissGrid className="items-start">
            <SwissGridItem span="half" className="space-y-[var(--section-intro-gap)]">
            <SectionIntro
              eyebrow="Shared memory"
              title="A scratchpad agents read and write by pattern."
              description="One agent writes a fact, like a finding or a pending task. Another reads it back by matching a pattern, or claims a work item so no one else picks it up. They coordinate through structured entries instead of re-reading each other's prose."
              titleSize="display"
            />
            <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
              {[
                ['tuple_out', 'write'],
                ['tuple_rd', 'read'],
                ['tuple_in', 'take'],
                ['tuple_scan', 'inspect'],
                ['tuple_count', 'measure'],
                ['pd tuple', 'operate'],
              ].map(([name, label]) => (
                <SurfacePanel key={name} elevation="quiet" padding="compact">
                  <PanelTitle as="p" size="nav">
                    {name}
                  </PanelTitle>
                  <PanelEyebrow className="mt-[var(--space-1)]">{label}</PanelEyebrow>
                </SurfacePanel>
              ))}
            </div>
            </SwissGridItem>
            <SwissGridItem span="half">
              <DocsCodeBlock
                code={`await tuple_out({
  tuple: ["connection", "trie+pubsub=routing", "spider", 0.9],
  harbor: "myapp:fleet"
})

const finds = await tuple_rd({
  pattern: ["connection", "*", "*", ">0.7"],
  harbor: "myapp:fleet"
})

const task = await tuple_in({
  pattern: ["task", "*", "pending"],
  harbor: "myapp:fleet"
})`}
                language="typescript"
                label="Tuple coordination"
              />
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </SectionBand>

      <SectionBand id="discovery">
        <PageContainer width="wide" className="space-y-[var(--space-7)]">
          <SwissGrid>
            <SwissGridItem span="wide">
              <SectionIntro
                eyebrow="Tool discovery"
                title="A short default list. The rest on request."
                description={`Every turn an agent reads its tool list costs tokens, so a wall of ${MCP_TOOL_TOTAL} tools would slow every call. It starts with ${MCP_DEFAULT_TOOL_TOTAL} essentials and asks for a specialized group only when a task needs one.`}
                titleSize="display"
              />
            </SwissGridItem>
            <SwissGridItem span="narrow">
              <EssentialTools />
            </SwissGridItem>
          </SwissGrid>
          <DiscoverGrid />
        </PageContainer>
      </SectionBand>

        <SectionBand tone="sunken">
          <PageContainer className="space-y-[var(--space-6)] text-center">
            <PanelEyebrow>Get started</PanelEyebrow>
            <PanelTitle as="h2" size="display" className="mx-auto max-w-[18ch]">
              Point your MCP client at one shared source of truth.
            </PanelTitle>
            <PanelBody className="mx-auto max-w-[44rem]">
              Install the app, connect the MCP server, and start a session. Your agents then share the same files, locks, and notes you already see in the CLI and the dashboard.
            </PanelBody>
            <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
              <Link
                to="/docs/quickstart"
                className="inline-flex min-h-[calc(var(--space-6)+var(--space-1))] items-center border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary-foreground)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
              >
                Quick start
              </Link>
              <Link
                to="/docs/mcp"
                className="inline-flex min-h-[calc(var(--space-6)+var(--space-1))] items-center border-2 border-[var(--border-strong)] bg-[var(--brand-accent)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-accent-foreground)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
              >
                MCP reference
              </Link>
            </div>
          </PageContainer>
        </SectionBand>
      </main>

      <Footer />
    </motion.div>
  )
}
