import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import {
  Activity,
  Anchor,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Boxes,
  Cable,
  Cpu,
  FileText,
  Globe,
  Inbox,
  Lock,
  Radio,
  ScrollText,
  Sparkles,
  Webhook,
  Workflow,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { ALL_CATEGORIES, ESSENTIAL_TOOLS } from '@/data/mcp'
import {
  BracketLabel,
  LandingStatsStrip,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  TerminalSurface,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'

type AccentTone = 'paper' | 'blue' | 'lime'

interface SetupCardBlock {
  label: string
  code: string
}

interface SetupCardLink {
  label: string
  href: string
}

interface SetupCardDefinition {
  step: string
  title: string
  description: string
  href: string
  hrefLabel: string
  tone: AccentTone
  blocks: SetupCardBlock[]
  links?: SetupCardLink[]
}

const heroStats = [
  { value: String(ESSENTIAL_TOOLS.length), label: 'tools loaded first', tone: 'paper' as const },
  { value: String(ALL_CATEGORIES.length), label: 'discoverable modules', tone: 'blue' as const },
  { value: '1 daemon', label: 'local control plane', tone: 'lime' as const },
] as const

const setupCards: SetupCardDefinition[] = [
  {
    step: 'Step 01',
    title: 'Install Port Daddy',
    description: 'Pick one install path. After that, every MCP client talks to the same local daemon.',
    href: '/tutorials/getting-started',
    hrefLabel: 'Open getting started',
    tone: 'paper' as AccentTone,
    blocks: [
      { label: 'Homebrew', code: 'brew install curiositech/tap/port-daddy' },
      { label: 'npm', code: 'npm install -g port-daddy' },
    ],
  },
  {
    step: 'Step 02',
    title: 'Start the daemon',
    description: 'Bring up the control plane once, then verify the runtime answered before you wire any editors.',
    href: '/docs/cli/init',
    hrefLabel: 'See init flow',
    tone: 'paper' as AccentTone,
    blocks: [{ label: 'Daemon', code: 'pd start\npd status' }],
  },
  {
    step: 'Step 03',
    title: 'Wire MCP clients',
    description: 'Have Port Daddy detect installed editors and write the MCP server config for them.',
    href: '/docs/cli/mcp-install',
    hrefLabel: 'Read MCP install docs',
    tone: 'blue' as AccentTone,
    blocks: [{ label: 'MCP install', code: 'pd mcp install --list\npd mcp install' }],
    links: [
      { label: 'Claude Code', href: '/docs/mcp/claude' },
      { label: 'Cursor', href: '/docs/mcp/cursor' },
      { label: 'Windsurf', href: '/docs/mcp/windsurf' },
    ],
  },
  {
    step: 'Optional',
    title: 'Bootstrap a fleet later',
    description: 'Once the MCP is live, generate a background agent fleet and its git-triggered operator loop.',
    href: '/docs/cli/fleet',
    hrefLabel: 'Read fleet docs',
    tone: 'lime' as AccentTone,
    blocks: [{ label: 'Fleet', code: 'pd fleet init' }],
  },
] as const

const categoryMeta = {
  'session-lifecycle': { icon: Sparkles, href: '/docs/mcp/begin-session' },
  ports: { icon: Anchor, href: '/docs/mcp/claim-port' },
  sessions: { icon: Workflow, href: '/docs/mcp/begin-session' },
  notes: { icon: FileText, href: '/docs/mcp/add-note' },
  locks: { icon: Lock, href: '/docs/mcp/acquire-lock' },
  messaging: { icon: Radio, href: '/docs/mcp/publish-message' },
  agents: { icon: Bot, href: '/docs/mcp/spawn-agent' },
  inbox: { icon: Inbox, href: '/docs/mcp' },
  webhooks: { icon: Webhook, href: '/docs/mcp' },
  integration: { icon: Cable, href: '/docs/mcp' },
  dns: { icon: Globe, href: '/docs/mcp/dns-register' },
  briefing: { icon: ScrollText, href: '/docs/mcp' },
  tunnels: { icon: Cable, href: '/docs/mcp/tunnel' },
  projects: { icon: Boxes, href: '/docs/mcp' },
  changelog: { icon: FileText, href: '/docs/mcp' },
  activity: { icon: Activity, href: '/docs/mcp' },
  system: { icon: Cpu, href: '/docs/mcp/status' },
} as const

const operatorPrompts = [
  {
    label: 'Bootstrap',
    title: 'Stand up the background layer',
    description: 'Have the MCP create the fleet artifact and install the repo hook instead of narrating the idea of doing it.',
    prompt:
      'Set up a background QA, docs, and reviewer fleet for this repo.\nWrite pd-fleet.yml and install the git commit hook.',
    href: '/docs/cli/fleet',
    hrefLabel: 'Open fleet docs',
    modules: ['Fleet & Agents', 'Messaging', 'Projects'],
    tone: 'blue' as AccentTone,
  },
  {
    label: 'Awareness',
    title: 'See who is already working here',
    description: 'Use the MCP to surface active agents, open sessions, file claims, and recent notes before you edit.',
    prompt:
      'Show me active agents, open sessions, recent notes, and file claims for this repo.\nTell me what needs salvage before I start.',
    href: '/docs/mcp/begin-session',
    hrefLabel: 'Open session docs',
    modules: ['Session Lifecycle', 'Agents', 'Notes'],
    tone: 'paper' as AccentTone,
  },
  {
    label: 'Recovery',
    title: 'Catch up after lost context',
    description: 'The public page should show what the MCP is good at: reconstructing state, not pretending to be raw RPC syntax.',
    prompt:
      'Catch me up on what happened in this repo since this morning:\ncommits, notes, agent events, and anything salvageable.',
    href: '/docs/mcp/salvage',
    hrefLabel: 'Open salvage docs',
    modules: ['Agents', 'Briefing', 'Notes'],
    tone: 'paper' as AccentTone,
  },
  {
    label: 'Infrastructure',
    title: 'Claim stable local services',
    description: 'Ask for deterministic ports, DNS registration, and collision handling in one operator request.',
    prompt:
      'Claim a stable port for myapp:api:main, register myapp-api.local,\nand tell me which service already owns it if the claim collides.',
    href: '/docs/mcp/claim-port',
    hrefLabel: 'Open port docs',
    modules: ['Ports', 'DNS', 'Locks'],
    tone: 'lime' as AccentTone,
  },
] as const

function SetupCard({
  card,
}: {
  card: SetupCardDefinition
}) {
  const panelTone = card.tone === 'blue' ? 'primary' : card.tone === 'lime' ? 'accent' : 'default'

  return (
    <SurfacePanel tone={card.tone} className="flex h-full flex-col gap-[var(--panel-gap)]">
      <div className="flex items-start justify-between gap-[var(--space-3)] border-b-2 border-current/15 pb-[var(--space-3)]">
        <div className="space-y-[var(--space-1)]">
          <BracketLabel tone={panelTone} surface={card.tone} className="self-start">
            {card.step}
          </BracketLabel>
          <PanelTitle as="h2" size="card" tone={panelTone} className="max-w-[14ch]">
            {card.title}
          </PanelTitle>
        </div>
      </div>

      <PanelBody tone={card.tone === 'paper' ? 'default' : card.tone === 'blue' ? 'primary' : 'accent'} size="compact" className="max-w-none">
        {card.description}
      </PanelBody>

      <div
        className={cn(
          'grid gap-[var(--space-3)]',
          card.blocks.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {card.blocks.map((block) => (
          <div key={block.label} className="space-y-[var(--space-2)]">
            <BracketLabel tone={panelTone} surface={card.tone} className="self-start">
              {block.label}
            </BracketLabel>
            <TerminalSurface code={block.code} title={block.label} />
          </div>
        ))}
      </div>

      {card.links ? (
        <div className="flex flex-wrap gap-[var(--space-2)] border-t-2 border-current/15 pt-[var(--space-3)]">
          {card.links.map((link) => (
            <Link key={link.href} to={link.href} className="no-underline">
              <BracketLabel tone={panelTone} surface={card.tone}>
                {link.label}
              </BracketLabel>
            </Link>
          ))}
        </div>
      ) : null}

      <Link
        to={card.href}
        className="mt-auto inline-flex items-center gap-[var(--space-2)] no-underline"
      >
        <PanelEyebrow tone={panelTone}>{card.hrefLabel}</PanelEyebrow>
        <ArrowUpRight
          size={14}
          className={card.tone === 'blue'
            ? 'text-[var(--brand-primary-foreground)]'
            : card.tone === 'lime'
              ? 'text-[var(--brand-accent-foreground)]'
              : 'text-[var(--brand-primary)]'}
        />
      </Link>
    </SurfacePanel>
  )
}

function EssentialToolRow({
  name,
  description,
  index,
}: {
  name: string
  description: string
  index: number
}) {
  return (
    <div
      className={cn(
        'grid gap-[var(--space-2)] py-[var(--space-3)] md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] md:items-start',
        index > 0 ? 'border-t-2 border-[color:var(--brand-primary-foreground-subtle)]' : '',
      )}
    >
      <PanelEyebrow tone="primary" className="text-[var(--brand-primary-foreground)]">
        {name}
      </PanelEyebrow>
      <PanelBody tone="primary" size="compact" className="max-w-none">
        {description}
      </PanelBody>
    </div>
  )
}

function CategoryCard({
  category,
  index,
}: {
  category: (typeof ALL_CATEGORIES)[number]
  index: number
}) {
  const meta = categoryMeta[category.id as keyof typeof categoryMeta]
  const Icon = meta?.icon ?? Cpu
  const href = meta?.href ?? '/docs/mcp'
  const accentTone: AccentTone = index % 6 === 0 ? 'blue' : index % 6 === 3 ? 'lime' : 'paper'
  const panelTone =
    accentTone === 'blue' ? 'primary' : accentTone === 'lime' ? 'accent' : 'default'
  const toolPreview = category.tools.slice(0, 3)

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.28, delay: index * 0.015, ease: 'easeOut' }}
      className="h-full"
    >
      <Link to={href} className="block h-full no-underline">
        <SurfacePanel
          tone={accentTone}
          padding="compact"
          className="flex h-full flex-col gap-[var(--panel-gap)] transition-transform duration-150 hover:-translate-y-1"
        >
          <div className="flex items-start justify-between gap-[var(--space-3)] border-b-2 border-current/15 pb-[var(--space-3)]">
            <div className="space-y-[var(--space-1)]">
              <BracketLabel tone={panelTone} surface={accentTone} className="self-start">
                {category.tools.length} tools
              </BracketLabel>
              <PanelTitle as="h3" size="nav" tone={panelTone}>
                {category.label}
              </PanelTitle>
            </div>
            <Icon
              size={18}
              className={accentTone === 'blue'
                ? 'text-[var(--brand-primary-foreground)]'
                : accentTone === 'lime'
                  ? 'text-[var(--brand-accent-foreground)]'
                  : 'text-[var(--brand-primary)]'}
            />
          </div>

          <PanelBody
            tone={accentTone === 'paper' ? 'default' : accentTone === 'blue' ? 'primary' : 'accent'}
            size="compact"
            className="max-w-none"
          >
            {category.description}
          </PanelBody>

          <div className="mt-auto flex flex-wrap gap-[var(--space-2)] border-t-2 border-current/15 pt-[var(--space-3)]">
            {toolPreview.map((tool) => (
              <BracketLabel key={tool} tone={panelTone} surface={accentTone}>
                {tool}
              </BracketLabel>
            ))}
          </div>
        </SurfacePanel>
      </Link>
    </motion.article>
  )
}

function PromptCard({
  prompt,
}: {
  prompt: (typeof operatorPrompts)[number]
}) {
  const panelTone =
    prompt.tone === 'blue' ? 'primary' : prompt.tone === 'lime' ? 'accent' : 'default'

  return (
    <SurfacePanel tone={prompt.tone} className="flex h-full flex-col gap-[var(--panel-gap)]">
      <div className="space-y-[var(--space-2)]">
        <BracketLabel tone={panelTone} surface={prompt.tone} className="self-start">
          {prompt.label}
        </BracketLabel>
        <PanelTitle as="h3" size="card" tone={panelTone} className="max-w-[14ch]">
          {prompt.title}
        </PanelTitle>
        <PanelBody
          tone={prompt.tone === 'paper' ? 'default' : prompt.tone === 'blue' ? 'primary' : 'accent'}
          size="compact"
          className="max-w-none"
        >
          {prompt.description}
        </PanelBody>
      </div>

      <TerminalSurface code={prompt.prompt} title="Ask in Claude Code" />

      <div className="flex flex-wrap gap-[var(--space-2)]">
        {prompt.modules.map((module) => (
          <BracketLabel key={module} tone={panelTone} surface={prompt.tone}>
            {module}
          </BracketLabel>
        ))}
      </div>

      <Link to={prompt.href} className="mt-auto inline-flex items-center gap-[var(--space-2)] no-underline">
        <PanelEyebrow tone={panelTone}>{prompt.hrefLabel}</PanelEyebrow>
        <ArrowRight
          size={14}
          className={prompt.tone === 'blue'
            ? 'text-[var(--brand-primary-foreground)]'
            : prompt.tone === 'lime'
              ? 'text-[var(--brand-accent-foreground)]'
              : 'text-[var(--brand-primary)]'}
        />
      </Link>
    </SurfacePanel>
  )
}

export default function McpPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-screen flex-col"
      style={{ background: 'var(--surface-base)' }}
    >
      <main className="flex-1">
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer
            width="wide"
            className="grid gap-[var(--space-6)] xl:grid-cols-[minmax(0,1.02fr)_minmax(26rem,0.98fr)] xl:items-start"
          >
            <div className="space-y-[var(--space-5)]">
              <BracketLabel>MCP operator surface</BracketLabel>

              <div className="space-y-[var(--space-3)]">
                <PanelTitle as="h1" size="hero" className="max-w-[8ch]">
                  Install once. Wire every agent.
                </PanelTitle>
                <div className="inline-flex border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-[var(--space-3)] py-[var(--space-2)]">
                  <PanelTitle as="p" size="section" tone="primary" className="max-w-none">
                    One daemon. Shared tools. Real operator flow.
                  </PanelTitle>
                </div>
              </div>

              <PanelBody className="max-w-[46rem]">
                The MCP page should teach the actual sequence: install Port Daddy, start the
                daemon, let it configure your editors, then move into ports, sessions, notes,
                locks, and fleets. No fake RPC theater, no made-up dashboard syntax.
              </PanelBody>

              <LandingStatsStrip stats={heroStats} />
            </div>

            <div className="grid gap-[var(--space-4)] md:grid-cols-2">
              {setupCards.map((card) => (
                <SetupCard key={card.title} card={card} />
              ))}
            </div>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide" className="space-y-[var(--space-6)]">
            <div className="max-w-[46rem] space-y-[var(--space-3)]">
              <BracketLabel>Discoverable modules</BracketLabel>
              <PanelTitle as="h2" size="display" className="max-w-[12ch]">
                Start small. Open more only when the repo needs it.
              </PanelTitle>
              <PanelBody className="max-w-[44rem]">
                Port Daddy should not dump the entire tool catalog into every client session. It
                loads the operator basics first, then the rest becomes discoverable through
                category-specific docs and tool families.
              </PanelBody>
            </div>

            <div className="grid gap-[var(--space-4)] xl:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)]">
              <SurfacePanel tone="blue" className="space-y-[var(--panel-gap)]">
                <BracketLabel tone="primary" surface="blue" className="self-start">
                  Loaded first
                </BracketLabel>
                <PanelTitle as="h3" size="card" tone="primary" className="max-w-[13ch]">
                  Eight tools cover the operator basics before discovery expands the surface.
                </PanelTitle>
                <PanelBody tone="primary" size="compact" className="max-w-none">
                  Sessions, notes, ports, locks, salvage, and first-contact awareness belong in
                  the initial working set. Everything else should feel unlockable, not dumped.
                </PanelBody>
                <div className="grid gap-[var(--space-1)]">
                  {ESSENTIAL_TOOLS.map((tool, index) => (
                    <EssentialToolRow
                      key={tool.name}
                      name={tool.name}
                      description={tool.description}
                      index={index}
                    />
                  ))}
                </div>
              </SurfacePanel>

              <SurfacePanel tone="lime" className="space-y-[var(--panel-gap)]">
                <BracketLabel tone="accent" surface="lime" className="self-start">
                  Operator rule
                </BracketLabel>
                <PanelTitle as="h3" size="card" tone="accent" className="max-w-[13ch]">
                  Categories should open documentation, not sit there as dead decorative boxes.
                </PanelTitle>
                <PanelBody tone="accent" size="compact" className="max-w-none">
                  Each family below is clickable. The public site should make the surface legible
                  and explorable without inventing fake wire formats or pseudo-client syntax.
                </PanelBody>
                <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                  <TerminalSurface
                    title="Install flow"
                    code={'Install Port Daddy.\nStart the daemon.\nRun pd mcp install.\nThen browse the tool families below.'}
                  />
                  <TerminalSurface
                    title="Public promise"
                    code={'Real docs links.\nReal tool names.\nNo fake telemetry.\nNo pretend MCP call syntax.'}
                  />
                </div>
              </SurfacePanel>
            </div>

            <div className="grid gap-[var(--space-4)] md:grid-cols-2 xl:grid-cols-4">
              {ALL_CATEGORIES.map((category, index) => (
                <CategoryCard key={category.id} category={category} index={index} />
              ))}
            </div>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide" className="space-y-[var(--space-6)]">
            <div className="max-w-[44rem] space-y-[var(--space-3)]">
              <BracketLabel>Prompt patterns</BracketLabel>
              <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                What you actually ask the MCP to do.
              </PanelTitle>
              <PanelBody className="max-w-[44rem]">
                These are operator prompts, not pretend SDK calls. They match how MCP-equipped
                clients are actually used in Claude Code, Cursor, and similar environments.
              </PanelBody>
            </div>

            <div className="grid gap-[var(--space-4)] xl:grid-cols-2">
              {operatorPrompts.map((prompt) => (
                <PromptCard key={prompt.title} prompt={prompt} />
              ))}
            </div>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide" className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-[var(--space-3)]">
              <BracketLabel>Next move</BracketLabel>
              <PanelTitle as="h2" size="display" className="max-w-[13ch]">
                Install the server. Open the docs. Use the real thing.
              </PanelTitle>
              <PanelBody className="max-w-[42rem]">
                The public page should get operators to the live surface fast: install, wire MCP,
                inspect the module docs, and move into tutorials or fleet setup only when the
                local control plane is already real.
              </PanelBody>
            </div>

            <div className="flex flex-wrap gap-[var(--space-3)]">
              <Link to="/docs/cli/mcp-install" className="no-underline">
                <SurfacePanel tone="blue" padding="compact" className="min-w-[15rem]">
                  <BracketLabel tone="primary" surface="blue">
                    CLI
                  </BracketLabel>
                  <PanelTitle as="p" size="nav" tone="primary" className="mt-[var(--space-2)] max-w-none">
                    Open MCP install docs
                  </PanelTitle>
                </SurfacePanel>
              </Link>

              <Link to="/docs/mcp" className="no-underline">
                <SurfacePanel tone="paper" padding="compact" className="min-w-[15rem]">
                  <BracketLabel>Reference</BracketLabel>
                  <PanelTitle as="p" size="nav" className="mt-[var(--space-2)] max-w-none">
                    Browse all MCP docs
                  </PanelTitle>
                </SurfacePanel>
              </Link>
            </div>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
