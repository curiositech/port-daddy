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
  loading = 'eager',
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
  const darkSrc = src.replace(/(\.[^.]+)$/, '-dark$1')

  return (
    <figure className={`space-y-[var(--space-2)] ${className ?? ''}`}>
      <div className="relative overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
        <picture>
          <source srcSet={darkSrc} media="(prefers-color-scheme: dark)" />
          <img
            src={src}
            alt={alt}
            className="aspect-video w-full object-cover"
            style={{
              filter: dark ? 'brightness(0.72) contrast(1.18) saturate(1.12)' : 'saturate(1.03)',
            }}
            width={1456}
            height={816}
            loading={loading}
            decoding="async"
          />
        </picture>
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

type BackendLane = {
  runtime: string
  backend: string
  contract: string
  status: 'live' | 'mapped'
  command: string
}

const BACKEND_LANES: readonly BackendLane[] = [
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
    backend: 'OpenAI Codex CLI through the Squid compatibility bridge',
    contract:
      'Claude-shaped requests hit a local Anthropic-compatible bridge; provenance records the backend tier actually used.',
    status: 'live',
    command: 'pd squid codex --tier strong',
  },
  {
    runtime: 'Claude Code shape, open weights behind',
    backend: 'vLLM serving Gemma, Qwen, Llama, DeepSeek, or another tool-capable model',
    contract:
      'Claude Code keeps the hook layer; the gateway provides Anthropic Messages compatibility and tool-call shape.',
    status: 'mapped',
    command: 'surface required: streamed turns, tool calls, and hook verdicts in CLI + FleetBar before promotion',
  },
  {
    runtime: 'Ollama / Gemma adapter lane',
    backend: 'Local Ollama models behind a router that speaks Anthropic Messages',
    contract:
      'The Articles still bind to the harness; this lane stays experimental until streaming and tool-loop fixtures pass.',
    status: 'mapped',
    command: 'surface required: ollama turn stream + Port Daddy hook verdicts visible in the roster',
  },
  {
    runtime: 'Cloudflare Agent',
    backend: 'Durable cloud actor using Workers AI or provider APIs',
    contract:
      'The remote agent gets a Harbor identity, relay channel, PR duties, budget, and the same review/merge obligations.',
    status: 'mapped',
    command: 'surface required: Cloudflare actor appears beside local agents with relay status and transcript tail',
  },
] as const

type ProofMedia = {
  title: string
  eyebrow: string
  body: string
  src: string
  darkSrc?: string
  alt: string
  kind: 'gif' | 'image'
  featured?: boolean
}

const PROOF_MEDIA: readonly ProofMedia[] = [
  {
    eyebrow: 'Rust GPUI app',
    title: 'The operator sees the harness roster in the native app.',
    body:
      'The current GPUI control center opens the active-agent roster beside the live lane and planner, with stream, steer, takeover, worktree, and harness labels visible in one window.',
    src: '/img/app-screens/pd-console-gpui/active-agents-harness-roster.png',
    alt: 'Rust GPUI Port Daddy control center showing the active agent harness roster beside a live lane and planner pane.',
    kind: 'image',
    featured: true,
  },
  {
    eyebrow: 'CLI multiplexer',
    title: 'The same roster exists without the native window.',
    body:
      'The headless console face shows the same active-agent contract: backend, worktree, current task, touched files, stream command, steer command, and takeover handle.',
    src: '/img/app-screens/pd-console-gpui/active-agent-roster-repl.gif',
    alt: 'Animated terminal console showing the Port Daddy active-agent harness roster with stream, steer, and takeover commands.',
    kind: 'gif',
  },
  {
    eyebrow: 'CLI multiplexor',
    title: 'Terminal streams show agent traffic in motion.',
    body:
      'The CLI needs to show the working agent and Port Daddy side by side: stream, inbox injections, hook verdicts, and jump-in controls for daemon-launched work.',
    src: '/demos/pd-tube/pd-tube-multiplex.gif',
    alt: 'Terminal recording of Port Daddy tube multiplexing multiple agent messages and replies.',
    kind: 'gif',
  },
  {
    eyebrow: 'FleetBar',
    title: 'The menu-bar app is part of the harness.',
    body:
      'FleetBar is the quick operator surface for daemon health, session state, credentials, remediation, and opening the fuller control center.',
    src: '/img/app-screens/fleetbar-native-shell-light.webp',
    darkSrc: '/img/app-screens/fleetbar-native-shell-dark.webp',
    alt: 'FleetBar native shell showing Port Daddy app controls and status.',
    kind: 'image',
  },
  {
    eyebrow: 'Live dashboard',
    title: 'The web app shows claims, notes, and active agents.',
    body:
      'The same harness evidence should read in the dashboard: who is active, what they claimed, what they heard, and where their transcript lives.',
    src: '/media/landing-live-glory/live-agents-panel-light.webp',
    darkSrc: '/media/landing-live-glory/live-agents-panel-dark.webp',
    alt: 'Port Daddy dashboard live agents panel showing active sessions, notes, and file claims.',
    kind: 'image',
  },
] as const

