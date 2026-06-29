import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  Ear,
  GitBranch,
  MessagesSquare,
  Radio,
  ShieldAlert,
  SignalHigh,
  Terminal,
  Users,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Button } from '@/components/ui/Button'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { ThemedImage } from '@/components/site/ThemedImage'
import { useTheme } from '@/lib/theme-context'

/**
 * Standalone marquee page at /harness. The argument: a bare vendor CLI is a
 * lone agent typing into the void. The harness sinks tentacles into that
 * CLI's own hook surface and turns it into a citizen of the fleet: it starts
 * each turn with the latest messages, joins the right channels, checks for
 * edit conflicts, gets CI failures back, calls a parley when work overlaps,
 * stops at budget, works in its own tree, and has destructive commands vetoed
 * with the safe alternative named.
 *
 * Source: ADR-0051 (eight harness capabilities). Tone is honest infrastructure,
 * not hype: Claude is fully wired today; Gemini and Codex hook surfaces are
 * mapped and being validated.
 *
 * Idiom matches SecurityPage / PdTube: lives under MainLayout (header only),
 * renders its own <Footer />, built entirely from site/primitives so every
 * type size inherits the a11y-floored tokens (meta 14px, body 18px).
 */

type Capability = {
  n: string
  icon: ComponentType<{ size?: number | string; className?: string }>
  title: string
  cardTitle?: string
  oneLiner: string
  detail: string
  figure: {
    input: string
    hook: string
    output: string
    proof: string
  }
}

const CAPABILITIES: readonly Capability[] = [
  {
    n: '01',
    icon: Ear,
    title: 'Starts with the latest messages',
    cardTitle: 'Starts with the latest messages',
    oneLiner: 'Every turn begins with the project notes and tube messages the agent missed.',
    detail:
      'Before the model decides what to do, Port Daddy adds unread notes, tube messages, and channel updates to the prompt. The agent sees what changed before it edits, tests, or replies.',
    figure: {
      input: 'Unread notes',
      hook: 'Before reply',
      output: 'Fresh context',
      proof: 'Attention, inbox, and subscribed channels are read before the agent gets its next turn.',
    },
  },
  {
    n: '02',
    icon: Radio,
    title: 'Joins the right channels',
    cardTitle: 'Joins the right channels',
    oneLiner: 'A new session is subscribed to the project and fleet channels before work starts.',
    detail:
      'When a session starts, the harness subscribes it to the places its work will happen. A teammate can broadcast once, and every relevant agent hears it without hand-wiring another subscription.',
    figure: {
      input: 'New session',
      hook: 'Subscribe',
      output: 'Project + fleet',
      proof: 'The project lane and fleet lane are attached before the first useful turn.',
    },
  },
  {
    n: '03',
    icon: Users,
    title: 'Checks who is editing',
    cardTitle: 'Checks who is editing',
    oneLiner: 'Before a write, the agent sees active sessions, file claims, and nearby work.',
    detail:
      'Before the agent touches a file, the harness shows it who already claimed that surface and what depends on it. The agent can wait, pick another path, or start a parley before it creates a merge mess.',
    figure: {
      input: 'Edit request',
      hook: 'Claim check',
      output: 'Clear path',
      proof: 'File claims, active sessions, and nearby work are surfaced before the write path.',
    },
  },
  {
    n: '04',
    icon: SignalHigh,
    title: 'Gets CI failures back',
    cardTitle: 'Gets CI failures back',
    oneLiner: 'A red check is sent to the session that pushed the branch.',
    detail:
      'A failing run lands with the agent that earned it. The session gets the error, fixes the branch, reruns the check, and pushes again without a human playing dispatcher.',
    figure: {
      input: 'CI failure',
      hook: 'Branch route',
      output: 'Fix request',
      proof: 'CI verdicts are routed back to the session that produced the branch.',
    },
  },
  {
    n: '05',
    icon: MessagesSquare,
    title: 'Calls a meeting when work overlaps',
    cardTitle: 'Calls a meeting when work overlaps',
    oneLiner: 'Overlapping agents get a structured conversation instead of stray chat.',
    detail:
      'When agents disagree or reach for the same surface, Port Daddy opens a conversation with named participants, turn order, and a way to end. The output is a decision another agent can read later.',
    figure: {
      input: 'Overlap',
      hook: 'Parley',
      output: 'Written decision',
      proof: 'The conversation has participants, order, exit criteria, and a durable result.',
    },
  },
  {
    n: '06',
    icon: CircleDollarSign,
    title: 'Stops when budget is gone',
    cardTitle: 'Stops when budget is gone',
    oneLiner: 'Every agent runs under a spend cap and a posted bond.',
    detail:
      'Each agent has a spending cap and a bond. If the next tool call would exceed the limit, the call is stopped before money leaves the account.',
    figure: {
      input: 'Tool call',
      hook: 'Spend check',
      output: 'Allowed or stopped',
      proof: 'Spend is checked at the call boundary where the expensive action would happen.',
    },
  },
  {
    n: '07',
    icon: GitBranch,
    title: 'Works outside your checkout',
    cardTitle: 'Works outside your checkout',
    oneLiner: 'Agent work is redirected into a linked git worktree.',
    detail:
      'The harness keeps agents out of the working copy you are sitting in. Their work happens in a linked git worktree, so an experiment can branch, fail, or be thrown away without disturbing your checkout.',
    figure: {
      input: 'Work request',
      hook: 'Worktree check',
      output: 'Own branch',
      proof: 'The live operator tree stays untouched while the agent works in a linked berth.',
    },
  },
  {
    n: '08',
    icon: Ban,
    title: 'Blocks irreversible commands',
    cardTitle: 'Blocks irreversible commands',
    oneLiner: 'Dangerous shell and git commands are intercepted before they run.',
    detail:
      'Commands like rm -rf and force push are caught before they run. The refusal names the reversible command the agent should use instead, so the agent can recover without guessing.',
    figure: {
      input: 'Risky command',
      hook: 'Guard check',
      output: 'Safer command',
      proof: 'The refusal names the reversible action, so the agent can recover without guessing.',
    },
  },
] as const

