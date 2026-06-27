import type { ComponentType } from 'react'
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

/**
 * Standalone marquee page at /harness. The argument: a bare vendor CLI is a
 * lone agent typing into the void. The harness sinks tentacles into that
 * CLI's own hook surface and turns it into a citizen of the fleet — it hears
 * messages, is subscribed by default, sees the swarm, gets CI verdicts back,
 * is invited to parley, pays rent, is steered to fresh worktrees, and has its
 * destructive commands vetoed with the safe alternative named.
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
  oneLiner: string
  detail: string
}

const CAPABILITIES: readonly Capability[] = [
  {
    n: '01',
    icon: Ear,
    title: 'Hears the fleet',
    oneLiner: 'Pending tube messages are injected at the start of every turn.',
    detail:
      'Before the model thinks, the harness drains the agent’s inbox and lays the unread messages in front of it. The agent never has to poll, never has to remember to check — the conversation arrives as context, on the turn it matters.',
  },
  {
    n: '02',
    icon: Radio,
    title: 'Subscribed by default',
    oneLiner: 'Auto-joined to its project channel and the fleet channel.',
    detail:
      'A fresh agent is not mute and not deaf. The harness signs it up to the channels its work lives on, so a broadcast to the project reaches it without anyone wiring up a subscription by hand.',
  },
  {
    n: '03',
    icon: Users,
    title: 'Swarm awareness',
    oneLiner: 'Sees who owns which files — and the blast radius — before it edits.',
    detail:
      'Before the agent touches a file, the harness shows it who has already claimed that surface and what depends on it. Collisions get headed off at the point of intent, not discovered later in a tangled merge.',
  },
  {
    n: '04',
    icon: SignalHigh,
    title: 'CI verdicts come home',
    oneLiner: 'A red check on its branch tells the agent to fix-and-repush.',
    detail:
      'The verdict travels back to the agent that earned it. A failing run on the agent’s branch lands as a message it can act on — so the loop closes itself instead of waiting for a human to relay the bad news.',
  },
  {
    n: '05',
    icon: MessagesSquare,
    title: 'Invited to parley',
    oneLiner: 'Multi-agent conversations with turn order and a termination rule.',
    detail:
      'When several agents need to settle something, the harness seats them at a table with a defined turn order and a condition that ends the talk. It is a structured conversation with a gavel, not a free-for-all of interrupts.',
  },
  {
    n: '06',
    icon: CircleDollarSign,
    title: 'Pays rent',
    oneLiner: 'Budget- and bond-gated; an over-cap agent is throttled at the tool call.',
    detail:
      'Every agent runs against a budget and a posted bond. When it goes over cap, the brake is applied at the tool call itself — the most precise place to stop runaway spend, before the expensive action, not after the invoice.',
  },
  {
    n: '07',
    icon: GitBranch,
    title: 'Steered to fresh worktrees',
    oneLiner: 'Never edits the main checkout — redirected to an isolated worktree.',
    detail:
      'The harness keeps agents out of the working copy you are sitting in. Work is redirected into its own git worktree, so an agent’s experiment can fail, branch, or be thrown away without ever disturbing your checkout.',
  },
  {
    n: '08',
    icon: Ban,
    title: 'Destructive commands vetoed',
    oneLiner: 'rm -rf and git push --force are intercepted — with the safe path named.',
    detail:
      'The dangerous command is caught at the gate. The agent does not just get a wall; it gets the safe alternative spelled out — the reversible move it should have reached for. A veto that teaches, not one that merely blocks.',
  },
] as const

/** A small status pill for the vendor-support honesty table. */
function StatusPill({ tone, children }: { tone: 'live' | 'mapped'; children: React.ReactNode }) {
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
                    A bare agent types into the void. A harnessed one joins the crew.
                  </PanelTitle>
                  <PanelBody className="max-w-[46rem] text-[length:var(--type-panel-body-size)]">
                    Run an AI coding agent inside the Port Daddy Harness and it stops
                    being a lone process talking to itself. The harness sinks
                    tentacles into the vendor CLI’s own hook surface — and on the way
                    in, it grants the agent eight things a bare CLI never had: it
                    hears the fleet, knows the swarm, gets its verdicts back, pays
                    rent, and is stopped before it can do anything it can’t undo.
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
                <figure className="space-y-[var(--space-2)]">
                  <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                    <source srcSet="/img/generated/harness-hero.webp" type="image/webp" />
                    <img
                      src="/img/generated/harness-hero.jpg"
                      alt="A single agent core at center, eight instrumented lines reaching out into a control plane of message tubes, a subscription rail, a swarm-ownership grid, a returning verdict path, a conversation loop, a budget meter, an isolated worktree, and an amber guard gate"
                      className="h-full w-full object-cover"
                      width={1456}
                      height={816}
                    />
                  </picture>
                  <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                    One agent core, eight instrumented lines into the fleet’s control plane.
                  </figcaption>
                </figure>
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
                  <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                    <source srcSet="/img/generated/harness-hooks.webp" type="image/webp" />
                    <img
                      src="/img/generated/harness-hooks.jpg"
                      alt="A vendor command-line tool exposing four hook ports along its edge, with keyed couplings from the daemon seating into them — one connection fully seated and solid, the others dashed and partially seated to show validation in progress"
                      className="h-full w-full object-cover"
                      width={1456}
                      height={816}
                      loading="lazy"
                    />
                  </picture>
                  <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                    The daemon seats into the CLI’s hook ports. One solid coupling is verified; the dashed ones are validating.
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
              title="Eight things a bare CLI never had."
              description="Each one rides a hook. Together they turn an isolated process into a member of the crew — aware of the others, accountable for its spend, recoverable when it dies, and stopped before it can do harm."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[20ch]"
            />
            <div className="mt-[var(--space-7)] grid gap-[var(--space-4)] md:grid-cols-2">
              {CAPABILITIES.map((cap) => (
                <SurfacePanel
                  key={cap.n}
                  elevation="quiet"
                  padding="compact"
                  className="grid gap-[var(--space-3)] md:grid-cols-[3rem_minmax(0,1fr)]"
                >
                  <div className="flex flex-col items-start gap-[var(--space-2)]">
                    <span className="inline-flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                      <cap.icon size={18} />
                    </span>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                      {cap.n}
                    </span>
                  </div>
                  <div className="grid gap-[var(--space-2)]">
                    <PanelTitle as="h3" size="nav" className="max-w-none">
                      {cap.title}
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none font-semibold text-[var(--text-primary)]">
                      {cap.oneLiner}
                    </PanelBody>
                    <PanelBody size="compact" className="max-w-none">
                      {cap.detail}
                    </PanelBody>
                  </div>
                </SurfacePanel>
              ))}
            </div>
          </PageContainer>
        </section>

        {/* ── Veto deep-dive ─────────────────────────────────────────── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <figure className="space-y-[var(--space-2)]">
                  <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                    <source srcSet="/img/generated/harness-veto.webp" type="image/webp" />
                    <img
                      src="/img/generated/harness-veto.jpg"
                      alt="A destructive command lane carrying a hazard mark arrives and is stopped by an amber guard gate; a clean rerouted lane departs toward a safe terminal node, showing the command was redirected to a safe alternative rather than only blocked"
                      className="h-full w-full object-cover"
                      width={1456}
                      height={816}
                      loading="lazy"
                    />
                  </picture>
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
              <picture>
                <source
                  media="(prefers-color-scheme: dark)"
                  srcSet="/img/generated/harness-contract-topology-dark.png"
                />
                <img
                  src="/img/generated/harness-contract-topology-light.png"
                  alt="A topology diagram showing the Articles of Agreement harness between an agent runtime, hook layer, Port Daddy daemon, MCP response path, sandbox berth, and model backend"
                  className="w-full border-2 border-[var(--border-strong)] bg-[var(--surface-base)]"
                  width={1400}
                  height={780}
                  loading="eager"
                />
              </picture>
              <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                The runtime is where the Articles attach. Claude, Codex, Gemma, Ollama, and cloud agents can sit behind it only when their tool loop preserves the contract.
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