type RunItMedia = {
  eyebrow: string
  title: string
  body: string
  src: string
  darkSrc: string
  alt: string
  featured?: boolean
}

/**
 * Real terminal recordings of the squid harness — captured with VHS/asciinema
 * running the actual commands against the actual daemon; no staged output.
 * Light GIFs are Catppuccin Latte, -dark are Macchiato, matching pd-tube.
 */
const RUN_IT_MEDIA: readonly RunItMedia[] = [
  {
    eyebrow: 'Codex pilots Claude Code — live',
    title: 'The real Claude Code TUI, answered by Codex.',
    body:
      'This is the actual Claude Code interface, not piped output. pd squid codex boots the local Anthropic-shaped bridge and launches Claude Code pointed at it in one command — no auth prompts, no incantation. The magenta ◆ PD⇄CODEX badge and the honest backend label — codex (strong), not an Anthropic id — sit in the status line the whole session while Claude answers a question whose tokens were generated by codex exec. Same harness, ChatGPT Pro behind the seat.',
    src: '/demos/harness/harness-codex-pilot-live.gif',
    darkSrc: '/demos/harness/harness-codex-pilot-live-dark.gif',
    alt: 'Interactive Claude Code terminal session launched through the Codex bridge, showing a magenta PD-to-CODEX badge and the codex (strong) backend label in the status line while Claude answers a question.',
    featured: true,
  },
  {
    eyebrow: 'The arm switch',
    title: 'pd squid on wires everything; status shows it.',
    body:
      'One command arms hooks for every detected agent CLI, the ◆ PD statusline, the Pilot steering hook, and the /squid command — then pd squid status reads back every surface, live.',
    src: '/demos/harness/harness-squid-on.gif',
    darkSrc: '/demos/harness/harness-squid-on-dark.gif',
    alt: 'Terminal recording of pd squid on arming the harness and pd squid status showing daemon, tentacles, per-CLI wiring, identity surfaces, and the Ink Cloud matrix.',
  },
  {
    eyebrow: 'The envelope, verbatim',
    title: 'pd squid tap prints the exact context the next turn receives.',
    body:
      'No guessing about what the hooks feed the model: tap runs the real UserPromptSubmit tentacle and prints the exact coordination context the next turn will see — operator alerts plus pheromone traces near your directory. The agent reads it like any other context and decides what to do with it.',
    src: '/demos/harness/harness-squid-tap.gif',
    darkSrc: '/demos/harness/harness-squid-tap-dark.gif',
    alt: 'Terminal recording of pd squid tap printing the operator alerts and pheromone traces the next Claude Code turn will receive as context.',
  },
  {
    eyebrow: 'The bridge card',
    title: 'The Codex bridge announces exactly what it is.',
    body:
      'pd squid codex --serve-only prints the boundary card: base URL, local auth, tier, routes — and the honest line that this is a compatibility bridge, not a Claude Code auth mode.',
    src: '/demos/harness/harness-squid-codex.gif',
    darkSrc: '/demos/harness/harness-squid-codex-dark.gif',
    alt: 'Terminal recording of the Giant Squid Claude-shaped local bridge card showing base URL, auth, tier, backend, and routes.',
  },
] as const