/** A small status pill for the vendor-support honesty table. */
function StatusPill({ tone, children }: { tone: 'live' | 'mapped'; children: ReactNode }) {
  const cls =
    tone === 'live'
      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
      : 'border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--text-secondary)]'
  return (
    <span
      className={`inline-flex items-center border-2 px-[var(--space-2)] py-[2px] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${cls}`}
    >
      {children}
    </span>
  )
}

function HarnessArtFigure({
  src,
  alt,
  caption,
  loading = 'lazy',
  className,
}: {
  src: string
  alt: string
  caption: string
  loading?: 'eager' | 'lazy'
  className?: string
}) {
  const { theme } = useTheme()
  const dark = theme === 'dark'

  return (
    <figure className={`space-y-[var(--space-2)] ${className ?? ''}`}>
      <div className="relative overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
        <ThemedImage
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          style={{
            filter: dark ? 'brightness(0.72) contrast(1.18) saturate(1.12)' : 'saturate(1.03)',
          }}
          width={1456}
          height={816}
          loading={loading}
          decoding="async"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: dark
              ? 'linear-gradient(180deg, rgba(11,13,16,0.12) 0%, rgba(11,13,16,0.54) 100%)'
              : 'linear-gradient(180deg, rgba(245,241,233,0) 0%, rgba(245,241,233,0.22) 100%)',
          }}
        />
      </div>
      <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
        {caption}
      </figcaption>
    </figure>
  )
}

function CapabilityFlowNode({
  label,
  icon: Icon,
  active = false,
}: {
  label: string
  icon: ComponentType<{ size?: number | string; className?: string }>
  active?: boolean
}) {
  const cls = active
    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
    : 'border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--text-primary)]'

  return (
    <div className={`grid min-h-[7.25rem] content-center gap-[var(--space-2)] border-2 p-[var(--space-3)] text-center ${cls}`}>
      <span className="mx-auto inline-flex h-10 w-10 items-center justify-center border-2 border-current">
        <Icon size={18} />
      </span>
      <span className="text-balance font-sans text-[length:var(--type-panel-body-compact-size)] font-black leading-[var(--leading-nav)]">
        {label}
      </span>
    </div>
  )
}

