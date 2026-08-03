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
 * each turn with a bounded suggestibility envelope, exposes attention and
 * ownership before work, and leaves a compact trace after tools. Adjacent Port
 * Daddy controls (Parley delivery, worktrees, Coast Guard, skill grafting) are
 * named separately so the page never credits a tentacle for work it does not do.
 *
 * Source: ADR-0051 plus the live Squid conformance schema. Tone is honest
 * infrastructure: Claude, Codex, Gemini, and agy are wired through their native
 * hook surfaces, with exact-root and daemon gates.
 *
 * Idiom matches SecurityPage / PdTube: lives under MainLayout (header only),
 * renders its own <Footer />, built entirely from site/primitives so every
 * type size inherits the a11y-floored tokens (meta 14px, body 18px).
 */

type Capability = {
  n: string
  scope: string
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
    scope: 'Squid · before turn',
    icon: Ear,
    title: 'Fresh context arrives before the model decides.',
    cardTitle: 'Suggestibility before the turn',
    oneLiner: 'The prompt tentacle injects a bounded, fresh, project-scoped envelope.',
    detail:
      'The prompt hook reads only fresh steering alerts and nearby pheromone traces for the exact armed project. The envelope is capped at 12 entries and 4 KiB, so coordination can influence the next decision without swallowing the conversation.',
    figure: {
      input: 'Fresh matrix facts',
      hook: 'Prompt tentacle',
      output: 'Next-turn envelope',
      proof: 'pd squid tap runs the real prompt tentacle and prints the exact envelope.',
    },
  },
  {
    n: '02',
    scope: 'Session hook · attention',
    icon: Radio,
    title: 'An empty inbox tells the agent what to watch next.',
    cardTitle: 'Inbox with useful subscriptions',
    oneLiner: 'Attention ranks exact channels by protocol, scope, and live activity.',
    detail:
      'Direct messages already reach the agent. When no channel watches exist, pd attention now recommends concrete worktree and fleet channels, explains why each matters, shows observed activity, and offers one command to arm the ranked set.',
    figure: {
      input: 'No channel watches',
      hook: 'Rank exact channels',
      output: 'One-command watch set',
      proof: 'No placeholder: every suggestion carries a real channel, scope, reason, and literal command.',
    },
  },
  {
    n: '03',
    scope: 'Squid · before edit',
    icon: Users,
    title: 'A foreign claim becomes visible before the write.',
    cardTitle: 'Collision protection before edit',
    oneLiner: 'The pre-tool tentacle warns or blocks when another actor owns the target.',
    detail:
      'The edit gate resolves the target path, checks the live lock and claim matrix, and names the holder. In enforce mode it blocks; in warn mode it leaves the decision visible. This protects shared files—it is not a backup system for unsaved editor buffers.',
    figure: {
      input: 'Edit request',
      hook: 'Pre-tool claim gate',
      output: 'Allow, warn, or block',
      proof: 'The real hook exits 2 on a foreign lock in enforce mode and names the owner.',
    },
  },
  {
    n: '04',
    scope: 'Squid · after tool',
    icon: SignalHigh,
    title: 'The fleet can see what changed without replaying a transcript.',
    cardTitle: 'Compact trace after tools',
    oneLiner: 'The post-tool tentacle appends a lock-safe pheromone trace.',
    detail:
      'After a write or edit, the hook records the actor, target, tool, intensity, and timestamp in the Ink Cloud. Concurrent writers use a lock-safe append path, leaving a compact coordination trail instead of copying private transcript content.',
    figure: {
      input: 'Completed tool',
      hook: 'Post-tool tentacle',
      output: 'Pheromone trace',
      proof: 'Eight concurrent appenders are covered by the real hook test with no torn lines.',
    },
  },
  {
    n: '05',
    scope: 'Port Daddy · Parley',
    icon: MessagesSquare,
    title: 'Parley turns arrive through the same durable inbox.',
    cardTitle: 'Parley delivery, not auto-convening',
    oneLiner: 'Summons and turns fan out to participant inboxes; convening remains explicit.',
    detail:
      'Port Daddy can recommend a Parley when work overlaps, and an opened Parley delivers every summon and turn to the named participants. The current trigger recommends; it does not silently convene a meeting behind the operator’s back.',
    figure: {
      input: 'Parley turn',
      hook: 'Inbox fan-out',
      output: 'Durable delivery',
      proof: 'Automated delivery is real. Automated convening is deliberately not claimed.',
    },
  },
  {
    n: '06',
    scope: 'Port Daddy · worktree',
    icon: GitBranch,
    title: 'Agent work stays out of the checkout you are using.',
    cardTitle: 'A linked berth for every slice',
    oneLiner: 'Sessions carry an explicit worktree, branch, purpose, claims, and controls.',
    detail:
      'This is a Port Daddy session guarantee around the harness, not a hook event. A registered agent works in a linked git worktree and appears in the roster with the exact branch, touched files, stream, interrupt, and takeover paths.',
    figure: {
      input: 'Work request',
      hook: 'Session berth',
      output: 'Own branch + claims',
      proof: 'The operator’s checkout remains untouched while the agent’s slice stays recoverable.',
    },
  },
  {
    n: '07',
    scope: 'Coast Guard · runtime',
    icon: CircleDollarSign,
    title: 'Spawned work runs under confinement, timeout, and spend limits.',
    cardTitle: 'Budget and sandbox protection',
    oneLiner: 'Coast Guard wraps spawned processes; it is adjacent to the Squid hooks.',
    detail:
      'Port Daddy’s spawner applies the operating-system sandbox, secret scrubbing, timeout, and hard spend cap. Those controls protect daemon-launched work, but the page does not pretend the prompt or edit tentacle implements them.',
    figure: {
      input: 'Spawn request',
      hook: 'Coast Guard',
      output: 'Bounded process',
      proof: 'The spend boundary is enforced where Port Daddy launches and supervises the process.',
    },
  },
  {
    n: '08',
    scope: 'Adjacent tool · explicit',
    icon: Ban,
    title: 'Skill grafting is offered explicitly, never smuggled into a turn.',
    cardTitle: 'Skill grafting stays separate',
    oneLiner: 'pd skill-graft previews native guidance; Squid does not auto-install skills.',
    detail:
      'Skill selection can improve an agent’s method, but it changes what guidance the agent receives. Port Daddy keeps that action visible and previewable. Today it is an adjacent command, not a hidden fourth tentacle and not part of LIVE conformance.',
    figure: {
      input: 'Task description',
      hook: 'Explicit skill-graft preview',
      output: 'Named guidance',
      proof: 'LIVE means hook conformance. It does not claim automatic skill grafting.',
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
          <PanelEyebrow>{capability.scope}</PanelEyebrow>
        </div>
        <PanelTitle as="h3" size="display" className="max-w-[14ch]">
          {capability.title}
        </PanelTitle>
        <PanelBody size="compact" className="max-w-[42rem] font-bold text-[var(--text-primary)]">
          {capability.oneLiner}
        </PanelBody>
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
    note: 'Project-native UserPromptSubmit, PreToolUse, and PostToolUse hooks, plus the visible ◆ PD statusline and Pilot SessionStart identity.',
  },
  {
    vendor: 'Codex CLI',
    status: 'live',
    note: 'User-level Codex hook config with the same three synchronous tentacles; the exact-project runtime gate keeps it inert elsewhere. One-time /hooks trust is required.',
  },
  {
    vendor: 'Gemini CLI',
    status: 'live',
    note: 'Project-native BeforeAgent, BeforeTool, and AfterTool events carry the shared prompt, edit, and trace tentacles.',
  },
  {
    vendor: 'Antigravity (agy)',
    status: 'live',
    note: 'Home-scoped Claude-shaped hook engine, constrained to exact armed Port Daddy projects by the same daemon heartbeat gate.',
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
    runtime: 'LIVE · 100%',
    backend: 'The exact worktree is armed and the daemon heartbeat is fresh.',
    contract:
      'All detected provider configs carry all three tentacles, identity surfaces are visible, and TURN / EDIT / TRACE are active now.',
    status: 'live',
    command: 'pd squid status --json  # level: LIVE, missing: []',
  },
  {
    runtime: 'READY',
    backend: 'Every hook and identity surface is wired, but the daemon is down.',
    contract:
      'The gate fails open while offline, so the agent can still work but receives no Squid injection or edit protection until the heartbeat returns.',
    status: 'mapped',
    command: 'port-daddy start',
  },
  {
    runtime: 'PARTIAL',
    backend: 'Some real wiring exists, but one or more required surfaces are missing.',
    contract:
      'The roster names each missing provider hook or identity surface and supplies one concrete repair command. This state exits non-zero in the CLI.',
    status: 'mapped',
    command: 'pd squid on  # full repair\npd hooks install  # hook-only repair',
  },
  {
    runtime: 'UNPROTECTED',
    backend: 'No exact project arm or no local worktree root can be proven.',
    contract:
      'The operator sees the absence instead of a neutral-looking row. Remote agents without a local worktree remain visibly unprotected by local tentacles.',
    status: 'mapped',
    command: 'pd squid on --cwd /path/to/worktree',
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
    eyebrow: 'Fresh conformance run',
    title: 'Watch a project move from PARTIAL to LIVE.',
    body:
      'This recording uses the branch-built CLI against the live daemon. The first status names every missing tentacle and identity surface, pd squid on repairs them, and the final status reads the same project back as LIVE.',
    src: '/demos/harness/harness-conformance-live.gif',
    alt: 'Fresh terminal recording showing a Port Daddy project at PARTIAL Squid conformance, pd squid on wiring the missing hooks and identity, and the final LIVE status.',
    kind: 'gif',
    featured: true,
  },
  {
    eyebrow: 'Fresh attention run',
    title: 'An empty inbox explains what is worth watching.',
    body:
      'Nothing new is no longer a dead end. The command ranks exact coordination channels, explains their value and observed activity, arms the set in one action, then reads the subscriptions back.',
    src: '/demos/harness/harness-attention-activation.gif',
    alt: 'Fresh terminal recording of pd attention ranking coordination channels, subscribing to the recommended set, and reading the active subscriptions back.',
    kind: 'gif',
  },
  {
    eyebrow: 'FleetBar · before',
    title: 'Missing protection stays visibly broken.',
    body:
      'A failed or incomplete harness is not flattened into a neutral row. The card retains its evidence and gives the operator a repair action.',
    src: '/demos/harness/harness-fleetbar-needs-repair.png',
    alt: 'Fresh FleetBar screenshot showing a Giant Squid harness that needs repair and the specific missing state.',
    kind: 'image',
  },
  {
    eyebrow: 'FleetBar · after',
    title: 'Green means a fresh read-back, not a clicked button.',
    body:
      'The live state is rendered only after the daemon, tentacles, provider wiring, status identity, and Pilot steering surface are read back as present.',
    src: '/demos/harness/harness-fleetbar-live.png',
    alt: 'Fresh FleetBar screenshot showing the Giant Squid harness confirmed live after repair.',
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
    eyebrow: 'Conformance activation · fresh',
    title: 'PARTIAL is a diagnosis. LIVE is a verified transition.',
    body:
      'The first read names what is missing. The arm command prints the non-diegetic value it is adding before turns, before edits, and after tools. The final read proves all four detected agent CLIs are wired for the exact project.',
    src: '/demos/harness/harness-conformance-live.gif',
    darkSrc: '/demos/harness/harness-conformance-live-dark.gif',
    alt: 'Terminal recording of the Squid harness moving from PARTIAL to LIVE conformance with explicit PD TURN, EDIT, and TRACE narration.',
    featured: true,
  },
  {
    eyebrow: 'Attention activation · fresh',
    title: '“Nothing new” now has a useful next move.',
    body:
      'The agent still receives direct inbox messages. When it has no channel watches, attention ranks the worktree inconsistency channel and active fleet channels, explains why they matter, and arms them with one command.',
    src: '/demos/harness/harness-attention-activation.gif',
    darkSrc: '/demos/harness/harness-attention-activation-dark.gif',
    alt: 'Terminal recording of an empty attention read suggesting useful channels and arming the recommended subscriptions.',
  },
  {
    eyebrow: 'Real interactive Claude Code',
    title: 'Ask for a haiku, get a haiku about ships — because the harness said so.',
    body:
      'This is the actual Claude Code TUI, not piped output. The ◆ PD badge sits in the status line the whole session. The operator dropped one steering alert in the Ink Cloud — "any haiku must be about ships" — and pd squid tap shows it. The prompt typed into Claude only says "write a haiku to ship_haiku.txt", with no mention of ships. The UserPromptSubmit tentacle injects the alert, "Async hook SessionStart completed" flashes, and Claude writes a ship haiku, then says so. Watch the status line counters tick to 1 alert · 2 traces as the harness works.',
    src: '/demos/harness/harness-claude-live.gif',
    darkSrc: '/demos/harness/harness-claude-live-dark.gif',
    alt: 'Interactive Claude Code terminal session with a cyan PD badge in the status line. pd squid tap shows a steering alert requiring ship haiku; the user prompt only says write a haiku, and Claude writes a ship-themed haiku, with the status line showing 1 alert and 2 traces.',
  },
  {
    eyebrow: 'Codex pilots Claude Code — live',
    title: 'The real Claude Code TUI, answered by Codex.',
    body:
      'pd squid codex boots the local Anthropic-shaped bridge and launches the actual Claude Code interface pointed at it. The magenta ◆ PD⇄CODEX badge and the honest backend label — codex (strong), not an Anthropic id — sit in the status line while Claude answers a question whose tokens were generated by codex exec. Same harness, ChatGPT Pro behind the seat.',
    src: '/demos/harness/harness-codex-pilot-live.gif',
    darkSrc: '/demos/harness/harness-codex-pilot-live-dark.gif',
    alt: 'Interactive Claude Code terminal session launched through the Codex bridge, showing a magenta PD-to-CODEX badge and the codex (strong) backend label in the status line while Claude answers a question.',
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
    title: 'pd squid tap prints the next turn’s injection.',
    body:
      'No guessing about what the hooks feed the model: tap runs the real UserPromptSubmit tentacle and prints the exact Suggestibility Envelope — steering alerts plus pheromone traces near your directory.',
    src: '/demos/harness/harness-squid-tap.gif',
    darkSrc: '/demos/harness/harness-squid-tap-dark.gif',
    alt: 'Terminal recording of pd squid tap printing the steering alerts and pheromone traces that will be injected into the next Claude Code turn.',
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
                    Know which agents are protected before they act.
                  </PanelTitle>
                  <HarnessArtFigure
                    src="/img/generated/harness-hero.webp"
                    alt="A rugged agent core in a harness cradle, with instrumented lines reaching into message radio, file claims, budget controls, worktree docks, and command guardrails."
                    caption="One agent core, eight instrumented lines into the fleet’s control plane."
                    loading="eager"
                    className="lg:hidden"
                  />
                  <PanelBody className="max-w-[46rem] text-[length:var(--type-panel-body-size)]">
                    Giant Squid wires the agent CLI you already use into one visible
                    fleet contract: fresh context before a turn, ownership before an
                    edit, a compact trace after tools, durable attention and Parley
                    delivery, and an honest LIVE / READY / PARTIAL / UNPROTECTED state.
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
                  description="The harness is not a fork of your agent. It seats three shared tentacles into each provider’s native events: prompt, pre-tool, and post-tool. The exact project-root registry and daemon heartbeat gate decide whether they activate. Port Daddy’s inbox, Parley, worktree, and Coast Guard controls stay adjacent and are labeled as such."
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
                      A live read-back on this slice found Claude Code, Codex CLI, Gemini
                      CLI, and agy: four detected, four configured, four wired, 100%
                      conformance. Codex uses a gated user config and needs one-time
                      <code> /hooks</code> trust; Claude and Gemini use project config.
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
                    One hook shape, translated to four provider-native event surfaces and gated to an exact armed root.
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
              title="Three tentacles, five adjacent controls, zero mystery."
              description="The first four cards are direct hook behavior. The rest show the Port Daddy services around the hooks—and say plainly where automation stops."
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

        {/* ── Truth boundary deep-dive ───────────────────────────────── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <figure className="space-y-[var(--space-2)]">
                  <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                    <picture>
                      <source srcSet="/img/generated/harness-contract-topology-dark.png" media="(prefers-color-scheme: dark)" />
                      <img
                        src="/img/generated/harness-contract-topology-light.png"
                        alt="A topology diagram separating Squid hook events from the adjacent Port Daddy coordination and runtime controls."
                        className="aspect-video w-full object-cover"
                        loading="eager"
                      />
                    </picture>
                  </div>
                  <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                    Hook behavior and adjacent control-plane behavior remain separate, visible contracts.
                  </figcaption>
                </figure>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <div className="space-y-[var(--space-4)]">
                  <div className="inline-flex items-center gap-[var(--space-2)]">
                    <ShieldAlert size={18} className="text-[var(--brand-primary)]" />
                    <BracketLabel>The honest boundary</BracketLabel>
                  </div>
                  <PanelTitle as="h2" size="display" className="max-w-[18ch]">
                    The value is clearer when the limits are visible.
                  </PanelTitle>
                  <PanelBody className="max-w-[44rem]">
                    Squid owns prompt suggestibility, edit collision checks, and
                    post-tool traces. Port Daddy owns durable inbox delivery, explicit
                    Parley, linked worktrees, and Coast Guard. The current product does
                    not claim automatic Parley convening, unsaved-buffer backup, or
                    automatic skill grafting.
                  </PanelBody>
                  <CodeBlock language="text" filename="the contract, without marketing blur">
                    {`SQUID HOOKS   TURN · EDIT · TRACE
PORT DADDY    INBOX · PARLEY DELIVERY · WORKTREES · BUDGETS

NOT CLAIMED
  automatic Parley convening
  unsaved editor-buffer backup
  automatic skill installation or grafting`}
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
              description="Port Daddy maps one TURN / EDIT / TRACE contract onto the hook events each supported CLI actually provides. The rows below name those exact event shapes and scopes; they do not imply that every coding CLI exposes the same lifecycle."
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
              description="A backend lane is not real because a command fits in a code block. It is real when the operator can see the conformance level, understand the repair, watch the value narration, and read the repaired state back in CLI, FleetBar, and the Rust GPUI app."
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
                  The CLI names the three hook moments as they happen: PD TURN adds bounded context, PD EDIT checks ownership,
                  and PD TRACE leaves compact fleet evidence. Attention makes inbox and channel delivery actionable.
                </PanelBody>
                <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                  <img
                    src="/demos/harness/harness-attention-activation.gif"
                    alt="Fresh terminal recording of Port Daddy attention recommending and arming useful coordination channels."
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
                  FleetBar keeps failure visible, offers the repair, and waits for a fresh read-back before showing the
                  harness as live. The operator does not need to translate daemon logs or edit config files.
                </PanelBody>
                <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                  <img
                    src="/demos/harness/harness-fleetbar-repair-live.gif"
                    alt="Fresh FleetBar recording showing the harness moving from needs repair to confirmed live."
                    className="aspect-video w-full object-cover"
                    loading="eager"
                  />
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
                  The GPUI roster consumes the same agent payload as the CLI: every row carries LIVE, READY, PARTIAL, or
                  UNPROTECTED plus its score, missing surfaces, and repair action. No second conformance guess lives in the UI.
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
                  These captures were produced from the current change. A surface stays out of the gallery until its new state has been captured and inspected.
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

        {/* ── Conformance ladder ────────────────────────────────────── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="One fleet truth"
              title="Every agent gets a visible Squid conformance level."
              description="The roster does not collapse every half-installed agent into a reassuring green dot. LIVE, READY, PARTIAL, and UNPROTECTED name what is working, what is merely installed, what is missing, and the exact repair command."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[22ch]"
              bodyClassName="max-w-[48rem]"
            />

            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)]">
              {BACKEND_LANES.map((row) => (
                <SurfacePanel key={row.runtime} elevation="quiet" padding="compact" className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,28rem)]">
                  <div className="space-y-[var(--space-3)]">
                    <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                      <PanelTitle as="h3" size="nav" className="max-w-none">
                        {row.runtime}
                      </PanelTitle>
                      <StatusPill tone={row.status}>
                        {row.status === 'live' ? 'Full conformance' : 'Visible repair state'}
                      </StatusPill>
                    </div>
                    <PanelBody size="compact" className="max-w-none font-semibold text-[var(--text-primary)]">
                      {row.backend}
                    </PanelBody>
                    <PanelBody size="compact" className="max-w-none">
                      {row.contract}
                    </PanelBody>
                  </div>
                  <CodeBlock language="bash" filename={row.status === 'live' ? 'live proof' : 'repair path'}>
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
              title="From daemon to a useful, inspectable harness."
              description="The fresh recordings below run these commands against the real local daemon. The install is convergent: rerunning it replaces Port Daddy's canonical entry instead of multiplying hooks, and the off switch removes only Port Daddy-authored state."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[26ch]"
              bodyClassName="max-w-[58rem]"
            />

            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <SurfacePanel elevation="raised" padding="compact" className="space-y-[var(--space-3)]">
                <PanelEyebrow className="text-[var(--brand-primary)]">Fresh install</PanelEyebrow>
                <CodeBlock language="bash" filename="clean machine → armed project">
                  {`# 1 — install and prove the daemon is reachable
brew install curiositech/tap/port-daddy
pd setup
port-daddy start    # returns one PID + URL only after readiness

# 2 — arm a project (per project, never machine-wide)
cd ~/code/your-project
pd squid on         # Claude + Codex + Gemini + agy, daemon-gated

# 3 — make attention useful before the first turn
pd attention
pd attention --subscribe-recommended

# 4 — inspect the non-diegetic machinery
pd squid status     # LIVE / READY / PARTIAL / UNPROTECTED
pd squid tap        # exact next-turn suggestibility envelope

# 5 — run an agent; the client narrates PD TURN / EDIT / TRACE
claude              # or codex, gemini, agy

# 6 — the off switch (also /squid off inside Claude Code)
pd squid off`}
                </CodeBlock>
                <PanelBody size="compact" className="max-w-none">
                  Every hook routes through a gate that no-ops unless the daemon heartbeat is fresh and the
                  exact project is armed. The client may group repeated PostToolUse invocations into a rising
                  count; that is one canonical TRACE hook firing after successive tools, not new hooks being installed.
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
                <PanelEyebrow>Current recordings</PanelEyebrow>
                <PanelTitle as="h3" size="display" className="max-w-[22ch]">
                  Action, outcome, and read-back in the same frame.
                </PanelTitle>
                <PanelBody size="compact" className="max-w-[58rem]">
                  The fresh conformance and attention recordings were generated from this branch and inspected frame by frame.
                  Older live-agent recordings remain below as behavioral examples, while the new captures prove the current
                  CLI copy, repair flow, and read-back contract.
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
