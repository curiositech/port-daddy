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
  BracketLabel,
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
  { value: `${MCP_DEFAULT_TOOL_TOTAL}`, label: 'default tools before discovery', tone: 'accent' },
  { value: '1', label: 'local daemon for shared state', tone: 'paper' },
]

const PROCEDURAL_KNOWLEDGE_URL = 'https://windags.ai/blog/why-declarative-knowledge-isnt-enough'

const RUNTIME_BACKENDS: RuntimeBackend[] = [
  { name: 'Codex', tier: 'low / mid / high', surface: 'codex exec backend' },
  { name: 'Claude SDK', tier: 'haiku / sonnet / opus', surface: 'exact telemetry path' },
  { name: 'Claude CLI', tier: 'haiku / sonnet / opus', surface: 'local CLI auth' },
  { name: 'Gemini', tier: 'flash / flash / pro', surface: 'Google SDK path' },
  { name: 'Ollama', tier: 'local small / medium / large', surface: 'offline backend' },
  { name: 'Aider', tier: 'mini / standard / high', surface: 'Aider-managed edits' },
]

const MAGIC_TOOLS: MagicTool[] = [
  {
    name: 'fleet_init',
    tagline: 'Create a coordinated project fleet in one call.',
    icon: Cpu,
    tone: 'blue',
    description:
      'Creates the fleet config, installs the scoped commit hook, and starts background agents through the Port Daddy daemon.',
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
    tagline: 'Ask who is active before an agent edits.',
    icon: Users,
    tone: 'paper',
    description:
      'Returns active agents, sessions, file claims, and salvage candidates so MCP clients can coordinate before touching files.',
    example: `const state = await swarm_awareness({ project: "myapp" })

// active: qa, cartographer
// claimed: src/auth/*.ts
// salvage: 1 abandoned session`,
  },
  {
    name: 'catch_me_up',
    tagline: 'Rebuild context from durable activity.',
    icon: Activity,
    tone: 'accent',
    description:
      'Summarizes notes, session activity, fleet events, commits, and salvage context since a timestamp or last handoff.',
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
    tagline: 'Launch background work with budget and identity.',
    icon: Bot,
    tone: 'blue',
    description:
      'Starts a backend agent with session registration, heartbeat, model tier, budget ceiling, notes, and salvage behavior.',
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
    tagline: 'See contention before it becomes a conflict.',
    icon: GitBranch,
    tone: 'paper',
    description:
      'Combines active claims and coordination signals into a file heat map for safer routing and review decisions.',
    example: `const heat = await file_heat({ project: "myapp" })

// src/auth/middleware.ts  0.87
// src/routes/login.ts    0.62
// src/db/schema.ts       0.21`,
  },
  {
    name: 'fleet_status',
    tagline: 'Inspect health without reading logs.',
    icon: Search,
    tone: 'accent',
    description:
      'Returns fleet agent state, recent notes, trigger channels, last run timestamps, and respawn counters.',
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
    note: 'The shell path is best for hooks, local scripts, and recovery flows you want to inspect later.',
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
    note: 'The MCP path lets model clients chain coordination without shell parsing.',
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
    note: 'The SDK path fits typed app integrations and long-running tools.',
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
    note: 'The REST/SSE path keeps non-TypeScript tools connected to the same Port Daddy state.',
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
            <BracketLabel>{surface.label}</BracketLabel>
            <PanelTitle as="h3" size="card">
              One channel, many clients.
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
    ['heartbeat gap', 'Detect stale body lease'],
    ['salvage', 'Preserve notes and claims'],
    ['budget check', 'Respect run ceiling'],
    ['respawn', 'Launch same identity'],
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
                  className="scroll-mt-24 border border-[var(--border-subtle)] bg-[var(--surface-base)] px-[var(--space-2)] py-[var(--space-1)] font-mono text-[0.72rem] text-[var(--text-secondary)]"
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
                <BracketLabel>Skill + MCP</BracketLabel>
                <div className="space-y-[var(--space-5)]">
                  <PanelTitle as="h1" size="hero" className="max-w-[12ch]">
                    The manual and the tool socket for serious agent coordination.
                  </PanelTitle>
                  <PanelBody className="max-w-[48rem]">
                    The Port Daddy agent skill teaches agents how to work together. The MCP server gives them the tools to do it: sessions, ports, claims, locks, notes, pub/sub, salvage, fleets, and tuple space wired through the same local daemon and console.
                  </PanelBody>
                  <PanelBody className="max-w-[48rem]">
                    Think of it as the instruction manual plus the control cable. The skill explains when to publish intent, claim a file, lock a critical section, inspect FleetBar, or leave a schema-shaped handoff. MCP makes those moves callable from Claude, Cursor, Windsurf, Codex-adjacent tools, and any client that speaks the protocol.
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
                        alt="Generated Swiss-modern diagram of an MCP-connected local control plane with agent nodes, locks, ports, and recovery paths"
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
                      One local daemon. MCP-compatible clients. Durable session truth.
                    </PanelBody>
                  </div>
                  <DocsCodeBlock
                    code={`pd install
pd mcp install
python3 skills/port-daddy-agent-skill/scripts/validate_port_daddy_agent_skill.py skills/port-daddy-agent-skill
pd begin --identity myapp:agent --purpose "coordinate through Skill + MCP"`}
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
                  title="The instruction manual is now first-class."
                  description="The skill is not hidden under the agent catalog. It is the operating manual for Port Daddy-aware agents, distributed with the binaries and mirrored into the tool-specific skill directories that agents actually read."
                  titleSize="display"
                />
              </SwissGridItem>
              <SwissGridItem span="body" className="space-y-[var(--panel-gap)]">
                <div className="grid gap-[var(--panel-gap)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <SurfacePanel tone="blue" className="space-y-[var(--panel-gap)]">
                    <BracketLabel tone="primary" surface="blue">
                      What ships
                    </BracketLabel>
                    <PanelTitle as="h2" size="card" tone="primary">
                      A procedural field manual, not a thin prompt.
                    </PanelTitle>
                    <PanelBody tone="primary" className="max-w-none">
                      Procedural knowledge is the repeatable operating know-how an agent uses under pressure, not
                      just facts about a tool. WinDAGs lays out the distinction in{' '}
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
                    <BracketLabel>Install surfaces</BracketLabel>
                    <PanelTitle as="h2" size="card">
                      One doctrine, every agent runner.
                    </PanelTitle>
                    <PanelBody className="max-w-none">
                      Port Daddy packages the source skill and mirrors it into the local skill locations so agents do not drift by client. The MCP server then exposes the same coordination primitives to those clients at runtime.
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
                      label="Skill + MCP readiness"
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

        <SectionBand id="agent-skill">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="rail">
                <SectionIntro
                  eyebrow="Agent skill"
                  title="The instruction manual is now first-class."
                  description="The skill is not hidden under the agent catalog. It is the operating manual for Port Daddy-aware agents, distributed with the binaries and mirrored into the tool-specific skill directories that agents actually read."
                  titleSize="display"
                />
              </SwissGridItem>
              <SwissGridItem span="body" className="space-y-[var(--panel-gap)]">
                <div className="grid gap-[var(--panel-gap)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <SurfacePanel tone="blue" className="space-y-[var(--panel-gap)]">
                    <BracketLabel tone="primary" surface="blue">
                      What ships
                    </BracketLabel>
                    <PanelTitle as="h2" size="card" tone="primary">
                      A procedural field manual, not a thin prompt.
                    </PanelTitle>
                    <PanelBody tone="primary" className="max-w-none">
                      Procedural knowledge is the repeatable operating know-how an agent uses under pressure, not
                      just facts about a tool. WinDAGs lays out the distinction in{' '}
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
                    <BracketLabel>Install surfaces</BracketLabel>
                    <PanelTitle as="h2" size="card">
                      One doctrine, every agent runner.
                    </PanelTitle>
                    <PanelBody className="max-w-none">
                      Port Daddy packages the source skill and mirrors it into the local skill locations so agents do not drift by client. The MCP server then exposes the same coordination primitives to those clients at runtime.
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
                      label="Skill + MCP readiness"
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
                eyebrow="High-level MCP tools"
                title="Useful calls that carry Port Daddy context."
                description="The MCP tools are not a loose bag of shell wrappers. The important calls preserve identity, budget, files, session notes, and recovery semantics."
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
                eyebrow="Pub/Sub radio"
                title="A channel is the same channel everywhere."
                description="CLI hooks, MCP clients, SDK integrations, and REST/SSE consumers publish into the same scoped channel model. That keeps background fleets and interactive agents synchronized."
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
              title="Respawn is a policy, not a hope."
              description="Fleet agents can restart after crashes, but the important behavior is recoverability: the daemon keeps session notes, salvage state, channel scope, and budget checks visible."
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
      backend: ollama
      model: qwen2.5-coder:7b
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
              eyebrow="Tuple space"
              title="Shared memory for parallel agents."
              description="Agents write structured facts into a harbor-scoped tuple space. Other agents read by pattern, take work items, and coordinate without scraping prose."
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
                title="Small default toolset, full system on demand."
                description="Agents should not start every turn with an overwhelming tool list. The default set stays tight, then specialized categories unlock only when the task needs them."
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
            <PanelEyebrow>Start coordinated</PanelEyebrow>
            <PanelTitle as="h2" size="display" className="mx-auto max-w-[14ch]">
              Give the next MCP client a real coordination path.
            </PanelTitle>
            <PanelBody className="mx-auto max-w-[44rem]">
              Install the daemon, wire the MCP server, start a session, and let agents use the same coordination features as the CLI and dashboard.
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