function CapabilityExplainer({ capability }: { capability: Capability }) {
  const Icon = capability.icon

  return (
    <SurfacePanel
      elevation="quiet"
      padding="default"
      className="mt-[var(--space-7)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]"
    >
      <div className="grid content-center gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)] p-[var(--space-4)]">
        <div className="grid gap-[var(--space-3)] sm:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)_2.5rem_minmax(0,1fr)] sm:items-center">
          <CapabilityFlowNode label={capability.figure.input} icon={Terminal} />
          <ArrowRight className="mx-auto rotate-90 text-[var(--brand-primary)] sm:rotate-0" size={24} />
          <CapabilityFlowNode label={capability.figure.hook} icon={Icon} active />
          <ArrowRight className="mx-auto rotate-90 text-[var(--brand-primary)] sm:rotate-0" size={24} />
          <CapabilityFlowNode label={capability.figure.output} icon={CheckCircle2} />
        </div>
        <div className="border-l-2 border-[var(--brand-primary)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)]">
          <PanelEyebrow>Contract proof</PanelEyebrow>
          <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
            {capability.figure.proof}
          </PanelBody>
        </div>
      </div>

      <div className="grid content-center gap-[var(--space-3)]">
        <div className="flex flex-wrap items-center gap-[var(--space-3)]">
          <span className="inline-flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] font-mono text-[length:var(--type-meta-size)] font-black text-[var(--brand-primary)]">
            {capability.n}
          </span>
          <PanelEyebrow>{capability.oneLiner}</PanelEyebrow>
        </div>
        <PanelTitle as="h3" size="display" className="max-w-[14ch]">
          {capability.title}
        </PanelTitle>
        <PanelBody className="max-w-[42rem]">
          {capability.detail}
        </PanelBody>
      </div>
    </SurfacePanel>
  )
}

const VENDOR_ROWS: readonly { vendor: string; status: 'live' | 'mapped'; note: string }[] = [
  {
    vendor: 'Claude Code',
    status: 'live',
    note: 'Fully wired. All eight capabilities run against Claude’s own hook surface, verified end to end.',
  },
  {
    vendor: 'Gemini CLI',
    status: 'mapped',
    note: 'Hook surface mapped. The same tentacles are being seated and validated against it now.',
  },
  {
    vendor: 'Codex CLI',
    status: 'mapped',
    note: 'Hook surface mapped. Validation in progress — honest status, not a promise.',
  },
] as const

type BackendExample = {
  runtime: string
  backend: string
  contract: string
  status: 'live' | 'mapped'
  command: string
}

const BACKEND_EXAMPLES: readonly BackendExample[] = [
  {
    runtime: 'Claude Code native',
    backend: 'Claude via Claude Code login or an official Anthropic gateway',
    contract:
      'The Articles bind to Claude Code hooks: turn-start attention, pre-tool vetoes, post-tool telemetry, MCP replies.',
    status: 'live',
    command: 'pd begin --identity myapp:api\nclaude',
  },
  {
    runtime: 'Claude Code shape, Codex behind',
    backend: 'OpenAI Codex CLI through `pd squid bridge`',
    contract:
      'Claude-shaped requests hit a local Anthropic-compatible bridge; provenance records the Codex model actually used.',
    status: 'live',
    command:
      'pd squid bridge --codex-model-alias claude-sonnet-4-5=gpt-5.1-codex -- claude --model claude-sonnet-4-5',
  },
  {
    runtime: 'Claude Code shape, open weights behind',
    backend: 'vLLM serving Gemma, Qwen, Llama, DeepSeek, or another tool-capable model',
    contract:
      'Claude Code keeps the hook layer; the gateway provides Anthropic Messages compatibility and tool-call shape.',
    status: 'mapped',
    command: 'ANTHROPIC_BASE_URL=http://localhost:8000 claude --model gemma-tool-coder',
  },
  {
    runtime: 'Ollama / Gemma adapter lane',
    backend: 'Local Ollama models behind a router that speaks Anthropic Messages',
    contract:
      'The Articles still bind to the harness; this lane stays experimental until streaming and tool-loop fixtures pass.',
    status: 'mapped',
    command: 'pd squid serve --port 8765 --token squid-local\n# adapter under test: ollama -> anthropic messages',
  },
  {
    runtime: 'Cloudflare Agent',
    backend: 'Durable cloud actor using Workers AI or provider APIs',
    contract:
      'The remote agent gets a Harbor identity, relay channel, PR duties, budget, and the same review/merge obligations.',
    status: 'mapped',
    command: 'pd relay status\npd contract award cloudflare:review-shepherd',
  },
] as const