function ProofMediaCard({ media }: { media: ProofMedia }) {
  const mediaClass = media.featured
    ? 'aspect-[16/10] md:aspect-[21/9]'
    : 'aspect-video'

  return (
    <SurfacePanel
      elevation={media.featured ? 'raised' : 'quiet'}
      padding="compact"
      className={`grid content-start gap-[var(--space-3)] ${media.featured ? 'lg:col-span-2' : ''}`}
    >
      <figure className="space-y-[var(--space-2)]">
        <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
          {media.darkSrc ? (
            <picture>
              <source srcSet={media.darkSrc} media="(prefers-color-scheme: dark)" />
              <img
                src={media.src}
                alt={media.alt}
                className={`${mediaClass} w-full object-cover`}
                loading="eager"
              />
            </picture>
          ) : (
            <img
              src={media.src}
              alt={media.alt}
              className={`${mediaClass} w-full object-cover`}
              loading="eager"
            />
          )}
        </div>
      </figure>
      <div className="grid gap-[var(--space-2)]">
        <PanelEyebrow className="text-[var(--brand-primary)]">{media.eyebrow}</PanelEyebrow>
        <PanelTitle as="h3" size="card" className="max-w-[24ch]">
          {media.title}
        </PanelTitle>
        <PanelBody size="compact" className="max-w-none">
          {media.body}
        </PanelBody>
      </div>
    </SurfacePanel>
  )
}

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
                <figure className="space-y-[var(--space-2)]">
                  <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                    <picture>
                      <source srcSet="/img/generated/harness-hooks-dark.png" media="(prefers-color-scheme: dark)" />
                      <img
                        src="/img/generated/harness-hooks.png"
                        alt="A vendor command-line tool exposing four hook ports, with keyed couplings from the daemon seating into them."
                        className="aspect-video w-full object-cover"
                        loading="eager"
                      />
                    </picture>
                  </div>
                  <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                    The daemon seats into the CLI’s hook ports. One coupling is verified; the others are validating.
                  </figcaption>
                </figure>
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
                <figure className="space-y-[var(--space-2)]">
                  <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                    <picture>
                      <source srcSet="/img/generated/harness-veto-dark.png" media="(prefers-color-scheme: dark)" />
                      <img
                        src="/img/generated/harness-veto.png"
                        alt="A destructive command lane carrying a hazard mark arrives and is stopped by an amber guard gate while a clean safe lane departs."
                        className="aspect-video w-full object-cover"
                        loading="eager"
                      />
                    </picture>
                  </div>
                  <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                    The hazard lane is stopped at the gate; a safe lane is offered in its place.
                  </figcaption>
                </figure>
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

        {/* ── Operator proof surfaces ───────────────────────────────── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="What finished means"
              title="A harnessed agent must be visible, controllable, and pleasant to run."
              description="A backend lane is not real because a command fits in a code block. It is real when the operator can watch the stream, see Port Daddy's hook decisions, jump into the session, stop or steer the work, and see the same agent beside the standing fleet in CLI, FleetBar, and the Rust GPUI app."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[26ch]"
              bodyClassName="max-w-[58rem]"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-3">
              <SurfacePanel className="space-y-[var(--space-4)]">
                <div className="flex items-center gap-[var(--space-2)]">
                  <Terminal size={18} className="text-[var(--brand-primary)]" />
                  <PanelEyebrow className="text-[var(--brand-primary)]">CLI multiplexor</PanelEyebrow>
                </div>
                <PanelTitle as="h3" size="card">
                  Watch the working agent and Port Daddy at once.
                </PanelTitle>
                <PanelBody size="compact" className="max-w-none">
                  The terminal surface needs a live transcript tail, hook verdicts, inbox and parley injections, budget state,
                  and a jump-in path for every daemon-launched agent.
                </PanelBody>
                <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                  <img
                    src="/demos/pd-tube/pd-tube-multiplex.gif"
                    alt="Terminal recording of Port Daddy tube multiplexing agent streams and replies."
                    className="aspect-video w-full object-cover"
                    loading="eager"
                  />
                </figure>
              </SurfacePanel>

              <SurfacePanel className="space-y-[var(--space-4)]">
                <div className="flex items-center gap-[var(--space-2)]">
                  <Users size={18} className="text-[var(--brand-primary)]" />
                  <PanelEyebrow className="text-[var(--brand-primary)]">FleetBar roster</PanelEyebrow>
                </div>
                <PanelTitle as="h3" size="card">
                  See fleet agents and task agents in one place.
                </PanelTitle>
                <PanelBody size="compact" className="max-w-none">
                  FleetBar should show full-time infrastructure agents beside task agents, with model tier, worktree,
                  hook health, transcript tail, and remediation when part of the harness is missing.
                </PanelBody>
                <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                  <picture>
                    <source srcSet="/img/app-screens/fleetbar-native-shell-dark.webp" media="(prefers-color-scheme: dark)" />
                    <img
                      src="/img/app-screens/fleetbar-native-shell-light.webp"
                      alt="FleetBar native shell showing the Port Daddy operator app surface."
                      className="aspect-video w-full object-cover"
                      loading="eager"
                    />
                  </picture>
                </figure>
              </SurfacePanel>

              <SurfacePanel className="space-y-[var(--space-4)]">
                <div className="flex items-center gap-[var(--space-2)]">
                  <Radio size={18} className="text-[var(--brand-primary)]" />
                  <PanelEyebrow className="text-[var(--brand-primary)]">Rust GPUI control center</PanelEyebrow>
                </div>
                <PanelTitle as="h3" size="card">
                  Control a live session without losing the fleet.
                </PanelTitle>
                <PanelBody size="compact" className="max-w-none">
                  The GPUI app needs a unified roster, readable live lane, transcript anchor, daemon lane, and operator
                  controls for attach, interrupt, remediation, and handoff.
                </PanelBody>
                <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                  <img
                    src="/img/app-screens/pd-console-gpui/active-agents-harness-roster.png"
                    alt="Rust GPUI active-agent harness roster showing live agents, stream commands, steer commands, and takeover handles."
                    className="aspect-video w-full object-cover"
                    loading="eager"
                  />
                </figure>
              </SurfacePanel>
            </div>

            <div className="mt-[var(--space-8)]">
              <div className="mb-[var(--space-5)] flex flex-col gap-[var(--space-2)] md:flex-row md:items-end md:justify-between">
                <div className="space-y-[var(--space-2)]">
                  <PanelEyebrow>Proof gallery</PanelEyebrow>
                  <PanelTitle as="h3" size="display" className="max-w-[18ch]">
                    Screens and recordings from the harness surfaces.
                  </PanelTitle>
                </div>
                <PanelBody size="compact" className="max-w-[34rem]">
                  These are the acceptance surfaces: CLI streams, FleetBar, dashboard state, and the Rust GPUI control center.
                  Any new backend lane has to show up here before the marketing copy can call it real.
                </PanelBody>
              </div>
              <div className="grid gap-[var(--space-4)] lg:grid-cols-2">
                {PROOF_MEDIA.map((media) => (
                  <ProofMediaCard key={`${media.eyebrow}-${media.title}`} media={media} />
                ))}
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── Backend lanes ─────────────────────────────────────────── */}
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
              {BACKEND_LANES.map((row) => (
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
                  <CodeBlock language="bash" filename={row.status === 'live' ? 'operator command' : 'promotion gate'}>
                    {row.command}
                  </CodeBlock>
                </SurfacePanel>
              ))}
            </div>
          </PageContainer>
        </section>

        {/* ── Run it yourself: fresh install + real recordings ───────── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Run it yourself"
              title="Five commands from a clean machine to a harnessed, identifiable Claude Code."
              description="Everything below is a real terminal recording of these exact commands — no mockups. The install stages the tentacles and the identity statusline; pd squid on is the one-shot arm switch; pd squid off removes every pd-authored entry and nothing else."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[26ch]"
              bodyClassName="max-w-[58rem]"
            />

            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <SurfacePanel elevation="raised" padding="compact" className="space-y-[var(--space-3)]">
                <PanelEyebrow className="text-[var(--brand-primary)]">Fresh install</PanelEyebrow>
                <CodeBlock language="bash" filename="clean machine → armed project">
                  {`# 1 — install the daemon + harness machinery
brew install curiositech/tap/port-daddy
pd setup            # daemon, MCP, skills, Pilot agents, tentacles staged

# 2 — arm a project (per project, never machine-wide)
cd ~/code/your-project
pd squid on         # hooks + ◆ PD statusline + steering + /squid command

# 3 — run Claude Code, visibly harnessed
claude              # cyan ◆ PD badge; the envelope arrives every turn

# 4 — inspect the non-diegetic machinery any time
pd squid status     # what is armed, live Ink Cloud, bridge probe
pd squid tap        # the exact envelope the next turn will receive

# 5 — the off switch (also /squid off inside Claude Code)
pd squid off`}
                </CodeBlock>
                <PanelBody size="compact" className="max-w-none">
                  Every hook routes through a gate that no-ops unless the daemon is running and the
                  directory is a Port Daddy project — armed hooks are inert everywhere else. A
                  statusline or hook you wrote yourself is never touched.
                </PanelBody>
              </SurfacePanel>

              <SurfacePanel elevation="raised" padding="compact" className="space-y-[var(--space-3)]">
                <PanelEyebrow className="text-[var(--brand-primary)]">Codex-piloted Claude Code</PanelEyebrow>
                <CodeBlock language="bash" filename="ChatGPT Pro as the seat behind Claude Code">
                  {`# one command. no env vars, no ANTHROPIC_* exports, no auth prompts.
pd squid codex --tier strong

# it boots a local Anthropic-shaped endpoint backed by codex exec and
# launches Claude Code pointed at it in an isolated, pre-trusted config —
# so the bridge token is the ONLY credential (no login/token auth
# conflict), the folder is already trusted, and onboarding is skipped.
# The statusline flips to a magenta ◆ PD⇄CODEX badge reporting the REAL
# backend model, never the client-facing Anthropic id.`}
                </CodeBlock>
                <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                  <picture>
                    <source srcSet="/demos/harness/harness-statusline-dark.png" media="(prefers-color-scheme: dark)" />
                    <img
                      src="/demos/harness/harness-statusline.png"
                      alt="Terminal showing the pd-statusline output twice: a cyan PD badge with daemon state for a direct Anthropic seat, and a magenta PD-to-CODEX badge reporting the codex backend model for a bridged session."
                      className="w-full"
                      loading="lazy"
                    />
                  </picture>
                </figure>
                <PanelBody size="compact" className="max-w-none">
                  Same session JSON, two truths: the direct seat shows the Anthropic model; the
                  piloted seat shows the Codex backend actually answering.
                </PanelBody>
              </SurfacePanel>
            </div>

            <div className="mt-[var(--space-8)]">
              <div className="mb-[var(--space-5)] space-y-[var(--space-2)]">
                <PanelEyebrow>Real recordings</PanelEyebrow>
                <PanelTitle as="h3" size="display" className="max-w-[24ch]">
                  The harness, live in a real Claude Code session.
                </PanelTitle>
                <PanelBody size="compact" className="max-w-[58rem]">
                  The featured recording is the whole product in one take, inside the real Claude
                  Code TUI: <code>pd squid codex</code> boots the bridge and Claude Code answers a
                  question through the Codex backend, with the <code>◆ PD⇄CODEX</code> badge and the
                  honest backend label in the status line the whole time. The rest show the arm
                  switch, the context envelope, and the bridge boundary card — every frame captured
                  against the live daemon, not staged.
                </PanelBody>
              </div>

              <div className="grid gap-[var(--space-4)] lg:grid-cols-2">
                {RUN_IT_MEDIA.map((media) => (
                  <SurfacePanel
                    key={media.title}
                    elevation={media.featured ? 'raised' : 'quiet'}
                    padding="compact"
                    className={`grid content-start gap-[var(--space-3)] ${media.featured ? 'lg:col-span-2' : ''}`}
                  >
                    <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                      <picture>
                        <source srcSet={media.darkSrc} media="(prefers-color-scheme: dark)" />
                        <img src={media.src} alt={media.alt} className="w-full" loading="lazy" />
                      </picture>
                    </figure>
                    <div className="grid gap-[var(--space-2)]">
                      <PanelEyebrow className="text-[var(--brand-primary)]">{media.eyebrow}</PanelEyebrow>
                      <PanelTitle as="h4" size="card" className="max-w-[30ch]">
                        {media.title}
                      </PanelTitle>
                      <PanelBody size="compact" className="max-w-none">
                        {media.body}
                      </PanelBody>
                    </div>
                  </SurfacePanel>
                ))}
              </div>
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
                  One setup command installs the app, hooks, guard, skills, and MCP
                  wiring. Doctor is the repair path when a runtime disables part of
                  the harness or a local agent cannot see its tools.
                </PanelBody>
              </div>
              <CodeBlock language="bash">
                {`brew install curiositech/tap/port-daddy
pd setup
pd doctor`}
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