export default function HarnessPage() {
  const [activeCapability, setActiveCapability] = useState(0)
  const selectedCapability = CAPABILITIES[activeCapability]

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const timer = window.setInterval(() => {
      setActiveCapability((current) => (current + 1) % CAPABILITIES.length)
    }, 5200)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="bg-[var(--surface-base)]">
      <main id="main-content">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--space-5)]">
                  <BracketLabel>The harness</BracketLabel>
                  <PanelTitle as="h1" size="hero" className="max-w-[15ch]">
                    A control plane for every coding agent.
                  </PanelTitle>
                  <HarnessArtFigure
                    src="/img/generated/harness-hero.webp"
                    alt="A rugged agent core in a harness cradle, with instrumented lines reaching into message radio, file claims, budget controls, worktree docks, and command guardrails."
                    caption="One agent core, eight instrumented lines into the fleet’s control plane."
                    loading="eager"
                    className="lg:hidden"
                  />
                  <PanelBody className="max-w-[46rem] text-[length:var(--type-panel-body-size)]">
                    Port Daddy Harness gives each agent the coordination layer it
                    needs: messages before each turn, project channels, edit-conflict
                    checks, CI feedback, parley when work overlaps, budget stops,
                    isolated worktrees, and command guardrails.
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--space-3)]">
                    <Button asChild variant="primary" size="lg">
                      <Link to="/docs/quickstart">
                        Run a harnessed agent
                        <ArrowRight size={16} />
                      </Link>
                    </Button>
                    <Button asChild variant="secondary" size="lg">
                      <a href="#capabilities">See the eight capabilities</a>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="wide">
                <HarnessArtFigure
                  src="/img/generated/harness-hero.webp"
                  alt="A single agent core at center, eight instrumented lines reaching out into a control plane of message tubes, a subscription rail, a swarm-ownership grid, a returning verdict path, a conversation loop, a budget meter, an isolated worktree, and an amber guard gate"
                  caption="One agent core, eight instrumented lines into the fleet’s control plane."
                  loading="eager"
                  className="hidden lg:block"
                />
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        {/* ── The spine: tentacles into the vendor hook surface ────────── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="narrow">
                <SectionIntro
                  eyebrow="The spine"
                  title="It hooks into the CLI you already run."
                  description="The harness is not a fork of your agent and not a wrapper that re-implements it. It seats itself into the vendor CLI’s own hook surface — the turn-start, pre-tool, post-tool, and command-intercept points the tool already exposes. Every capability below rides one of those hooks. There is no new agent to learn; the agent you have becomes a citizen of the fleet."
                  titleAs="h2"
                  titleSize="display"
                  titleClassName="max-w-[18ch]"
                  bodyClassName="max-w-[44rem]"
                />
                <div className="mt-[var(--space-5)] grid gap-[var(--space-3)]">
                  <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-2)]">
                    <div className="inline-flex items-center gap-[var(--space-2)]">
                      <Terminal size={16} className="text-[var(--brand-primary)]" />
                      <PanelEyebrow>Honest status</PanelEyebrow>
                    </div>
                    <PanelBody size="compact" className="max-w-none">
                      Claude Code is fully wired today — every capability verified against
                      its hooks. Gemini and Codex expose comparable hook surfaces; those
                      are mapped and being validated. This is real infrastructure, named
                      where it stands.
                    </PanelBody>
                  </SurfacePanel>
                </div>
              </SwissGridItem>

              <SwissGridItem span="wide">
                <HarnessArtFigure
                  src="/img/generated/harness-hooks.webp"
                  alt="A vendor command-line tool exposing four hook ports along its edge, with keyed couplings from the daemon seating into them — one connection fully seated and solid, the others dashed and partially seated to show validation in progress"
                  caption="The daemon seats into the CLI’s hook ports. One solid coupling is verified; the dashed ones are validating."
                />
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        {/* ── The eight capabilities ──────────────────────────────────── */}
        <section
          id="capabilities"
          className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
        >
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="What the harness grants"
              title="Eight jobs the harness does before an agent acts."
              description="These are practical jobs, not slogans. The harness gives every agent the messages, channels, claims, CI feedback, meetings, budget checks, worktree routing, and command guardrails it needs to work with the fleet."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[20ch]"
            />
            <CapabilityExplainer capability={selectedCapability} />

            <div className="mt-[var(--space-4)] grid grid-cols-2 gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] md:grid-cols-4">
              {CAPABILITIES.map((cap, index) => {
                const selected = index === activeCapability

                return (
                  <button
                    key={cap.n}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActiveCapability(index)}
                    className={`grid min-h-[9rem] gap-[var(--space-2)] p-[var(--space-3)] text-left transition-colors focus-visible:outline-4 focus-visible:outline-[var(--focus-ring)] sm:min-h-[8.25rem] ${
                      selected
                        ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                        : 'bg-[var(--surface-raised)] text-[var(--text-primary)] hover:bg-[var(--surface-strong)]'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-[var(--space-2)]">
                      <span
                        className={`inline-flex h-9 w-9 items-center justify-center border-2 ${
                          selected ? 'border-current' : 'border-[var(--border-strong)] text-[var(--brand-primary)]'
                        }`}
                      >
                        <cap.icon size={16} />
                      </span>
                      <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] opacity-75">
                        {cap.n}
                      </span>
                    </span>
                    <span className="font-sans text-[length:var(--type-panel-body-compact-size)] font-black leading-[var(--leading-body-compact)] sm:text-balance sm:text-[length:var(--type-panel-title-nav-size)] sm:leading-[var(--leading-nav)]">
                      {cap.cardTitle ?? cap.title}
                    </span>
                    <span
                      className={`hidden text-[length:var(--type-meta-size)] font-semibold leading-[var(--leading-body-compact)] sm:block ${
                        selected ? 'text-[color:var(--brand-primary-foreground-muted)]' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {cap.oneLiner}
                    </span>
                  </button>
                )
              })}
            </div>
          </PageContainer>
        </section>

        {/* ── Veto deep-dive ─────────────────────────────────────────── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <HarnessArtFigure
                  src="/img/generated/harness-veto.webp"
                  alt="A destructive command lane carrying a hazard mark arrives and is stopped by an amber guard gate; a clean rerouted lane departs toward a safe terminal node, showing the command was redirected to a safe alternative rather than only blocked"
                  caption="The hazard lane is stopped at the gate; a safe lane is offered in its place."
                />
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <div className="space-y-[var(--space-4)]">
                  <div className="inline-flex items-center gap-[var(--space-2)]">
                    <ShieldAlert size={18} className="text-[var(--brand-primary)]" />
                    <BracketLabel>A veto that teaches</BracketLabel>
                  </div>
                  <PanelTitle as="h2" size="display" className="max-w-[18ch]">
                    Blocking is easy. Naming the safe move is the point.
                  </PanelTitle>
                  <PanelBody className="max-w-[44rem]">
                    A guard that only says “no” leaves the agent stuck and likely to
                    try again, harder. The harness intercepts the irreversible command
                    and answers with the reversible one — the move the agent should
                    have reached for. The lesson travels with the refusal.
                  </PanelBody>
                  <CodeBlock language="bash" filename="intercepted at the tool call">
                    {`# agent tries:
$ rm -rf build/ .git/

# harness vetoes, and names the safe path:
✗ Refused: this would delete tracked history.
→ Try: git clean -xfd build/   (build artifacts only,
        leaves .git and working tree intact)`}
                  </CodeBlock>
                </div>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        {/* ── Vendor support honesty table ───────────────────────────── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Where it runs"
              title="One harness, mapped to each vendor CLI’s hooks."
              description="The capabilities are the same across vendors because they ride hook points every modern coding CLI exposes. What differs is how far each integration has been verified. Here is the honest state."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[22ch]"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-3)]">
              {VENDOR_ROWS.map((row) => (
                <SurfacePanel
                  key={row.vendor}
                  elevation="quiet"
                  padding="compact"
                  className="grid items-center gap-[var(--space-3)] md:grid-cols-[minmax(0,12rem)_auto_minmax(0,1fr)]"
                >
                  <PanelTitle as="h3" size="nav" className="max-w-none">
                    {row.vendor}
                  </PanelTitle>
                  <div>
                    <StatusPill tone={row.status}>
                      {row.status === 'live' ? 'Fully wired' : 'Hooks mapped'}
                    </StatusPill>
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    {row.note}
                  </PanelBody>
                </SurfacePanel>
              ))}
            </div>
          </PageContainer>
        </section>

        {/* ── Backend examples ──────────────────────────────────────── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Same Articles, many brains"
              title="The contract binds to the runtime, then the model can vary."
              description="Claude, Codex, Gemma, Ollama, and Cloudflare agents do not need identical brains. They need the same obligations: hear the fleet, claim before editing, pay rent, answer review, and leave memory behind. The verified state is named plainly."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[24ch]"
              bodyClassName="max-w-[48rem]"
            />

            <figure className="mt-[var(--space-6)] space-y-[var(--space-2)]">
              <picture className="block">
                <source
                  media="(orientation: portrait) and (prefers-color-scheme: dark)"
                  srcSet="/img/generated/harness-articles-jetpacks-portrait-dark.webp"
                  type="image/webp"
                />
                <source
                  media="(orientation: portrait) and (prefers-color-scheme: dark)"
                  srcSet="/img/generated/harness-articles-jetpacks-portrait-dark.png"
                />
                <source
                  media="(orientation: portrait)"
                  srcSet="/img/generated/harness-articles-jetpacks-portrait-light.webp"
                  type="image/webp"
                />
                <source
                  media="(orientation: portrait)"
                  srcSet="/img/generated/harness-articles-jetpacks-portrait-light.png"
                />
                <source
                  media="(prefers-color-scheme: dark)"
                  srcSet="/img/generated/harness-articles-jetpacks-landscape-dark.webp"
                  type="image/webp"
                />
                <source
                  media="(prefers-color-scheme: dark)"
                  srcSet="/img/generated/harness-articles-jetpacks-landscape-dark.png"
                />
                <source
                  srcSet="/img/generated/harness-articles-jetpacks-landscape-light.webp"
                  type="image/webp"
                />
                <img
                  src="/img/generated/harness-articles-jetpacks-landscape-light.png"
                  alt="A three-part illustration of sailors joining an old ship, actively signing an open ledger together, then lifting safely from a deck launch platform with jet packs connected to abstract tool modules"
                  className="w-full border-2 border-[var(--border-strong)] bg-[var(--surface-base)]"
                  width={1376}
                  height={768}
                  loading="eager"
                />
              </picture>
              <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                The old ship is the agreement. The crew signs the ledger. The jet packs are the tools. Portrait phones get the same story stacked vertically; landscape viewports read it left to right.
              </figcaption>
            </figure>

            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)]">
              {BACKEND_EXAMPLES.map((row) => (
                <SurfacePanel key={row.runtime} elevation="quiet" padding="compact" className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)]">
                  <div className="space-y-[var(--space-3)]">
                    <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                      <PanelTitle as="h3" size="nav" className="max-w-none">
                        {row.runtime}
                      </PanelTitle>
                      <StatusPill tone={row.status}>
                        {row.status === 'live' ? 'Verified lane' : 'Mapped lane'}
                      </StatusPill>
                    </div>
                    <PanelBody size="compact" className="max-w-none font-semibold text-[var(--text-primary)]">
                      {row.backend}
                    </PanelBody>
                    <PanelBody size="compact" className="max-w-none">
                      {row.contract}
                    </PanelBody>
                  </div>
                  <CodeBlock language="bash" filename="example">
                    {row.command}
                  </CodeBlock>
                </SurfacePanel>
              ))}
            </div>
          </PageContainer>
        </section>

        {/* ── Closing CTA ────────────────────────────────────────────── */}
        <section className="py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SurfacePanel tone="blue" elevation="raised" padding="default" className="grid gap-[var(--space-5)]">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Try it</PanelEyebrow>
                <PanelTitle as="h2" size="display" tone="primary" className="max-w-[20ch]">
                  Install Port Daddy, begin a session, harness your agent.
                </PanelTitle>
                <PanelBody tone="primary" className="max-w-[44rem]">
                  Two commands put the daemon in front of your agent. From the next
                  turn on, it hears the fleet, sees the swarm, and is stopped before
                  it can do anything it can’t take back.
                </PanelBody>
              </div>
              <CodeBlock language="bash">
                {`brew install curiositech/tap/port-daddy
pd begin --identity myapp:api`}
              </CodeBlock>
              <div className="flex flex-wrap gap-[var(--space-3)]">
                <Button asChild variant="secondary" size="lg">
                  <Link to="/docs/quickstart">
                    Read the quickstart
                    <ArrowRight size={16} />
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="lg">
                  <Link to="/security">
                    <CheckCircle2 size={16} />
                    How the guard is enforced
                  </Link>
                </Button>
              </div>
            </SurfacePanel>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}
